import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { MultiBinanceService } from '../../binance/services/multi-binance.service';
import { SignalDatabaseService } from './signal-database.service';
import { CandleCacheService } from './candle-cache.service';
import { TradeSignal } from '../interfaces/traide-signal.interface';
import { Signal, SignalStatus } from '../entities/signal.entity';
import { MovementType, MovementStatus } from '../entities/movement.entity';
import { TelegramService } from '../../notifications/telegram.service';
import { WhatsAppService } from '../../notifications/whatsapp.service';
import { BinanceMultiWsService } from '../../binance/services/binance-multi-ws.service';
import { AiAnalysisService } from './ai-analysis.service';
import * as indicators from '../../utils/indicators';

interface UserStrategyConfig {
    userId: string;
    userEmail: string;
    capitalForSignals: number;
    capitalPerTrade: number;
    profitMargin: number;
    sellMargin: number;
    maxActiveSignals: number;
    dailySignalCount: number;
    lastResetDate: string;
}

@Injectable()
export class MultiUserStrategyService implements OnModuleInit {
    private readonly logger = new Logger(MultiUserStrategyService.name);
    private userConfigs: Map<string, UserStrategyConfig> = new Map();
    private lastCandle: indicators.Candle | null = null;

    // Constantes compartidas
    private readonly COMMISSION = 0.001;
    private readonly MIN_PROFIT_MARGIN = 0.005;
    private readonly PAPER_TRADING: boolean;
    private readonly maxDailySignalsDefault = 300;

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly signalDbService: SignalDatabaseService,
        private readonly candleCacheService: CandleCacheService,
        private readonly multiBinanceService: MultiBinanceService,
        @Inject(forwardRef(() => BinanceMultiWsService))
        private readonly binanceMultiWsService: BinanceMultiWsService,
        private readonly telegramService: TelegramService,
        private readonly whatsappService: WhatsAppService,
        private readonly aiAnalysisService: AiAnalysisService,
        @InjectRepository(User)
        private userRepository: Repository<User>
    ) {
        this.PAPER_TRADING = process.env.PAPER_TRADING !== 'false';
    }

    async onModuleInit() {
        const tradingMode = this.PAPER_TRADING ? 'PAPER TRADING' : 'TRADING REAL';
        this.logger.log(`🚀 Estrategia multi-usuario inicializada - Modo: ${tradingMode}`);

        // Enlazar callback para recibir velas cerradas desde BinanceMultiWsService.
        this.binanceMultiWsService.setCallback(this);
        this.logger.log('🔗 Callback de estrategia registrado en BinanceMultiWsService');

        await this.loadActiveUsers();
        await this.sendStartupNotification();
    }

    /**
     * Normaliza márgenes a formato fracción.
     * Soporta tanto 3 (3%) como 0.03 (3%).
     */
    private normalizeMargin(rawMargin: number): number {
        if (!Number.isFinite(rawMargin) || rawMargin < 0) {
            return 0;
        }

        return rawMargin > 1 ? rawMargin / 100 : rawMargin;
    }

    private async loadActiveUsers() {
        const activeUsers = await this.userRepository.find({
            where: { isActive: true }
        });

        this.logger.log(`📥 Cargando configuración para ${activeUsers.length} usuarios activos...`);

        for (const user of activeUsers) {
            const normalizedProfitMargin = this.normalizeMargin(Number(user.profitMargin));
            const normalizedSellMargin = this.normalizeMargin(Number(user.sellMargin));

            const config: UserStrategyConfig = {
                userId: user.id,
                userEmail: user.email,
                capitalForSignals: Number(user.capitalForSignals),
                capitalPerTrade: Number(user.capitalPerTrade),
                profitMargin: normalizedProfitMargin,
                sellMargin: normalizedSellMargin,
                maxActiveSignals: user.maxActiveSignals,
                dailySignalCount: 0,
                lastResetDate: new Date().toDateString()
            };

            this.userConfigs.set(user.id, config);
            this.logger.log(`✅ Configuración cargada para usuario ${user.email}:`);
            this.logger.log(`   💰 Capital por trade: ${config.capitalPerTrade} USDT`);
            this.logger.log(`   📊 Max señales activas: ${config.maxActiveSignals}`);
            this.logger.log(`   🎯 Profit margin: ${(config.profitMargin * 100).toFixed(2)}%`);
            this.logger.log(`   🛑 Stop loss margin: ${(config.sellMargin * 100).toFixed(2)}%`);
        }
    }

    private async sendStartupNotification(): Promise<void> {
        try {
            const startupTime = new Date();
            const tradingMode = this.PAPER_TRADING ? 'PAPER TRADING' : 'TRADING REAL';
            const startupDateTime = startupTime.toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // Enviar notificación a CADA usuario
            for (const [userId, config] of this.userConfigs.entries()) {
                const userMessage = [
                    '🤖 <b>Tu bot esta iniciado</b>',
                    `⏰ <b>Hora:</b> ${startupDateTime}`,
                    `📌 <b>Modo:</b> ${tradingMode}`,
                    '',
                    `👤 <b>Usuario:</b> ${config.userEmail}`,
                    `💰 Capital total: ${config.capitalForSignals} USDT`,
                    `💸 Capital por trade: ${config.capitalPerTrade} USDT`,
                    `📊 Max señales activas: ${config.maxActiveSignals}`,
                    `🎯 Profit margin: ${(config.profitMargin * 100).toFixed(2)}%`,
                    `🛑 Stop loss margin: ${(config.sellMargin * 100).toFixed(2)}%`,
                    '',
                    '✅ El sistema está monitoreando BTC/USDT en 1m'
                ].join('\n');

                const whatsappMessage = userMessage
                    .replace(/<b>/g, '*')
                    .replace(/<\/b>/g, '*');

                try {
                    await Promise.allSettled([
                        this.telegramService.sendSystemNotificationToUser(userId, userMessage),
                        this.whatsappService.sendSystemNotificationToUser(userId, whatsappMessage)
                    ]);
                } catch (error) {
                    this.logger.warn(`⚠️ Error enviando startup notification a usuario ${config.userEmail}:`, error);
                }
            }

            this.logger.log('📲 Notificaciones de inicio enviadas a todos los usuarios');
        } catch (error) {
            this.logger.error('❌ Error en sendStartupNotification:', this.getErrorMessage(error));
        }
    }

    async processCandle(candle: indicators.Candle, symbol = 'BTCUSDT', timeframeMinutes = 1) {
        // Resetear contadores diarios para todos los usuarios
        this.resetDailyCounters();

        // Añadir vela al cache de Redis
        await this.candleCacheService.addCandle(candle, symbol, timeframeMinutes);

        const cacheInfo = await this.candleCacheService.getCacheInfo(symbol, timeframeMinutes);

        if (cacheInfo.candleCount < 50) {
            this.logger.debug(`📊 [${symbol} ${timeframeMinutes}m] Esperando más velas para análisis técnico: ${cacheInfo.candleCount}/50`);
            return;
        }

        // Obtener velas del cache
        const candles = await this.candleCacheService.getCandles(symbol, timeframeMinutes);
        const closes = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);
        const volumes = candles.map((c) => c.volume);

        // Validar datos
        const hasValidData = [closes, highs, lows, volumes].every(arr =>
            arr.every(val => typeof val === 'number' && !isNaN(val) && val > 0)
        );

        if (!hasValidData) {
            this.logger.error('❌ Datos de velas inválidos');
            return;
        }

        // Calcular indicadores técnicos (una vez para todos los usuarios)
        const indicators = this.calculateTechnicalIndicators(closes, highs, lows, volumes, candles);
        if (!indicators) {
            this.logger.error('❌ Error calculando indicadores técnicos');
            return;
        }

        // Procesar estrategia para cada usuario activo
        for (const [userId, userConfig] of this.userConfigs.entries()) {
            await this.processUserStrategy(userId, userConfig, candle, indicators, candles, symbol, timeframeMinutes);
        }

        this.lastCandle = candle;
    }

    private async processUserStrategy(
        userId: string,
        userConfig: UserStrategyConfig,
        candle: indicators.Candle,
        techIndicators: any,
        candles: indicators.Candle[],
        symbol: string,
        timeframeMinutes: number
    ) {
        try {
            if (userConfig.dailySignalCount >= this.maxDailySignalsDefault) return;

            const activeSignals = await this.signalDbService.getActiveSignalsForUser(userId);
            let hasPendingSell = false;

            for (const signal of activeSignals) {
                const buyPendingMovement = signal.movements.find(m =>
                    m.type === MovementType.BUY && m.status === MovementStatus.PENDING
                );
                const sellPendingMovement = signal.movements.find(m =>
                    m.type === MovementType.SELL && m.status === MovementStatus.PENDING
                );

                const buyFilledMovement = signal.movements.find(m =>
                    m.type === MovementType.BUY && m.status === MovementStatus.FILLED
                );

                const sellFilledMovement = signal.movements.find(m =>
                    m.type === MovementType.SELL && m.status === MovementStatus.FILLED
                );

                // ✅ 1. Actualizar BUY pendientes
                if (buyPendingMovement) {
                    try {
                        const orderStatus = await this.multiBinanceService.getOrderStatus(signal.symbol, Number(buyPendingMovement.binanceOrderId), userId);
                        console.log('orderStatus', orderStatus);
                        if (orderStatus.status === 'FILLED') {
                            await this.signalDbService.updateMovementStatus(buyPendingMovement.id, MovementStatus.FILLED, { binanceResponse: orderStatus });
                            this.logger.debug(`✅ [Usuario ${userId}] BUY completado para ${signal.symbol}`);

                            // 🎯 Crear orden de VENTA LIMIT automáticamente después de confirmar la compra
                            const existingSellMovement = signal.movements.find(m =>
                                m.type === MovementType.SELL &&
                                (m.status === MovementStatus.PENDING || m.status === MovementStatus.FILLED)
                            );

                            if (!existingSellMovement) {
                                this.logger.log(`📤 [Usuario ${userId}] Creando orden de venta LIMIT automática para señal ${signal.id}`);
                                await this.createSellSignalForUser(userId, userConfig, candle, signal, techIndicators.atr);
                            }
                        }
                    } catch (error) {
                        this.logger.error(`❌ [Usuario ${userId}] Error actualizando estado de BUY ${buyPendingMovement.id}:`, this.getErrorMessage(error));
                    }
                }

                // ✅ 2. Actualizar SELL pendientes
                if (sellPendingMovement) {
                    hasPendingSell = true;
                    try {
                        const orderStatus = await this.multiBinanceService.getOrderStatus(signal.symbol, Number(sellPendingMovement.binanceOrderId), userId);
                        if (orderStatus.status === 'FILLED') {
                            await this.signalDbService.updateMovementStatus(sellPendingMovement.id, MovementStatus.FILLED, { binanceResponse: orderStatus });
                            await this.tryCreateResidualSellForSignal(userId, userConfig, signal.id, signal.symbol, candle.close);
                            this.logger.debug(`💰 [Usuario ${userId}] SELL completado para ${signal.symbol}`);
                        }
                    } catch (error) {
                        this.logger.error(`❌ [Usuario ${userId}] Error actualizando estado de SELL ${sellPendingMovement.id}:`, this.getErrorMessage(error));
                    }
                }
                // 🧠 Marcar la señal como "lista para vender" si tiene BUY FILLED y no tiene SELL pendiente/filled
                const hasBuyFilled = !!buyFilledMovement;
                const hasSellOpenOrFilled = !!(sellPendingMovement || sellFilledMovement);
                signal["readyToSell"] = hasBuyFilled && !hasSellOpenOrFilled;
            }

            // ⚙️ 3. Seguir al análisis (sin cortar antes)
            const canCreateNewSignals = activeSignals.length < userConfig.maxActiveSignals;

            await this.analyzeMarketConditionsForUser(
                userId,
                userConfig,
                candle,
                techIndicators,
                activeSignals,
                candles,
                canCreateNewSignals,
                hasPendingSell,
                symbol,
                timeframeMinutes
            );

        } catch (error) {
            this.logger.error(`❌ [Usuario ${userId}] Error procesando estrategia:`, error);
        }
    }

    private async analyzeMarketConditionsForUser(
        userId: string,
        userConfig: UserStrategyConfig,
        lastCandle: indicators.Candle,
        techIndicators: any,
        activeSignals: Signal[],
        candles: indicators.Candle[],
        canCreateNewSignals: boolean,
        hasPendingSell: boolean, // 👈 nuevo
        symbol: string,
        timeframeMinutes: number
    ) {
        const {
            smaShort, smaLong, smaVeryLong, emaShort, emaLong, rsi, macd, atr, bbands, volumeMA, currentVolume
        } = techIndicators;

        const { macdLine, signalLine, histogram } = macd;
        const latestMACD = macdLine[macdLine.length - 1];
        const latestSignal = signalLine[signalLine.length - 1];
        const latestHistogram = histogram[histogram.length - 1];

        this.logger.debug(`📈 [Usuario ${userId}] Análisis para precio ${lastCandle.close}`);

        const isStrongUptrend = smaShort > smaLong && smaLong > smaVeryLong && emaShort > emaLong;
        const isStrongDowntrend = smaShort < smaLong && smaLong < smaVeryLong && emaShort < emaLong;
        const isRangeMarket = !isStrongUptrend && !isStrongDowntrend;

        const bullishEngulfing = indicators.isBullishEngulfing(candles);
        const bearishEngulfing = indicators.isBearishEngulfing(candles);
        const priceNearBBLower = lastCandle.close <= bbands.lower * 1.005;
        const priceNearBBUpper = lastCandle.close >= bbands.upper * 0.995;

        const volumeAboveAverage = currentVolume > volumeMA * 1.2;
        const volumeConfirmation = volumeAboveAverage;

        this.logger.debug(`📊 [Usuario ${userId}] Señales activas: ${activeSignals.length}/${userConfig.maxActiveSignals}`);

        // 🟢 Evaluar compras si se pueden crear nuevas señales
        if (canCreateNewSignals) {
            await this.evaluateBuySignalsForUser(userId, userConfig, lastCandle, {
                isStrongUptrend,
                isRangeMarket,
                rsi,
                latestMACD,
                latestSignal,
                latestHistogram,
                bullishEngulfing,
                priceNearBBLower,
                volumeConfirmation,
                atr,
                smaShort,
                smaLong,
                currentVolume
            }, symbol, timeframeMinutes, candles);
        }

        // 🔴 Las órdenes de venta se crean automáticamente después de la compra
        // Esta sección se mantiene como respaldo por si hay que recrear órdenes
        const signalsReadyToSell = activeSignals.filter(s => s["readyToSell"]);
        this.logger.debug(`📊 [Usuario ${userId}] Señales con BUY FILLED: ${signalsReadyToSell.length}`);

        // Verificar si hay señales sin orden de venta y crearlas
        if (signalsReadyToSell.length > 0) {
            // Verificar si alguna señal no tiene orden de venta creada
            const signalsWithoutSellOrder = signalsReadyToSell.filter(signal =>
                !signal.movements.some(m => m.type === MovementType.SELL &&
                    (m.status === MovementStatus.PENDING || m.status === MovementStatus.FILLED))
            );

            if (signalsWithoutSellOrder.length > 0) {
                this.logger.warn(`⚠️ [Usuario ${userId}] Detectadas ${signalsWithoutSellOrder.length} señales sin orden de venta, creando...`);
                await this.evaluateSellSignalsForUser(userId, userConfig, lastCandle, atr, signalsWithoutSellOrder);
            }
        }
    }


    private async evaluateBuySignalsForUser(
        userId: string,
        userConfig: UserStrategyConfig,
        candle: indicators.Candle,
        analysis: any,
        symbol: string,
        timeframeMinutes: number,
        candles: indicators.Candle[]
    ) {
        const {
            isStrongUptrend, isRangeMarket, rsi, latestMACD, latestSignal, latestHistogram,
            bullishEngulfing, priceNearBBLower, volumeConfirmation, atr, smaShort, smaLong, currentVolume
        } = analysis;

        this.logger.debug(`🔍 [Usuario ${userId}] Evaluando señales de COMPRA para precio ${candle.close}`);

        // Verificar cuántas señales de compra activas tiene el usuario
        const activeSignals = await this.signalDbService.getActiveSignalsForUser(userId);
        const activeBuySignals = activeSignals.filter(signal =>
            signal.movements.some(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED) &&
            !signal.movements.some(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED)
        );

        if (activeBuySignals.length >= userConfig.maxActiveSignals) {
            this.logger.debug(`📊 [Usuario ${userId}] Máximo de señales de compra alcanzado: ${activeBuySignals.length}/${userConfig.maxActiveSignals}`);
            return;
        }

        // Condiciones para señal de compra (usando el margen personalizado del usuario)
        const condition1 = isStrongUptrend || (isRangeMarket && latestMACD > latestSignal);
        const condition2 = rsi >= 25 && rsi <= 65;
        const condition3 = latestMACD > latestSignal || latestHistogram > 0;
        const condition4 = bullishEngulfing || candle.close > candle.open;
        const condition5 = priceNearBBLower || candle.close < smaShort;
        // const condition6 = volumeConfirmation;
        const condition7 = candle.close > smaLong * 0.995;

        const buyConditions = [condition1, condition2, condition3, condition4, condition5, condition7];
        const passedConditions = buyConditions.filter(Boolean).length;

        this.logger.debug(`📈 [Usuario ${userId}] Resultado: ${passedConditions}/6 condiciones cumplidas`);

        // Necesitamos al menos 5 de 7 condiciones para generar señal
        if (passedConditions >= 5) {
            if (await this.validateSignalSafetyForUser(userId, 'buy', candle.close, atr)) {
                const stopLoss = candle.close * (1 - userConfig.sellMargin);
                const takeProfit = candle.close * (1 + userConfig.profitMargin);
                const rawPositionSize = userConfig.capitalPerTrade / candle.close;
                const positionSize = Math.max(0.00001, Math.floor(rawPositionSize / 0.00001) * 0.00001);

                const aiDecision = await this.aiAnalysisService.evaluateBuySignal({
                    userId,
                    userEmail: userConfig.userEmail,
                    symbol,
                    timeframeMinutes,
                    currentPrice: candle.close,
                    stopLoss,
                    takeProfit,
                    positionSize,
                    indicators: {
                        rsi,
                        latestMACD,
                        latestSignal,
                        latestHistogram,
                        atr,
                        smaShort,
                        smaLong,
                        currentVolume,
                        isStrongUptrend,
                        isRangeMarket,
                        bullishEngulfing,
                        priceNearBBLower,
                        volumeConfirmation
                    },
                    recentCandles: candles.slice(-30).map((entry) => ({
                        open: entry.open,
                        high: entry.high,
                        low: entry.low,
                        close: entry.close,
                        volume: entry.volume
                    }))
                });

                if (!aiDecision.approved) {
                    this.logger.warn(`🤖 [Usuario ${userId}] COMPRA bloqueada por IA (${aiDecision.source}): ${aiDecision.reason}`);
                    return;
                }

                if (!aiDecision.skipped) {
                    this.logger.log(`🤖 [Usuario ${userId}] IA aprobó compra (${aiDecision.source})${aiDecision.confidence !== null ? ` conf=${aiDecision.confidence.toFixed(3)}` : ''}`);
                }

                this.logger.log(`🟢 [Usuario ${userId}] GENERANDO SEÑAL DE COMPRA a ${candle.close}`);
                await this.createBuySignalForUser(userId, userConfig, candle, atr, smaShort, smaLong, rsi, latestMACD, currentVolume, symbol);
            }
        }
    }

    private async evaluateSellSignalsForUser(
        userId: string,
        userConfig: UserStrategyConfig,
        candle: indicators.Candle,
        atr: number,
        activeSignals: Signal[]
    ) {
        // Esta función se usa como respaldo para crear órdenes de venta LIMIT
        // Las órdenes normalmente se crean automáticamente después de confirmar la compra
        const buySignals = activeSignals.filter(signal =>
            signal.movements.some(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED) &&
            !signal.movements.some(m => m.type === MovementType.SELL)
        );

        if (buySignals.length === 0) {
            return;
        }

        this.logger.debug(`🔍 [Usuario ${userId}] Creando órdenes de venta LIMIT para ${buySignals.length} señal(es)`);

        for (const signal of buySignals) {
            const buyMovement = signal.movements.find(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
            if (!buyMovement) continue;

            const takeProfit = Number(signal.takeProfit);
            const stopLoss = Number(signal.stopLoss);
            const initialPrice = Number(signal.initialPrice);

            // Validar que los valores sean números válidos
            if (isNaN(takeProfit) || isNaN(stopLoss) || isNaN(initialPrice)) {
                this.logger.error(`❌ [Usuario ${userId}] Valores inválidos en señal ${signal.id}`);
                continue;
            }

            this.logger.log(`📤 [Usuario ${userId}] Creando orden SELL LIMIT para señal ${signal.id} al precio ${takeProfit.toFixed(2)}`);
            await this.createSellSignalForUser(userId, userConfig, candle, signal, atr);
        }
    }

    private async createBuySignalForUser(
        userId: string,
        userConfig: UserStrategyConfig,
        candle: indicators.Candle,
        atr: number,
        smaShort: number,
        smaLong: number,
        rsi: number,
        macd: number,
        volume: number,
        symbol: string
    ) {
        // Usar los márgenes configurados por el usuario en formato fracción.
        const takeProfitPercent = userConfig.profitMargin;
        const stopLossPercent = userConfig.sellMargin;

        const stopLoss = candle.close * (1 - stopLossPercent);
        const takeProfit = candle.close * (1 + takeProfitPercent);

        this.logger.log(`🎯 [Usuario ${userId}] Cálculo de niveles de salida:`);
        this.logger.log(`   📊 Precio de compra: ${candle.close.toFixed(2)} USDT`);
        this.logger.log(`   📊 ATR: ${atr.toFixed(2)}`);

        if (stopLossPercent > 0) {
            this.logger.log(`   🛑 Stop Loss: ${stopLoss.toFixed(2)} USDT (${(stopLossPercent * 100).toFixed(2)}% abajo)`);
            this.logger.log(`   💰 Riesgo: ${((candle.close - stopLoss) / candle.close * 100).toFixed(2)}%`);
            this.logger.log(`   ⚖️ Ratio Riesgo/Recompensa: 1:${(takeProfitPercent / stopLossPercent).toFixed(2)}`);
        } else {
            this.logger.log(`   🛑 Stop Loss: DESACTIVADO (sin límite de pérdida)`);
            this.logger.log(`   ⚠️ ADVERTENCIA: Sin stop loss, las pérdidas pueden ser ilimitadas`);
        }

        this.logger.log(`   🎯 Take Profit: ${takeProfit.toFixed(2)} USDT (${(takeProfitPercent * 100).toFixed(2)}% arriba)`);
        this.logger.log(`   💰 Ganancia esperada: ${((takeProfit - candle.close) / candle.close * 100).toFixed(2)}%`);

        // Advertencia si la ganancia esperada es menor que las comisiones
        const expectedProfitPercent = (takeProfitPercent * 100);
        const totalCommissionPercent = this.COMMISSION * 2 * 100; // Compra + Venta
        if (expectedProfitPercent < totalCommissionPercent) {
            this.logger.warn(`⚠️ ADVERTENCIA: Ganancia esperada (${expectedProfitPercent.toFixed(3)}%) es MENOR que las comisiones totales (${totalCommissionPercent}%)`);
        }

        // Usar el capital personalizado del usuario
        const rawPositionSize = userConfig.capitalPerTrade / candle.close;
        const positionSize = Math.max(0.00001, Math.floor(rawPositionSize / 0.00001) * 0.00001);

        // Crear señal en base de datos con userId
        const signal = await this.signalDbService.createSignalForUser(userId, {
            symbol,
            initialPrice: candle.close,
            stopLoss,
            takeProfit,
            atr,
            rsi,
            macd,
            smaShort,
            smaLong,
            volume,
            paperTrading: this.PAPER_TRADING
        });

        // Crear movimiento de compra
        const totalAmount = positionSize * candle.close;
        const commission = totalAmount * this.COMMISSION;
        const netAmount = totalAmount + commission;

        const movement = await this.signalDbService.createMovement({
            signalId: signal.id,
            type: MovementType.BUY,
            price: candle.close,
            quantity: positionSize,
            totalAmount,
            commission,
            netAmount
        });

        await this.notifyOrderCreated({
            userId,
            userConfig,
            side: 'BUY',
            orderType: 'MARKET',
            signalId: signal.id,
            symbol: signal.symbol,
            price: candle.close,
            quantity: positionSize,
            totalAmount,
            commission,
            stopLoss,
            takeProfit,
            movementStatus: movement.status,
            paperTrading: this.PAPER_TRADING
        });

        // Ejecutar orden si no es paper trading
        if (!this.PAPER_TRADING) {
            try {
                await this.multiBinanceService.createOrderForUser(userId, {
                    symbol,
                    side: 'BUY',
                    type: 'MARKET',
                    quantity: positionSize
                }, movement.id); // Pasar el ID del movimiento para actualizar con datos de Binance
            } catch (error) {
                this.logger.error(`❌ [Usuario ${userId}] Error ejecutando orden de compra:`, error);
            }
        }

        // Incrementar contador del usuario
        const userConfigFromMap = this.userConfigs.get(userId);
        if (userConfigFromMap) {
            userConfigFromMap.dailySignalCount++;
        }

        this.logger.log(`🟢 [Usuario ${userId}] SEÑAL DE COMPRA creada: ${candle.close} | Size: ${positionSize.toFixed(4)}`);

        // Emitir evento
        this.emitTradeSignalForUser(userId, 'buy', candle.close, atr, signal.id, undefined, signal.symbol);
    }

    private async createSellSignalForUser(
        userId: string,
        userStrategyConfig: UserStrategyConfig,
        candle: indicators.Candle,
        signal: Signal,
        atr: number
    ) {
        const buyMovement = signal.movements.find(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
        if (!buyMovement) return;

        // ✅ IMPORTANTE: Verificar si ya existe una orden de venta para esta señal
        const existingSellMovement = signal.movements.find(m =>
            m.type === MovementType.SELL &&
            (m.status === MovementStatus.PENDING || m.status === MovementStatus.FILLED)
        );

        if (existingSellMovement) {
            this.logger.debug(`⏸️ [Usuario ${userId}] Ya existe orden de venta para señal ${signal.id}: ${existingSellMovement.id} (${existingSellMovement.status})`);
            return;
        }

        const sellPrice = signal.takeProfit;

        this.logger.debug(`🔍 [Usuario ${userId}] DEBUG VENTA - Movimiento: ${buyMovement.id}`);
        this.logger.debug(`  📊 Cantidad en DB: ${buyMovement.quantity}`);
        this.logger.debug(`  📊 binanceResponse: ${JSON.stringify(buyMovement.binanceResponse)}`);

        // Calcular cantidad neta disponible real, descontando comisión si fue en BTC
        let sellQuantity = Number(buyMovement.quantity);

        if (buyMovement.binanceResponse?.fills && Array.isArray(buyMovement.binanceResponse.fills)) {
            const executedQty = Number(buyMovement.binanceResponse.executedQty || buyMovement.quantity);
            const fills = buyMovement.binanceResponse.fills;

            // Calcular comisión total cobrada en BTC (activo base)
            const symbol = buyMovement.binanceResponse.symbol || process.env.BINANCE_SYMBOL || 'BTCUSDT';
            const baseAsset = symbol.replace('USDT', '').replace('BUSD', ''); // BTC

            const totalCommissionInBTC = fills.reduce((sum, fill) => {
                if (fill.commissionAsset === baseAsset) {
                    return sum + Number(fill.commission);
                }
                return sum;
            }, 0);

            if (totalCommissionInBTC > 0) {
                sellQuantity = executedQty - totalCommissionInBTC;
                this.logger.debug(`  ✅ Calculando cantidad neta:`);
                this.logger.debug(`     - executedQty: ${executedQty}`);
                this.logger.debug(`     - Comisión en ${baseAsset}: ${totalCommissionInBTC}`);
                this.logger.debug(`     - Cantidad neta disponible: ${sellQuantity}`);
            } else {
                this.logger.debug(`  ℹ️ Comisión no cobrada en ${baseAsset}, usando cantidad completa`);
            }
        } else {
            this.logger.warn(`  ⚠️ No hay fills disponibles en binanceResponse, usando quantity de DB`);
        }

        this.logger.debug(`  💰 Cantidad final a vender: ${sellQuantity}`);
        this.logger.debug(`  💰 Precio de venta: ${sellPrice}`);

        // Calcular valores para el movimiento de venta
        const totalAmount = sellPrice * sellQuantity;
        const commission = totalAmount * this.COMMISSION;
        const netAmount = totalAmount - commission;

        this.logger.debug(`  💰 Total venta: ${totalAmount}`);
        this.logger.debug(`  💰 Comisión estimada: ${commission}`);
        this.logger.debug(`  💰 Neto estimado: ${netAmount}`);

        const stopLossPercent = userStrategyConfig.sellMargin; // ej: 0.005 = 0.5%
        const useOCO = !this.PAPER_TRADING && stopLossPercent > 0;

        // Crear movimiento TP (take profit)
        const tpMovement = await this.signalDbService.createMovement({
            signalId: signal.id,
            type: MovementType.SELL,
            price: sellPrice,
            quantity: sellQuantity,
            totalAmount,
            commission,
            netAmount
        });

        await this.notifyOrderCreated({
            userId,
            userConfig: userStrategyConfig,
            side: 'SELL',
            orderType: useOCO ? 'OCO' : 'LIMIT',
            signalId: signal.id,
            symbol: signal.symbol,
            price: Number(sellPrice),
            quantity: sellQuantity,
            totalAmount,
            commission,
            stopLoss: Number(signal.stopLoss),
            takeProfit: Number(signal.takeProfit),
            movementStatus: tpMovement.status,
            paperTrading: this.PAPER_TRADING
        });

        // Ejecutar orden
        if (!this.PAPER_TRADING) {
            try {
                if (useOCO) {
                    // Precio de stop: precio de compra menos sellMargin
                    const buyPrice = Number(signal.initialPrice);
                    const stopPrice = buyPrice * (1 - stopLossPercent);
                    // stopLimitPrice 0.1% debajo del trigger para asegurar fill
                    const stopLimitPrice = stopPrice * 0.999;

                    // Crear movimiento SL en DB
                    const slTotalAmount = stopPrice * sellQuantity;
                    const slCommission = slTotalAmount * this.COMMISSION;
                    const slMovement = await this.signalDbService.createMovement({
                        signalId: signal.id,
                        type: MovementType.SELL,
                        price: stopPrice,
                        quantity: sellQuantity,
                        totalAmount: slTotalAmount,
                        commission: slCommission,
                        netAmount: slTotalAmount - slCommission
                    });

                    this.logger.log(`🛑 [Usuario ${userId}] OCO: TP=${Number(sellPrice).toFixed(2)} SL_trigger=${stopPrice.toFixed(2)} SL_limit=${stopLimitPrice.toFixed(2)}`);

                    await this.multiBinanceService.createOCOOrderForUser(userId, {
                        symbol: signal.symbol,
                        side: 'SELL',
                        quantity: sellQuantity,
                        price: Number(sellPrice),
                        stopPrice,
                        stopLimitPrice,
                        stopLimitTimeInForce: 'GTC'
                    }, tpMovement.id, slMovement.id);
                } else {
                    await this.multiBinanceService.createOrderForUser(userId, {
                        symbol: signal.symbol,
                        side: 'SELL',
                        type: 'LIMIT',
                        quantity: sellQuantity,
                        price: sellPrice,
                        timeInForce: 'GTC'
                    }, tpMovement.id);
                }
            } catch (error) {
                this.logger.error(`❌ [Usuario ${userId}] Error ejecutando orden de venta:`, error);
            }
        }

        // Incrementar contador del usuario
        const userConfigEntry = this.userConfigs.get(userId);
        if (userConfigEntry) {
            userConfigEntry.dailySignalCount++;
        }

        this.logger.log(`🔴 [Usuario ${userId}] SEÑAL DE VENTA creada para señal ${signal.id} (${useOCO ? 'OCO TP+SL' : 'LIMIT'})`);

        // Emitir evento
        this.emitTradeSignalForUser(userId, 'sell', candle.close, atr, signal.id, sellQuantity, signal.symbol);
    }


    private async tryCreateResidualSellForSignal(
        userId: string,
        userConfig: UserStrategyConfig,
        signalId: string,
        symbol: string,
        referencePrice: number
    ): Promise<void> {
        try {
            const signal = await this.signalDbService.getSignalById(signalId);
            if (!signal) return;

            const buyMovements = signal.movements.filter(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
            const sellMovements = signal.movements.filter(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED);
            const pendingSell = signal.movements.some(m => m.type === MovementType.SELL && m.status === MovementStatus.PENDING);

            if (buyMovements.length === 0 || pendingSell) {
                return;
            }

            const totalBoughtQty = buyMovements.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);
            const totalSoldQty = sellMovements.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);
            const residualQtyRaw = Math.max(0, totalBoughtQty - totalSoldQty);

            const stepSize = symbol === 'BTCUSDT' ? 0.00001 : 0.00000001;
            const minQty = symbol === 'BTCUSDT' ? 0.00001 : stepSize;
            const residualSellQty = Math.floor(residualQtyRaw / stepSize) * stepSize;
            const minNotional = Number(process.env.BINANCE_MIN_NOTIONAL || 5);
            const residualNotional = residualSellQty * referencePrice;

            if (residualSellQty < minQty) {
                if (residualQtyRaw > 0) {
                    this.logger.debug(`🧾 [Usuario ${userId}] Residual no vendible para ${signalId}: ${residualQtyRaw.toFixed(8)} (${symbol})`);
                    await this.notifyResidualNotSellable(
                        userId,
                        userConfig,
                        signalId,
                        symbol,
                        residualQtyRaw,
                        referencePrice,
                        'LOT_SIZE/MIN_QTY'
                    );
                }
                return;
            }

            if (residualNotional < minNotional) {
                this.logger.debug(`🧾 [Usuario ${userId}] Residual bajo MIN_NOTIONAL para ${signalId}: qty=${residualSellQty.toFixed(8)} notional=${residualNotional.toFixed(4)} < ${minNotional}`);
                await this.notifyResidualNotSellable(
                    userId,
                    userConfig,
                    signalId,
                    symbol,
                    residualSellQty,
                    referencePrice,
                    `MIN_NOTIONAL ${minNotional} USDT`
                );
                return;
            }

            this.logger.log(`♻️ [Usuario ${userId}] Creando venta residual automática para ${signalId}: qty=${residualSellQty.toFixed(8)} ${symbol}`);

            const totalAmount = referencePrice * residualSellQty;
            const commission = totalAmount * this.COMMISSION;
            const netAmount = totalAmount - commission;

            const residualMovement = await this.signalDbService.createMovement({
                signalId,
                type: MovementType.SELL,
                price: referencePrice,
                quantity: residualSellQty,
                totalAmount,
                commission,
                netAmount
            });

            await this.notifyOrderCreated({
                userId,
                userConfig,
                side: 'SELL',
                orderType: 'MARKET',
                signalId,
                symbol,
                price: referencePrice,
                quantity: residualSellQty,
                totalAmount,
                commission,
                stopLoss: Number(signal.stopLoss),
                takeProfit: Number(signal.takeProfit),
                movementStatus: residualMovement.status,
                paperTrading: this.PAPER_TRADING
            });

            if (!this.PAPER_TRADING) {
                await this.multiBinanceService.createOrderForUser(userId, {
                    symbol,
                    side: 'SELL',
                    type: 'MARKET',
                    quantity: residualSellQty
                }, residualMovement.id);
            }
        } catch (error) {
            this.logger.error(`❌ [Usuario ${userId}] Error creando venta residual automática:`, this.getErrorMessage(error));
        }
    }

    private async notifyResidualNotSellable(
        userId: string,
        userConfig: UserStrategyConfig,
        signalId: string,
        symbol: string,
        quantity: number,
        referencePrice: number,
        reason: string
    ): Promise<void> {
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return;
        }

        const amount = quantity * referencePrice;
        const asset = symbol.replace('USDT', '').replace('BUSD', '');
        const mode = this.PAPER_TRADING ? 'PAPER TRADING' : 'TRADING REAL';
        const timeText = new Date().toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const telegramMessage = [
            '🧾 <b>Residual No Vendible Automáticamente</b>',
            '',
            `👤 <b>Usuario:</b> ${userConfig.userEmail || userId}`,
            `📌 <b>Modo:</b> ${mode}`,
            `📈 <b>Par:</b> ${symbol}`,
            `🔗 <b>Signal ID:</b> ${signalId.substring(0, 8)}...`,
            '',
            `📦 <b>Residual:</b> ${quantity.toFixed(8)} ${asset}`,
            `💵 <b>Valor est.:</b> $${amount.toFixed(4)} USDT`,
            `⚠️ <b>Motivo:</b> ${reason}`,
            '',
            'ℹ️ El bot lo contempla en el P&L de cierre. Si querés limpiarlo, podés usar Convert Dust de Binance.',
            '',
            `🕒 ${timeText}`
        ].join('\n');

        const whatsappMessage = telegramMessage
            .replace(/<b>/g, '*')
            .replace(/<\/b>/g, '*');

        await Promise.allSettled([
            this.telegramService.sendSystemNotificationToUser(userId, telegramMessage),
            this.whatsappService.sendSystemNotificationToUser(userId, whatsappMessage)
        ]);
    }

    private emitTradeSignalForUser(userId: string, side: 'buy' | 'sell', price: number, atr: number, signalId: string, netQuantity?: number, symbol?: string) {
        const userConfig = this.userConfigs.get(userId);
        if (!userConfig) return;

        const stopLossPercent = (1.5 * atr) / price;
        const takeProfitPercent = (3 * atr) / price;

        const stopLoss = side === 'buy' ? price * (1 - stopLossPercent) : price * (1 + stopLossPercent);
        const takeProfit = side === 'buy' ? price * (1 + takeProfitPercent) : price * (1 - takeProfitPercent);
        let positionSize: number;
        if (side === 'buy') {
            positionSize = userConfig.capitalPerTrade / price;
        } else {
            positionSize = netQuantity || 0;
        }


        const tradeSignal: TradeSignal & { userId: string } = {
            id: signalId,
            userId,
            symbol: symbol || process.env.BINANCE_SYMBOL || 'BTCUSDT',
            price,
            size: positionSize,
            stopLoss,
            takeProfit,
            side,
            paperTrading: this.PAPER_TRADING,
        };

        this.logger.log(`📢 [Usuario ${userId}] Emitiendo señal ${side.toUpperCase()}: ${price} | ID: ${signalId}`);
        this.eventEmitter.emit(`trade.${side}.user`, tradeSignal);
    }

    private resetDailyCounters() {
        const today = new Date().toDateString();

        for (const [userId, config] of this.userConfigs.entries()) {
            if (config.lastResetDate !== today) {
                config.dailySignalCount = 0;
                config.lastResetDate = today;
                this.logger.debug(`🔄 [Usuario ${userId}] Contador diario reseteado`);
            }
        }
    }

    private async notifyOrderCreated(payload: {
        userId: string;
        userConfig: UserStrategyConfig;
        side: 'BUY' | 'SELL';
        orderType: 'MARKET' | 'LIMIT' | 'OCO';
        signalId: string;
        symbol: string;
        price: number;
        quantity: number;
        totalAmount: number;
        commission: number;
        stopLoss: number;
        takeProfit: number;
        movementStatus: MovementStatus;
        paperTrading: boolean;
    }): Promise<void> {
        const mode = payload.paperTrading ? 'PAPER TRADING' : 'TRADING REAL';
        const sideLabel = payload.side === 'BUY' ? 'COMPRA' : 'VENTA';
        const sideEmoji = payload.side === 'BUY' ? '🟢' : '🔴';
        const asset = payload.symbol.replace('USDT', '');
        const timeText = new Date().toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const telegramMessage = [
            `🧾 <b>Orden ${sideLabel} Generada</b>`,
            '',
            `👤 <b>Usuario:</b> ${payload.userConfig.userEmail || payload.userId}`,
            `📌 <b>Modo:</b> ${mode}`,
            `📈 <b>Par:</b> ${payload.symbol}`,
            `⚙️ <b>Tipo:</b> ${payload.orderType}`,
            `📊 <b>Estado:</b> ${payload.movementStatus}`,
            '',
            `${sideEmoji} <b>Precio:</b> $${payload.price.toFixed(2)} USDT`,
            `📦 <b>Cantidad:</b> ${payload.quantity.toFixed(6)} ${asset}`,
            `💵 <b>Monto:</b> $${payload.totalAmount.toFixed(2)} USDT`,
            `💸 <b>Comisión est.:</b> $${payload.commission.toFixed(4)} USDT`,
            `🛑 <b>Stop Loss:</b> $${payload.stopLoss.toFixed(2)} USDT`,
            `🎯 <b>Take Profit:</b> $${payload.takeProfit.toFixed(2)} USDT`,
            `🔗 <b>ID:</b> ${payload.signalId.substring(0, 8)}...`,
            '',
            `🕒 ${timeText}`
        ].join('\n');

        const whatsappMessage = telegramMessage
            .replace(/<b>/g, '*')
            .replace(/<\/b>/g, '*');

        await Promise.allSettled([
            this.telegramService.sendSystemNotificationToUser(payload.userId, telegramMessage),
            this.whatsappService.sendSystemNotificationToUser(payload.userId, whatsappMessage)
        ]);

        this.logger.log(`📲 [Usuario ${payload.userId}] Notificación de orden ${payload.side} enviada`);
    }

    private calculateTechnicalIndicators(closes: number[], highs: number[], lows: number[], volumes: number[], candles: indicators.Candle[]) {
        // Misma lógica que el servicio original, pero calculado una vez para todos los usuarios
        const smaShort = indicators.calculateSMA(closes, 9);
        const smaLong = indicators.calculateSMA(closes, 21);
        const smaVeryLong = indicators.calculateSMA(closes, 50);
        const emaShort = indicators.calculateEMA(closes, 12);
        const emaLong = indicators.calculateEMA(closes, 26);
        const rsi = indicators.calculateRSI(closes, 14);
        const macd = indicators.calculateMACD(closes);
        const atr = indicators.calculateATR(candles.slice(-20), 14);
        const bbands = indicators.calculateBollingerBands(closes, 20);
        const volumeMA = indicators.calculateSMA(volumes, 10);

        const allIndicators = [smaShort, smaLong, smaVeryLong, emaShort, emaLong, rsi, macd, atr, bbands, volumeMA];

        if (allIndicators.some(indicator => indicator === null)) {
            return null;
        }

        return {
            smaShort: smaShort!,
            smaLong: smaLong!,
            smaVeryLong: smaVeryLong!,
            emaShort: emaShort!,
            emaLong: emaLong!,
            rsi: rsi!,
            macd: macd!,
            atr: atr!,
            bbands: bbands!,
            volumeMA: volumeMA!,
            currentVolume: volumes[volumes.length - 1],
        };
    }

    private async validateSignalSafetyForUser(userId: string, side: 'buy' | 'sell', price: number, atr: number): Promise<boolean> {
        // Validaciones básicas de seguridad
        if (price <= 0) return false;

        const minPriceMovement = price * (2 * this.COMMISSION + this.MIN_PROFIT_MARGIN);
        if (side === 'buy' && atr < minPriceMovement * 0.1) {
            this.logger.debug(`📊 [Usuario ${userId}] ATR insuficiente para rentabilidad: ${atr} < ${minPriceMovement}`);
            return false;
        }

        return true;
    }

    // Método para agregar nuevos usuarios en runtime
    async addUser(userId: string): Promise<void> {
        const user = await this.userRepository.findOne({
            where: { id: userId, isActive: true }
        });

        if (!user) {
            throw new Error(`Usuario ${userId} no encontrado o inactivo`);
        }

        const config: UserStrategyConfig = {
            userId: user.id,
            userEmail: user.email,
            capitalForSignals: Number(user.capitalForSignals),
            capitalPerTrade: Number(user.capitalPerTrade),
            profitMargin: this.normalizeMargin(Number(user.profitMargin)),
            sellMargin: this.normalizeMargin(Number(user.sellMargin)),
            maxActiveSignals: user.maxActiveSignals,
            dailySignalCount: 0,
            lastResetDate: new Date().toDateString()
        };

        this.userConfigs.set(userId, config);
        this.logger.log(`✅ Configuración agregada para usuario ${user.email}`);
    }

    // Método para remover usuarios
    async removeUser(userId: string): Promise<void> {
        this.userConfigs.delete(userId);
        this.logger.log(`🗑️ Configuración removida para usuario ${userId}`);
    }

    // Método para recargar configuración de un usuario (útil si se actualiza en BD)
    async reloadUserConfig(userId: string): Promise<void> {
        const user = await this.userRepository.findOne({
            where: { id: userId, isActive: true }
        });

        if (!user) {
            throw new Error(`Usuario ${userId} no encontrado o inactivo`);
        }

        const config: UserStrategyConfig = {
            userId: user.id,
            userEmail: user.email,
            capitalForSignals: Number(user.capitalForSignals),
            capitalPerTrade: Number(user.capitalPerTrade),
            profitMargin: this.normalizeMargin(Number(user.profitMargin)),
            sellMargin: this.normalizeMargin(Number(user.sellMargin)),
            maxActiveSignals: user.maxActiveSignals,
            dailySignalCount: this.userConfigs.get(userId)?.dailySignalCount || 0,
            lastResetDate: this.userConfigs.get(userId)?.lastResetDate || new Date().toDateString()
        };

        this.userConfigs.set(userId, config);
        this.logger.log(`🔄 Configuración recargada para usuario ${user.email}:`);
        this.logger.log(`   💰 Capital por trade: ${config.capitalPerTrade} USDT`);
        this.logger.log(`   📊 Max señales activas: ${config.maxActiveSignals}`);
        this.logger.log(`   🎯 Profit margin: ${(config.profitMargin * 100).toFixed(2)}%`);
        this.logger.log(`   🛑 Stop loss margin: ${(config.sellMargin * 100).toFixed(2)}%`);
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}