import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { User, UserRole } from '../entities/user.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    @ApiOperation({ summary: 'Listar todos los usuarios (admin)' })
    async getAllUsers(): Promise<User[]> {
        return this.usersService.findAll();
    }

    @Get('active')
    @ApiOperation({ summary: 'Listar usuarios activos (admin)' })
    async getActiveUsers(): Promise<User[]> {
        return this.usersService.findActiveUsers();
    }

    @Get(':id')
    @ApiOperation({ summary: 'Obtener usuario por id (admin)' })
    async getUserById(@Param('id') id: string): Promise<User | null> {
        return this.usersService.findById(id);
    }

    @Post()
    @ApiOperation({ summary: 'Crear usuario (admin)' })
    async createUser(@Body() userData: {
        email: string;
        name: string;
        password: string;
        role?: UserRole;
        capitalForSignals?: number;
        capitalPerTrade?: number;
        profitMargin?: number;
        sellMargin?: number;
        maxActiveSignals?: number;
    }): Promise<User> {
        return this.usersService.createUser(userData);
    }

    @Post(':id/credentials')
    @ApiOperation({ summary: 'Agregar credenciales Binance a un usuario (admin)' })
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
    @ApiOperation({ summary: 'Actualizar config de usuario (admin)' })
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
    @ApiOperation({ summary: 'Cambiar estado de usuario (admin)' })
    async toggleStatus(
        @Param('id') userId: string,
        @Body() { isActive }: { isActive: boolean }
    ): Promise<User> {
        return this.usersService.toggleUserStatus(userId, isActive);
    }
}