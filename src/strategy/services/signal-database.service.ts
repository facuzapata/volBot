import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalStatus } from '../entities/signal.entity';
import { Movement, MovementType, MovementStatus } from '../entities/movement.entity';
import { WhatsAppService, TradeReport } from '../../notifications/whatsapp.service';

@Injectable()
export class SignalDatabaseService {
    private readonly logger = new Logger(SignalDatabaseService.name);

    constructor(
        @InjectRepository(Signal)
        private signalRepository: Repository<Signal>,
        @InjectRepository(Movement)
        private movementRepository: Repository<Movement>,
        private readonly whatsappService: WhatsAppService
    ) { }

    async createSignal(signalData: {
        symbol: string;
        initialPrice: number;
        stopLoss: number;
        takeProfit: number;
        atr: number;
        rsi: number;
        macd: number;
        smaShort: number;
        smaLong: number;
        volume: number;
        paperTrading: boolean;
    }): Promise<Signal> {
        const signal = this.signalRepository.create({
            ...signalData,
            status: SignalStatus.ACTIVE,
            finalPrice: 0,
            totalProfit: 0,
            totalCommission: 0,
            netProfit: 0,
        });

        const savedSignal = await this.signalRepository.save(signal);
        this.logger.log(`📊 Nueva señal creada: ${savedSignal.id} - ${savedSignal.symbol} @ ${savedSignal.initialPrice}`);
        return savedSignal;
    }

    async createMovement(movementData: {
        signalId: string;
        type: MovementType;
        price: number;
        quantity: number;
        totalAmount: number;
        commission: number;
        netAmount: number;
        binanceOrderId?: string;
        binanceClientOrderId?: string;
        binanceResponse?: any;
        binanceError?: any;
    }): Promise<Movement> {
        // Validar valores numéricos antes de crear el movimiento
        const numericValues = {
            price: movementData.price,
            quantity: movementData.quantity,
            totalAmount: movementData.totalAmount,
            commission: movementData.commission,
            netAmount: movementData.netAmount
        };

        for (const [key, value] of Object.entries(numericValues)) {
            if (!isFinite(value) || isNaN(value)) {
                this.logger.error(`❌ Valor inválido en createMovement ${key}: ${value}`);
                this.logger.error(`📊 Datos del movimiento:`, movementData);
                throw new Error(`Valor inválido para ${key}: ${value}`);
            }
        }

        const movement = this.movementRepository.create({
            ...movementData,
            status: MovementStatus.PENDING,
        });

        const savedMovement = await this.movementRepository.save(movement);
        this.logger.log(`💱 Nuevo movimiento creado: ${savedMovement.id} - ${savedMovement.type.toUpperCase()} @ ${savedMovement.price}`);
        return savedMovement;
    }

    async updateMovementStatus(
        movementId: string,
        status: MovementStatus,
        binanceData?: {
            binanceOrderId?: string;
            binanceClientOrderId?: string;
            binanceResponse?: any;
            binanceError?: any;
        }
    ): Promise<Movement> {
        const movement = await this.movementRepository.findOne({
            where: { id: movementId },
            relations: ['signal']
        });

        if (!movement) {
            throw new Error(`Movement with id ${movementId} not found`);
        }

        movement.status = status;
        if (status === MovementStatus.FILLED) {
            movement.executedAt = new Date();
        }

        if (binanceData) {
            Object.assign(movement, binanceData);
        }

        const updatedMovement = await this.movementRepository.save(movement);
        this.logger.log(`🔄 Movimiento actualizado: ${updatedMovement.id} - ${updatedMovement.status.toUpperCase()}`);

        // Verificar si la señal debe cerrarse cuando el movimiento se marca como FILLED
        if (status === MovementStatus.FILLED) {
            this.logger.log(`🔍 Movimiento marcado como FILLED, verificando cierre de señal ${movement.signalId}...`);
            await this.checkAndCloseSignal(movement.signalId);
        }

        return updatedMovement;
    }

