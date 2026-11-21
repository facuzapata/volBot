# Selección de candidatas

Estado: **NO_QUALIFIED_STRATEGY**.

Versión phase2-2; rama research/net-optimization-phase2; freeze **f3827e02a1858e8dcfe49599115c34ef36121a1270dde9fab0ff859ba82a626c**; semilla de calibración 20261120 y semilla 123456 del bootstrap diario heredado de la fase anterior. El primer intento se conserva íntegro en reports/net-optimization-phase2-attempt-v1, incluido código previo, resultados y fallos de integración. La revisión 2 corrige únicamente la identidad de configuración ante reordenamiento JSONB. Los replays completos importados conservan enlace, hash del archivo original y su configuración; no se fabricaron nuevos fills a partir de un P&L. La comparación financiera de parámetros entre ambos planes es obligatoria antes de importar. Los ensayos incompletos se registran como interrumpidos, no como ganancia/pérdida final.

Capital 500 USDT; riesgo neto estimado por operación <=0,5 %, drawdown <=5 %, exposición <=80 %, pérdida diaria <=3 %, una sola posición BTC, Spot sin apalancamiento. Dimensionamiento objetivo 0,45 % y cortes preventivos 4 % de DD / 2,5 % diario. El corte de DD solicita salida y bloquea entradas durante el resto de ese replay; el corte diario pausa hasta el siguiente día UTC. En la cuenta continua el pico y el bloqueo no se reinician al cambiar de trimestre. Los bloqueos de capital y las salidas usan el adaptador causal corregido. Se descalifica por incumplimiento modelado, incluso una pérdida realizada individual >0,5 % del patrimonio de entrada por gap, o una pérdida marcada de posición por encima de ese tope. Se preservaron los límites de riesgo, los mínimos de 30/8 cierres, la concentración y la exigencia de incertidumbre; el protocolo temporal nuevo se fijó antes de evaluar las variantes. Los datos OHLC y la observación al cierre de un minuto no certifican riesgos tick a tick.

## Protocolo

Se conservaron los mínimos de 30 cierres en desarrollo y al menos ocho en cada trimestre de evaluación, más 30 en el continuo. Se exige neto positivo, neto sin las tres mejores operaciones positivo, concentración de esas tres <=50 % del beneficio bruto ganador, límite inferior bootstrap positivo y Holm <=0,05 entre ocho estrategias (siete candidatas y momentum de control). Al menos dos de tres trimestres del continuo deben ser positivos. Todos los escenarios de costos continuos deben conservar ganancia y riesgo aceptable, con al menos dos ventanas independientes positivas por costo y ninguna con incumplimiento. El desarrollo también debe superar los filtros. Se publica cada intento, incluso los rechazados e interrumpidos.

La función económica primaria es P&L neto acumulado en USDT, sujeto a esos filtros, con ranking por mayor neto; no se optimiza win rate, Sharpe o PF. La selección por fold sólo usa entrenamiento; la clasificación conjunta reutiliza datos conocidos y es exploratoria. No se recalibran requisitos si nadie pasa.

| Candidata | Causas |
|---|---|
| pullback-4h | INSUFFICIENT_TRADES, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY, DEVELOPMENT_REJECTED, WINDOW_SAMPLE |
| p2-confirm | INSUFFICIENT_TRADES, BEST_THREE_DEPENDENCE, PROFIT_CONCENTRATION, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY, DEVELOPMENT_REJECTED, WINDOW_SAMPLE |
| p2-extension | INSUFFICIENT_TRADES, BEST_THREE_DEPENDENCE, PROFIT_CONCENTRATION, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY, DEVELOPMENT_REJECTED, WINDOW_SAMPLE |
| p2-vol-economy | INSUFFICIENT_TRADES, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY, DEVELOPMENT_REJECTED, WINDOW_SAMPLE |
| p2-learned-abstain | NONPOSITIVE_NET, INSUFFICIENT_TRADES, BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY, DEVELOPMENT_REJECTED, WINDOW_SAMPLE, TEMPORAL_INSTABILITY, COST_OR_WINDOW_1, COST_OR_WINDOW_1.5, COST_OR_WINDOW_2 |
| p2-time-72h | BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY, DEVELOPMENT_REJECTED |
| p2-trailing | BEST_THREE_DEPENDENCE, BOOTSTRAP_UNCERTAINTY, MULTIPLE_TEST_UNCERTAINTY, DEVELOPMENT_REJECTED, COST_OR_WINDOW_2 |

