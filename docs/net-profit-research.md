# Rentabilidad neta de volBot: investigación acotada v1

## Resultado y decisión

Estado: **NO_QUALIFIED_STRATEGY**. Ninguna de las 12 variantes cumple todos los filtros congelados. No se habilitaron entradas PAPER, operaciones reales, aprobaciones ni despliegues. No hay una ganadora demostrada ni evidencia para prometer que una operación individual no pueda perder. El resultado negativo de selección significa evidencia insuficiente bajo este protocolo; no prueba que ninguna estrategia futura pueda ser rentable.

Se evaluaron 27 combinaciones únicas de candidata, tramo temporal y costos: 12 de desarrollo y 15 diagnósticas adicionales. Tres resultados de desarrollo se reutilizaron en las 18 filas diagnósticas. No se retocaron parámetros tras observar resultados. No se consumió la prueba final reservada. La exploración está limitada a seis familias y dos horizontes; no pretende demostrar un máximo global de rentabilidad.

## Límites aceptados

Capital inicial por simulación: **500 USDT**; drawdown máximo admisible **5 %**; exposición máxima **80 %**; riesgo neto estimado por operación **0,5 %** del patrimonio; pérdida diaria máxima **3 %**. Una posición BTC como máximo. El tamaño usa 0,45 % de riesgo objetivo para dejar margen frente a ejecución y redondeo, con tope por efectivo y exposición. El motor revalida el riesgo al ejecutar.

El controlador solicita salida al alcanzar 4 % de drawdown desde el máximo y bloquea nuevas entradas durante el resto de esa simulación. Al perder 2,5 % desde el cierre anterior al día UTC solicita salida y pausa hasta el día siguiente. La salida usa la liquidez causal disponible, puede ser parcial y sigue pendiente si falta capacidad. No se borra inventario ni se simula una liquidación gratuita. Los límites de admisión de 5 % y 3 % se verifican después de la simulación. Los gaps y la liquidez pueden producir excesos; éstos descalifican una candidata.

## Datos y separación temporal

Desarrollo continuo: **2024-01-01 a 2025-01-01**, 366 días y 527.040 minutos; diciembre de 2023 sólo como calentamiento. Validación: **2025-01-01 a 2025-04-01**, 90 días, con diciembre de 2024 de calentamiento. Son meses observados total o parcialmente en investigaciones anteriores; la validación selecciona o diagnostica y no se presenta como prueba independiente nueva.

La prueba final queda reservada para **2025-04-01 a 2026-04-01**. Sólo puede descargarse si existe un finalista congelado. No hay finalista ni archivos de ese intervalo en esta investigación. La auditoría de contaminación alcanza el workspace y esta sesión, no otros trabajos externos.

Se descargaron archivos públicos Spot BTCUSDT de Binance, con SHA256 del ZIP contrastado con su archivo CHECKSUM. Se conservaron ZIP, datos normalizados y manifiestos. La validación exige minutos únicos y continuos, cierre exacto y OHLC válido; no se inventaron barras. Los archivos de esta etapa están en reports/net-optimization/data. Las investigaciones previas permanecen separadas.

## Estrategias y selección

Cada familia tiene una variante de 1 h y otra de 4 h. Los indicadores se calculan con hasta 100 barras completas anteriores o actuales ya cerradas, con al menos 60 barras de calentamiento. La señal se conoce al cierre y la orden se intenta en la apertura del siguiente minuto. El máximo Donchian y el volumen medio excluyen la barra señal.

- Tendencia: EMA20 > EMA50, precio > EMA50 y recuperación de EMA20 respecto del cierre previo.
- Retroceso: mismo filtro alcista, mínimo toca EMA20 y cierre recupera EMA20 con vela verde.
- Ruptura: cierre supera el máximo de las 20 barras previas, volumen > 1,1 veces su media previa y filtro alcista.
- Momentum: retorno de 12 barras cruza desde un valor <= 1 % a > 1 %, con filtro alcista.
- Reversión: diferencia relativa EMA20/EMA50 < 1 %, cierre bajo Bollinger20 de dos desviaciones, RSI14 < 35 y precio > 95 % de EMA50.
- Adaptativa: ruptura en tendencia alcista fuera del rango; reversión cuando el régimen satisface la condición de rango.

Stops absolutos de 1,5–2,5 ATR14 de la escala de señal; objetivos de 1,5–4 veces esa distancia y máximo temporal de 24–168 h según plan. En reversión el objetivo también se limita a la media de 20 barras. No se entra si el objetivo no cubre el costo nominal de ida y vuelta más 0,05 puntos porcentuales. Las fórmulas y cada parámetro están en scripts/net-optimization/engine.cjs y plan.json.

La selección exige P&L neto positivo, límites de riesgo, al menos 30 operaciones cerradas en desarrollo, 8 en validación y 20 en final, ganancias sin las mejores tres operaciones, concentración de las tres mejores <= 50 % del beneficio bruto positivo, y límite inferior positivo de un bootstrap por bloques de cinco días, 2.000 réplicas y semilla fija. Desarrollo exige al menos 50 % de trimestres positivos. Se aplica corrección Holm al conjunto de 12 pruebas; el bootstrap es una medida de incertidumbre bajo sus supuestos, no una garantía de rentabilidad.

