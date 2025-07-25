import { Test, TestingModule } from '@nestjs/testing';
import { SignalDatabaseService } from './signal-database.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalStatus } from '../entities/signal.entity';
import { Movement, MovementType, MovementStatus } from '../entities/movement.entity';

describe('SignalDatabaseService', () => {
  let service: SignalDatabaseService;
  let signalRepository: jest.Mocked<Repository<Signal>>;
  let movementRepository: jest.Mocked<Repository<Movement>>;

  const mockSignal = {
    id: 'test-signal-id',
    symbol: 'BTCUSDT',
    status: SignalStatus.ACTIVE,
    initialPrice: 50000,
    finalPrice: 0,
    stopLoss: 49000,
    takeProfit: 51000,
    atr: 200,
    rsi: 55,
    macd: 0.5,
    smaShort: 50100,
    smaLong: 49900,
    volume: 1000,
    totalProfit: 0,
    totalCommission: 0,
    netProfit: 0,
    paperTrading: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    closedAt: null,
    movements: []
  };

  const mockMovement = {
    id: 'test-movement-id',
    type: MovementType.BUY,
    status: MovementStatus.PENDING,
    price: 50000,
    quantity: 0.001,
    totalAmount: 50,
    commission: 0.05,
    netAmount: 49.95,
    binanceOrderId: null,
    binanceClientOrderId: null,
    binanceResponse: null,
    binanceError: null,
    executedAt: null,
    createdAt: new Date(),
    signal: mockSignal,
    signalId: 'test-signal-id'
  };

  beforeEach(async () => {
    const mockSignalRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const mockMovementRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalDatabaseService,
        {
          provide: getRepositoryToken(Signal),
          useValue: mockSignalRepo
        },
        {
          provide: getRepositoryToken(Movement),
          useValue: mockMovementRepo
        }
      ],
    }).compile();

    service = module.get<SignalDatabaseService>(SignalDatabaseService);
    signalRepository = module.get(getRepositoryToken(Signal));
    movementRepository = module.get(getRepositoryToken(Movement));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSignal', () => {
    it('should create and save a new signal', async () => {
      const signalData = {
        symbol: 'BTCUSDT',
        initialPrice: 50000,
        stopLoss: 49000,
        takeProfit: 51000,
        atr: 200,
        rsi: 55,
        macd: 0.5,
        smaShort: 50100,
        smaLong: 49900,
        volume: 1000,
        paperTrading: true
      };

      signalRepository.create.mockReturnValue(mockSignal as any);
      signalRepository.save.mockResolvedValue(mockSignal as any);

      const result = await service.createSignal(signalData);

      expect(signalRepository.create).toHaveBeenCalledWith({
        ...signalData,
        status: SignalStatus.ACTIVE,
        finalPrice: 0,
        totalProfit: 0,
        totalCommission: 0,
        netProfit: 0
      });
      expect(signalRepository.save).toHaveBeenCalledWith(mockSignal);
      expect(result).toEqual(mockSignal);
    });
  });

  describe('createMovement', () => {
    it('should create and save a new movement', async () => {
      const movementData = {
        signalId: 'test-signal-id',
        type: MovementType.BUY,
        price: 50000,
        quantity: 0.001,
        totalAmount: 50,
        commission: 0.05,
        netAmount: 49.95
      };

      movementRepository.create.mockReturnValue(mockMovement as any);
      movementRepository.save.mockResolvedValue(mockMovement as any);

      const result = await service.createMovement(movementData);

      expect(movementRepository.create).toHaveBeenCalledWith({
        ...movementData,
        status: MovementStatus.PENDING
      });
      expect(movementRepository.save).toHaveBeenCalledWith(mockMovement);
      expect(result).toEqual(mockMovement);
    });
  });

  describe('getActiveSignals', () => {
    it('should return active signals with movements', async () => {
      const activeSignals = [mockSignal];
      signalRepository.find.mockResolvedValue(activeSignals as any);

      const result = await service.getActiveSignals();

      expect(signalRepository.find).toHaveBeenCalledWith({
        where: { status: SignalStatus.ACTIVE },
        relations: ['movements']
      });
      expect(result).toEqual(activeSignals);
    });
  });

  describe('getSignalById', () => {
    it('should return signal by id with movements', async () => {
      signalRepository.findOne.mockResolvedValue(mockSignal as any);

      const result = await service.getSignalById('test-signal-id');

      expect(signalRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-signal-id' },
        relations: ['movements']
      });
      expect(result).toEqual(mockSignal);
    });

    it('should return null if signal not found', async () => {
      signalRepository.findOne.mockResolvedValue(null);

      const result = await service.getSignalById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateMovementStatus', () => {
    it('should update movement status and check signal closure', async () => {
      const movement = { ...mockMovement, signalId: 'test-signal-id' };
      movementRepository.findOne.mockResolvedValue(movement as any);
      movementRepository.save.mockResolvedValue({ ...movement, status: MovementStatus.FILLED } as any);

      // Mock checkAndCloseSignal private method by spying on it
      const checkAndCloseSignalSpy = jest.spyOn(service as any, 'checkAndCloseSignal').mockResolvedValue(undefined);

      const result = await service.updateMovementStatus('test-movement-id', MovementStatus.FILLED);

      expect(movementRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-movement-id' },
        relations: ['signal']
      });
      expect(movementRepository.save).toHaveBeenCalled();
      expect(checkAndCloseSignalSpy).toHaveBeenCalledWith('test-signal-id');
      expect(result.status).toBe(MovementStatus.FILLED);
    });

    it('should throw error if movement not found', async () => {
      movementRepository.findOne.mockResolvedValue(null);

      await expect(service.updateMovementStatus('non-existent-id', MovementStatus.FILLED))
        .rejects.toThrow('Movement with id non-existent-id not found');
    });
  });

  describe('getSignalStatistics', () => {
    it('should return comprehensive signal statistics', async () => {
      signalRepository.count
        .mockResolvedValueOnce(100) // totalSignals
        .mockResolvedValueOnce(5)   // activeSignals
        .mockResolvedValueOnce(90)  // matchedSignals
        .mockResolvedValueOnce(85); // profitableSignals

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalProfit: '1000.50',
          totalCommission: '50.25',
          totalNetProfit: '950.25'
        })
      };

      signalRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      const result = await service.getSignalStatistics();

      expect(result).toEqual({
        totalSignals: 100,
        activeSignals: 5,
        matchedSignals: 90,
        totalProfit: 1000.50,
        totalCommission: 50.25,
        totalNetProfit: 950.25,
        successRate: (85 / 90) * 100,
        avgProfitPerSignal: 950.25 / 90
      });
    });
  });
});
