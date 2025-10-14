import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
import * as indicators from '../../utils/indicators';

interface UserStrategyConfig {
    userId: string;
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
        @InjectRepository(User)
        private userRepository: Repository<User>
    ) {
        this.PAPER_TRADING = process.env.PAPER_TRADING !== 'false';
    }

    async onModuleInit() {
        const tradingMode = this.PAPER_TRADING ? 'PAPER TRADING' : 'TRADING REAL';
        this.logger.log(`🚀 Estrategia multi-usuario inicializada - Modo: ${tradingMode}`);
        await this.loadActiveUsers();
    }

    private async loadActiveUsers() {
        const activeUsers = await this.userRepository.find({
            where: { isActive: true }
        });

        this.logger.log(`📥 Cargando configuración para ${activeUsers.length} usuarios activos...`);

        for (const user of activeUsers) {
            const config: UserStrategyConfig = {
                userId: user.id,
                capitalForSignals: Number(user.capitalForSignals),
                capitalPerTrade: Number(user.capitalPerTrade),
                profitMargin: Number(user.profitMargin),
                sellMargin: Number(user.sellMargin),
                maxActiveSignals: user.maxActiveSignals,
                dailySignalCount: 0,
                lastResetDate: new Date().toDateString()
            };

            this.userConfigs.set(user.id, config);
            this.logger.log(`✅ Configuración cargada para usuario ${user.email}: Capital=${config.capitalPerTrade}, MaxSignals=${config.maxActiveSignals}`);
        }
    }

    async processCandle(candle: indicators.Candle) {
        // Resetear contadores diarios para todos los usuarios
        this.resetDailyCounters();

        // Añadir vela al cache de Redis
        await this.candleCacheService.addCandle(candle);

        const cacheInfo = await this.candleCacheService.getCacheInfo();

        if (cacheInfo.candleCount < 50) {
            this.logger.debug(`📊 Esperando más velas para análisis técnico: ${cacheInfo.candleCount}/50`);
            return;
        }

        // Obtener velas del cache
        const candles = await this.candleCacheService.getCandles();
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
            await this.processUserStrategy(userId, userConfig, candle, indicators, candles);
        }

        this.lastCandle = candle;
    }

    private async processUserStrategy(
        userId: string,
        userConfig: UserStrategyConfig,
        candle: indicators.Candle,
        techIndicators: any,
        candles: indicators.Candle[]
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
                    const orderStatus = await this.multiBinanceService.getOrderStatus(signal.symbol, Number(buyPendingMovement.binanceOrderId), userId);
                    console.log('orderStatus', orderStatus);
                    if (orderStatus.status === 'FILLED') {
                        await this.signalDbService.updateMovementStatus(buyPendingMovement.id, MovementStatus.FILLED, { binanceResponse: orderStatus });
                        this.logger.debug(`✅ [Usuario ${userId}] BUY completado para ${signal.symbol}`);
                    }
                }

                // ✅ 2. Actualizar SELL pendientes
                if (sellPendingMovement) {
                    hasPendingSell = true;
                    const orderStatus = await this.multiBinanceService.getOrderStatus(signal.symbol, Number(sellPendingMovement.binanceOrderId), userId);
                    if (orderStatus.status === 'FILLED') {
                        await this.signalDbService.updateMovementStatus(sellPendingMovement.id, MovementStatus.FILLED, { binanceResponse: orderStatus });
                        await this.signalDbService.updateStatusSignal(signal.id, SignalStatus.MATCHED);
                        this.logger.debug(`💰 [Usuario ${userId}] SELL completado para ${signal.symbol}`);
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
                hasPendingSell
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
        hasPendingSell: boolean // 👈 nuevo
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
            });
        }
        const signalsReadyToSell = activeSignals.filter(s => s["readyToSell"]);
        this.logger.debug(`📊 [Usuario ${userId}] Señales listas para vender: ${signalsReadyToSell.length}`);
        if (signalsReadyToSell.length > 0) {
            this.logger.debug(`📈 [Usuario ${userId}] Tiene ${signalsReadyToSell.length} señales con BUY FILLED listas para vender.`);
            await this.evaluateSellSignalsForUser(userId, userConfig, lastCandle, atr, signalsReadyToSell);
        }

        // 🔴 Evaluar ventas solo si NO hay una venta pendiente
        if (!hasPendingSell) {
            await this.evaluateSellSignalsForUser(userId, userConfig, lastCandle, atr, activeSignals);
        } else {
            this.logger.debug(`⏸️ [Usuario ${userId}] Tiene una venta pendiente, no se evaluarán nuevas señales SELL.`);
        }
    }


    private async evaluateBuySignalsForUser(
        userId: string,
        userConfig: UserStrategyConfig,
        candle: indicators.Candle,
        analysis: any
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
                this.logger.log(`🟢 [Usuario ${userId}] GENERANDO SEÑAL DE COMPRA a ${candle.close}`);
                await this.createBuySignalForUser(userId, userConfig, candle, atr, smaShort, smaLong, rsi, latestMACD, currentVolume);
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
        // Verificar señales de compra para vender (específicas del usuario)
        const buySignals = activeSignals.filter(signal =>
            signal.movements.some(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED) &&
            !signal.movements.some(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED)
        );

        if (buySignals.length === 0) {
            return;
        }

        this.logger.debug(`🔍 [Usuario ${userId}] Evaluando señales de VENTA para ${buySignals.length} posición(es) activa(s)`);

        for (const signal of buySignals) {
            const buyMovement = signal.movements.find(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
            if (!buyMovement) continue;
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
        volume: number
    ) {
        const stopLossPercent = (1.5 * atr) / candle.close;
        const takeProfitPercent = (3 * atr) / candle.close;

        const stopLoss = candle.close * (1 - stopLossPercent);
        const takeProfit = candle.close * (1 + takeProfitPercent);

        // Usar el capital personalizado del usuario
        const rawPositionSize = userConfig.capitalPerTrade / candle.close;
        const positionSize = Math.max(0.00001, Math.floor(rawPositionSize / 0.00001) * 0.00001);

        // Crear señal en base de datos con userId
        const signal = await this.signalDbService.createSignalForUser(userId, {
            symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
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

        // Ejecutar orden si no es paper trading
        if (!this.PAPER_TRADING) {
            try {
                await this.multiBinanceService.createOrderForUser(userId, {
                    symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
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
        this.emitTradeSignalForUser(userId, 'buy', candle.close, atr, signal.id);
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

        // Cantidad comprada bruta
        const buyQuantity = Number(buyMovement.quantity);

        const netQuantity = buyQuantity * (1 - this.COMMISSION); // 👈 se descuenta la comisión real
        const sellPrice = signal.takeProfit;

        // Crear movimiento de venta
        const sellMovement = await this.signalDbService.createMovement({
            signalId: signal.id,
            type: MovementType.SELL,
            price: sellPrice,
            quantity: netQuantity,
            totalAmount: sellPrice * buyQuantity,
            commission: sellPrice * buyQuantity * this.COMMISSION,
            netAmount: sellPrice * buyQuantity - sellPrice * buyQuantity * this.COMMISSION
        });

        // Ejecutar orden si no es paper trading
        if (!this.PAPER_TRADING) {
            try {
                await this.multiBinanceService.createOrderForUser(userId, {
                    symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
                    side: 'SELL',
                    type: 'LIMIT',
                    quantity: netQuantity,
                    price: sellPrice,
                    timeInForce: 'GTC'
                }, sellMovement.id); // Pasar el ID del movimiento para actualizar con datos de Binance
            } catch (error) {
                this.logger.error(`❌ [Usuario ${userId}] Error ejecutando orden de venta:`, error);
            }
        }

        // Incrementar contador del usuario
        const userConfigEntry = this.userConfigs.get(userId);
        if (userConfigEntry) {
            userConfigEntry.dailySignalCount++;
        }

        this.logger.log(`🔴 [Usuario ${userId}] SEÑAL DE VENTA creada para señal ${signal.id}`);

        // Emitir evento
        this.emitTradeSignalForUser(userId, 'sell', candle.close, atr, signal.id, netQuantity);
    }

    private emitTradeSignalForUser(userId: string, side: 'buy' | 'sell', price: number, atr: number, signalId: string, netQuantity?: number) {
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
            symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
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
            capitalForSignals: Number(user.capitalForSignals),
            capitalPerTrade: Number(user.capitalPerTrade),
            profitMargin: Number(user.profitMargin),
            sellMargin: Number(user.sellMargin),
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
}