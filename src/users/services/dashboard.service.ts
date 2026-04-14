import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalStatus } from '../../strategy/entities/signal.entity';
import { Movement, MovementStatus } from '../../strategy/entities/movement.entity';
import { UserTradeConfig } from '../entities/user-trade-config.entity';
import { UserTradeConfigService, CreateTradeConfigDto } from './user-trade-config.service';
import { UsersService } from './users.service';

@Injectable()
export class DashboardService {
    constructor(
        @InjectRepository(Signal)
        private readonly signalRepository: Repository<Signal>,
        @InjectRepository(Movement)
        private readonly movementRepository: Repository<Movement>,
        @InjectRepository(UserTradeConfig)
        private readonly userTradeConfigRepository: Repository<UserTradeConfig>,
        private readonly userTradeConfigService: UserTradeConfigService,
        private readonly usersService: UsersService
    ) { }

    async getMySignals(userId: string, options?: { status?: SignalStatus; limit?: number; offset?: number }) {
        const query = this.signalRepository.createQueryBuilder('signal')
            .leftJoinAndSelect('signal.movements', 'movements')
            .where('signal.userId = :userId', { userId })
            .orderBy('signal.createdAt', 'DESC');

        if (options?.status) {
            query.andWhere('signal.status = :status', { status: options.status });
        }

        if (typeof options?.limit === 'number') {
            query.limit(options.limit);
        }

        if (typeof options?.offset === 'number') {
            query.offset(options.offset);
        }

        return query.getMany();
    }

    async getSignalForUser(userId: string, signalId: string, isAdmin = false): Promise<Signal> {
        const signal = await this.signalRepository.findOne({
            where: { id: signalId },
            relations: ['movements']
        });

        if (!signal) {
            throw new NotFoundException('Señal no encontrada');
        }

        if (!isAdmin && signal.userId !== userId) {
            throw new ForbiddenException('No tienes permisos para ver esta señal');
        }

        return signal;
    }

    async cancelSignal(signalId: string, requesterUserId: string, isAdmin = false): Promise<Signal> {
        const signal = await this.signalRepository.findOne({
            where: { id: signalId },
            relations: ['movements']
        });

        if (!signal) {
            throw new NotFoundException('Señal no encontrada');
        }

        if (!isAdmin && signal.userId !== requesterUserId) {
            throw new ForbiddenException('No puedes cancelar una señal de otro usuario');
        }

        if (signal.status !== SignalStatus.ACTIVE) {
            throw new BadRequestException(`Solo se pueden cancelar señales activas. Estado actual: ${signal.status}`);
        }

        signal.status = SignalStatus.CANCELLED;
        signal.closedAt = new Date();
        const updatedSignal = await this.signalRepository.save(signal);

        await this.movementRepository
            .createQueryBuilder()
            .update(Movement)
            .set({ status: MovementStatus.CANCELLED })
            .where('signalId = :signalId', { signalId })
            .andWhere('status = :status', { status: MovementStatus.PENDING })
            .execute();

        return updatedSignal;
    }

    async getMyAnalytics(userId: string) {
        return this.getStatsForUser(userId);
    }

    async getOverviewAnalytics() {
        const [totalSignals, activeSignals, matchedSignals] = await Promise.all([
            this.signalRepository.count(),
            this.signalRepository.count({ where: { status: SignalStatus.ACTIVE } }),
            this.signalRepository.count({ where: { status: SignalStatus.MATCHED } })
        ]);

        const profitResult = await this.signalRepository
            .createQueryBuilder('signal')
            .select('COALESCE(SUM(signal.totalProfit), 0)', 'totalProfit')
            .addSelect('COALESCE(SUM(signal.totalCommission), 0)', 'totalCommission')
            .addSelect('COALESCE(SUM(signal.netProfit), 0)', 'totalNetProfit')
            .where('signal.status = :status', { status: SignalStatus.MATCHED })
            .getRawOne();

        const profitableSignals = await this.signalRepository
            .createQueryBuilder('signal')
            .where('signal.status = :status', { status: SignalStatus.MATCHED })
            .andWhere('signal.netProfit > 0')
            .getCount();

        const totalNetProfit = Number(profitResult.totalNetProfit || 0);
        const successRate = matchedSignals > 0 ? (profitableSignals / matchedSignals) * 100 : 0;

        return {
            totalSignals,
            activeSignals,
            matchedSignals,
            totalProfit: Number(profitResult.totalProfit || 0),
            totalCommission: Number(profitResult.totalCommission || 0),
            totalNetProfit,
            successRate,
            avgProfitPerSignal: matchedSignals > 0 ? totalNetProfit / matchedSignals : 0
        };
    }

