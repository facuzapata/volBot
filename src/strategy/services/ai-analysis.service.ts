import { Injectable, Logger } from '@nestjs/common';

interface BuySignalAnalysisInput {
    userId: string;
    userEmail: string;
    symbol: string;
    timeframeMinutes: number;
    currentPrice: number;
    stopLoss: number;
    takeProfit: number;
    positionSize: number;
    indicators: {
        rsi: number;
        latestMACD: number;
        latestSignal: number;
        latestHistogram: number;
        atr: number;
        smaShort: number;
        smaLong: number;
        currentVolume: number;
        isStrongUptrend: boolean;
        isRangeMarket: boolean;
        bullishEngulfing: boolean;
        priceNearBBLower: boolean;
        volumeConfirmation: boolean;
    };
    recentCandles: Array<{
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        timestamp?: number;
    }>;
    recentNews?: Array<{
        source: string;
        publishedAt: string;
        title: string;
        summary?: string;
        sentiment?: 'bullish' | 'bearish' | 'neutral';
        relevance?: number;
    }>;
    marketContext?: {
        marketRegime?: string;
        fundingRate?: number;
        openInterest?: number;
        openInterestChangePct?: number;
        liquidationImbalance?: number;
        btcDominanceChangePct?: number;
        fearGreedValue?: number;
        fearGreedClassification?: string;
        priceChange1mPct?: number;
        priceChange5mPct?: number;
        priceChange15mPct?: number;
        priceChange24hPct?: number;
        quoteVolume24h?: number;
        notes?: string[];
    };
}

interface AiDecision {
    decision: 'APPROVE' | 'REJECT';
    confidence: number;
    risk_score?: number;
    reasons?: string[];
    warnings?: string[];
    max_position_multiplier?: number;
}

export interface AiBuyDecisionResult {
    approved: boolean;
    skipped: boolean;
    source: 'disabled' | 'ollama' | 'fallback';
    reason: string;
    confidence: number | null;
}

@Injectable()
export class AiAnalysisService {
    private readonly logger = new Logger(AiAnalysisService.name);

