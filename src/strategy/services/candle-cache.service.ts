import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import * as indicators from 'src/utils/indicators';

@Injectable()
export class CandleCacheService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CandleCacheService.name);
    private redisClient: RedisClientType;
    private readonly CANDLES_KEY_PREFIX = 'bot:candles';
    private readonly DEFAULT_SYMBOL = process.env.BINANCE_SYMBOL || 'BTCUSDT';
    private readonly DEFAULT_TIMEFRAME_MINUTES = Number(process.env.BINANCE_TIMEFRAME || 1);
    private readonly MAX_CANDLES = 100; // Máximo número de velas a mantener
    private readonly TTL_HOURS = 24; // TTL en horas para las velas

    constructor() {
        this.redisClient = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            socket: {
                connectTimeout: 10000,
            }
        });

        this.redisClient.on('error', (err) => {
            this.logger.error('Redis Client Error:', err);
        });

        this.redisClient.on('connect', () => {
            this.logger.log('📡 Conectado a Redis');
        });

        this.redisClient.on('disconnect', () => {
            this.logger.warn('📡 Desconectado de Redis');
        });
    }

    async onModuleInit() {
        try {
            await this.redisClient.connect();
            this.logger.log('🚀 Servicio de cache de velas inicializado');
        } catch (error) {
            this.logger.error('Error conectando a Redis:', error);
            this.logger.warn('⚠️  Cache de velas deshabilitado - continuando sin Redis');
            // No lanzar error - permitir que la app continúe sin Redis
        }
    }

    async onModuleDestroy() {
        if (this.redisClient.isOpen) {
            await this.redisClient.disconnect();
            this.logger.log('📡 Conexión Redis cerrada');
        }
    }

    /**
     * Añadir una nueva vela al cache
     */
    async addCandle(candle: indicators.Candle, symbol?: string, timeframeMinutes?: number): Promise<void> {
        if (!this.isConnected()) {
            this.logger.debug('Redis no conectado - omitiendo cache de vela');
            return;
        }

        try {
            const cacheKey = this.getCandlesKey(symbol, timeframeMinutes);

            // Verificar si la vela más antigua ha expirado (más de 24 horas)
            await this.checkAndClearExpiredCandles(cacheKey);

            const candleData = JSON.stringify(candle);

            // Añadir la vela a la lista (LPUSH para añadir al inicio)
            await this.redisClient.lPush(cacheKey, candleData);

            // Mantener solo las últimas MAX_CANDLES velas (elimina las más viejas)
            await this.redisClient.lTrim(cacheKey, 0, this.MAX_CANDLES - 1);

            // Renovar el TTL cada vez que se añade una vela
            await this.redisClient.expire(cacheKey, this.TTL_HOURS * 3600);

            const listLength = await this.redisClient.lLen(cacheKey);
            this.logger.debug(`📊 Vela añadida al cache ${cacheKey}: ${candle.close} | Total: ${listLength}/${this.MAX_CANDLES}`);
        } catch (error) {
            this.logger.error('Error añadiendo vela al cache:', error);
            // No lanzar error - continuar sin cache
        }
    }

    /**
     * Verificar y limpiar velas expiradas (más antiguas de 24 horas)
     */
    private async checkAndClearExpiredCandles(cacheKey: string): Promise<void> {
        try {
            // Obtener la vela más antigua (última en la lista)
            const oldestCandleData = await this.redisClient.lIndex(cacheKey, -1);

            if (!oldestCandleData) {
                return; // No hay velas
            }

            const oldestCandle = JSON.parse(oldestCandleData) as indicators.Candle;
            if (typeof oldestCandle.timestamp !== 'number') {
                this.logger.warn('La vela más antigua no tiene timestamp válido, limpiando cache.');
                await this.clearCandlesByKey(cacheKey);
                return;
            }
            const candleAge = Date.now() - oldestCandle.timestamp;
            const maxAge = this.TTL_HOURS * 3600 * 1000; // 24 horas en milisegundos

            if (candleAge > maxAge) {
                await this.clearCandlesByKey(cacheKey);
                this.logger.log(`🗑️  Cache ${cacheKey} limpiado: vela más antigua tenía ${Math.round(candleAge / 3600000)} horas`);
            }
        } catch (error) {
            this.logger.error('Error verificando velas expiradas:', error);
        }
    }

    /**
     * Obtener todas las velas del cache
     */
    async getCandles(symbol?: string, timeframeMinutes?: number): Promise<indicators.Candle[]> {
        if (!this.isConnected()) {
            return [];
        }

        try {
            const cacheKey = this.getCandlesKey(symbol, timeframeMinutes);
            const candlesData = await this.redisClient.lRange(cacheKey, 0, -1);

            // Las velas están en orden inverso (más reciente primero), así que las invertimos
            const candles = candlesData
                .reverse()
                .map(data => JSON.parse(data) as indicators.Candle);

            this.logger.debug(`📊 Recuperadas ${candles.length} velas del cache ${cacheKey}`);
            return candles;
        } catch (error) {
            this.logger.error('Error obteniendo velas del cache:', error);
            return [];
        }
    }

    /**
     * Obtener las últimas N velas
     */
    async getLastCandles(count: number, symbol?: string, timeframeMinutes?: number): Promise<indicators.Candle[]> {
        if (!this.isConnected()) {
            return [];
        }

        try {
            const cacheKey = this.getCandlesKey(symbol, timeframeMinutes);
            const candlesData = await this.redisClient.lRange(cacheKey, 0, count - 1);

            // Las velas están en orden inverso, así que las invertimos
            const candles = candlesData
                .reverse()
                .map(data => JSON.parse(data) as indicators.Candle);

            this.logger.debug(`📊 Recuperadas últimas ${candles.length} velas del cache ${cacheKey}`);
            return candles;
        } catch (error) {
            this.logger.error('Error obteniendo últimas velas del cache:', error);
            return [];
        }
    }

    /**
     * Obtener el número de velas en cache
     */
    async getCandleCount(symbol?: string, timeframeMinutes?: number): Promise<number> {
        if (!this.isConnected()) {
            return 0;
        }

        try {
            const cacheKey = this.getCandlesKey(symbol, timeframeMinutes);
            return await this.redisClient.lLen(cacheKey);
        } catch (error) {
            this.logger.error('Error obteniendo count de velas:', error);
            return 0;
        }
    }

    /**
     * Limpiar todas las velas del cache
     */
    async clearCandles(symbol?: string, timeframeMinutes?: number): Promise<void> {
        if (!this.isConnected()) {
            return;
        }

        try {
            const cacheKey = this.getCandlesKey(symbol, timeframeMinutes);
            await this.clearCandlesByKey(cacheKey);
            this.logger.log(`🗑️  Cache de velas limpiado: ${cacheKey}`);
        } catch (error) {
            this.logger.error('Error limpiando cache de velas:', error);
            // No lanzar error
        }
    }

    private async clearCandlesByKey(cacheKey: string): Promise<void> {
        await this.redisClient.del(cacheKey);
    }

    /**
     * Verificar si Redis está conectado
     */
    isConnected(): boolean {
        return this.redisClient.isOpen;
    }

    /**
     * Obtener información del cache
     */
    async getCacheInfo(): Promise<{
        candleCount: number;
        isConnected: boolean;
        ttl: number;
    }>;
    async getCacheInfo(symbol: string, timeframeMinutes: number): Promise<{
        candleCount: number;
        isConnected: boolean;
        ttl: number;
    }>;
    async getCacheInfo(symbol?: string, timeframeMinutes?: number): Promise<{
        candleCount: number;
        isConnected: boolean;
        ttl: number;
    }> {
        if (!this.isConnected()) {
            return {
                candleCount: 0,
                isConnected: false,
                ttl: -1
            };
        }

        try {
            const cacheKey = this.getCandlesKey(symbol, timeframeMinutes);
            const candleCount = await this.getCandleCount(symbol, timeframeMinutes);
            const ttl = await this.redisClient.ttl(cacheKey);

            return {
                candleCount,
                isConnected: this.isConnected(),
                ttl
            };
        } catch (error) {
            this.logger.error('Error obteniendo info del cache:', error);
            return {
                candleCount: 0,
                isConnected: false,
                ttl: -1
            };
        }
    }

    private getCandlesKey(symbol?: string, timeframeMinutes?: number): string {
        const normalizedSymbol = (symbol || this.DEFAULT_SYMBOL).toUpperCase();
        const normalizedTimeframe = timeframeMinutes || this.DEFAULT_TIMEFRAME_MINUTES;
        return `${this.CANDLES_KEY_PREFIX}:${normalizedSymbol}:${normalizedTimeframe}`;
    }
}
