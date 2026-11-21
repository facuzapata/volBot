# Diagnóstico de estrategia BTCUSDT

Fecha: 20 de noviembre de 2026. Simulador paper-2026-11-20.audit-1. **No hay evidencia suficiente para habilitar nuevas entradas PAPER.** No se seleccionó una variante ni se aprobó la estrategia. La simulación valida contratos concretos; no garantiza ganancias futuras ni ausencia de otros defectos.

## Qué hace la estrategia actual

Long Spot BTCUSDT. Exige tendencia 1h (EMA12 > EMA26, SMA9 > SMA21 y cierre > SMA50), confirmación 5m (MACD > señal y SMA9 > SMA21), RSI 1m entre 35 y 65, histograma positivo, vela verde o engulfing, volumen superior a 1,2 veces SMA10 y precio sobre 0,995 × SMA21. También exige que el objetivo cubra los costos nominales. Señal al cierre y compra en apertura siguiente, sólo en transición a elegible. TP 1 %, stop por el mayor de 1,5 ATR y distancia al swing low de diez velas, hasta 2 %. Salida temporal 24h e invalidación 1h. Trailing desactivado. No se cambiaron estas reglas para A.

Cada mes reinicia con 500 USDT, presupuesto 30 y máximo cinco posiciones. Comisión 0,1 % por lado, spread 2 bps y slippage 3 bps. Comprar sólo cuando la ganancia futura esté asegurada no es algo que estos indicadores puedan determinar. El control implementado permite mantener las entradas bloqueadas mientras no haya aprobación explícita.

## Las 28 operaciones originales

El replay conserva −3,1064573288 USDT, 28 stops y cero ganadoras; ninguna operación cambia de ejecución o clasificación. Ver [auditoría del simulador](simulator-audit.md) y ../reports/trades-audit.csv.

- Stop mediano: 0,102965 % de la entrada, frente a comisión ida/vuelta nominal de 0,2 %. En 20 de 28 operaciones el stop porcentual era menor que esa comisión, sin siquiera contar spread/slippage.
- Stop/ATR mediano: 3,5865; mínimo 1,5006 y máximo 6,9684. A ya puede tener un stop más ancho que 2 o 2,5 ATR por la estructura. Los stops puros no equivalen necesariamente a ampliarlo.
- MFE mediano inferior/superior: 0,02699 % / 0,03776 %. Percentil 90 superior: 0,31292 %. Máximo superior: 0,91075 %.
- MAE mediano inferior/superior: 0,10297 % / 0,11028 %. Sólo una operación llegó al 80 % del recorrido al TP y esa misma superó el 90 %. Ninguna tocó TP antes del stop según las velas observadas.
- Tiempo mediano hasta la vela del MFE superior: 2–3 minutos; p90 23–24. Mediana hasta cierre: 14 velas, p90 64, máximo 504. Los máximos de la vela de salida pueden ser posteriores al fill.
- Costos: comisión 1,65436033; spread 0,16543600; slippage 0,49630801; redondeo 0,00008008 USDT. Los últimos tres ya están incorporados en precios: no volver a restarlos del P&L neto. Comisión representa aproximadamente 53,26 % de la pérdida observada.

MFE/MAE son límites OHLC, no trayectorias exactas. Los timestamps de máximo son intervalos de velas. Cuantiles: observación ordenada en índice floor((n−1) × p), sin interpolar; mediana central inferior si n es par. El CSV detalla cantidades, precios, ATR, costos y comprobación independiente por operación.

## Diseño histórico y separación temporal

Se congelaron variantes y períodos antes de descargar el OOS. Plan: ../reports/research-plan.json, SHA256 3b4521117fcf3eabc82f72eca6715992aa3ed864baa2ec54ff524b6a48b15c7f. Enero 2025 original ya había sido observado y se usa sólo para diagnóstico, nunca como prueba nueva. No hubo búsqueda de hiperparámetros ni selección entre desarrollo y validación. El último tramo se procesó al final con la misma lista fija.

Cinco meses de desarrollo de regímenes distintos, un mes de validación y un mes final OOS, con tres días previos de calentamiento para cada uno. Son ventanas mensuales seleccionadas, no una historia continua ni una muestra aleatoria. El capital se reinicia por mes; sumar sus P&L es descriptivo, no una curva acumulada real. No se combinan drawdowns ni profit factors promediándolos.

| Mes | Split | BTC mes % | Vol diaria % | Velas de negociación | Huecos |
|---|---|---|---|---|---|
| 2020-03 | development | -24.79 | 9.63 | 44511 | 1 |
| 2022-06 | development | -37.29 | 4.92 | 43200 | 0 |
| 2023-07 | development | -4.07 | 1.52 | 44640 | 0 |
| 2023-09 | development | 3.94 | 1.55 | 43200 | 0 |
| 2024-02 | development | 43.57 | 2.55 | 41760 | 0 |
| 2024-10 | validation | 11.00 | 2.11 | 44640 | 0 |
| 2025-02 | final-oos | -17.65 | 2.82 | 40320 | 0 |

