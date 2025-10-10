import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn } from 'typeorm';
import { Signal } from './signal.entity';

export enum MovementType {
    BUY = 'buy',
    SELL = 'sell'
}

export enum MovementStatus {
    PENDING = 'pending',
    FILLED = 'filled',
    CANCELLED = 'cancelled',
    FAILED = 'failed'
}

@Entity('movements')
export class Movement {

    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'enum', enum: MovementType })
    type: MovementType;

    @Column({ type: 'enum', enum: MovementStatus, default: MovementStatus.PENDING })
    status: MovementStatus;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    price: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    quantity: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    totalAmount: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    commission: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    netAmount: number;

    // Datos de auditoría de Binance
    @Column({ type: 'varchar', length: 50, nullable: true })
    binanceOrderId: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    binanceClientOrderId: string;

    @Column({ type: 'jsonb', nullable: true })
    binanceResponse: any;

    @Column({ type: 'jsonb', nullable: true })
    binanceError: any;

    @Column({ type: 'timestamp', nullable: true })
    executedAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Signal, signal => signal.movements)
    @JoinColumn({ name: 'signal_id' })
    signal: Signal;

    @Column({ name: 'signal_id' })
    signalId: string;
}
