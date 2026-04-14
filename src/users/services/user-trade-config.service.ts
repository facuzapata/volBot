import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserTradeConfig } from '../entities/user-trade-config.entity';

export interface CreateTradeConfigDto {
    symbol: string;
    timeframeMinutes: number;
    profitMarginOverride?: number;
    sellMarginOverride?: number;
    maxActiveSignalsOverride?: number;
    capitalPerTradeOverride?: number;
    notes?: string;
}

@Injectable()
export class UserTradeConfigService {
    private readonly logger = new Logger(UserTradeConfigService.name);

    constructor(
        @InjectRepository(UserTradeConfig)
        private configRepository: Repository<UserTradeConfig>
    ) { }

    /**
     * Obtiene todas las configuraciones activas de trading para un usuario
     * @param userId ID del usuario
     */
    async getActiveConfigs(userId: string): Promise<UserTradeConfig[]> {
        return this.configRepository.find({
            where: {
                userId,
                isEnabled: true
            }
        });
    }

    /**
     * Obtiene todos los símbolos únicos que un usuario está tradeando
     * @param userId ID del usuario
     */
    async getActiveSymbols(userId: string): Promise<string[]> {
        const configs = await this.getActiveConfigs(userId);
        return [...new Set(configs.map(c => c.symbol))];
    }

    /**
     * Obtiene todos los símbolo-timeframe únicos que un usuario está tradeando
     * @param userId ID del usuario
     */
    async getActiveSymbolTimeframes(userId: string): Promise<{ symbol: string; timeframe: number }[]> {
        const configs = await this.getActiveConfigs(userId);
        return configs.map(c => ({ symbol: c.symbol, timeframe: c.timeframeMinutes }));
    }

    /**
     * Obtiene la configuración de un símbolo-timeframe específico para un usuario
     * @param userId ID del usuario
     * @param symbol Símbolo (ej: BTCUSDT)
     * @param timeframeMinutes Timeframe en minutos
     */
    async getConfig(userId: string, symbol: string, timeframeMinutes: number): Promise<UserTradeConfig | null> {
        return this.configRepository.findOne({
            where: {
                userId,
                symbol,
                timeframeMinutes
            }
        });
    }

    /**
     * Crea una nueva configuración de trading para un usuario
     * @param userId ID del usuario
     * @param dto Datos de la configuración
     */
    async createConfig(userId: string, dto: CreateTradeConfigDto): Promise<UserTradeConfig> {
        const config = this.configRepository.create({
            userId,
            symbol: dto.symbol.toUpperCase(),
            timeframeMinutes: dto.timeframeMinutes,
            profitMarginOverride: dto.profitMarginOverride,
            sellMarginOverride: dto.sellMarginOverride,
            maxActiveSignalsOverride: dto.maxActiveSignalsOverride,
            capitalPerTradeOverride: dto.capitalPerTradeOverride,
            notes: dto.notes
        });

        const saved = await this.configRepository.save(config);
        this.logger.log(`✅ [Usuario ${userId}] Config creada: ${dto.symbol} ${dto.timeframeMinutes}m`);
        return saved;
    }

    /**
     * Actualiza una configuración existente
     * @param configId ID de la configuración
     * @param dto Datos a actualizar
     */
    async updateConfig(configId: string, dto: Partial<CreateTradeConfigDto>): Promise<UserTradeConfig> {
        await this.configRepository.update(configId, dto);
        const updated = await this.configRepository.findOne({ where: { id: configId } });
        if (!updated) throw new Error(`Config ${configId} not found`);
        this.logger.log(`✅ Config ${configId} actualizada`);
        return updated;
    }

    /**
     * Habilita/deshabilita una configuración de trading
     * @param configId ID de la configuración
     * @param enabled true para habilitar, false para deshabilitar
     */
    async setEnabled(configId: string, enabled: boolean): Promise<UserTradeConfig> {
        await this.configRepository.update(configId, { isEnabled: enabled });
        const config = await this.configRepository.findOne({ where: { id: configId } });
        if (!config) throw new Error(`Config ${configId} not found`);
        this.logger.log(`${enabled ? '✅' : '❌'} Config ${configId} ${enabled ? 'habilitada' : 'deshabilitada'}`);
        return config;
    }

    /**
     * Elimina una configuración de trading
     * @param configId ID de la configuración
     */
    async deleteConfig(configId: string): Promise<void> {
        await this.configRepository.delete(configId);
        this.logger.log(`🗑️ Config ${configId} eliminada`);
    }

    /**
     * Obtiene qué configuraciones necesitan WebSocket
     * Retorna un mapa de símbolo -> timeframes
     */
    async getRequiredWebSocketsForAllUsers(): Promise<Map<string, Set<number>>> {
        const allConfigs = await this.configRepository.find({ where: { isEnabled: true } });

        const required = new Map<string, Set<number>>();
        for (const config of allConfigs) {
            if (!required.has(config.symbol)) {
                required.set(config.symbol, new Set());
            }
            required.get(config.symbol)!.add(config.timeframeMinutes);
        }

        return required;
    }
}
