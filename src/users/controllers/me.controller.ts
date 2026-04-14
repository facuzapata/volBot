import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthUser } from '../../auth/interfaces/auth-user.interface';
import { SignalStatus } from '../../strategy/entities/signal.entity';
import { DashboardService } from '../services/dashboard.service';
import { UsersService } from '../services/users.service';

@ApiTags('Me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
    constructor(
        private readonly usersService: UsersService,
        private readonly dashboardService: DashboardService
    ) { }

    @Get('profile')
    @ApiOperation({ summary: 'Obtener mi perfil' })
    async getProfile(@CurrentUser() user: AuthUser) {
        return this.usersService.findById(user.userId);
    }

    @Put('profile')
    @ApiOperation({ summary: 'Actualizar mi perfil' })
    async updateProfile(
        @CurrentUser() user: AuthUser,
        @Body() profile: {
            name?: string;
            telegramChatId?: string;
            whatsappNumber?: string;
            telegramEnabled?: boolean;
            whatsappEnabled?: boolean;
        }
    ) {
        return this.usersService.updateOwnProfile(user.userId, profile);
    }

    @Get('signals')
    @ApiOperation({ summary: 'Listar mis señales' })
    async getMySignals(
        @CurrentUser() user: AuthUser,
        @Query('status') status?: SignalStatus,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string
    ) {
        return this.dashboardService.getMySignals(user.userId, {
            status,
            limit: limit ? Number(limit) : undefined,
            offset: offset ? Number(offset) : undefined,
        });
    }

    @Get('signals/:id')
    @ApiOperation({ summary: 'Obtener una señal propia por id' })
    async getMySignalById(@CurrentUser() user: AuthUser, @Param('id') signalId: string) {
        return this.dashboardService.getSignalForUser(user.userId, signalId);
    }

    @Patch('signals/:id/cancel')
    @ApiOperation({ summary: 'Cancelar una señal propia' })
    async cancelMySignal(@CurrentUser() user: AuthUser, @Param('id') signalId: string) {
        return this.dashboardService.cancelSignal(signalId, user.userId, false);
    }

    @Get('analytics')
    @ApiOperation({ summary: 'Ver analítica personal' })
    async getMyAnalytics(@CurrentUser() user: AuthUser) {
        return this.dashboardService.getMyAnalytics(user.userId);
    }

    @Get('trade-configs')
    @ApiOperation({ summary: 'Listar mis configuraciones de trading' })
    async getMyTradeConfigs(@CurrentUser() user: AuthUser) {
        return this.dashboardService.getMyTradeConfigs(user.userId);
    }

    @Post('trade-configs')
    @ApiOperation({ summary: 'Crear configuración de trading propia' })
    async createMyTradeConfig(
        @CurrentUser() user: AuthUser,
        @Body() body: {
            symbol: string;
            timeframeMinutes: number;
            profitMarginOverride?: number;
            sellMarginOverride?: number;
            maxActiveSignalsOverride?: number;
            capitalPerTradeOverride?: number;
            notes?: string;
        }
    ) {
        return this.dashboardService.createMyTradeConfig(user.userId, body);
    }

    @Put('trade-configs/:id')
    @ApiOperation({ summary: 'Actualizar configuración de trading propia' })
    async updateMyTradeConfig(
        @CurrentUser() user: AuthUser,
        @Param('id') configId: string,
        @Body() body: {
            symbol?: string;
            timeframeMinutes?: number;
            profitMarginOverride?: number;
            sellMarginOverride?: number;
            maxActiveSignalsOverride?: number;
            capitalPerTradeOverride?: number;
            notes?: string;
        }
    ) {
        return this.dashboardService.updateMyTradeConfig(user.userId, configId, body);
    }

    @Patch('trade-configs/:id/toggle')
    @ApiOperation({ summary: 'Activar/desactivar configuración de trading propia' })
    async toggleMyTradeConfig(
        @CurrentUser() user: AuthUser,
        @Param('id') configId: string,
        @Body() body: { enabled: boolean }
    ) {
        return this.dashboardService.setMyTradeConfigEnabled(user.userId, configId, body.enabled);
    }

    @Delete('trade-configs/:id')
    @ApiOperation({ summary: 'Eliminar configuración de trading propia' })
    async deleteMyTradeConfig(@CurrentUser() user: AuthUser, @Param('id') configId: string) {
        await this.dashboardService.deleteMyTradeConfig(user.userId, configId);
        return { ok: true };
    }
}
