const fs=require('fs'),crypto=require('crypto'),path=require('path');
const {csv}=require('../signal-research/math.cjs');
const root='reports/btc-v3',rows=[...JSON.parse(fs.readFileSync(root+'/comparison-observed.json')),...JSON.parse(fs.readFileSync(root+'/comparison-final.json'))];
const freeze=JSON.parse(fs.readFileSync(root+'/candidate-freeze.json')),model=JSON.parse(fs.readFileSync(root+'/calibration-final.json')),labels=JSON.parse(fs.readFileSync(root+'/calibration-records.json'));
const variants=[...new Set(rows.map(r=>r.variant))],n=(v,d=4)=>v==null?'n/d':Number(v).toFixed(d);
const table=(hs,rs)=>['| '+hs.join(' | ')+' |','|'+hs.map(()=>'---').join('|')+'|',...rs.map(r=>'| '+r.join(' | ')+' |')].join('\n');
const final=rows.filter(r=>r.split==='new-final-oos'),original=rows.filter(r=>r.period==='2025-01-original');
const risk=[],rejected=[],aggregates=[];
for(const r of rows.filter(r=>r.variant!=='USDT-cash')){
 const dir=r.split==='new-final-oos'?'final-oos':'observed',report=JSON.parse(fs.readFileSync(`${root}/${dir}/${r.period}/${r.variant}.json`));
 const activeHolds=report.trades.filter(p=>p.status==='CLOSED').map(p=>(p.closedAt-report.fills.find(f=>f.positionId===p.id&&f.side==='BUY').at)/60000);
 r.averageFilledHoldingMinutes=activeHolds.length?activeHolds.reduce((a,b)=>a+b,0)/activeHolds.length:null;
 for(const o of report.orders.filter(o=>o.executionRisk))risk.push({period:r.period,variant:r.variant,orderId:o.id,signalId:o.signalId,status:o.status,...o.executionRisk});
 for(const d of report.decisions.filter(d=>!d.accepted))rejected.push({period:r.period,variant:r.variant,stage:'RESERVATION',signalId:d.signalId,reason:d.reason,at:d.at});
 for(const o of report.orders.filter(o=>o.status==='REJECTED'))rejected.push({period:r.period,variant:r.variant,stage:'EXECUTION',signalId:o.signalId,orderId:o.id,reason:o.rejection,at:o.executionRisk?.at??o.createdAt});
}
for(const split of ['observed-expanded','original','new-final-oos'])for(const variant of variants){const use=rows.filter(r=>r.variant===variant&&(split==='new-final-oos'?r.split==='new-final-oos':split==='original'?r.period==='2025-01-original':r.split!=='new-final-oos'&&r.period!=='2025-01-original'));aggregates.push({split,variant,periods:use.length,closed:use.reduce((a,r)=>a+r.closedTrades,0),wins:use.reduce((a,r)=>a+r.wins,0),losses:use.reduce((a,r)=>a+r.losses,0),openPositions:use.reduce((a,r)=>a+r.openPositions,0),sumIndependentPeriodNetPnl:use.reduce((a,r)=>a+r.netEquityPnl,0),fees:use.reduce((a,r)=>a+r.totalCommissions,0),worstPeriodDrawdownPct:Math.max(...use.map(r=>r.maxDrawdownPct))})}
fs.writeFileSync(root+'/comparison.csv',csv(rows));fs.writeFileSync(root+'/comparison.json',JSON.stringify(rows,null,2));fs.writeFileSync(root+'/trade-risk-audit.csv',csv(risk));fs.writeFileSync(root+'/rejections.csv',csv(rejected));
const before=JSON.parse(fs.readFileSync(root+'/before.json')),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const modifiedExisting=Object.entries(before.hashes).filter(([p,h])=>fs.existsSync(p)&&hash(p)!==h).map(([p])=>p);
function files(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)])}
const addedFiles=['src/v2','test/v2','scripts/btc-v3','docs'].flatMap(files).map(p=>p.split(path.sep).join('/')).filter(p=>before.hashes[p]===undefined);
const summary={branch:'feature/btc-v3-research-and-fixes',candidateFreezeHash:freeze.freezeHash,calibrationId:model.id,calibrationParametersHash:model.parametersHash,calibrationTrainingRecords:labels.records.length,finalOosEvaluatedOnce:fs.existsSync(root+'/oos-completed.json'),modelQualifiedBins:model.bins.filter(b=>b.samples>=20&&b.days>=5&&b.meanReturnLower95>.0033).length,aggregates,rows,modifiedExistingFiles:modifiedExisting,productionDeploymentPerformed:false,operationalApprovalGranted:false,liveTradingEnabled:false,conclusion:'BTC-V3 abstained: zero trades is not a demonstrated edge or profitability; keep all entries blocked',limitations:['OHLC path ambiguity and prior-volume liquidity proxy are not exchange depth','No real BTC-V3 fills on historical/final samples: execution performance and profitability unvalidated','Sparse high-volatility calibration bucket and coarse conditional bins','Estimated stop risk excludes future gaps and capacity shortages; actual losses may exceed projection','Selection/control evidence from earlier periods is observed, not fresh OOS','Final window is now consumed; future parameter changes need another untouched period']};
fs.writeFileSync(root+'/results-summary.json',JSON.stringify(summary,null,2));
summary.addedImplementationAndDocumentationFiles=addedFiles;
fs.writeFileSync(root+'/results-summary.json',JSON.stringify(summary,null,2));
const rules=`BTC-V3, revisión 2026-11-20.v3.1, es una política experimental long Spot con BUY o NO_TRADE. Los umbrales se fijaron antes de los nuevos resultados en [btc-v3-plan.json](btc-v3-plan.json). No se cambiaron para producir operaciones.

1. Tendencia 1h: EMA12 > EMA26, SMA21 > SMA50, cierre > SMA21 y SMA21 mayor que tres cierres horarios atrás. Se trata como una sola familia de información correlacionada.
2. Pullback 5m: distancia entre el máximo de las doce velas 5m anteriores y el último cierre 5m entre 0,5 y 2,5 ATR5m. La última 5m debe ser verde y cerrar por encima de la anterior.
3. Evitar extensión: posición relativa del precio en el rango de veinte velas 5m <=0,75 y en cien velas 1m <=0,80.
4. Recuperación 1m: vela verde cuyo cierre supera el máximo de la anterior. No se añaden votos RSI/MACD/volumen para forzar confluencia.
5. Volatilidad: ATR5m/precio entre 0,1 % y 1,5 %. Se abstiene con datos incompletos, huecos o desalineación temporal. Todas las barras son cerradas y causales.
6. Stop absoluto: menor entre mínimo de las últimas seis velas 5m menos 0,1 ATR5m y precio de señal menos 1,5 ATR5m. Target: precio de señal +2 ATR5m. Máxima distancia de stop 2 %, permanencia máxima 60 minutos y riesgo neto estimado por operación 0,5 % del equity con configuración V3 por defecto. El objetivo configurado no se usa como pronóstico de alcanzarlo.
7. Economía calibrada: bucket de ATR5m con al menos veinte muestras de sesenta minutos sin solapamiento y cinco días distintos; límite inferior del IC95 del retorno bruto esperado y cuantil 25 de MFE deben superar el break-even MARKET completo más 0,05 puntos porcentuales. MFE es potencial retrospectivo de calibración, no P&L realizable. No se usa sólo la volatilidad o el TP como supuesto de ganancia.

El stop usa estructura 5m de media hora y ATR5m, en lugar de reutilizar ATR1m para una hora. Los multiplicadores son una hipótesis previa, no valores óptimos ni una escala de riesgo demostrada. Se mantienen presupuesto, máximo de posiciones, reservas atómicas, límites de exposición/pérdida diaria, protección obligatoria y prohibición de aumentar exposición mientras hay BTC adquirido por encima de la referencia actual.

La estrategia emite una decisión global de mercado; RiskPolicy toma la decisión personal según capital/slots y el ejecutor vuelve a validar geometría y pérdida neta antes del fill. Una reserva aceptada no significa una compra ejecutada. Las órdenes rechazadas conservan motivo y proyección de riesgo. El precio real/proxy de ejecución puede cancelar una oportunidad anterior sin mover su stop para aceptarla.`;
const calibration=`Se reutilizaron cinco períodos observados de desarrollo: marzo 2020, junio 2022, julio/septiembre 2023 y febrero 2024. Se recogieron ${labels.records.length} labels estructurales de 60m completos, sin solapamiento dentro de cada período. Para evaluar cada período histórico, la calibración sólo usa labels ya terminados antes de su inicio. La primera ventana no tiene historial de calibración suficiente y se abstiene. El modelo final sólo usa esos cinco meses, nunca octubre 2024, enero/febrero 2025 ni el nuevo marzo 2025.

${table(['ATR5m/precio %','N','Días','Retorno bruto medio 60m %','IC95 inferior %','MFE p25 %'],model.bins.map(b=>[n(b.low*100,2)+'–'+n(b.high*100,2),b.samples,b.days,n(b.meanReturn*100),n(b.meanReturnLower95*100),n(b.mfeP25*100)]))}

Hay cuatro buckets prefijados. Ninguno demuestra economía suficiente: los límites inferiores son negativos y el bucket superior tiene sólo quince muestras. Por eso el modelo real no habilita BUY. El modelo se vincula por hash a todos los parámetros y al horizonte; cambiar un umbral o el horizonte exige recalibrar, no reutilizar silenciosamente esos números. El archivo y su SHA256 se cargan explícitamente en el servidor, nunca desde forecasts enviados por un cliente HTTP. Falta de modelo, entrenamiento no anterior, parámetros distintos o muestras insuficientes producen NO_TRADE.`;
fs.writeFileSync('docs/btc-v3-strategy.md',`# Estrategia experimental BTC-V3

${rules}

## Calibración y configuración

${calibration}

Los valores están en src/v2/strategy/btc-v3.config.ts. El backtest admite btcV3 con validación de claves, versión y rangos. El worker admite V3_PARAMETERS_JSON y un V3_CALIBRATION_FILE cuyo SHA256 debe coincidir con V3_CALIBRATION_SHA256; sin modelo se abstiene. La configuración y el modelo completo entran en el hash de aprobación. V2_STRATEGY sigue en btc-v2 en el archivo operativo, sin habilitación de entradas ni cambio automático de estrategia.

Swagger publica versiones/configuración, estado de aprobación, decisión reciente, proyección de riesgo y metadatos de liquidez. No admite subir calibración ni aprobar por campos de un backtest. Aprobar requiere revisión administrativa explícita y luego opt-in de cada cuenta; nada de eso se ejecutó aquí.

Se preservaron las condiciones, fórmulas y revisión btc-v2. La comparación de 10.080 velas originales verificó 31 minutos elegibles con señales idénticas respecto del código archivado. El nuevo motor puede rechazar reservas/fills que antes admitía, lo que cambia resultados sin cambiar las reglas técnicas de entrada V2.
`);
fs.writeFileSync('docs/simulator-fixes.md',`# Correcciones del simulador

Revisión anterior: paper-2026-11-20.audit-1. Revisión nueva: paper-2026-11-20.causal-2. Rama feature/btc-v3-research-and-fixes. Se preservaron 165 archivos con los cambios locales antes de crear la rama; la ruta del respaldo está en ../reports/btc-v3/before.json. El runtime compilado anterior se conserva bajo ../reports/btc-v3/previous-runtime/ con hashes, sin reemplazar datasets ni reportes anteriores.

## Evidencia previa y corrección de stops

../reports/btc-v3/tests-before.json conserva diez fallos y una comprobación aprobada antes de corregir. Seis fallos reproducen individualmente las protecciones originales ya cruzadas frente a la apertura, otro demuestra falta de revalidación de riesgo, dos demuestran anticipación/ausencia de capacidad causal y otro geometría NaN admitida. Los seis casos están en test/v2/fixtures/invalid-stop-cases.json con el hash del dataset original.

Antes de mutar saldo o confirmar BUY se proyecta el precio adverse redondeado a tick, cantidad a step, cantidad neta si el fee es BTC, costo total adquirido, stop y target, exposición y equity marcados. El stop debe ser finito, positivo y estrictamente inferior al precio ejecutado promedio y a la referencia bruta de ejecución. No se mueve para salvar la operación. Sólo se redondea hacia abajo al tick y se registra precio previo y diferencia; la pérdida adicional por redondeo entra en el chequeo.

Se registran separadamente distancia a referencia, distancia al ejecutado, riesgo bruto desde ambos, pérdida neta estimada al stop, fees de ida/vuelta, impacto de ejecución, remanente no negociable, equity y tope de riesgo. En V3 también se rechaza un target que ya quedó debajo de ejecución o no deja margen neto, y una ventaja estimada que se perdió con el nuevo precio. La pérdida estimada asume fill al stop con costos modelados; no garantiza una pérdida máxima ante gaps o escasez de capacidad.

El rechazo libera sólo reservas pendientes y conserva la orden/motivo. Una compra parcial ya adquirida mantiene cantidad, costo, fill y protección anteriores; no se retrocede la historia. Una posición adquirida con protección inválida conserva inventario visible y encola cierre seguro, diferido si no hay capacidad. Dust se conserva con su costo, sin crear órdenes de venta de cantidad cero. Las compras pendientes se detienen si la cuenta está pausada, el dueño inactivo o la aprobación revocada; las salidas continúan. También se rechazan entradas caducadas y se ordenan estados persistidos por timestamp e ID para asignación estable tras reinicio.

## Liquidez causal compartida

Capacidad BTC del minuto t = volumen de la vela 1m completa t−1 × participationRate (por defecto 0,001). Sólo vale la vela inmediatamente anterior con cierre t−1ms. Si no existe una observación válida, capacidad cero; una orden se difiere o caduca, sin profundidad de libro inventada. Es una aproximación causal conservadora, no prueba de liquidez real de apertura.

La misma bolsa se comparte entre OPEN, INTRABAR y CLOSE y no se recarga con el volumen de la vela actual. El volumen completo actual pasa a ser elegible únicamente para el minuto siguiente. En backtest se pasa un presupuesto mutable único entre la compra de apertura y la supervisión. En operación, un advisory lock PostgreSQL por símbolo/minuto se toma antes del lock de cuenta; dentro de esa misma transacción se suma BTC ya ejecutado de todas las cuentas. Insertar fills, ledger, inbox y actualizar cuenta sucede atómicamente. Un reinicio reconstruye el gasto desde fills persistidos, no desde memoria.

La prioridad entre cuentas usa ID y entre posiciones/órdenes usa tiempo e ID. Rate común operativo y límites individuales pueden reducir la capacidad. Se comparten BUY y SELL en la misma bolsa, sin presuponer dos libros independientes. En tests de contabilidad aislados se permite capacidad numérica explícita; los caminos de backtest/worker usan presupuestos causales. La capacidad por defecto del adaptador es cero.

OPEN usa precio abierto conocido y volumen previo. INTRABAR registra una barrera OHLC inferida al procesar la vela cerrada, con SL primero si ambas se tocan sin orden conocido. CLOSE ejecuta decisiones basadas en cierre. DECISION en el worker usa el último cierre completo como proxy de precio conocido al momento del comando, no una cotización real de libro; se identifica como tal. Los fills intravela conservan marcas de procesamiento y no inventan ticks. Esta aproximación de precio/latencia en operación sigue siendo una limitación.

## Pruebas y efectos medidos

Los nuevos contratos comprueban los seis rechazos históricos, límite neto de riesgo al fill, volumen actual cambiado sin alterar fill de apertura, falta de observación previa, capacidad compartida entre cuentas, gasto reconstruido tras reinicio, parciales rechazados sin borrar inventario, cierre seguro y dust. La integración añade PostgreSQL concurrente y HTTP reales, aprobación pendiente, bloqueo de entradas y cadena Kafka con reinicio/reentrega.

En la semana original, las señales técnicas V2 siguen idénticas. El motor anterior cerró 28 trades por −3,1064573288 USDT; el corregido cerró 20 por −2,3541771367 USDT. En este replay concreto se rechazan cinco en ejecución por STOP_NOT_BELOW_REFERENCE y tres al reservar por AVERAGING_DOWN_BLOCKED. Uno de los seis casos de geometría queda impedido antes de llegar al ejecutor. Las seis pruebas independientes sí ejercitan el guard de ejecución de cada caso. No atribuir esa diferencia de motor a una mejora de BTC-V3.

No se aplicó la migración nueva a la base operativa ni se desplegó nuevo API/worker operativo. La migración aditiva sólo registra las nuevas versiones, sin tocar cuentas/saldos/órdenes; se probó en bases aisladas. Se recuperó Docker y arrancaron sólo las dependencias PostgreSQL/Redis/Kafka para pruebas. Las tres cuentas permanecen pausadas y sin aprobaciones.
`);
fs.writeFileSync('docs/btc-v3-backtesting.md',`# Backtesting BTC-V3

## Diseño y control temporal

Todos los ocho períodos usados anteriormente son observados. Se mantuvo enero 2025 original separado de los siete meses ampliados. Capital 500 USDT por ventana independiente, presupuesto 30 y máximo cinco posiciones. Comisión 0,1 % por lado, spread total 2 bps y slippage 3 bps por ejecución MARKET. Las salidas LIMIT siguen la política del simulador: no slippage/spread adicional sobre su límite. Tick, step y notional son supuestos del modelo, no reconstrucción histórica de filtros.

Se congeló primero el plan, después código/configuración inicial; se hicieron correcciones técnicas registradas en technical-amendments.json y se congeló la candidata ${freeze.freezeHash}. La calibración final ${model.id} quedó fijada antes de descargar marzo 2025. La auditoría verificó que los ocho datasets existentes terminaban antes de marzo 2025 y que no había archivos de marzo/abril. Esto certifica el alcance del repositorio/sesión, no usos externos desconocidos. Abril 2025 no se descargó ni evaluó y permanece reservado.

Marzo 2025 se descargó del archivo público Binance después de congelar la candidata, verificando SHA256 de ZIP publicado. Se reutilizaron tres días conocidos de febrero sólo para calentamiento. El journal oos-started.json impide repetir automáticamente la prueba; oos-completed.json registra una única tanda de cinco referencias/configuraciones fijadas. No se modificaron parámetros después del resultado final. Este tramo ya quedó observado: cambios futuros requieren otro holdout.

## Resultados por período

${table(['Período','Muestra','Variante','Cierres','Ganadoras','Perdedoras','Neto equity USDT','DD %','PF','Abiertas','Inmovilizado USDT'],rows.map(r=>[r.period,r.split,r.variant,r.closedTrades,r.wins,r.losses,n(r.netEquityPnl),n(r.maxDrawdownPct,3),n(r.profitFactor,3),r.openPositions,n(r.capitalImmobilized)]))}

Las sumas entre meses son descriptivas sobre cuentas reiniciadas, no retorno compuesto. No se promedian profit factors ni drawdowns como si formaran una cartera continua. P&L realizado y no realizado se mantienen separados en CSV; no se fuerza liquidación final. Media de duración original incluye desde reserva; averageFilledHoldingMinutes mide desde primer fill real. MFE/MAE son límites superiores usando OHLC de vela de salida, sin precisión de ticks.

## Calibración y abstención

${calibration}

BTC-V3 hizo cero operaciones en las ventanas observadas y en el nuevo holdout. Hay cero ganadoras, cero perdedoras, cero costos y cero posiciones abiertas. PF es indefinido, no infinito; MFE/MAE de trades no tienen muestra. Es abstención económica, no evidencia de rentabilidad ni garantía de que una futura recalibración funcione. La rama BUY se prueba con fixtures sintéticos claramente etiquetados; esos fixtures no son evidencia económica.

## Archivos y reproducción

../reports/btc-v3/comparison.csv y comparison.json tienen 45 filas: ocho ventanas observadas más una final, cinco referencias por ventana. trade-risk-audit.csv conserva evaluaciones al fill y rejections.csv sus motivos. Cada replay completo mantiene órdenes/fills/ledger/equity bajo observed/ o final-oos/. results-summary.json consolida resultados, calibración, hashes y límites. No compartir archivos privados de credenciales que existen fuera de esta carpeta.

Para reproducir desarrollo: npm.cmd run build, node scripts/btc-v3/calibrate.cjs y node scripts/btc-v3/compare.cjs observed, usando snapshots/hashes correctos. El calibrador normal rechaza cambios posteriores al freeze inicial; correcciones técnicas se registran explícitamente antes del final. No sobrescribir el freeze ni borrar el journal para reutilizar el holdout. La repetición del backtest original corregido y la igualdad de señales V2 se verifican aparte sin volver a ejecutar marzo. Se conservaron los reportes anteriores.
`);
fs.writeFileSync('docs/btc-v2-vs-v3.md',`# BTC-V2 frente a BTC-V3

La comparación separa motor y estrategia. BTC-V2 anterior es el runtime archivado audit-1; BTC-V2 corregido usa causal-2 conservando sus señales. BTC-V3 y la referencia de tendencia usan el mismo causal-2, costos, capital y ventanas. La referencia simple requiere EMA12>EMA26 y precio>SMA21 en 1h, en transición de elegibilidad, con riesgo/salidas estándar V2; sólo es una referencia de backtest, no selección operativa.

## Semana original

${table(['Variante','Cierres','G/P','Neto USDT','Motivos de rechazo'],original.map(r=>[r.variant,r.closedTrades,r.wins+'/'+r.losses,n(r.netEquityPnl),r.rejectionReasons]))}

La reducción de pérdida V2 procede de controles de ejecución/riesgo, no de modificar sus indicadores. Se verificaron señales idénticas en 10.080 velas originales. BTC-V3 no generó evidencia de trades rentables: no operó.

## Siete ventanas observadas independientes

${table(['Variante','Cierres','Ganadoras','Perdedoras','Suma neta USDT','Peor DD mensual %'],aggregates.filter(r=>r.split==='observed-expanded').map(r=>[r.variant,r.closed,r.wins,r.losses,n(r.sumIndependentPeriodNetPnl),n(r.worstPeriodDrawdownPct,3)]))}

## Nuevo marzo 2025, candidata congelada

${table(['Variante','Cierres','Ganadoras','Perdedoras','Neto equity USDT','Retorno %','Comisiones','DD %','PF','Abiertas'],final.map(r=>[r.variant,r.closedTrades,r.wins,r.losses,n(r.netEquityPnl),n(r.returnPct,3),n(r.totalCommissions),n(r.maxDrawdownPct,3),n(r.profitFactor,3),r.openPositions]))}

USDT cash no opera y tiene retorno nominal cero bajo esta referencia, sin rendimiento de préstamos ni modelar depeg/counterparty. BTC-V3 igualar cash por abstenerse no acredita ventaja predictiva. Ninguna estrategia operante de esta tanda supera cash. No se concedió aprobación ni se habilitó ninguna cuenta.
`);
fs.writeFileSync('docs/btc-v3-limitations.md',`# Limitaciones y estado de BTC-V3

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
`);
console.log(JSON.stringify({comparisonRows:rows.length,final:final.map(r=>({variant:r.variant,closed:r.closedTrades,wins:r.wins,losses:r.losses,net:r.netEquityPnl})),calibrationLabels:labels.records.length}));