Marzo 2020 representa alta volatilidad observada, junio 2022 caída, febrero 2024 suba; julio/septiembre 2023 son ventanas de menor variación/volatilidad relativa. Son descripciones de estas ventanas, no etiquetas universales. Vol diaria = desviación de retornos log de minuto × raíz(1440), sin anualizar; en marzo el salto entre observaciones separadas por el hueco afecta esa estimación. La clasificación interna de cada operación se conserva por separado en regimeBreakdown: A sólo entra cuando primaryTrend es alcista, aunque el mes completo sea bajista.

Datos originales y checksums en ../reports/research-data/ y ../reports/research-manifest.json. Marzo contiene una vela inválida acortada, conservada en cuarentena; tras excluirla hay 129 minutos ausentes. Se reinician indicadores y señal pendiente al hueco sin fabricar velas; las posiciones siguen supervisándose en la siguiente observación. Otros meses son contiguos. Esto no modifica parámetros del plan y limita lo inferible de marzo. El modo normal sigue rechazando huecos. Fuente y política detalladas en simulator-audit.md.

## A sin modificar: estabilidad por período

| Mes | Cerradas | Neto USDT | Retorno % | DD % | PF | Expectativa USDT | Win % | Comisión | Capital inmovilizado |
|---|---|---|---|---|---|---|---|---|---|
| 2020-03 | 120 | -7.4169 | -1.483 | 1.668 | 0.551 | -0.06181 | 31.67 | 7.1831 | 0.0000 |
| 2022-06 | 90 | -7.8650 | -1.573 | 1.657 | 0.400 | -0.08739 | 24.44 | 5.3722 | 0.0000 |
| 2023-07 | 86 | -7.4178 | -1.484 | 1.484 | 0.138 | -0.08625 | 5.81 | 5.1223 | 0.0000 |
| 2023-09 | 97 | -6.4709 | -1.294 | 1.294 | 0.340 | -0.06671 | 14.43 | 5.7884 | 0.0000 |
| 2024-02 | 148 | -5.5573 | -1.111 | 1.653 | 0.618 | -0.03755 | 25.68 | 8.7968 | 0.0000 |
| 2024-10 | 157 | -9.9299 | -1.986 | 2.004 | 0.393 | -0.06325 | 17.83 | 9.3145 | 0.0000 |
| 2025-02 | 69 | -4.7479 | -0.950 | 1.009 | 0.331 | -0.06881 | 14.49 | 4.0629 | 0.0000 |

USDT sin operar tiene P&L, drawdown, costos y capital inmovilizado cero en todos los meses. No se le atribuye rendimiento de préstamos ni riesgo de mercado BTC. PF no definido por no tener operaciones. Es una referencia nominal sin modelar riesgo de contraparte, depeg o costo de oportunidad.

## Comparaciones controladas

19 variantes únicas y una referencia cash por mes: 140 filas en ../reports/strategy-comparison.csv. Cada fila informa variable cambiada, hashes, retorno, drawdown, PF, expectativa, win rate, costos, MFE/MAE superiores, operaciones, exposición y regímenes.

B/C/D reemplazan el modelo de stop de estructura por ATR_ONLY y varían sólo el multiplicador dentro de esa familia. La distancia se calcula con ATR/precio de señal y se reancla proporcionalmente al precio ejecutado, igual que el mecanismo original; por ello el múltiplo efectivo sobre ATR puede diferir por costos/gap. E cambia sólo TP a 0,6/0,8/1,2 %; TP 1 % coincide con A. F quita sólo confirmación 5m y mantiene tendencia 1h; G (1h+5m) coincide con A. H evalúa quitar tiempo y quitar invalidación por separado: A ya tiene ambas. Las ablaciones quitan un filtro por vez. Las contrafactuales de costo no son configuraciones operables con costos garantizados en cero.

