# Diagnóstico de momentum-1h

No se modificó la candidata para rescatar su validación. Se conserva como control y se la descarta para habilitación con la evidencia actual.

| Tramo | Neto | Cierres | Señales brutas/30 días | Fees/cierre | Duración mediana h | TP/costos mediano | DD | Correlación diaria BTC |
|---|---|---|---|---|---|---|---|---|
| development | 28.83 | 120 | 20.74 | 0.28 | 15.28 | 14.67 | 3.90 % | 0.55 |
| validation | -2.38 | 20 | 21.33 | 0.24 | 23.18 | 17.66 | 4.03 % | 0.47 |

## De +28,83 a −2,38 USDT

En 2024 hay 120 cierres, 47 ganadores y 73 perdedores: PF 1,1887, ganancia media 3,8636 USDT y pérdida media 2,0927 USDT. En enero–marzo de 2025 hay 20 cierres, cinco ganadores y quince perdedores: PF 0,91145, ganancia media 4,9035 y pérdida media 1,7933. No empeoró la pérdida media por sí sola: cayó la frecuencia de capturar recorridos ganadores. Los costos siguen erosionando el pequeño margen por operación y la trayectoria termina con corte por DD desde su máximo.

Las mejores tres ganancias representan 9,56 % del beneficio bruto ganador en desarrollo, pero 65,58 % en validación. El neto sin ellas pasa de +11,47 a −18,46 USDT. Esto no permite elegir retrospectivamente un filtro por las características de esas ganadoras. Todos los trimestres y sus netos marcados están conservados en diagnostics.json.

La correlación diaria con BTC pasa de aproximadamente 0,55 a 0,47. Indica covariación observada de P&L y dirección, no beta estable ni causalidad; es compatible con exposición long dependiente de recorridos direccionales. La distribución de ATR, MFE/MAE, duraciones, régimen, fees y señales por 30 días permite distinguir cambios de muestra, sin atribuir toda la pérdida al cambio de tendencia. Comprar y mantener BTC fue positivo en 2024 y negativo en la validación original, con riesgo muy por encima del permitido.

## Costos y slippage

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

| Tramo | Slippage bps | Neto | Comisiones | Slippage USDT | DD | Cierres |
|---|---|---|---|---|---|---|
| slippage-continuous | 6 | 13.87 | 20.44 | 10.61 | 4.06 % | 78 |
| slippage-continuous | 12 | 3.88 | 18.62 | 19.30 | 4.03 % | 77 |
| slippage-development | 6 | -6.43 | 13.37 | 6.99 | 4.08 % | 52 |
| slippage-development | 12 | -11.03 | 10.73 | 11.10 | 4.04 % | 45 |

Los archivos slippage-* guardan options.config.slippageBps exacto (6 y 12 bps), con comisión y spread base sin alterar. Diferencias de cantidad, admisión y corte por DD impiden interpretar el delta de P&L como un costo contable sobre fills fijos.

La evidencia no acredita continuidad de la ventaja fuera de desarrollo. No hay nueva variante momentum seleccionada por sus pérdidas observadas.

Todos los precios utilizados terminan el 2025-03-31 y ya fueron observados total o parcialmente en investigaciones anteriores. Las hipótesis también se motivaron por esos resultados. Holm se aplica a los conjuntos declarados de esta fase; no convierte la elección exploratoria previa de familias en una prueba independiente ni elimina todo el sesgo de investigaciones acumuladas. Este walk-forward respeta disponibilidad temporal y purga, pero es investigación sobre datos reutilizados; no es confirmación final nueva. El intervalo reservado 2025-04-01 / 2026-04-01 no fue descargado, leído ni evaluado. Ningún resultado autoriza entradas ni aprobaciones. No hubo push ni despliegues.

Los CSV/JSON completos, semillas, parámetros, hashes y decisiones están en `reports/net-optimization-phase2/`. Los archivos de datos originales y los estudios previos no se sobrescribieron.
