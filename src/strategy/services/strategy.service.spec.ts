import { Test, TestingModule } from '@nestjs/testing';
import { StrategyService } from './strategy.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Mock de los helpers (ruta correcta)
jest.mock('../../utils/indicators', () => ({
  calculateSMA: jest.fn(),
  calculateRSI: jest.fn(),
  calculateMACD: jest.fn(() => ({
    macdLine: [1, 2, 3],
    signalLine: [1, 2, 2],
  })),
  calculateATR: jest.fn(() => 200),
  isBullishEngulfing: jest.fn(),
}));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => { });
});

class MockEventEmitter2 {
  emit = jest.fn();
  on = jest.fn();
  off = jest.fn();
}

// 50 velas reales simuladas
const velasReales = [
  { open: 104900, high: 105000, low: 104800, close: 104950, volume: 10, time: 1 },
  { open: 104950, high: 105100, low: 104900, close: 105000, volume: 12, time: 2 },
  { open: 105000, high: 105200, low: 104950, close: 105100, volume: 15, time: 3 },
  { open: 105100, high: 105250, low: 105000, close: 105200, volume: 18, time: 4 },
  { open: 105200, high: 105300, low: 105100, close: 105250, volume: 20, time: 5 },
  { open: 105250, high: 105400, low: 105200, close: 105350, volume: 22, time: 6 },
  { open: 105350, high: 105500, low: 105300, close: 105400, volume: 25, time: 7 },
  { open: 105400, high: 105600, low: 105350, close: 105500, volume: 30, time: 8 },
  { open: 105500, high: 105700, low: 105400, close: 105600, volume: 35, time: 9 },
  { open: 105600, high: 105800, low: 105500, close: 105700, volume: 40, time: 10 },
  { open: 105700, high: 105900, low: 105600, close: 105800, volume: 42, time: 11 },
  { open: 105800, high: 106000, low: 105700, close: 105900, volume: 45, time: 12 },
  { open: 105900, high: 106100, low: 105800, close: 106000, volume: 48, time: 13 },
  { open: 106000, high: 106200, low: 105900, close: 106100, volume: 50, time: 14 },
  { open: 106100, high: 106300, low: 106000, close: 106200, volume: 52, time: 15 },
  { open: 106200, high: 106400, low: 106100, close: 106300, volume: 55, time: 16 },
  { open: 106300, high: 106500, low: 106200, close: 106400, volume: 57, time: 17 },
  { open: 106400, high: 106600, low: 106300, close: 106500, volume: 60, time: 18 },
  { open: 106500, high: 106700, low: 106400, close: 106600, volume: 62, time: 19 },
  { open: 106600, high: 106800, low: 106500, close: 106700, volume: 65, time: 20 },
  { open: 106700, high: 106900, low: 106600, close: 106800, volume: 67, time: 21 },
  { open: 106800, high: 107000, low: 106700, close: 106900, volume: 70, time: 22 },
  { open: 106900, high: 107100, low: 106800, close: 107000, volume: 72, time: 23 },
  { open: 107000, high: 107200, low: 106900, close: 107100, volume: 75, time: 24 },
  { open: 107100, high: 107300, low: 107000, close: 107200, volume: 77, time: 25 },
  { open: 107200, high: 107400, low: 107100, close: 107300, volume: 80, time: 26 },
  { open: 107300, high: 107500, low: 107200, close: 107400, volume: 82, time: 27 },
  { open: 107400, high: 107600, low: 107300, close: 107500, volume: 85, time: 28 },
  { open: 107500, high: 107700, low: 107400, close: 107600, volume: 87, time: 29 },
  { open: 107600, high: 107800, low: 107500, close: 107700, volume: 90, time: 30 },
  { open: 107700, high: 107900, low: 107600, close: 107800, volume: 92, time: 31 },
  { open: 107800, high: 108000, low: 107700, close: 107900, volume: 95, time: 32 },
  { open: 107900, high: 108100, low: 107800, close: 108000, volume: 97, time: 33 },
  { open: 108000, high: 108200, low: 107900, close: 108100, volume: 100, time: 34 },
  { open: 108100, high: 108300, low: 108000, close: 108200, volume: 102, time: 35 },
  { open: 108200, high: 108400, low: 108100, close: 108300, volume: 105, time: 36 },
  { open: 108300, high: 108500, low: 108200, close: 108400, volume: 107, time: 37 },
  { open: 108400, high: 108600, low: 108300, close: 108500, volume: 110, time: 38 },
  { open: 108500, high: 108700, low: 108400, close: 108600, volume: 112, time: 39 },
  { open: 108600, high: 108800, low: 108500, close: 108700, volume: 115, time: 40 },
  { open: 108700, high: 108900, low: 108600, close: 108800, volume: 117, time: 41 },
  { open: 108800, high: 109000, low: 108700, close: 108900, volume: 120, time: 42 },
  { open: 108900, high: 109100, low: 108800, close: 109000, volume: 122, time: 43 },
  { open: 109000, high: 109200, low: 108900, close: 109100, volume: 125, time: 44 },
  { open: 109100, high: 109300, low: 109000, close: 109200, volume: 127, time: 45 },
  { open: 109200, high: 109400, low: 109100, close: 109300, volume: 130, time: 46 },
  { open: 109300, high: 109500, low: 109200, close: 109400, volume: 132, time: 47 },
  { open: 109400, high: 109600, low: 109300, close: 109500, volume: 135, time: 48 },
  { open: 109500, high: 109700, low: 109400, close: 109600, volume: 137, time: 49 },
  { open: 109600, high: 109800, low: 109500, close: 109700, volume: 140, time: 50 },
];

