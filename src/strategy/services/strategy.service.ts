import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as indicators from 'src/utils/indicators';
import { TradeSignal } from '../interfaces/traide-signal.interface';
import { StrategyCallback } from '../interfaces/strategy-callback.interface';
import { SignalDatabaseService } from './signal-database.service';
import { CandleCacheService } from './candle-cache.service';
import { Signal, SignalStatus } from '../entities/signal.entity';
import { MovementType, MovementStatus } from '../entities/movement.entity';
import { BinanceService } from '../../binance/services/binance.service';

@Injectable()
export class StrategyService implements OnModuleInit, StrategyCallback {
    private readonly logger = new Logger(StrategyService.name);
    private lastCandle: indicators.Candle | null = null;
    private readonly capital = 100; // Capital inicial
    private readonly capitalPerTrade = 20; // 20 USD de capital por operación
    private readonly COMMISSION = 0.001; // 0.1% comisión de Binance
    private readonly MIN_PROFIT_MARGIN = 0.005; // 0.5% margen mínimo de ganancia (más conservador)
    private readonly QUICK_SELL_MARGIN = 0.004; // 0.4% margen para venta rápida (MÁS CONSERVADOR)
    private readonly HIGH_VOLATILITY_THRESHOLD = 1.5; // 1.5% threshold (MÁS CONSERVADOR)
    private readonly ULTRA_CONSERVATIVE_MODE = true; // Modo ultra conservador
    private readonly PAPER_TRADING: boolean; // true = paper trading, false = trading real

