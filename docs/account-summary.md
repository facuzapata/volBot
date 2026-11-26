# Diagnóstico del resumen de cuenta

## Verificado localmente

- El commit `aad3a52` no devuelve `winningTrades`, `losingTrades`,
  `breakevenTrades`, `totalBTC`, `unassignedBTC` ni `dustBTC`. Estos campos
  estaban agregados en el árbol de trabajo, sin confirmar, al comenzar la revisión.
- `ApiService.stats()` y `balance()` leen el historial persistido con
  `StoreService.readAccount()` en cada solicitud. No usan Redis ni una caché de
  respuestas. Los controladores retornan el resultado directamente. Los DTO de
  Swagger documentan la respuesta; no filtran sus propiedades.
- Los cierres se clasifican por el signo decimal de `realizedPnl`. El motor ya
  descuenta el costo de adquisición y la comisión de venta al realizar P&L;
  volver a restar comisiones en el resumen duplicaría su impacto.
- El total BTC suma `availableDelta + reservedDelta` de los movimientos BTC del
  ledger. Las transferencias entre disponible y reservado tienen efecto neto
  cero. El inventario asignado incluye DUST; `unassignedBTC` es la diferencia
  entre total y asignado. No se suma `reservedBTC` ni `dustBTC` al total.
- No hace falta generar operaciones, migrar datos ni recalcular balances
  persistidos para obtener los campos. El resumen se deriva del historial actual.

## Validación

```powershell
npm.cmd test -- --runTestsByPath test/v2/account-summary.spec.ts test/v2/api.e2e-spec.ts test/v2/paper-execution.spec.ts test/v2/backtesting.spec.ts
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Las cuatro suites pasan con 46 tests. Cubren ceros explícitos, respuestas HTTP
autenticadas con persistencia simulada, historial de cierres ganadores/perdedores/
neutros, ganancia bruta que pasa a pérdida por comisiones, compras con comisión
en BTC o USDT, salidas parciales, dust real, reservas y lectura sin mutaciones.
Lint y build pasan. El chequeo global de tipos falla en el archivo preexistente
sin seguimiento `test/v2/btc-v5-historical-range.spec.ts`: usa propiedades de
diagnóstico y parámetros de rango que no existen en los tipos actuales.

## Pendiente de confirmar en el servidor

Las consultas reales a `http://127.0.0.1:3100/api/me/stats` y
`http://127.0.0.1:3100/api/me/balance` fallaron con `ECONNREFUSED`. El daemon de
Docker no está disponible en este entorno. No hay una URL remota ni acceso al
despliegue identificados en el repositorio; la versión y las respuestas del
servidor que usa el dashboard siguen sin verificar.

Una versión construida desde `aad3a52` explica los seis campos ausentes, pero
eso es una hipótesis para el servidor, no una comprobación del despliegue.
El `dist` local ya contenía los campos y fue reconstruido durante la revisión;
esto no demuestra qué imagen está ejecutándose remotamente.

Para verificar y actualizar el despliegue:

1. Consultar los dos GET autenticados en la URL exacta usada por el dashboard,
   guardar sus cuerpos y revisar `Age`, `Cache-Control`, `Via`, `ETag` y cualquier
   cabecera de caché del proxy. Comparar con el origen directo si está disponible.
   Los ceros deben conservar número para contadores y cadena para BTC.
2. Consultar `/api/docs-json`: comprobar que `StatsDto` y `BalanceDto` declaran
   los seis campos. Comparar también el código compilado y la imagen del proceso
   que atiende la solicitud; Swagger actualizado por sí solo no prueba los valores.
3. Si el proceso usa la versión anterior, incorporar los cambios locales al
   artefacto de entrega y reconstruir/recrear la API. Un reinicio de la misma
   imagen no incorpora código nuevo. Para el Compose documentado, el comando
   acotado es:

   ```powershell
   docker compose --env-file .env.v2 -f docker-compose.v2.yml up -d --build --no-deps api
   ```

   Este comando no se ejecutó durante esta revisión. No requiere seed, migración,
   reinicio del worker ni eliminación de volúmenes para este cambio de resumen.
4. Repetir los GET contra todas las réplicas relevantes y contrastarlos con el
   historial de esa misma cuenta: los tres contadores suman `closedTrades`, y
   `totalBTC = assignedBTC + unassignedBTC`, con dust dentro de assigned.
5. Si el origen responde correctamente pero el proxy no, corregir la caché del
   proxy para respuestas privadas autenticadas. Si ambos responden correctamente,
   revisar la URL y los datos consumidos por React Query. El refresco cada 12
   segundos no puede incorporar campos que el backend no devuelve.
