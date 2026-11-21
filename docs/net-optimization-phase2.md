# Optimización de rentabilidad — Fase 2

Estado: **NO_QUALIFIED_STRATEGY**. Las entradas PAPER y reales siguen bloqueadas, con saldos/inventario operativos intactos.

Versión phase2-2; rama research/net-optimization-phase2; freeze **f3827e02a1858e8dcfe49599115c34ef36121a1270dde9fab0ff859ba82a626c**; semilla de calibración 20261120 y semilla 123456 del bootstrap diario heredado de la fase anterior. El primer intento se conserva íntegro en reports/net-optimization-phase2-attempt-v1, incluido código previo, resultados y fallos de integración. La revisión 2 corrige únicamente la identidad de configuración ante reordenamiento JSONB. Los replays completos importados conservan enlace, hash del archivo original y su configuración; no se fabricaron nuevos fills a partir de un P&L. La comparación financiera de parámetros entre ambos planes es obligatoria antes de importar. Los ensayos incompletos se registran como interrumpidos, no como ganancia/pérdida final.

## Respuestas y conclusiones

1. **Mayor ganancia de desarrollo:** momentum-1h, 28.83 USDT, 120 cierres y DD 3.90 %, entre ensayos que cumplen riesgo. No es ganadora validada.

2. **Estabilidad temporal descriptiva:** pullback-4h, p2-vol-economy, con 100.00 % de trimestres positivos; los drawdowns están en la tabla continua. Esta clasificación no exige tamaño de muestra ni significación, que se verifican por separado.

3. **Mayor resistencia a costos entre candidatas:** pullback-4h, peor neto continuo entre los tres escenarios 20.93 USDT. Se clasifica por neto conservado, no por porcentaje de retención sobre una base casi cero.

4. **Cambios de pullback:** ver tabla de deltas a continuación. Un delta positivo es mejora histórica en este replay, no ventaja independiente demostrada. Ninguna modificación supera todos los filtros; no se acredita una mejora robusta.

5. **Momentum:** las 253 señales brutas de 2024 pasan a 64 en 90 días (frecuencia normalizada también publicada); el win rate ejecutado cae de 39,17 % a 25 %, el PF de 1,19 a 0,91 y la expectativa neta de +0,2402 a −0,1191 USDT por cierre. En validación se activa además el corte por drawdown desde el máximo. La degradación ocurre también con costos mayores; ver diagnóstico y slippage aislado. No se añade un filtro retrospectivo para rescatarla.

6. **Descartes:** los motivos individuales completos están en strategy-candidate-selection.md y summary.json, incluidos riesgo, insuficiencia de muestra, concentración, incertidumbre, costos y estabilidad.

7. **Máximo beneficio observado bajo riesgo:** 28.83 USDT en desarrollo (momentum-1h); en la cuenta continua de evaluación, 28.82 USDT (pullback-4h). Son períodos y usos distintos y no se suman. Buy-and-hold que incumple riesgo se informa aparte.

8. **¿Candidata que supere el protocolo?:** No: NO_QUALIFIED_STRATEGY.

9. **Antes de habilitar PAPER:** resolver todos los filtros incumplidos y reunir evidencia independiente de hipótesis congeladas con costos realistas y suficientes operaciones por régimen, más validación operativa prospectiva sin entradas automáticas. Incluso una candidata válida requiere revisión y autorización explícita; el holdout reservado no se consume en esta fase.

10. **Siguiente experimento informativo:** ampliar retrospectivamente los tramos de entrenamiento con historia anterior a 2024, incluyendo mercados bajistas y laterales, manteniendo estas seis hipótesis y costos congelados; identificar qué meses ya fueron observados y excluirlos de cualquier reclamo de prueba nueva. Esto permite obtener más operaciones en entrenamiento sin bajar el mínimo de 30 ni usar el holdout reservado. No se ejecutó esa ampliación en esta fase.

| Modificación | Neto continuo | Delta contra original | Riesgo | Calificada |
|---|---|---|---|---|
| p2-confirm | 5.22 | -23.61 | Cumple | No |
| p2-extension | 15.70 | -13.12 | Cumple | No |
| p2-vol-economy | 28.56 | -0.26 | Cumple | No |
| p2-learned-abstain | 0.00 | -28.82 | Cumple | No |
| p2-time-72h | 18.09 | -10.73 | Cumple | No |
| p2-trailing | 15.11 | -13.72 | Cumple | No |