Entre supervivientes se maximiza P&L neto con penalizaciones fijas: 25 % de la pérdida absoluta de trimestres negativos y 10 % de las tres mejores ganancias. Se validarían como máximo tres candidatas y pasaría a final como máximo una, después de exigir beneficio y riesgo aceptable bajo costos x1,5 y x2 en desarrollo y validación. Ninguna superó el primer filtro: todas tienen un intervalo de incertidumbre que incluye resultados no positivos. Por eso no existe selección primaria en validación ni final.

## Resultados de desarrollo

Todos los importes son USDT netos para el mismo capital inicial. CAGR sólo se calcula para cobertura continua de al menos 365 días; las cifras de 2024 usan 365/366. No se anualizaron los 90 días de validación.

| Variante | P&L neto | Cerradas | Drawdown | CAGR | Motivos de rechazo |
|---|---:|---:|---:|---:|---|
| trend-1h | -2.23 | 38 | 4.03 % | -0.44 % | NONPOSITIVE_NET, BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, QUARTER_INSTABILITY, MULTIPLE_TEST_UNCERTAINTY |
| trend-4h | 21.98 | 23 | 1.86 % | 4.38 % | INSUFFICIENT_TRADES, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY |
| pullback-1h | -16.70 | 29 | 4.04 % | -3.33 % | NONPOSITIVE_NET, INSUFFICIENT_TRADES, BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, QUARTER_INSTABILITY, MULTIPLE_TEST_UNCERTAINTY |
| pullback-4h | 26.23 | 40 | 2.34 % | 5.23 % | BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY |
| breakout-1h | 10.08 | 40 | 4.05 % | 2.01 % | BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, QUARTER_INSTABILITY, MULTIPLE_TEST_UNCERTAINTY |
| breakout-4h | 19.22 | 29 | 2.39 % | 3.83 % | INSUFFICIENT_TRADES, BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY |
| momentum-1h | 28.83 | 120 | 3.90 % | 5.75 % | BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY |
| momentum-4h | 13.70 | 35 | 2.10 % | 2.73 % | BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY |
| reversion-1h | -19.04 | 30 | 4.05 % | -3.80 % | NONPOSITIVE_NET, BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, QUARTER_INSTABILITY, MULTIPLE_TEST_UNCERTAINTY |
| reversion-4h | -7.73 | 21 | 2.17 % | -1.54 % | NONPOSITIVE_NET, INSUFFICIENT_TRADES, BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY |
| adaptive-1h | -18.16 | 13 | 4.04 % | -3.62 % | NONPOSITIVE_NET, INSUFFICIENT_TRADES, BEST_THREE_DEPENDENCE, PROFIT_CONCENTRATION, BOOTSTRAP_UNCERTAINTY, QUARTER_INSTABILITY, MULTIPLE_TEST_UNCERTAINTY |
| adaptive-4h | -2.43 | 30 | 4.03 % | -0.48 % | NONPOSITIVE_NET, BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, QUARTER_INSTABILITY, MULTIPLE_TEST_UNCERTAINTY |

La mayor ganancia fue momentum-1h: +28,83 USDT, 120 operaciones y 39,17 % de aciertos. Su intervalo bootstrap del P&L diario medio incluye valores negativos: aproximadamente [−0,0944; +0,2649] USDT/día. El porcentaje de aciertos no decidió la selección. Pullback-4h produjo +26,23 USDT con drawdown de 2,34 %, pero su intervalo también incluye valores negativos.

## Diagnóstico temporal y de costos

Después de rechazar el conjunto se congeló un protocolo diagnóstico separado: las tres mayores ganancias nominales de desarrollo, sin modificar parámetros, en desarrollo y validación con costos x1, x1,5 y x2. Estos cálculos **no pueden revocar el rechazo, crear un finalista ni habilitar entradas**. Constituyen diagnóstico posterior a la selección, no evidencia final fuera de muestra.

Costo base por lado: comisión 0,10 %, spread total 2 bps y slippage 3 bps por ejecución, más ticks, pasos, mínimos y participación máxima del 0,1 % del volumen del minuto anterior. x1,5 y x2 multiplican simultáneamente comisión, spread y slippage; se vuelve a ejecutar el motor, con tamaño y trayectoria nuevos. No se resta una comisión al resultado antiguo. Son supuestos de estudio, no tarifas verificadas de una cuenta específica.

| Variante | Desarrollo x1 | Desarrollo x1,5 | Desarrollo x2 | Validación x1 | Validación x1,5 | Validación x2 |
|---|---:|---:|---:|---:|---:|---:|
| momentum-1h | 28.83 | -10.36 | -13.99 | -2.38 | -4.97 | -7.22 |
| pullback-4h | 26.23 | 21.23 | 16.59 | 2.35 | 1.34 | 0.36 |
| trend-4h | 21.98 | 19.46 | 17.30 | -3.33 | -3.47 | -3.63 |

