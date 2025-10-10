import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Binance from 'binance-api-node';
import { User } from '../../users/entities/user.entity';
import { UserCredentials } from '../../users/entities/user-credentials.entity';
import { CreateOrderParams } from '../interfaces/create-order-params';
import { BinanceOrderResponse } from './binance.service';
import { SignalDatabaseService } from '../../strategy/services/signal-database.service';

interface UserBinanceClient {
    client: any;
    credentials: UserCredentials;
    user: User;
    timeOffset: number;
    lastSyncTime: number;
}

@Injectable()
export class MultiBinanceService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(MultiBinanceService.name);
    private userClients: Map<string, UserBinanceClient> = new Map();
    private priceWebSockets: Map<string, (() => void)> = new Map(); // symbol -> close function
    private activeSymbols: Set<string> = new Set();

    constructor(
        private eventEmitter: EventEmitter2,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(UserCredentials)
        private credentialsRepository: Repository<UserCredentials>,
        private signalDbService: SignalDatabaseService
    ) { }

    async onModuleInit() {
        this.logger.log('🚀 Inicializando servicio multi-usuario de Binance...');
        await this.loadActiveUsers();
        await this.subscribeToRequiredSymbols();
    }

    onModuleDestroy() {
        // Cerrar todos los WebSockets
        for (const [symbol, closeFn] of this.priceWebSockets.entries()) {
            this.logger.log(`🔌 Cerrando WebSocket para ${symbol}`);
            closeFn();
        }
        this.priceWebSockets.clear();
    }

    private async loadActiveUsers() {
        const activeUsers = await this.userRepository.find({
            where: { isActive: true },
            relations: ['credentials']
        });

        this.logger.log(`📥 Cargando ${activeUsers.length} usuarios activos...`);

        for (const user of activeUsers) {
            const activeCredentials = user.credentials.find(cred => cred.isActive);
            if (activeCredentials) {
                await this.initializeUserClient(user, activeCredentials);
            } else {
                this.logger.warn(`⚠️ Usuario ${user.email} sin credenciales activas`);
            }
        }
    }

    private async initializeUserClient(user: User, credentials: UserCredentials) {
        try {
            const options: any = {
                apiKey: credentials.apiKey,
                apiSecret: credentials.apiSecret,
                getTime: () => Date.now(),
                recvWindow: 60000,
            };

            if (credentials.isTestnet) {
                options.httpBase = 'https://testnet.binance.vision';
                options.wsBase = 'wss://ws-api.testnet.binance.vision/ws-api';
            }

            const client = Binance(options);

            const userClient: UserBinanceClient = {
                client,
                credentials,
                user,
                timeOffset: 0,
                lastSyncTime: 0
            };

            this.userClients.set(user.id, userClient);

            // Sincronizar tiempo
            await this.syncServerTime(user.id);

            // Verificar conectividad
            await this.verifyUserConnection(user.id);

            this.logger.log(`✅ Cliente inicializado para usuario ${user.email} (${credentials.isTestnet ? 'TESTNET' : 'MAINNET'})`);

        } catch (error) {
            this.logger.error(`❌ Error inicializando cliente para usuario ${user.email}:`, error);
        }
    }

    private async subscribeToRequiredSymbols() {
        // Por ahora solo BTCUSDT, pero preparado para múltiples símbolos
        const symbol = process.env.BINANCE_SYMBOL || 'BTCUSDT';
        await this.subscribeToSymbol(symbol);
    }

    private async subscribeToSymbol(symbol: string) {
        if (this.priceWebSockets.has(symbol)) {
            this.logger.debug(`📡 Ya existe WebSocket para ${symbol}`);
            return;
        }

        try {
            // Usar cualquier cliente para el WebSocket de precios (no requiere autenticación)
            const anyClient = Array.from(this.userClients.values())[0];
            if (!anyClient) {
                this.logger.warn(`⚠️ No hay clientes disponibles para WebSocket de ${symbol}`);
                return;
            }

            const closeFn = anyClient.client.ws.ticker(symbol, (ticker) => {
                const price = parseFloat(ticker.curDayClose);
                this.eventEmitter.emit('binance.price.update', {
                    symbol,
                    price,
                    time: Date.now(),
                });
            });

            this.priceWebSockets.set(symbol, closeFn);
            this.activeSymbols.add(symbol);
            this.logger.log(`📡 WebSocket suscrito a ${symbol}`);

        } catch (error) {
            this.logger.error(`❌ Error suscribiendo a ${symbol}:`, error);
        }
    }

    async getUserClient(userId: string): Promise<UserBinanceClient | null> {
        const userClient = this.userClients.get(userId);
        if (!userClient) {
            this.logger.error(`❌ Cliente no encontrado para usuario ${userId}`);
            return null;
        }
        return userClient;
    }

    async createOrderForUser(userId: string, params: CreateOrderParams, movementId?: string): Promise<BinanceOrderResponse> {
        const userClient = await this.getUserClient(userId);
        if (!userClient) {
            throw new Error(`Cliente no disponible para usuario ${userId}`);
        }

        // Formatear cantidad según restricciones de Binance
        let formattedQuantity: string;
        if (params.symbol === 'BTCUSDT') {
            const roundedQuantity = Math.max(0.00001, Math.floor(params.quantity / 0.00001) * 0.00001);
            formattedQuantity = roundedQuantity.toFixed(5);
        } else {
            formattedQuantity = params.quantity.toFixed(8);
        }

        const orderParams: any = {
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            quantity: formattedQuantity,
        };

        if (params.type === 'LIMIT') {
            const priceNumber = Number(params.price);

            if (isNaN(priceNumber)) {
                throw new Error(`Precio inválido: ${params.price}`);
            }

            console.log('Precio original:', priceNumber);
            orderParams.price = Number(priceNumber.toFixed(2));
            console.log('Precio formateado:', orderParams.price);
            orderParams.timeInForce = params.timeInForce || 'GTC';
        }

        try {
            this.logger.log(`📝 [${userClient.user.email}] Creando orden ${params.side} ${params.symbol}: ${params.quantity} @ ${params.price || 'MARKET'}`);

            const response = await userClient.client.order(orderParams);

            this.logger.log(`✅ [${userClient.user.email}] Orden creada: ${response.orderId} - Status: ${response.status}`);

            // Si se proporciona movementId, actualizar el movimiento con los datos de Binance
            if (movementId) {
                await this.updateMovementWithBinanceData(movementId, response);
            }

            return response;

        } catch (error) {
            if (error.code === -1021) {
                this.logger.warn(`⚠️ [${userClient.user.email}] Error de timestamp, re-sincronizando...`);
                await this.syncServerTime(userId);
                const response = await userClient.client.order(orderParams);
                this.logger.log(`✅ [${userClient.user.email}] Orden creada después de re-sincronizar: ${response.orderId}`);

                // Actualizar movimiento después del retry también
                if (movementId) {
                    await this.updateMovementWithBinanceData(movementId, response);
                }

                return response;
            }

            // En caso de error, actualizar el movimiento con el error
            if (movementId) {
                await this.updateMovementWithError(movementId, error);
            }

            this.logger.error(`❌ [${userClient.user.email}] Error creando orden:`, error);
            throw error;
        }
    }

    async getBalanceForUser(userId: string, asset: string = 'USDT'): Promise<number> {
        const userClient = await this.getUserClient(userId);
        if (!userClient) {
            throw new Error(`Cliente no disponible para usuario ${userId}`);
        }

        try {
            const account = await userClient.client.accountInfo();
            const balance = account.balances.find((b: any) => b.asset === asset);
            return balance ? parseFloat(balance.free) : 0;
        } catch (error) {
            this.logger.error(`❌ [${userClient.user.email}] Error obteniendo balance de ${asset}:`, error);
            throw error;
        }
    }

    async getUserConfig(userId: string): Promise<User | null> {
        const userClient = await this.getUserClient(userId);
        return userClient?.user || null;
    }

    private async syncServerTime(userId: string): Promise<void> {
        const userClient = this.userClients.get(userId);
        if (!userClient) return;

        try {
            const serverTimeResponse = await userClient.client.time();
            let serverTime: number;

            if (typeof serverTimeResponse === 'number') {
                serverTime = serverTimeResponse;
            } else if (typeof serverTimeResponse === 'object' && serverTimeResponse !== null && 'serverTime' in serverTimeResponse) {
                serverTime = Number((serverTimeResponse as any).serverTime);
            } else {
                throw new Error(`Formato de respuesta inválido: ${typeof serverTimeResponse}`);
            }

            const localTime = Date.now();
            userClient.timeOffset = serverTime - localTime;
            userClient.lastSyncTime = Date.now();

            // Actualizar cliente con tiempo sincronizado
            const options: any = {
                apiKey: userClient.credentials.apiKey,
                apiSecret: userClient.credentials.apiSecret,
                getTime: () => Date.now() + userClient.timeOffset,
                recvWindow: 60000,
            };

            if (userClient.credentials.isTestnet) {
                options.httpBase = 'https://testnet.binance.vision';
                options.wsBase = 'wss://ws-api.testnet.binance.vision/ws-api';
            }

            userClient.client = Binance(options);

            this.logger.log(`✅ [${userClient.user.email}] Tiempo sincronizado. Offset: ${userClient.timeOffset}ms`);

        } catch (error) {
            this.logger.error(`❌ [${userClient.user.email}] Error sincronizando tiempo:`, error);
        }
    }

    private async verifyUserConnection(userId: string): Promise<void> {
        const userClient = this.userClients.get(userId);
        if (!userClient) return;

        try {
            const account = await userClient.client.accountInfo();
            const usdtBalance = await this.getBalanceForUser(userId, 'USDT');

            this.logger.log(`✅ [${userClient.user.email}] Conectado exitosamente - Balance USDT: ${usdtBalance.toFixed(2)}`);
        } catch (error) {
            this.logger.error(`❌ [${userClient.user.email}] Error verificando conexión:`, error);
        }
    }

    // Método para agregar nuevos usuarios en runtime
    async addUser(userId: string): Promise<void> {
        const user = await this.userRepository.findOne({
            where: { id: userId, isActive: true },
            relations: ['credentials']
        });

        if (!user) {
            throw new Error(`Usuario ${userId} no encontrado o inactivo`);
        }

        const activeCredentials = user.credentials.find(cred => cred.isActive);
        if (!activeCredentials) {
            throw new Error(`Usuario ${userId} sin credenciales activas`);
        }

        await this.initializeUserClient(user, activeCredentials);
    }

    // Método para remover usuarios
    async removeUser(userId: string): Promise<void> {
        this.userClients.delete(userId);
        this.logger.log(`🗑️ Cliente removido para usuario ${userId}`);
    }

    async getOrderStatus(symbol: string, orderId: number, userId: string): Promise<BinanceOrderResponse> {
        try {
            const userClient = await this.getUserClient(userId);

            if (!userClient) {
                throw new Error(`Cliente no disponible para usuario ${userId}`);
            }

            const response = await userClient.client.getOrder({
                symbol,
                orderId,
            });
            return response;
        } catch (error) {
            this.logger.error(`Error consultando orden ${orderId}:`, error);
            throw error;
        }
    }

    /**
     * Actualizar movimiento con datos exitosos de Binance
     */
    private async updateMovementWithBinanceData(movementId: string, binanceResponse: BinanceOrderResponse): Promise<void> {
        try {
            await this.signalDbService.updateMovementWithOrderData(movementId, {
                binanceOrderId: binanceResponse.orderId,
                clientOrderId: binanceResponse.clientOrderId,
                status: binanceResponse.status,
                executedQty: binanceResponse.executedQty,
                price: binanceResponse.price,
                fills: binanceResponse.fills,
                transactTime: binanceResponse.transactTime,
                fullResponse: binanceResponse
            });

            this.logger.log(`📝 Movimiento ${movementId} actualizado con datos de Binance exitosamente`);
        } catch (error) {
            this.logger.error(`❌ Error actualizando movimiento ${movementId} con datos de Binance:`, error);
        }
    }

    /**
     * Actualizar movimiento con error de Binance
     */
    private async updateMovementWithError(movementId: string, error: any): Promise<void> {
        try {
            await this.signalDbService.updateMovementWithError(movementId, error);
            this.logger.log(`📝 Movimiento ${movementId} marcado como fallido debido a error de Binance`);
        } catch (updateError) {
            this.logger.error(`❌ Error actualizando movimiento ${movementId} con error:`, updateError);
        }
    }
}