    private readonly enabled = process.env.ANALISIS_IA === 'true';
    private readonly blockTradesOnFailure = process.env.IA_BLOCKS_TRADES !== 'false';
    private readonly ollamaUrl = process.env.OLLAMA_URL || 'http://ollama:11434';
    private readonly ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b-instruct';
    private readonly requestTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 20000);
    private readonly minConfidence = Number(process.env.IA_MIN_CONFIDENCE || 0.72);

    async evaluateBuySignal(input: BuySignalAnalysisInput): Promise<AiBuyDecisionResult> {
        if (!this.enabled) {
            return {
                approved: true,
                skipped: true,
                source: 'disabled',
                reason: 'ANALISIS_IA desactivado',
                confidence: null
            };
        }

        const fallback = this.getFallbackResult(
            'Fallo en consulta/parsing de Ollama'
        );

        try {
            const prompt = this.buildPrompt(input);
            const rawResponse = await this.callOllama(prompt);
            const parsedDecision = this.parseDecision(rawResponse);

            if (!parsedDecision) {
                this.logger.warn(`[AiAnalysis][Usuario ${input.userId}] Respuesta inválida, aplicando fallback`);
                return fallback;
            }

            const confidence = Number(parsedDecision.confidence);

            if (parsedDecision.decision !== 'APPROVE') {
                const reason = parsedDecision.reasons?.join(', ') || 'IA rechazó la operación';
                return {
                    approved: false,
                    skipped: false,
                    source: 'ollama',
                    reason,
                    confidence: Number.isFinite(confidence) ? confidence : null
                };
            }

            if (!Number.isFinite(confidence) || confidence < this.minConfidence) {
                return {
                    approved: false,
                    skipped: false,
                    source: 'ollama',
                    reason: `Confianza IA insuficiente (${Number.isFinite(confidence) ? confidence.toFixed(3) : 'N/A'} < ${this.minConfidence.toFixed(3)})`,
                    confidence: Number.isFinite(confidence) ? confidence : null
                };
            }

            return {
                approved: true,
                skipped: false,
                source: 'ollama',
                reason: parsedDecision.reasons?.join(', ') || 'Aprobado por IA',
                confidence
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`[AiAnalysis][Usuario ${input.userId}] Error: ${message}`);
            return fallback;
        }
    }

    private getFallbackResult(reason: string): AiBuyDecisionResult {
        if (this.blockTradesOnFailure) {
            return {
                approved: false,
                skipped: false,
                source: 'fallback',
                reason: `${reason}. IA_BLOCKS_TRADES=true`,
                confidence: null
            };
        }

        return {
            approved: true,
            skipped: false,
            source: 'fallback',
            reason: `${reason}. IA_BLOCKS_TRADES=false`,
            confidence: null
        };
    }

    private buildPrompt(input: BuySignalAnalysisInput): string {
        const rr = input.currentPrice > input.stopLoss
            ? (input.takeProfit - input.currentPrice) / (input.currentPrice - input.stopLoss)
            : 0;

        const derivedContext = this.buildDerivedContext(input.recentCandles);

        const payload = {
            userId: input.userId,
            userEmail: input.userEmail,
            symbol: input.symbol,
            timeframeMinutes: input.timeframeMinutes,
            orderCandidate: {
                side: 'BUY',
                entry: input.currentPrice,
                stopLoss: input.stopLoss,
                takeProfit: input.takeProfit,
                riskRewardRatio: rr,
                positionSize: input.positionSize
            },
            indicators: input.indicators,
            recentCandles: input.recentCandles,
            derivedContext,
            recentNews: input.recentNews ?? [],
            marketContext: input.marketContext ?? null
        };

        return [
            'Eres un analista premium de riesgo para trading cuantitativo de corto plazo.',
            'Tu trabajo no es justificar trades: tu trabajo es filtrar operaciones mediocres y aprobar solo setups excepcionalmente consistentes.',
            'Evalua una orden BUY candidata como si administraras capital institucional con tolerancia baja al error.',
            'Debes pensar de forma adversarial: primero busca razones para rechazar, y solo aprueba si la evidencia a favor supera claramente a la evidencia en contra.',
            'Principios de trabajo:',
            '1) No inventes informacion. Si algo no esta en los datos, tratelo como desconocido.',
            '2) Si faltan datos criticos, hay incoherencia numerica, o el contexto es ambiguo, decide REJECT.',
            `3) Si confidence < ${this.minConfidence.toFixed(3)}, decide REJECT.`,
            '4) Si hay senales mezcladas o el edge no es claro, decide REJECT.',
            '5) Si el setup depende de noticias recientes pero no hay noticias verificadas en la entrada, agrega warning y no asumas nada.',
            '6) Responde SOLO con JSON valido, sin markdown, sin texto extra.',
            'Checklist obligatorio de evaluacion:',
            'A) Calidad de datos: coherencia entre precio de entrada, stop, take profit, ATR, volumen y velas recientes.',
            'B) Geometria del trade: el BUY debe tener entry > stopLoss, takeProfit > entry y riskRewardRatio suficientemente atractivo.',
            'C) Regimen de mercado: detectar tendencia, rango, agotamiento, expansion/contraccion de volatilidad y alineacion entre momentum y estructura.',
            'D) Momentum y confirmaciones: RSI, MACD, histogram, SMA/EMA, patron de velas, cercania a bandas y confirmacion de volumen.',
            'E) Riesgo tactico: entrada demasiado extendida, persecucion de precio, stop demasiado corto o demasiado lejano, ATR desproporcionado, volumen anomalo, o estructura fragil.',
            'F) Contexto externo: revisar recentNews y marketContext SOLO si estan presentes. Si recentNews esta vacio, no infieras noticias ni eventos macro.',
            'Criterios de rechazo duro:',
            'a) Datos faltantes, NaN, infinitos o incoherentes.',
            'b) riskRewardRatio <= 1.0.',
            'c) StopLoss no protege de forma realista o TakeProfit es trivial.',
            'd) Momentum contradictorio fuerte o alta probabilidad de reversal inmediato.',
            'e) Evidencia insuficiente para defender la compra frente a una auditoria humana exigente.',
            'Calibracion de confidence:',
            '0.00-0.39 => setup pobre o inconsistente.',
            '0.40-0.64 => setup dudoso o incompleto.',
            '0.65-0.79 => setup aceptable pero no institucional.',
            '0.80-0.89 => setup fuerte con varias confirmaciones.',
            '0.90-1.00 => setup excepcional y raro; usar solo si casi no hay contradicciones.',
            'Esquema exacto de salida:',
            '{"decision":"APPROVE|REJECT","confidence":0.0,"risk_score":0.0,"reasons":["..."],"warnings":["..."],"max_position_multiplier":1.0}',
            'Reglas del JSON:',
            'decision: APPROVE o REJECT.',
            'confidence: numero entre 0 y 1.',
            'risk_score: numero entre 0 y 1 donde 1 es riesgo muy alto.',
            'reasons: lista corta y concreta con los motivos dominantes de la decision.',
            'warnings: lista corta con datos faltantes, dependencia de noticias no verificadas, o fragilidad del setup.',
            'max_position_multiplier: <= 1.0. Si el setup no es excepcional, mantenlo claramente por debajo de 1.0.',
            'Datos de entrada para analizar:',
            JSON.stringify(payload)
        ].join('\n');
    }

    private buildDerivedContext(candles: BuySignalAnalysisInput['recentCandles']) {
        if (!candles.length) {
            return {
                candleCount: 0
            };
        }

        const closes = candles.map((candle) => candle.close).filter((value) => Number.isFinite(value));
        const volumes = candles.map((candle) => candle.volume).filter((value) => Number.isFinite(value));
        const lastCandle = candles[candles.length - 1];
        const previousCandle = candles.length > 1 ? candles[candles.length - 2] : null;
        const closeChange1 = this.calculatePercentageChange(closes, 1);
        const closeChange3 = this.calculatePercentageChange(closes, 3);
        const closeChange5 = this.calculatePercentageChange(closes, 5);
        const closeChange10 = this.calculatePercentageChange(closes, 10);
        const averageVolume5 = this.calculateAverage(volumes.slice(-5));
        const averageVolume20 = this.calculateAverage(volumes.slice(-20));
        const upCandles5 = candles.slice(-5).filter((candle) => candle.close > candle.open).length;
        const downCandles5 = candles.slice(-5).filter((candle) => candle.close < candle.open).length;
        const rangePct = lastCandle.close !== 0
            ? (lastCandle.high - lastCandle.low) / lastCandle.close
            : null;
        const bodyPct = lastCandle.open !== 0
            ? Math.abs(lastCandle.close - lastCandle.open) / lastCandle.open
            : null;
        const lastVolumeVsAvg5 = averageVolume5 && averageVolume5 > 0
            ? lastCandle.volume / averageVolume5
            : null;
        const lastVolumeVsAvg20 = averageVolume20 && averageVolume20 > 0
            ? lastCandle.volume / averageVolume20
            : null;
        const realizedVolatility10 = this.calculateRealizedVolatility(closes.slice(-10));

        return {
            candleCount: candles.length,
            lastClose: lastCandle.close,
            previousClose: previousCandle?.close ?? null,
            closeChangePct1: closeChange1,
            closeChangePct3: closeChange3,
            closeChangePct5: closeChange5,
            closeChangePct10: closeChange10,
            realizedVolatility10,
            averageVolume5,
            averageVolume20,
            lastVolumeVsAvg5,
            lastVolumeVsAvg20,
            upCandlesLast5: upCandles5,
            downCandlesLast5: downCandles5,
            lastCandleRangePct: rangePct,
            lastCandleBodyPct: bodyPct
        };
    }

    private calculateAverage(values: number[]): number | null {
        if (!values.length) return null;

        const validValues = values.filter((value) => Number.isFinite(value));
        if (!validValues.length) return null;

        return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
    }

    private calculatePercentageChange(values: number[], periodsBack: number): number | null {
        if (values.length <= periodsBack) return null;

        const latest = values[values.length - 1];
        const previous = values[values.length - 1 - periodsBack];
        if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) return null;

        return (latest - previous) / previous;
    }

    private calculateRealizedVolatility(values: number[]): number | null {
        if (values.length < 2) return null;

        const returns: number[] = [];
        for (let index = 1; index < values.length; index++) {
            const previous = values[index - 1];
            const current = values[index];

            if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) {
                continue;
            }

            returns.push((current - previous) / previous);
        }

        if (!returns.length) return null;

        const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
        const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / returns.length;
        return Math.sqrt(variance);
    }

    private async callOllama(prompt: string): Promise<string> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        try {
            const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.ollamaModel,
                    prompt,
                    stream: false,
                    format: 'json',
                    options: {
                        temperature: 0.1
                    }
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json() as { response?: string };
            return data.response || '';
        } finally {
            clearTimeout(timeout);
        }
    }

    private parseDecision(raw: string): AiDecision | null {
        if (!raw) return null;

        const direct = this.tryParseJson(raw);
        if (direct) return direct;

        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;

        return this.tryParseJson(match[0]);
    }

    private tryParseJson(input: string): AiDecision | null {
        try {
            const parsed = JSON.parse(input) as Partial<AiDecision>;
            const decision = parsed.decision === 'APPROVE' || parsed.decision === 'REJECT'
                ? parsed.decision
                : null;

            if (!decision) return null;

            return {
                decision,
                confidence: Number(parsed.confidence),
                risk_score: parsed.risk_score,
                reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
                warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
                max_position_multiplier: parsed.max_position_multiplier
            };
        } catch {
            return null;
        }
    }
}