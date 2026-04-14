import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeReport } from './interfaces/trade-report.interface';
import { PositionOpenReport } from './interfaces/position-open-report.interface';
import { User } from '../users/entities/user.entity';

@Injectable()
export class TelegramService {
    private readonly logger = new Logger(TelegramService.name);
    private readonly TELEGRAM_ENABLED: boolean;
    private readonly TELEGRAM_BOT_TOKEN: string;
    // Fallback para compatibilidad hacia atrás (sistema global)
    private readonly TELEGRAM_CHAT_ID_FALLBACK: string;

    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>
    ) {
        this.TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED === 'true';
        this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
        this.TELEGRAM_CHAT_ID_FALLBACK = process.env.TELEGRAM_CHAT_ID || '';

        if (this.TELEGRAM_ENABLED && !this.TELEGRAM_BOT_TOKEN) {
            this.logger.warn('⚠️ TELEGRAM_ENABLED=true pero falta TELEGRAM_BOT_TOKEN');
        }
    }

    /**
     * Envía un reporte de trade a un usuario específico
     * @param userId ID del usuario
     * @param report Reporte del trade
     */
    async sendTradeReportToUser(userId: string, report: TradeReport): Promise<void> {
        const message = this.formatTradeMessage(report);
        await this.sendMessageToUser(userId, message, `Reporte de trading enviado a usuario ${userId}`);
    }

    /**
     * Envía un reporte de posición abierta a un usuario específico
     * @param userId ID del usuario
     * @param report Reporte de la posición
     */
    async sendPositionOpenReportToUser(userId: string, report: PositionOpenReport): Promise<void> {
        const message = this.formatOpenPositionMessage(report);
        await this.sendMessageToUser(userId, message, `Reporte de apertura enviado a usuario ${userId}`);
    }

    /**
     * Envía una notificación de sistema a un usuario específico
     * @param userId ID del usuario
     * @param message Mensaje a enviar
     */
    async sendSystemNotificationToUser(userId: string, message: string): Promise<void> {
        await this.sendMessageToUser(userId, message, `Notificación de sistema enviada a usuario ${userId}`);
    }

    private async sendMessageToUser(userId: string, message: string, logMessage: string): Promise<void> {
        if (!this.TELEGRAM_ENABLED) {
            this.logger.debug('📨 Telegram deshabilitado - no se envía mensaje');
            return;
        }

        if (!this.TELEGRAM_BOT_TOKEN) {
            this.logger.warn('📨 TELEGRAM_BOT_TOKEN no configurado');
            return;
        }

        try {
            // 1. Obtener el chat ID del usuario desde BD
            const user = await this.userRepository.findOne({
                where: { id: userId }
            });

            if (!user) {
                this.logger.warn(`⚠️ Usuario ${userId} no encontrado en BD`);
                return;
            }

            if (!user.telegramChatId) {
                this.logger.warn(`⚠️ Usuario ${userId} no tiene telegramChatId configurado`);
                return;
            }

            if (!user.telegramEnabled) {
                this.logger.debug(`📨 Telegram deshabilitado para usuario ${userId}`);
                return;
            }

            // 2. Enviar el mensaje
            const response = await fetch(`https://api.telegram.org/bot${this.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    chat_id: user.telegramChatId,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                this.logger.error(`❌ Error enviando mensaje Telegram a usuario ${userId} (${response.status}): ${errorBody}`);
                return;
            }

            this.logger.log(`📨 ${logMessage} (chat: ${user.telegramChatId})`);
        } catch (error) {
            this.logger.error(`❌ Error enviando mensaje Telegram a usuario ${userId}:`, this.getErrorMessage(error));
        }
    }

    /**
     * LEGACY: Envía reporte de trade (compatibilidad hacia atrás)
     * @deprecated Usar sendTradeReportToUser() en su lugar
     */
    async sendTradeReport(report: TradeReport): Promise<void> {
        const message = this.formatTradeMessage(report);
        await this.sendMessageLegacy(message, 'Reporte de trading enviado por Telegram');
    }

    /**
     * LEGACY: Envía posición abierta (compatibilidad hacia atrás)
     * @deprecated Usar sendPositionOpenReportToUser() en su lugar
     */
    async sendPositionOpenReport(report: PositionOpenReport): Promise<void> {
        const message = this.formatOpenPositionMessage(report);
        await this.sendMessageLegacy(message, 'Reporte de apertura enviado por Telegram');
    }

    /**
     * LEGACY: Envía notificación de sistema (compatibilidad hacia atrás)
     * @deprecated Usar sendSystemNotificationToUser() en su lugar
     */
    async sendSystemNotification(message: string): Promise<void> {
        await this.sendMessageLegacy(message, 'Notificación de sistema enviada por Telegram');
    }

    private async sendMessageLegacy(message: string, successLog: string): Promise<void> {
        if (!this.TELEGRAM_ENABLED) {
            this.logger.debug('📨 Telegram deshabilitado - no se envía reporte');
            return;
        }

        if (!this.TELEGRAM_BOT_TOKEN || !this.TELEGRAM_CHAT_ID_FALLBACK) {
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
                    chat_id: this.TELEGRAM_CHAT_ID_FALLBACK,
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

            this.logger.log(`📨 ${successLog} a chat ${this.TELEGRAM_CHAT_ID_FALLBACK}`);
        } catch (error) {
            this.logger.error('❌ Error enviando mensaje de Telegram:', this.getErrorMessage(error));
        }
    }

    private formatTradeMessage(report: TradeReport): string {
        const mode = report.paperTrading ? 'PAPER TRADING' : 'TRADING REAL';
        const profitEmoji = report.netProfit > 0 ? '✅' : '❌';
        const profitLabel = report.stoppedByStopLoss ? 'STOP LOSS' : (report.netProfit > 0 ? 'GANANCIA' : 'PERDIDA');
        const titleEmoji = report.stoppedByStopLoss ? '🛑' : '🤖';

        return [
            `${titleEmoji} <b>VolBot - Cierre de Operacion</b>`,
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

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}