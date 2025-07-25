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

    constructor(private eventEmitter: EventEmitter2) {
        // Verificar si estamos en modo testnet o mainnet
        this.isTestnet = process.env.BINANCE_TESTNET === 'true';

        const options: any = {
            apiKey: process.env.BINANCE_API_KEY,
            apiSecret: process.env.BINANCE_API_SECRET,
        };

        // Para testnet, usar diferentes URLs base
        if (this.isTestnet) {
            options.httpBase = 'https://testnet.binance.vision';
            options.wsBase = 'wss://ws-api.testnet.binance.vision/ws-api';
        }

        this.client = Binance(options);
        this.logger.log(`🔗 Binance API inicializada en modo: ${this.isTestnet ? 'TESTNET' : 'MAINNET'}`);
    }

    onModuleInit() {
        const symbol = process.env.BINANCE_SYMBOL || 'BTCUSDT';
        this.subscribeToSymbol(symbol); // puedes cambiar a ETHUSDT, etc.

        // Verificar conectividad si no estamos en paper trading
        if (process.env.PAPER_TRADING !== 'true') {
            this.verifyConnection();
        }
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

        try {
            this.logger.log(`📝 Creando orden ${params.side} ${params.symbol}: ${params.quantity} @ ${params.price || 'MARKET'}`);

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

            const response = await this.client.order(orderParams);

            this.logger.log(`✅ Orden creada exitosamente: ${response.orderId} - Status: ${response.status}`);
            return response;

        } catch (error) {
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
