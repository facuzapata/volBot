import { Test, TestingModule } from '@nestjs/testing';
import { StrategyService } from 'src/strategy/services/strategy.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import * as indicators from '../src/utils/indicators';

class MockEventEmitter2 {
    emit = jest.fn();
    on = jest.fn();
    off = jest.fn();
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

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StrategyService,
                { provide: EventEmitter2, useClass: MockEventEmitter2 },
            ],
        }).compile();

        service = module.get<StrategyService>(StrategyService);
        eventEmitterInstance = module.get(EventEmitter2);
        jest.spyOn(eventEmitterInstance, 'emit');
    });

    it('procesa BTC histórico y reporta señales y resultado', () => {
        // Carga y parsea el CSV
        const csvPath = path.join(__dirname, 'data', 'btc.data.csv');
        const csv = fs.readFileSync(csvPath, 'utf8');
        const candles = parseCSV(csv).slice(0, 8000); // Solo las primeras 1000 velas

        // Simulación de capital
        let capital = 40;
        let position = null as null | { entry: number, size: number };
        let wins = 0, losses = 0, buys = 0, sells = 0;
        const COMMISSION = 0.001;
        let openPositions: { id: string, entry: number, size: number }[] = [];
        // Procesa cada vela
        for (const candle of candles) {
            service.processCandle(candle);

            for (const call of eventEmitterInstance.emit.mock.calls) {
                const [event, signal] = call;
                console.log('Señal:', event, signal);

                if (event === 'trade.sell') {
                    sells++;
                    const posIdx = openPositions.findIndex(pos => pos.id === signal.id);
                    if (posIdx !== -1) {
                        const position = openPositions[posIdx];
                        const profit = (signal.price - position.entry) * position.size;
                        capital += profit;
                        capital -= capital * COMMISSION;
                        if (profit > 0) wins++; else losses++;
                        openPositions.splice(posIdx, 1);
                        service.closeSignal(signal.id);
                    }
                }
                if (event === 'trade.buy' && !position) {
                    buys++;
                    openPositions.push({
                        id: signal.id,
                        entry: signal.price,
                        size: capital / signal.price,
                    });

                    capital -= capital * COMMISSION; // comisión de compra
                    // Cierra la señal activa para permitir nuevas señales
                    service.closeSignal(signal.symbol);
                }
            }
            eventEmitterInstance.emit.mockClear();
        }

        // Si queda una posición abierta al final, ciérrala al último precio
        if (openPositions.length > 0) {
            const lastPrice = candles[candles.length - 1].close;
            for (const position of openPositions) {
                const profit = (lastPrice - position.entry) * position.size;
                capital += profit;
                capital -= capital * COMMISSION;
                if (profit > 0) wins++; else losses++;
                sells++;
            }
            openPositions = [];
        }

        console.log('Total señales de compra:', buys);
        console.log('Total señales de venta:', sells);
        console.log('Ganadas:', wins, 'Perdidas:', losses);
        console.log('Capital final:', capital.toFixed(2), 'USDT');
    });
});