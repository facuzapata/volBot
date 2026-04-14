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
    }>;
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
            recentCandles: input.recentCandles
        };

        return [
            'Eres un analista de riesgo para trading cuantitativo.',
            'Debes evaluar si aprobar o rechazar una orden BUY candidata.',
            'Reglas obligatorias:',
            `1) Si confidence < ${this.minConfidence.toFixed(3)} => decision REJECT.`,
            '2) Si faltan datos criticos o hay incoherencia => decision REJECT.',
            '3) Responde SOLO con JSON valido, sin markdown.',
            'Esquema exacto de salida:',
            '{"decision":"APPROVE|REJECT","confidence":0.0,"risk_score":0.0,"reasons":["..."],"warnings":["..."],"max_position_multiplier":1.0}',
            'Datos de entrada:',
            JSON.stringify(payload)
        ].join('\n');
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