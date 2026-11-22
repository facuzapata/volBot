# Persistencia V2

Base dedicada: `volbot_v2` para simulación y `volbot_v2_test` para integración. El arranque rechaza nombres de base V1. `synchronize` y migraciones automáticas están deshabilitados.

La migración aditiva `1795172400000-InitialV2.ts` crea:

| Tabla | Modelo y propósito |
|---|---|
| v2_users | Identidad, hash bcrypt, rol y versión revocable de tokens |
| v2_virtual_accounts | Saldo, reservas, capital inicial y configuración |
| v2_market_signals | MarketSignal compartida |
| v2_user_signal_decisions | Decisión por cuenta/señal, con unicidad |
| v2_positions | Inventario, costo restante, niveles y configuración congelada |
| v2_order_intents | Intención original inmutable |
| v2_exchange_orders | Estado de la orden PAPER |
| v2_fills | Ejecuciones individuales inmutables |
| v2_ledger_entries | Deltas BTC/USDT, disponibles y reservados |
| v2_candles | Velas cerradas únicas por intervalo/timestamp |
| v2_strategy_versions | Revisión y estado de episodio de señal |
| v2_outbox / v2_inbox | Publicación recuperable y consumo idempotente |
| v2_delivery_attempts | Backoff y entregas agotadas |
| v2_backtest_runs | Reportes privados por usuario |

Los agregados se conservan en JSONB tipado, con IDs, propiedad y restricciones relacionales fuera del documento. Los importes monetarios se serializan como strings decimales. Se usa Decimal.js para ejecución y contabilidad; estadísticas y gráficos pueden usar números aproximados.

Cada transición bloquea la fila de cuenta, carga sus filas, modifica el dominio y persiste sólo filas cambiadas o añadidas. Las restricciones de saldo no negativo y unicidad son una defensa adicional a las invariantes de dominio.

No hay `down` destructivo automático. Respaldar con `pg_dump`; restaurar sólo en una base separada y revisar antes de sustituir una base operativa. No migrar automáticamente Signal/Movement V1 ni credenciales reales.

## Archivo del experimento prospectivo

La migración `1795210000000-ArchiveProspectivePaper.ts` retira el subsistema opcional de experimento de 30 días. Antes de borrar sus seis tablas `v2_paper_*`, copia cada fila a `v2_archived_paper_records`, identificada por tabla de origen e ID. Las tablas principales de cuentas, posiciones, órdenes, fills y ledger no se modifican: son el historial común que necesitarán PAPER y una futura integración LIVE.

## Conexión Binance por usuario

La migración `1795220000000-ExchangeCredentials.ts` agrega `v2_exchange_credentials`: una sola conexión por usuario. Sólo conserva `apiKeyCiphertext` y `secretCiphertext`, cifrados con AES-256-GCM mediante `V2_CREDENTIAL_ENCRYPTION_KEY`; ni la API, ni Swagger, ni los logs devuelven el secreto. Al guardar, y nuevamente al activar entradas en modo LIVE, el servicio firma una consulta de cuenta con Binance. Una respuesta no exitosa no reemplaza una conexión previamente válida.

El modo (`PAPER` o `LIVE`) vive en el documento de la cuenta. Cambiarlo exige no tener posiciones u órdenes pendientes y deja las entradas pausadas. Las claves `LIVE` de producción también requieren el interruptor de despliegue `V2_LIVE_TRADING_ENABLED=true`; las `TESTNET` permiten ensayar la verificación sin abrir una cuenta productiva. La entrada LIVE permanece rechazada hasta implementar el ciclo de envío, consulta/reconciliación y protección nativa de órdenes; de ese modo nunca se etiqueta una simulación como una orden de exchange.
