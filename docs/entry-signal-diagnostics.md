# Diagnóstico de señales de entrada btc-v2

## Resultado principal

En 777 señales de siete meses, el retorno medio del mercado a 60m fue 0.0354 %, IC95 [-0.0294, 0.1002]. Tras compra/venta de mercado modeladas fue -0.2443 %, IC95 [-0.3077, -0.1808]. No aparece una ventaja predictiva neta frente a controles de tendencia comparables. Las entradas están más arriba del rango reciente, pero la hipótesis específica de histograma agotándose no queda confirmada.

La etapa es exploratoria. Se preservaron btc-v2, indicadores, configuración productiva, datos y reportes anteriores. No se habilitaron entradas, no hubo migraciones, despliegues ni llamadas privadas Binance. Se reutilizó StrategyEngine y BacktestingEngine compilados, CandleAggregator y PaperExecutionAdapter. Rama feature/volbot-v2-event-driven. El estado previo y hashes están en ../reports/signal-research-v1/before.json. El plan se fijó antes de medir estos resultados: [signal-research-plan.json](signal-research-plan.json), SHA256 f06d6d322edab74358ad98b93e4245c4110acddaf01b2ea3ea20949f138b9ace, semilla 20261120.

## Universo, períodos y regímenes

| Período | Uso previo | Señales BUY | Cerradas con stops/reglas | P&L estrategia USDT | Retorno bruto 60m % | Neto hold 60m % |
|---|---|---|---|---|---|---|
| 2025-01-original | original-diagnostic | 28 | 28 | -3.1065 | -0.1031 | -0.3824 |
| 2020-03 | development | 121 | 120 | -7.4169 | 0.0330 | -0.2469 |
| 2022-06 | development | 90 | 90 | -7.8650 | -0.1241 | -0.4034 |
| 2023-07 | development | 86 | 86 | -7.4178 | -0.0117 | -0.2913 |
| 2023-09 | development | 97 | 97 | -6.4709 | 0.0522 | -0.2276 |
| 2024-02 | development | 149 | 148 | -5.5573 | 0.1097 | -0.1703 |
| 2024-10 | validation | 159 | 157 | -9.9299 | 0.0877 | -0.1921 |
| 2025-02 | final-oos | 75 | 69 | -4.7479 | 0.0044 | -0.2752 |

Son 805 señales en total: 28 originales y 777 ampliadas. En la ampliada se ejecutaron 767 posiciones, 155 ganadoras y 612 perdedoras. Las diez señales restantes no son pérdidas ni ganancias ejecutadas. La admisión y los fills aparecen en entry-signal-analysis.csv. Mes alcista: febrero 2024; bajista: junio 2022; lateral/baja variación relativa: julio/septiembre 2023; alta volatilidad: marzo 2020. Sus retornos y volatilidades observados están en [strategy-diagnostics.md](strategy-diagnostics.md). Son ventanas seleccionadas, no una historia continua. La agregación pesa señales, no meses iguales ni capital compuesto.

## Por qué se compra y reconstrucción original

Se exige tendencia EMA12>EMA26, SMA9>SMA21 y precio>SMA50 en 1h; confirmación MACD>señal y SMA9>SMA21 en 5m; RSI 35–65, histograma positivo, vela verde/engulfing, volumen >1,2×SMA10 y precio>0,995×SMA21 en 1m. El objetivo debe superar costos nominales. Una confluencia de esas reglas no estima por sí sola una probabilidad calibrada de ganar.

../reports/entry-signal-analysis.csv conserva una fila por cada BUY emitido: RSI, MACD/señal/histograma, SMA/EMA 1m/5m/1h, ATR, volatilidad de retornos 30m, volumen, pendientes de medias, distancias a máximos/mínimos de 20/50/100 velas, retornos anteriores 5/15/30/60m, racha verde, posición de RSI frente a sus 20 lecturas anteriores y evolución de histograma en cinco minutos. Los máximos previos incluyen la vela de señal ya cerrada. La posición RSI puede quedar fuera de [0,1] si supera su rango previo. Volumen relativo incluye la vela cerrada en SMA10, igual que producción.

