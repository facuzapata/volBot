import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { TradeReport } from './interfaces/trade-report.interface';
import { PositionOpenReport } from './interfaces/position-open-report.interface';

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WhatsAppService.name);
    private client!: Client;
    private isReady = false;
    private readonly WHATSAPP_ENABLED: boolean;
    private readonly WHATSAPP_NUMBER: string;

    constructor() {
        // Leer configuración desde variables de entorno
        this.WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';
        this.WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '';

        if (this.WHATSAPP_ENABLED && !this.WHATSAPP_NUMBER) {
            this.logger.warn('⚠️ WHATSAPP_ENABLED=true pero WHATSAPP_NUMBER no está configurado');
        }
    }

    async onModuleInit() {
        if (!this.WHATSAPP_ENABLED) {
            this.logger.log('📱 WhatsApp deshabilitado por configuración');
            return;
        }

        this.logger.log('📱 Inicializando WhatsApp Web...');

        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'volbot-session',
                dataPath: '/app/.wwebjs_auth'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--user-data-dir=/app/.chrome-data',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ],
                executablePath: '/usr/bin/google-chrome'
            }
        });

        // Mostrar QR code para autenticación
        this.client.on('qr', (qr) => {
            this.logger.log('📱 Escanea este código QR con WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        // Cliente listo
        this.client.on('ready', async () => {
            this.isReady = true;
            this.logger.log('✅ WhatsApp Web conectado y listo!');

            // Esperar un poco más para que WhatsApp Web esté completamente cargado
            setTimeout(async () => {
                await this.sendTestMessage();
            }, 5000); // Esperar 5 segundos
        });

        // Manejo de errores
        this.client.on('auth_failure', () => {
            this.logger.error('❌ Error de autenticación de WhatsApp');
        });

        this.client.on('disconnected', (reason) => {
            this.isReady = false;
            this.logger.warn(`📱 WhatsApp desconectado: ${reason}`);
        });

        try {
            await this.client.initialize();
        } catch (error) {
            this.logger.error('❌ Error inicializando WhatsApp:', error);
        }
    }

    async onModuleDestroy() {
        if (this.client) {
            try {
                await this.client.destroy();
                this.logger.log('📱 WhatsApp Web desconectado correctamente');
            } catch (error) {
                this.logger.error('❌ Error al desconectar WhatsApp:', this.getErrorMessage(error));
            }
        }
    }

    async sendTradeReport(report: TradeReport): Promise<void> {
        const message = this.formatTradeMessage(report);
        await this.sendMessage(message, 'Reporte de trading enviado por WhatsApp');
    }

    async sendPositionOpenReport(report: PositionOpenReport): Promise<void> {
        const message = this.formatOpenPositionMessage(report);
        await this.sendMessage(message, 'Reporte de apertura enviado por WhatsApp');
    }

    async sendSystemNotification(message: string): Promise<void> {
        await this.sendMessage(message, 'Notificación de sistema enviada por WhatsApp');
    }

    private async sendMessage(message: string, successLog: string): Promise<void> {
        if (!this.WHATSAPP_ENABLED) {
            this.logger.debug('📱 WhatsApp deshabilitado - no se envía reporte');
            return;
        }

        if (!this.isReady) {
            this.logger.warn('📱 WhatsApp no está listo - reporte no enviado');
            return;
        }

        if (!this.WHATSAPP_NUMBER) {
            this.logger.warn('📱 Número de WhatsApp no configurado');
            return;
        }

        try {
            // Verificar que el cliente esté realmente conectado
            const state = await this.client.getState();
            if (state !== 'CONNECTED') {
                this.logger.warn('📱 WhatsApp no está completamente conectado - reporte no enviado');
                return;
            }

            // Formatear el número correctamente
            let chatId = this.WHATSAPP_NUMBER;
            if (!chatId.includes('@')) {
                chatId = `${chatId}@c.us`;
            }

            await this.client.sendMessage(chatId, message);
            this.logger.log(`📱 ${successLog} a ${chatId}`);
        } catch (error) {
            this.logger.error('❌ Error enviando mensaje de WhatsApp:', this.getErrorMessage(error));
        }
    }

    private formatTradeMessage(report: TradeReport): string {
        const mode = report.paperTrading ? '📝 PAPER TRADING' : '💰 TRADING REAL';
        const profitEmoji = report.netProfit > 0 ? '💚' : '❌';
        const profitText = report.netProfit > 0 ? 'GANANCIA' : 'PÉRDIDA';

        return `🤖 *VolBot - Trading Report*

${mode}

📈 *${report.symbol}* - Operación Completada
━━━━━━━━━━━━━━━━━━━━

💰 *RESUMEN FINANCIERO*
🟢 Compra: $${report.buyPrice.toFixed(2)} USDT
🔴 Venta: $${report.sellPrice.toFixed(2)} USDT
📊 Cantidad: ${report.quantity.toFixed(6)} ${report.symbol.replace('USDT', '')}

💵 *ANÁLISIS P&L*
📥 Inversión: $${report.totalBuyAmount.toFixed(2)} USDT
📤 Retorno: $${report.totalSellAmount.toFixed(2)} USDT
💸 Comisiones: $${report.totalCommission.toFixed(4)} USDT

${profitEmoji} *${profitText}: $${Math.abs(report.netProfit).toFixed(4)} USDT*
📈 Porcentaje: ${report.profitPercent > 0 ? '+' : ''}${report.profitPercent.toFixed(2)}%
💹 ROI: ${report.roi > 0 ? '+' : ''}${report.roi.toFixed(2)}%

⏱️ *Duración:* ${report.duration}
🔗 *ID:* ${report.signalId.substring(0, 8)}...

━━━━━━━━━━━━━━━━━━━━
${new Date().toLocaleString('es-ES', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })}`;
    }

    private formatOpenPositionMessage(report: PositionOpenReport): string {
        const mode = report.paperTrading ? '📝 PAPER TRADING' : '💰 TRADING REAL';

        return `🚀 *VolBot - Operación Abierta*

${mode}

📈 *${report.symbol}* - Compra Ejecutada
━━━━━━━━━━━━━━━━━━━━

📥 *ENTRADA*
🟢 Precio de compra: $${report.entryPrice.toFixed(2)} USDT
📊 Cantidad: ${report.quantity.toFixed(6)} ${report.symbol.replace('USDT', '')}
💵 Inversión: $${report.totalAmount.toFixed(2)} USDT
💸 Comisión: $${report.commission.toFixed(4)} USDT
🧾 Neto: $${report.netAmount.toFixed(2)} USDT

🎯 *OBJETIVOS*
🛑 Stop Loss: $${report.stopLoss.toFixed(2)} USDT
🎯 Take Profit: $${report.takeProfit.toFixed(2)} USDT

🔗 *ID:* ${report.signalId.substring(0, 8)}...
━━━━━━━━━━━━━━━━━━━━
${report.openedAt.toLocaleString('es-ES', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })}`;
    }

    async sendTestMessage(): Promise<void> {
        if (!this.WHATSAPP_ENABLED || !this.isReady) {
            this.logger.warn('📱 WhatsApp no disponible para test');
            return;
        }

        const testMessage = `🤖 *VolBot Test*

✅ WhatsApp conectado correctamente!
⏰ ${new Date().toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })}`;

        try {
            // Formatear el número correctamente
            let chatId = this.WHATSAPP_NUMBER;
            if (!chatId.includes('@')) {
                chatId = `${chatId}@c.us`;
            }

            this.logger.log(`📱 Enviando mensaje de test a: ${chatId}`);

            // Verificar que el cliente esté realmente listo
            const state = await this.client.getState();
            this.logger.log(`📱 Estado de WhatsApp: ${state}`);

            if (state !== 'CONNECTED') {
                this.logger.warn('📱 WhatsApp no está completamente conectado');
                return;
            }

            await this.client.sendMessage(chatId, testMessage);
            this.logger.log('📱 Mensaje de test enviado correctamente');
        } catch (error) {
            this.logger.error('❌ Error enviando mensaje de test:', this.getErrorMessage(error));

            // Intentar obtener más información sobre el error
            try {
                const info = await this.client.info;
                this.logger.log(`📱 Info de WhatsApp: ${JSON.stringify(info)}`);
            } catch (infoError) {
                this.logger.error('❌ No se pudo obtener info de WhatsApp');
            }
        }
    }

    isConnected(): boolean {
        return this.isReady;
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