Momentum pierde con costos mayores y también en validación. Pullback-4h conserva +0,36 USDT en la validación con costos dobles, sobre nueve operaciones cerradas: un margen demasiado pequeño y una muestra insuficiente para acreditar ventaja robusta con el protocolo fijado. No se promovió esa variante por quedar positiva.

## Referencias

Mismo capital y modelo de comisión/precio; entrada pasiva al primer open con volumen causal previo, cantidad redondeada y efectivo sobrante. Las asignaciones 80 % y 100 % se aplican al inicio, sin rebalanceo: la exposición puede crecer con BTC.

| Referencia 2024 | P&L neto | Drawdown | Mayor pérdida diaria | Exposición máxima | Cumple todos los límites |
|---|---:|---:|---:|---:|---|
| USDT | 0.00 | 0.00 % | 0.00 % | 0.00 % | Sí |
| BTC-hold-80 | 482.40 | 28.95 % | 12.83 % | 91.06 % | No |
| BTC-hold-100 | 603.01 | 33.11 % | 15.16 % | 99.97 % | No |

Las estrategias no superaron el beneficio nominal de comprar y mantener BTC en 2024. Ambas referencias BTC exceden ampliamente los límites de drawdown y pérdida diaria y carecen de stop por operación; se muestran como contexto, no como alternativas elegibles bajo esos límites. USDT gana cero y preserva el capital nominal del estudio.

## Valoración, ejecución y limitaciones

El objetivo es patrimonio terminal estimado tras liquidación conservadora menos 500 USDT. Se separan efectivo disponible, reservas, P&L realizado, no realizado y BTC residual. El remanente vendible se valora al precio adverso SELL redondeado menos comisión; polvo no negociable se da por perdido en este objetivo. Es una valoración, no una venta ejecutada. No se suman los beneficios de desarrollo y validación como una cuenta continua.

Se reutiliza el simulador corregido y su evaluación de riesgo; el plugin de investigación sólo aporta señales, dimensionamiento, bloqueos de capital y archivo de posiciones terminales para acelerar. Una prueba de paridad conserva exactamente curva, métricas, operaciones, fills y saldos frente al motor sin archivo. El campo operativo trend-reference actúa sólo como espacio de metadatos del motor; cada resultado, señal y revisión identifica explícitamente la candidata investigada. No se registró ninguna como estrategia aprobable en la aplicación.

La capacidad se obtiene del minuto anterior y se comparte entre fases. Stops ganan en ambigüedad OHLC; los gaps usan peor apertura. El objetivo LIMIT conserva las reglas del simulador previo. Los datos OHLC no revelan colas, orden intraminuto ni profundidad real: los drawdowns/exposición se observan al cierre de cada minuto y no certifican límites tick a tick. El modelo de costos no demuestra capacidad real de ejecución. No se usan futuros, apalancamiento ni funding. El muestreo de un año de desarrollo tampoco garantiza generalización entre regímenes.

## Reproducción y auditoría

Hash del plan y código ejecutable congelados: **35d7078e2bc08c80d9e6fded6a7090d0cf82dee79609a89db0faa74f6e004da4**. run.cjs verifica cada hash antes de evaluar o reutilizar resultados. Los resultados completos conservan operaciones, órdenes, fills, ledger, decisiones, parámetros, hash de dataset y hash de curva de un minuto; las curvas visibles horarias no se usan para calcular drawdown. summary.json contiene la selección, diagnostics.json el diagnóstico posterior y verification.json los controles de integridad y operación.

Desde una copia del proyecto con dependencias instaladas, build idéntico y sin una carpeta previa reports/net-optimization:

~~~powershell
npm.cmd run build
node --test scripts/net-optimization/engine.test.cjs
node scripts/net-optimization/run.cjs freeze
node scripts/net-optimization/verify-operational.cjs before
python scripts/net-optimization/download.py development
python scripts/net-optimization/download.py validation
node --max-old-space-size=8192 scripts/net-optimization/run.cjs
node --max-old-space-size=8192 scripts/net-optimization/diagnostics.cjs
python scripts/net-optimization/verify-data.py
node scripts/net-optimization/verify-operational.cjs after
node scripts/net-optimization/verify.cjs
node scripts/net-optimization/report.cjs
~~~

El chequeo operacional usa SELECT sobre la base local dedicada volbot_v2, exige todas las cuentas pausadas, cero aprobaciones y saldos/inventario idénticos. No imprime credenciales. Descargar datos públicos requiere red. Un freeze existente se rechaza y nunca se sobrescribe; cambios de hipótesis requieren un estudio separado y no reutilizar la prueba final como nueva evidencia.

Verificación de esta entrega: 115 tests existentes aprobados, siete contratos nuevos de investigación y typecheck correcto. No se modificó ni desplegó código de producción en esta etapa. Se verificó además que el código congelado de BTC-V3 anterior permanece intacto. Las tres cuentas PAPER conservan bloqueo, cero aprobaciones y cero filas de inventario/órdenes operativas.
