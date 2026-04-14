import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { UserCredentials } from './user-credentials.entity';

export enum UserRole {
    ADMIN = 'admin',
    USER = 'user'
}

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ unique: true })
    email!: string;

    @Column()
    name!: string;

    @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
    passwordHash!: string | null;

    @Column({
        type: 'enum',
        enum: UserRole,
        default: UserRole.USER
    })
    role!: UserRole;

    @Column('decimal', { precision: 10, scale: 2, default: 100 })
    capitalForSignals!: number;

    @Column('decimal', { precision: 5, scale: 4, default: 0.005 })
    profitMargin!: number;

    @Column('decimal', { precision: 5, scale: 4, default: 0.004 })
    sellMargin!: number;

    @Column('int', { default: 3 })
    maxActiveSignals!: number;

    @Column('boolean', { default: true })
    isActive!: boolean;

    @Column('decimal', { precision: 5, scale: 2, default: 20 })
    capitalPerTrade!: number;

    // 📱 Canales de notificación
    @Column({ nullable: true })
    telegramChatId!: string;

    @Column({ nullable: true })
    whatsappNumber!: string;

    @Column('boolean', { default: true })
    telegramEnabled!: boolean;

    @Column('boolean', { default: true })
    whatsappEnabled!: boolean;

    @OneToMany(() => UserCredentials, credentials => credentials.user)
    credentials!: UserCredentials[];

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}