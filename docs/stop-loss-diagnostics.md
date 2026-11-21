# Diagnóstico de stop-loss btc-v2

## Conclusión

Los stops explican el momento de realización de muchas pérdidas, pero no demuestran que eliminarlos recupere rentabilidad. En las 28 originales, 9/28 (32.14 %) cerraron dentro de los primeros cinco minutos y 6/28 tenían el stop al nivel o por encima de la apertura de mercado tras reanclarlo al precio de compra con costos. Eso expone una incompatibilidad concreta entre costo de entrada y distancia de protección, sin necesitar un retroceso del precio para tocar algunos stops.

La etapa es exploratoria. Se preservaron btc-v2, indicadores, configuración productiva, datos y reportes anteriores. No se habilitaron entradas, no hubo migraciones, despliegues ni llamadas privadas Binance. Se reutilizó StrategyEngine y BacktestingEngine compilados, CandleAggregator y PaperExecutionAdapter. Rama feature/volbot-v2-event-driven. El estado previo y hashes están en ../reports/signal-research-v1/before.json. El plan se fijó antes de medir estos resultados: [signal-research-plan.json](signal-research-plan.json), SHA256 f06d6d322edab74358ad98b93e4245c4110acddaf01b2ea3ea20949f138b9ace, semilla 20261120.

## Distribución y escala de volatilidad

| Muestra | Stops | <=5m | Stop mediano % | Stop/ATR mediano | Tiempo mediano máximo min | MFE mediano superior previo % | Stop >= apertura |
|---|---|---|---|---|---|---|---|
| 2025-01-original | 28 | 32.14 % | 0.1122 | 3.857 | 15.00 | 0.0388 | 6 |
| 2020-03 | 82 | 18.29 % | 0.3659 | 2.913 | 13.00 | 0.2114 | 0 |
| 2022-06 | 68 | 25.00 % | 0.3619 | 2.972 | 15.50 | 0.1647 | 0 |
| 2023-07 | 81 | 35.80 % | 0.0934 | 3.724 | 12.00 | 0.0100 | 11 |
| 2023-09 | 83 | 32.53 % | 0.1397 | 3.864 | 10.00 | 0.0124 | 5 |
| 2024-02 | 110 | 20.91 % | 0.1760 | 3.644 | 17.00 | 0.0501 | 4 |
| 2024-10 | 127 | 22.05 % | 0.1541 | 3.942 | 17.00 | 0.0305 | 5 |
| 2025-02 | 59 | 18.64 % | 0.1499 | 3.690 | 17.00 | 0.0285 | 3 |
| pooled-expanded-exploratory | 610 | 24.59 % | 0.1756 | 3.506 | 15.00 | 0.0540 | 28 |

En originales el stop mediano estándar es 0.1122 %, con 3.857 ATR de 1m. Aquí se interpola linealmente el cuantil 50; la auditoría anterior usó observación central inferior (0,102965 % y 3,5865 ATR). Es una diferencia de definición estadística, no de operaciones ni de reglas. No son stops universalmente inferiores a 1 ATR. Un ATR de minuto no mide el riesgo de mantener durante una hora o un día, así que tampoco demuestra que esos stops sean adecuados para esos horizontes.

La fila original tiene MFE superior mediano antes de stop 0.0388 %, frente a movimiento bruto necesario de aproximadamente 0,2804 % para entrar y salir a mercado. 22/28 ni siquiera alcanzan ese umbral usando el máximo superior OHLC antes del stop. Ese máximo puede incluir precios posteriores al fill dentro de la vela de salida; es un límite favorable, no un precio capturable.

No se confirma estadísticamente que cada stop sea «un retroceso normal»: necesitaríamos definir normalidad por escala y comparar trayectorias/riesgo condicional. Lo que sí se verifica es que la protección es pequeña en porcentaje frente al costo y frente a excursiones de horizontes mayores, y que ampliar ATR no mejoró consistentemente la auditoría previa. No se propone eliminar stops ni subir su distancia para fabricar una mejora.

## Qué ocurrió después de cerrar

Se comienza en la primera vela completa posterior al cierre registrado. No se utiliza el resto desconocido de la vela donde tocó el stop. El tiempo real del toque se expresa entre apertura y cierre de esa vela; el timestamp del simulador es su cierre de procesamiento. Los 1/2/4/8/24h siguientes son horizontes acotados, con censura explícita por huecos/final del dataset.

| Horas posteriores | Originales completos | TP posterior | Proporción completos | Censurados | Mediana caída extra completa % | Mediana caída extra ANTES de TP % |
|---|---|---|---|---|---|---|
| 1 | 28 | 0 | 0.00 % | 0 | 0.2341 | n/d |
| 2 | 28 | 1 | 3.57 % | 0 | 0.2935 | 0.5182 a 0.5182 |
| 4 | 28 | 2 | 7.14 % | 0 | 0.5130 | 0.2591 a 0.2591 |
| 8 | 28 | 3 | 10.71 % | 0 | 0.6305 | 0.5182 a 0.5182 |
| 24 | 21 | 7 | 33.33 % | 7 | 0.8200 | 0.7463 a 0.7463 |

Dentro de 24h hay siete TP observados entre 21 casos con cobertura completa; siete casos adicionales están censurados. 7/21 no se debe presentar como probabilidad de recuperación de los 28: el denominador censurado importa y no se modeló una cartera que siguiera abierta. Entre los siete que sí llegaron al TP, la caída adicional mediana antes de alcanzarlo fue aproximadamente 0.7463 puntos porcentuales del precio de entrada, además de la protección inicial. Los intervalos antes de TP excluyen mínimos de velas posteriores al target; si el mínimo de la propia vela de TP tiene orden desconocido, se publica límite inferior/superior. La caída máxima del horizonte completo es otra métrica y puede ocurrir después del TP.

