import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
const WebSocket = require('ws');
import { StrategyCallback } from 'src/strategy/interfaces/strategy-callback.interface';
import { StrategyService } from 'src/strategy/services/strategy.service';

@Injectable()
export class BinanceWsService implements OnModuleInit, OnModuleDestroy {
    private ws: any = null;
    private strategyCallback: StrategyCallback | null = null;

    constructor(private readonly strategyService: StrategyService) { }

    setCallback(callback: StrategyCallback) {
        this.strategyCallback = callback;
    }

    onModuleInit() {
        this.setCallback(this.strategyService);
        this.connect();
    }
    onModuleDestroy() {
        this.disconnect();
    }

    private connect() {
        const symbol = 'btcusdt';
        const interval = '1m';
        const wsUrl = `wss://stream.binance.com:9443/ws/${symbol}@kline_${interval}`;

        this.ws = new WebSocket(wsUrl);

        if (this.ws) {
            this.ws.on('open', () => {
                console.log('WebSocket conectado a Binance!');
            });

            this.ws.on('message', (data: any) => {
                try {
                    const message = JSON.parse(data.toString());
                    const kline = message.k;

                    if (kline && kline.x && this.strategyCallback) {
                        const candle = {
                            open: parseFloat(kline.o),
                            close: parseFloat(kline.c),
                            high: parseFloat(kline.h),
                            low: parseFloat(kline.l),
                            volume: parseFloat(kline.v),
                            timestamp: kline.t,
                        };
                        this.strategyCallback.processCandle(candle);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('WebSocket desconectado, intentando reconectar en 5s...');
                setTimeout(() => this.connect(), 5000);
            });

            this.ws.on('error', (err: any) => {
                console.error('WebSocket error:', err);
                this.ws?.close();
            });
        }
    }

    private disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}