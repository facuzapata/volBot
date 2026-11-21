# Walk-forward y purga temporal

Versión phase2-2; rama research/net-optimization-phase2; freeze **f3827e02a1858e8dcfe49599115c34ef36121a1270dde9fab0ff859ba82a626c**; semilla de calibración 20261120 y semilla 123456 del bootstrap diario heredado de la fase anterior. El primer intento se conserva íntegro en reports/net-optimization-phase2-attempt-v1, incluido código previo, resultados y fallos de integración. La revisión 2 corrige únicamente la identidad de configuración ante reordenamiento JSONB. Los replays completos importados conservan enlace, hash del archivo original y su configuración; no se fabricaron nuevos fills a partir de un P&L. La comparación financiera de parámetros entre ambos planes es obligatoria antes de importar. Los ensayos incompletos se registran como interrumpidos, no como ganancia/pérdida final.

| Ventana | Entrenamiento | Fin entrenamiento exclusivo | Evaluación | Seleccionada sólo con training |
|---|---|---|---|---|
| wf1 | 2024-01-01 | 2024-06-25 | 2024-07-01 / 2024-10-01 | USDT |
| wf2 | 2024-04-01 | 2024-09-25 | 2024-10-01 / 2025-01-01 | USDT |
| wf3 | 2024-07-01 | 2024-12-26 | 2025-01-01 / 2025-04-01 | USDT |

Cada ventana entrena siete candidatas al costo base y congela la selección antes de observar su evaluación. Se exigen 30 cierres, P&L positivo, riesgo, ganancia sin mejores tres, concentración máxima 50 %, IC inferior positivo de bloques de cinco días (2.000 réplicas), y Holm sobre siete pruebas con alfa 0,05. La mayor ganancia admisible gana el ranking; si nadie cumple se elige USDT. No se ajustan umbrales con los resultados posteriores. Los resultados de todas las variantes se publican para comparar, pero no sustituyen esa selección.

El embargo es de seis días: excede tanto el máximo horizonte de posiciones de 120 h como el label económico de 24 h. Sólo labels terminados estrictamente antes del cutoff y con señal dentro del entrenamiento entran en cada modelo. Los labels se seleccionan sin solapamiento antes de consultar el resultado; los censurados no se convierten en cero. Los indicadores usan exclusivamente barras completas UTC de 1h/4h; la señal se ejecuta en el siguiente minuto, con volumen del minuto anterior compartido entre fases.

La abstención aprendida se ajusta con un esquema mensual causal sólo en desarrollo/entrenamiento; en cada evaluación y en el replay continuo el modelo del fold queda fijo en su cutoff anterior. No se actualiza con precios del tramo evaluado. Sus bins ATR y mínimos de muestras/días/bloques están congelados. No usa MFE de la señal actual ni resultados de trades futuros para decidir.

La política seleccionada se reproduce además como una cuenta continua con el mismo capital inicial, posiciones y saldos. Cambia sólo el proveedor de señales en los límites prefijados; una posición anterior mantiene su configuración de entrada. No hay retiros o reposiciones de capital entre folds. La curva sigue incluyendo días sin operar. Los resultados de cuentas independientes se muestran separados.

El neto es patrimonio terminal estimado tras liquidación conservadora menos capital inicial: remanente vendible a precio SELL adverso redondeado y menos comisión; dust no negociable se da por perdido en ese objetivo. Se conserva efectivo, reservas, realizado y no realizado por separado. No representa una liquidación ejecutada. Desarrollo y ventanas independientes reinician 500 USDT; sus sumas son descriptivas, no ganancias acumuladas de una cuenta. El replay continuo julio 2024–marzo 2025 conserva saldos y posiciones y es la cifra acumulada comparable. No se anualizan estos 274 días ni los trimestres; sólo 2024 continuo admite CAGR con duración de 366 días.

Todos los precios utilizados terminan el 2025-03-31 y ya fueron observados total o parcialmente en investigaciones anteriores. Las hipótesis también se motivaron por esos resultados. Holm se aplica a los conjuntos declarados de esta fase; no convierte la elección exploratoria previa de familias en una prueba independiente ni elimina todo el sesgo de investigaciones acumuladas. Este walk-forward respeta disponibilidad temporal y purga, pero es investigación sobre datos reutilizados; no es confirmación final nueva. El intervalo reservado 2025-04-01 / 2026-04-01 no fue descargado, leído ni evaluado. Ningún resultado autoriza entradas ni aprobaciones. No hubo push ni despliegues.

La ventana móvil de unos seis meses puede tener menos de 30 cierres: es una limitación del entrenamiento y no se resuelve bajando el mínimo. La opción USDT de la política seleccionada indica falta de evidencia admisible, no superioridad predictiva demostrada.

| Estrategia | Neto continuo USDT | Cerradas | DD | Trimestres positivos | Riesgo | Calificada |
|---|---|---|---|---|---|---|
| pullback-4h | 28.82 | 27 | 2.09 % | 100.00 % | Cumple | No |
| p2-confirm | 5.22 | 21 | 1.88 % | 66.67 % | Cumple | No |
| p2-extension | 15.70 | 21 | 2.67 % | 66.67 % | Cumple | No |
| p2-vol-economy | 28.56 | 26 | 2.13 % | 100.00 % | Cumple | No |
| p2-learned-abstain | 0.00 | 0 | 0.00 % | 0.00 % | Cumple | No |
| p2-time-72h | 18.09 | 31 | 2.04 % | 66.67 % | Cumple | No |
| p2-trailing | 15.11 | 35 | 2.36 % | 66.67 % | Cumple | No |

Los CSV/JSON completos, semillas, parámetros, hashes y decisiones están en `reports/net-optimization-phase2/`. Los archivos de datos originales y los estudios previos no se sobrescribieron.
