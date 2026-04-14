import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../entities/user.entity';
import { UserCredentials } from '../entities/user-credentials.entity';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(UserCredentials)
        private credentialsRepository: Repository<UserCredentials>
    ) { }

    async findAll(): Promise<User[]> {
        return this.userRepository.find({
            relations: ['credentials']
        });
    }

    async findActiveUsers(): Promise<User[]> {
        return this.userRepository.find({
            where: { isActive: true },
            relations: ['credentials']
        });
    }

    async findById(id: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { id },
            relations: ['credentials']
        });
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { email },
            relations: ['credentials']
        });
    }

    async findAuthByEmail(email: string): Promise<User | null> {
        return this.userRepository
            .createQueryBuilder('user')
            .addSelect('user.passwordHash')
            .where('user.email = :email', { email })
            .getOne();
    }

    async createUser(userData: {
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
        const passwordHash = await bcrypt.hash(userData.password, 10);

        const user = this.userRepository.create({
            ...userData,
            email: userData.email.toLowerCase().trim(),
            passwordHash
        });
        return this.userRepository.save(user);
    }

    async updateUserPassword(userId: string, password: string): Promise<void> {
        const passwordHash = await bcrypt.hash(password, 10);
        await this.userRepository.update(userId, { passwordHash });
    }

    async updateOwnProfile(userId: string, profile: {
        name?: string;
        telegramChatId?: string;
        whatsappNumber?: string;
        telegramEnabled?: boolean;
        whatsappEnabled?: boolean;
    }): Promise<User> {
        await this.userRepository.update(userId, profile);
        const updatedUser = await this.findById(userId);
        if (!updatedUser) {
            throw new Error(`Usuario ${userId} no encontrado`);
        }
        return updatedUser;
    }

    async addCredentials(userId: string, credentialsData: {
        apiKey: string;
        apiSecret: string;
        isTestnet?: boolean;
        description?: string;
    }): Promise<UserCredentials> {
        const credentials = this.credentialsRepository.create({
            ...credentialsData,
            userId
        });
        return this.credentialsRepository.save(credentials);
    }

    async updateUserConfig(userId: string, config: {
        capitalForSignals?: number;
        capitalPerTrade?: number;
        profitMargin?: number;
        sellMargin?: number;
        maxActiveSignals?: number;
    }): Promise<User> {
        await this.userRepository.update(userId, config);
        const updatedUser = await this.findById(userId);
        if (!updatedUser) {
            throw new Error(`Usuario ${userId} no encontrado`);
        }
        return updatedUser;
    }

    async toggleUserStatus(userId: string, isActive: boolean): Promise<User> {
        await this.userRepository.update(userId, { isActive });
        const updatedUser = await this.findById(userId);
        if (!updatedUser) {
            throw new Error(`Usuario ${userId} no encontrado`);
        }
        return updatedUser;
    }
}