import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Movement } from './movement.entity';

export enum SignalStatus {
    ACTIVE = 'active',
    MATCHED = 'matched',
    EXPIRED = 'expired',
    CANCELLED = 'cancelled'
}

@Entity('signals')
export class Signal {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 20 })
    symbol: string;

    @Column({ type: 'enum', enum: SignalStatus, default: SignalStatus.ACTIVE })
    status: SignalStatus;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    initialPrice: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    finalPrice: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    stopLoss: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    takeProfit: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    atr: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    rsi: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    macd: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    smaShort: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    smaLong: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    volume: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    totalProfit: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    totalCommission: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    netProfit: number;

    @Column({ type: 'boolean', default: true })
    paperTrading: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    closedAt: Date;

    @OneToMany(() => Movement, movement => movement.signal)
    movements: Movement[];
}
