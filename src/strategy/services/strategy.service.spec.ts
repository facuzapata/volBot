import { Test, TestingModule } from '@nestjs/testing';
import { StrategyService } from './strategy.service';
import { SignalDatabaseService } from './signal-database.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Mock de los helpers (ruta correcta)
jest.mock('../../utils/indicators', () => ({
  calculateSMA: jest.fn(),
  calculateEMA: jest.fn(),
  calculateRSI: jest.fn(),
  calculateMACD: jest.fn(() => ({
    macdLine: [1, 2, 3],
    signalLine: [1, 2, 2],
    histogram: [0, 0, 1],
  })),
  calculateATR: jest.fn(() => 200),
  calculateBollingerBands: jest.fn(() => ({
    upper: 107000,
    middle: 106000,
    lower: 105000,
  })),
  isBullishEngulfing: jest.fn(),
  isBearishEngulfing: jest.fn(),
}));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => { });
});

class MockEventEmitter2 {
  emit = jest.fn();
  on = jest.fn();
  off = jest.fn();
}

class MockSignalDatabaseService {
  createSignal = jest.fn().mockResolvedValue({
    id: 'test-signal-id',
    symbol: 'BTCUSDT',
    initialPrice: 106000,
    status: 'active',
    movements: []
  });

  createMovement = jest.fn().mockResolvedValue({
    id: 'test-movement-id',
    type: 'buy',
    price: 106000,
    quantity: 0.001
  });

