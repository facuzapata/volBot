const fs=require('fs');
const s=JSON.parse(fs.readFileSync('reports/strategy-research-summary.json'));
const P='pooled-expanded-exploratory',O='2025-01-original';
const n=(v,d=4)=>v==null?'n/d':Number(v).toFixed(d);
const pct=(v,d=2)=>v==null?'n/d':n(v*100,d);
const table=(heads,rows)=>['| '+heads.join(' | ')+' |','|'+heads.map(()=>'---').join('|')+'|',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n');
const raw=(p,h=60)=>s.comparison.find(r=>r.period===p&&r.group==='btc-v2'&&r.selection==='raw'&&r.horizonMinutes===h);
const pair=(p,g,h=60)=>s.comparison.find(r=>r.period===p&&r.group===g&&r.selection==='case-weighted-matched'&&r.horizonMinutes===h);
const feature=(p,k,g='B-uptrend')=>s.featureComparisons.find(r=>r.period===p&&r.control===g&&r.feature===k);
const original=s.stopSummaries.find(r=>r.period===O),expanded=s.stopSummaries.find(r=>r.period===P),cost=s.strategyCosts.find(r=>r.period===O),allCost=s.strategyCosts.find(r=>r.period===P),primary=pair(P,'C-trend-incomplete');
const ranks=s.ranking.filter(r=>r.period===P&&r.label.startsWith('actual-'));
const common=`La etapa es exploratoria. Se preservaron btc-v2, indicadores, configuración productiva, datos y reportes anteriores. No se habilitaron entradas, no hubo migraciones, despliegues ni llamadas privadas Binance. Se reutilizó StrategyEngine y BacktestingEngine compilados, CandleAggregator y PaperExecutionAdapter. Rama feature/volbot-v2-event-driven. El estado previo y hashes están en ../reports/signal-research-v1/before.json. El plan se fijó antes de medir estos resultados: [signal-research-plan.json](signal-research-plan.json), SHA256 ${s.planSHA256}, semilla ${s.seed}.`;
const uncertainty=`Los intervalos son percentiles de 2.000 remuestreos de bloques por día UTC, estratificados por período, no errores IID por minuto. El contraste primario empareja cada señal con hasta cinco controles y remuestrea diferencias de caso menos promedio de controles. Se informa sensibilidad con bloques de cinco días y ajuste Holm sobre cinco grupos × seis horizontes en la muestra ampliada. Hay dependencia residual entre días, horizontes y controles reutilizados. Los 28 casos originales están concentrados en cinco días con señales; la sensibilidad de cinco días tiene sólo dos bloques, insuficientes para inferencia sólida. Los intervalos no son certificación de rentabilidad ni evidencia fuera de muestra.`;
const method=`Todas las features usan únicamente velas cerradas: 1m hasta la señal y buckets 5m/1h completos de cierre <= decisión. Se instrumenta la lectura de los resultados de indicadores existentes, sin sustituir sus fórmulas. RSI es el cálculo de ganancias/pérdidas de la ventana original, no se reemplaza por otra variante. Se conservan buffers de 100 velas como en producción. Señal = transición false→true de elegibilidad; no se cuentan todos los minutos consecutivos elegibles como señales distintas. Se incluyen señales rechazadas o sin fill, diferenciadas de operaciones ejecutadas.

El ancla de investigación es la apertura siguiente contigua, no el precio ejecutado con costos. Un horizonte de h minutos termina al cierre de su h-ésima vela: entryTime + h×60000 − 1. El retorno bruto es cierre/apertura − 1; MFE/MAE usan máximo/mínimo dentro del mismo horizonte y tiempos expresados como intervalo de una vela. El máximo a posteriori nunca se pasa a decisiones ni se presenta como precio de salida obtenible. Una ventana que cruza hueco o final queda censurada, no se imputa cero y no se elimina la señal de la selección.

El retorno neto de hold acotado usa compra y venta de mercado con el adaptador existente, cantidades redondeadas y 30 USDT de presupuesto. Se normaliza por costo USDT efectivamente gastado en BUY: (ingreso neto SELL − costo BUY) / costo BUY, incluyendo fees y precios ejecutados. El remanente de presupuesto sin gastar no se pierde. Cada observación se calcula independientemente: no limita concurrencia ni aplica stops, admisión de cartera o liquidez. Para inicializar el cálculo de costos se utiliza geometría sintética de riesgo, irrelevante para los precios/costos; no se propone como nueva señal. No equivale a un backtest implementable. Los resultados con stops/cartera son los del replay original, separados en columnas actual*. Datos posteriores se usan sólo después de terminar la generación causal de señales.`;
const limits=`Los ocho datasets ya estaban observados. Se conservan sus etiquetas previas de desarrollo/validación/final, pero ahora todos son exploratorios. Enero original se informa separado y no entra en el agregado ampliado. No se hicieron selecciones por resultados ni se descartaron meses negativos. Marzo de 2020 conserva la cuarentena de una vela inválida y 129 minutos ausentes; se reinician indicadores y agregación y se censuran horizontes que cruzan el hueco. No se descargaron datos nuevos. Marzo/abril de 2025 quedan como candidatos reservados, ausentes de esta evaluación; antes de usarlos debe congelarse una hipótesis nueva y comprobar que siguen sin haberse usado.

El simulador conserva aproximaciones de liquidez y ejecución OHLC descritas en [simulator-audit.md](simulator-audit.md). La primera entrada del backtester limita tamaño con volumen previo; onCandle todavía usa volumen completo de vela para capacidad, incluidos posibles pendientes de apertura. Por tanto no se certifica ausencia total de anticipación en liquidez. No se reconstruyeron libros, ticks, cola, filtros/tarifas históricos ni mejoras reales de ejecución. Los controles de señales evitan esa capacidad al estudiar retornos de precios y etiquetan los costos como modelados. No se corrigió el simulador en esta etapa.`;
const entry=`# Diagnóstico de señales de entrada btc-v2

## Resultado principal

En ${raw(P).n} señales de siete meses, el retorno medio del mercado a 60m fue ${n(raw(P).meanGrossPct)} %, IC95 [${n(raw(P).grossCI95LowPct)}, ${n(raw(P).grossCI95HighPct)}]. Tras compra/venta de mercado modeladas fue ${n(raw(P).meanNetPct)} %, IC95 [${n(raw(P).netCI95LowPct)}, ${n(raw(P).netCI95HighPct)}]. No aparece una ventaja predictiva neta frente a controles de tendencia comparables. Las entradas están más arriba del rango reciente, pero la hipótesis específica de histograma agotándose no queda confirmada.

${common}

## Universo, períodos y regímenes

${table(['Período','Uso previo','Señales BUY','Cerradas con stops/reglas','P&L estrategia USDT','Retorno bruto 60m %','Neto hold 60m %'],s.periods.map(p=>[p.period,p.previousSplit,p.signals,p.baselineMetrics.closedTrades,n(p.baselineMetrics.netRealizedPnl),n(raw(p.period).meanGrossPct),n(raw(p.period).meanNetPct)]))}

Son 805 señales en total: 28 originales y 777 ampliadas. En la ampliada se ejecutaron 767 posiciones, 155 ganadoras y 612 perdedoras. Las diez señales restantes no son pérdidas ni ganancias ejecutadas. La admisión y los fills aparecen en entry-signal-analysis.csv. Mes alcista: febrero 2024; bajista: junio 2022; lateral/baja variación relativa: julio/septiembre 2023; alta volatilidad: marzo 2020. Sus retornos y volatilidades observados están en [strategy-diagnostics.md](strategy-diagnostics.md). Son ventanas seleccionadas, no una historia continua. La agregación pesa señales, no meses iguales ni capital compuesto.

## Por qué se compra y reconstrucción original

Se exige tendencia EMA12>EMA26, SMA9>SMA21 y precio>SMA50 en 1h; confirmación MACD>señal y SMA9>SMA21 en 5m; RSI 35–65, histograma positivo, vela verde/engulfing, volumen >1,2×SMA10 y precio>0,995×SMA21 en 1m. El objetivo debe superar costos nominales. Una confluencia de esas reglas no estima por sí sola una probabilidad calibrada de ganar.

../reports/entry-signal-analysis.csv conserva una fila por cada BUY emitido: RSI, MACD/señal/histograma, SMA/EMA 1m/5m/1h, ATR, volatilidad de retornos 30m, volumen, pendientes de medias, distancias a máximos/mínimos de 20/50/100 velas, retornos anteriores 5/15/30/60m, racha verde, posición de RSI frente a sus 20 lecturas anteriores y evolución de histograma en cinco minutos. Los máximos previos incluyen la vela de señal ya cerrada. La posición RSI puede quedar fuera de [0,1] si supera su rango previo. Volumen relativo incluye la vela cerrada en SMA10, igual que producción.

Las 28 ventanas originales completas están en ../reports/signal-research-v1/2025-01-original/original-28-windows.json. Cada una incluye señal, apertura siguiente y OHLC/features causales por minuto desde −120 hasta +120 respecto de entrada (241 velas si hay cobertura completa). Las features de la parte posterior están etiquetadas como investigación y nunca alimentan el backtester. El replay mantiene exactamente las 28 salidas STOP_LOSS y −3,1064573288 USDT.

## Movimiento posterior sin stops

${table(['Horizonte min','N ampliada','Media bruta %','Mediana bruta %','SD bruta %','Media neta %','IC95 neto %','MFE medio %','MAE medio %'],[5,15,30,60,120,240].map(h=>{const r=raw(P,h);return[h,r.n,n(r.meanGrossPct),n(r.medianGrossPct),n(r.sdGrossPct),n(r.meanNetPct),'['+n(r.netCI95LowPct)+', '+n(r.netCI95HighPct)+']',n(r.meanMfePct),n(r.meanMaePct)]}))}

${table(['Umbral','Prob. alcanzar en 60m','Prob. alcanzar en 240m'],[...Object.keys(raw(P)).filter(k=>k.startsWith('hit')).map(k=>[k,pct(raw(P)[k])+' %',pct(raw(P,240)[k])+' %'])])}

Las probabilidades son frecuencias empíricas entre horizontes completos, no probabilidades calibradas ni orden de llegada de barreras. Pueden tocarse ambos lados; no se suman como eventos excluyentes. El CSV de controles conserva todos los horizontes y datos por período. En las 28 originales, el bruto medio a 60m fue ${n(raw(O).meanGrossPct)} % y el neto ${n(raw(O).meanNetPct)} %. Todos esos 28 holds netos de 60m fueron negativos. No implica que todos los horizontes o recorridos posibles fueran negativos.

## Controles definidos antes de observar resultados

A: minutos aleatorios del mismo período sin igualar régimen. B: minutos de tendencia 1h alcista. C: tendencia 1h alcista pero confluencia incompleta. D: transición de tendencia 1h alcista y retorno previo 15m >0,2 %. E: transición de tendencia 1h alcista, precio<SMA21 y retorno previo 5m<0. D/E son reglas de control, sin optimización ni cartera alternativa implementada.

Para B/C/D/E se buscan hasta cinco controles por caso sin reemplazo dentro del caso, permitiendo reutilización entre casos. Se igualan período, día UTC, bloque horario de cuatro horas, bucket ATR/precio (<0,05 %, 0,05–0,1 %, 0,1–0,2 %, 0,2–0,4 %, >=0,4 %) y primaryTrend. Fallback prefijado: relajar horario, luego día manteniendo horario, finalmente día y horario, conservando siempre régimen y bucket de volatilidad. El CSV informa nivel y cobertura. B/C tuvieron emparejamiento exacto nivel 0 en los 777 casos a 60m. La disponibilidad de resultados futuros nunca decide qué controles se seleccionan.

${table(['Control','Casos emparejados','Controles únicos','Neto control 60m %','BTC menos control pp','IC95 diferencia pp','p Holm 30'],['A-random','B-uptrend','C-trend-incomplete','D-momentum','E-pullback'].map(g=>{const r=pair(P,g);return[g,r.n,r.uniqueObservations,n(r.meanNetPct),n(r.deltaNetPct),'['+n(r.deltaCI95LowPct)+', '+n(r.deltaCI95HighPct)+']',n(r.deltaHolmP30Contrasts,3)]}))}

La fila case-weighted-matched usa el promedio de controles por señal: cada caso pesa una vez. Unique-controls muestra la distribución de controles distintos y raw las reglas completas/componentes; no confundir sus medianas y dispersiones, pues promediar cinco controles reduce dispersión mecánicamente. La diferencia primaria C fue ${n(primary.deltaNetPct)} pp: peor en la muestra, IC95 sin ajustar [${n(primary.deltaCI95LowPct)}, ${n(primary.deltaCI95HighPct)}], p centrada bootstrap ${n(primary.deltaBootstrapCenteredP,3)}, Holm ${n(primary.deltaHolmP30Contrasts,3)}. No alcanza para afirmar inferioridad robusta tras todas las comparaciones, y tampoco aporta evidencia de superioridad. Con bloques de cinco días el intervalo es [${n(s.blockSensitivity.find(r=>r.period===P).low)}, ${n(s.blockSensitivity.find(r=>r.period===P).high)}] pp, todavía exploratorio.

${uncertainty}

## ¿Se compra tarde o con impulso agotado?

${table(['Feature previa','BTC media','Control B media','Diferencia','IC95 diferencia'],['prior5Pct','prior15Pct','prior30Pct','prior60Pct','distanceHigh20Pct','distanceHigh50Pct','distanceHigh100Pct','rangePosition100','histogramDelta5','lateExhaustion'].map(k=>{const r=feature(P,k);return[k,n(r.caseMean),n(r.controlMean),n(r.difference),'['+n(r.low)+', '+n(r.high)+']']}))}

Se compra después de más suba previa y más cerca del techo relativo: posición media en rango de 100m ${n(feature(P,'rangePosition100').caseMean,3)} frente a ${n(feature(P,'rangePosition100').controlMean,3)}. Hay 541/777 señales en el quinto superior del rango. Eso describe entradas extendidas; no demuestra que el máximo esté formado ni identifica causalmente el motivo de la pérdida.

La hipótesis prefijada de agotamiento requiere simultáneamente posición>=0,8, retorno previo 15m positivo e histograma menor que cinco minutos antes. Ocurre en ${pct(feature(P,'lateExhaustion').caseMean)} % frente a ${pct(feature(P,'lateExhaustion').controlMean)} % de controles B; la diferencia y su intervalo incluyen cero. El histograma, en promedio, venía aumentando, no decayendo. En las 28 originales fueron 5/28 frente a un promedio de controles de ${pct(feature(O,'lateExhaustion').controlMean)} %, con intervalo también incluyendo cero. Por tanto no se confirma «comprar cuando el histograma ya se agota» como explicación general. Sí queda respaldada parcialmente la hipótesis de entrada tras un impulso ya avanzado y sin continuación neta suficiente.

## Indicadores y redundancia

${table(['Componente aislado','N completo 60m','Media bruta %','Media neta %'],s.comparison.filter(r=>r.period===P&&r.horizonMinutes===60&&r.group.startsWith('component')).map(r=>[r.group,r.n,n(r.meanGrossPct),n(r.meanNetPct)]))}

Cada componente toma hasta 1.000 minutos por mes, con semilla fija, seleccionados antes de medir futuro. No son señales independientes ni estrategias completas. Los grupos no igualan todos los demás filtros y meses tienen pesos distintos a la muestra de BUY: no se pueden ordenar estas medias como importancia causal.

${table(['Features continuas','N observado','Pearson'],s.continuousCorrelation.filter(r=>r.period===P).map(r=>[r.features.join(' / '),r.n,n(r.pearson,3)]))}

Se normalizan distancias precio/media y pendientes, evitando correlacionar sólo niveles de precio entre años. La correlación continua se calcula sobre observaciones únicas seleccionadas, no sobre todo el mercado. Los booleanos de filtros tienen correlaciones phi mucho menores (máxima absoluta fuera de diagonal aproximadamente 0,136 en 299.242 minutos ampliados): correlación continua alta no significa que los filtros binarios sean idénticos. Cinco señales alcistas no representan cinco evidencias independientes.

En la auditoría previa, quitar tendencia 1h, confirmación 5m, RSI, histograma, volumen o vela aumentó las pérdidas agregadas, y quitar structure no cambió A en las ventanas estudiadas. Esas ablaciones se conservan en ../reports/strategy-comparison.csv; cambian admisión, número de trades y transiciones, por lo que no prueban un efecto causal rentable del indicador. SMA21 es redundante en las señales observadas, no universalmente inútil. Ningún componente aislado demuestra rentabilidad neta.

## Mejores y peores entradas: descripción, no regla nueva

${table(['Grupo ejecutado ampliado','N','ATR/precio %','RSI','Volumen / SMA10','Retorno previo 15m %','Posición rango100'],ranks.map(r=>[r.label,r.n,n(r.features.atrPct),n(r.features.rsi,2),n(r.features.volumeRatio,3),n(r.features.prior15Pct),n(r.features.rangePosition100,3)]))}

Las 155 ganadoras tenían más volatilidad ATR y pendientes/impulso previo que las 612 perdedoras, en promedio. No aparece una separación simple por RSI: ambas rondan 58–59. Las medias de volumen tampoco separan limpiamente y el análisis por buckets no es monótono. Las descripciones top/bottom de retorno 60m y todos los buckets prefijados están en strategy-research-summary.json y signal-research-v1/feature-buckets.csv. El alias priorReturn15Pct del plan se corresponde con la columna prior15Pct; sólo se resolvió el nombre, sin cambiar cortes. Seleccionar ganadoras a posteriori sirve para describir, no valida esos rasgos como filtros. Regímenes y estructura de TP/SL pueden explicar parte de la asociación ATR/ganar.

## Método y límites

${method}

${limits}

Reproducción: npm.cmd run build; node scripts/signal-research/run.cjs; node scripts/signal-research/aggregate.cjs; node scripts/signal-research/report.cjs. El runner conserva extracciones completas existentes; para una repetición independiente usar una copia del repositorio/directorio de salida, sin borrar reportes previos. Repetir con la misma fuente/plan/semilla debe conservar hashes de resultados. Tests: test/v2/signal-research.spec.ts. Verificación independiente de CSV y archivos protegidos: scripts/signal-research/verify.py y verify.cjs.
`;
fs.writeFileSync('docs/entry-signal-diagnostics.md',entry);
const stops=`# Diagnóstico de stop-loss btc-v2

## Conclusión

Los stops explican el momento de realización de muchas pérdidas, pero no demuestran que eliminarlos recupere rentabilidad. En las 28 originales, ${original.within5m}/28 (${n(original.within5mPct,2)} %) cerraron dentro de los primeros cinco minutos y ${original.stopAtOrAboveNextOpen}/28 tenían el stop al nivel o por encima de la apertura de mercado tras reanclarlo al precio de compra con costos. Eso expone una incompatibilidad concreta entre costo de entrada y distancia de protección, sin necesitar un retroceso del precio para tocar algunos stops.

${common}

## Distribución y escala de volatilidad

${table(['Muestra','Stops','<=5m','Stop mediano %','Stop/ATR mediano','Tiempo mediano máximo min','MFE mediano superior previo %','Stop >= apertura'],s.stopSummaries.map(r=>[r.period,r.n,n(r.within5mPct,2)+' %',n(r.stopPct.median),n(r.stopATR.median,3),n(r.timeToStopUpper.median,2),n(r.mfeBeforeStopUpper.median),r.stopAtOrAboveNextOpen]))}

En originales el stop mediano estándar es ${n(original.stopPct.median)} %, con ${n(original.stopATR.median,3)} ATR de 1m. Aquí se interpola linealmente el cuantil 50; la auditoría anterior usó observación central inferior (0,102965 % y 3,5865 ATR). Es una diferencia de definición estadística, no de operaciones ni de reglas. No son stops universalmente inferiores a 1 ATR. Un ATR de minuto no mide el riesgo de mantener durante una hora o un día, así que tampoco demuestra que esos stops sean adecuados para esos horizontes.

La fila original tiene MFE superior mediano antes de stop ${n(original.mfeBeforeStopUpper.median)} %, frente a movimiento bruto necesario de aproximadamente 0,2804 % para entrar y salir a mercado. ${original.preStopMfeBelowMarketBreakEven}/28 ni siquiera alcanzan ese umbral usando el máximo superior OHLC antes del stop. Ese máximo puede incluir precios posteriores al fill dentro de la vela de salida; es un límite favorable, no un precio capturable.

No se confirma estadísticamente que cada stop sea «un retroceso normal»: necesitaríamos definir normalidad por escala y comparar trayectorias/riesgo condicional. Lo que sí se verifica es que la protección es pequeña en porcentaje frente al costo y frente a excursiones de horizontes mayores, y que ampliar ATR no mejoró consistentemente la auditoría previa. No se propone eliminar stops ni subir su distancia para fabricar una mejora.

## Qué ocurrió después de cerrar

Se comienza en la primera vela completa posterior al cierre registrado. No se utiliza el resto desconocido de la vela donde tocó el stop. El tiempo real del toque se expresa entre apertura y cierre de esa vela; el timestamp del simulador es su cierre de procesamiento. Los 1/2/4/8/24h siguientes son horizontes acotados, con censura explícita por huecos/final del dataset.

${table(['Horas posteriores','Originales completos','TP posterior','Proporción completos','Censurados','Mediana caída extra completa %','Mediana caída extra ANTES de TP %'],original.hours.map(r=>{const risk=s.riskBeforeTpSummary.find(x=>x.period===O).hours.find(x=>x.hours===r.hours);return[r.hours,r.complete,r.tpHits,n(r.tpHitPctComplete,2)+' %',r.censored,n(r.additionalAdversePct.median),risk.nReached?n(risk.extraRiskBeforeTpLowerPct.median)+' a '+n(risk.extraRiskBeforeTpUpperPct.median):'n/d']}))}

Dentro de 24h hay siete TP observados entre 21 casos con cobertura completa; siete casos adicionales están censurados. 7/21 no se debe presentar como probabilidad de recuperación de los 28: el denominador censurado importa y no se modeló una cartera que siguiera abierta. Entre los siete que sí llegaron al TP, la caída adicional mediana antes de alcanzarlo fue aproximadamente ${n(s.riskBeforeTpSummary.find(x=>x.period===O).hours.at(-1).extraRiskBeforeTpLowerPct.median)} puntos porcentuales del precio de entrada, además de la protección inicial. Los intervalos antes de TP excluyen mínimos de velas posteriores al target; si el mínimo de la propia vela de TP tiene orden desconocido, se publica límite inferior/superior. La caída máxima del horizonte completo es otra métrica y puede ocurrir después del TP.

${table(['Muestra ampliada','N','<=5m','TP después 1h / completos','2h','4h','8h','24h'],[[P,expanded.n,n(expanded.within5mPct,2)+' %',...expanded.hours.map(h=>h.tpHits+'/'+h.complete)]] )}

El CSV ../reports/stop-loss-analysis.csv tiene 638 stops (28 originales y 610 ampliados): stop inicial, ATR, tiempo de toque acotado, MFE previo inferior/superior, máximos/mínimos posteriores, retorno desde la salida, TP posterior por horizonte, censura, y riesgo adicional antes de TP y durante todo el hold. Es análisis contrafactual condicionado a haber perdido; no reemplaza el estudio de todas las señales ni cuantifica rentabilidad obtenible sin stops.

## Costos, break-even y margen

${table(['Componente original','USDT'],[['P&L observado',n(cost.netPnl,8)],['Comisiones compra+venta',n(cost.fees,8)],['Spread',n(cost.spread,8)],['Slippage',n(cost.slippage,8)],['Redondeo',n(cost.rounding,8)],['P&L sumando comisiones al neto',n(cost.grossExecutedPnl,8)],['P&L con referencias de fills, sin fricciones contables',n(cost.fixedFillRawReferencePnl,8)]] )}

En los 28 casos, las comisiones equivalen al 53,26 % de la pérdida observada y ejecución/redondeo al 21,30 %. Incluso la descomposición a referencias deja −0,79027291 USDT. Es identidad sobre fills y trayectoria fijos, no resultado de volver a ejecutar otra estrategia sin costos: los costos también afectan stop reanclado, cantidad y órdenes futuras. No restar spread/slippage otra vez al neto.

Se usa cantidad real y costo de compra incluido fee. El mínimo precio SELL ejecutado se calcula como ceil_tick(costoCompra / (cantidadBTC × (1−feeSELL))). Para mercado se exige además una referencia tal que el precio tras spread/2+slippage y floor_tick alcance ese mínimo. Se prueba con el adaptador que ese tick es no negativo y uno inferior pierde. Para TP LIMIT no se carga spread/slippage de salida según el simulador; no se promete ese fill en Binance. El movimiento mediano desde la apertura bruta es ${n(original.breakEvenMarketMovePct.median)} % con salida MARKET y ${n(original.breakEvenLimitMovePct.median)} % con salida LIMIT. No basta un movimiento de 0,2 % bruto para cubrir el circuito completo actual.

Cada fila conserva costo total de compra, fee/impacto de entrada y salida por separado, resultado bruto a precios ejecutados, resultado neto y margen superior antes del stop. entry-signal-analysis.csv añade headroom MFE menos break-even por horizonte: son puntos porcentuales de referencia, sin asumir salida en el máximo.

${table(['Sensibilidad hold 60m ampliado','N','Media neta %','IC95 %'],s.costSensitivity.filter(r=>r.period===P).map(r=>[r.scenario,r.n,n(r.meanNetPct),'['+n(r.low)+', '+n(r.high)+']']))}

Todas las sensibilidades son hipotéticas. No se afirma que existan esas comisiones ni que se pueda conseguir slippage cero. Cambiar sólo costos en un hold acotado no valida la estrategia con stops.

## Límites

${uncertainty}

${limits}
`;
fs.writeFileSync('docs/stop-loss-diagnostics.md',stops);
const root=`# Causas de pérdidas btc-v2

## Dictamen

Conservar btc-v2 como referencia experimental bloqueada, no como estrategia aprobada. La evidencia identifica fricciones demasiado grandes frente al movimiento posterior medio, ausencia de ventaja neta demostrada y una geometría de stop que puede quedar del lado equivocado de la apertura tras pagar ejecución. No hay una única causa que se resuelva ampliando el stop.

${common}

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

${table(['Pregunta','Respuesta respaldada','Muestra y referencia'],[
 ['1. ¿Por qué pierde?','Movimiento posterior insuficiente para fricciones y salidas sin ventaja neta acreditada; seis stops originales ya cruzados frente a apertura.','28 originales +777 señales; entry-signal-diagnostics.md y stop-loss-diagnostics.md'],
 ['2. ¿Compra demasiado tarde?','Compra más arriba del rango y tras más suba previa. No se confirma agotamiento del histograma ni causalidad de comprar tarde.','777 pares con controles B; feature-control-comparison.csv'],
 ['3. ¿Predice subidas?','Media bruta 60m +0,0354 %, IC95 [−0,0294,+0,1002]; neto −0,2443 %. No hay ventaja neta demostrada frente C.','777 señales, 123 días; signal-control-comparison.csv'],
 ['4. ¿Stop demasiado ajustado?','Pequeño frente a costos en parte de la muestra, no universalmente pequeño en ATR. Nueve de 28 duran <=5m y seis tienen stop >= apertura.','28 originales y 610 stops ampliados; stop-loss-analysis.csv'],
 ['5. ¿Cuánto son costos?','Original: 1,65436 USDT de comisiones y 0,66182 de ejecución, 53,26 % y 21,30 % de pérdida a fills fijos.','28 originales; strategy-research-summary.json strategyCosts'],
 ['6. ¿Qué indicadores ayudan?','Ninguno demuestra rentabilidad neta aislada. Ablaciones previas empeoran al quitar varios filtros; structure no cambia A. Hay alta correlación continua SMA/EMA.','Muestra de componentes y ablaciones previas; entry-signal-diagnostics.md'],
 ['7. ¿Mejores entradas?','155 ganadoras: ATR/precio medio 0,1229 %, impulso previo 15m +0,2110 %, RSI 59,12. Descriptivo, no regla validada.','Siete períodos, ranking actual-winning-trades'],
 ['8. ¿Peores entradas?','612 perdedoras: ATR/precio 0,0731 %, impulso previo +0,1201 %, RSI 58,03. Volumen y proximidad a máximos no separan limpiamente.','Siete períodos, ranking actual-losing-trades'],
 ['9. ¿Conservar btc-v2?','Como baseline de investigación pausado; sin evidencia suficiente para habilitar entradas. No borrar su historial.','767 cierres ampliados, todos los meses negativos; períodos ya observados'],
 ['10. ¿Qué estudiar en v3?','Abstención económica, predicción condicional frente a controles, geometría de stop/precio y señales menos redundantes, con validación nueva.','Hipótesis siguientes, sin implementación ni optimización']
 ])}

Las características de mejores/peores están condicionadas al resultado observado y mezclan regímenes. No son predictores validados. La comparación completa y buckets prefijados se conservan, incluidos los negativos y con pocos datos.

## Próximas hipótesis verificables para una futura v3

1. Estimar si el movimiento favorable condicional y su incertidumbre superan el break-even por tipo de orden. Comparar una política de abstención con cash y controles, con límites fijados en desarrollo y sin búsqueda sobre la prueba nueva.
2. Investigar si la distancia de protección y el precio de entrada de referencia pueden representar el riesgo deseado después de costos. Probar escenarios donde el stop queda sobre la apertura, sin ocultar pérdidas ni eliminar protección.
3. Evaluar continuación y retroceso en el mismo régimen/volatilidad/horario. D/E ya definidos aquí son controles, no ganadores seleccionados. Exigir mejora frente a C y estabilidad por período con costos completos.
4. Probar información incremental de cada familia de señales, con validación temporal purgada/embargada según horizonte y controles de dependencia. Reducir redundancia no garantiza ventaja; medirla.
5. Separar predicción de entrada, horizonte, supervivencia al stop y decisión de salida. Medir pérdidas adicionales antes de TP, no sólo recuperación posterior. Reservar marzo/abril 2025 o un tramo prospectivo todavía intacto antes de elegir parámetros.

Ninguna de estas hipótesis se implementó. No se eligió TP, ATR, filtro o costo por mejor resultado. No hay aprobación nueva ni sugerencia de operar BTC con dinero real.

## Reproducibilidad, validación y preguntas abiertas

${method}

${uncertainty}

${limits}

Los entregables son entry-signal-analysis.csv (805 filas), signal-control-comparison.csv (1.080 filas), stop-loss-analysis.csv (638 filas) y strategy-research-summary.json, además de los tres informes. Los JSON por período conservan selección de controles por ID, resultados individuales y replays de cartera para verificar los agregados sin regenerar indicadores. Los archivos adicionales control-observations.csv, feature-buckets.csv, feature-control-comparison.csv e indicator-correlation.csv permiten inspección independiente. No incluyen credenciales.

Pruebas nuevas: horizontes y retornos exactos, MFE/MAE y límites temporales, censura por hueco/final, semillas reproducibles, selección de controles invariante a resultados futuros, comparación pareada con censura, agregación cerrada 1m/5m/1h y prefijo de señales invariante a cambios futuros, break-even tick por tipo de orden y riesgo antes del primer TP. Se ejecutaron suite relevante, typecheck y build; los resultados exactos quedan en ../reports/signal-research-v1/tests.json y all-tests.json y la conciliación final en verification.json. No se verificaron ticks/libro reales, disponibilidad de tarifas, equivalencia de liquidez ni ventaja fuera de muestra nueva. No se detectó un nuevo error de implementación que autorice corregir producción en esta etapa.
`;
fs.writeFileSync('docs/strategy-root-cause.md',root);
console.log('Generated entry, stop and root-cause research documents');
