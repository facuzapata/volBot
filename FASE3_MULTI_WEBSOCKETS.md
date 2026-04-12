# FASE 3: WebSockets Multi-Símbolo

## Cambios Principales

### Nuevo Servicio: BinanceMultiWsService

Reemplaza el anterior`BinanceWsService` (mono-símbolo) con un sistema dinámico que:

✅ Mantiene múltiples WebSockets simultáneamente
✅ Soporta qualquier símbolo (BTC, ETH, ADA, DOGE, etc.)
✅ Soporta múltiples timeframes (1m, 5m, 15m, 1h, etc.)
✅ Reconecta automáticamente si falla
✅ Lee configuraciones de `user_trade_configs` al iniciar
✅ Emite eventos específicos por símbolo/timeframe

### Arquitectura

```
user_trade_configs (BD)
    ↓ (qué símbolos/timeframes necesitan?)
    ↓
BinanceMultiWsService.onModuleInit()
    ↓
Crear WebSocket para cada símbolo/timeframe requerido
    ↓
    ├─ ws://BTCUSDT@1m  → emite: "candle:received" (BTCUSDT, 1min)
    ├─ ws://ETHUSDT@1m  → emite: "candle:received" (ETHUSDT, 1min)
    ├─ ws://ADAUSDT@5m  → emite: "candle:received" (ADAUSDT, 5min)
    └─ ...
```

### Ejemplo de Flujo

1. **Usuario A** configura: BTC 1m, ETH 1m
2. **Usuario B** configura: BTC 5m, ADA 1h
3. **Sistema genera WebSockets para:**
   - BTC 1m (compartido entre A y B)
   - BTC 5m (solo B)
   - ETH 1m (solo A)
   - ADA 1h (solo B)

### Cambios en Strategy Callback

La interfaz `StrategyCallback` ahora tiene dos métodos:

```typescript
export interface StrategyCallback {
    // LEGACY - compatible hacia atrás
    processCandle?(candle, ...): void;
    
    // NUEVO - con símbolo y timeframe
    processCandleMulti?(candle, symbol, timeframeMinutes): Promise<void>;
}
```

### Ventajas

| Antes | Después |
|-------|---------|
| 1 WebSocket global | N WebSockets dinámicos |
| Solo BTC 1m | Cualquier símbolo/timeframe |
| No escalable | Altamente escalable |
| Redeploy para agregar símbolos | Agregar en BD, automático |
| Todos los usuarios ven BTC | Cada usuario ve sus símbolos |

## Próximos Pasos (FASE 4)

El `MultiUserStrategyService` deberá adaptarse para:

1. Recibir velas de múltiples símbolos vía `processCandleMulti()`
2. Mantener caches separados por símbolo
3. Ejecutar estrategias por usuario-símbolo
4. Generar señales correctas para cada combinación

## Tránsito de Servicios

```
ANTES:
BinanceWsService → processCandle() → MultiUserStrategyService

DESPUÉS:
BinanceMultiWsService → processCandleMulti(candle, symbol, tf)
                     → MultiUserStrategyService (adaptado)
```

## Rollback

Si es necesario volver a mono-símbolo:
```typescript
// En BinanceModule
// descomentar: BinanceWsService
// comentar: BinanceMultiWsService
```
