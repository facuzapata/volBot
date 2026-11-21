# Causas de pérdidas btc-v2

## Dictamen

Conservar btc-v2 como referencia experimental bloqueada, no como estrategia aprobada. La evidencia identifica fricciones demasiado grandes frente al movimiento posterior medio, ausencia de ventaja neta demostrada y una geometría de stop que puede quedar del lado equivocado de la apertura tras pagar ejecución. No hay una única causa que se resuelva ampliando el stop.

La etapa es exploratoria. Se preservaron btc-v2, indicadores, configuración productiva, datos y reportes anteriores. No se habilitaron entradas, no hubo migraciones, despliegues ni llamadas privadas Binance. Se reutilizó StrategyEngine y BacktestingEngine compilados, CandleAggregator y PaperExecutionAdapter. Rama feature/volbot-v2-event-driven. El estado previo y hashes están en ../reports/signal-research-v1/before.json. El plan se fijó antes de medir estos resultados: [signal-research-plan.json](signal-research-plan.json), SHA256 f06d6d322edab74358ad98b93e4245c4110acddaf01b2ea3ea20949f138b9ace, semilla 20261120.

## Causas confirmadas y prioridad

1. **Economía desfavorable de los movimientos capturados.** En 777 BUY de siete períodos, bruto medio 60m +0,0354 % frente a neto −0,2443 % con hold acotado y costos actuales. Mediana bruta −0,0131 %. Todos los horizontes investigados, 5–240m, tienen media neta negativa. No se suman esos holds como P&L de una cartera porque se solapan.
2. **Fricciones sustanciales.** En los 28 originales: −3,10645733 USDT = −0,79027291 de referencias de fills −1,65436033 comisiones −0,66182409 spread/slippage/redondeo, a trayectoria fija. En siete meses, 767 cierres y −49,40556716 USDT, con 45,64013376 de comisiones y 16,41313344 de impacto ejecutado. Sumarlos al neto da +12,64770004 USDT contables a referencias, pero no es un replay rentable sin costos. Los porcentajes de componentes sobre pérdida pueden superar 100 % cuando el componente bruto era positivo.
3. **Protección y precio de entrada desalineados en parte de la muestra.** Seis de las 28 protecciones estaban al nivel o sobre la apertura bruta después del fill de compra. Nueve stops llegaron dentro de cinco minutos. La configuración permite esta geometría al anclar un porcentaje pequeño a un precio que ya incluye spread/slippage. Es un mecanismo de las reglas/modelo observadas, no una clasificación errónea de esas seis salidas ni un bug nuevo corregido en esta investigación.
4. **La confluencia no acredita ventaja predictiva neta.** El contraste 60m frente a tendencia alcista con filtros incompletos da −0,06545 pp (777 pares, 3.756 controles únicos, 123 días con casos). IC95 diario sin ajustar [−0,11394, −0,02222], Holm 30 comparaciones 0,184. No hay superioridad demostrada; la aparente inferioridad tampoco debe presentarse como un hallazgo definitivo después de multiplicidad y reutilización de controles.

## Hipótesis parcialmente respaldadas

- **Entrada tras un tramo ya avanzado.** Rango relativo de 100m medio 0,846 en BUY frente a 0,596 en controles alcistas iguales en día/hora/volatilidad. Retorno previo 15m +0,1388 % frente a +0,0487 %. Son diferencias de condiciones observadas, no prueba de que esperar siempre mejore.
- **Escala temporal/volatilidad inadecuada para parte de las salidas.** Stop mediano original interpolado 0,1122 % y 3,857 ATR de minuto; break-even mercado aproximadamente 0,2804 %. Hay movimientos que posteriormente recuperan el objetivo, pero con riesgo/tiempo adicionales. No se identifica un multiplicador ATR óptimo.
- **Redundancia de información.** Distancia precio/SMA9 frente a precio/EMA12 tiene Pearson aproximadamente 0,958 y sus pendientes 0,927 en 63.470 observaciones únicas seleccionadas. No son confirmaciones independientes. Los booleanos de filtros correlacionan mucho menos; tampoco corresponde descartarlos todos por esa correlación continua.

## Hipótesis que los datos no sostienen

- «Las 28 pérdidas son un error de clasificación»: el replay causal conserva los mismos 28 stops y P&L, sin cambios productivos.
- «Las compras ocurren generalmente cuando el histograma ya decae»: la definición prefijada conjunta aparece en 10,17 % de BUY frente a 10,68 % de controles B. La diferencia incluye cero; el histograma previo suele aumentar. No se descartan otras formas de agotamiento, sólo falta respaldo para esta hipótesis concreta.
- «Eliminar stops resolvería la estrategia»: los holds netos medios de 5/15/30/60/120/240m siguen negativos. Sólo 2/28 TP después de stop dentro de 4h; a 24h 7/21 completos, con siete censurados y caídas adicionales. No es prueba de rentabilidad realizable.
- «Más filtros alcistas implican ventaja» y «RSI permite separar fácilmente las mejores»: ni los controles ni los RSI medios 58–59 de ganadoras/perdedoras respaldan esas afirmaciones.

