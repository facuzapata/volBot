import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';
import { User } from './user.entity';

@Entity('user_trade_configs')
@Unique(['userId', 'symbol', 'timeframeMinutes'])
export class UserTradeConfig {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column()
    userId!: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user!: User;

    // Par de trading (ej: BTCUSDT, ETHUSDT, ADAUSDT)
    @Column({ length: 20 })
    symbol!: string;

    // Timeframe en minutos (ej: 1, 5, 15, 60, 240)
    @Column('int')
    timeframeMinutes!: number;

    // ¿Está habilitado para este usuario?
    @Column('boolean', { default: true })
    isEnabled!: boolean;

    // Configuración específica por símbolo (opcional, override de user defaults)
    @Column('decimal', { precision: 5, scale: 4, nullable: true })
    profitMarginOverride!: number; // null = usar profitMargin del usuario

    @Column('decimal', { precision: 5, scale: 4, nullable: true })
    sellMarginOverride!: number; // null = usar sellMargin del usuario

    @Column('int', { nullable: true })
    maxActiveSignalsOverride!: number; // null = usar maxActiveSignals del usuario

    @Column('decimal', { precision: 5, scale: 2, nullable: true })
    capitalPerTradeOverride!: number; // null = usar capitalPerTrade del usuario

    // Notas/descripción para este símbolo
    @Column({ nullable: true })
    notes!: string;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
