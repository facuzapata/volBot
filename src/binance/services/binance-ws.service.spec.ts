import { BinanceWsService } from './binance-ws.service';
import { StrategyService } from 'src/strategy/services/strategy.service';

// Mock compatible con require('ws')
jest.mock('ws', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn(),
    }));
});

// Silenciar logs y errores de consola durante los tests
beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'log').mockImplementation(() => { });
});

describe('BinanceWsService', () => {
    let service: BinanceWsService;
    let mockStrategyService: Partial<StrategyService>;
    let mockWsInstance: any;
    let setTimeoutSpy: jest.SpyInstance;

    beforeEach(() => {
        setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
            fn();
            return 1 as any;
        });
        mockWsInstance = {
            on: jest.fn(),
            close: jest.fn(),
        };
        (require('ws') as jest.Mock).mockImplementation(() => mockWsInstance);

        mockStrategyService = {
            processCandle: jest.fn(),
        };
        service = new BinanceWsService(mockStrategyService as StrategyService);
    });

    afterEach(() => {
        jest.clearAllMocks();
        setTimeoutSpy.mockRestore();
    });

    it('debería inicializar y conectar el WebSocket en onModuleInit', () => {
        service.onModuleInit();

        expect(require('ws')).toHaveBeenCalledWith(
            expect.stringContaining('btcusdt@kline_1m'),
        );
        expect(mockWsInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
        expect(mockWsInstance.on).toHaveBeenCalledWith('message', expect.any(Function));
        expect(mockWsInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
        expect(mockWsInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('debería procesar una vela cerrada correctamente', () => {
        service.onModuleInit();

        // Buscar el handler del evento 'message'
        const messageHandler = mockWsInstance.on.mock.calls.find(
            ([event]) => event === 'message',
        )[1];

        const mockData = JSON.stringify({
            k: {
                x: true, // vela cerrada
                o: '100',
                c: '110',
                h: '115',
                l: '95',
                v: '123.45',
                t: 1234567890,
            },
        });

        messageHandler(mockData);

        expect(mockStrategyService.processCandle).toHaveBeenCalledWith({
            open: 100,
            close: 110,
            high: 115,
            low: 95,
            volume: 123.45,
            timestamp: 1234567890,
        });
    });

    it('no debería procesar vela si no está cerrada', () => {
        service.onModuleInit();

        const messageHandler = mockWsInstance.on.mock.calls.find(
            ([event]) => event === 'message',
        )[1];

        const mockData = JSON.stringify({
            k: {
                x: false, // vela no cerrada
            },
        });

        messageHandler(mockData);

        expect(mockStrategyService.processCandle).not.toHaveBeenCalled();
    });

    it('debería capturar errores de JSON inválido', () => {
        service.onModuleInit();

        const messageHandler = mockWsInstance.on.mock.calls.find(
            ([event]) => event === 'message',
        )[1];

        // No debe lanzar excepción aunque el JSON sea inválido
        expect(() => messageHandler('invalid json')).not.toThrow();
    });

    it('debería cerrar el WebSocket al destruir el módulo', () => {
        service.onModuleInit();
        service.onModuleDestroy();

        expect(mockWsInstance.close).toHaveBeenCalled();
    });

    it('debería intentar reconectar al cerrar el WebSocket', () => {
        service.onModuleInit();

        const closeHandler = mockWsInstance.on.mock.calls.find(
            ([event]) => event === 'close',
        )[1];

        closeHandler();

        // Debe esperar 5 segundos para reconectar
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    });

    it('debería cerrar el WebSocket si ocurre un error', () => {
        service.onModuleInit();

        const errorHandler = mockWsInstance.on.mock.calls.find(
            ([event]) => event === 'error',
        )[1];

        errorHandler(new Error('test error'));

        expect(mockWsInstance.close).toHaveBeenCalled();
    });
});