No sostener una hipótesis aquí no prueba su imposibilidad universal; faltan muestras nuevas.

## Respuestas a las diez preguntas

| Pregunta | Respuesta respaldada | Muestra y referencia |
|---|---|---|
| 1. ¿Por qué pierde? | Movimiento posterior insuficiente para fricciones y salidas sin ventaja neta acreditada; seis stops originales ya cruzados frente a apertura. | 28 originales +777 señales; entry-signal-diagnostics.md y stop-loss-diagnostics.md |
| 2. ¿Compra demasiado tarde? | Compra más arriba del rango y tras más suba previa. No se confirma agotamiento del histograma ni causalidad de comprar tarde. | 777 pares con controles B; feature-control-comparison.csv |
| 3. ¿Predice subidas? | Media bruta 60m +0,0354 %, IC95 [−0,0294,+0,1002]; neto −0,2443 %. No hay ventaja neta demostrada frente C. | 777 señales, 123 días; signal-control-comparison.csv |
| 4. ¿Stop demasiado ajustado? | Pequeño frente a costos en parte de la muestra, no universalmente pequeño en ATR. Nueve de 28 duran <=5m y seis tienen stop >= apertura. | 28 originales y 610 stops ampliados; stop-loss-analysis.csv |
| 5. ¿Cuánto son costos? | Original: 1,65436 USDT de comisiones y 0,66182 de ejecución, 53,26 % y 21,30 % de pérdida a fills fijos. | 28 originales; strategy-research-summary.json strategyCosts |
| 6. ¿Qué indicadores ayudan? | Ninguno demuestra rentabilidad neta aislada. Ablaciones previas empeoran al quitar varios filtros; structure no cambia A. Hay alta correlación continua SMA/EMA. | Muestra de componentes y ablaciones previas; entry-signal-diagnostics.md |
| 7. ¿Mejores entradas? | 155 ganadoras: ATR/precio medio 0,1229 %, impulso previo 15m +0,2110 %, RSI 59,12. Descriptivo, no regla validada. | Siete períodos, ranking actual-winning-trades |
| 8. ¿Peores entradas? | 612 perdedoras: ATR/precio 0,0731 %, impulso previo +0,1201 %, RSI 58,03. Volumen y proximidad a máximos no separan limpiamente. | Siete períodos, ranking actual-losing-trades |
| 9. ¿Conservar btc-v2? | Como baseline de investigación pausado; sin evidencia suficiente para habilitar entradas. No borrar su historial. | 767 cierres ampliados, todos los meses negativos; períodos ya observados |
| 10. ¿Qué estudiar en v3? | Abstención económica, predicción condicional frente a controles, geometría de stop/precio y señales menos redundantes, con validación nueva. | Hipótesis siguientes, sin implementación ni optimización |

Las características de mejores/peores están condicionadas al resultado observado y mezclan regímenes. No son predictores validados. La comparación completa y buckets prefijados se conservan, incluidos los negativos y con pocos datos.

## Próximas hipótesis verificables para una futura v3

1. Estimar si el movimiento favorable condicional y su incertidumbre superan el break-even por tipo de orden. Comparar una política de abstención con cash y controles, con límites fijados en desarrollo y sin búsqueda sobre la prueba nueva.
2. Investigar si la distancia de protección y el precio de entrada de referencia pueden representar el riesgo deseado después de costos. Probar escenarios donde el stop queda sobre la apertura, sin ocultar pérdidas ni eliminar protección.
3. Evaluar continuación y retroceso en el mismo régimen/volatilidad/horario. D/E ya definidos aquí son controles, no ganadores seleccionados. Exigir mejora frente a C y estabilidad por período con costos completos.
4. Probar información incremental de cada familia de señales, con validación temporal purgada/embargada según horizonte y controles de dependencia. Reducir redundancia no garantiza ventaja; medirla.
5. Separar predicción de entrada, horizonte, supervivencia al stop y decisión de salida. Medir pérdidas adicionales antes de TP, no sólo recuperación posterior. Reservar marzo/abril 2025 o un tramo prospectivo todavía intacto antes de elegir parámetros.

Ninguna de estas hipótesis se implementó. No se eligió TP, ATR, filtro o costo por mejor resultado. No hay aprobación nueva ni sugerencia de operar BTC con dinero real.

## Reproducibilidad, validación y preguntas abiertas

