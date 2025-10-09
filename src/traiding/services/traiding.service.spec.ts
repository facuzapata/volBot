import { Test, TestingModule } from '@nestjs/testing';
import { TradingService } from './trading.service';
import { TradeSignal } from 'src/strategy/interfaces/traide-signal.interface';

describe('TradingService', () => {
  let service: TradingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TradingService],
    }).compile();

    service = module.get<TradingService>(TradingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should handle buy signal and add to open trades', async () => {
    const buySignal: TradeSignal = {
      id: '1',
      symbol: 'BTCUSDT',
      side: 'buy',
      price: 50000,
      size: 0.001,
      stopLoss: 49000,
      takeProfit: 52000,
      paperTrading: true,
      timestamp: Date.now(),
      confidence: 0.8,
      indicators: { rsi: 30, macd: 0.5 }
    };

    const logSpy = jest.spyOn(service['logger'], 'log');
    await service.onBuy(buySignal);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('🟢 Compra simulada: BTCUSDT @ 50000.00')
    );
    expect(service['openTrades']).toHaveLength(1);
    expect(service['openTrades'][0]).toMatchObject({
      ...buySignal,
      status: 'open'
    });
  });

  it('should handle sell signal and add to open trades', async () => {
    const sellSignal: TradeSignal = {
      id: '2',
      symbol: 'BTCUSDT',
      side: 'sell',
      price: 51000,
      size: 0.001,
      stopLoss: 52000,
      takeProfit: 49000,
      paperTrading: true,
      timestamp: Date.now(),
      confidence: 0.9,
      indicators: { rsi: 70, macd: -0.5 },
      buySignalId: '1'
    };

    const logSpy = jest.spyOn(service['logger'], 'log');
    await service.onSell(sellSignal);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('🔴 Venta simulada: BTCUSDT @ 51000.00')
    );
    expect(service['openTrades']).toHaveLength(1);
    expect(service['openTrades'][0]).toMatchObject({
      ...sellSignal,
      status: 'open'
    });
  });

  it('should close buy trade when price hits stop loss', async () => {
    // Agrega un trade de compra
    const buyTrade: TradeSignal = {
      id: '3',
      symbol: 'BTCUSDT',
      side: 'buy',
      price: 50000,
      size: 0.001,
      stopLoss: 49000,
      takeProfit: 52000,
      paperTrading: true,
      timestamp: Date.now(),
      confidence: 0.8,
      indicators: { rsi: 30, macd: 0.5 }
    };

    await service.onBuy(buyTrade);

    const logSpy = jest.spyOn(service['logger'], 'log');

    // Simula actualización de precio que toca el stop loss
    await service.onPriceUpdate({ symbol: 'BTCUSDT', price: 49000 });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('📉 Trade cerrado: buy BTCUSDT @ 49000.00')
    );
    expect(service['openTrades'][0].status).toBe('closed');
    expect(service['openTrades'][0].closePrice).toBe(49000);
  });

  it('should close buy trade when price hits take profit', async () => {
    // Agrega un trade de compra
    const buyTrade: TradeSignal = {
      id: '4',
      symbol: 'BTCUSDT',
      side: 'buy',
      price: 50000,
      size: 0.001,
      stopLoss: 49000,
      takeProfit: 52000,
      paperTrading: true,
      timestamp: Date.now(),
      confidence: 0.8,
      indicators: { rsi: 30, macd: 0.5 }
    };

    await service.onBuy(buyTrade);

    const logSpy = jest.spyOn(service['logger'], 'log');

    // Simula actualización de precio que toca el take profit
    await service.onPriceUpdate({ symbol: 'BTCUSDT', price: 52000 });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('📉 Trade cerrado: buy BTCUSDT @ 52000.00')
    );
    expect(service['openTrades'][0].status).toBe('closed');
    expect(service['openTrades'][0].closePrice).toBe(52000);
  });

  it('should close sell trade when price hits stop loss', async () => {
    // Agrega un trade de venta
    const sellTrade: TradeSignal = {
      id: '5',
      symbol: 'BTCUSDT',
      side: 'sell',
      price: 50000,
      size: 0.001,
      stopLoss: 51000,
      takeProfit: 48000,
      paperTrading: true,
      timestamp: Date.now(),
      confidence: 0.9,
      indicators: { rsi: 70, macd: -0.5 },
      buySignalId: '1'
    };

    await service.onSell(sellTrade);

    const logSpy = jest.spyOn(service['logger'], 'log');

    // Simula actualización de precio que toca el stop loss
    await service.onPriceUpdate({ symbol: 'BTCUSDT', price: 51000 });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('📉 Trade cerrado: sell BTCUSDT @ 51000.00')
    );
    expect(service['openTrades'][0].status).toBe('closed');
    expect(service['openTrades'][0].closePrice).toBe(51000);
  });

  it('should not close trades when price update does not trigger stop loss or take profit', async () => {
    // Agrega un trade de compra
    const buyTrade: TradeSignal = {
      id: '6',
      symbol: 'BTCUSDT',
      side: 'buy',
      price: 50000,
      size: 0.001,
      stopLoss: 49000,
      takeProfit: 52000,
      paperTrading: true,
      timestamp: Date.now(),
      confidence: 0.8,
      indicators: { rsi: 30, macd: 0.5 }
    };

    await service.onBuy(buyTrade);

    const logSpy = jest.spyOn(service['logger'], 'log');

    // Simula actualización de precio que no toca los límites
    await service.onPriceUpdate({ symbol: 'BTCUSDT', price: 50500 });

    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('📉 Trade cerrado')
    );
    expect(service['openTrades'][0].status).toBe('open');
  });
});
