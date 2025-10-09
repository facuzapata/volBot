import { Test, TestingModule } from '@nestjs/testing';
import { BinanceService } from './binance.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Mock de binance-api-node
jest.mock('binance-api-node', () => ({
  __esModule: true,
  default: () => ({
    ws: {
      ticker: jest.fn(),
    },
    prices: jest.fn(),
  }),
}));

describe('BinanceService', () => {
  let service: BinanceService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    eventEmitter = new EventEmitter2();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BinanceService,
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<BinanceService>(BinanceService);
  });

  it('debería suscribirse al símbolo y emitir evento de precio', () => {
    const mockTickerCb = jest.fn();
    // @ts-ignore
    service['client'].ws.ticker.mockImplementation((symbol, cb) => {
      cb({ curDayClose: '12345.67' });
      return mockTickerCb;
    });

    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    service.subscribeToSymbol('BTCUSDT');

    expect(emitSpy).toHaveBeenCalledWith('binance.price.update', expect.objectContaining({
      symbol: 'BTCUSDT',
      price: 12345.67,
    }));
    // Debe guardar la función de cierre
    expect(service['wsCloseFn']).toBe(mockTickerCb);
  });

  it('debería cerrar el websocket al destruir el módulo', () => {
    const closeFn = jest.fn();
    service['wsCloseFn'] = closeFn;
    service.onModuleDestroy();
    expect(closeFn).toHaveBeenCalled();
  });

  it('debería obtener el precio correctamente', async () => {
    // @ts-ignore
    service['client'].prices.mockResolvedValue({ BTCUSDT: '54321.99' });
    const price = await service.getPrice('BTCUSDT');
    expect(price).toBe(54321.99);
  });
});