Las 28 ventanas originales completas están en ../reports/signal-research-v1/2025-01-original/original-28-windows.json. Cada una incluye señal, apertura siguiente y OHLC/features causales por minuto desde −120 hasta +120 respecto de entrada (241 velas si hay cobertura completa). Las features de la parte posterior están etiquetadas como investigación y nunca alimentan el backtester. El replay mantiene exactamente las 28 salidas STOP_LOSS y −3,1064573288 USDT.

## Movimiento posterior sin stops

| Horizonte min | N ampliada | Media bruta % | Mediana bruta % | SD bruta % | Media neta % | IC95 neto % | MFE medio % | MAE medio % |
|---|---|---|---|---|---|---|---|---|
| 5 | 777 | 0.0064 | -0.0001 | 0.2073 | -0.2733 | [-0.2856, -0.2617] | 0.1404 | 0.1059 |
| 15 | 777 | 0.0192 | -0.0030 | 0.3753 | -0.2605 | [-0.2867, -0.2322] | 0.2437 | 0.1962 |
| 30 | 777 | 0.0537 | -0.0215 | 0.5276 | -0.2261 | [-0.2705, -0.1843] | 0.3760 | 0.2722 |
| 60 | 777 | 0.0354 | -0.0131 | 0.7044 | -0.2443 | [-0.3077, -0.1808] | 0.5247 | 0.4004 |
| 120 | 776 | 0.0469 | -0.0230 | 0.9368 | -0.2328 | [-0.3209, -0.1427] | 0.6994 | 0.5663 |
| 240 | 773 | 0.0756 | -0.0310 | 1.2883 | -0.2043 | [-0.3719, -0.0450] | 0.9877 | 0.8024 |

| Umbral | Prob. alcanzar en 60m | Prob. alcanzar en 240m |
|---|---|---|
| hitUp0.2pctProbability | 56.76 % | 76.71 % |
| hitUp0.4pctProbability | 35.65 % | 58.34 % |
| hitUp0.6pctProbability | 26.38 % | 47.22 % |
| hitUp0.8pctProbability | 19.95 % | 38.55 % |
| hitUp1pctProbability | 15.70 % | 32.60 % |
| hitDown0.2pctProbability | 55.86 % | 75.81 % |
| hitDown0.4pctProbability | 32.69 % | 56.02 % |
| hitDown0.6pctProbability | 19.43 % | 41.79 % |
| hitDown1pctProbability | 9.27 % | 24.19 % |

Las probabilidades son frecuencias empíricas entre horizontes completos, no probabilidades calibradas ni orden de llegada de barreras. Pueden tocarse ambos lados; no se suman como eventos excluyentes. El CSV de controles conserva todos los horizontes y datos por período. En las 28 originales, el bruto medio a 60m fue -0.1031 % y el neto -0.3824 %. Todos esos 28 holds netos de 60m fueron negativos. No implica que todos los horizontes o recorridos posibles fueran negativos.

## Controles definidos antes de observar resultados

A: minutos aleatorios del mismo período sin igualar régimen. B: minutos de tendencia 1h alcista. C: tendencia 1h alcista pero confluencia incompleta. D: transición de tendencia 1h alcista y retorno previo 15m >0,2 %. E: transición de tendencia 1h alcista, precio<SMA21 y retorno previo 5m<0. D/E son reglas de control, sin optimización ni cartera alternativa implementada.

Para B/C/D/E se buscan hasta cinco controles por caso sin reemplazo dentro del caso, permitiendo reutilización entre casos. Se igualan período, día UTC, bloque horario de cuatro horas, bucket ATR/precio (<0,05 %, 0,05–0,1 %, 0,1–0,2 %, 0,2–0,4 %, >=0,4 %) y primaryTrend. Fallback prefijado: relajar horario, luego día manteniendo horario, finalmente día y horario, conservando siempre régimen y bucket de volatilidad. El CSV informa nivel y cobertura. B/C tuvieron emparejamiento exacto nivel 0 en los 777 casos a 60m. La disponibilidad de resultados futuros nunca decide qué controles se seleccionan.

