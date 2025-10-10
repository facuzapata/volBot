import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { User } from '../entities/user.entity';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    async getAllUsers(): Promise<User[]> {
        return this.usersService.findAll();
    }

    @Get('active')
    async getActiveUsers(): Promise<User[]> {
        return this.usersService.findActiveUsers();
    }

    @Get(':id')
    async getUserById(@Param('id') id: string): Promise<User | null> {
        return this.usersService.findById(id);
    }

    @Post()
    async createUser(@Body() userData: {
        email: string;
        name: string;
        capitalForSignals?: number;
        capitalPerTrade?: number;
        profitMargin?: number;
        sellMargin?: number;
        maxActiveSignals?: number;
    }): Promise<User> {
        return this.usersService.createUser(userData);
    }

    @Post(':id/credentials')
    async addCredentials(
        @Param('id') userId: string,
        @Body() credentialsData: {
            apiKey: string;
            apiSecret: string;
            isTestnet?: boolean;
            description?: string;
        }
    ) {
        return this.usersService.addCredentials(userId, credentialsData);
    }

    @Put(':id/config')
    async updateConfig(
        @Param('id') userId: string,
        @Body() config: {
            capitalForSignals?: number;
            capitalPerTrade?: number;
            profitMargin?: number;
            sellMargin?: number;
            maxActiveSignals?: number;
        }
    ): Promise<User> {
        return this.usersService.updateUserConfig(userId, config);
    }

    @Put(':id/status')
    async toggleStatus(
        @Param('id') userId: string,
        @Body() { isActive }: { isActive: boolean }
    ): Promise<User> {
        return this.usersService.toggleUserStatus(userId, isActive);
    }
}