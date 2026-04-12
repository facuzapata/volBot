// Interfaz para notificaciones dirigidas a usuarios específicos
export interface UserNotification {
    userId: string;
    message: string;
    messageType: 'trade_open' | 'trade_close' | 'system' | 'warning' | 'error';
}

export interface NotificationResult {
    success: boolean;
    channel: 'telegram' | 'whatsapp' | 'both';
    telegramSent?: boolean;
    whatsappSent?: boolean;
    errors?: string[];
}