| Muestra ampliada | N | <=5m | TP después 1h / completos | 2h | 4h | 8h | 24h |
|---|---|---|---|---|---|---|---|
| pooled-expanded-exploratory | 610 | 24.59 % | 32/610 | 64/608 | 120/605 | 179/605 | 305/583 |

El CSV ../reports/stop-loss-analysis.csv tiene 638 stops (28 originales y 610 ampliados): stop inicial, ATR, tiempo de toque acotado, MFE previo inferior/superior, máximos/mínimos posteriores, retorno desde la salida, TP posterior por horizonte, censura, y riesgo adicional antes de TP y durante todo el hold. Es análisis contrafactual condicionado a haber perdido; no reemplaza el estudio de todas las señales ni cuantifica rentabilidad obtenible sin stops.

## Costos, break-even y margen

| Componente original | USDT |
|---|---|
| P&L observado | -3.10645733 |
| Comisiones compra+venta | 1.65436033 |
| Spread | 0.16543600 |
| Slippage | 0.49630801 |
| Redondeo | 0.00008008 |
| P&L sumando comisiones al neto | -1.45209700 |
| P&L con referencias de fills, sin fricciones contables | -0.79027291 |

En los 28 casos, las comisiones equivalen al 53,26 % de la pérdida observada y ejecución/redondeo al 21,30 %. Incluso la descomposición a referencias deja −0,79027291 USDT. Es identidad sobre fills y trayectoria fijos, no resultado de volver a ejecutar otra estrategia sin costos: los costos también afectan stop reanclado, cantidad y órdenes futuras. No restar spread/slippage otra vez al neto.

Se usa cantidad real y costo de compra incluido fee. El mínimo precio SELL ejecutado se calcula como ceil_tick(costoCompra / (cantidadBTC × (1−feeSELL))). Para mercado se exige además una referencia tal que el precio tras spread/2+slippage y floor_tick alcance ese mínimo. Se prueba con el adaptador que ese tick es no negativo y uno inferior pierde. Para TP LIMIT no se carga spread/slippage de salida según el simulador; no se promete ese fill en Binance. El movimiento mediano desde la apertura bruta es 0.2804 % con salida MARKET y 0.2403 % con salida LIMIT. No basta un movimiento de 0,2 % bruto para cubrir el circuito completo actual.

Cada fila conserva costo total de compra, fee/impacto de entrada y salida por separado, resultado bruto a precios ejecutados, resultado neto y margen superior antes del stop. entry-signal-analysis.csv añade headroom MFE menos break-even por horizonte: son puntos porcentuales de referencia, sin asumir salida en el máximo.

| Sensibilidad hold 60m ampliado | N | Media neta % | IC95 % |
|---|---|---|---|
| current | 777 | -0.2443 | [-0.3113, -0.1826] |
| fee-half-hypothetical | 777 | -0.1445 | [-0.2095, -0.0770] |
| no-fee-hypothetical | 777 | -0.0446 | [-0.1063, 0.0226] |
| no-spread-hypothetical | 777 | -0.2244 | [-0.2918, -0.1600] |
| no-slip-hypothetical | 777 | -0.1845 | [-0.2504, -0.1180] |
| zero-friction-hypothetical | 777 | 0.0354 | [-0.0295, 0.1026] |

Todas las sensibilidades son hipotéticas. No se afirma que existan esas comisiones ni que se pueda conseguir slippage cero. Cambiar sólo costos en un hold acotado no valida la estrategia con stops.

## Límites

Los intervalos son percentiles de 2.000 remuestreos de bloques por día UTC, estratificados por período, no errores IID por minuto. El contraste primario empareja cada señal con hasta cinco controles y remuestrea diferencias de caso menos promedio de controles. Se informa sensibilidad con bloques de cinco días y ajuste Holm sobre cinco grupos × seis horizontes en la muestra ampliada. Hay dependencia residual entre días, horizontes y controles reutilizados. Los 28 casos originales están concentrados en cinco días con señales; la sensibilidad de cinco días tiene sólo dos bloques, insuficientes para inferencia sólida. Los intervalos no son certificación de rentabilidad ni evidencia fuera de muestra.

Los ocho datasets ya estaban observados. Se conservan sus etiquetas previas de desarrollo/validación/final, pero ahora todos son exploratorios. Enero original se informa separado y no entra en el agregado ampliado. No se hicieron selecciones por resultados ni se descartaron meses negativos. Marzo de 2020 conserva la cuarentena de una vela inválida y 129 minutos ausentes; se reinician indicadores y agregación y se censuran horizontes que cruzan el hueco. No se descargaron datos nuevos. Marzo/abril de 2025 quedan como candidatos reservados, ausentes de esta evaluación; antes de usarlos debe congelarse una hipótesis nueva y comprobar que siguen sin haberse usado.

El simulador conserva aproximaciones de liquidez y ejecución OHLC descritas en [simulator-audit.md](simulator-audit.md). La primera entrada del backtester limita tamaño con volumen previo; onCandle todavía usa volumen completo de vela para capacidad, incluidos posibles pendientes de apertura. Por tanto no se certifica ausencia total de anticipación en liquidez. No se reconstruyeron libros, ticks, cola, filtros/tarifas históricos ni mejoras reales de ejecución. Los controles de señales evitan esa capacidad al estudiar retornos de precios y etiquetan los costos como modelados. No se corrigió el simulador en esta etapa.
