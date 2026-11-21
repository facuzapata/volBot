import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly client = createClient({
    url: process.env.V2_REDIS_URL || 'redis://localhost:16379',
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: (retries) => Math.min(5000, 200 * (retries + 1)),
    },
    disableOfflineQueue: true,
  });
  constructor() {
    this.client.on('error', () => undefined);
  }
  onModuleInit(): void {
    void this.client.connect().catch(() => undefined);
  }
  get ready(): boolean {
    return this.client.isReady;
  }
  async set(key: string, value: unknown, ttl = 30): Promise<void> {
    if (this.ready)
      await this.client
        .setEx(`volbot:v2:${key}`, ttl, JSON.stringify(value))
        .catch(() => undefined);
  }
  async get<T>(key: string): Promise<T | null> {
    if (!this.ready) return null;
    const value = await this.client.get(`volbot:v2:${key}`).catch(() => null);
    try {
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }
  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.disconnect();
  }
}
