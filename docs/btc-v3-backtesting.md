# Backtesting BTC-V3

## Diseño y control temporal

Todos los ocho períodos usados anteriormente son observados. Se mantuvo enero 2025 original separado de los siete meses ampliados. Capital 500 USDT por ventana independiente, presupuesto 30 y máximo cinco posiciones. Comisión 0,1 % por lado, spread total 2 bps y slippage 3 bps por ejecución MARKET. Las salidas LIMIT siguen la política del simulador: no slippage/spread adicional sobre su límite. Tick, step y notional son supuestos del modelo, no reconstrucción histórica de filtros.

Se congeló primero el plan, después código/configuración inicial; se hicieron correcciones técnicas registradas en technical-amendments.json y se congeló la candidata 49c57fcb2f3178b973ec80ba3eac87537822dcee01a94797f4e11e3958ebfd1e. La calibración final 6253935287aed38bccb85f03a7cb5c9b8a86b50a789b9f618272220faa3ec06b quedó fijada antes de descargar marzo 2025. La auditoría verificó que los ocho datasets existentes terminaban antes de marzo 2025 y que no había archivos de marzo/abril. Esto certifica el alcance del repositorio/sesión, no usos externos desconocidos. Abril 2025 no se descargó ni evaluó y permanece reservado.

Marzo 2025 se descargó del archivo público Binance después de congelar la candidata, verificando SHA256 de ZIP publicado. Se reutilizaron tres días conocidos de febrero sólo para calentamiento. El journal oos-started.json impide repetir automáticamente la prueba; oos-completed.json registra una única tanda de cinco referencias/configuraciones fijadas. No se modificaron parámetros después del resultado final. Este tramo ya quedó observado: cambios futuros requieren otro holdout.

## Resultados por período

| Período | Muestra | Variante | Cierres | Ganadoras | Perdedoras | Neto equity USDT | DD % | PF | Abiertas | Inmovilizado USDT |
|---|---|---|---|---|---|---|---|---|---|---|
| 2025-01-original | observed-exploratory | v2-previous-simulator | 28 | 0 | 28 | -3.1065 | 0.631 | 0.000 | 0 | 0.0000 |
| 2025-01-original | observed-exploratory | v2-corrected-simulator | 20 | 0 | 20 | -2.3542 | 0.480 | 0.000 | 0 | 0.0000 |
| 2025-01-original | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2025-01-original | observed-exploratory | trend-reference | 5 | 0 | 5 | -0.5727 | 0.125 | 0.000 | 0 | 0.0000 |
| 2025-01-original | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2020-03 | observed-exploratory | v2-previous-simulator | 120 | 38 | 82 | -7.4169 | 1.668 | 0.551 | 0 | 0.0000 |
| 2020-03 | observed-exploratory | v2-corrected-simulator | 106 | 33 | 73 | -6.7906 | 1.449 | 0.538 | 0 | 0.0000 |
| 2020-03 | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2020-03 | observed-exploratory | trend-reference | 23 | 4 | 19 | -1.8418 | 0.368 | 0.342 | 0 | 0.0000 |
| 2020-03 | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2022-06 | observed-exploratory | v2-previous-simulator | 90 | 22 | 68 | -7.8650 | 1.657 | 0.400 | 0 | 0.0000 |
| 2022-06 | observed-exploratory | v2-corrected-simulator | 81 | 20 | 61 | -7.1255 | 1.510 | 0.401 | 0 | 0.0000 |
| 2022-06 | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2022-06 | observed-exploratory | trend-reference | 18 | 1 | 17 | -2.5469 | 0.515 | 0.086 | 0 | 0.0000 |
| 2022-06 | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2023-07 | observed-exploratory | v2-previous-simulator | 86 | 5 | 81 | -7.4178 | 1.484 | 0.138 | 0 | 0.0000 |
| 2023-07 | observed-exploratory | v2-corrected-simulator | 62 | 5 | 57 | -5.1571 | 1.035 | 0.187 | 0 | 0.0000 |
| 2023-07 | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2023-07 | observed-exploratory | trend-reference | 15 | 0 | 15 | -1.6808 | 0.341 | 0.000 | 0 | 0.0000 |
| 2023-07 | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2023-09 | observed-exploratory | v2-previous-simulator | 97 | 14 | 83 | -6.4709 | 1.294 | 0.340 | 0 | 0.0000 |
| 2023-09 | observed-exploratory | v2-corrected-simulator | 76 | 13 | 63 | -4.5683 | 0.914 | 0.404 | 0 | 0.0000 |
| 2023-09 | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2023-09 | observed-exploratory | trend-reference | 18 | 1 | 17 | -1.5364 | 0.336 | 0.134 | 0 | 0.0000 |
| 2023-09 | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2024-02 | observed-exploratory | v2-previous-simulator | 148 | 38 | 110 | -5.5573 | 1.653 | 0.618 | 0 | 0.0000 |
| 2024-02 | observed-exploratory | v2-corrected-simulator | 129 | 35 | 94 | -4.4494 | 1.325 | 0.651 | 0 | 0.0000 |
| 2024-02 | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2024-02 | observed-exploratory | trend-reference | 37 | 6 | 31 | -1.9074 | 0.439 | 0.428 | 0 | 0.0000 |
| 2024-02 | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2024-10 | observed-exploratory | v2-previous-simulator | 157 | 28 | 129 | -9.9299 | 2.004 | 0.393 | 0 | 0.0000 |
| 2024-10 | observed-exploratory | v2-corrected-simulator | 140 | 28 | 112 | -8.0759 | 1.633 | 0.443 | 0 | 0.0000 |
| 2024-10 | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2024-10 | observed-exploratory | trend-reference | 17 | 4 | 13 | -0.8231 | 0.219 | 0.535 | 0 | 0.0000 |
| 2024-10 | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2025-02 | observed-exploratory | v2-previous-simulator | 69 | 10 | 59 | -4.7479 | 1.009 | 0.331 | 0 | 0.0000 |
| 2025-02 | observed-exploratory | v2-corrected-simulator | 60 | 8 | 52 | -4.5380 | 0.967 | 0.293 | 0 | 0.0000 |
| 2025-02 | observed-exploratory | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2025-02 | observed-exploratory | trend-reference | 15 | 3 | 12 | -0.5384 | 0.240 | 0.568 | 0 | 0.0000 |
| 2025-02 | observed-exploratory | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2025-03 | new-final-oos | v2-previous-simulator | 129 | 24 | 105 | -8.0704 | 1.777 | 0.413 | 0 | 0.0000 |
| 2025-03 | new-final-oos | v2-corrected-simulator | 110 | 23 | 87 | -6.1588 | 1.391 | 0.469 | 0 | 0.0000 |
| 2025-03 | new-final-oos | v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |
| 2025-03 | new-final-oos | trend-reference | 22 | 3 | 19 | -1.5231 | 0.356 | 0.319 | 0 | 0.0000 |
| 2025-03 | new-final-oos | USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | n/d | 0 | 0.0000 |

