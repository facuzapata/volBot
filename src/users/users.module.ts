import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserCredentials } from './entities/user-credentials.entity';
import { UserTradeConfig } from './entities/user-trade-config.entity';
import { UsersService } from './services/users.service';
import { UserTradeConfigService } from './services/user-trade-config.service';
import { DashboardService } from './services/dashboard.service';
import { UsersController } from './controllers/users.controller';
import { MeController } from './controllers/me.controller';
import { AdminController } from './controllers/admin.controller';
import { Signal, Movement } from '../strategy/entities';

@Module({
    imports: [TypeOrmModule.forFeature([User, UserCredentials, UserTradeConfig, Signal, Movement])],
    providers: [UsersService, UserTradeConfigService, DashboardService],
    controllers: [UsersController, MeController, AdminController],
    exports: [UsersService, UserTradeConfigService, DashboardService],
})
export class UsersModule { }