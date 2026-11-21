# Auditoría del simulador BTCUSDT

Fecha: 20 de noviembre de 2026. Ejecución exclusivamente PAPER. Revisión del simulador: `paper-2026-11-20.audit-1`.

## Conclusión

Se demostraron tres errores de ejecución/contabilidad con pruebas fallidas antes de corregirlos y un error adicional del control de riesgo. **Ninguno cambia las 28 operaciones originales**: continúan siendo 28 STOP_LOSS, ninguna ganadora, P&L neto −3,1064573288 USDT y equity final 496,8935426712 USDT. No corresponde atribuir esa pérdida a los defectos encontrados.

El replay compara identificadores, ejecución, clasificación y resultado contra el reporte congelado. Una segunda comprobación recorre las velas buscando la primera barrera alcanzable según la política OHLC documentada. Las 28 clasificaciones coinciden y no hay velas de salida con TP y SL simultáneos en ese conjunto. Esto verifica la clasificación bajo el modelo, sin afirmar conocer la secuencia de ticks real.

## Seguridad operativa

Antes de probar se pausaron persistentemente las tres cuentas de la base dedicada `volbot_v2`. Una transacción bloqueó las cuentas y verificó el hash de posiciones y órdenes antes/después: sin cambios. Había cero filas de inventario. Evidencia: `reports/pause-audit.json`.

La migración aditiva crea las validaciones y vuelve a pausar entradas sin alterar saldos, órdenes ni posiciones. Se desplegó en API/worker Docker V2. `reports/pause-verification.json` verifica las tres cuentas pausadas, ninguna aprobación y el mismo inventario. El worker sigue recibiendo mercado y supervisando salidas. No hubo órdenes/cancelaciones reales ni modificación de históricos reales. Las descargas usan mercado público.

## Errores demostrados

| Caso | Antes | Corrección | Evidencia previa |
|---|---|---|---|
| Apertura por encima del TP y mínimo posterior por debajo del SL | STOP_LOSS, ignorando el primer precio conocido | Prioridad del TP ya alcanzado en la apertura | `reports/simulator-tests-before.json` |
| BUY pendiente elegible en apertura, stop tocado en esa misma vela | La compra se ejecutaba después de evaluar protección y quedaba abierta | Fill de apertura antes de examinar extremos/protección | Mismo archivo |
| Compra solicitada con comisión BTC | Se registraba comisión USDT y cantidad base incorrecta | Descontar BTC recibido, conservar costo USDT sin cobrar doble, valorar comisión en USDT | Mismo archivo |
| Posición con stop decimal `0.000000000000` | Permitía nuevas entradas porque sólo se comparaba con la cadena `0` | Validación numérica finita y positiva | `reports/risk-tests-before.json` |

Los snapshots previos están en `reports/audit-baseline/`; no se reemplazó el reporte original. La corrección de comisión BTC conserva el remanente no negociable y su costo como DUST, en vez de hacerlo desaparecer.

## Contratos y pruebas

Pruebas en `test/v2/simulator-audit.spec.ts`, `paper-execution.spec.ts`, `backtesting.spec.ts`, `strategy.spec.ts`, `postgres.integration-spec.ts` y `workflow.integration-spec.ts`:

