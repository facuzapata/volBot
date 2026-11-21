# Riesgo y reservas

Cada cuenta nace pausada, con saldo virtual independiente. El usuario sólo puede editar `maxPositions` (1–20) y `usdtPerTrade` (5–100000). El administrador elige el capital inicial al crearla; no se leen saldos Binance.

Dentro del bloqueo de cuenta se comprueban:

- Estado de nuevas entradas y vigencia de la señal (120 segundos por defecto).
- Máximo simultáneo incluyendo OPENING, OPEN, CLOSING, DUST y órdenes desconocidas asociadas.
- USDT disponible y reserva del presupuesto completo, con comisión incluida.
- Exposición máxima: 80 % de equity por defecto, valorizando BTC al precio de referencia actual y sumando reservas pendientes.
- Riesgo de operación estimado: 2 % de equity, incluyendo costos.
- Pérdida diaria realizada o caída de equity: 3 % desde el inicio del día UTC.
- Distancia de stop válida y no superior a 2 %.
- Cantidad mínima y notional después del redondeo.

`UNKNOWN` conserva su reserva y no se ejecuta automáticamente. PAPER no produce resultados de red desconocidos, pero el modelo no libera arbitrariamente esa exposición.

Pausar nuevas entradas o desactivar el acceso no elimina posiciones ni cancela protección. La supervisión trabaja por cuenta, no por usuario activo. No hay compras para promediar pérdidas.

Las órdenes SELL se limitan a la cantidad de su posición. Sólo existe una salida activa por posición. Si un TP parcial sigue pendiente y se toca el stop, se cancela el remanente del TP y se prioriza la protección.

Un residuo cuyo total no cumpla el notional se conserva como DUST, con cantidad y costo visibles. No se registra una venta imposible ni una ganancia realizada ficticia.
