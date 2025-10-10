import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('user_credentials')
export class UserCredentials {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    apiKey: string;

    @Column()
    apiSecret: string;

    @Column('boolean', { default: false })
    isTestnet: boolean;

    @Column('boolean', { default: true })
    isActive: boolean;

    @Column({ nullable: true })
    description: string;

    @ManyToOne(() => User, user => user.credentials)
    user: User;

    @Column()
    userId: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}