    private async checkAndCloseSignal(signalId: string): Promise<void> {
        const signal = await this.signalRepository.findOne({
            where: { id: signalId },
            relations: ['movements']
        });

        if (!signal) {
            this.logger.warn(`⚠️ No se encontró señal con ID: ${signalId}`);
            return;
        }

        const movements = signal.movements;
        const buyMovements = movements.filter(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
        const sellMovements = movements.filter(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED);

        this.logger.log(`🔍 Verificando cierre de señal ${signalId}:`);
        this.logger.log(`  📊 Total movimientos: ${movements.length}`);
        this.logger.log(`  🟢 Compras FILLED: ${buyMovements.length}`);
        this.logger.log(`  🔴 Ventas FILLED: ${sellMovements.length}`);
        this.logger.log(`  📈 Status actual de la señal: ${signal.status}`);

        // Si tenemos al menos una compra y una venta, podemos cerrar la señal
        if (buyMovements.length > 0 && sellMovements.length > 0) {
            this.logger.log(`✅ CONDICIONES CUMPLIDAS - Cerrando señal ${signalId}`);
            this.logger.log(`  - Compras ejecutadas: ${buyMovements.length}`);
            this.logger.log(`  - Ventas ejecutadas: ${sellMovements.length}`);
            await this.closeSignal(signalId, buyMovements, sellMovements);
        } else {
            this.logger.debug(`⏳ Señal ${signalId} aún no lista para cerrar:`);
            this.logger.debug(`  - Faltan compras FILLED: ${buyMovements.length === 0 ? 'SÍ' : 'NO'}`);
            this.logger.debug(`  - Faltan ventas FILLED: ${sellMovements.length === 0 ? 'SÍ' : 'NO'}`);
        }
    }

    private async closeSignal(signalId: string, buyMovements: Movement[], sellMovements: Movement[]): Promise<void> {
        // Calcular el precio final promedio de venta con validación
        const totalSellAmount = sellMovements.reduce((sum, m) => {
            const amount = Number(m.totalAmount);
            return sum + (isFinite(amount) && !isNaN(amount) ? amount : 0);
        }, 0);

        const totalSellQuantity = sellMovements.reduce((sum, m) => {
            const quantity = Number(m.quantity);
            return sum + (isFinite(quantity) && !isNaN(quantity) ? quantity : 0);
        }, 0);

        const avgSellPrice = totalSellQuantity > 0 ? totalSellAmount / totalSellQuantity : 0;

        // Debug: mostrar detalles de los movimientos
        this.logger.debug(`🔍 Detalles de movimientos para cierre de señal ${signalId}:`);
        buyMovements.forEach((m, index) => {
            this.logger.debug(`  📊 Compra ${index + 1}: totalAmount=${m.totalAmount}, commission=${m.commission}, quantity=${m.quantity}`);
        });
        sellMovements.forEach((m, index) => {
            this.logger.debug(`  📊 Venta ${index + 1}: totalAmount=${m.totalAmount}, commission=${m.commission}, quantity=${m.quantity}`);
        });

        // Calcular comisiones totales con validación
        let totalCommission = 0;
        [...buyMovements, ...sellMovements].forEach((m, index) => {
            const commission = Number(m.commission);
            if (!isFinite(commission) || isNaN(commission)) {
                this.logger.warn(`⚠️ Comisión inválida en movimiento ${index}: ${m.commission} -> usando 0`);
            } else {
                totalCommission += commission;
            }
        });

        // Calcular beneficio bruto
        const totalBuyAmount = buyMovements.reduce((sum, m) => {
            const amount = Number(m.totalAmount);
            return sum + (isFinite(amount) && !isNaN(amount) ? amount : 0);
        }, 0);
        const totalProfit = totalSellAmount - totalBuyAmount;

        // Calcular beneficio neto
        const netProfit = totalProfit - totalCommission;

        this.logger.debug(`📊 Cálculos de cierre:`);
        this.logger.debug(`  💰 Total venta: ${totalSellAmount.toFixed(8)}`);
        this.logger.debug(`  💰 Total compra: ${totalBuyAmount.toFixed(8)}`);
        this.logger.debug(`  💰 Beneficio bruto: ${totalProfit.toFixed(8)}`);
        this.logger.debug(`  💰 Comisiones totales: ${totalCommission.toFixed(8)}`);
        this.logger.debug(`  💰 Beneficio neto: ${netProfit.toFixed(8)}`);

        // Validar valores antes de actualizar en base de datos
        const values = { avgSellPrice, totalCommission, totalProfit, netProfit, totalSellAmount, totalBuyAmount };
        for (const [key, value] of Object.entries(values)) {
            if (!isFinite(value) || isNaN(value)) {
                this.logger.error(`❌ Valor inválido en closeSignal ${key}: ${value}`);
                this.logger.error(`📊 Movimientos de compra:`, buyMovements.map(m => ({ totalAmount: m.totalAmount, commission: m.commission, quantity: m.quantity })));
                this.logger.error(`📊 Movimientos de venta:`, sellMovements.map(m => ({ totalAmount: m.totalAmount, commission: m.commission, quantity: m.quantity })));
                return;
            }
        }

        // Actualizar la señal
        await this.signalRepository.update(signalId, {
            status: SignalStatus.MATCHED,
            finalPrice: avgSellPrice,
            totalProfit,
            totalCommission,
            netProfit,
            closedAt: new Date()
        });

        this.logger.log(`✅ SEÑAL COMPLETADA: ${signalId}`);
        this.logger.log(`📊 Status actualizado: ACTIVE → MATCHED`);
        this.logger.log(`📊 Resumen: Precio final: ${avgSellPrice.toFixed(2)}, Beneficio bruto: ${totalProfit.toFixed(4)} USDT, Comisiones: ${totalCommission.toFixed(4)} USDT, Beneficio neto: ${netProfit.toFixed(4)} USDT`);
        this.logger.log(`💹 ROI: ${((netProfit / totalBuyAmount) * 100).toFixed(2)}%`);

        // Enviar reporte por WhatsApp
        await this.sendWhatsAppReport(signalId, buyMovements, sellMovements, {
            avgSellPrice,
            totalProfit,
            totalCommission,
            netProfit,
            totalBuyAmount,
            totalSellAmount
        });
    }

    private async sendWhatsAppReport(
        signalId: string,
        buyMovements: Movement[],
        sellMovements: Movement[],
        calculations: {
            avgSellPrice: number;
            totalProfit: number;
            totalCommission: number;
            netProfit: number;
            totalBuyAmount: number;
            totalSellAmount: number;
        }
    ): Promise<void> {
        try {
            // Obtener la señal completa
            const signal = await this.getSignalById(signalId);
            if (!signal) return;

            // Calcular duración de la operación
            const createdAt = new Date(signal.createdAt);
            const closedAt = new Date();
            const durationMs = closedAt.getTime() - createdAt.getTime();
            const hours = Math.floor(durationMs / (1000 * 60 * 60));
            const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
            const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

            // Calcular precios promedio - Los decimales de PostgreSQL vienen como strings
            const avgBuyPrice = buyMovements.reduce((sum, m) => sum + Number(m.price), 0) / buyMovements.length;

            // Debug detallado de cantidades - Los decimales de PostgreSQL vienen como strings
            this.logger.debug(`🔍 Debug cantidades de movimientos de compra:`);
            buyMovements.forEach((m, index) => {
                this.logger.debug(`  📊 Compra ${index + 1}: quantity=${m.quantity} (tipo: ${typeof m.quantity}, convertido: ${Number(m.quantity)})`);
            });

            let totalQuantity = buyMovements.reduce((sum, m) => {
                const quantity = Number(m.quantity); // Convertir string decimal a number
                if (!isFinite(quantity) || isNaN(quantity)) {
                    this.logger.warn(`⚠️ Cantidad inválida en movimiento: ${m.quantity} -> usando 0`);
                    return sum;
                }
                this.logger.debug(`  ➕ Sumando cantidad: ${quantity}, suma actual: ${sum + quantity}`);
                return sum + quantity;
            }, 0);

            this.logger.debug(`📊 Total quantity calculado: ${totalQuantity}`);

            // Validar que totalQuantity sea un número válido
            if (!isFinite(totalQuantity) || isNaN(totalQuantity) || totalQuantity <= 0) {
                this.logger.error(`❌ totalQuantity inválido: ${totalQuantity}, usando cantidad del primer movimiento de compra`);
                const fallbackQuantity = Number(buyMovements[0]?.quantity) || 0;
                totalQuantity = typeof fallbackQuantity === 'number' && isFinite(fallbackQuantity) ? fallbackQuantity : 0.0001;
                this.logger.error(`📊 Fallback quantity usado: ${totalQuantity}`);
            }

            // Calcular porcentajes
            const profitPercent = ((calculations.avgSellPrice - avgBuyPrice) / avgBuyPrice) * 100;
            const roi = (calculations.netProfit / calculations.totalBuyAmount) * 100;

            const report: TradeReport = {
                signalId,
                symbol: signal.symbol,
                buyPrice: avgBuyPrice,
                sellPrice: calculations.avgSellPrice,
                quantity: totalQuantity,
                totalBuyAmount: calculations.totalBuyAmount,
                totalSellAmount: calculations.totalSellAmount,
                grossProfit: calculations.totalProfit,
                totalCommission: calculations.totalCommission,
                netProfit: calculations.netProfit,
                profitPercent,
                roi,
                duration,
                paperTrading: signal.paperTrading
            };

            await this.whatsappService.sendTradeReport(report);
            this.logger.log(`📱 Reporte de WhatsApp enviado para señal ${signalId}`);

        } catch (error) {
            this.logger.error(`❌ Error enviando reporte de WhatsApp:`, error);
        }
    }

    async getActiveSignals(): Promise<Signal[]> {
        const activeSignals = await this.signalRepository.find({
            where: { status: SignalStatus.ACTIVE },
            relations: ['movements']
        });

        this.logger.debug(`🔍 Consulta getActiveSignals() encontró ${activeSignals.length} señales con status ACTIVE`);

        // Debug detallado de cada señal activa
        for (const signal of activeSignals) {
            const buyMovements = signal.movements.filter(m => m.type === MovementType.BUY && m.status === MovementStatus.FILLED);
            const sellMovements = signal.movements.filter(m => m.type === MovementType.SELL && m.status === MovementStatus.FILLED);

            this.logger.debug(`  📊 Señal ${signal.id}:`);
            this.logger.debug(`    - Status: ${signal.status}`);
            this.logger.debug(`    - Precio inicial: ${signal.initialPrice}`);
            this.logger.debug(`    - Total movimientos: ${signal.movements.length}`);
            this.logger.debug(`    - Compras FILLED: ${buyMovements.length}`);
            this.logger.debug(`    - Ventas FILLED: ${sellMovements.length}`);
            this.logger.debug(`    - Creada: ${signal.createdAt}`);

            // Si tiene compra y venta FILLED pero sigue como ACTIVE, algo está mal
            if (buyMovements.length > 0 && sellMovements.length > 0) {
                this.logger.warn(`⚠️ INCONSISTENCIA: Señal ${signal.id} tiene compra y venta FILLED pero sigue ACTIVE`);
                this.logger.warn(`    Intentando cerrar señal manualmente...`);
                await this.checkAndCloseSignal(signal.id);
            }
        }

        return activeSignals;
    }

    async getSignalById(id: string): Promise<Signal | null> {
        return this.signalRepository.findOne({
            where: { id },
            relations: ['movements']
        });
    }

    async getSignalHistory(limit: number = 50): Promise<Signal[]> {
        return this.signalRepository.find({
            order: { createdAt: 'DESC' },
            take: limit,
            relations: ['movements']
        });
    }

    async getSignalStatistics(): Promise<{
        totalSignals: number;
        activeSignals: number;
        matchedSignals: number;
        totalProfit: number;
        totalCommission: number;
        totalNetProfit: number;
        successRate: number;
        avgProfitPerSignal: number;
    }> {
        const [totalSignals, activeSignals, matchedSignals] = await Promise.all([
            this.signalRepository.count(),
            this.signalRepository.count({ where: { status: SignalStatus.ACTIVE } }),
            this.signalRepository.count({ where: { status: SignalStatus.MATCHED } })
        ]);

        const profitResult = await this.signalRepository
            .createQueryBuilder('signal')
            .select('SUM(signal.totalProfit)', 'totalProfit')
            .addSelect('SUM(signal.totalCommission)', 'totalCommission')
            .addSelect('SUM(signal.netProfit)', 'totalNetProfit')
            .where('signal.status = :status', { status: SignalStatus.MATCHED })
            .getRawOne();

        const totalProfit = parseFloat(profitResult.totalProfit || '0');
        const totalCommission = parseFloat(profitResult.totalCommission || '0');
        const totalNetProfit = parseFloat(profitResult.totalNetProfit || '0');

        const profitableSignals = await this.signalRepository.count({
            where: { status: SignalStatus.MATCHED, netProfit: { moreThan: 0 } } as any
        });

        const successRate = matchedSignals > 0 ? (profitableSignals / matchedSignals) * 100 : 0;
        const avgProfitPerSignal = matchedSignals > 0 ? totalNetProfit / matchedSignals : 0;

        return {
            totalSignals,
            activeSignals,
            matchedSignals,
            totalProfit,
            totalCommission,
            totalNetProfit,
            successRate,
            avgProfitPerSignal
        };
    }

    /**
     * Obtiene movimientos pendientes sin binanceOrderId (órdenes que fallaron al ejecutarse)
     */
    async getFailedMovements(olderThan: Date): Promise<Movement[]> {
        return await this.movementRepository.createQueryBuilder('movement')
            .leftJoinAndSelect('movement.signal', 'signal')
            .where('movement.status = :status', { status: MovementStatus.PENDING })
            .andWhere('movement.binanceOrderId IS NULL')
            .andWhere('movement.createdAt < :olderThan', { olderThan })
            .getMany();
    }

    /**
     * Obtiene movimientos pendientes que sí tienen binanceOrderId
     */
    async getPendingMovementsWithOrderId(): Promise<Movement[]> {
        return await this.movementRepository.createQueryBuilder('movement')
            .leftJoinAndSelect('movement.signal', 'signal')
            .where('movement.status = :status', { status: MovementStatus.PENDING })
            .andWhere('movement.binanceOrderId IS NOT NULL')
            .getMany();
    }
}