- Señal con vela cerrada y entrada en apertura siguiente. Una orden creada dentro de una vela se ejecuta al cierre, sin exposición retroactiva a su mínimo anterior.
- Ordenamiento cronológico, rechazo de duplicados y huecos en el modo normal; ausencia de velas superiores futuras y de buckets superiores incompletos.
- Apertura con TP conocido, SL con gap adverso y política conservadora SL primero cuando la apertura queda entre barreras y ambas se tocan.
- Comisión USDT por ambos lados una sola vez; comisión BTC en compra, cantidad neta, ledger, remanente DUST y costo residual.
- Reservas, cancelación/liberación, saldo insuficiente, no duplicar fills/salidas, parciales incluso inferiores al notional mínimo por fill. El notional aplica a la orden, no a cada ejecución parcial.
- Redondeo adverso a tick, cantidad al step, presupuesto máximo y rechazo de orden bajo notional.
- Liquidez de vela compartida dentro de una cuenta, órdenes UNKNOWN no ejecutadas automáticamente y protección después de TP parcial.
- Trailing actualizado después de evaluar la vela, vencimiento temporal, invalidación y supervisión con entradas pausadas.
- Inventario final marcado a mercado sin liquidación forzada. Cache de indicadores de velas cerradas sin cambiar resultados reproducibles.
- Reservas concurrentes, inbox/outbox atómicos y cadena Kafka real con reinicio/reentrega en bases y topics aislados.
- Aprobación explícita persistente, configuración distinta bloqueada, revocación de grants duplicados, BUY pendiente preservado sin fill y salida por stop tras revocar.

`reports/tests-audit-final.json` registra 51 pruebas V2 aprobadas. `reports/all-tests-audit.json` registra 85 pruebas generales aprobadas. Las ocho pruebas de integración se ejecutaron separadamente con PostgreSQL/Kafka reales y pasaron; la suite general las omite junto con un experimento V1 archivado. `reports/smoke.json` comprueba HTTP real: rechazo 409 al habilitar entradas sin aprobación, pausa persistente, readiness y mismo hash/P&L en backtest HTTP y CLI. Typecheck, lint V2, build y generación OpenAPI también pasaron.

## Replay de las 28 operaciones

Datos: 10.080 velas BTCUSDT 1m, del 1 al 7 de enero de 2025, UTC; hash normalizado `f546b4f8d658ed815c03be18c875e3ce98163031397ebe0930e51d7ef805e7e2`.

Capital 500, presupuesto 30 USDT, máximo cinco posiciones. Comisión 0,1 % por lado, spread total 2 bps, slippage adverso 3 bps por ejecución de mercado. Se conserva TP 1 %, stop de estructura/ATR, filtros y fórmulas originales.

| Métrica | Original | Corregido |
|---|---:|---:|
| Cerradas / ganadoras | 28 / 0 | 28 / 0 |
| P&L neto USDT | −3,1064573288 | −3,1064573288 |
| Equity USDT | 496,8935426712 | 496,8935426712 |
| Comisiones USDT | 1,6543603288 | 1,6543603288 |
| Drawdown de equity | 0,630808 % | 0,630808 % |
| Profit factor | 0 | 0 |
| Expectativa USDT/cierre | −0,1109449046 | −0,1109449046 |
| Máximo simultáneo | 3 | 3 |

`reports/trades-audit.csv` tiene una fila por operación, con todos los campos pedidos, costos separados, comparación original/corregido y verificación independiente. `reports/trades-audit-summary.json` concilia totales y distribuciones. Precios esperados son la apertura siguiente y el precio de señal por separado; precios ejecutados incluyen costos y redondeo. ATR corresponde a la información disponible en la señal, inmediatamente anterior a la entrada.

## Política OHLC y límites

1. OHLC no revela el orden high/low. Entre ambas barreras se adopta SL primero. En apertura fuera de barreras se respeta el precio conocido; el TP limit se llena al precio límite, sin atribuir mejora favorable por gap.
2. Los fills de protección intravela se registran al cierre de esa vela como marca de procesamiento. No son timestamps exactos de ejecución en el mercado.
3. MFE/MAE exactos tampoco se pueden reconstruir. El CSV publica límites inferior/superior: excluye extremos desconocidos posteriores al cierre para el inferior y usa la vela de salida completa para el superior. El tiempo al máximo es un intervalo de un minuto. La comparación histórica usa medianas superiores, etiquetadas explícitamente. Los cuantiles reportados usan la observación ordenada de índice `floor((n−1) × p)`, sin interpolación; para muestras pares la mediana es la observación central inferior.
4. Spread, slippage, comisión, tick, step y notional son supuestos fijos. No se reconstruyeron libros, cola de órdenes, tarifas históricas por cuenta, BNB ni filtros históricos efectivos de cada fecha. La comisión base se soporta en BUY; SELL usa USDT.
5. La capacidad se aproxima con una fracción del volumen agregado de la vela. Usa el volumen completo conocido al terminarla: para fills atribuidos a apertura esto anticipa información de liquidez futura. Por tanto, se verificó ausencia de look-ahead en señales/indicadores, pero **no se puede afirmar ausencia total de look-ahead en la liquidez simulada**. Se comparte dentro de cada cuenta, no globalmente entre cuentas. Corregir ese modelo requiere ticks/libro o definir y evaluar otra aproximación; no se cambió para favorecer estas comparaciones. No es una simulación de microestructura ni de impacto de mercado.
6. La suite detecta regresiones de contratos concretos, sin demostrar que el simulador carezca de otros defectos. Faltan replay de ticks/libro y pruebas prolongadas de fallos combinados.