| Variante | Desarrollo suma USDT¹ | Validación USDT | OOS USDT | OOS DD % | OOS PF | OOS cierres |
|---|---|---|---|---|---|---|
| A-current | -34.7278 | -9.9299 | -4.7479 | 1.009 | 0.331 | 69 |
| B-atr-1.5 | -34.8698 | -11.7164 | -5.6282 | 1.195 | 0.143 | 75 |
| C-atr-2 | -35.1584 | -11.0187 | -5.7396 | 1.213 | 0.169 | 75 |
| D-atr-2.5 | -32.9085 | -9.9027 | -5.0459 | 1.070 | 0.271 | 74 |
| E-tp-0.006 | -36.9483 | -10.6299 | -6.3566 | 1.282 | 0.169 | 75 |
| E-tp-0.008 | -36.9186 | -9.6569 | -5.4181 | 1.119 | 0.264 | 73 |
| E-tp-0.012 | -34.8114 | -8.3326 | -3.8392 | 0.915 | 0.434 | 66 |
| F-1h-only | -149.7099 | -43.0691 | -22.5253 | 4.768 | 0.236 | 285 |
| H-without-time | -34.7278 | -10.1968 | -4.7479 | 1.009 | 0.331 | 69 |
| H-without-invalidation | -34.7278 | -9.9299 | -4.7479 | 1.009 | 0.331 | 69 |
| ablate-primary | -116.1364 | -25.7827 | -25.8822 | 5.176 | 0.134 | 329 |
| ablate-rsi | -94.1977 | -23.4295 | -17.3334 | 3.706 | 0.222 | 181 |
| ablate-macd | -95.7952 | -27.9922 | -15.7227 | 3.318 | 0.193 | 198 |
| ablate-volume | -78.9243 | -23.3383 | -13.1722 | 2.738 | 0.243 | 164 |
| ablate-candle | -67.1300 | -18.2790 | -10.0884 | 2.081 | 0.204 | 119 |
| ablate-structure | -34.7278 | -9.9299 | -4.7479 | 1.009 | 0.331 | 69 |
| cost-no-fee | -2.4720 | -0.6177 | -0.6850 | 0.404 | 0.811 | 69 |
| cost-no-spread | -31.4884 | -8.7826 | -4.4827 | 0.957 | 0.344 | 68 |
| cost-no-slippage | -26.8417 | -4.5947 | -3.3509 | 0.863 | 0.436 | 64 |
| USDT-cash | 0.0000 | 0.0000 | 0.0000 | 0.000 | n/a | 0 |

¹ Suma descriptiva de cinco cuentas mensuales reiniciadas. No es rentabilidad compuesta ni se usa para seleccionar ganador. El OOS ya queda observado: cualquier cambio nuevo necesita otro tramo intacto o validación prospectiva.

## Filtros y costos

La tabla compara cada ablación con A sin alterar el resto. Más operaciones o menos pérdida histórica no demuestran un filtro causalmente rentable. Los filtros están correlacionados y modificar uno cambia las transiciones de elegibilidad, reservas y entradas siguientes.

| Filtro quitado | Cierres desarrollo | Neto desarrollo USDT¹ | Cierres OOS | Neto OOS USDT |
|---|---|---|---|---|
| A-current | 541 | -34.7278 | 69 | -4.7479 |
| ablate-primary | 1563 | -116.1364 | 329 | -25.8822 |
| F-1h-only | 2245 | -149.7099 | 285 | -22.5253 |
| ablate-rsi | 1429 | -94.1977 | 181 | -17.3334 |
| ablate-macd | 1391 | -95.7952 | 198 | -15.7227 |
| ablate-volume | 1278 | -78.9243 | 164 | -13.1722 |
| ablate-candle | 959 | -67.1300 | 119 | -10.0884 |
| ablate-structure | 541 | -34.7278 | 69 | -4.7479 |

Los conteos de pass/fail de cada condición, antes de la combinación, están en ../reports/filter-diagnostics.json. rsiEntry y macdEntry son las condiciones efectivas de entrada; rsi/momentum heredadas son diagnósticas. Quitar structure no cambia A en estas ventanas si ya queda satisfecha por otras condiciones: no equivale a demostrar que nunca importe. F conserva calentamiento 5m aunque no lo exige para elegibilidad; con tres días previos no cambia el inicio del período contiguo.

Los costos contrafactuales se simulan nuevamente. Su diferencia con A no es sólo una resta contable: cambiar precios puede cambiar stops, cantidades y operaciones posteriores. grossPnlClosedPlusFees suma las comisiones de posiciones cerradas al resultado realizado de esas posiciones; aún incluye spread/slippage y no es un resultado sin fricción. MFE/MAE de la comparación incluyen la vela completa de salida como límite superior.

## Decisión y límites pendientes

Mantener entradas PAPER pausadas y sin aprobación. No hay selección de parámetros por el mejor histórico. Las variantes con costos reales deben mostrar expectativa estable y superar cash en nuevas muestras intactas y observación prospectiva antes de plantear una revisión. No basta un mes favorable o una métrica aislada.

Quedan pendientes microestructura/ticks, cola y latencia, filtros/tarifas históricas reales, liquidez compartida entre cuentas, pruebas prolongadas y más ventanas independientes. Los meses elegidos, el hueco de marzo y la regla intravela introducen sesgos. Backtests y tests no garantizan ejecución ni rentabilidad futura. El mecanismo exige revisión humana explícita; no concede aprobación por estas tablas. Ver simulator-audit.md para límites de contabilidad, horarios y gestión de inventario.

## Reproducción

Ejecutar npm.cmd run build, python scripts/download-research.py, node scripts/run-research.cjs y node scripts/finalize-research.cjs. El descargador valida el plan congelado y checksums; no modificarlo para reutilizar el OOS como entrenamiento. El finalizador concilia filas y referencia cash y genera este informe sin modificar resultados ni seleccionar parámetros. Los archivos reports/ son locales e ignorados por Git. No compartir archivos de credenciales.