  getActiveSignals = jest.fn().mockResolvedValue([]);
  getSignalById = jest.fn().mockResolvedValue(null);
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
  let signalDbService: MockSignalDatabaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyService,
        { provide: EventEmitter2, useClass: MockEventEmitter2 },
        { provide: SignalDatabaseService, useClass: MockSignalDatabaseService },
      ],
    }).compile();

    service = module.get<StrategyService>(StrategyService);
    eventEmitter = module.get<MockEventEmitter2>(EventEmitter2);
    signalDbService = module.get<MockSignalDatabaseService>(SignalDatabaseService);
  });

  it('debería estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debería inicializar y registrar en el log al iniciar el módulo', () => {
    const logSpy = jest.spyOn((service as any).logger, 'log');
    service.onModuleInit();
    expect(logSpy).toHaveBeenCalledWith('🚀 Estrategia de trading inicializada con control de riesgo avanzado');
  });

  it('debería agregar una vela y mantener el máximo de velas', async () => {
    (service as any).candles = Array(100).fill({ close: 1 });
    const candle = { close: 2, open: 1, volume: 1, high: 2, low: 1, timestamp: Date.now() };
    await service.processCandle(candle as any);
    expect((service as any).candles.length).toBe(100);
    expect((service as any).candles[99].close).toBe(2);
  });

  it('no debería procesar indicadores si no hay suficientes velas', async () => {
    (service as any).candles = Array(10).fill({ close: 1 });
    const candle = { close: 2, open: 1, volume: 1, high: 2, low: 1, timestamp: Date.now() };
    const debugSpy = jest.spyOn((service as any).logger, 'debug');
    await service.processCandle(candle as any);
    expect(debugSpy).toHaveBeenCalledWith('Esperando más datos para análisis técnico completo');
  });

  // Test de compra realista
  it('debería procesar la lógica de señal de compra con velas reales', async () => {
    const indicators = require('../../utils/indicators');
    indicators.calculateSMA.mockImplementation((data, period) => {
      if (period === 9) return 105900; // smaShort
      if (period === 21) return 105000; // smaLong
      if (period === 50) return 104500; // smaVeryLong
      if (period === 10) return 100; // volumeMA
      return null;
    });
    indicators.calculateEMA.mockImplementation((data, period) => {
      if (period === 12) return 105800; // emaShort
      if (period === 26) return 105200; // emaLong
      return null;
    });
    indicators.calculateMACD.mockReturnValue({
      macdLine: [1, 2, 3],
      signalLine: [1, 2, 2],
      histogram: [0, 0, 1],
    });
    indicators.calculateBollingerBands.mockReturnValue({
      upper: 107000,
      middle: 106000,
      lower: 105000,
    });
    indicators.isBullishEngulfing.mockReturnValue(true);
    indicators.isBearishEngulfing.mockReturnValue(false);
    indicators.calculateRSI.mockReturnValue(55);
    indicators.calculateATR.mockReturnValue(200);

    // Configurar 30+ velas para que pase la validación inicial
    (service as any).candles = Array(35).fill(0).map((_, i) => ({
      open: 105000 + i * 10,
      high: 105100 + i * 10,
      low: 104900 + i * 10,
      close: 105000 + i * 10,
      volume: 100 + i,
      timestamp: Date.now() + i * 1000
    }));

    const createSignalSpy = jest.spyOn(signalDbService, 'createSignal');
    const createMovementSpy = jest.spyOn(signalDbService, 'createMovement');

    const candle = {
      open: 105600,
      high: 105900,
      low: 105600,
      close: 105700,
      volume: 150,
      timestamp: Date.now()
    };

    await service.processCandle(candle as any);

    // Verificar que se creó la señal y el movimiento
    expect(createSignalSpy).toHaveBeenCalled();
    expect(createMovementSpy).toHaveBeenCalled();
  });

  // Test de venta realista
  it('debería procesar la lógica de señal de venta con señal de compra existente', async () => {
    const indicators = require('../../utils/indicators');
    indicators.calculateSMA.mockImplementation((data, period) => {
      if (period === 9) return 104900; // smaShort
      if (period === 21) return 105000; // smaLong  
      if (period === 50) return 105500; // smaVeryLong
      if (period === 10) return 100; // volumeMA
      return null;
    });
    indicators.calculateEMA.mockImplementation((data, period) => {
      if (period === 12) return 104800; // emaShort
      if (period === 26) return 105200; // emaLong
      return null;
    });
    indicators.calculateMACD.mockReturnValue({
      macdLine: [1, 2, 0],
      signalLine: [1, 2, 2],
      histogram: [0, 0, -2],
    });
    indicators.calculateBollingerBands.mockReturnValue({
      upper: 107000,
      middle: 106000,
      lower: 105000,
    });
    indicators.isBullishEngulfing.mockReturnValue(false);
    indicators.isBearishEngulfing.mockReturnValue(true);
    indicators.calculateRSI.mockReturnValue(70);
    indicators.calculateATR.mockReturnValue(200);

    // Configurar 30+ velas para que pase la validación inicial
    (service as any).candles = Array(35).fill(0).map((_, i) => ({
      open: 105000 + i * 10,
      high: 105100 + i * 10,
      low: 104900 + i * 10,
      close: 105000 + i * 10,
      volume: 100 + i,
      timestamp: Date.now() + i * 1000
    }));

    // Simular señal de compra existente
    const mockBuySignal = {
      id: 'test-buy-signal',
      initialPrice: 105000, // Precio de compra
      movements: [{
        id: 'test-buy-movement',
        type: 'buy',
        price: 105000,
        quantity: 0.001,
        commission: 0.105,
        totalAmount: 105
      }]
    };

    signalDbService.getActiveSignals.mockResolvedValue([mockBuySignal]);
    signalDbService.getSignalById.mockResolvedValue(mockBuySignal);

    const createMovementSpy = jest.spyOn(signalDbService, 'createMovement');

    // Vela de venta con precio que garantiza ganancia
    const sellPrice = 107000; // Precio alto que garantiza ganancia
    const candle = {
      open: 106900,
      high: 107100,
      low: 106800,
      close: sellPrice,
      volume: 150,
      timestamp: Date.now()
    };

    await service.processCandle(candle as any);

    // Verificar que se creó el movimiento de venta
    expect(createMovementSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        signalId: 'test-buy-signal',
        type: 'sell',
        price: sellPrice
      })
    );
  });

  it('debería actualizar lastCandle después de procesar', async () => {
    const indicators = require('../../utils/indicators');
    indicators.calculateSMA.mockReturnValue(105000);
    indicators.calculateEMA.mockReturnValue(105000);
    indicators.calculateMACD.mockReturnValue({
      macdLine: [1, 2, 3],
      signalLine: [1, 2, 2.5],
      histogram: [0, 0, 0.5],
    });
    indicators.calculateRSI.mockReturnValue(55);
    indicators.calculateATR.mockReturnValue(200);
    indicators.calculateBollingerBands.mockReturnValue({
      upper: 107000,
      middle: 106000,
      lower: 105000,
    });
    indicators.isBullishEngulfing.mockReturnValue(true);
    indicators.isBearishEngulfing.mockReturnValue(false);

    // Configurar 30+ velas para que pase la validación inicial
    (service as any).candles = Array(35).fill(0).map((_, i) => ({
      open: 105000 + i * 10,
      high: 105100 + i * 10,
      low: 104900 + i * 10,
      close: 105000 + i * 10,
      volume: 100 + i,
      timestamp: Date.now() + i * 1000
    }));

    const candle = { open: 105800, high: 105900, low: 105700, close: 105850, volume: 150, timestamp: Date.now() };
    await service.processCandle(candle as any);
    expect((service as any).lastCandle).toEqual(candle);
  });

  it('debería resetear contadores diarios correctamente', () => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

    (service as any).lastResetDate = yesterday;
    (service as any).dailySignalCount = 5;

    (service as any).resetDailyCounters();

    expect((service as any).dailySignalCount).toBe(0);
    expect((service as any).lastResetDate).toBe(today);
  });

  it('debería respetar el límite diario de señales', async () => {
    (service as any).dailySignalCount = 10; // Límite alcanzado

    // Configurar 30+ velas para que pase la validación inicial
    (service as any).candles = Array(35).fill(0).map((_, i) => ({
      open: 105000 + i * 10,
      high: 105100 + i * 10,
      low: 104900 + i * 10,
      close: 105000 + i * 10,
      volume: 100 + i,
      timestamp: Date.now() + i * 1000
    }));

    const debugSpy = jest.spyOn((service as any).logger, 'debug');
    const candle = { open: 105800, high: 105900, low: 105700, close: 105850, volume: 150, timestamp: Date.now() };

    await service.processCandle(candle as any);

    expect(debugSpy).toHaveBeenCalledWith('Límite diario de señales alcanzado');
  });
});