| Control | Casos emparejados | Controles únicos | Neto control 60m % | BTC menos control pp | IC95 diferencia pp | p Holm 30 |
|---|---|---|---|---|---|---|
| A-random | 777 | 3856 | -0.3041 | 0.0598 | [-0.0033, 0.1240] | 1.000 |
| B-uptrend | 777 | 3775 | -0.1917 | -0.0527 | [-0.0980, -0.0094] | 0.390 |
| C-trend-incomplete | 777 | 3756 | -0.1789 | -0.0655 | [-0.1139, -0.0222] | 0.184 |
| D-momentum | 777 | 1566 | -0.2102 | -0.0342 | [-0.0778, 0.0091] | 1.000 |
| E-pullback | 777 | 2535 | -0.1518 | -0.0926 | [-0.1388, -0.0500] | 0.015 |

La fila case-weighted-matched usa el promedio de controles por señal: cada caso pesa una vez. Unique-controls muestra la distribución de controles distintos y raw las reglas completas/componentes; no confundir sus medianas y dispersiones, pues promediar cinco controles reduce dispersión mecánicamente. La diferencia primaria C fue -0.0655 pp: peor en la muestra, IC95 sin ajustar [-0.1139, -0.0222], p centrada bootstrap 0.008, Holm 0.184. No alcanza para afirmar inferioridad robusta tras todas las comparaciones, y tampoco aporta evidencia de superioridad. Con bloques de cinco días el intervalo es [-0.1105, -0.0199] pp, todavía exploratorio.

Los intervalos son percentiles de 2.000 remuestreos de bloques por día UTC, estratificados por período, no errores IID por minuto. El contraste primario empareja cada señal con hasta cinco controles y remuestrea diferencias de caso menos promedio de controles. Se informa sensibilidad con bloques de cinco días y ajuste Holm sobre cinco grupos × seis horizontes en la muestra ampliada. Hay dependencia residual entre días, horizontes y controles reutilizados. Los 28 casos originales están concentrados en cinco días con señales; la sensibilidad de cinco días tiene sólo dos bloques, insuficientes para inferencia sólida. Los intervalos no son certificación de rentabilidad ni evidencia fuera de muestra.

## ¿Se compra tarde o con impulso agotado?

| Feature previa | BTC media | Control B media | Diferencia | IC95 diferencia |
|---|---|---|---|---|
| prior5Pct | 0.1492 | 0.0098 | 0.1394 | [0.1229, 0.1571] |
| prior15Pct | 0.1388 | 0.0487 | 0.0901 | [0.0726, 0.1069] |
| prior30Pct | 0.2381 | 0.0877 | 0.1505 | [0.1193, 0.1838] |
| prior60Pct | 0.4663 | 0.1679 | 0.2983 | [0.2553, 0.3453] |
| distanceHigh20Pct | -0.0693 | -0.2016 | 0.1323 | [0.1141, 0.1510] |
| distanceHigh50Pct | -0.1305 | -0.3051 | 0.1746 | [0.1472, 0.2049] |
| distanceHigh100Pct | -0.1634 | -0.4103 | 0.2469 | [0.2111, 0.2899] |
| rangePosition100 | 0.8463 | 0.5957 | 0.2506 | [0.2363, 0.2658] |
| histogramDelta5 | 5.3744 | -0.3485 | 5.7230 | [4.8968, 6.5815] |
| lateExhaustion | 0.1017 | 0.1068 | -0.0051 | [-0.0288, 0.0205] |

Se compra después de más suba previa y más cerca del techo relativo: posición media en rango de 100m 0.846 frente a 0.596. Hay 541/777 señales en el quinto superior del rango. Eso describe entradas extendidas; no demuestra que el máximo esté formado ni identifica causalmente el motivo de la pérdida.