| Candidata | Neto sin las mejores 3 | Parte del beneficio bruto en mejores 3 | IC inferior USDT/día | p Holm |
|---|---|---|---|---|
| pullback-4h | 10.64 | 32.97 % | -0.0045 | 0.5837 |
| p2-confirm | -10.58 | 58.09 % | -0.0755 | 1.0000 |
| p2-extension | -2.12 | 51.17 % | -0.0366 | 1.0000 |
| p2-vol-economy | 10.38 | 33.12 % | -0.0064 | 0.5837 |
| p2-learned-abstain | 0.00 | 0.00 % | 0.0000 | 1.0000 |
| p2-time-72h | 0.52 | 35.86 % | -0.0297 | 1.0000 |
| p2-trailing | -1.99 | 40.22 % | -0.0440 | 1.0000 |

## Referencias con igual capital y período continuo

| Referencia continua | Costos | Neto USDT | DD | Mayor pérdida diaria | Exposición máxima | Cumple riesgo |
|---|---|---|---|---|---|---|
| USDT | 1 | 0.00 | 0.00 % | 0.00 % | 0.00 % | Sí |
| BTC-hold-80 | 1 | 124.49 | 26.06 % | 11.94 % | 87.39 % | No |
| BTC-hold-100 | 1 | 155.62 | 29.82 % | 15.16 % | 99.97 % | No |
| USDT | 1.5 | 0.00 | 0.00 % | 0.00 % | 0.00 % | Sí |
| BTC-hold-80 | 1.5 | 123.65 | 26.05 % | 11.92 % | 87.33 % | No |
| BTC-hold-100 | 1.5 | 154.61 | 29.81 % | 15.15 % | 99.94 % | No |
| USDT | 2 | 0.00 | 0.00 % | 0.00 % | 0.00 % | Sí |
| BTC-hold-80 | 2 | 123.01 | 26.06 % | 11.93 % | 87.36 % | No |
| BTC-hold-100 | 2 | 153.81 | 29.82 % | 15.16 % | 99.98 % | No |

BTC-V2 conserva fórmulas técnicas, protección reanclada, invalidación y horizonte originales; se normalizan sólo capital, una posición y dimensionamiento/límites personales comunes. Se explicitan sus overrides en cada options.config. BTC-V3 usa la estrategia original y una calibración previa al inicio del replay cuando existe; sin modelo anterior se abstiene. No se presenta la abstención como rentabilidad demostrada. Original pullback y momentum usan su código congelado anterior. Las referencias BTC pasivas carecen de stop por operación y pueden exceder DD, pérdida diaria y exposición; no se seleccionan como estrategias aptas bajo estos límites.

Se reejecuta el motor completo para comisión, spread y slippage x1, x1,5 y x2. Base: 0,10 % de comisión por lado, spread total 2 bps y slippage 3 bps por ejecución MARKET. Son supuestos de estudio, no tarifas verificadas de una cuenta. Los LIMIT conservan la regla de ejecución del simulador previo. Se informan comisiones, spread, slippage, redondeo, cantidad de fills, hash de trayectoria, posiciones abiertas, capital inmovilizado y saldos residuales. Cambios de costos pueden modificar tamaño, admisión, stops y oportunidades posteriores: no se obtienen restando una cifra al neto anterior. El control adicional de momentum multiplica sólo slippage por 2 y 4 con el resto fijo.

Todos los precios utilizados terminan el 2025-03-31 y ya fueron observados total o parcialmente en investigaciones anteriores. Las hipótesis también se motivaron por esos resultados. Holm se aplica a los conjuntos declarados de esta fase; no convierte la elección exploratoria previa de familias en una prueba independiente ni elimina todo el sesgo de investigaciones acumuladas. Este walk-forward respeta disponibilidad temporal y purga, pero es investigación sobre datos reutilizados; no es confirmación final nueva. El intervalo reservado 2025-04-01 / 2026-04-01 no fue descargado, leído ni evaluado. Ningún resultado autoriza entradas ni aprobaciones. No hubo push ni despliegues.

Si aparece una candidata apta se genera candidate-freeze.json con modelo, configuración, código y evidencia. Incluso ese estado no consume el holdout ni aprueba la estrategia. En caso contrario no se crea un finalista y se mantiene NO_QUALIFIED_STRATEGY.

Los CSV/JSON completos, semillas, parámetros, hashes y decisiones están en `reports/net-optimization-phase2/`. Los archivos de datos originales y los estudios previos no se sobrescribieron.
