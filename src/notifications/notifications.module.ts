import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { TelegramService } from './telegram.service';

@Module({
    providers: [WhatsAppService, TelegramService],
    exports: [WhatsAppService, TelegramService]
})
export class NotificationsModule { }