La hipótesis prefijada de agotamiento requiere simultáneamente posición>=0,8, retorno previo 15m positivo e histograma menor que cinco minutos antes. Ocurre en 10.17 % frente a 10.68 % de controles B; la diferencia y su intervalo incluyen cero. El histograma, en promedio, venía aumentando, no decayendo. En las 28 originales fueron 5/28 frente a un promedio de controles de 8.57 %, con intervalo también incluyendo cero. Por tanto no se confirma «comprar cuando el histograma ya se agota» como explicación general. Sí queda respaldada parcialmente la hipótesis de entrada tras un impulso ya avanzado y sin continuación neta suficiente.

## Indicadores y redundancia

| Componente aislado | N completo 60m | Media bruta % | Media neta % |
|---|---|---|---|
| component-primaryTrend | 6983 | 0.0043 | -0.2753 |
| component-confirmation | 6991 | -0.0254 | -0.3050 |
| component-rsiEntry | 6993 | -0.0283 | -0.3078 |
| component-macdEntry | 6990 | 0.0048 | -0.2749 |
| component-candle | 6989 | 0.0065 | -0.2732 |
| component-volume | 6986 | 0.0075 | -0.2721 |
| component-structure | 6990 | -0.0186 | -0.2982 |

Cada componente toma hasta 1.000 minutos por mes, con semilla fija, seleccionados antes de medir futuro. No son señales independientes ni estrategias completas. Los grupos no igualan todos los demás filtros y meses tienen pesos distintos a la muestra de BUY: no se pueden ordenar estas medias como importancia causal.

| Features continuas | N observado | Pearson |
|---|---|---|
| priceSma9Pct / priceEma12Pct | 63470 | 0.958 |
| sma9Slope5Pct / ema12Slope5Pct | 63468 | 0.927 |
| sma21Slope5Pct / ema26Slope5Pct | 63468 | 0.898 |
| rsi / priceSma21Pct | 63470 | 0.540 |
| histogram / priceSma21Pct | 63470 | 0.509 |

Se normalizan distancias precio/media y pendientes, evitando correlacionar sólo niveles de precio entre años. La correlación continua se calcula sobre observaciones únicas seleccionadas, no sobre todo el mercado. Los booleanos de filtros tienen correlaciones phi mucho menores (máxima absoluta fuera de diagonal aproximadamente 0,136 en 299.242 minutos ampliados): correlación continua alta no significa que los filtros binarios sean idénticos. Cinco señales alcistas no representan cinco evidencias independientes.

En la auditoría previa, quitar tendencia 1h, confirmación 5m, RSI, histograma, volumen o vela aumentó las pérdidas agregadas, y quitar structure no cambió A en las ventanas estudiadas. Esas ablaciones se conservan en ../reports/strategy-comparison.csv; cambian admisión, número de trades y transiciones, por lo que no prueban un efecto causal rentable del indicador. SMA21 es redundante en las señales observadas, no universalmente inútil. Ningún componente aislado demuestra rentabilidad neta.

## Mejores y peores entradas: descripción, no regla nueva

| Grupo ejecutado ampliado | N | ATR/precio % | RSI | Volumen / SMA10 | Retorno previo 15m % | Posición rango100 |
|---|---|---|---|---|---|---|
| actual-winning-trades | 155 | 0.1229 | 59.12 | 1.839 | 0.2110 | 0.871 |
| actual-losing-trades | 612 | 0.0731 | 58.03 | 1.995 | 0.1201 | 0.839 |

Las 155 ganadoras tenían más volatilidad ATR y pendientes/impulso previo que las 612 perdedoras, en promedio. No aparece una separación simple por RSI: ambas rondan 58–59. Las medias de volumen tampoco separan limpiamente y el análisis por buckets no es monótono. Las descripciones top/bottom de retorno 60m y todos los buckets prefijados están en strategy-research-summary.json y signal-research-v1/feature-buckets.csv. El alias priorReturn15Pct del plan se corresponde con la columna prior15Pct; sólo se resolvió el nombre, sin cambiar cortes. Seleccionar ganadoras a posteriori sirve para describir, no valida esos rasgos como filtros. Regímenes y estructura de TP/SL pueden explicar parte de la asociación ATR/ganar.

