import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ExchangeCredentialRow } from '../persistence/entities';

type Environment = 'TESTNET' | 'LIVE';
type Credentials = { apiKey: string; secret: string; environment: Environment };

function key(): Buffer {
  const encoded = process.env.V2_CREDENTIAL_ENCRYPTION_KEY;
  const value = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  if (value.length !== 32) throw new ServiceUnavailableException('Credential encryption is not configured');
  return value;
}
function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
function decrypt(value: string): string {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new ConflictException('Stored exchange credentials are invalid');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

@Injectable()
export class BinanceCredentialsService {
  constructor(private readonly db: DataSource) {}
  private baseUrl(environment: Environment): string {
    return environment === 'TESTNET' ? 'https://testnet.binance.vision' : 'https://api.binance.com';
  }
  private async account(credentials: Credentials): Promise<void> {
    const params = new URLSearchParams({ recvWindow: '5000', timestamp: String(Date.now()) });
    const signature = createHmac('sha256', credentials.secret).update(params.toString()).digest('hex');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl(credentials.environment)}/api/v3/account?${params}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': credentials.apiKey }, signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ServiceUnavailableException('Binance credential verification is unavailable');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: unknown; msg?: unknown } | null;
      const code = typeof body?.code === 'number' ? ` (${body.code})` : '';
      const message = typeof body?.msg === 'string' ? body.msg.slice(0, 200) : 'API key, secret, permissions, IP restriction or server time';
      throw new ConflictException(`Binance rejected the connection${code}: ${message}`);
    }
  }
  private read(row: ExchangeCredentialRow): Credentials {
    return { apiKey: decrypt(row.apiKeyCiphertext), secret: decrypt(row.secretCiphertext), environment: row.environment };
  }
  async saveAndVerify(userId: string, apiKey: string, secret: string, environment: Environment) {
    if (apiKey.length < 16 || secret.length < 16) throw new ConflictException('Invalid Binance credentials');
    await this.account({ apiKey, secret, environment });
    const repo = this.db.getRepository(ExchangeCredentialRow);
    const existing = await repo.findOneBy({ userId });
    const row = await repo.save({
      id: existing?.id ?? randomUUID(), userId, environment,
      apiKeyCiphertext: encrypt(apiKey), secretCiphertext: encrypt(secret), verifiedAt: new Date(),
    });
    return { userId: row.userId, environment: row.environment, verifiedAt: row.verifiedAt, configured: true };
  }
  async verify(userId: string) {
    const repo = this.db.getRepository(ExchangeCredentialRow);
    const row = await repo.findOneBy({ userId });
    if (!row) throw new ConflictException('Binance credentials are not configured');
    await this.account(this.read(row));
    row.verifiedAt = new Date(); await repo.save(row);
    return { userId, environment: row.environment, verifiedAt: row.verifiedAt, configured: true };
  }
  async status(userId: string) {
    const row = await this.db.getRepository(ExchangeCredentialRow).findOneBy({ userId });
    return row ? { userId, environment: row.environment, verifiedAt: row.verifiedAt, configured: true } : { userId, configured: false };
  }
}