## Desarrollo 2024

| Estrategia | Neto USDT 2024 | Cerradas | DD | Límite de riesgo |
|---|---|---|---|---|
| btc-v2 | -18.19 | 18 | 4.12 % | Incumple |
| btc-v3 | 0.00 | 0 | 0.00 % | Cumple |
| momentum-1h | 28.83 | 120 | 3.90 % | Cumple |
| p2-confirm | 20.37 | 31 | 1.92 % | Cumple |
| p2-extension | 18.59 | 32 | 2.02 % | Cumple |
| p2-learned-abstain | -6.20 | 5 | 1.87 % | Cumple |
| p2-time-72h | 19.14 | 49 | 2.69 % | Cumple |
| p2-trailing | 23.54 | 48 | 2.49 % | Cumple |
| p2-vol-economy | 27.55 | 40 | 2.34 % | Cumple |
| pullback-4h | 26.23 | 40 | 2.34 % | Cumple |

## Capital continuo de evaluación

| Estrategia | Neto continuo USDT | Cerradas | DD | Trimestres positivos | Riesgo | Calificada |
|---|---|---|---|---|---|---|
| pullback-4h | 28.82 | 27 | 2.09 % | 100.00 % | Cumple | No |
| p2-confirm | 5.22 | 21 | 1.88 % | 66.67 % | Cumple | No |
| p2-extension | 15.70 | 21 | 2.67 % | 66.67 % | Cumple | No |
| p2-vol-economy | 28.56 | 26 | 2.13 % | 100.00 % | Cumple | No |
| p2-learned-abstain | 0.00 | 0 | 0.00 % | 0.00 % | Cumple | No |
| p2-time-72h | 18.09 | 31 | 2.04 % | 66.67 % | Cumple | No |
| p2-trailing | 15.11 | 35 | 2.36 % | 66.67 % | Cumple | No |

El neto es patrimonio terminal estimado tras liquidación conservadora menos capital inicial: remanente vendible a precio SELL adverso redondeado y menos comisión; dust no negociable se da por perdido en ese objetivo. Se conserva efectivo, reservas, realizado y no realizado por separado. No representa una liquidación ejecutada. Desarrollo y ventanas independientes reinician 500 USDT; sus sumas son descriptivas, no ganancias acumuladas de una cuenta. El replay continuo julio 2024–marzo 2025 conserva saldos y posiciones y es la cifra acumulada comparable. No se anualizan estos 274 días ni los trimestres; sólo 2024 continuo admite CAGR con duración de 366 días.

## Costos

Se reejecuta el motor completo para comisión, spread y slippage x1, x1,5 y x2. Base: 0,10 % de comisión por lado, spread total 2 bps y slippage 3 bps por ejecución MARKET. Son supuestos de estudio, no tarifas verificadas de una cuenta. Los LIMIT conservan la regla de ejecución del simulador previo. Se informan comisiones, spread, slippage, redondeo, cantidad de fills, hash de trayectoria, posiciones abiertas, capital inmovilizado y saldos residuales. Cambios de costos pueden modificar tamaño, admisión, stops y oportunidades posteriores: no se obtienen restando una cifra al neto anterior. El control adicional de momentum multiplica sólo slippage por 2 y 4 con el resto fijo.

| Estrategia | Continuo x1 | Continuo x1,5 | Continuo x2 |
|---|---|---|---|
| pullback-4h | 28.82 | 24.79 | 20.93 |
| p2-confirm | 5.22 | 3.14 | 1.32 |
| p2-extension | 15.70 | 13.10 | 10.50 |
| p2-vol-economy | 28.56 | 24.60 | 20.83 |
| p2-learned-abstain | 0.00 | 0.00 | 0.00 |
| p2-time-72h | 18.09 | 14.11 | 10.46 |
| p2-trailing | 15.11 | 10.95 | 6.41 |
| momentum-1h | 19.52 | 5.77 | -11.45 |
| btc-v2 | -20.60 | -20.74 | -20.81 |
| btc-v3 | 0.00 | 0.00 | 0.00 |

