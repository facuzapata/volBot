import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DeliveryAttemptRow, V2User, StrategyValidationRow } from '../persistence/entities';
import { ApiService, publicUser } from './api.service';
import { Admin, AuthRequest, Public } from './auth';
import {
  AccountConfigResponseDto,
  BacktestDto,
  BacktestResponseDto,
  BalanceDto,
  CreateUserDto,
  EntriesDto,
  HealthDto,
  LoginDto,
  PageDto,
  PageResponseDto,
  PublicUserDto,
  RecordDto,
  StatsDto,
  StrategyResponseDto,
  TokenDto,
  TradingConfigDto,
  CandlesPageDto,
  FillsPageDto,
  LedgerPageDto,
  MarketQueryDto,
  MarketStatusDto,
  NotificationSettingsDto,
  OrderDto,
  OrdersPageDto,
  PositionDto,
  PositionsPageDto,
  UsersPageDto,
  RegisterValidationDto, DecideValidationDto,
} from './dtos';

function Contract(summary: string, response: new () => object, created = false) {
  return applyDecorators(
    ApiOperation({
      summary,
      description: `${summary}. Simulación exclusivamente; no se envían órdenes a Binance.`,
    }),
    created ? ApiCreatedResponse({ type: response }) : ApiOkResponse({ type: response }),
    ApiBadRequestResponse({ description: 'Invalid request or unknown fields' }),
    ApiUnauthorizedResponse({ description: 'Missing, invalid or revoked token' }),
    ApiForbiddenResponse({ description: 'Insufficient role' }),
    ApiNotFoundResponse({ description: 'Resource not found in this account' }),
    ApiConflictResponse({ description: 'Duplicate resource' }),
  );
}
@ApiTags('Authentication')
@Controller('auth')
export class AuthControllerV2 {
  constructor(private readonly api: ApiService) {}
  @Public()
  @Post('login')
  @HttpCode(200)
  @Contract('Iniciar sesión', TokenDto)
  login(@Body() body: LoginDto, @Req() req: AuthRequest) {
    return this.api.login(body.email, body.password, req.ip || 'unknown');
  }
}
@ApiTags('Paper account')
@ApiBearerAuth()
@Controller('me')
export class MeControllerV2 {
  constructor(private readonly api: ApiService) {}
  @Get()
  @Contract('Consultar mi perfil público', PublicUserDto)
  profile(@Req() req: AuthRequest) {
    return publicUser(req.user);
  }
  @Get('config')
  @Contract('Consultar mis límites', AccountConfigResponseDto)
  async config(@Req() req: AuthRequest) {
    return this.api.configuration((await this.api.state(req.user.id)).account);
  }
  @Patch('config')
  @Contract('Cambiar máximo simultáneo y USDT por operación', AccountConfigResponseDto)
  configure(@Req() req: AuthRequest, @Body() body: TradingConfigDto) {
    return this.api.configure(req.user.id, body);
  }
  @Patch('entries')
  @Contract('Iniciar o pausar nuevas entradas', AccountConfigResponseDto)
  entries(@Req() req: AuthRequest, @Body() body: EntriesDto) {
    return this.api.entries(req.user.id, body.enabled);
  }
  @Get('balance')
  @Contract('Consultar saldo virtual disponible, reservado e inventario asignado', BalanceDto)
  balance(@Req() req: AuthRequest) {
    return this.api.balance(req.user.id);
  }
  @Get('positions')
  @Contract('Consultar posiciones propias, abiertas y cerradas', PositionsPageDto)
  async positions(@Req() req: AuthRequest, @Query() q: PageDto) {
    return this.api.page((await this.api.state(req.user.id)).positions, q);
  }
  @Post('positions/:id/close')
  @HttpCode(200)
  @ApiParam({
    name: 'id',
    description: 'ID de posición propia',
    example: '<account>:<signal>:position',
  })
  @Contract('Solicitar cierre simulado en la próxima vela', PositionDto)
  close(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.api.close(req.user.id, id);
  }
  @Get('orders')
  @Contract('Consultar historial de órdenes simuladas', OrdersPageDto)
  async orders(@Req() req: AuthRequest, @Query() q: PageDto) {
    return this.api.page((await this.api.state(req.user.id)).orders, q);
  }
  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiParam({ name: 'id', description: 'ID de orden propia' })
  @Contract('Cancelar una orden simulada pendiente', OrderDto)
  cancel(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.api.cancel(req.user.id, id);
  }
  @Get('fills')
  @Contract('Consultar ejecuciones y comisiones propias', FillsPageDto)
  async fills(@Req() req: AuthRequest, @Query() q: PageDto) {
    return this.api.page((await this.api.state(req.user.id)).fills, q);
  }
  @Get('ledger')
  @Contract('Consultar movimientos contables propios', LedgerPageDto)
  async ledger(@Req() req: AuthRequest, @Query() q: PageDto) {
    return this.api.page((await this.api.state(req.user.id)).ledger, q);
  }
  @Get('decisions')
  @Contract('Consultar aceptación o rechazo de señales para mi cuenta', PageResponseDto)
  async decisions(@Req() req: AuthRequest, @Query() q: PageDto) {
    return this.api.page((await this.api.state(req.user.id)).decisions, q);
  }
  @Get('stats')
  @Contract('Consultar P&L neto incluyendo pérdidas y posiciones abiertas', StatsDto)
  stats(@Req() req: AuthRequest) {
    return this.api.stats(req.user.id);
  }
}
@ApiTags('Market and strategies')
@ApiBearerAuth()
@Controller()
export class MarketControllerV2 {
  constructor(private readonly api: ApiService) {}
  @Get('strategies')
  @ApiOkResponse({ type: [StrategyResponseDto] })
  @ApiOperation({ summary: 'Estrategias versionadas disponibles' })
  strategies() {
    return this.api.strategies();
  }
  @Get('market/status')
  @Contract('BTCUSDT: último precio cerrado, intervalos y estado del sistema', MarketStatusDto)
  status() {
    return this.api.market();
  }
  @Get('market/candles')
  @Contract('Consultar velas cerradas BTCUSDT por temporalidad', CandlesPageDto)
  candles(@Query() q: MarketQueryDto) {
    return this.api.candles(q);
  }
  @Get('signals')
  @Contract('Consultar señales de mercado compartidas', PageResponseDto)
  signals(@Query() q: PageDto) {
    return this.api.signals(q);
  }
}
@ApiTags('Backtesting')
@ApiBearerAuth()
@Controller('backtests')
export class BacktestingController {
  constructor(private readonly api: ApiService) {}
  @Post()
  @Contract('Ejecutar y persistir backtest cronológico BTCUSDT', BacktestResponseDto, true)
  run(@Req() req: AuthRequest, @Body() body: BacktestDto) {
    return this.api.runBacktest(req.user.id, body);
  }
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @Contract('Consultar un reporte de backtest propio', BacktestResponseDto)
  get(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.api.backtest(req.user.id, id);
  }
}
@ApiTags('Administration')
@ApiBearerAuth()
@Admin()
@Controller('admin')
export class AdminControllerV2 {
  constructor(private readonly api: ApiService) {}
  @Post('strategy-validations') @Contract('Registrar evaluación pendiente; nunca habilita por métricas automáticamente', RecordDto, true)
  registerValidation(@Req() req: AuthRequest, @Body() body: RegisterValidationDto) { return this.api.registerValidation(body.reportId, req.user.id, body.rationale); }
  @Get('strategy-validations') @Contract('Consultar aprobaciones y revocaciones persistentes', PageResponseDto)
  async validations(@Query() q: PageDto) { const [items,total] = await this.api.db.getRepository(StrategyValidationRow).findAndCount({ order: { createdAt:'DESC' }, take:q.limit, skip:q.offset }); return { items,total,...q }; }
  @Post('strategy-validations/:id/decision') @HttpCode(200) @ApiParam({ name:'id', format:'uuid' }) @Contract('Aprobar o revocar con revisión humana explícita de versión y configuración', RecordDto)
  decision(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideValidationDto) {
    return this.api.decideValidation(id, req.user.id, body.status, body.rationale, { simulatorReviewed:body.simulatorReviewed, outOfSampleReviewed:body.outOfSampleReviewed, costsReviewed:body.costsReviewed, riskReviewed:body.riskReviewed });
  }
  @Post('users')
  @Contract('Crear usuario y cuenta virtual aislada', PublicUserDto, true)
  create(@Body() body: CreateUserDto) {
    return this.api.createUser(body);
  }
  @Get('users')
  @Contract('Listar usuarios sin secretos', UsersPageDto)
  async users(@Query() q: PageDto) {
    const [users, total] = await this.api.db
      .getRepository(V2User)
      .findAndCount({ order: { createdAt: 'DESC' }, take: q.limit, skip: q.offset });
    return { items: users.map(publicUser), total, ...q };
  }
  @Patch('users/:id/status')
  @ApiParam({ name: 'id', format: 'uuid' })
  @Contract('Activar o desactivar acceso y nuevas entradas de un usuario', PublicUserDto)
  async status(@Param('id', ParseUUIDPipe) id: string, @Body() body: EntriesDto) {
    const user = await this.api.db.getRepository(V2User).findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    user.active = body.enabled;
    user.tokenVersion++;
    await this.api.db.getRepository(V2User).save(user);
    if (!body.enabled) await this.api.entries(id, false);
    return publicUser(user);
  }
  @Patch('users/:id/notifications')
  @ApiParam({ name: 'id', format: 'uuid' })
  @Contract('Vincular chat privado Telegram verificado por administrador', PublicUserDto)
  async notifications(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: NotificationSettingsDto,
  ) {
    const user = await this.api.db.getRepository(V2User).findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    user.telegramChatId = body.telegramChatId;
    await this.api.db.getRepository(V2User).save(user);
    return publicUser(user);
  }
  @Get('dead-letters')
  @Contract('Consultar entregas agotadas sin revelar payloads privados', PageResponseDto)
  async dead(@Query() q: PageDto) {
    const [items, total] = await this.api.db
      .getRepository(DeliveryAttemptRow)
      .findAndCount({ where: { dead: true }, take: q.limit, skip: q.offset });
    return { items, total, ...q };
  }
  @Post('dead-letters/:id/replay')
  @HttpCode(200)
  @ApiParam({ name: 'id' })
  @Contract('Reintentar evento conservando su identidad', RecordDto)
  replay(@Param('id') id: string) {
    return this.api.replay(id);
  }
}
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly api: ApiService) {}
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness del proceso API' })
  @ApiOkResponse({ type: HealthDto })
  live() {
    return { status: 'ok', mode: 'PAPER' };
  }
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness de base, caché y pipeline' })
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse({ description: 'Dependencias o mercado no disponibles' })
  async ready() {
    const state = await this.api.health();
    if (state.status !== 'ok') throw new ServiceUnavailableException(state);
    return state;
  }
}
export const API_CONTROLLERS = [
  AuthControllerV2,
  MeControllerV2,
  MarketControllerV2,
  BacktestingController,
  AdminControllerV2,
  HealthController,
];
