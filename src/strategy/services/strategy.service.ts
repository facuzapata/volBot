import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as indicators from 'src/utils/indicators';
import { TradeSignal } from '../interfaces/traide-signal.interface';
import { StrategyCallback } from '../interfaces/strategy-callback.interface';

@Injectable()
export class StrategyService implements OnModuleInit, StrategyCallback {
    private readonly logger = new Logger(StrategyService.name);
    private candles: indicators.Candle[] = [];
    private readonly maxCandles = 50;
    private lastCandle: indicators.Candle | null = null;
    private readonly capital = 50;
    private readonly riskPerTrade = 0.01;

    private activeSignals: TradeSignal[] = [];
    private readonly maxActiveSignals = 2;

    constructor(private readonly eventEmitter: EventEmitter2) { }

    onModuleInit() {
        this.logger.log('Estrategia inicializada.');
    }

    processCandle(candle: indicators.Candle) {
        this.candles.push(candle);
        if (this.candles.length > this.maxCandles) this.candles.shift();

        const closes = this.candles.map((c) => c.close);
        if (closes.length < 26) {
            this.logger.debug('No hay suficientes datos para indicadores avanzados');
            return;
        }

        // Indicadores
        const smaShort = indicators.calculateSMA(closes, 5);
        const smaLong = indicators.calculateSMA(closes, 20);
        const rsi = indicators.calculateRSI(closes, 14);
        const macd = indicators.calculateMACD(closes);
        const atr = indicators.calculateATR(this.candles);

        if ([smaShort, smaLong, rsi, macd, atr].some((val) => val === null)) {
            this.logger.debug('No hay suficientes datos para calcular indicadores.');
            return;
        }

        const { macdLine, signalLine } = macd!;
        const latestMACD = macdLine[macdLine.length - 1];
        const latestSignal = signalLine[signalLine.length - 1];

        // Confirmaciones tendencia
        const isUptrend = smaShort! > smaLong! && latestMACD > latestSignal;
        const isDowntrend = smaShort! < smaLong! && latestMACD < latestSignal;

        // Confirmación velas
        const bullishEngulfing = indicators.isBullishEngulfing(this.candles);
        // Condiciones para compra
        const priceRatio = candle.close / (this.lastCandle?.close || candle.close);
        const volumeRatio = this.lastCandle?.volume
            ? candle.volume / this.lastCandle.volume
            : 1;

        const COMMISSION = 0.001; // 0.1% por operación
        const PROFIT_MARGIN = 0.002; // 0.2% extra sobre la comisión

        // Busca la última señal de compra activa
        const lastBuySignal = this.activeSignals.find(sig => sig.side === 'buy');
        const minSellPrice = lastBuySignal
            ? lastBuySignal.price * (1 + 2 * COMMISSION + PROFIT_MARGIN)
            : 0;

        const isBuySignal =
            priceRatio <= 1.001 &&
            candle.close > candle.open &&
            // volumeRatio > 1.1 &&
            isUptrend &&
            rsi! > 35 &&
            rsi! < 75 &&
            bullishEngulfing;

        // Condiciones para venta
        const isSellSignal =
            priceRatio >= 1.001 &&
            candle.close < candle.open &&
            // volumeRatio > 1.1 &&
            isDowntrend &&
            rsi! > 30 &&
            rsi! < 60 &&
            !bullishEngulfing &&
            candle.close > minSellPrice;

        if (isBuySignal && this.preValidateSignal('buy', candle.close, atr!)) {
            this.logger.log(`🟢 Señal de COMPRA validada a ${candle.close.toFixed(2)}`);
            this.emitTradeSignal('buy', candle.close, atr!);
        } else if (
            isSellSignal &&
            this.preValidateSignal('sell', candle.close, atr!)
        ) {
            // Simula la operación para validar ganancia neta
            const sellPrice = Math.max(candle.close, minSellPrice);
            const lastBuy = lastBuySignal?.price ?? 0;
            const capitalAfterBuy = this.capital - this.capital * COMMISSION;
            const size = capitalAfterBuy / lastBuy;
            const profit = (sellPrice - lastBuy) * size;
            const capitalAfterSell = capitalAfterBuy + profit - (capitalAfterBuy + profit) * COMMISSION;

            // Solo emite la señal si la ganancia neta es positiva
            if (lastBuySignal && candle.close > lastBuySignal.price * (1 + 2 * COMMISSION + PROFIT_MARGIN)) {
                this.logger.log(`🔴 Señal de VENTA validada a ${sellPrice.toFixed(2)} (ganancia neta asegurada)`);
                this.emitTradeSignal('sell', sellPrice, atr!, lastBuySignal.id);
            } else {
                this.logger.log(`❌ Venta descartada: no deja ganancia neta (capital final sería ${capitalAfterSell.toFixed(2)})`);
            }
        }

        this.lastCandle = candle;
    }

