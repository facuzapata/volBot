import { Test, TestingModule } from '@nestjs/testing';
import { StrategyService } from 'src/strategy/services/strategy.service';
import { SignalDatabaseService } from 'src/strategy/services/signal-database.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import * as indicators from '../src/utils/indicators';

class MockEventEmitter2 {
    emit = jest.fn();
    on = jest.fn();
    off = jest.fn();
}

class MockSignalDatabaseService {
    private signals: any[] = [];
    private movements: any[] = [];
    private currentId = 1;

    async createSignal(data: any) {
        const signal = {
            id: this.currentId++,
            ...data,
            status: 'active',
            createdAt: new Date(),
        };
        this.signals.push(signal);
        return signal;
    }

    async createMovement(data: any) {
        const movement = {
            id: this.currentId++,
            ...data,
            createdAt: new Date(),
        };
        this.movements.push(movement);
        return movement;
    }

    async getActiveSignals() {
        return this.signals.filter(s => s.status === 'active');
    }

    async getSignalById(id: number) {
        return this.signals.find(s => s.id === id);
    }

    async updateSignalStatus(id: number, status: string) {
        const signal = this.signals.find(s => s.id === id);
        if (signal) {
            signal.status = status;
            signal.updatedAt = new Date();
        }
        return signal;
    }

    async getDailySignalCount() {
        const today = new Date().toDateString();
        return this.signals.filter(s =>
            new Date(s.createdAt).toDateString() === today
        ).length;
    }

    async getSignalStatistics() {
        return {
            totalSignals: this.signals.length,
            totalMovements: this.movements.length,
            activeSignals: this.signals.filter(s => s.status === 'active').length,
            completedSignals: this.signals.filter(s => s.status === 'completed').length,
        };
    }
}

function parseCSV(csv: string) {
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
        const cols = line.split(',');
        const obj: any = {};
        headers.forEach((h, i) => {
            obj[h.trim()] = cols[i].trim();
        });
        return {
            open: parseFloat(obj.open),
            high: parseFloat(obj.high),
            low: parseFloat(obj.low),
            close: parseFloat(obj.close),
            volume: parseFloat(obj['Volume BTC']),
            time: Number(obj.unix),
        };
    });
}

describe('StrategyService - BTC histórico', () => {
    let service: StrategyService;
    let eventEmitterInstance: MockEventEmitter2;
    let signalDbService: MockSignalDatabaseService;

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StrategyService,
                { provide: EventEmitter2, useClass: MockEventEmitter2 },
                { provide: SignalDatabaseService, useClass: MockSignalDatabaseService },
            ],
        }).compile();

        service = module.get<StrategyService>(StrategyService);
        eventEmitterInstance = module.get(EventEmitter2);
        signalDbService = module.get(SignalDatabaseService);
        jest.spyOn(eventEmitterInstance, 'emit');
    });

    it('procesa BTC histórico y reporta señales y resultado', async () => {
        // Carga y parsea el CSV
        const csvPath = path.join(__dirname, 'data', 'btc.data.csv');
        const csv = fs.readFileSync(csvPath, 'utf8');
        const candles = parseCSV(csv).slice(0, 1000); // Solo las primeras 1000 velas

        // Simulación de capital
        let capital = 40;
        let wins = 0, losses = 0, buys = 0, sells = 0;
        const COMMISSION = 0.001;
        const openPositions = new Map(); // signal.id -> position data

        // Procesa cada vela
        for (const candle of candles) {
            await service.processCandle(candle);

            // Procesa las señales emitidas
            for (const call of eventEmitterInstance.emit.mock.calls) {
                const [event, signal] = call;
                console.log('Señal:', event, signal);

                if (event === 'trade.sell' && signal.buySignalId) {
                    sells++;
                    const position = openPositions.get(signal.buySignalId);
                    if (position) {
                        const profit = (signal.price - position.entry) * position.size;
                        capital += profit;
                        capital -= capital * COMMISSION;
                        if (profit > 0) wins++; else losses++;
                        openPositions.delete(signal.buySignalId);

                        // Actualiza el estado de la señal en el mock
                        await signalDbService.updateSignalStatus(signal.buySignalId, 'completed');
                    }
                }

                if (event === 'trade.buy') {
                    buys++;
                    const position = {
                        entry: signal.price,
                        size: capital / signal.price,
                    };
                    openPositions.set(signal.id, position);
                    capital -= capital * COMMISSION; // comisión de compra
                }
            }
            eventEmitterInstance.emit.mockClear();
        }

        // Si quedan posiciones abiertas al final, ciérralas al último precio
        if (openPositions.size > 0) {
            const lastPrice = candles[candles.length - 1].close;
            for (const [signalId, position] of openPositions) {
                const profit = (lastPrice - position.entry) * position.size;
                capital += profit;
                capital -= capital * COMMISSION;
                if (profit > 0) wins++; else losses++;
                sells++;
                await signalDbService.updateSignalStatus(signalId, 'completed');
            }
        }

        // Obtiene estadísticas finales
        const stats = await signalDbService.getSignalStatistics();

        console.log('=== RESULTADOS DEL BACKTEST ===');
        console.log('Total señales de compra:', buys);
        console.log('Total señales de venta:', sells);
        console.log('Ganadas:', wins, 'Perdidas:', losses);
        console.log('Capital final:', capital.toFixed(2), 'USDT');
        console.log('Retorno:', ((capital / 40 - 1) * 100).toFixed(2), '%');
        console.log('Estadísticas DB:', stats);

        // Validaciones básicas
        expect(buys).toBeGreaterThan(0);
        expect(stats.totalSignals).toBe(buys);
        expect(capital).toBeGreaterThan(0);
    });
});