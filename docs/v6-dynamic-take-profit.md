# V6: salida dinámica en PAPER y Telegram

## Comportamiento y activación

La compra y el objetivo V6 no cambian. La política `v6-dtp-2026-11-26.1` se
guarda solamente en posiciones V6 PAPER nuevas cuando el worker tiene:

```dotenv
V2_V6_DYNAMIC_TP_ENABLED=true
V2_V6_DYNAMIC_TP_NOISE_HALF_LIFE_MS=30000
V2_V6_DYNAMIC_TP_NOISE_MULTIPLIER=3
```

Por defecto está apagada. Las posiciones existentes conservan su take profit
fijo. Cambiar la variable no migra posiciones, balances, órdenes ni historial.
Las posiciones dinámicas existentes siguen gestionándose aunque se apague la
variable: ésta controla las aperturas nuevas. No se necesita una migración SQL;
el estado se almacena en el JSONB de la posición.

`WAITING_TARGET` pasa a `TRACKING_PRICE` cuando una observación alcanza el
objetivo. Mientras el precio sube, se conserva el máximo observado. La venta se
solicita al retroceder desde ese máximo por una distancia adaptativa, o al
volver al objetivo o por debajo de él después de activarse. La distancia es el
máximo de dos ticks, una banda de costos configurada (spread más dos slippages)
y tres veces el movimiento absoluto suavizado por una EMA temporal. La vida
media y el multiplicador son parámetros iniciales de ingeniería, no parámetros
de rentabilidad validados con datos de mercado.

El objetivo original queda congelado. La salida usa SELL LIMIT a ese objetivo
redondeado hacia arriba al tick válido. Puede ejecutar por encima del límite,
por partes o quedar pendiente. Si el precio cae por debajo, conserva la orden
y espera una observación posterior que permita ejecutar a ese precio o mejor.
No se promete ni ejecución completa ni un plazo. El piso es de precio bruto;
las comisiones se contabilizan por cada fill.

La simulación descuenta spread/slippage al estimar el precio vendedor y NO
fuerza ese precio hacia arriba para inventar una ejecución en el piso. La
liquidez sigue limitada por el presupuesto compartido basado en volumen del
minuto anterior. Los cierres manuales y las salidas de otras estrategias
conservan sus reglas; V6 TARGET_ONLY ya carecía de stop y vencimiento.

## Datos y recuperación

Se reutiliza la conexión WebSocket combinada existente. Cada actualización
válida de `btcusdt@kline_1m` aporta su último precio `k.c` y tiempo `E`, incluso
antes del cierre. Las velas de compra siguen publicándose únicamente al cerrar.
Nunca se interpreta `k.h`/`k.l` como una secuencia de ticks.

Esto es seguimiento de precios muestreados, aproximadamente cada dos segundos,
no de todas las operaciones ni de cotizaciones ejecutables de Binance. Puede
perder un máximo o un cruce breve entre observaciones. No se agregan conexiones
por cuenta ni consultas REST por precio. Ver [streams oficiales de Binance](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md).

Las observaciones se publican mediante outbox como `market.price.observed.v1`,
clave BTCUSDT. Un consumidor `price-exits` separado del de compras gestiona
solamente cuentas con posiciones dinámicas. El máximo, la última observación,
el estimador de ruido y la fase se persisten transaccionalmente con las órdenes
y fills. Observaciones duplicadas o anteriores no vuelven a ejecutar órdenes.
Los bloqueos de cuenta y de liquidez compartida coordinan este consumidor con
las velas y acciones manuales.

Los eventos de más de diez segundos no ejecutan salidas en vivo. Los intervalos
perdidos no se reconstruyen desde OHLC: se conserva el máximo conocido y se
reanuda con precios nuevos. El ruido se reinicia tras un hueco prolongado. El
cliente público respeta `Retry-After` en 429/418 sin reintentar durante la pausa.

## API y reproducción

