import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as indicators from 'src/utils/indicators';
import { UserTradeConfigService } from '../../users/services/user-trade-config.service';

const WebSocket = require('ws');

interface SymbolWebSocket {
    symbol: string;
    timeframeMinutes: number;
    ws: any;
    isConnected: boolean;
    candleBuffer: indicators.Candle[];
    lastCandleTime: number;
}

interface StrategyCallback {
    processCandle(candle: indicators.Candle, symbol: string, timeframeMinutes: number): Promise<void>;
}

@Injectable()
export class BinanceMultiWsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BinanceMultiWsService.name);
    private wsMap: Map<string, SymbolWebSocket> = new Map(); // key: "BTCUSDT:1", "ETHUSDT:5", etc
    private strategyCallback: StrategyCallback | null = null;

    constructor(
        private eventEmitter: EventEmitter2,
        private userTradeConfigService: UserTradeConfigService
    ) { }

    setCallback(callback: StrategyCallback) {
        this.strategyCallback = callback;
    }

    async onModuleInit() {
        this.logger.log('🚀 Inicializando BinanceMultiWsService...');

        // Obtener configuraciones requeridas de todos los usuarios
        const requiredWebSockets = await this.userTradeConfigService.getRequiredWebSocketsForAllUsers();

        if (requiredWebSockets.size === 0) {
            this.logger.warn('⚠️ No hay configuraciones de trading disponibles. Usando BTC/USDT 1m como default...');
            await this.subscribeToSymbol('BTCUSDT', 1);
        } else {
            // Subscribirse a todos los símbolos/timeframes requeridos
            for (const [symbol, timeframesSet] of requiredWebSockets.entries()) {
                for (const timeframe of timeframesSet) {
                    await this.subscribeToSymbol(symbol, timeframe);
                }
            }
        }

        this.logger.log(`✅ BinanceMultiWsService inicializado con ${this.wsMap.size} WebSocket(s)`);
    }

    async onModuleDestroy() {
        this.logger.log('🔌 Cerrando todos los WebSockets...');
        for (const [key, ws] of this.wsMap.entries()) {
            if (ws.ws) {
                ws.ws.close();
                this.logger.log(`🔌 WebSocket cerrado para ${ws.symbol} ${ws.timeframeMinutes}m`);
            }
        }
        this.wsMap.clear();
    }

    /**
     * Suscribirse a un símbolo en un timeframe específico
     * @param symbol Símbolo (ej: BTCUSDT)
     * @param timeframeMinutes Timeframe en minutos (ej: 1, 5, 15)
     */
    async subscribeToSymbol(symbol: string, timeframeMinutes: number): Promise<void> {
        const key = `${symbol.toLowerCase()}:${timeframeMinutes}`;

        // Si ya existe, no crear otro
        if (this.wsMap.has(key)) {
            this.logger.debug(`⚠️ Ya hay WebSocket para ${symbol} ${timeframeMinutes}m`);
            return;
        }

        // Convertir minutos a intervalo de Binance (1m, 5m, 15m, 1h, 4h, etc)
        const intervalCode = this.getIntervalCode(timeframeMinutes);
        const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${intervalCode}`;

        this.logger.log(`📡 Conectando WebSocket: ${symbol} ${timeframeMinutes}m`);

        const ws = new WebSocket(wsUrl);
        const symbolWs: SymbolWebSocket = {
            symbol,
            timeframeMinutes,
            ws,
            isConnected: false,
            candleBuffer: [],
            lastCandleTime: 0
        };

        ws.on('open', () => {
            symbolWs.isConnected = true;
            this.logger.log(`✅ WebSocket conectado: ${symbol} ${timeframeMinutes}m`);
        });

        ws.on('message', (data: any) => {
            try {
                const message = JSON.parse(data.toString());
                const kline = message.k;

                if (kline && this.strategyCallback) {
                    const candle = {
                        open: parseFloat(kline.o),
                        close: parseFloat(kline.c),
                        high: parseFloat(kline.h),
                        low: parseFloat(kline.l),
                        volume: parseFloat(kline.v),
                        timestamp: kline.t
                    };

                    // Solo procesar cuando la vela está completa (x: true)
                    if (kline.x) {
                        this.logger.debug(`🕯️ Vela cerrada recibida: ${symbol} ${timeframeMinutes}m @ ${candle.close}`);

                        // Procesar la vela completada
                        if (this.strategyCallback) {
                            this.strategyCallback.processCandle(candle, symbol, timeframeMinutes).catch((error) => {
                                this.logger.error(`❌ Error procesando vela ${symbol} ${timeframeMinutes}m:`, error);
                            });
                        }

                        // Emitir evento global para compatibilidad hacia atrás
                        this.eventEmitter.emit('candle:received', {
                            symbol,
                            timeframeMinutes,
                            candle
                        });
                    }
                }
            } catch (error) {
                this.logger.error(`❌ Error parsing WebSocket message para ${symbol}:`, error);
            }
        });

        ws.on('close', () => {
            symbolWs.isConnected = false;
            this.logger.warn(`📱 WebSocket desconectado para ${symbol} ${timeframeMinutes}m, intentando reconectar en 5s...`);
            setTimeout(() => {
                this.reconnect(key, symbol, timeframeMinutes);
            }, 5000);
        });

        ws.on('error', (err: any) => {
            this.logger.error(`❌ WebSocket error para ${symbol}:`, err.message);
            ws?.close();
        });

        this.wsMap.set(key, symbolWs);
    }

    /**
     * Desuscribirse de un símbolo
     * @param symbol Símbolo
     * @param timeframeMinutes Timeframe
     */
    async unsubscribeFromSymbol(symbol: string, timeframeMinutes: number): Promise<void> {
        const key = `${symbol.toLowerCase()}:${timeframeMinutes}`;
        const symbolWs = this.wsMap.get(key);

        if (symbolWs && symbolWs.ws) {
            symbolWs.ws.close();
            this.wsMap.delete(key);
            this.logger.log(`🔌 Desuscrito de ${symbol} ${timeframeMinutes}m`);
        }
    }

    /**
     * Reconectar a un WebSocket
     */
    private async reconnect(key: string, symbol: string, timeframeMinutes: number): Promise<void> {
        // Remover la conexión vieja
        this.wsMap.delete(key);

        // Crear nueva conexión
        await this.subscribeToSymbol(symbol, timeframeMinutes);
    }

    /**
     * Convertir minutos a código de intervalo de Binance
     */
    private getIntervalCode(minutes: number): string {
        const intervals: { [key: number]: string } = {
            1: '1m',
            3: '3m',
            5: '5m',
            15: '15m',
            30: '30m',
            60: '1h',
            120: '2h',
            240: '4h',
            360: '6h',
            480: '8h',
            720: '12h',
            1440: '1d',
            10080: '1w',
            43200: '1M'
        };

        if (intervals[minutes]) {
            return intervals[minutes];
        }

        throw new Error(`Timeframe no soportado: ${minutes} minutos`);
    }

    /**
     * Obtiene el estado de todos los WebSockets
     */
    getStatus(): { symbol: string; timeframe: number; connected: boolean }[] {
        return Array.from(this.wsMap.values()).map(ws => ({
            symbol: ws.symbol,
            timeframe: ws.timeframeMinutes,
            connected: ws.isConnected
        }));
    }

    /**
     * Obtiene un resumen del estado
     */
    getStatusSummary(): string {
        const status = this.getStatus();
        const connected = status.filter(s => s.connected).length;
        const total = status.length;

        return `📡 WebSockets: ${connected}/${total} conectados\n${status
            .map(s => `  ${s.symbol} ${s.timeframe}m: ${s.connected ? '✅' : '❌'}`)
            .join('\n')}`;
    }
}