Las sumas entre meses son descriptivas sobre cuentas reiniciadas, no retorno compuesto. No se promedian profit factors ni drawdowns como si formaran una cartera continua. P&L realizado y no realizado se mantienen separados en CSV; no se fuerza liquidación final. Media de duración original incluye desde reserva; averageFilledHoldingMinutes mide desde primer fill real. MFE/MAE son límites superiores usando OHLC de vela de salida, sin precisión de ticks.

## Calibración y abstención

Se reutilizaron cinco períodos observados de desarrollo: marzo 2020, junio 2022, julio/septiembre 2023 y febrero 2024. Se recogieron 405 labels estructurales de 60m completos, sin solapamiento dentro de cada período. Para evaluar cada período histórico, la calibración sólo usa labels ya terminados antes de su inicio. La primera ventana no tiene historial de calibración suficiente y se abstiene. El modelo final sólo usa esos cinco meses, nunca octubre 2024, enero/febrero 2025 ni el nuevo marzo 2025.

| ATR5m/precio % | N | Días | Retorno bruto medio 60m % | IC95 inferior % | MFE p25 % |
|---|---|---|---|---|---|
| 0.10–0.20 | 183 | 52 | 0.0244 | -0.0559 | 0.0990 |
| 0.20–0.40 | 137 | 49 | 0.0100 | -0.0972 | 0.1362 |
| 0.40–0.80 | 70 | 20 | 0.0501 | -0.1496 | 0.3131 |
| 0.80–1.50 | 15 | 5 | -0.5786 | -1.6398 | 0.4704 |

Hay cuatro buckets prefijados. Ninguno demuestra economía suficiente: los límites inferiores son negativos y el bucket superior tiene sólo quince muestras. Por eso el modelo real no habilita BUY. El modelo se vincula por hash a todos los parámetros y al horizonte; cambiar un umbral o el horizonte exige recalibrar, no reutilizar silenciosamente esos números. El archivo y su SHA256 se cargan explícitamente en el servidor, nunca desde forecasts enviados por un cliente HTTP. Falta de modelo, entrenamiento no anterior, parámetros distintos o muestras insuficientes producen NO_TRADE.

BTC-V3 hizo cero operaciones en las ventanas observadas y en el nuevo holdout. Hay cero ganadoras, cero perdedoras, cero costos y cero posiciones abiertas. PF es indefinido, no infinito; MFE/MAE de trades no tienen muestra. Es abstención económica, no evidencia de rentabilidad ni garantía de que una futura recalibración funcione. La rama BUY se prueba con fixtures sintéticos claramente etiquetados; esos fixtures no son evidencia económica.

## Archivos y reproducción

../reports/btc-v3/comparison.csv y comparison.json tienen 45 filas: ocho ventanas observadas más una final, cinco referencias por ventana. trade-risk-audit.csv conserva evaluaciones al fill y rejections.csv sus motivos. Cada replay completo mantiene órdenes/fills/ledger/equity bajo observed/ o final-oos/. results-summary.json consolida resultados, calibración, hashes y límites. No compartir archivos privados de credenciales que existen fuera de esta carpeta.

Para reproducir desarrollo: npm.cmd run build, node scripts/btc-v3/calibrate.cjs y node scripts/btc-v3/compare.cjs observed, usando snapshots/hashes correctos. El calibrador normal rechaza cambios posteriores al freeze inicial; correcciones técnicas se registran explícitamente antes del final. No sobrescribir el freeze ni borrar el journal para reutilizar el holdout. La repetición del backtest original corregido y la igualdad de señales V2 se verifican aparte sin volver a ejecutar marzo. Se conservaron los reportes anteriores.
