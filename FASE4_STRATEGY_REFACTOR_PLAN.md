# FASE 4: Estrategias por Usuario-Símbolo

## Objetivo

Adaptar `MultiUserStrategyService` para procesar velas de múltiples símbolos/timeframes simultáneamente, executando estrategias independientes por usuario-símbolo.

## Cambios Requeridos

### 1. Implementar `processCandleMulti()` en MultiUserStrategyService

```typescript
async processCandleMulti(
    candle: Candle,
    symbol: string,
    timeframeMinutes: number
): Promise<void> {
    // Procesar vela para ESTE símbolo/timeframe específico
    // No asumir que es BTC 1m
}
```

### 2. Refactorizar CandleCacheService

**Problema actual:** Usa Redis, pero es un único cache global para BTC

**Solución:** Cache por símbolo-timeframe

```typescript
// Antes:
cache["closes"] = [...]  // Assumes BTC

// Después:
cache["BTCUSDT:1"]["closes"] = [...]
cache["ETHUSDT:5"]["closes"] = [...]
cache["ADAUSDT:1"]["closes"] = [...]
```

**Implementación:**
```typescript
async addCandle(
    candle: Candle, 
    symbol: string, 
    timeframeMinutes: number
) {
    const key = `${symbol}:${timeframeMinutes}`;
    // get cached candles for this symbol:timeframe
    // add new candle
    // keep only last 200 candles
}

async getCandles(symbol: string, timeframeMinutes: number): Candle[] {
    const key = `${symbol}:${timeframeMinutes}`;
    // return cached candles for this symbol:timeframe
}
```

### 3. Refactorizar Indicadores

**Problema actual:** Los indicadores se calculan globalmente una vez

**Solución:** Mantener mapa de indicadores por símbolo-timeframe

```typescript
// Map<"BTCUSDT:1", { sma: [...], rsi: [...], macd: {...}, ... }>
// Map<"ETHUSDT:5", { sma: [...], rsi: [...], macd: {...}, ... }>
```

**Pseudocódigo:**
```typescript
private indicatorsCache: Map<string, CalculatedIndicators>;

async calculateIndicatorsForSymbol(
    symbol: string,
    timeframe: number
): CalculatedIndicators {
    const key = `${symbol}:${timeframe}`;
    
    const candles = await this.candleCacheService.getCandles(symbol, timeframe);
    
    // Calcular ALL indicadores para este símbolo/timeframe
    const indicators = {
        smaShort: SMA(closes, 9),
        smaLong: SMA(closes, 21),
        // ... resto de indicadores
    };
    
    this.indicatorsCache.set(key, indicators);
    return indicators;
}
```

### 4. Refactorizar Análisis de Mercado

**Problema actual:** El análisis asume un símbolo global

**Solución:** Análisis independiente por símbolo

```typescript
// Ahora esto:
analyzeMarketConditions(
    lastCandle,
    indicators,
    activeSignals,
    candles
)

// Se convierte en esto:
analyzeMarketConditionsForSymbol(
    symbol: string,
    timeframeMinutes: number,
    lastCandle,
    indicators,
    activeSignals,
    candles
)
```

### 5. Estrategia por Usuario-Símbolo

**Nuevo concepto: StrategyInstance**

Cada combinación usuario-símbolo-timeframe tiene su propia "estrategia":

```typescript
interface StrategyInstance {
    userId: string;
    symbol: string;
    timeframeMinutes: number;
    
    // Estado específico de esta combinación
    userConfig: UserStrategyConfig;
    highestSignalPrice?: number;
    lastCandleTime?: number;
}

private strategyInstances: Map<string, StrategyInstance>;
// key: "user123:BTCUSDT:1", "user456:ETHUSDT:5", etc
```

### 6. Refactorizar processUserStrategy()

**Antes:** Se llamaba UNA VEZ por usuario, asumiendo 1 símbolo

**Después:** Se llama por cada usuario-símbolo-timeframe

```typescript
// ANTES:
for (const [userId, userConfig] of this.userConfigs) {
    await this.processUserStrategy(userId, userConfig, candle, GLOBAL_INDICATORS);
}

// DESPUÉS:
for (const instance of this.getStrategyInstancesFor(symbol, timeframe)) {
    await this.processStrategyInstance(
        instance,
        candle,
        indicators
    );
}
```

### 7. Señal por Usuario-Símbolo

Las señales ya tienen `userId`, perfecto. Pero ahora también necesitan validar que el símbolo coincide:

```typescript
// Antes obtenemos:
activeSignals = signalDbService.getActiveSignalsForUser(userId)

// Ahora:
activeSignals = signalDbService.getActiveSignalsForUser(
    userId,
    symbol  // ← NUEVO
)
```

## Diagrama de Flujo Nueva Arquitectura

```
BinanceMultiWsService emite: "candle:received"
    ↓ (BTCUSDT, 1m, candle)
    ↓
MultiUserStrategyService.processCandleMulti()
    ↓
1. Agregar vela al cache (BTCUSDT:1)
2. Calcular indicadores (BTCUSDT:1)
3. Para cada usuario con BTCUSDT:1 habilitado:
    └── Obtener señales activas del usuario para BTCUSDT
    └── Procesar estrategia del usuario
    └── Generar nuevas señales si corresponde
4. Emitir evento "signal:created"
    ↓
Trading/Notifications consumen el evento
```

## Impacto en Servicios Dependientes

### Signal Database Service
```typescript
// Agregar parámetro symbol
getActiveSignalsForUser(userId: string, symbol: string): Signal[]
createSignalForUser(userId: string, symbol: string, signalData): Signal
```

### Trading Service
Puede mantenerse igual, pero ahora recibirá órdenes de múltiples símbolos

### Notifications
Puede mantenerse igual, ya está adaptado para userId

## Estimación de Esfuerzo

| Componente | Complejidad | Tiempo | Descripción |
|-----------|-------------|--------|------------|
| CandleCacheService | Media | 1-2h | Refactorizar para multi-symbol |
| Indicadores | Media | 1-2h | Mantener mapa por símbolo |
| Análisis | Media | 1-2h | Hacer independiente por símbolo |
| processUserStrategy | Alta | 2-3h | Refactor completo del flujo |
| Signal queries | Baja | 30m | Agregar filtro de symbol |
| Testing | Alta | 2-3h | Tests para cada símbolo |
| **Total** | - | **8-13h** | - |

## Rollback Strategy

Si algo falla, se puede volver a mono-símbolo rápidamente porque:

1. La base de datos soporta múltiples símbolos (pero usa solo 1)
2. BinanceWsService original sigue comentado
3. Las señales tienen userId, se pueden filtrar manualmente

## Próximos Pasos After FASE 4

- ✅ FASE 1: Notificaciones por usuario
- ✅ FASE 2: Símbolos configurables por usuario
- ✅ FASE 3: WebSockets multi-símbolo
- ✅ FASE 4: Estrategias por usuario-símbolo
- ⏭️ Dashboard para gestionar usuarios/símbolos
- ⏭️ API REST para CRUD de configuraciones
- ⏭️ Backtesting multi-símbolo
- ⏭️ Performance monitoring por usuario-símbolo