describe('StrategyService', () => {
  let service: StrategyService;
  let eventEmitter: MockEventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyService,
        { provide: EventEmitter2, useClass: MockEventEmitter2 },
      ],
    }).compile();

    service = module.get<StrategyService>(StrategyService);
    eventEmitter = module.get<MockEventEmitter2>(EventEmitter2);
  });

  it('debería estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debería inicializar y registrar en el log al iniciar el módulo', () => {
    const logSpy = jest.spyOn((service as any).logger, 'log');
    service.onModuleInit();
    expect(logSpy).toHaveBeenCalledWith('Estrategia inicializada.');
  });

  it('debería agregar una vela y mantener el máximo de velas', () => {
    (service as any).candles = Array(50).fill({ close: 1 });
    const candle = { close: 2, open: 1, volume: 1, high: 2, low: 1, time: Date.now() };
    service.processCandle(candle as any);
    expect((service as any).candles.length).toBe(50);
    expect((service as any).candles[49].close).toBe(2);
  });

  it('no debería procesar indicadores si no hay suficientes velas', () => {
    (service as any).candles = Array(10).fill({ close: 1 });
    const candle = { close: 2, open: 1, volume: 1, high: 2, low: 1, time: Date.now() };
    const debugSpy = jest.spyOn((service as any).logger, 'debug');
    service.processCandle(candle as any);
    expect(debugSpy).toHaveBeenCalled();
  });

  // Test de compra realista
  it('debería procesar la lógica de señal de compra con velas reales', () => {
    const indicators = require('../../utils/indicators');
    indicators.calculateSMA.mockImplementation((data, period) => period === 5 ? 105900 : 105000); // smaShort > smaLong
    indicators.calculateMACD.mockReturnValue({
      macdLine: [1, 2, 3],
      signalLine: [1, 2, 2],
    }); // MACD > Signal
    indicators.isBullishEngulfing.mockReturnValue(true);
    indicators.calculateRSI.mockReturnValue(55);

    (service as any).candles = [...velasReales];
    (service as any).lastCandle = { close: 105800, open: 105700, volume: 40, high: 105900, low: 105600, time: 10 };
    jest.spyOn(service as any, 'preValidateSignal').mockReturnValue(true);
    const emitSpy = jest.spyOn(service as any, 'emitTradeSignal').mockImplementation(() => { });

    // priceRatio <= 0.999, volumeRatio > 1.1, candle.close > candle.open
    const candle = { open: 105600, high: 105900, low: 105600, close: 105694, volume: 50, time: 11 };
    service.processCandle(candle as any);
    expect(emitSpy).toHaveBeenCalledWith('buy', 105694, 200);
  });

  // Test de venta realista
  it('debería procesar la lógica de señal de venta con velas reales', () => {
    const indicators = require('../../utils/indicators');
    indicators.calculateSMA.mockImplementation((data, period) => period === 5 ? 104900 : 105000);
    indicators.calculateMACD.mockReturnValue({
      macdLine: [1, 2, 0],
      signalLine: [1, 2, 2],
    });
    indicators.isBullishEngulfing.mockReturnValue(false);
    indicators.calculateRSI.mockReturnValue(45);
    indicators.calculateATR.mockReturnValue(1); // ATR bajo para asegurar size válido

    // Asegúrate de que las últimas 5 velas NO tengan close igual a la señal activa
    (service as any).candles = [
      ...velasReales.slice(0, velasReales.length - 5),
      { open: 110000, high: 110100, low: 109900, close: 110000, volume: 10, time: 51 },
      { open: 110100, high: 110200, low: 110000, close: 110100, volume: 12, time: 52 },
      { open: 110200, high: 110300, low: 110100, close: 110200, volume: 15, time: 53 },
      { open: 110300, high: 110400, low: 110200, close: 110300, volume: 18, time: 54 },
      { open: 110400, high: 110500, low: 110300, close: 110400, volume: 20, time: 55 },
    ];
    (service as any).lastCandle = { close: 110400, open: 110300, volume: 20, high: 110500, low: 110300, time: 55 };
    jest.spyOn(service as any, 'preValidateSignal').mockReturnValue(true);
    const emitSpy = jest.spyOn(service as any, 'emitTradeSignal').mockImplementation(() => { });

    (service as any).activeSignals = [{
      symbol: 'BTCUSDT',
      price: 105694,
      size: 1,
      stopLoss: 100000,
      takeProfit: 150000,
      side: 'buy',
      paperTrading: true,
    }];

    const COMMISSION = 0.001;
    const PROFIT_MARGIN = 0.002;
    const lastBuy = 105694;
    const minSellPrice = lastBuy * (1 + 2 * COMMISSION + PROFIT_MARGIN);

    // Vela de venta con volumen mayor y close < open
    const candle = { open: 150100, high: 150200, low: 149900, close: 150000, volume: 55, time: 56 };
    service.processCandle(candle as any);

    const call = emitSpy.mock.calls.find(([side]) => side === 'sell');
    expect(call).toBeDefined();
    if (call) {
      expect(call[1]).toBeGreaterThanOrEqual(minSellPrice);
      expect(call[2]).toBeGreaterThan(0);
    }
  });

  it('debería actualizar lastCandle después de procesar', () => {
    const indicators = require('../../utils/indicators');
    indicators.calculateSMA.mockReturnValue(105000);
    indicators.calculateMACD.mockReturnValue({
      macdLine: [1, 2, 3],
      signalLine: [1, 2, 2.5],
    });
    indicators.calculateRSI.mockReturnValue(55);
    indicators.calculateATR.mockReturnValue(200);
    indicators.isBullishEngulfing.mockReturnValue(true);

    (service as any).candles = [...velasReales];
    (service as any).lastCandle = velasReales[velasReales.length - 1];

    const candle = { open: 105800, high: 105900, low: 105700, close: 105850, volume: 60, time: 12 };
    service.processCandle(candle as any);
    expect((service as any).lastCandle).toEqual(candle);
  });

  it('no debería emitir señal si preValidateSignal retorna false', () => {
    (service as any).candles = [...velasReales];
    (service as any).lastCandle = velasReales[velasReales.length - 1];
    jest.spyOn(service as any, 'preValidateSignal').mockReturnValue(false);
    const emitSpy = jest.spyOn(service as any, 'emitTradeSignal').mockImplementation(() => { });
    const candle = { open: 105800, high: 105900, low: 105700, close: 105850, volume: 60, time: 12 };
    service.processCandle(candle as any);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('debería no emitir señal si hay valores nulos en los indicadores', () => {
    const indicators = require('../../utils/indicators');
    indicators.calculateSMA.mockReturnValueOnce(null);
    (service as any).candles = [...velasReales];
    (service as any).lastCandle = velasReales[velasReales.length - 1];
    const emitSpy = jest.spyOn(service as any, 'emitTradeSignal').mockImplementation(() => { });
    const candle = { open: 105800, high: 105900, low: 105700, close: 105850, volume: 60, time: 12 };
    service.processCandle(candle as any);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('debería no emitir señal si el ratio de volumen no es suficiente', () => {
    (service as any).candles = [...velasReales];
    (service as any).lastCandle = velasReales[velasReales.length - 1];
    jest.spyOn(service as any, 'preValidateSignal').mockReturnValue(true);
    const emitSpy = jest.spyOn(service as any, 'emitTradeSignal').mockImplementation(() => { });
    // volumen igual, ratio 1
    const candle = { open: 105800, high: 105900, low: 105700, close: 105850, volume: 40, time: 12 };
    service.processCandle(candle as any);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  describe('StrategyService - Cobertura de preValidateSignal y emitTradeSignal', () => {
    let service: StrategyService;
    let eventEmitter: MockEventEmitter2;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StrategyService,
          { provide: EventEmitter2, useClass: MockEventEmitter2 },
        ],
      }).compile();

      service = module.get<StrategyService>(StrategyService);
      eventEmitter = module.get<MockEventEmitter2>(EventEmitter2);
      jest.spyOn(console, 'log').mockImplementation(() => { });
      jest.spyOn(console, 'debug').mockImplementation(() => { });
    });

    it('debería retornar false si hay menos de 10 velas', () => {
      (service as any).candles = Array(5).fill({ close: 1 });
      expect((service as any).preValidateSignal('buy', 100, 10)).toBe(false);
    });

    it('debería retornar false si hay cooldown de señales', () => {
      // Las últimas 5 velas tienen close=1, igual que el precio de la señal activa
      (service as any).candles = [
        ...Array(10).fill({ close: 2 }),
        ...Array(5).fill({ close: 1 }),
      ];
      (service as any).activeSignals = [{ price: 1 }];
      expect((service as any).preValidateSignal('buy', 100, 10)).toBe(false);
    });

    it('debería retornar false si hay caída brusca en drawdown', () => {
      (service as any).candles = [
        ...Array(9).fill({ close: 100 }),
        { close: 200 }, // caída de 100
        { close: 50 }
      ];
      (service as any).activeSignals = [];
      expect((service as any).preValidateSignal('buy', 100, 20)).toBe(false); // 200-50 > 2*20
    });

    it('debería retornar false si RSI es null', () => {
      (service as any).candles = Array(15).fill({ close: 1 });
      jest.spyOn(require('../../utils/indicators'), 'calculateRSI').mockReturnValueOnce(null);
      expect((service as any).preValidateSignal('buy', 100, 10)).toBe(false);
    });

    it('debería retornar false si RSI fuera de rango para buy', () => {
      (service as any).candles = Array(15).fill({ close: 1 });
      jest.spyOn(require('../../utils/indicators'), 'calculateRSI').mockReturnValueOnce(39);
      expect((service as any).preValidateSignal('buy', 100, 10)).toBe(false);
    });

    it('debería retornar false si RSI fuera de rango para sell', () => {
      (service as any).candles = Array(15).fill({ close: 1 });
      jest.spyOn(require('../../utils/indicators'), 'calculateRSI').mockReturnValueOnce(61);
      expect((service as any).preValidateSignal('sell', 100, 10)).toBe(false);
    });

    it('debería retornar false si el tamaño de posición es excesivo', () => {
      (service as any).candles = Array(15).fill({ close: 100 });
      jest.spyOn(require('../../utils/indicators'), 'calculateRSI').mockReturnValue(50);
      // price y atr hacen que el tamaño de posición sea > 20
      expect((service as any).preValidateSignal('buy', 0.5, 0.00001)).toBe(false);
    });

    it('debería retornar true si pasa todas las validaciones', () => {
      (service as any).candles = Array(15).fill({ close: 100 });
      jest.spyOn(require('../../utils/indicators'), 'calculateRSI').mockReturnValue(50);
      (service as any).activeSignals = [];
      expect((service as any).preValidateSignal('buy', 100, 10)).toBe(true);
    });

    it('emitTradeSignal no emite si hay demasiadas señales activas', () => {
      (service as any).activeSignals = [{}, {}];
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => { });
      (service as any).emitTradeSignal('buy', 100, 10);
      expect(warnSpy).toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emitTradeSignal emite correctamente una señal', () => {
      (service as any).activeSignals = [];
      const emitSpy = jest.spyOn(eventEmitter, 'emit');
      (service as any).emitTradeSignal('buy', 100, 10);
      expect(emitSpy).toHaveBeenCalledWith('trade.buy', expect.objectContaining({
        price: 100,
        side: 'buy',
        paperTrading: true,
      }));
      expect((service as any).activeSignals.length).toBe(1);
    });
  });
  it('debería cerrar (eliminar) la señal activa por id', () => {
    (service as any).activeSignals = [
      { id: 'btc-id', symbol: 'BTCUSDT', price: 100, size: 1, stopLoss: 90, takeProfit: 110, side: 'buy', paperTrading: true },
      { id: 'eth-id', symbol: 'ETHUSDT', price: 200, size: 1, stopLoss: 180, takeProfit: 220, side: 'sell', paperTrading: true },
    ];
    (service as any).closeSignal('btc-id');
    expect((service as any).activeSignals).toEqual([
      { id: 'eth-id', symbol: 'ETHUSDT', price: 200, size: 1, stopLoss: 180, takeProfit: 220, side: 'sell', paperTrading: true },
    ]);
  });

});