## Datos ampliados

Se verificaron SHA256 de archivos públicos Binance y se conservaron datasets, checksums y manifiesto. Desde enero de 2025 los timestamps del archivo público Spot pueden estar en microsegundos; se normalizan a milisegundos según la [documentación oficial](https://github.com/binance/binance-public-data/blob/master/README.md). El origen de REST de mercado está documentado en [market-data-only](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md). Los filtros se modelan como supuestos basados en sus [definiciones oficiales](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md), sin afirmar exactitud histórica.

Marzo de 2020 contiene una vela acortada inválida y un hueco real. Se conserva el original, se pone esa vela en cuarentena y quedan 129 minutos ausentes. El modo de investigación permite huecos explícitos, reinicia indicadores/buckets y señal pendiente, no inventa velas y sigue gestionando posiciones existentes en la siguiente observación. El modo habitual sigue rechazando huecos. Esto puede omitir movimientos y exposición durante el hueco; los resultados de ese mes deben interpretarse con esa limitación.

## Aprobación y revocación

Sólo administrador autenticado puede registrar/decidir validaciones:

- `POST /api/admin/strategy-validations`: `reportId` y `rationale` (mínimo 30 caracteres). Crea PENDING ligado a reporte persistido, revisión de estrategia, revisión de simulador y hash canónico de configuración.
- `GET /api/admin/strategy-validations`: consultar estado.
- `POST /api/admin/strategy-validations/:id/decision`: `status` APPROVED o REVOKED, `rationale` y cuatro booleanos explícitos `simulatorReviewed`, `outOfSampleReviewed`, `costsReviewed`, `riskReviewed`.

El reporte debe ser de la revisión actual y mantener su hash de evidencia. Los cuatro campos deben ser verdaderos para aprobar. No hay umbral de rentabilidad que conceda aprobación automáticamente. La revisión humana debe verificar realmente los resultados fuera de muestra; el mecanismo no certifica la calidad de esa revisión sólo por recibir booleanos.

La aprobación no activa entradas: también hace falta el opt-in de cada cuenta. Se comprueba al habilitar, reservar, ejecutar BUY y procesar pendientes. La revocación se serializa con esos caminos y revoca todos los grants aprobados para esa configuración. Los pendientes se conservan; las salidas continúan. Una validación revocada no se reactiva: requiere una nueva revisión. La fila conserva la última decisión y su autor, no un historial completo de cada modificación.

**No se concedió aprobación a ninguna estrategia en la base operativa.** Los APPROVED de las pruebas son fixtures sintéticos en bases aisladas, sin valor como evidencia de rendimiento.

## Reproducción

```powershell
npm.cmd run build
node scripts/audit-trades.cjs
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:integration
node scripts/smoke.cjs
node scripts/verify-paper-pause.cjs
```

La integración requiere las dependencias Docker V2 y usa bases separadas. El smoke actual verifica el rechazo de entradas y conserva la pausa; no ejecutar versiones previas que habilitaban entradas. Los reportes son archivos locales ignorados por Git; no compartir `reports/smoke-credentials.json` ni `.env.v2`.
