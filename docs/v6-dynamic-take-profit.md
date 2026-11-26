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

Durante la entrega inicial, `.env.v2` local tenía Telegram apagado y sin token.
Posteriormente se validó y reutilizó la configuración del `.env` anterior en
el entorno local; esos secretos siguen fuera de Git. La configuración del
servidor depende de sus propias variables de entorno.

## Consultas desde Telegram

El worker recibe comandos con long polling (`getUpdates`) usando el mismo bot.
No necesita puerto público ni webhook. Se habilita cuando Telegram está activo;
`V2_TELEGRAM_COMMANDS_ENABLED=false` permite apagar solamente las consultas.

| Comando | Respuesta |
|---|---|
| `/abiertas` | BTC restante, importe comprado, entrada media, objetivo y qué falta para salir |
| `/ordenes` | Compras y ventas pendientes, parciales o con estado desconocido |
| `/btc` | Último cierre BTC/USDT de 1m persistido, con hora y aviso si está desactualizado |
| `/resumen` | Saldo, ticket configurado, inventario BTC, cierres y P&L |
| `/ayuda` o `/start` | Menú; si falta vincular, muestra el ID del propio chat |

`/posiciones`, `/senales`, `/signals` y `/signas` son alias de `/abiertas`.
`/estado` y `/precio` son alias de `/resumen` y `/btc`. Se admite el sufijo
`@nombre_del_bot`. Las listas tienen páginas: `/abiertas 2`, `/ordenes 2`.
No se registran botones de menú en Telegram automáticamente: el usuario puede
escribir `/ayuda`. Ningún comando compra, vende, cancela ni cambia límites.

Las consultas financieras sólo funcionan en un chat privado cuyo remitente
coincide con ese chat y que está vinculado a una única cuenta activa. Grupos,
canales, bots y comandos dirigidos a otro bot se ignoran. Si hay cero o varias
cuentas vinculadas, sólo se devuelve ayuda para vincular, sin datos de cuentas.
No se aceptan identificadores de otras cuentas como argumentos. Cada respuesta
privada se vuelve a validar contra su usuario al entregar, por si se desvinculó
el chat mientras el mensaje esperaba en Kafka.

El receptor obtiene un advisory lock PostgreSQL por bot para evitar lectores
duplicados entre workers. Si Telegram ya tiene un webhook configurado, no lo
borra: informa `TELEGRAM_WEBHOOK_ALREADY_CONFIGURED` y no inicia polling.
Otro proceso ajeno leyendo el mismo bot puede provocar
`TELEGRAM_POLL_CONFLICT`; debe mantenerse un único receptor por bot.

El recibo del update y la respuesta en outbox se confirman juntos. El próximo
poll sólo confirma el offset después del commit. El cursor se recupera desde
inbox al reiniciar; tras un período prolongado sin updates se omite el offset
viejo, porque Telegram puede aleatorizar el identificador después de una semana.
No se limpia la cola de Telegram al arrancar. Los reintentos respetan la pausa
de Telegram y nunca registran URLs con tokens. Las respuestas usan un consumidor
`telegram-replies` separado de los avisos de trading, para que sus reintentos no
bloqueen el consumidor de notificaciones de compras y cierres.

Las respuestas muestran información al momento de la consulta, no una conexión
de precios en vivo. Un bot habilitado y con token no demuestra que el receptor
esté conectado: verificar el log `telegram_commands_started` del worker.

Prueba HTTP local, usando sólo tokens y chats ficticios:

```powershell
postman simulation run postman/simulations/telegram-commands.sim.yaml --port 4017 --no-history --output ndjson
# En otra terminal:
$env:TELEGRAM_SIMULATION_ORIGIN='http://127.0.0.1:4017/telegram'
npm.cmd test -- --runTestsByPath test/v2/telegram-http.integration-spec.ts
```

La simulación prueba el cliente HTTP y los servicios reales con dobles de
persistencia; no sustituye una prueba con PostgreSQL/Kafka reales ni con el bot
desplegado. El contexto conserva los límites en
`postman/simulations/telegram-commands.context.yaml`.

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
