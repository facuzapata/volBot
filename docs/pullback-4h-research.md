# Investigación de pullback-4h

Se estudia la referencia original congelada; no se considera aprobada.

| Tramo | Neto | Cierres | Señales brutas/30 días | Fees/cierre | Duración mediana h | TP/costos mediano | DD | Correlación diaria BTC |
|---|---|---|---|---|---|---|---|---|
| development | 26.23 | 40 | 10.74 | 0.16 | 53.33 | 30.59 | 2.34 % | 0.49 |
| validation | 2.35 | 9 | 9.33 | 0.15 | 24.50 | 31.31 | 2.08 % | 0.36 |

## Resistencia relativa a costos

La mediana de TP respecto del circuito de costos nominales ronda 30–31 veces, frente a 15–18 en momentum. La duración mediana de pullback fue de 53,33 h en 2024 y 24,50 h en validación, con 40 y nueve cierres: comisiona menos veces y busca movimientos más amplios. Esto explica contablemente parte de su menor sensibilidad, sin demostrar una expectativa positiva. La comparación mezcla entradas, horizontes, salidas y condiciones de mercado; no identifica causalmente un indicador ganador.

En la validación original, eliminar las tres mejores operaciones deja −11,04 USDT y esas tres explican aproximadamente 98,25 % del beneficio bruto ganador. Seguir apenas positiva con costos x2 no supera ni concentración ni incertidumbre.

## Features, excursiones y régimen

| Característica en trades pullback | Media 2024 | Media ene–mar2025 |
|---|---|---|
| depthAtr | 3.34 | 2.61 |
| distanceEma20Atr | 0.58 | 0.55 |
| distanceEma50Atr | 1.52 | 1.28 |
| slope3Atr | 0.06 | 0.10 |
| atrFraction | 0.01 | 0.02 |
| pullbackBars | 3.33 | 1.22 |
| pullbackVolumeRatio | 0.98 | 0.85 |
| recoveryVolumeRatio | 1.15 | 1.14 |
| belowHighAtr | 1.70 | 1.47 |
| mfeUpperPct | 4.04 | 3.11 |
| maeUpperPct | 2.20 | 2.50 |
| holdingHours | 66.73 | 46.02 |
| stopCostRatio | 10.55 | 12.13 |
| targetCostRatio | 31.65 | 36.39 |

Las unidades ATR se calculan con la vela 4h ya cerrada. slope3Atr es el cambio de EMA20 en tres barras dividido por ATR actual. depthAtr usa máximo de las 20 previas y mínimo de la actual más cinco anteriores. pullbackBars cuenta cierres previos consecutivos bajo EMA20; cero no significa ausencia de un retroceso intravela. pullbackVolumeRatio usa tres barras anteriores como proxy, no volumen reconstruido dentro del retroceso; recoveryVolumeRatio compara la barra de recuperación con esas tres. belowHighAtr mide distancia al máximo previo.

Se conservan movimientos posteriores a 24/120 h para todas las señales brutas en signal-features.csv, con censura explícita al final de datos. Son horizontes solapados de diagnóstico, no una cartera ni entradas ejecutadas simultáneamente. MFE/MAE de trades son cotas con OHLC de la duración observada e incluyen la vela de salida, cuyo orden intravela es desconocido. No se utilizan esas excursiones a posteriori para decidir ni para alegar una salida realizable. Resultados por régimen y motivos de salida están en diagnostics.json.

## Modificaciones efectivamente comparadas

| ID | Cambio | Hipótesis |
|---|---|---|
| pullback-4h | original | Unchanged previous reference; normalization and controls shared |
| p2-confirm | confirmation | Wait one full bar after original pullback; require close above prior high, EMA20>EMA50 and close>EMA20 |
| p2-extension | extension | Avoid chasing recoveries already far above EMA20 or too close to the previous 20-bar high |
| p2-vol-economy | volatility | Exclude very quiet or extreme 4h volatility and targets small relative to modeled round-trip costs; not an expectation forecast |
| p2-learned-abstain | learned | Only trade ATR bins with sufficient prior nonoverlapping samples and bootstrap lower gross return above scenario costs plus economic margin |
| p2-time-72h | time | Reduce stale exposure and recycling delay with a 72h time stop, keeping entry, SL and TP unchanged |
| p2-trailing | trailing | Trail by two entry ATR after one entry ATR profit, using only previous closes, preserving initial protection and target |

| Modificación | Neto continuo | Delta contra original | Riesgo | Calificada |
|---|---|---|---|---|
| p2-confirm | 5.22 | -23.61 | Cumple | No |
| p2-extension | 15.70 | -13.12 | Cumple | No |
| p2-vol-economy | 28.56 | -0.26 | Cumple | No |
| p2-learned-abstain | 0.00 | -28.82 | Cumple | No |
| p2-time-72h | 18.09 | -10.73 | Cumple | No |
| p2-trailing | 15.11 | -13.72 | Cumple | No |

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

Un delta positivo no establece mejora robusta fuera de muestra nueva. Se conservan las modificaciones que empeoran, abstenciones completas, operaciones abiertas y descalificaciones. Los thresholds no se eligieron después de estas tablas.

Todos los precios utilizados terminan el 2025-03-31 y ya fueron observados total o parcialmente en investigaciones anteriores. Las hipótesis también se motivaron por esos resultados. Holm se aplica a los conjuntos declarados de esta fase; no convierte la elección exploratoria previa de familias en una prueba independiente ni elimina todo el sesgo de investigaciones acumuladas. Este walk-forward respeta disponibilidad temporal y purga, pero es investigación sobre datos reutilizados; no es confirmación final nueva. El intervalo reservado 2025-04-01 / 2026-04-01 no fue descargado, leído ni evaluado. Ningún resultado autoriza entradas ni aprobaciones. No hubo push ni despliegues.

Los CSV/JSON completos, semillas, parámetros, hashes y decisiones están en `reports/net-optimization-phase2/`. Los archivos de datos originales y los estudios previos no se sobrescribieron.