    async getAllSignals(options?: { status?: SignalStatus; limit?: number; offset?: number }) {
        const query = this.signalRepository.createQueryBuilder('signal')
            .leftJoinAndSelect('signal.movements', 'movements')
            .orderBy('signal.createdAt', 'DESC');

        if (options?.status) {
            query.andWhere('signal.status = :status', { status: options.status });
        }

        if (typeof options?.limit === 'number') {
            query.limit(options.limit);
        }

        if (typeof options?.offset === 'number') {
            query.offset(options.offset);
        }

        return query.getMany();
    }

    async getMyTradeConfigs(userId: string) {
        return this.userTradeConfigRepository.find({
            where: { userId },
            order: { symbol: 'ASC', timeframeMinutes: 'ASC' }
        });
    }

    async getTradeConfigById(configId: string): Promise<UserTradeConfig> {
        const config = await this.userTradeConfigRepository.findOne({ where: { id: configId } });

        if (!config) {
            throw new NotFoundException('Configuración no encontrada');
        }

        return config;
    }

    async createMyTradeConfig(userId: string, dto: CreateTradeConfigDto) {
        return this.userTradeConfigService.createConfig(userId, dto);
    }

    async updateMyTradeConfig(userId: string, configId: string, dto: Partial<CreateTradeConfigDto>) {
        const config = await this.getTradeConfigById(configId);

        if (config.userId !== userId) {
            throw new ForbiddenException('No puedes editar configuraciones de otro usuario');
        }

        return this.userTradeConfigService.updateConfig(configId, dto);
    }

    async setMyTradeConfigEnabled(userId: string, configId: string, enabled: boolean) {
        const config = await this.getTradeConfigById(configId);

        if (config.userId !== userId) {
            throw new ForbiddenException('No puedes modificar configuraciones de otro usuario');
        }

        return this.userTradeConfigService.setEnabled(configId, enabled);
    }

    async deleteMyTradeConfig(userId: string, configId: string) {
        const config = await this.getTradeConfigById(configId);

        if (config.userId !== userId) {
            throw new ForbiddenException('No puedes eliminar configuraciones de otro usuario');
        }

        await this.userTradeConfigService.deleteConfig(configId);
    }

    async getAdminUserAnalytics(userId: string) {
        return this.getStatsForUser(userId);
    }

    async getAdminUsers() {
        return this.usersService.findAll();
    }

    private async getStatsForUser(userId: string) {
        const [totalSignals, activeSignals, matchedSignals] = await Promise.all([
            this.signalRepository.count({ where: { userId } }),
            this.signalRepository.count({ where: { userId, status: SignalStatus.ACTIVE } }),
            this.signalRepository.count({ where: { userId, status: SignalStatus.MATCHED } })
        ]);

        const profitResult = await this.signalRepository
            .createQueryBuilder('signal')
            .select('COALESCE(SUM(signal.totalProfit), 0)', 'totalProfit')
            .addSelect('COALESCE(SUM(signal.totalCommission), 0)', 'totalCommission')
            .addSelect('COALESCE(SUM(signal.netProfit), 0)', 'totalNetProfit')
            .where('signal.userId = :userId', { userId })
            .andWhere('signal.status = :status', { status: SignalStatus.MATCHED })
            .getRawOne();

        const profitableSignals = await this.signalRepository
            .createQueryBuilder('signal')
            .where('signal.userId = :userId', { userId })
            .andWhere('signal.status = :status', { status: SignalStatus.MATCHED })
            .andWhere('signal.netProfit > 0')
            .getCount();

        const totalNetProfit = Number(profitResult.totalNetProfit || 0);
        const successRate = matchedSignals > 0 ? (profitableSignals / matchedSignals) * 100 : 0;

        return {
            totalSignals,
            activeSignals,
            matchedSignals,
            totalProfit: Number(profitResult.totalProfit || 0),
            totalCommission: Number(profitResult.totalCommission || 0),
            totalNetProfit,
            successRate,
            avgProfitPerSignal: matchedSignals > 0 ? totalNetProfit / matchedSignals : 0
        };
    }
}
