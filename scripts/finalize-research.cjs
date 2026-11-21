// Presentation and reconciliation only. Never reranks, selects parameters or changes fills.
const fs=require('fs');const assert=require('assert/strict');
const manifest=JSON.parse(fs.readFileSync('reports/research-manifest.json'));
const rows=manifest.flatMap(p=>JSON.parse(fs.readFileSync(`reports/experiments/${p.month}/strategy-comparison.json`)));
assert.equal(rows.length,140);
for(const r of rows){
 if(r.variant==='USDT-cash')Object.assign(r,{configHash:'not-applicable',spreadCost:0,slippageCost:0,roundingCost:0});
 // All first development jobs ended flat, so their closed-fee and all-fee sums agree.
 if(['2020-03','2022-06','2023-07'].includes(r.period))assert.equal(r.openPositions,0);
 assert.ok(Math.abs(r.netEquityPnl-r.netRealizedPnl-r.unrealizedPnl)<1e-8);
 assert.ok(Math.abs(r.returnPct-r.netEquityPnl/5)<1e-8);
}
const keys=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const csv=rs=>[keys.join(','),...rs.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n';
for(const p of manifest){const periodRows=rows.filter(r=>r.period===p.month);assert.equal(periodRows.length,20);fs.writeFileSync(`reports/experiments/${p.month}/strategy-comparison.csv`,csv(periodRows));fs.writeFileSync(`reports/experiments/${p.month}/strategy-comparison.json`,JSON.stringify(periodRows,null,2));}
fs.writeFileSync('reports/strategy-comparison.csv',csv(rows));
fs.writeFileSync('reports/strategy-comparison.json',JSON.stringify(rows,null,2));
const filters=manifest.flatMap(p=>JSON.parse(fs.readFileSync(`reports/experiments/${p.month}/filter-diagnostics.json`)));
fs.writeFileSync('reports/filter-diagnostics.json',JSON.stringify(filters,null,2));
const num=(v,n=4)=>v===null?'n/a':Number(v).toFixed(n);
const table=(heads,rs)=>['| '+heads.join(' | ')+' |','|'+heads.map(()=>'---').join('|')+'|',...rs.map(r=>'| '+r.join(' | ')+' |')].join('\n');
const base=rows.filter(r=>r.variant==='A-current');
const ids=[...new Set(rows.map(r=>r.variant))];
const text=`# Diagnóstico de estrategia BTCUSDT

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

${table(['Mes','Split','BTC mes %','Vol diaria %','Velas de negociación','Huecos'],base.map(r=>[r.period,r.split,num(r.marketReturnPct,2),num(r.marketDailyVolPct,2),r.tradeMinutes,r.gaps]))}

Marzo 2020 representa alta volatilidad observada, junio 2022 caída, febrero 2024 suba; julio/septiembre 2023 son ventanas de menor variación/volatilidad relativa. Son descripciones de estas ventanas, no etiquetas universales. Vol diaria = desviación de retornos log de minuto × raíz(1440), sin anualizar; en marzo el salto entre observaciones separadas por el hueco afecta esa estimación. La clasificación interna de cada operación se conserva por separado en regimeBreakdown: A sólo entra cuando primaryTrend es alcista, aunque el mes completo sea bajista.

Datos originales y checksums en ../reports/research-data/ y ../reports/research-manifest.json. Marzo contiene una vela inválida acortada, conservada en cuarentena; tras excluirla hay 129 minutos ausentes. Se reinician indicadores y señal pendiente al hueco sin fabricar velas; las posiciones siguen supervisándose en la siguiente observación. Otros meses son contiguos. Esto no modifica parámetros del plan y limita lo inferible de marzo. El modo normal sigue rechazando huecos. Fuente y política detalladas en simulator-audit.md.

## A sin modificar: estabilidad por período

${table(['Mes','Cerradas','Neto USDT','Retorno %','DD %','PF','Expectativa USDT','Win %','Comisión','Capital inmovilizado'],base.map(r=>[r.period,r.trades,num(r.netEquityPnl),num(r.returnPct,3),num(r.maxDrawdownPct,3),num(r.profitFactor,3),num(r.expectancy,5),num(r.winRatePct,2),num(r.commissions),num(r.capitalImmobilized)]))}

USDT sin operar tiene P&L, drawdown, costos y capital inmovilizado cero en todos los meses. No se le atribuye rendimiento de préstamos ni riesgo de mercado BTC. PF no definido por no tener operaciones. Es una referencia nominal sin modelar riesgo de contraparte, depeg o costo de oportunidad.

## Comparaciones controladas

19 variantes únicas y una referencia cash por mes: 140 filas en ../reports/strategy-comparison.csv. Cada fila informa variable cambiada, hashes, retorno, drawdown, PF, expectativa, win rate, costos, MFE/MAE superiores, operaciones, exposición y regímenes.

B/C/D reemplazan el modelo de stop de estructura por ATR_ONLY y varían sólo el multiplicador dentro de esa familia. La distancia se calcula con ATR/precio de señal y se reancla proporcionalmente al precio ejecutado, igual que el mecanismo original; por ello el múltiplo efectivo sobre ATR puede diferir por costos/gap. E cambia sólo TP a 0,6/0,8/1,2 %; TP 1 % coincide con A. F quita sólo confirmación 5m y mantiene tendencia 1h; G (1h+5m) coincide con A. H evalúa quitar tiempo y quitar invalidación por separado: A ya tiene ambas. Las ablaciones quitan un filtro por vez. Las contrafactuales de costo no son configuraciones operables con costos garantizados en cero.

${table(['Variante','Desarrollo suma USDT¹','Validación USDT','OOS USDT','OOS DD %','OOS PF','OOS cierres'],ids.map(id=>{const group=rows.filter(r=>r.variant===id);const o=group.find(r=>r.split==='final-oos');return[id,num(group.filter(r=>r.split==='development').reduce((s,r)=>s+r.netEquityPnl,0)),num(group.find(r=>r.split==='validation').netEquityPnl),num(o.netEquityPnl),num(o.maxDrawdownPct,3),num(o.profitFactor,3),o.trades]}))}

¹ Suma descriptiva de cinco cuentas mensuales reiniciadas. No es rentabilidad compuesta ni se usa para seleccionar ganador. El OOS ya queda observado: cualquier cambio nuevo necesita otro tramo intacto o validación prospectiva.

## Filtros y costos

La tabla compara cada ablación con A sin alterar el resto. Más operaciones o menos pérdida histórica no demuestran un filtro causalmente rentable. Los filtros están correlacionados y modificar uno cambia las transiciones de elegibilidad, reservas y entradas siguientes.

${table(['Filtro quitado','Cierres desarrollo','Neto desarrollo USDT¹','Cierres OOS','Neto OOS USDT'],['A-current','ablate-primary','F-1h-only','ablate-rsi','ablate-macd','ablate-volume','ablate-candle','ablate-structure'].map(id=>{const g=rows.filter(r=>r.variant===id);const d=g.filter(r=>r.split==='development');const o=g.find(r=>r.split==='final-oos');return[id,d.reduce((s,r)=>s+r.trades,0),num(d.reduce((s,r)=>s+r.netEquityPnl,0)),o.trades,num(o.netEquityPnl)]}))}

Los conteos de pass/fail de cada condición, antes de la combinación, están en ../reports/filter-diagnostics.json. rsiEntry y macdEntry son las condiciones efectivas de entrada; rsi/momentum heredadas son diagnósticas. Quitar structure no cambia A en estas ventanas si ya queda satisfecha por otras condiciones: no equivale a demostrar que nunca importe. F conserva calentamiento 5m aunque no lo exige para elegibilidad; con tres días previos no cambia el inicio del período contiguo.

Los costos contrafactuales se simulan nuevamente. Su diferencia con A no es sólo una resta contable: cambiar precios puede cambiar stops, cantidades y operaciones posteriores. grossPnlClosedPlusFees suma las comisiones de posiciones cerradas al resultado realizado de esas posiciones; aún incluye spread/slippage y no es un resultado sin fricción. MFE/MAE de la comparación incluyen la vela completa de salida como límite superior.

## Decisión y límites pendientes

Mantener entradas PAPER pausadas y sin aprobación. No hay selección de parámetros por el mejor histórico. Las variantes con costos reales deben mostrar expectativa estable y superar cash en nuevas muestras intactas y observación prospectiva antes de plantear una revisión. No basta un mes favorable o una métrica aislada.

Quedan pendientes microestructura/ticks, cola y latencia, filtros/tarifas históricas reales, liquidez compartida entre cuentas, pruebas prolongadas y más ventanas independientes. Los meses elegidos, el hueco de marzo y la regla intravela introducen sesgos. Backtests y tests no garantizan ejecución ni rentabilidad futura. El mecanismo exige revisión humana explícita; no concede aprobación por estas tablas. Ver simulator-audit.md para límites de contabilidad, horarios y gestión de inventario.

## Reproducción

Ejecutar npm.cmd run build, python scripts/download-research.py, node scripts/run-research.cjs y node scripts/finalize-research.cjs. El descargador valida el plan congelado y checksums; no modificarlo para reutilizar el OOS como entrenamiento. El finalizador concilia filas y referencia cash y genera este informe sin modificar resultados ni seleccionar parámetros. Los archivos reports/ son locales e ignorados por Git. No compartir archivos de credenciales.
`;
fs.writeFileSync('docs/strategy-diagnostics.md',text);
fs.writeFileSync('reports/research-reconciliation.json',JSON.stringify({rows:rows.length,periods:manifest.length,variantsPerPeriod:20,cashCosts:0,netEqualsRealizedPlusUnrealized:true,selection:'none',approved:false},null,2));
console.log(JSON.stringify({rows:rows.length,baseline:base.map(r=>({period:r.period,pnl:r.netEquityPnl})),oos:rows.filter(r=>r.split==='final-oos').map(r=>({variant:r.variant,pnl:r.netEquityPnl}))}));
