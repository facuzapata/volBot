import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../users/services/users.service';
import { JwtPayload } from '../interfaces/auth-user.interface';

@Injectable()
export class AuthService {
    constructor(
        private readonly usersService: UsersService,
        private readonly jwtService: JwtService
    ) { }

    async login(email: string, password: string): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string;
            role: string;
            isActive: boolean;
        };
    }> {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.usersService.findAuthByEmail(normalizedEmail);

        if (!user || !user.isActive || !user.passwordHash) {
            throw new UnauthorizedException('Usuario no encontrado o inactivo');
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role
        };

        return {
            accessToken: await this.jwtService.signAsync(payload),
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                isActive: user.isActive
            }
        };
    }
}
