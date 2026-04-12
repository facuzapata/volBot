import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserCredentials } from './entities/user-credentials.entity';
import { UserTradeConfig } from './entities/user-trade-config.entity';
import { UsersService } from './services/users.service';
import { UserTradeConfigService } from './services/user-trade-config.service';
import { UsersController } from './controllers/users.controller';

@Module({
    imports: [TypeOrmModule.forFeature([User, UserCredentials, UserTradeConfig])],
    providers: [UsersService, UserTradeConfigService],
    controllers: [UsersController],
    exports: [UsersService, UserTradeConfigService],
})
export class UsersModule { }