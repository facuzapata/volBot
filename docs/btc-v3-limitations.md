# Limitaciones y estado de BTC-V3

- Implementación y contratos BUY/NO_TRADE probados; rentabilidad no demostrada. Cero trades reales de backtest para V3 impiden estimar win rate, PF o calidad de fills de esta estrategia en estas muestras.
- La calibración es simple por cuatro buckets ATR5m, sin ajuste retrospectivo. Hay 405 labels y sólo quince en el bucket mayor. Estimar IC con bloques diarios no elimina toda dependencia de regímenes; no es garantía probabilística. El cuantil MFE no implica poder vender en el máximo.
- Los umbrales de pullback, recuperación, stop y horizonte son una hipótesis congelada, no óptimos validados. La condición económica puede ser conservadora; no se relajó para generar actividad. Faltan nuevas hipótesis y recalibración sobre desarrollo, con otro holdout si se cambia la candidata.
- Marzo 2025 fue nuevo respecto de los archivos/experimentos del repositorio y se evaluó una vez. No puede probarse ausencia de uso externo desconocido. Abril sigue reservado. El holdout consumido no debe convertirse en entrenamiento y seguir llamándose prueba final intacta.
- Se eliminó el volumen futuro de apertura usando una aproximación previa causal. Sigue sin conocerse profundidad, cola, latencia, liquidez real al stop ni impacto de mercado. La proyección de stop no cubre gaps ni retrasos por falta de capacidad; puede perderse más que el riesgo estimado.
- El worker usa el último cierre conocido como proxy al procesar un comando, identificado DECISION; el backtest atribuye señales a apertura siguiente. Sin ticks/libro/latencia no se afirma equivalencia exacta de fills con Binance. Las barreras intravela se procesan con prioridad conservadora y tiempos acotados por OHLC.
- Las cantidades no negociables se conservan como DUST con costo y capital inmovilizado. El modelo de fee BTC está probado en BUY; SELL usa USDT. No se modelan BNB, tarifas por cuenta ni filtros históricos reales.
- La bolsa compartida presupone configuración operativa consistente entre réplicas; se reconstruye desde fills con locks transaccionales y orden estable. El broker único y PostgreSQL local no constituyen alta disponibilidad ni se probó una campaña prolongada de fallos combinados.
- No se desplegó el código nuevo en cuentas operativas ni se aplicaron migraciones allí. Sólo pruebas en bases aisladas y dependencias locales. Las tres cuentas siguen pausadas, sin aprobaciones y con balances/inventario conservados. Binance real permanece compilado fuera y sin proveedor real registrado.

La aprobación persistente liga revisión, configuración, modelo y revisión del simulador; cambiar cualquiera invalida la coincidencia. Sigue requiriendo acción administrativa explícita y opt-in de cada usuario. Un reporte con cero operaciones puede registrarse PENDING para trazabilidad, nunca se aprueba automáticamente.

## Qué se verificó

Typecheck, lint, build, contratos unitarios/HTTP, seis casos históricos, reservas/costos/parciales, presupuestos causales, configuración y calibración separadas por revisión, prefijos de señales, persistencia PostgreSQL, concurrencia entre cuentas, pausa/revocación, reinicio y reentrega Kafka. Evidencia local en tests-before.json, tests-candidate.json, tests-all-final.json e integration-result.json bajo reports/btc-v3/. Los fallos iniciales por Docker apagado y las correcciones de fixtures están separados de los errores financieros demostrados.

No se verificaron operaciones privadas, órdenes reales, libro histórico, disponibilidad real de tarifas reducidas, ni rentabilidad de V3 en trades porque su gate los rechazó. La carpeta verification.json registra hashes y estado operativo al finalizar. No hubo commit ni push remoto.
