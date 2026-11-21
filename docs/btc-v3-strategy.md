# Estrategia experimental BTC-V3

BTC-V3, revisión 2026-11-20.v3.1, es una política experimental long Spot con BUY o NO_TRADE. Los umbrales se fijaron antes de los nuevos resultados en [btc-v3-plan.json](btc-v3-plan.json). No se cambiaron para producir operaciones.

1. Tendencia 1h: EMA12 > EMA26, SMA21 > SMA50, cierre > SMA21 y SMA21 mayor que tres cierres horarios atrás. Se trata como una sola familia de información correlacionada.
2. Pullback 5m: distancia entre el máximo de las doce velas 5m anteriores y el último cierre 5m entre 0,5 y 2,5 ATR5m. La última 5m debe ser verde y cerrar por encima de la anterior.
3. Evitar extensión: posición relativa del precio en el rango de veinte velas 5m <=0,75 y en cien velas 1m <=0,80.
4. Recuperación 1m: vela verde cuyo cierre supera el máximo de la anterior. No se añaden votos RSI/MACD/volumen para forzar confluencia.
5. Volatilidad: ATR5m/precio entre 0,1 % y 1,5 %. Se abstiene con datos incompletos, huecos o desalineación temporal. Todas las barras son cerradas y causales.
6. Stop absoluto: menor entre mínimo de las últimas seis velas 5m menos 0,1 ATR5m y precio de señal menos 1,5 ATR5m. Target: precio de señal +2 ATR5m. Máxima distancia de stop 2 %, permanencia máxima 60 minutos y riesgo neto estimado por operación 0,5 % del equity con configuración V3 por defecto. El objetivo configurado no se usa como pronóstico de alcanzarlo.
7. Economía calibrada: bucket de ATR5m con al menos veinte muestras de sesenta minutos sin solapamiento y cinco días distintos; límite inferior del IC95 del retorno bruto esperado y cuantil 25 de MFE deben superar el break-even MARKET completo más 0,05 puntos porcentuales. MFE es potencial retrospectivo de calibración, no P&L realizable. No se usa sólo la volatilidad o el TP como supuesto de ganancia.

El stop usa estructura 5m de media hora y ATR5m, en lugar de reutilizar ATR1m para una hora. Los multiplicadores son una hipótesis previa, no valores óptimos ni una escala de riesgo demostrada. Se mantienen presupuesto, máximo de posiciones, reservas atómicas, límites de exposición/pérdida diaria, protección obligatoria y prohibición de aumentar exposición mientras hay BTC adquirido por encima de la referencia actual.

La estrategia emite una decisión global de mercado; RiskPolicy toma la decisión personal según capital/slots y el ejecutor vuelve a validar geometría y pérdida neta antes del fill. Una reserva aceptada no significa una compra ejecutada. Las órdenes rechazadas conservan motivo y proyección de riesgo. El precio real/proxy de ejecución puede cancelar una oportunidad anterior sin mover su stop para aceptarla.

## Calibración y configuración

Se reutilizaron cinco períodos observados de desarrollo: marzo 2020, junio 2022, julio/septiembre 2023 y febrero 2024. Se recogieron 405 labels estructurales de 60m completos, sin solapamiento dentro de cada período. Para evaluar cada período histórico, la calibración sólo usa labels ya terminados antes de su inicio. La primera ventana no tiene historial de calibración suficiente y se abstiene. El modelo final sólo usa esos cinco meses, nunca octubre 2024, enero/febrero 2025 ni el nuevo marzo 2025.

| ATR5m/precio % | N | Días | Retorno bruto medio 60m % | IC95 inferior % | MFE p25 % |
|---|---|---|---|---|---|
| 0.10–0.20 | 183 | 52 | 0.0244 | -0.0559 | 0.0990 |
| 0.20–0.40 | 137 | 49 | 0.0100 | -0.0972 | 0.1362 |
| 0.40–0.80 | 70 | 20 | 0.0501 | -0.1496 | 0.3131 |
| 0.80–1.50 | 15 | 5 | -0.5786 | -1.6398 | 0.4704 |

Hay cuatro buckets prefijados. Ninguno demuestra economía suficiente: los límites inferiores son negativos y el bucket superior tiene sólo quince muestras. Por eso el modelo real no habilita BUY. El modelo se vincula por hash a todos los parámetros y al horizonte; cambiar un umbral o el horizonte exige recalibrar, no reutilizar silenciosamente esos números. El archivo y su SHA256 se cargan explícitamente en el servidor, nunca desde forecasts enviados por un cliente HTTP. Falta de modelo, entrenamiento no anterior, parámetros distintos o muestras insuficientes producen NO_TRADE.

Los valores están en src/v2/strategy/btc-v3.config.ts. El backtest admite btcV3 con validación de claves, versión y rangos. El worker admite V3_PARAMETERS_JSON y un V3_CALIBRATION_FILE cuyo SHA256 debe coincidir con V3_CALIBRATION_SHA256; sin modelo se abstiene. La configuración y el modelo completo entran en el hash de aprobación. V2_STRATEGY sigue en btc-v2 en el archivo operativo, sin habilitación de entradas ni cambio automático de estrategia.

Swagger publica versiones/configuración, estado de aprobación, decisión reciente, proyección de riesgo y metadatos de liquidez. No admite subir calibración ni aprobar por campos de un backtest. Aprobar requiere revisión administrativa explícita y luego opt-in de cada cuenta; nada de eso se ejecutó aquí.

Se preservaron las condiciones, fórmulas y revisión btc-v2. La comparación de 10.080 velas originales verificó 31 minutos elegibles con señales idénticas respecto del código archivado. El nuevo motor puede rechazar reservas/fills que antes admitía, lo que cambia resultados sin cambiar las reglas técnicas de entrada V2.
