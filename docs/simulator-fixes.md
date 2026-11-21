# Correcciones del simulador

Revisión anterior: paper-2026-11-20.audit-1. Revisión nueva: paper-2026-11-20.causal-2. Rama feature/btc-v3-research-and-fixes. Se preservaron 165 archivos con los cambios locales antes de crear la rama; la ruta del respaldo está en ../reports/btc-v3/before.json. El runtime compilado anterior se conserva bajo ../reports/btc-v3/previous-runtime/ con hashes, sin reemplazar datasets ni reportes anteriores.

## Evidencia previa y corrección de stops

../reports/btc-v3/tests-before.json conserva diez fallos y una comprobación aprobada antes de corregir. Seis fallos reproducen individualmente las protecciones originales ya cruzadas frente a la apertura, otro demuestra falta de revalidación de riesgo, dos demuestran anticipación/ausencia de capacidad causal y otro geometría NaN admitida. Los seis casos están en test/v2/fixtures/invalid-stop-cases.json con el hash del dataset original.

Antes de mutar saldo o confirmar BUY se proyecta el precio adverse redondeado a tick, cantidad a step, cantidad neta si el fee es BTC, costo total adquirido, stop y target, exposición y equity marcados. El stop debe ser finito, positivo y estrictamente inferior al precio ejecutado promedio y a la referencia bruta de ejecución. No se mueve para salvar la operación. Sólo se redondea hacia abajo al tick y se registra precio previo y diferencia; la pérdida adicional por redondeo entra en el chequeo.

Se registran separadamente distancia a referencia, distancia al ejecutado, riesgo bruto desde ambos, pérdida neta estimada al stop, fees de ida/vuelta, impacto de ejecución, remanente no negociable, equity y tope de riesgo. En V3 también se rechaza un target que ya quedó debajo de ejecución o no deja margen neto, y una ventaja estimada que se perdió con el nuevo precio. La pérdida estimada asume fill al stop con costos modelados; no garantiza una pérdida máxima ante gaps o escasez de capacidad.

El rechazo libera sólo reservas pendientes y conserva la orden/motivo. Una compra parcial ya adquirida mantiene cantidad, costo, fill y protección anteriores; no se retrocede la historia. Una posición adquirida con protección inválida conserva inventario visible y encola cierre seguro, diferido si no hay capacidad. Dust se conserva con su costo, sin crear órdenes de venta de cantidad cero. Las compras pendientes se detienen si la cuenta está pausada, el dueño inactivo o la aprobación revocada; las salidas continúan. También se rechazan entradas caducadas y se ordenan estados persistidos por timestamp e ID para asignación estable tras reinicio.

## Liquidez causal compartida

Capacidad BTC del minuto t = volumen de la vela 1m completa t−1 × participationRate (por defecto 0,001). Sólo vale la vela inmediatamente anterior con cierre t−1ms. Si no existe una observación válida, capacidad cero; una orden se difiere o caduca, sin profundidad de libro inventada. Es una aproximación causal conservadora, no prueba de liquidez real de apertura.

La misma bolsa se comparte entre OPEN, INTRABAR y CLOSE y no se recarga con el volumen de la vela actual. El volumen completo actual pasa a ser elegible únicamente para el minuto siguiente. En backtest se pasa un presupuesto mutable único entre la compra de apertura y la supervisión. En operación, un advisory lock PostgreSQL por símbolo/minuto se toma antes del lock de cuenta; dentro de esa misma transacción se suma BTC ya ejecutado de todas las cuentas. Insertar fills, ledger, inbox y actualizar cuenta sucede atómicamente. Un reinicio reconstruye el gasto desde fills persistidos, no desde memoria.

La prioridad entre cuentas usa ID y entre posiciones/órdenes usa tiempo e ID. Rate común operativo y límites individuales pueden reducir la capacidad. Se comparten BUY y SELL en la misma bolsa, sin presuponer dos libros independientes. En tests de contabilidad aislados se permite capacidad numérica explícita; los caminos de backtest/worker usan presupuestos causales. La capacidad por defecto del adaptador es cero.

OPEN usa precio abierto conocido y volumen previo. INTRABAR registra una barrera OHLC inferida al procesar la vela cerrada, con SL primero si ambas se tocan sin orden conocido. CLOSE ejecuta decisiones basadas en cierre. DECISION en el worker usa el último cierre completo como proxy de precio conocido al momento del comando, no una cotización real de libro; se identifica como tal. Los fills intravela conservan marcas de procesamiento y no inventan ticks. Esta aproximación de precio/latencia en operación sigue siendo una limitación.

## Pruebas y efectos medidos

Los nuevos contratos comprueban los seis rechazos históricos, límite neto de riesgo al fill, volumen actual cambiado sin alterar fill de apertura, falta de observación previa, capacidad compartida entre cuentas, gasto reconstruido tras reinicio, parciales rechazados sin borrar inventario, cierre seguro y dust. La integración añade PostgreSQL concurrente y HTTP reales, aprobación pendiente, bloqueo de entradas y cadena Kafka con reinicio/reentrega.

En la semana original, las señales técnicas V2 siguen idénticas. El motor anterior cerró 28 trades por −3,1064573288 USDT; el corregido cerró 20 por −2,3541771367 USDT. En este replay concreto se rechazan cinco en ejecución por STOP_NOT_BELOW_REFERENCE y tres al reservar por AVERAGING_DOWN_BLOCKED. Uno de los seis casos de geometría queda impedido antes de llegar al ejecutor. Las seis pruebas independientes sí ejercitan el guard de ejecución de cada caso. No atribuir esa diferencia de motor a una mejora de BTC-V3.

No se aplicó la migración nueva a la base operativa ni se desplegó nuevo API/worker operativo. La migración aditiva sólo registra las nuevas versiones, sin tocar cuentas/saldos/órdenes; se probó en bases aisladas. Se recuperó Docker y arrancaron sólo las dependencias PostgreSQL/Redis/Kafka para pruebas. Las tres cuentas permanecen pausadas y sin aprobaciones.
