# FASE 2: Configuración de Símbolos por Usuario

## Descripción
Cada usuario puede ahora tradear múltiples símbolos en múltiples timeframes con configuraciones personalizadas.

## Estructura de Datos

### Tabla: user_trade_configs
```
user_id              → UUID (referencia a users.id)
symbol               → VARCHAR (ej: BTCUSDT, ETHUSDT, ADAUSDT)
timeframe_minutes    → INT (ej: 1, 5, 15, 60, 240)
is_enabled           → BOOLEAN (habilitar/deshabilitar)
*_override           → Configuración específica por símbolo
```

## Ejemplos de Uso

### Ejemplo 1: Usuario tradea BTC en 1m y 5m
```sql
INSERT INTO user_trade_configs (user_id, symbol, timeframe_minutes, notes)
SELECT id, 'BTCUSDT', 1, 'Bitcoin 1 minuto' FROM users WHERE email = 'trader1@example.com';

INSERT INTO user_trade_configs (user_id, symbol, timeframe_minutes, notes)
SELECT id, 'BTCUSDT', 5, 'Bitcoin 5 minutos' FROM users WHERE email = 'trader1@example.com';
```

### Ejemplo 2: Usuario tradea ETH y DOGE con márgenes diferentes
```sql
INSERT INTO user_trade_configs (
    user_id, symbol, timeframe_minutes, 
    profit_margin_override, sell_margin_override,
    notes
)
SELECT id, 'ETHUSDT', 1, 0.008, 0.006, 'Ethereum - márgenes altos'
FROM users WHERE email = 'trader2@example.com';

INSERT INTO user_trade_configs (
    user_id, symbol, timeframe_minutes,
    capital_per_trade_override, notes
)
SELECT id, 'DOGUSDT', 5, 50, 'Doge con capital reducido'
FROM users WHERE email = 'trader2@example.com';
```

## API Endpoints (Próximos)

Se agregarán endpoints REST para gestionar configuraciones dinámicamente:

```
POST   /users/{userId}/trade-configs
       Crear nueva configuración

GET    /users/{userId}/trade-configs
       Listar todas las configuraciones

PUT    /users/{userId}/trade-configs/{configId}
       Actualizar configuración

DELETE /users/{userId}/trade-configs/{configId}
       Eliminar configuración

PATCH  /users/{userId}/trade-configs/{configId}/toggle
       Habilitar/deshabilitar
```

## Overrides (Configuración Específica por Símbolo)

Un usuario puede tener márgenes diferentes por símbolo:

```typescript
// Usuario genérico: profit margin 0.5%, sell margin 0.4%, capital $20
User: {
  profitMargin: 0.005,
  sellMargin: 0.004,
  capitalPerTrade: 20
}

// Pero para ETHUSDT con volatilidad, usar márgenes mayores:
UserTradeConfig (ETHUSDT): {
  profitMarginOverride: 0.008,
  sellMarginOverride: 0.006,
  capitalPerTradeOverride: 30  // más capital para grandes movimientos
}

// Y para DOGUSDT, usar márgenes más ajustados:
UserTradeConfig (DOGE): {
  profitMarginOverride: 0.003,
  sellMarginOverride: 0.002,
  capitalPerTradeOverride: 10   // menos capital = menos riesgo
}
```

## Próximos Pasos

La FASE 3 (WebSockets multi-símbolo) usará esta información para:

1. Consultar `user_trade_configs` al iniciar
2. Obtener list de símbolos/timeframes requeridos
3. Crear WebSockets dinámicamente por cada símbolo/timeframe
4. Enrutar velas a la estrategia correcta por usuario

## Notas Técnicas

- El campo `unique (user_id, symbol, timeframe_minutes)` evita duplicados
- Los índices optimizan búsquedas por usuario, símbolo y timeframe
- Los overrides son opcionales (null = usar defaults del usuario)
- El campo `notes` sirve para documentar por qué se creó cada config
