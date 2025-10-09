// src/binance/binance.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Binance from 'binance-api-node';

export interface BinanceOrderResponse {
    symbol: string;
    orderId: number;
    orderListId: number;
    clientOrderId: string;
    transactTime: number;
    price: string;
    origQty: string;
    executedQty: string;
    cummulativeQuoteQty: string;
    status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'PENDING_CANCEL' | 'REJECTED' | 'EXPIRED';
    timeInForce: string;
    type: string;
    side: 'BUY' | 'SELL';
    fills?: Array<{
        price: string;
        qty: string;
        commission: string;
        commissionAsset: string;
    }>;
}

export interface CreateOrderParams {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
    private client: any;
    private wsCloseFn: (() => void) | null = null;
    private readonly logger = new Logger(BinanceService.name);
    private readonly isTestnet: boolean;
    private timeOffset: number = 0; // Offset entre tiempo local y servidor Binance
    private lastSyncTime: number = 0; // Tiempo de última sincronización
    private readonly SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutos en ms

    constructor(private eventEmitter: EventEmitter2) {
        // Verificar si estamos en modo testnet o mainnet
        this.isTestnet = process.env.BINANCE_TESTNET === 'true';

        const options: any = {
            apiKey: process.env.BINANCE_API_KEY,
            apiSecret: process.env.BINANCE_API_SECRET,
            // Configuración para sincronización de tiempo - usar tiempo local inicialmente
            getTime: () => Date.now(), // Inicializar con tiempo local, se actualizará después
            // Aumentar el recvWindow para conexiones más lentas
            recvWindow: 60000, // 60 segundos (default es 5000ms)
        };

        // Para testnet, usar diferentes URLs base
        if (this.isTestnet) {
            options.httpBase = 'https://testnet.binance.vision';
            options.wsBase = 'wss://ws-api.testnet.binance.vision/ws-api';
        }

        this.client = Binance(options);
        this.logger.log(`🔗 Binance API inicializada en modo: ${this.isTestnet ? 'TESTNET' : 'MAINNET'}`);
    }

    private async syncServerTime(): Promise<void> {
        try {
            this.logger.log('� Sincronizando tiempo con el servidor de Binance...');

            // Usar un cliente temporal con tiempo local para obtener el tiempo del servidor
            const tempOptions: any = {
                apiKey: process.env.BINANCE_API_KEY,
                apiSecret: process.env.BINANCE_API_SECRET,
                getTime: () => Date.now(),
                timeout: 10000,
                recvWindow: 60000,
            };

            // Para testnet, usar diferentes URLs base
            if (this.isTestnet) {
                tempOptions.httpBase = 'https://testnet.binance.vision';
                tempOptions.wsBase = 'wss://ws-api.testnet.binance.vision/ws-api';
            }

            const tempClient = Binance(tempOptions);
            const serverTimeResponse = await tempClient.time();

            this.logger.debug('📊 Respuesta del servidor:', JSON.stringify(serverTimeResponse));

            let serverTime: number;

            // Validar y extraer el timestamp del servidor
            if (typeof serverTimeResponse === 'number') {
                serverTime = serverTimeResponse;
            } else if (typeof serverTimeResponse === 'object' && serverTimeResponse !== null && 'serverTime' in serverTimeResponse) {
                serverTime = Number((serverTimeResponse as any).serverTime);
            } else if (typeof serverTimeResponse === 'string') {
                serverTime = parseInt(serverTimeResponse, 10);
            } else {
                throw new Error(`Formato de respuesta inválido: ${typeof serverTimeResponse}`);
            }

            // Validar que el timestamp es válido
            if (isNaN(serverTime) || serverTime <= 0) {
                throw new Error(`Timestamp inválido: ${serverTime}`);
            }

            const localTime = Date.now();
            this.timeOffset = serverTime - localTime;

            this.logger.log(`✅ Tiempo sincronizado. Offset: ${this.timeOffset}ms`);

            // Actualizar la función getTime del cliente principal
            const updatedOptions: any = {
                apiKey: process.env.BINANCE_API_KEY,
                apiSecret: process.env.BINANCE_API_SECRET,
                getTime: () => Date.now() + this.timeOffset,
                recvWindow: 60000,
            };

            // Para testnet, usar diferentes URLs base
            if (this.isTestnet) {
                updatedOptions.httpBase = 'https://testnet.binance.vision';
                updatedOptions.wsBase = 'wss://ws-api.testnet.binance.vision/ws-api';
            }

            this.client = Binance(updatedOptions);
            this.lastSyncTime = Date.now();

        } catch (error) {
            this.logger.error('❌ Error sincronizando tiempo del servidor:', error.message);
            this.logger.warn('⚠️ Usando tiempo local sin offset');
            this.timeOffset = 0;

            // Reinicializar cliente con tiempo local si falla la sincronización
            const fallbackOptions: any = {
                apiKey: process.env.BINANCE_API_KEY,
                apiSecret: process.env.BINANCE_API_SECRET,
                getTime: () => Date.now(),
                recvWindow: 60000,
            };

            // Para testnet, usar diferentes URLs base
            if (this.isTestnet) {
                fallbackOptions.httpBase = 'https://testnet.binance.vision';
                fallbackOptions.wsBase = 'wss://ws-api.testnet.binance.vision/ws-api';
            }

            this.client = Binance(fallbackOptions);
        }
    }

