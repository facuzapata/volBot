# Contratos Kafka

Envelope: `eventId`, `schemaVersion: 1`, `topic`, `key`, `occurredAt` ISO UTC, `correlationId`, `causationId` opcional y `payload`. Los tipos están en `src/v2/events/contracts.ts`; no se incluyen claves Binance, contraseñas ni tokens.

| Topic | Clave | Payload |
|---|---|---|
| market.candle.closed.v1 | BTCUSDT:intervalo | candle, recovered |
| strategy.signal.created.v1 | BTCUSDT | señal compartida y configuración versionada |
| execution.command.v1 | accountId | accountId, orderId, signalTime, price |
| execution.order.updated.v1 | accountId | orderId, status |
| position.updated.v1 | accountId | positionId, status, netPnl |
| notification.requested.v1 | userId | userId, kind, text |
| market.price.observed.v1 | BTCUSDT | symbol, at, price; observación intravela muestreada |
| telegram.reply.requested.v1 | chatId | chatId, userId opcional, kind (HELP o ACCOUNT_QUERY), text |

Tres particiones por topic; una réplica en el entorno local. Groups: `volbot-v2-trading` y `volbot-v2-notifications`. KafkaJS usa productor idempotente, `acks=-1` y una petición en vuelo.

`V2_KAFKA_NAMESPACE` es opcional y se usa para aislar suites de integración: prefija topics y groups, manteniendo el nombre lógico del contrato dentro del envelope. No se configura en la simulación habitual.

Las salidas dinámicas usan el group `volbot-v2-price-exits`. Las respuestas a
comandos Telegram usan `volbot-v2-telegram-replies`, separado del group de avisos
de trading. Los payloads de respuesta pueden contener datos privados de la
cuenta; se revalida la vinculación chat/usuario antes de entregarlos. No son
topics destinados a consumo público del frontend.

## Recuperación

El productor toma outbox pendiente con `FOR UPDATE SKIP LOCKED`, publica y después marca enviado. Una caída entre publicación y commit produce una posible reentrega; el inbox la vuelve inocua.

Los consumidores ejecutan reintentos con backoff acotado y persistido en `v2_delivery_attempts`. Después de cinco fallos se conserva el evento en `<topic>.dlq` mediante outbox. El administrador puede consultar intentos agotados y solicitar replay manteniendo el mismo eventId.

Reintentar una señal no reabre decisiones ya confirmadas para cuentas anteriores. Una orden que pasó a cancelada por caducidad no se resucita al reproducir su comando.

Kafka no sustituye a las transacciones PostgreSQL. No se afirma atomicidad distribuida con sistemas externos. La caída de Kafka retrasa también la supervisión PAPER: los triggers se evalúan al recuperar las velas, no durante el corte. No es apto como protección de fondos reales.

Los topics de actualización de posiciones/órdenes quedan disponibles para futuras proyecciones. En esta entrega el dashboard consulta PostgreSQL directamente.