## Hipótesis congeladas

| ID | Cambio | Hipótesis |
|---|---|---|
| pullback-4h | original | Unchanged previous reference; normalization and controls shared |
| p2-confirm | confirmation | Wait one full bar after original pullback; require close above prior high, EMA20>EMA50 and close>EMA20 |
| p2-extension | extension | Avoid chasing recoveries already far above EMA20 or too close to the previous 20-bar high |
| p2-vol-economy | volatility | Exclude very quiet or extreme 4h volatility and targets small relative to modeled round-trip costs; not an expectation forecast |
| p2-learned-abstain | learned | Only trade ATR bins with sufficient prior nonoverlapping samples and bootstrap lower gross return above scenario costs plus economic margin |
| p2-time-72h | time | Reduce stale exposure and recycling delay with a 72h time stop, keeping entry, SL and TP unchanged |
| p2-trailing | trailing | Trail by two entry ATR after one entry ATR profit, using only previous closes, preserving initial protection and target |

## Riesgo y límites de evidencia

Capital 500 USDT; riesgo neto estimado por operación <=0,5 %, drawdown <=5 %, exposición <=80 %, pérdida diaria <=3 %, una sola posición BTC, Spot sin apalancamiento. Dimensionamiento objetivo 0,45 % y cortes preventivos 4 % de DD / 2,5 % diario. El corte de DD solicita salida y bloquea entradas durante el resto de ese replay; el corte diario pausa hasta el siguiente día UTC. En la cuenta continua el pico y el bloqueo no se reinician al cambiar de trimestre. Los bloqueos de capital y las salidas usan el adaptador causal corregido. Se descalifica por incumplimiento modelado, incluso una pérdida realizada individual >0,5 % del patrimonio de entrada por gap, o una pérdida marcada de posición por encima de ese tope. Se preservaron los límites de riesgo, los mínimos de 30/8 cierres, la concentración y la exigencia de incertidumbre; el protocolo temporal nuevo se fijó antes de evaluar las variantes. Los datos OHLC y la observación al cierre de un minuto no certifican riesgos tick a tick.

Todos los precios utilizados terminan el 2025-03-31 y ya fueron observados total o parcialmente en investigaciones anteriores. Las hipótesis también se motivaron por esos resultados. Holm se aplica a los conjuntos declarados de esta fase; no convierte la elección exploratoria previa de familias en una prueba independiente ni elimina todo el sesgo de investigaciones acumuladas. Este walk-forward respeta disponibilidad temporal y purga, pero es investigación sobre datos reutilizados; no es confirmación final nueva. El intervalo reservado 2025-04-01 / 2026-04-01 no fue descargado, leído ni evaluado. Ningún resultado autoriza entradas ni aprobaciones. No hubo push ni despliegues.

## Pruebas y reproducción

115 tests existentes, 11 contratos de investigación y 14 integraciones aprobados; typecheck y lint correctos. Hubo un intento fallido por dependencias apagadas y otro que detectó el hash sensible al orden; ambos se conservaron y motivaron la revisión técnica explícita. No se modificó BTC-V2, BTC-V3 ni el simulador de producción.

~~~powershell
# Requiere dependencias y los artefactos locales de la fase anterior; nunca usar precios del tramo reservado.
npm.cmd run build
node scripts/net-optimization-phase2/test.cjs
# En una copia de investigación sin plan de fase2 existente:
node scripts/net-optimization-phase2/run.cjs freeze
node scripts/net-optimization-phase2/verify-operational.cjs before
node --max-old-space-size=8192 scripts/net-optimization-phase2/run.cjs
node --max-old-space-size=8192 scripts/net-optimization-phase2/analyze.cjs
node scripts/net-optimization-phase2/verify-operational.cjs after
node scripts/net-optimization-phase2/report.cjs
node scripts/net-optimization-phase2/verify.cjs
~~~

Los CSV/JSON completos, semillas, parámetros, hashes y decisiones están en `reports/net-optimization-phase2/`. Los archivos de datos originales y los estudios previos no se sobrescribieron.