    async onModuleInit() {
        const symbol = process.env.BINANCE_SYMBOL || 'BTCUSDT';

        // Sincronizar tiempo antes de hacer cualquier operación
        this.syncServerTime().then(() => {
            this.subscribeToSymbol(symbol);

            // Verificar conectividad si no estamos en paper trading
            if (process.env.PAPER_TRADING !== 'true') {
                this.verifyConnection();
            }

            // Re-sincronizar tiempo cada 30 minutos
            setInterval(() => {
                this.syncServerTime().catch(error => {
                    this.logger.warn('⚠️ Error re-sincronizando tiempo:', error);
                });
            }, 30 * 60 * 1000); // 30 minutos

        }).catch((error) => {
            this.logger.error('❌ Error sincronizando tiempo con Binance:', error);
            // Continuar sin sincronización si falla
            this.subscribeToSymbol(symbol);
            if (process.env.PAPER_TRADING !== 'true') {
                this.verifyConnection();
            }
        });
    }

    onModuleDestroy() {
        if (this.wsCloseFn) this.wsCloseFn();
    }

    subscribeToSymbol(symbol: string) {
        this.wsCloseFn = this.client.ws.ticker(symbol, (ticker) => {
            const price = parseFloat(ticker.curDayClose);
            this.eventEmitter.emit('binance.price.update', {
                symbol,
                price,
                time: Date.now(),
            });
        });
    }

    async getPrice(symbol: string): Promise<number> {
        try {
            const ticker = await this.client.prices({ symbol });
            return parseFloat(ticker[symbol]);
        } catch (error) {
            this.logger.error(`Error obteniendo precio de ${symbol}:`, error);
            throw error;
        }
    }

    async createOrder(params: CreateOrderParams): Promise<BinanceOrderResponse> {
        // Formatear cantidad según restricciones de Binance
        let formattedQuantity: string;
        if (params.symbol === 'BTCUSDT') {
            // Para BTCUSDT: minQty=0.00001, stepSize=0.00001
            const roundedQuantity = Math.max(0.00001, Math.floor(params.quantity / 0.00001) * 0.00001);
            formattedQuantity = roundedQuantity.toFixed(5);
        } else {
            formattedQuantity = params.quantity.toFixed(8);
        }

        // Preparar parámetros de la orden
        const orderParams: any = {
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            quantity: formattedQuantity,
        };

        if (params.type === 'LIMIT') {
            orderParams.price = params.price?.toFixed(2);
            orderParams.timeInForce = params.timeInForce || 'GTC';
        }

        try {
            this.logger.log(`📝 Creando orden ${params.side} ${params.symbol}: ${params.quantity} @ ${params.price || 'MARKET'}`);

            const response = await this.client.order(orderParams);

            this.logger.log(`✅ Orden creada exitosamente: ${response.orderId} - Status: ${response.status}`);
            return response;

        } catch (error) {
            // Si es error de timestamp, intentar re-sincronizar y reintentar
            if (error.code === -1021) {
                this.logger.warn('⚠️ Error de timestamp detectado en createOrder, re-sincronizando...');
                try {
                    await this.syncServerTime();
                    // Reintentar después de sincronizar
                    const response = await this.client.order(orderParams);
                    this.logger.log(`✅ Orden creada exitosamente después de re-sincronizar: ${response.orderId} - Status: ${response.status}`);
                    return response;
                } catch (retryError) {
                    this.logger.error(`❌ Error creando orden después de re-sincronizar:`, retryError);
                    throw retryError;
                }
            }

            this.logger.error(`❌ Error creando orden ${params.side} ${params.symbol}:`, error);

            // Información adicional para errores específicos
            if (error.code === -2010) {
                this.logger.error(`💰 Error -2010 (NEW_ORDER_REJECTED) - Verificar:`);
                this.logger.error(`   🔸 Balance disponible para ${params.side === 'BUY' ? 'USDT' : params.symbol.replace('USDT', '')}`);
                this.logger.error(`   🔸 Cantidad: ${formattedQuantity} (original: ${params.quantity})`);
                this.logger.error(`   🔸 Precio: ${params.price || 'MARKET'}`);
                this.logger.error(`   🔸 URL: ${error.url || 'No disponible'}`);

                // Intentar obtener balance actual
                try {
                    const usdtBalance = await this.getBalance('USDT');
                    const btcBalance = await this.getBalance('BTC');
                    this.logger.error(`   💰 Balance actual: USDT=${usdtBalance.toFixed(2)}, BTC=${btcBalance.toFixed(8)}`);
                } catch (balanceError) {
                    this.logger.error(`   ❌ No se pudo obtener balance:`, balanceError);
                }
            }

            throw error;
        }
    }

