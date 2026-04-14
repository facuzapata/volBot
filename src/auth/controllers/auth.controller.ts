import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../services/auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthUser } from '../interfaces/auth-user.interface';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    @ApiOperation({ summary: 'Login por email' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                email: { type: 'string', example: 'trader@example.com' },
                password: { type: 'string', example: 'StrongP@ssw0rd' }
            },
            required: ['email', 'password']
        }
    })
    async login(@Body() body: { email: string; password: string }) {
        return this.authService.login(body.email || '', body.password || '');
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Get('me')
    @ApiOperation({ summary: 'Usuario autenticado actual' })
    getMe(@CurrentUser() user: AuthUser) {
        return user;
    }
}
