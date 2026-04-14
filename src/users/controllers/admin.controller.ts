import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SignalStatus } from '../../strategy/entities/signal.entity';
import { DashboardService } from '../services/dashboard.service';
import { UsersService } from '../services/users.service';
import { UserRole } from '../entities/user.entity';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
    constructor(
        private readonly usersService: UsersService,
        private readonly dashboardService: DashboardService
    ) { }

    @Get('users')
    @ApiOperation({ summary: 'Listar usuarios (admin)' })
    async getUsers() {
        return this.dashboardService.getAdminUsers();
    }

    @Post('users')
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
    }) {
        return this.usersService.createUser(userData);
    }

    @Put('users/:id/config')
    @ApiOperation({ summary: 'Actualizar config de usuario (admin)' })
    async updateUserConfig(
        @Param('id') userId: string,
        @Body() config: {
            capitalForSignals?: number;
            capitalPerTrade?: number;
            profitMargin?: number;
            sellMargin?: number;
            maxActiveSignals?: number;
        }
    ) {
        return this.usersService.updateUserConfig(userId, config);
    }

    @Patch('users/:id/status')
    @ApiOperation({ summary: 'Activar/desactivar usuario (admin)' })
    async toggleUserStatus(@Param('id') userId: string, @Body() body: { isActive: boolean }) {
        return this.usersService.toggleUserStatus(userId, body.isActive);
    }

    @Patch('users/:id/password')
    @ApiOperation({ summary: 'Actualizar password de usuario (admin)' })
    async updateUserPassword(@Param('id') userId: string, @Body() body: { password: string }) {
        await this.usersService.updateUserPassword(userId, body.password);
        return { ok: true };
    }

    @Get('signals')
    @ApiOperation({ summary: 'Listar señales globales (admin)' })
    async getAllSignals(
        @Query('status') status?: SignalStatus,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string
    ) {
        return this.dashboardService.getAllSignals({
            status,
            limit: limit ? Number(limit) : undefined,
            offset: offset ? Number(offset) : undefined,
        });
    }

    @Get('signals/:id')
    @ApiOperation({ summary: 'Obtener señal por id (admin)' })
    async getSignalById(@Param('id') signalId: string) {
        return this.dashboardService.getSignalForUser('', signalId, true);
    }

    @Patch('signals/:id/cancel')
    @ApiOperation({ summary: 'Cancelar señal de cualquier usuario (admin)' })
    async cancelSignal(@Param('id') signalId: string) {
        return this.dashboardService.cancelSignal(signalId, '', true);
    }

    @Get('analytics/overview')
    @ApiOperation({ summary: 'Analítica global (admin)' })
    async getOverviewAnalytics() {
        return this.dashboardService.getOverviewAnalytics();
    }

    @Get('analytics/users/:id')
    @ApiOperation({ summary: 'Analítica por usuario (admin)' })
    async getUserAnalytics(@Param('id') userId: string) {
        return this.dashboardService.getAdminUserAnalytics(userId);
    }
}