Todas las features usan únicamente velas cerradas: 1m hasta la señal y buckets 5m/1h completos de cierre <= decisión. Se instrumenta la lectura de los resultados de indicadores existentes, sin sustituir sus fórmulas. RSI es el cálculo de ganancias/pérdidas de la ventana original, no se reemplaza por otra variante. Se conservan buffers de 100 velas como en producción. Señal = transición false→true de elegibilidad; no se cuentan todos los minutos consecutivos elegibles como señales distintas. Se incluyen señales rechazadas o sin fill, diferenciadas de operaciones ejecutadas.

El ancla de investigación es la apertura siguiente contigua, no el precio ejecutado con costos. Un horizonte de h minutos termina al cierre de su h-ésima vela: entryTime + h×60000 − 1. El retorno bruto es cierre/apertura − 1; MFE/MAE usan máximo/mínimo dentro del mismo horizonte y tiempos expresados como intervalo de una vela. El máximo a posteriori nunca se pasa a decisiones ni se presenta como precio de salida obtenible. Una ventana que cruza hueco o final queda censurada, no se imputa cero y no se elimina la señal de la selección.

El retorno neto de hold acotado usa compra y venta de mercado con el adaptador existente, cantidades redondeadas y 30 USDT de presupuesto. Se normaliza por costo USDT efectivamente gastado en BUY: (ingreso neto SELL − costo BUY) / costo BUY, incluyendo fees y precios ejecutados. El remanente de presupuesto sin gastar no se pierde. Cada observación se calcula independientemente: no limita concurrencia ni aplica stops, admisión de cartera o liquidez. Para inicializar el cálculo de costos se utiliza geometría sintética de riesgo, irrelevante para los precios/costos; no se propone como nueva señal. No equivale a un backtest implementable. Los resultados con stops/cartera son los del replay original, separados en columnas actual*. Datos posteriores se usan sólo después de terminar la generación causal de señales.

Los intervalos son percentiles de 2.000 remuestreos de bloques por día UTC, estratificados por período, no errores IID por minuto. El contraste primario empareja cada señal con hasta cinco controles y remuestrea diferencias de caso menos promedio de controles. Se informa sensibilidad con bloques de cinco días y ajuste Holm sobre cinco grupos × seis horizontes en la muestra ampliada. Hay dependencia residual entre días, horizontes y controles reutilizados. Los 28 casos originales están concentrados en cinco días con señales; la sensibilidad de cinco días tiene sólo dos bloques, insuficientes para inferencia sólida. Los intervalos no son certificación de rentabilidad ni evidencia fuera de muestra.

Los ocho datasets ya estaban observados. Se conservan sus etiquetas previas de desarrollo/validación/final, pero ahora todos son exploratorios. Enero original se informa separado y no entra en el agregado ampliado. No se hicieron selecciones por resultados ni se descartaron meses negativos. Marzo de 2020 conserva la cuarentena de una vela inválida y 129 minutos ausentes; se reinician indicadores y agregación y se censuran horizontes que cruzan el hueco. No se descargaron datos nuevos. Marzo/abril de 2025 quedan como candidatos reservados, ausentes de esta evaluación; antes de usarlos debe congelarse una hipótesis nueva y comprobar que siguen sin haberse usado.

El simulador conserva aproximaciones de liquidez y ejecución OHLC descritas en [simulator-audit.md](simulator-audit.md). La primera entrada del backtester limita tamaño con volumen previo; onCandle todavía usa volumen completo de vela para capacidad, incluidos posibles pendientes de apertura. Por tanto no se certifica ausencia total de anticipación en liquidez. No se reconstruyeron libros, ticks, cola, filtros/tarifas históricos ni mejoras reales de ejecución. Los controles de señales evitan esa capacidad al estudiar retornos de precios y etiquetan los costos como modelados. No se corrigió el simulador en esta etapa.

Los entregables son entry-signal-analysis.csv (805 filas), signal-control-comparison.csv (1.080 filas), stop-loss-analysis.csv (638 filas) y strategy-research-summary.json, además de los tres informes. Los JSON por período conservan selección de controles por ID, resultados individuales y replays de cartera para verificar los agregados sin regenerar indicadores. Los archivos adicionales control-observations.csv, feature-buckets.csv, feature-control-comparison.csv e indicator-correlation.csv permiten inspección independiente. No incluyen credenciales.

Pruebas nuevas: horizontes y retornos exactos, MFE/MAE y límites temporales, censura por hueco/final, semillas reproducibles, selección de controles invariante a resultados futuros, comparación pareada con censura, agregación cerrada 1m/5m/1h y prefijo de señales invariante a cambios futuros, break-even tick por tipo de orden y riesgo antes del primer TP. Se ejecutaron suite relevante, typecheck y build; los resultados exactos quedan en ../reports/signal-research-v1/tests.json y all-tests.json y la conciliación final en verification.json. No se verificaron ticks/libro reales, disponibilidad de tarifas, equivalencia de liquidez ni ventaja fuera de muestra nueva. No se detectó un nuevo error de implementación que autorice corregir producción en esta etapa.
