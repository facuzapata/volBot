import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import * as indicators from 'src/utils/indicators';

@Injectable()
export class CandleCacheService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CandleCacheService.name);
    private redisClient: RedisClientType;
    private readonly CANDLES_KEY = 'bot:candles';
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
            throw error;
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
    async addCandle(candle: indicators.Candle): Promise<void> {
        try {
            const candleData = JSON.stringify(candle);

            // Añadir la vela a la lista (LPUSH para añadir al inicio)
            await this.redisClient.lPush(this.CANDLES_KEY, candleData);

            // Mantener solo las últimas MAX_CANDLES velas
            await this.redisClient.lTrim(this.CANDLES_KEY, 0, this.MAX_CANDLES - 1);

            // Establecer TTL si es la primera vela
            const listLength = await this.redisClient.lLen(this.CANDLES_KEY);
            if (listLength === 1) {
                await this.redisClient.expire(this.CANDLES_KEY, this.TTL_HOURS * 3600);
            }

            this.logger.debug(`📊 Vela añadida al cache: ${candle.close} | Total: ${Math.min(listLength, this.MAX_CANDLES)}`);
        } catch (error) {
            this.logger.error('Error añadiendo vela al cache:', error);
            throw error;
        }
    }

    /**
     * Obtener todas las velas del cache
     */
    async getCandles(): Promise<indicators.Candle[]> {
        try {
            const candlesData = await this.redisClient.lRange(this.CANDLES_KEY, 0, -1);

            // Las velas están en orden inverso (más reciente primero), así que las invertimos
            const candles = candlesData
                .reverse()
                .map(data => JSON.parse(data) as indicators.Candle);

            this.logger.debug(`📊 Recuperadas ${candles.length} velas del cache`);
            return candles;
        } catch (error) {
            this.logger.error('Error obteniendo velas del cache:', error);
            return [];
        }
    }

    /**
     * Obtener las últimas N velas
     */
    async getLastCandles(count: number): Promise<indicators.Candle[]> {
        try {
            const candlesData = await this.redisClient.lRange(this.CANDLES_KEY, 0, count - 1);

            // Las velas están en orden inverso, así que las invertimos
            const candles = candlesData
                .reverse()
                .map(data => JSON.parse(data) as indicators.Candle);

            this.logger.debug(`📊 Recuperadas últimas ${candles.length} velas del cache`);
            return candles;
        } catch (error) {
            this.logger.error('Error obteniendo últimas velas del cache:', error);
            return [];
        }
    }

    /**
     * Obtener el número de velas en cache
     */
    async getCandleCount(): Promise<number> {
        try {
            return await this.redisClient.lLen(this.CANDLES_KEY);
        } catch (error) {
            this.logger.error('Error obteniendo count de velas:', error);
            return 0;
        }
    }

    /**
     * Limpiar todas las velas del cache
     */
    async clearCandles(): Promise<void> {
        try {
            await this.redisClient.del(this.CANDLES_KEY);
            this.logger.log('🗑️  Cache de velas limpiado');
        } catch (error) {
            this.logger.error('Error limpiando cache de velas:', error);
            throw error;
        }
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
    }> {
        try {
            const candleCount = await this.getCandleCount();
            const ttl = await this.redisClient.ttl(this.CANDLES_KEY);

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
}