    async getOrderStatus(symbol: string, orderId: number): Promise<BinanceOrderResponse> {
        try {
            const response = await this.client.getOrder({
                symbol,
                orderId,
            });
            return response;
        } catch (error) {
            this.logger.error(`Error consultando orden ${orderId}:`, error);
            throw error;
        }
    }

    async cancelOrder(symbol: string, orderId: number): Promise<BinanceOrderResponse> {
        try {
            this.logger.log(`❌ Cancelando orden ${orderId} de ${symbol}`);
            const response = await this.client.cancelOrder({
                symbol,
                orderId,
            });
            this.logger.log(`✅ Orden ${orderId} cancelada exitosamente`);
            return response;
        } catch (error) {
            this.logger.error(`Error cancelando orden ${orderId}:`, error);
            throw error;
        }
    }

    async getAccountInfo(): Promise<any> {
        try {
            const account = await this.client.accountInfo();
            return account;
        } catch (error) {
            // Si es error de timestamp, intentar re-sincronizar y reintentar
            if (error.code === -1021) {
                this.logger.warn('⚠️ Error de timestamp detectado, re-sincronizando...');
                try {
                    await this.syncServerTime();
                    // Reintentar después de sincronizar
                    const account = await this.client.accountInfo();
                    return account;
                } catch (retryError) {
                    this.logger.error('Error obteniendo información de cuenta después de re-sincronizar:', retryError);
                    throw retryError;
                }
            }

            this.logger.error('Error obteniendo información de cuenta:', error);
            throw error;
        }
    }

    async getBalance(asset: string = 'USDT'): Promise<number> {
        try {
            const account = await this.getAccountInfo();
            const balance = account.balances.find((b: any) => b.asset === asset);
            return balance ? parseFloat(balance.free) : 0;
        } catch (error) {
            this.logger.error(`Error obteniendo balance de ${asset}:`, error);
            throw error;
        }
    }

    private async verifyConnection(): Promise<void> {
        try {
            this.logger.log('🔍 Verificando conectividad con Binance API...');

            // Verificar que las credenciales estén configuradas
            if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
                this.logger.warn('⚠️ Credenciales de Binance no configuradas. Trading real deshabilitado.');
                return;
            }

            // Verificar conexión obteniendo información de cuenta
            const account = await this.getAccountInfo();
            this.logger.log(`✅ Conectado a Binance ${this.isTestnet ? 'TESTNET' : 'MAINNET'} exitosamente`);

            // Mostrar balances principales
            const usdtBalance = await this.getBalance('USDT');
            this.logger.log(`💰 Balance USDT: ${usdtBalance.toFixed(2)}`);

        } catch (error) {
            this.logger.error('❌ Error conectando con Binance API:', error);
            this.logger.warn('⚠️ Trading real deshabilitado debido a problemas de conectividad');
        }
    }
}
