import { Injectable, Logger } from '@nestjs/common';
import { TradeReport } from './interfaces/trade-report.interface';
import { PositionOpenReport } from './interfaces/position-open-report.interface';

@Injectable()
export class TelegramService {
    private readonly logger = new Logger(TelegramService.name);
    private readonly TELEGRAM_ENABLED: boolean;
    private readonly TELEGRAM_BOT_TOKEN: string;
    private readonly TELEGRAM_CHAT_ID: string;

    constructor() {
        this.TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED === 'true';
        this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
        this.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

        if (this.TELEGRAM_ENABLED && (!this.TELEGRAM_BOT_TOKEN || !this.TELEGRAM_CHAT_ID)) {
            this.logger.warn('⚠️ TELEGRAM_ENABLED=true pero faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID');
        }
    }

    async sendTradeReport(report: TradeReport): Promise<void> {
        const message = this.formatTradeMessage(report);
        await this.sendMessage(message, 'Reporte de trading enviado por Telegram');
    }

    async sendPositionOpenReport(report: PositionOpenReport): Promise<void> {
        const message = this.formatOpenPositionMessage(report);
        await this.sendMessage(message, 'Reporte de apertura enviado por Telegram');
    }

    async sendSystemNotification(message: string): Promise<void> {
        await this.sendMessage(message, 'Notificación de sistema enviada por Telegram');
    }

    private async sendMessage(message: string, successLog: string): Promise<void> {
        if (!this.TELEGRAM_ENABLED) {
            this.logger.debug('📨 Telegram deshabilitado - no se envía reporte');
            return;
        }

        if (!this.TELEGRAM_BOT_TOKEN || !this.TELEGRAM_CHAT_ID) {
            this.logger.warn('📨 Configuración de Telegram incompleta - reporte no enviado');
            return;
        }

        try {
            const response = await fetch(`https://api.telegram.org/bot${this.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    chat_id: this.TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                this.logger.error(`❌ Error enviando reporte de Telegram (${response.status}): ${errorBody}`);
                return;
            }

            this.logger.log(`📨 ${successLog} a chat ${this.TELEGRAM_CHAT_ID}`);
        } catch (error) {
            this.logger.error('❌ Error enviando mensaje de Telegram:', this.getErrorMessage(error));
        }
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private formatTradeMessage(report: TradeReport): string {
        const mode = report.paperTrading ? 'PAPER TRADING' : 'TRADING REAL';
        const profitEmoji = report.netProfit > 0 ? '✅' : '❌';
        const profitLabel = report.netProfit > 0 ? 'GANANCIA' : 'PERDIDA';

        return [
            '🤖 <b>VolBot - Cierre de Operacion</b>',
            '',
            `📌 <b>Modo:</b> ${mode}`,
            `📈 <b>Par:</b> ${report.symbol}`,
            `🔗 <b>Signal ID:</b> ${report.signalId.slice(0, 8)}...`,
            '',
            '💰 <b>Resumen</b>',
            `🟢 Compra: $${report.buyPrice.toFixed(2)} USDT`,
            `🔴 Venta: $${report.sellPrice.toFixed(2)} USDT`,
            `📊 Cantidad: ${report.quantity.toFixed(6)} ${report.symbol.replace('USDT', '')}`,
            '',
            '📉 <b>P&L</b>',
            `📥 Inversion: $${report.totalBuyAmount.toFixed(2)} USDT`,
            `📤 Retorno: $${report.totalSellAmount.toFixed(2)} USDT`,
            `💸 Comisiones: $${report.totalCommission.toFixed(4)} USDT`,
            `${profitEmoji} <b>${profitLabel}:</b> $${Math.abs(report.netProfit).toFixed(4)} USDT`,
            `📈 Variacion: ${report.profitPercent > 0 ? '+' : ''}${report.profitPercent.toFixed(2)}%`,
            `💹 ROI: ${report.roi > 0 ? '+' : ''}${report.roi.toFixed(2)}%`,
            `⏱️ Duracion: ${report.duration}`,
            '',
            `🕒 ${new Date().toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })}`
        ].join('\n');
    }

    private formatOpenPositionMessage(report: PositionOpenReport): string {
        const mode = report.paperTrading ? 'PAPER TRADING' : 'TRADING REAL';

        return [
            '🚀 <b>VolBot - Operacion Abierta</b>',
            '',
            `📌 <b>Modo:</b> ${mode}`,
            `📈 <b>Par:</b> ${report.symbol}`,
            `🔗 <b>Signal ID:</b> ${report.signalId.slice(0, 8)}...`,
            '',
            '📥 <b>Entrada</b>',
            `🟢 Compra ejecutada: $${report.entryPrice.toFixed(2)} USDT`,
            `📊 Cantidad: ${report.quantity.toFixed(6)} ${report.symbol.replace('USDT', '')}`,
            `💵 Inversion: $${report.totalAmount.toFixed(2)} USDT`,
            `💸 Comision: $${report.commission.toFixed(4)} USDT`,
            `🧾 Neto: $${report.netAmount.toFixed(2)} USDT`,
            '',
            '🎯 <b>Objetivos</b>',
            `🛑 Stop Loss: $${report.stopLoss.toFixed(2)} USDT`,
            `🎯 Take Profit: $${report.takeProfit.toFixed(2)} USDT`,
            '',
            `🕒 ${report.openedAt.toLocaleString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })}`
        ].join('\n');
    }
}