`GET /api/me/positions` incluye `dynamicTakeProfit` en las posiciones que usan
la política: fase, objetivo original, máximo, observaciones y configuración.
Es información adicional; los estados existentes de posición y orden siguen
siendo la referencia para inventario y ejecución. El frontend aún debe
presentar estos datos si se quiere mostrar el seguimiento en pantalla.

El backtest dinámico requiere observaciones explícitas y cronológicas como
quinto argumento del motor:

```ts
engine.run(candles, options, tradeStart, tradeEnd, priceObservations);
```

Sin observaciones, una configuración dinámica V6 devuelve
`DYNAMIC_TP_REQUIRES_PRICE_OBSERVATIONS`. La API HTTP de backtest no admite
todavía cargar este conjunto. El reporte registra su hash y cantidad. Los
tests usan trayectorias sintéticas para verificar funcionamiento; no prueban
ganancias adicionales con datos históricos reales. No se liquidan posiciones
al finalizar la muestra para esconder capital inmovilizado.

## Telegram

El backend ya enviaba avisos por señal, ejecución, cierre y resumen diario. Se
agregan `DYNAMIC_TP_ACTIVATED` y `DYNAMIC_TP_EXIT_REQUESTED`, emitidos una sola
vez por transición mediante outbox. Una solicitud de venta no se anuncia como
venta ejecutada; cada fill y el cierre siguen sus avisos respectivos.

`GET /api/me/notifications`, autenticado, devuelve:

```json
{
  "telegram": {
    "enabled": false,
    "botConfigured": false,
    "chatLinked": false,
    "ready": false
  }
}
```

`ready` informa configuración disponible, no confirma que Telegram acepte el
token o que el bot pueda escribir al chat. No se exponen token ni identificador
de chat. Para activar hacen falta `V2_TELEGRAM_ENABLED=true`, un token real en
`V2_TELEGRAM_BOT_TOKEN` y un chat del destinatario vinculado por administrador
con el endpoint existente `PATCH /api/admin/users/:id/notifications`.
No usar un chat global como reemplazo. El destinatario debe habilitar la
conversación con el bot. Mantener credenciales en el entorno, no en Git.

La entrega verifica HTTP y el campo `ok`, y respeta `parameters.retry_after`
en el reintento por Kafka. Los eventos confirmados tienen deduplicación en
inbox; sigue siendo entrega al menos una vez: una caída después de enviar pero
antes de confirmar la transacción puede duplicar un mensaje, ya que
`sendMessage` no proporciona la misma transacción que PostgreSQL. Ver
[Bot API oficial](https://core.telegram.org/bots/api).

El resumen cubre el último día UTC completo. Se intenta al iniciar el worker
y cada hora; su clave de cuenta/día evita repetir resúmenes ya procesados.
No incluye automáticamente todos los días anteriores a una interrupción larga.
Los fallos agotados se conservan en dead letters para revisión/reintento.

En esta sesión, `.env.v2` local tiene Telegram apagado y sin token. No se
enviaron mensajes reales ni se cambió la configuración del servidor. Esa
comprobación local no determina la configuración remota.

## Entrega

Reconstruir API y worker con el mismo código y entorno; ambos necesitan ver la
misma configuración de Telegram para que el endpoint describa al emisor real.
El worker crea el topic y el nuevo grupo. No ejecutar seed ni reset de datos.
Mantener primero la opción dinámica desactivada hasta preparar el despliegue
PAPER y habilitarla expresamente. Ningún componente envía órdenes Binance LIVE.

Validación local: suites de precios dinámicos, persistencia/outbox, Telegram,
contrato HTTP, mercado, estrategias, contabilidad y backtesting; además build,
lint y OpenAPI. Las pruebas con PostgreSQL/Kafka reales requieren las variables
de integración y no se sustituyen por los dobles usados en los tests locales.
El test local preexistente `btc-v5-historical-range.spec.ts` continúa teniendo
errores de tipos ajenos a este cambio.
