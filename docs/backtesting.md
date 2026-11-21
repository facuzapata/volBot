# Backtesting reproducible

El backtest usa `StrategyEngine` y `PaperExecutionAdapter`, los mismos componentes del worker. Ordena por tiempo y rechaza duplicados, huecos, OHLC inválido y símbolos distintos de BTCUSDT.

La señal se evalúa al cierre y se ejecuta en la apertura siguiente. Las temporalidades 5m/1h se agregan incrementalmente; sólo se emiten buckets completos UTC. No se usan velas futuras. Al tocar TP y SL sin conocer el recorrido intravela se prioriza SL. Un trailing calculado al cierre afecta la vela posterior.

La capacidad inicial de una entrada en apertura se estima usando el volumen de la vela anterior, ya conocido. La supervisión al cierre puede usar el OHLC y volumen de la vela completada. Ninguna orden se ejecuta con timestamp anterior a su creación.

No se fuerzan cierres al terminar el dataset. Se informa cantidad abierta, capital inmovilizado y resultado no realizado separadamente. Profit factor es null si no hay pérdidas; no se presenta infinito como un número JSON.

```powershell
npm.cmd run market:download -- --start 2025-01-01 --end 2025-02-01 --output btcusdt-1m.json
npm.cmd run backtest -- --input btcusdt-1m.json --strategy btc-v2 --capital 500 --max-positions 5 --usdt 30 --output report.json
npm.cmd run backtest -- --input btcusdt-1m.json --compare --output comparison.json
```

`--fee`, `--spread` y `--slippage` permiten variar costos. El reporte incluye hash SHA256 de datos normalizados, revisión, configuración, decisiones, órdenes, fills, ledger, curva de equity y métricas por régimen.

La comparación usa seis variantes: legacy, btc-v2, sin filtro principal, ATR2, TP0,8 % y TP1,5 % con trailing. Divide cronológicamente 70/15/15 con capital independiente; el tramo anterior sólo calienta indicadores. No selecciona parámetros usando el test fuera de muestra.

La API acepta hasta 50.000 velas. La CLI admite datasets mayores, limitados por memoria. Comparar seis variantes y conservar todos los reportes consume memoria considerable; usar rangos acotados. El CSV BTC/USD de 2017 del repositorio V1 no es una referencia válida para esta evaluación.