    private preValidateSignal(
        side: 'buy' | 'sell',
        price: number,
        atr: number,
    ): boolean {
        const minCandlesBeforeSignal = 10;
        if (this.candles.length < minCandlesBeforeSignal) return false;

        // Evitar señales demasiado seguidas del mismo tipo
        const cooldownBars = 5;
        const lastSameSideSignalIndex = this.activeSignals
            .map((s) => this.candles.findIndex(c => c.close === s.price))
            .filter(idx => idx !== -1)
            .sort((a, b) => b - a)[0] ?? -100;

        const currentIndex = this.candles.length - 1;
        if (currentIndex - lastSameSideSignalIndex < cooldownBars) {
            this.logger.debug(`Señal ${side} descartada: cooldown de ${cooldownBars} velas.`);
            return false;
        }

        // Revisar drawdown histórico: que en las últimas velas no haya caídas fuertes > 2*ATR
        const recentCandles = this.candles.slice(-minCandlesBeforeSignal);
        for (let i = 1; i < recentCandles.length; i++) {
            const drop = recentCandles[i - 1].close - recentCandles[i].close;
            if (drop > 2 * atr) {
                this.logger.debug(`Señal ${side} descartada: caída brusca previa.`);
                return false;
            }
        }

        // Confirmación técnica adicional: por ejemplo, RSI en rango óptimo
        const closes = this.candles.map(c => c.close);
        const rsi = indicators.calculateRSI(closes, 14);

        if (rsi === null) return false;

        if (side === 'buy' && (rsi < 40 || rsi > 65)) {
            this.logger.debug(`Señal BUY descartada: RSI fuera de rango 40-65 (${rsi.toFixed(1)})`);
            return false;
        }

        if (side === 'sell' && (rsi < 35 || rsi > 60)) {
            this.logger.debug(`Señal SELL descartada: RSI fuera de rango 35-60 (${rsi.toFixed(1)})`);
            return false;
        }

        // Validación de riesgo: el tamaño de la posición no debe ser demasiado grande (ej: > 10 unidades)
        const riskAmount = this.capital * this.riskPerTrade;
        const positionSize = riskAmount / Math.abs(price - (side === 'buy' ? price * 0.97 : price * 1.03));
        if (positionSize > 20) {
            this.logger.debug(`Señal ${side} descartada: tamaño de posición excesivo (${positionSize.toFixed(2)}).`);
            return false;
        }

        // Si pasa todo, la señal es válida
        return true;
    }


    private emitTradeSignal(side: 'buy' | 'sell', price: number, atr: number, id?: string) {
        if (this.activeSignals.length >= this.maxActiveSignals) {
            this.logger.warn(
                '⚠️ Límite de señales activas alcanzado. No se emite nueva señal.',
            );
            return;
        }

        // Usar ATR para SL y TP más dinámicos
        const stopLossPercent = (1.5 * atr) / price;
        const takeProfitPercent = (3 * atr) / price;

        const stopLoss =
            side === 'buy' ? price * (1 - stopLossPercent) : price * (1 + stopLossPercent);
        const takeProfit =
            side === 'buy' ? price * (1 + takeProfitPercent) : price * (1 - takeProfitPercent);

        const riskAmount = this.capital * this.riskPerTrade;
        const positionSize = riskAmount / Math.abs(price - stopLoss);

        const tradeSignal: TradeSignal = {
            id: id || (Date.now().toString() + Math.random().toString(36).slice(2)),
            symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
            price,
            size: positionSize,
            stopLoss,
            takeProfit,
            side,
            paperTrading: true,
        };
        console.log(`Nueva señal ${side}:`, tradeSignal);
        this.activeSignals.push(tradeSignal);
        this.eventEmitter.emit(`trade.${side}`, tradeSignal);
    }

    public closeSignal(signalId: string) {
        this.activeSignals = this.activeSignals.filter((sig) => sig.id !== signalId);
    }
}