    // Limitaciones para control de riesgo
    private readonly maxActiveSignals = 2; // REDUCIDO para menos exposición
    private readonly maxDailySignals = 6; // REDUCIDO para controlar volumen diario
    private dailySignalCount = 0;
    private lastResetDate = new Date().toDateString();
    // Nota: Las señales activas se obtienen de la base de datos, no se mantienen en memoria
    // Nota: Las velas ahora se almacenan en Redis a través de CandleCacheService

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly signalDbService: SignalDatabaseService,
        private readonly candleCacheService: CandleCacheService,
        private readonly binanceService: BinanceService
    ) {
        // Leer configuración de trading real/paper desde variables de entorno
        this.PAPER_TRADING = process.env.PAPER_TRADING !== 'false';
    }

    onModuleInit() {
        const tradingMode = this.PAPER_TRADING ? 'PAPER TRADING' : 'TRADING REAL';
        this.logger.log(`🚀 Estrategia de trading inicializada con control de riesgo avanzado - Modo: ${tradingMode}`);
        this.resetDailyCounters();
    }

    private resetDailyCounters() {
        const today = new Date().toDateString();
        if (this.lastResetDate !== today) {
            this.dailySignalCount = 0;
            this.lastResetDate = today;
            this.logger.log('📅 Contadores diarios reseteados');
        }
    }

    async processCandle(candle: indicators.Candle) {
        this.resetDailyCounters();

        // Añadir vela al cache de Redis
        await this.candleCacheService.addCandle(candle);

        // Obtener información del cache
        const cacheInfo = await this.candleCacheService.getCacheInfo();
        this.logger.debug(`📊 Procesando vela: ${candle.close} | Total velas en cache: ${cacheInfo.candleCount}`);

        // Necesitamos al menos 50 velas para análisis técnico sólido (SMA 50 + buffer para MACD)
        if (cacheInfo.candleCount < 50) {
            this.logger.debug(`⏳ Esperando más datos para análisis técnico completo (${cacheInfo.candleCount}/50)`);
            return;
        }

        // Verificar límites diarios
        if (this.dailySignalCount >= this.maxDailySignals) {
            this.logger.debug('Límite diario de señales alcanzado');
            return;
        }

        const activeSignals = await this.signalDbService.getActiveSignals();
        this.logger.debug(`📊 Señales obtenidas de getActiveSignals(): ${activeSignals.length}`);

        // Log detallado de las señales activas
        for (const signal of activeSignals) {
            const buyFilled = signal.movements.filter(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED).length;
            const sellFilled = signal.movements.filter(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED).length;
            this.logger.debug(`  📊 Señal ${signal.id}: BUY_FILLED=${buyFilled}, SELL_FILLED=${sellFilled}, Status=${signal.status}`);
        }

        // Verificar si podemos crear nuevas señales de compra
        const canCreateNewSignals = activeSignals.length < this.maxActiveSignals;
        if (!canCreateNewSignals) {
            this.logger.debug(`❌ Límite de señales activas alcanzado: ${activeSignals.length}/${this.maxActiveSignals} - Solo evaluaremos ventas`);
        }

        // Obtener velas del cache de Redis
        const candles = await this.candleCacheService.getCandles();

        const closes = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);
        const volumes = candles.map((c) => c.volume);

        this.logger.debug(`🔢 Arrays creados - closes: ${closes.length}, highs: ${highs.length}, lows: ${lows.length}, volumes: ${volumes.length}`);

        // Verificar que los datos sean válidos
        const hasValidCloses = closes.every(c => typeof c === 'number' && !isNaN(c) && c > 0);
        const hasValidHighs = highs.every(h => typeof h === 'number' && !isNaN(h) && h > 0);
        const hasValidLows = lows.every(l => typeof l === 'number' && !isNaN(l) && l > 0);
        const hasValidVolumes = volumes.every(v => typeof v === 'number' && !isNaN(v) && v >= 0);

        this.logger.debug(`✅ Validación de datos - closes: ${hasValidCloses}, highs: ${hasValidHighs}, lows: ${lows.length}, volumes: ${hasValidVolumes}`);

        if (!hasValidCloses || !hasValidHighs || !hasValidLows || !hasValidVolumes) {
            this.logger.error('❌ Datos de velas inválidos detectados');
            this.logger.error(`📊 Últimas 3 velas:`, candles.slice(-3));
            return;
        }

        // Calcular indicadores técnicos
        const indicators = this.calculateTechnicalIndicators(closes, highs, lows, volumes, candles);

        if (!indicators) {
            this.logger.debug('❌ No se pudieron calcular todos los indicadores');
            return;
        }

        this.logger.debug('✅ Todos los indicadores calculados correctamente');

        // Análisis de mercado y generación de señales
        await this.analyzeMarketConditions(candle, indicators, activeSignals, candles, canCreateNewSignals);

        this.lastCandle = candle;
    }

    private calculateTechnicalIndicators(closes: number[], highs: number[], lows: number[], volumes: number[], candles: indicators.Candle[]) {
        this.logger.debug(`🔍 Calculando indicadores con ${closes.length} velas`);
        this.logger.debug(`📊 Datos disponibles: closes=${closes.length}, highs=${highs.length}, lows=${lows.length}, volumes=${volumes.length}, candles=${candles.length}`);

        const smaShort = indicators.calculateSMA(closes, 9);
        this.logger.debug(`SMA Short (9): ${smaShort !== null ? 'OK' : 'NULL'}`);

        const smaLong = indicators.calculateSMA(closes, 21);
        this.logger.debug(`SMA Long (21): ${smaLong !== null ? 'OK' : 'NULL'}`);

        const smaVeryLong = indicators.calculateSMA(closes, 50);
        this.logger.debug(`SMA Very Long (50): ${smaVeryLong !== null ? 'OK' : 'NULL'}`);

        const emaShort = indicators.calculateEMA(closes, 12);
        this.logger.debug(`EMA Short (12): ${emaShort !== null ? 'OK' : 'NULL'}`);

        const emaLong = indicators.calculateEMA(closes, 26);
        this.logger.debug(`EMA Long (26): ${emaLong !== null ? 'OK' : 'NULL'}`);

        const rsi = indicators.calculateRSI(closes, 14);
        this.logger.debug(`RSI (14): ${rsi !== null ? 'OK' : 'NULL'}`);

        const macd = indicators.calculateMACD(closes);
        this.logger.debug(`MACD: ${macd !== null ? 'OK' : 'NULL'}`);

        const atr = indicators.calculateATR(candles.slice(-20), 14); // Usar 20 velas para ATR con período 14
        this.logger.debug(`ATR: ${atr !== null ? 'OK' : 'NULL'} (usando ${candles.slice(-20).length} velas de ${candles.length} disponibles)`);

        const bbands = indicators.calculateBollingerBands(closes, 20);
        this.logger.debug(`Bollinger Bands (20): ${bbands !== null ? 'OK' : 'NULL'}`);

        const volumeMA = indicators.calculateSMA(volumes, 10);
        this.logger.debug(`Volume MA (10): ${volumeMA !== null ? 'OK' : 'NULL'}`);

        // Verificar que todos los indicadores estén disponibles
        const indicatorNames = ['SMA Short', 'SMA Long', 'SMA Very Long', 'EMA Short', 'EMA Long', 'RSI', 'MACD', 'ATR', 'Bollinger Bands', 'Volume MA'];
        const allIndicators = [smaShort, smaLong, smaVeryLong, emaShort, emaLong, rsi, macd, atr, bbands, volumeMA];
        const nullIndicators: string[] = [];

        for (let i = 0; i < allIndicators.length; i++) {
            if (allIndicators[i] === null) {
                nullIndicators.push(indicatorNames[i]);
            }
        }

        if (nullIndicators.length > 0) {
            this.logger.debug(`❌ ${nullIndicators.length} indicadores retornaron NULL: ${nullIndicators.join(', ')}`);
            this.logger.debug(`📈 Últimos precios: ${closes.slice(-5).join(', ')}`);
            this.logger.debug(`📊 Últimos volúmenes: ${volumes.slice(-5).join(', ')}`);
            this.logger.debug(`🕐 Datos disponibles: ${closes.length} closes, ${candles.length} velas`);
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

    private async analyzeMarketConditions(
        candle: indicators.Candle,
        techIndicators: any,
        activeSignals: Signal[],
        candles: indicators.Candle[],
        canCreateNewSignals: boolean
    ) {
        const {
            smaShort, smaLong, smaVeryLong, emaShort, emaLong, rsi, macd, atr, bbands, volumeMA, currentVolume
        } = techIndicators;

        const { macdLine, signalLine, histogram } = macd;
        const latestMACD = macdLine[macdLine.length - 1];
        const latestSignal = signalLine[signalLine.length - 1];
        const latestHistogram = histogram[histogram.length - 1];

        this.logger.debug(`📈 Indicadores técnicos para precio ${candle.close}:`);
        this.logger.debug(`  📊 SMAs: Short=${smaShort.toFixed(2)}, Long=${smaLong.toFixed(2)}, VeryLong=${smaVeryLong.toFixed(2)}`);
        this.logger.debug(`  📊 EMAs: Short=${emaShort.toFixed(2)}, Long=${emaLong.toFixed(2)}`);
        this.logger.debug(`  📊 RSI: ${rsi.toFixed(1)}`);
        this.logger.debug(`  📊 MACD: Line=${latestMACD.toFixed(4)}, Signal=${latestSignal.toFixed(4)}, Hist=${latestHistogram.toFixed(4)}`);
        this.logger.debug(`  📊 BB: Upper=${bbands.upper.toFixed(2)}, Middle=${bbands.middle.toFixed(2)}, Lower=${bbands.lower.toFixed(2)}`);
        this.logger.debug(`  📊 Volume: Current=${currentVolume.toFixed(2)}, MA=${volumeMA.toFixed(2)}`);
        this.logger.debug(`  📊 ATR: ${atr.toFixed(2)}`);

        // Determinar tendencia principal
        const isStrongUptrend = smaShort > smaLong && smaLong > smaVeryLong && emaShort > emaLong;
        const isStrongDowntrend = smaShort < smaLong && smaLong < smaVeryLong && emaShort < emaLong;
        const isRangeMarket = !isStrongUptrend && !isStrongDowntrend;

        this.logger.debug(`📈 Análisis de tendencia: Uptrend=${isStrongUptrend}, Downtrend=${isStrongDowntrend}, Range=${isRangeMarket}`);

        // Análisis de velas
        const bullishEngulfing = indicators.isBullishEngulfing(candles);
        const bearishEngulfing = indicators.isBearishEngulfing(candles);
        const priceNearBBLower = candle.close <= bbands.lower * 1.005;
        const priceNearBBUpper = candle.close >= bbands.upper * 0.995;

        this.logger.debug(`📊 Patrones de velas: BullishEngulfing=${bullishEngulfing}, BearishEngulfing=${bearishEngulfing}`);
        this.logger.debug(`📊 Posición BB: NearLower=${priceNearBBLower}, NearUpper=${priceNearBBUpper}`);

        // Análisis de volumen
        const volumeAboveAverage = currentVolume > volumeMA * 1.2;
        const volumeConfirmation = volumeAboveAverage;

        this.logger.debug(`📊 Volumen: AboveAverage=${volumeAboveAverage} (requiere > ${(volumeMA * 1.2).toFixed(2)})`);
        this.logger.debug(`📊 Señales activas: ${activeSignals.length}`);

        // Buscar señales de compra (solo si podemos crear nuevas)
        if (canCreateNewSignals) {
            await this.evaluateBuySignals(candle, {
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
                currentVolume: currentVolume,
                volumeMA: volumeMA
            }, activeSignals);
        } else {
            this.logger.debug(`🔍 Omitiendo evaluación de compras - límite de señales alcanzado`);
        }

        // Buscar señales de venta (SIEMPRE evaluar ventas)
        await this.evaluateSellSignals(candle, {
            isStrongDowntrend,
            isRangeMarket,
            rsi,
            latestMACD,
            latestSignal,
            latestHistogram,
            bearishEngulfing,
            priceNearBBUpper,
            volumeConfirmation,
            atr,
            smaShort,
            smaLong,
            currentVolume: currentVolume
        }, activeSignals);
    }

    private async evaluateBuySignals(candle: indicators.Candle, analysis: any, activeSignals: Signal[]) {
        const {
            isStrongUptrend, isRangeMarket, rsi, latestMACD, latestSignal, latestHistogram,
            bullishEngulfing, priceNearBBLower, volumeConfirmation, atr, smaShort, smaLong, currentVolume
        } = analysis;

        this.logger.debug(`🔍 Evaluando señales de COMPRA para precio ${candle.close}`);

        // Verificar cuántas señales de compra activas tenemos (señales con compra pero sin venta)
        const activeBuySignals = activeSignals.filter(signal => {
            const hasBuy = signal.movements.some(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
            const hasSell = signal.movements.some(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED);
            return hasBuy && !hasSell; // Tiene compra ejecutada pero no venta
        });

        this.logger.debug(`📊 Señales de compra activas: ${activeBuySignals.length}/${this.maxActiveSignals}`);

        if (activeBuySignals.length >= this.maxActiveSignals) {
            this.logger.debug(`❌ Límite de señales de compra activas alcanzado: ${activeBuySignals.length}/${this.maxActiveSignals}`);
            return;
        }

        // Condiciones estrictas para señal de compra
        const condition1 = isStrongUptrend || (isRangeMarket && latestMACD > latestSignal);
        const condition2 = rsi >= 25 && rsi <= 65;
        const condition3 = latestMACD > latestSignal || latestHistogram > 0;
        const condition4 = bullishEngulfing || candle.close > candle.open;
        const condition5 = priceNearBBLower || candle.close < smaShort;
        const condition6 = volumeConfirmation;
        const condition7 = candle.close > smaLong * 0.995;

        const buyConditions = [condition1, condition2, condition3, condition4, condition5, condition6, condition7];

        // Log detallado de cada condición
        this.logger.debug(`📊 Análisis de condiciones de COMPRA:`);
        this.logger.debug(`  1. Tendencia/Momentum: ${condition1} (uptrend=${isStrongUptrend}, range+MACD=${isRangeMarket && latestMACD > latestSignal})`);
        this.logger.debug(`  2. RSI válido (25-65): ${condition2} (RSI=${rsi.toFixed(1)})`);
        this.logger.debug(`  3. MACD positivo: ${condition3} (MACD=${latestMACD.toFixed(4)} vs Signal=${latestSignal.toFixed(4)}, Hist=${latestHistogram.toFixed(4)})`);
        this.logger.debug(`  4. Vela alcista: ${condition4} (engulfing=${bullishEngulfing}, close>open=${candle.close > candle.open})`);
        this.logger.debug(`  5. Precio cerca soporte: ${condition5} (nearBBLower=${priceNearBBLower}, close<SMA=${candle.close < smaShort})`);
        this.logger.debug(`  6. Volumen confirmación: ${condition6} (vol=${currentVolume.toFixed(2)}, requiere>${(analysis.volumeMA * 1.2).toFixed(2)})`);
        this.logger.debug(`  7. Precio sobre SMA larga: ${condition7} (${candle.close} > ${(smaLong * 0.995).toFixed(2)})`);

        const passedConditions = buyConditions.filter(Boolean).length;
        this.logger.debug(`📈 Resultado: ${passedConditions}/7 condiciones cumplidas`);

        // Necesitamos al menos 5 de 7 condiciones para generar señal
        if (passedConditions >= 5) {
            this.logger.log(`🟢 Evaluando señal de COMPRA: ${passedConditions}/7 condiciones cumplidas`);

            if (await this.validateSignalSafety('buy', candle.close, atr)) {
                await this.createBuySignal(candle, atr, smaShort, smaLong, rsi, latestMACD, currentVolume);
            } else {
                this.logger.debug(`❌ Señal de compra falló validación de seguridad`);
            }
        } else {
            this.logger.debug(`❌ Insuficientes condiciones para señal de compra: ${passedConditions}/7 (requiere >= 5)`);
        }
    }

    private async evaluateSellSignals(candle: indicators.Candle, analysis: any, activeSignals: Signal[]) {
        const {
            isStrongDowntrend, isRangeMarket, rsi, latestMACD, latestSignal, latestHistogram,
            bearishEngulfing, priceNearBBUpper, volumeConfirmation, atr, smaShort, smaLong, currentVolume
        } = analysis;

        // Verificar que tengamos señales de compra para vender (señales con compra ejecutada pero sin venta)
        const buySignals = activeSignals.filter(signal => {
            const hasBuy = signal.movements.some(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
            const hasSell = signal.movements.some(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED);
            return hasBuy && !hasSell; // Tiene compra ejecutada pero no venta
        });

        if (buySignals.length === 0) {
            this.logger.debug(`🔍 No hay señales de compra activas para evaluar venta`);
            return; // No tenemos nada que vender
        }

        this.logger.debug(`🔍 Evaluando señales de VENTA para ${buySignals.length} posición(es) activa(s)`);

        // Para cada señal de compra, evaluar si es momento de vender
        for (const signal of buySignals) {
            const buyPrice = signal.initialPrice;

            // 🧠 HÍBRIDO INTELIGENTE: Determinar estrategia según condiciones
            const strategy = this.determineSellingStrategy(atr, candle.close, buyPrice, {
                isStrongUptrend: isStrongDowntrend ? false : (isRangeMarket ? false : true),
                isStrongDowntrend,
                rsi,
                latestHistogram
            });

            this.logger.debug(`📊 Señal ${signal.id}: Estrategia=${strategy}, Precio compra=${buyPrice}, Precio actual=${candle.close}`);

            // Calcular precios mínimos según estrategia
            let minSellPrice: number;
            let strategyName: string;

            switch (strategy) {
                case 'immediate':
                    // Venta rápida con margen mínimo
                    minSellPrice = buyPrice * (1 + 2 * this.COMMISSION + this.QUICK_SELL_MARGIN);
                    strategyName = 'VENTA RÁPIDA';
                    break;

                case 'hold_trend':
                    // Mantener posición hasta ganancia mayor
                    minSellPrice = buyPrice * (1 + 2 * this.COMMISSION + this.MIN_PROFIT_MARGIN * 1.5);
                    strategyName = 'MANTENER TENDENCIA';
                    break;

                case 'wait_for_profit':
                default:
                    // Estrategia normal
                    minSellPrice = buyPrice * (1 + 2 * this.COMMISSION + this.MIN_PROFIT_MARGIN);
                    strategyName = 'ESPERAR GANANCIA';
                    break;
            }

            this.logger.debug(`📊 ${strategyName}: Precio mín. venta=${minSellPrice.toFixed(2)} para señal ${signal.id}`);

            // Solo vender si alcanzamos el precio objetivo según la estrategia
            if (candle.close <= minSellPrice) {
                this.logger.debug(`❌ ${strategyName}: Precio ${candle.close} no supera mínimo ${minSellPrice.toFixed(2)}`);
                continue;
            }

            // ✅ LÓGICA SIMPLIFICADA DE VENTA: Si hay ganancia, VENDER
            const profitPercent = ((candle.close - buyPrice) / buyPrice) * 100;
            const positionSize = this.capitalPerTrade / buyPrice; // Cantidad de la posición
            const grossProfit = (candle.close - buyPrice) * positionSize; // Ganancia bruta en USD
            const buyCommission = (buyPrice * positionSize) * this.COMMISSION; // Comisión de compra
            const sellCommission = (candle.close * positionSize) * this.COMMISSION; // Comisión de venta
            const totalCommissions = buyCommission + sellCommission; // Comisiones totales
            const netProfitUSD = grossProfit - totalCommissions; // Ganancia neta en USD

            this.logger.log(`💰 ${strategyName} - GANANCIA DETECTADA: ${profitPercent.toFixed(3)}%`);
            this.logger.log(`💲 Ganancia bruta: $${grossProfit.toFixed(2)} USD | Comisiones: $${totalCommissions.toFixed(4)} USD | Ganancia NETA: $${netProfitUSD.toFixed(2)} USD`);
            this.logger.debug(`📊 Precio compra: ${buyPrice}, Precio actual: ${candle.close}, Tamaño posición: ${positionSize.toFixed(6)}`);
            this.logger.debug(`📊 Estrategia aplicada: ${strategyName}, Precio mínimo requerido: ${minSellPrice.toFixed(2)}`);

            // Validar que la venta sea segura (evitar errores técnicos)
            if (await this.validateSignalSafety('sell', candle.close, atr)) {
                this.logger.log(`✅ EJECUTANDO ${strategyName} - Ganancia neta asegurada: $${netProfitUSD.toFixed(2)} USD`);
                await this.createSellSignal(candle, atr, smaShort, smaLong, rsi, latestMACD, currentVolume, signal.id);
            } else {
                this.logger.debug(`❌ ${strategyName} falló validación de seguridad técnica`);
            }
        }
    }

    private async preValidateSignal(
        side: 'buy' | 'sell',
        price: number,
        atr: number,
    ): Promise<boolean> {
        this.logger.debug(`🔍 Pre-validando señal ${side} a precio ${price} con ATR ${atr.toFixed(2)}`);

        // Obtener velas del cache
        const candles = await this.candleCacheService.getCandles();
        const minCandlesBeforeSignal = 10;

        if (candles.length < minCandlesBeforeSignal) {
            this.logger.debug(`❌ Insuficientes velas para señal: ${candles.length}/${minCandlesBeforeSignal}`);
            return false;
        }

        // Evitar señales demasiado seguidas del mismo tipo
        // Esta validación se simplifica ya que usamos base de datos para controlar activas
        const cooldownBars = 5;

        // Validación simplificada basada en las últimas velas
        if (candles.length >= cooldownBars) {
            const recentPriceChanges = candles.slice(-cooldownBars).map(c => c.close);
            const volatility = Math.max(...recentPriceChanges) - Math.min(...recentPriceChanges);
            if (volatility < atr * 0.5) {
                this.logger.debug(`❌ Señal ${side} descartada: baja volatilidad reciente (${volatility.toFixed(2)} < ${(atr * 0.5).toFixed(2)})`);
                return false;
            }
        }

        // Revisar drawdown histórico: que en las últimas velas no haya caídas fuertes > 2*ATR
        const recentCandles = candles.slice(-minCandlesBeforeSignal);
        for (let i = 1; i < recentCandles.length; i++) {
            const drop = recentCandles[i - 1].close - recentCandles[i].close;
            if (drop > 2 * atr) {
                this.logger.debug(`❌ Señal ${side} descartada: caída brusca previa (${drop.toFixed(2)} > ${(2 * atr).toFixed(2)})`);
                return false;
            }
        }

        // Confirmación técnica adicional: RSI en rangos apropiados
        const closes = candles.map(c => c.close);
        const rsi = indicators.calculateRSI(closes, 14);

        if (rsi === null) {
            this.logger.debug(`❌ No se pudo calcular RSI para pre-validación`);
            return false;
        }

        // Para compras: RSI no debe estar en extremos (ni muy sobrevendido ni muy sobrecomprado)
        if (side === 'buy' && (rsi < 25 || rsi > 75)) {
            this.logger.debug(`❌ Señal BUY descartada: RSI en extremo (${rsi.toFixed(1)}) - requiere 25-75`);
            return false;
        }

        // Para ventas: Validación mínima, si hay ganancia asegurada, vender
        // Solo evitar vender si RSI está extremadamente bajo (posible rebote inmediato)
        if (side === 'sell' && rsi < 20) {
            this.logger.debug(`❌ Señal SELL descartada: RSI extremadamente bajo (${rsi.toFixed(1)}) - posible rebote inmediato`);
            return false;
        }

        // Validación de riesgo: el tamaño de la posición no debe ser demasiado grande (ej: > 10 unidades)
        const positionSize = this.capitalPerTrade / price;
        if (positionSize > 20) {
            this.logger.debug(`❌ Señal ${side} descartada: tamaño de posición excesivo (${positionSize.toFixed(2)} > 20)`);
            return false;
        }

        this.logger.debug(`✅ Pre-validación exitosa para señal ${side}`);
        return true;
    }

    private async validateSignalSafety(
        side: 'buy' | 'sell',
        price: number,
        atr: number
    ): Promise<boolean> {
        this.logger.debug(`🔒 Validando seguridad de señal ${side} a precio ${price}`);

        // Validaciones básicas
        if (!(await this.preValidateSignal(side, price, atr))) {
            this.logger.debug(`❌ Falló pre-validación de señal ${side}`);
            return false;
        }

        // Verificar que el precio sea válido
        if (price <= 0) {
            this.logger.debug(`❌ Señal ${side} descartada: precio inválido ${price}`);
            return false;
        }

        // Verificar spread mínimo (diferencia entre compra y venta debe ser rentable)
        // El ATR debe ser suficiente para movimientos que cubran comisiones y margen mínimo
        const minPriceMovement = price * (2 * this.COMMISSION + this.MIN_PROFIT_MARGIN);

        // Para VENTAS con ganancia ya detectada, NO validar ATR
        if (side === 'sell') {
            // Para ventas con ganancia confirmada, saltear validación ATR
            this.logger.debug(`✅ SELL: Saltando validación ATR - Ganancia ya confirmada`);
        } else {
            // Para COMPRAS, mantener validación más estricta
            if (atr < minPriceMovement * 0.1) { // ATR debe ser al menos 10% del movimiento mínimo requerido
                this.logger.debug(`❌ Señal BUY descartada: ATR extremadamente bajo (ATR=${atr.toFixed(2)}, requiere>${(minPriceMovement * 0.1).toFixed(2)})`);
                return false;
            }
        }

        // Verificar que no tengamos demasiadas señales activas del mismo tipo
        const activeSignals = await this.signalDbService.getActiveSignals();

        if (side === 'buy') {
            const activeBuySignals = activeSignals.filter(signal => {
                const hasBuy = signal.movements.some(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
                const hasSell = signal.movements.some(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED);
                return hasBuy && !hasSell;
            });

            if (activeBuySignals.length >= this.maxActiveSignals) {
                this.logger.debug(`❌ Señal ${side} descartada: demasiadas señales de compra activas (${activeBuySignals.length}/${this.maxActiveSignals})`);
                return false;
            }
        }

        this.logger.debug(`✅ Señal ${side} pasó todas las validaciones de seguridad`);
        return true;
    }

    private determineSellingStrategy(
        atr: number,
        currentPrice: number,
        buyPrice: number,
        analysis: any
    ): 'immediate' | 'wait_for_profit' | 'hold_trend' {
        const { isStrongUptrend, isStrongDowntrend, rsi, latestHistogram } = analysis;

        // Calcular volatilidad relativa (ATR como % del precio)
        const volatilityPercent = (atr / currentPrice) * 100;
        const currentProfit = ((currentPrice - buyPrice) / buyPrice) * 100;

        this.logger.debug(`📊 Análisis estrategia de venta: ATR=${atr.toFixed(2)}, Volatilidad=${volatilityPercent.toFixed(2)}%, Ganancia actual=${currentProfit.toFixed(3)}%`);

        // 🛡️ MODO ULTRA CONSERVADOR: Priorizar ventas rápidas
        if (this.ULTRA_CONSERVATIVE_MODE) {
            // 1. Si hay CUALQUIER ganancia mínima → VENTA INMEDIATA
            if (currentProfit >= (this.QUICK_SELL_MARGIN * 100)) {
                this.logger.log(`🛡️ MODO CONSERVADOR: VENTA INMEDIATA - Ganancia mínima asegurada (${currentProfit.toFixed(3)}%)`);
                return 'immediate';
            }

            // 2. Si RSI > 60 → VENTA RÁPIDA (evitar sobrecompra)
            if (rsi > 60) {
                this.logger.log(`🛡️ MODO CONSERVADOR: VENTA RÁPIDA - RSI alto (${rsi.toFixed(1)}) previene riesgo`);
                return 'immediate';
            }

            // 3. Si volatilidad > 1% → VENTA RÁPIDA (evitar riesgo)
            if (volatilityPercent > 1.0) {
                this.logger.log(`🛡️ MODO CONSERVADOR: VENTA RÁPIDA - Volatilidad alta (${volatilityPercent.toFixed(2)}%) = RIESGO`);
                return 'immediate';
            }

            // 4. Solo mantener en condiciones PERFECTAS
            if (isStrongUptrend && latestHistogram > 0 && rsi < 50 && volatilityPercent < 0.8) {
                this.logger.log(`🛡️ MODO CONSERVADOR: MANTENER - Condiciones perfectas confirmadas`);
                return 'hold_trend';
            }

            // 5. Default: venta rápida (conservador)
            this.logger.log(`🛡️ MODO CONSERVADOR: VENTA RÁPIDA - Por seguridad`);
            return 'immediate';
        }

        // Lógica original (modo normal)
        if (volatilityPercent < this.HIGH_VOLATILITY_THRESHOLD && currentProfit >= (this.QUICK_SELL_MARGIN * 100)) {
            this.logger.log(`⚡ ESTRATEGIA: VENTA INMEDIATA - Baja volatilidad (${volatilityPercent.toFixed(2)}%) + ganancia mínima (${currentProfit.toFixed(3)}%)`);
            return 'immediate';
        }

        if (isStrongUptrend && latestHistogram > 0 && rsi < 70) {
            this.logger.log(`🚀 ESTRATEGIA: MANTENER POSICIÓN - Tendencia fuerte alcista + momentum positivo (RSI=${rsi.toFixed(1)})`);
            return 'hold_trend';
        }

        if (isStrongDowntrend || rsi > 75) {
            this.logger.log(`📉 ESTRATEGIA: VENTA RÁPIDA - Tendencia bajista o RSI sobrecomprado (${rsi.toFixed(1)})`);
            return 'immediate';
        }

        if (volatilityPercent >= this.HIGH_VOLATILITY_THRESHOLD) {
            this.logger.log(`📈 ESTRATEGIA: ESPERAR PRECIO - Alta volatilidad (${volatilityPercent.toFixed(2)}%), potencial de mayor ganancia`);
            return 'wait_for_profit';
        }

        this.logger.log(`⏳ ESTRATEGIA: ESPERAR GANANCIA ESTÁNDAR - Condiciones neutras`);
        return 'wait_for_profit';
    }

    private emitTradeSignal(side: 'buy' | 'sell', price: number, atr: number, signalId: string) {
        // Usar ATR para SL y TP más dinámicos
        const stopLossPercent = (1.5 * atr) / price;
        const takeProfitPercent = (3 * atr) / price;

        const stopLoss =
            side === 'buy' ? price * (1 - stopLossPercent) : price * (1 + stopLossPercent);
        const takeProfit =
            side === 'buy' ? price * (1 + takeProfitPercent) : price * (1 - takeProfitPercent);

        const positionSize = this.capitalPerTrade / price;

        const tradeSignal: TradeSignal = {
            id: signalId,
            symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
            price,
            size: positionSize,
            stopLoss,
            takeProfit,
            side,
            paperTrading: this.PAPER_TRADING,
        };

        this.logger.log(`📢 Emitiendo señal ${side.toUpperCase()}: ${price} | ID: ${signalId}`);
        this.eventEmitter.emit(`trade.${side}`, tradeSignal);
    }

    private async createBuySignal(
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

        // Asegurar que el take profit cubra comisiones y margen mínimo
        const minTakeProfit = candle.close * (1 + 2 * this.COMMISSION + this.MIN_PROFIT_MARGIN);
        const finalTakeProfit = Math.max(takeProfit, minTakeProfit);

        const rawPositionSize = this.capitalPerTrade / candle.close;

        // Formatear según restricciones de Binance (LOT_SIZE: minQty=0.00001, stepSize=0.00001)
        const positionSize = Math.max(
            0.00001, // Cantidad mínima
            Math.floor(rawPositionSize / 0.00001) * 0.00001 // Redondear hacia abajo al stepSize más cercano
        );

        // Validar que todos los valores sean números válidos
        const values = {
            stopLossPercent, takeProfitPercent, stopLoss, takeProfit,
            minTakeProfit, finalTakeProfit, positionSize,
            atr, candle_close: candle.close, rsi, macd, smaShort, smaLong, volume
        };
        for (const [key, value] of Object.entries(values)) {
            if (!isFinite(value) || isNaN(value)) {
                this.logger.error(`❌ Valor inválido en createBuySignal ${key}: ${value}`);
                this.logger.error(`📊 Datos originales: candle.close=${candle.close}, atr=${atr}, capitalPerTrade=${this.capitalPerTrade}`);
                return;
            }
        }

        // Crear señal en base de datos
        const signal = await this.signalDbService.createSignal({
            symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
            initialPrice: candle.close,
            stopLoss,
            takeProfit: finalTakeProfit,
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

        // Validar valores del movimiento
        const movementValues = { totalAmount, commission, netAmount, positionSize };
        for (const [key, value] of Object.entries(movementValues)) {
            if (!isFinite(value) || isNaN(value)) {
                this.logger.error(`❌ Valor inválido en movimiento ${key}: ${value}`);
                return;
            }
        }

        await this.signalDbService.createMovement({
            signalId: signal.id,
            type: MovementType.BUY,
            price: candle.close,
            quantity: positionSize,
            totalAmount,
            commission,
            netAmount
        });

        // Solo marcar como FILLED automáticamente en paper trading
        if (this.PAPER_TRADING) {
            // En paper trading, marcar automáticamente el movimiento como ejecutado
            const movements = await this.signalDbService.getSignalById(signal.id);
            if (movements && movements.movements.length > 0) {
                const lastMovement = movements.movements[movements.movements.length - 1];
                await this.signalDbService.updateMovementStatus(lastMovement.id, MovementStatus.FILLED);
            }
        } else {
            // En trading real, crear orden en Binance
            const movements = await this.signalDbService.getSignalById(signal.id);
            if (movements && movements.movements.length > 0) {
                const lastMovement = movements.movements[movements.movements.length - 1];
                await this.executeBinanceOrder(lastMovement.id, {
                    symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
                    side: 'BUY',
                    type: 'MARKET',
                    quantity: positionSize
                });
            }
        }

        this.dailySignalCount++;

        this.logger.log(`🟢 SEÑAL DE COMPRA creada: ${candle.close} | SL: ${stopLoss.toFixed(2)} | TP: ${finalTakeProfit.toFixed(2)} | Size: ${positionSize.toFixed(4)}`);

        // Emitir evento para el trading service
        this.emitTradeSignal('buy', candle.close, atr, signal.id);

        // 🧠 HÍBRIDO INTELIGENTE: Evaluar si crear venta inmediata
        const strategy = this.determineSellingStrategy(atr, candle.close, candle.close, {
            isStrongUptrend: smaShort > smaLong,
            isStrongDowntrend: smaShort < smaLong,
            rsi,
            latestHistogram: macd > 0 ? 0.1 : -0.1 // Aproximación del histogram
        });

        if (strategy === 'immediate') {
            this.logger.log(`⚡ ACTIVANDO VENTA INMEDIATA para señal ${signal.id}`);

            // Calcular precio de venta inmediata con margen mínimo
            const quickSellPrice = candle.close * (1 + this.QUICK_SELL_MARGIN);

            // Programar venta inmediata después de la compra (dar tiempo para que se ejecute)
            setTimeout(async () => {
                try {
                    // Verificar que la compra se haya ejecutado
                    const updatedSignal = await this.signalDbService.getSignalById(signal.id);
                    if (updatedSignal) {
                        const buyMovement = updatedSignal.movements.find(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
                        if (buyMovement) {
                            this.logger.log(`⚡ EJECUTANDO VENTA INMEDIATA a precio ${quickSellPrice.toFixed(2)} (margen: ${(this.QUICK_SELL_MARGIN * 100).toFixed(1)}%)`);

                            // Crear venta inmediata
                            await this.createQuickSellSignal(
                                { ...candle, close: quickSellPrice },
                                atr, smaShort, smaLong, rsi, macd, volume, signal.id
                            );
                        } else {
                            this.logger.warn(`⚠️ No se pudo ejecutar venta inmediata: compra no encontrada para señal ${signal.id}`);
                        }
                    }
                } catch (error) {
                    this.logger.error(`❌ Error en venta inmediata para señal ${signal.id}:`, error);
                }
            }, this.PAPER_TRADING ? 1000 : 5000); // 1 seg en paper trading, 5 seg en real
        }
    }

    private async executeBinanceOrder(movementId: string, orderParams: {
        symbol: string;
        side: 'BUY' | 'SELL';
        type: 'MARKET' | 'LIMIT';
        quantity: number;
        price?: number;
    }): Promise<void> {
        try {
            this.logger.log(`🔄 Ejecutando orden en Binance: ${orderParams.side} ${orderParams.quantity} ${orderParams.symbol}`);

            // Crear orden en Binance
            const binanceResponse = await this.binanceService.createOrder(orderParams);

            // Actualizar movimiento con datos de Binance
            await this.signalDbService.updateMovementStatus(
                movementId,
                binanceResponse.status === 'FILLED' ? MovementStatus.FILLED : MovementStatus.PENDING,
                {
                    binanceOrderId: binanceResponse.orderId.toString(),
                    binanceClientOrderId: binanceResponse.clientOrderId,
                    binanceResponse: binanceResponse
                }
            );

            // Si la orden no se ejecutó inmediatamente, programar verificación
            if (binanceResponse.status !== 'FILLED') {
                this.scheduleOrderStatusCheck(movementId, binanceResponse.orderId, orderParams.symbol);
            }

        } catch (error) {
            this.logger.error(`❌ Error ejecutando orden en Binance:`, error);

            // Marcar movimiento con error
            await this.signalDbService.updateMovementStatus(
                movementId,
                MovementStatus.PENDING,
                {
                    binanceError: error
                }
            );
        }
    }

    private scheduleOrderStatusCheck(movementId: string, orderId: number, symbol: string): void {
        // Verificar estado de la orden cada 5 segundos por un máximo de 2 minutos
        let attempts = 0;
        const maxAttempts = 24; // 2 minutos / 5 segundos = 24 intentos

        const checkStatus = async () => {
            try {
                attempts++;
                const orderStatus = await this.binanceService.getOrderStatus(symbol, orderId);

                this.logger.debug(`📊 Verificando orden ${orderId}, intento ${attempts}/${maxAttempts}, status: ${orderStatus.status}`);

                if (orderStatus.status === 'FILLED') {
                    await this.signalDbService.updateMovementStatus(
                        movementId,
                        MovementStatus.FILLED,
                        {
                            binanceResponse: orderStatus
                        }
                    );
                    this.logger.log(`✅ Orden ${orderId} ejecutada exitosamente`);
                    return;
                }

                if (orderStatus.status === 'CANCELED' || orderStatus.status === 'REJECTED' || orderStatus.status === 'EXPIRED') {
                    this.logger.warn(`⚠️ Orden ${orderId} terminó con status: ${orderStatus.status}`);
                    return;
                }

                // Continuar verificando si no hemos alcanzado el máximo de intentos
                if (attempts < maxAttempts) {
                    setTimeout(checkStatus, 5000); // Verificar de nuevo en 5 segundos
                } else {
                    this.logger.warn(`⏰ Tiempo agotado verificando orden ${orderId} después de ${attempts} intentos`);
                }

            } catch (error) {
                this.logger.error(`❌ Error verificando estado de orden ${orderId}:`, error);
                if (attempts < maxAttempts) {
                    setTimeout(checkStatus, 5000);
                }
            }
        };

        // Iniciar verificación después de 5 segundos
        setTimeout(checkStatus, 5000);
    }

    private async createSellSignal(
        candle: indicators.Candle,
        atr: number,
        smaShort: number,
        smaLong: number,
        rsi: number,
        macd: number,
        volume: number,
        buySignalId: string
    ) {
        // Obtener la señal de compra original
        const buySignal = await this.signalDbService.getSignalById(buySignalId);
        if (!buySignal) {
            this.logger.error(`No se encontró señal de compra con ID: ${buySignalId}`);
            return;
        }

        const buyMovement = buySignal.movements.find(m => m.type === MovementType.BUY);
        if (!buyMovement) {
            this.logger.error(`No se encontró movimiento de compra en señal: ${buySignalId}`);
            return;
        }

        const profit = (candle.close - buyMovement.price) / buyMovement.price;
        const totalAmount = candle.close * buyMovement.quantity;
        const commission = totalAmount * this.COMMISSION;
        const netAmount = totalAmount - commission;
        const grossProfit = totalAmount - (buyMovement.price * buyMovement.quantity);
        const netProfit = grossProfit - commission - buyMovement.commission;

        // Validar que todos los valores sean números válidos
        const values = { profit, totalAmount, commission, netAmount, grossProfit, netProfit };
        for (const [key, value] of Object.entries(values)) {
            if (!isFinite(value) || isNaN(value)) {
                this.logger.error(`❌ Valor inválido en ${key}: ${value}`);
                this.logger.error(`📊 Datos: candle.close=${candle.close}, buyMovement.price=${buyMovement.price}, buyMovement.quantity=${buyMovement.quantity}, buyMovement.commission=${buyMovement.commission}`);
                return;
            }
        }

        // Crear movimiento de venta
        const sellMovement = await this.signalDbService.createMovement({
            signalId: buySignalId,
            type: MovementType.SELL,
            price: candle.close,
            quantity: buyMovement.quantity,
            totalAmount,
            commission,
            netAmount
        });

        // Solo marcar como FILLED automáticamente en paper trading
        if (this.PAPER_TRADING) {
            // En paper trading, marcar automáticamente el movimiento como ejecutado
            this.logger.log(`📝 Marcando movimiento de venta como FILLED (Paper Trading): ${sellMovement.id}`);
            await this.signalDbService.updateMovementStatus(sellMovement.id, MovementStatus.FILLED);
            this.logger.log(`✅ Movimiento de venta marcado como FILLED - La señal debería cerrarse automáticamente`);

            // Verificar explícitamente que la señal se haya cerrado
            const finalSignal = await this.signalDbService.getSignalById(buySignalId);
            if (finalSignal && finalSignal.status === SignalStatus.MATCHED) {
                this.logger.log(`🎯 Señal ${buySignalId} cerrada exitosamente con status: ${finalSignal.status}`);
            } else if (finalSignal) {
                this.logger.warn(`⚠️ Señal ${buySignalId} no se cerró automáticamente, status actual: ${finalSignal.status}`);
            }
        } else {
            // En trading real, crear orden en Binance usando el movimiento de venta recién creado
            this.logger.log(`🔄 Enviando orden de venta a Binance: ${sellMovement.id}`);
            await this.executeBinanceOrder(sellMovement.id, {
                symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
                side: 'SELL',
                type: 'MARKET',
                quantity: buyMovement.quantity
            });
        }

        // La señal se marcará automáticamente como MATCHED por el servicio cuando detecte compra+venta

        this.dailySignalCount++;

        this.logger.log(`🔴 SEÑAL DE VENTA creada: ${candle.close} | Profit: ${(profit * 100).toFixed(2)}% | Net PnL: ${netProfit.toFixed(2)} USDT`);

        // Emitir evento para el trading service
        this.emitTradeSignal('sell', candle.close, atr, buySignalId);
    }

    private async createQuickSellSignal(
        candle: indicators.Candle,
        atr: number,
        smaShort: number,
        smaLong: number,
        rsi: number,
        macd: number,
        volume: number,
        buySignalId: string
    ) {
        this.logger.log(`⚡ INICIANDO VENTA RÁPIDA para señal ${buySignalId} a precio ${candle.close}`);

        // Obtener la señal de compra original
        const buySignal = await this.signalDbService.getSignalById(buySignalId);
        if (!buySignal) {
            this.logger.error(`❌ No se encontró señal de compra con ID: ${buySignalId}`);
            return;
        }

        const buyMovement = buySignal.movements.find(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
        if (!buyMovement) {
            this.logger.error(`❌ No se encontró movimiento de compra ejecutado en señal: ${buySignalId}`);
            return;
        }

        const profit = (candle.close - buyMovement.price) / buyMovement.price;
        const totalAmount = candle.close * buyMovement.quantity;
        const commission = totalAmount * this.COMMISSION;
        const netAmount = totalAmount - commission;
        const grossProfit = totalAmount - (buyMovement.price * buyMovement.quantity);
        const netProfit = grossProfit - commission - buyMovement.commission;

        this.logger.log(`⚡ VENTA RÁPIDA: Profit=${(profit * 100).toFixed(3)}%, Net PnL=$${netProfit.toFixed(2)} USD`);

        // Validar que sea rentable (al menos cubra comisiones + margen mínimo)
        if (profit < this.QUICK_SELL_MARGIN) {
            this.logger.warn(`⚠️ VENTA RÁPIDA CANCELADA: Profit insuficiente ${(profit * 100).toFixed(3)}% < ${(this.QUICK_SELL_MARGIN * 100).toFixed(1)}%`);
            return;
        }

        // Validar que todos los valores sean números válidos
        const values = { profit, totalAmount, commission, netAmount, grossProfit, netProfit };
        for (const [key, value] of Object.entries(values)) {
            if (!isFinite(value) || isNaN(value)) {
                this.logger.error(`❌ Valor inválido en venta rápida ${key}: ${value}`);
                return;
            }
        }

        // Crear movimiento de venta
        const sellMovement = await this.signalDbService.createMovement({
            signalId: buySignalId,
            type: MovementType.SELL,
            price: candle.close,
            quantity: buyMovement.quantity,
            totalAmount,
            commission,
            netAmount
        });

        // Marcar como ejecutado según el modo
        if (this.PAPER_TRADING) {
            this.logger.log(`📝 Marcando movimiento de venta rápida como FILLED (Paper Trading): ${sellMovement.id}`);
            await this.signalDbService.updateMovementStatus(sellMovement.id, MovementStatus.FILLED);
            this.logger.log(`✅ VENTA RÁPIDA COMPLETADA (Paper Trading): $${netProfit.toFixed(2)} USD ganancia`);
        } else {
            // En trading real, enviar orden a Binance usando el movimiento de venta recién creado
            this.logger.log(`🔄 Enviando VENTA RÁPIDA a Binance: ${sellMovement.id}`);
            await this.executeBinanceOrder(sellMovement.id, {
                symbol: process.env.BINANCE_SYMBOL || 'BTCUSDT',
                side: 'SELL',
                type: 'MARKET',
                quantity: buyMovement.quantity
            });
            this.logger.log(`⚡ VENTA RÁPIDA enviada a Binance: ${buyMovement.quantity} a ${candle.close}`);
        }

        // Emitir evento
        this.emitTradeSignal('sell', candle.close, atr, buySignalId);
    }

    /**
     * Limpia órdenes pendientes que no tienen binanceOrderId (fallos de ejecución)
     */
    async cleanupFailedOrders(): Promise<void> {
        try {
            this.logger.log('🧹 Iniciando limpieza de órdenes fallidas...');

            // Buscar movimientos pendientes sin binanceOrderId que tengan más de 5 minutos
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const failedMovements = await this.signalDbService.getFailedMovements(fiveMinutesAgo);

            for (const movement of failedMovements) {
                this.logger.warn(`🔄 Marcando movimiento fallido como FAILED: ${movement.id}`);
                await this.signalDbService.updateMovementStatus(movement.id, MovementStatus.FAILED, {
                    binanceError: { error: 'Order not executed in Binance - marked as failed for cleanup' }
                });
            }

            this.logger.log(`✅ Limpieza completada. ${failedMovements.length} movimientos marcados como fallidos`);

        } catch (error) {
            this.logger.error('❌ Error en limpieza de órdenes fallidas:', error);
        }
    }

    /**
     * Verifica órdenes pendientes con binanceOrderId en Binance
     */
    async syncPendingOrders(): Promise<void> {
        try {
            this.logger.log('🔄 Sincronizando órdenes pendientes con Binance...');

            const pendingMovements = await this.signalDbService.getPendingMovementsWithOrderId();

            for (const movement of pendingMovements) {
                if (movement.binanceOrderId) {
                    try {
                        const orderStatus = await this.binanceService.getOrderStatus(
                            movement.signal.symbol,
                            parseInt(movement.binanceOrderId)
                        );

                        if (orderStatus.status === 'FILLED') {
                            await this.signalDbService.updateMovementStatus(
                                movement.id,
                                MovementStatus.FILLED,
                                { binanceResponse: orderStatus }
                            );
                            this.logger.log(`✅ Orden sincronizada: ${movement.binanceOrderId} ahora FILLED`);
                        } else if (['CANCELED', 'REJECTED', 'EXPIRED'].includes(orderStatus.status)) {
                            await this.signalDbService.updateMovementStatus(
                                movement.id,
                                MovementStatus.FAILED,
                                { binanceResponse: orderStatus }
                            );
                            this.logger.warn(`⚠️ Orden terminó: ${movement.binanceOrderId} status: ${orderStatus.status}`);
                        }

                    } catch (error) {
                        this.logger.error(`❌ Error verificando orden ${movement.binanceOrderId}:`, error);
                    }
                }
            }

            this.logger.log('✅ Sincronización completada');

        } catch (error) {
            this.logger.error('❌ Error sincronizando órdenes pendientes:', error);
        }
    }
}
