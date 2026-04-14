import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsAppService } from './whatsapp.service';
import { TelegramService } from './telegram.service';
import { User } from '../users/entities/user.entity';

@Module({
    imports: [TypeOrmModule.forFeature([User])],
    providers: [WhatsAppService, TelegramService],
    exports: [WhatsAppService, TelegramService]
})
export class NotificationsModule { }
