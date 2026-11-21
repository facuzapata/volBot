# Estrategias versionadas

Revisión inicial: `2026-11-20.1`. Las fórmulas de `src/utils/indicators.ts` se reutilizan sin cambiar RSI, ATR, EMA, MACD ni Bollinger.

## legacy-v1

Replica la puntuación activa auditada: al menos cinco de siete condiciones (tendencia, RSI 25–65, MACD, vela alcista, pullback, volumen y estructura). SMA 9/21/50, EMA12/26, RSI14, MACD12/26/9, ATR14 y Bollinger20/2. TP 0,5 %, SL 0,4 % como defaults originales.

Se preserva la decisión técnica, no los defectos de ejecución: V2 introduce deduplicación por episodio, reservas, contabilidad y simulación. No se incluye el filtro Ollama; compararlo requiere un experimento separado y reproducible. Tampoco se confunde esta estrategia con la clase V1 `StrategyService` de cruce SMA usada por el backtest antiguo.

## btc-v2 experimental

- 1h: EMA12 > EMA26, SMA9 > SMA21 y cierre > SMA50. Evita entradas contrarias al régimen principal.
- 5m: MACD sobre señal y SMA9 sobre SMA21. Confirma momentum intermedio.
- 1m: RSI35–65, histograma positivo, vela alcista/engulfing, volumen > 1,2 SMA10 y estructura respecto de SMA21. Busca una entrada con confirmación.
- El objetivo debe superar la estimación de comisión de ambos lados, spread y slippage.

El motor recibe exclusivamente velas cerradas anteriores o iguales al instante de decisión. Necesita al menos 50 velas en cada temporalidad para btc-v2. La precarga solicita 100 por intervalo.

En los cierres simultáneos se espera que PostgreSQL tenga la última vela cerrada esperada de cada intervalo, sin depender del orden de llegada de los streams. Mientras falta una temporalidad, las posiciones siguen supervisadas y sólo la evaluación de nuevas entradas se reintenta.

Una señal se emite sólo en el cambio de no elegible a elegible. Su ID deriva de estrategia, revisión, símbolo y cierre. Cambiar parámetros requiere una nueva revisión y reiniciar el estado de episodio mediante una migración revisada.

## Salidas

btc-v2 fija la distancia inicial como el máximo entre ATR × multiplicador y distancia al mínimo de diez velas. Se rechazan stops mayores al límite global. El precio ejecutado determina los niveles efectivos. Configuración y niveles se guardan con cada posición.

El trailing experimental se actualiza al cierre después de evaluar los triggers de esa vela. Nunca se usa su máximo para proteger retroactivamente su mínimo. Se admiten salidas por invalidación del régimen 1h y antigüedad máxima, además de TP/SL y cierre manual simulado.

Los valores 0,8–1,5 % son variantes experimentales. Ninguna fórmula ni puntuación garantiza una expectativa positiva.
