# BTC-V2 frente a BTC-V3

La comparación separa motor y estrategia. BTC-V2 anterior es el runtime archivado audit-1; BTC-V2 corregido usa causal-2 conservando sus señales. BTC-V3 y la referencia de tendencia usan el mismo causal-2, costos, capital y ventanas. La referencia simple requiere EMA12>EMA26 y precio>SMA21 en 1h, en transición de elegibilidad, con riesgo/salidas estándar V2; sólo es una referencia de backtest, no selección operativa.

## Semana original

| Variante | Cierres | G/P | Neto USDT | Motivos de rechazo |
|---|---|---|---|---|
| v2-previous-simulator | 28 | 0/28 | -3.1065 | {} |
| v2-corrected-simulator | 20 | 0/20 | -2.3542 | {"AVERAGING_DOWN_BLOCKED":3,"STOP_NOT_BELOW_REFERENCE":5} |
| v3-corrected-simulator | 0 | 0/0 | 0.0000 | {} |
| trend-reference | 5 | 0/5 | -0.5727 | {} |
| USDT-cash | 0 | 0/0 | 0.0000 | {} |

La reducción de pérdida V2 procede de controles de ejecución/riesgo, no de modificar sus indicadores. Se verificaron señales idénticas en 10.080 velas originales. BTC-V3 no generó evidencia de trades rentables: no operó.

## Siete ventanas observadas independientes

| Variante | Cierres | Ganadoras | Perdedoras | Suma neta USDT | Peor DD mensual % |
|---|---|---|---|---|---|
| v2-previous-simulator | 767 | 155 | 612 | -49.4056 | 2.004 |
| v2-corrected-simulator | 654 | 142 | 512 | -40.7049 | 1.633 |
| v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 |
| trend-reference | 143 | 19 | 124 | -10.8746 | 0.515 |
| USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 |

## Nuevo marzo 2025, candidata congelada

| Variante | Cierres | Ganadoras | Perdedoras | Neto equity USDT | Retorno % | Comisiones | DD % | PF | Abiertas |
|---|---|---|---|---|---|---|---|---|---|
| v2-previous-simulator | 129 | 24 | 105 | -8.0704 | -1.614 | 7.6241 | 1.777 | 0.413 | 0 |
| v2-corrected-simulator | 110 | 23 | 87 | -6.1588 | -1.232 | 6.5035 | 1.391 | 0.469 | 0 |
| v3-corrected-simulator | 0 | 0 | 0 | 0.0000 | 0.000 | 0.0000 | 0.000 | n/d | 0 |
| trend-reference | 22 | 3 | 19 | -1.5231 | -0.305 | 1.3009 | 0.356 | 0.319 | 0 |
| USDT-cash | 0 | 0 | 0 | 0.0000 | 0.000 | 0.0000 | 0.000 | n/d | 0 |

USDT cash no opera y tiene retorno nominal cero bajo esta referencia, sin rendimiento de préstamos ni modelar depeg/counterparty. BTC-V3 igualar cash por abstenerse no acredita ventaja predictiva. Ninguna estrategia operante de esta tanda supera cash. No se concedió aprobación ni se habilitó ninguna cuenta.