## Método y límites

Todas las features usan únicamente velas cerradas: 1m hasta la señal y buckets 5m/1h completos de cierre <= decisión. Se instrumenta la lectura de los resultados de indicadores existentes, sin sustituir sus fórmulas. RSI es el cálculo de ganancias/pérdidas de la ventana original, no se reemplaza por otra variante. Se conservan buffers de 100 velas como en producción. Señal = transición false→true de elegibilidad; no se cuentan todos los minutos consecutivos elegibles como señales distintas. Se incluyen señales rechazadas o sin fill, diferenciadas de operaciones ejecutadas.

El ancla de investigación es la apertura siguiente contigua, no el precio ejecutado con costos. Un horizonte de h minutos termina al cierre de su h-ésima vela: entryTime + h×60000 − 1. El retorno bruto es cierre/apertura − 1; MFE/MAE usan máximo/mínimo dentro del mismo horizonte y tiempos expresados como intervalo de una vela. El máximo a posteriori nunca se pasa a decisiones ni se presenta como precio de salida obtenible. Una ventana que cruza hueco o final queda censurada, no se imputa cero y no se elimina la señal de la selección.

El retorno neto de hold acotado usa compra y venta de mercado con el adaptador existente, cantidades redondeadas y 30 USDT de presupuesto. Se normaliza por costo USDT efectivamente gastado en BUY: (ingreso neto SELL − costo BUY) / costo BUY, incluyendo fees y precios ejecutados. El remanente de presupuesto sin gastar no se pierde. Cada observación se calcula independientemente: no limita concurrencia ni aplica stops, admisión de cartera o liquidez. Para inicializar el cálculo de costos se utiliza geometría sintética de riesgo, irrelevante para los precios/costos; no se propone como nueva señal. No equivale a un backtest implementable. Los resultados con stops/cartera son los del replay original, separados en columnas actual*. Datos posteriores se usan sólo después de terminar la generación causal de señales.

Los ocho datasets ya estaban observados. Se conservan sus etiquetas previas de desarrollo/validación/final, pero ahora todos son exploratorios. Enero original se informa separado y no entra en el agregado ampliado. No se hicieron selecciones por resultados ni se descartaron meses negativos. Marzo de 2020 conserva la cuarentena de una vela inválida y 129 minutos ausentes; se reinician indicadores y agregación y se censuran horizontes que cruzan el hueco. No se descargaron datos nuevos. Marzo/abril de 2025 quedan como candidatos reservados, ausentes de esta evaluación; antes de usarlos debe congelarse una hipótesis nueva y comprobar que siguen sin haberse usado.

El simulador conserva aproximaciones de liquidez y ejecución OHLC descritas en [simulator-audit.md](simulator-audit.md). La primera entrada del backtester limita tamaño con volumen previo; onCandle todavía usa volumen completo de vela para capacidad, incluidos posibles pendientes de apertura. Por tanto no se certifica ausencia total de anticipación en liquidez. No se reconstruyeron libros, ticks, cola, filtros/tarifas históricos ni mejoras reales de ejecución. Los controles de señales evitan esa capacidad al estudiar retornos de precios y etiquetan los costos como modelados. No se corrigió el simulador en esta etapa.

Reproducción: npm.cmd run build; node scripts/signal-research/run.cjs; node scripts/signal-research/aggregate.cjs; node scripts/signal-research/report.cjs. El runner conserva extracciones completas existentes; para una repetición independiente usar una copia del repositorio/directorio de salida, sin borrar reportes previos. Repetir con la misma fuente/plan/semilla debe conservar hashes de resultados. Tests: test/v2/signal-research.spec.ts. Verificación independiente de CSV y archivos protegidos: scripts/signal-research/verify.py y verify.cjs.
