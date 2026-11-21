# Validación ejecutada — 20 de noviembre de 2026

Rama: `feature/volbot-v2-event-driven`. Cambios sin commit ni push. Las pruebas usaron únicamente cuentas virtuales y datos públicos; no se enviaron órdenes ni cancelaciones a Binance. La auditoría posterior y sus resultados ampliados están en [simulator-audit.md](simulator-audit.md) y [strategy-diagnostics.md](strategy-diagnostics.md).

## Evidencia de ejecución

| Comprobación | Resultado |
|---|---|
| `npm.cmd run typecheck` | Correcto, sin errores |
| `npm.cmd run lint` | Correcto; ámbito V2, sus tests y entrypoints modificados |
| `npm.cmd test` | 85 pruebas aprobadas; 9 omitidas en esta invocación |
| `npm.cmd run test:integration` | 8 pruebas aprobadas con PostgreSQL y Kafka reales |
| `npm.cmd run docs:openapi` | Documento generado sin iniciar servicios externos |
| `npm.cmd run build` | Compilación completa correcta |
| Docker Compose V2 | Imágenes construidas, migración aditiva aplicada y servicios iniciados |
| HTTP real | Login, usuarios, saldos PAPER, autorización, rechazo de campos extra, Swagger y readiness verificados |
| Mercado público | Precarga 1m/5m/1h, recepción de velas y estado de evaluación persistido observados |
| Backtest HTTP/CLI | Mismo hash de datos y mismo P&L; reporte persistido y acceso de otro usuario rechazado |

Las nueve omisiones de la suite normal corresponden a ocho pruebas de integración que se ejecutaron por separado y a un experimento histórico V1 deliberadamente archivado por usar otra estrategia y datos invertidos.

La suite integrada comprueba:

- Diez solicitudes concurrentes frente a un máximo de una posición: una sola reserva admitida.
- Consumo duplicado: una sola orden y un solo fill de entrada.
- Rollback conjunto de saldo, inbox y outbox.
- Evento conservado en PostgreSQL sin publicar en Kafka.
- Dos entregas concurrentes de la misma vela: una fila de mercado y un solo evento outbox.
- Transporte real de envelope, clave de cuenta e identidad de evento en un topic aislado.
- Cadena real outbox → Kafka → dispatcher → riesgo → PAPER; reinicio del consumidor con posición abierta; reentrega; cierre por stop; dos fills totales y balance conciliado.

La prueba HTTP de Nest usa un doble aislado de persistencia para los casos de autorización. El smoke HTTP adicional usa la API Docker y PostgreSQL reales. Son evidencias distintas, no equivalentes.

## Backtest de datos públicos

- BTCUSDT 1m, 1–7 de enero de 2025; fin exclusivo: 8 de enero.
- 10.080 velas; datos descargados desde el host público de Binance.
- SHA256 normalizado: `f546b4f8d658ed815c03be18c875e3ce98163031397ebe0930e51d7ef805e7e2`.
- Estrategia `btc-v2`, revisión `2026-11-20.1`.
- Capital500, máximo5 posiciones,30 USDT por entrada.
- Comisión0,1 % por lado, spread2 bps y slippage3 bps.

Resultado observado: 28 posiciones cerradas, todas por stop; ganancia neta **−3,1064573288 USDT**, capital final **496,8935426712 USDT**, comisiones **1,6543603288 USDT**, máximo simultáneo3 y drawdown aproximado0,631 %.

Se ejecutaron además las seis variantes con división70/15/15. Estos siete días son una comprobación funcional y un primer experimento desfavorable, no una validación estadística ni evidencia de rentabilidad. No se ajustaron parámetros para ocultar las pérdidas.

Los artefactos completos locales están en `reports/btcusdt-1m.json`, `reports/btc-v2-report.json`, `reports/comparison.json` y `reports/smoke.json`. `reports/` no se incluye en Git. Su archivo de credenciales de ejemplo también está excluido y no debe publicarse.

## Alcance y pendientes

- Telegram no se probó con mensajes externos; permanece deshabilitado. No se envió información a terceros.
- WhatsApp V1 y Ollama se conservan archivados, sin participación en V2.
- Falta una prueba prolongada de operación y fallos combinados durante días/semanas.
- No se midió capacidad para historiales masivos ni alta disponibilidad del broker único.
- Drawdown en vivo no está medido: se devuelve null; el backtest sí usa curva de equity.
- La simulación OHLC no demuestra equivalencia de fills, liquidez o latencia con Binance.
- KafkaJS emitió un `TimeoutNegativeWarning` no fatal bajo Node24 del host durante integración. Los contenedores usan Node22.
- `git diff --check` detecta espacios finales únicamente en cambios V1 preexistentes de `multi-user-strategy.service.ts`; se preservaron. La comprobación del resto de los cambios pasó.

La ejecución real está fuera del alcance y bloqueada por código; no se habilita cambiando una variable.
