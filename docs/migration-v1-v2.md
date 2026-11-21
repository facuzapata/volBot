# Migración progresiva V1 → V2

La implementación está en la rama `feature/volbot-v2-event-driven`. No se hicieron commits de los cambios preexistentes ni push.

Antes de cambiar de rama se copiaron y verificaron por hash los siete archivos modificados en una carpeta temporal `volbot-pre-v2-*`. No se usó stash, reset ni clean. `docker-compose.yml` y el código IA previo se conservaron; V2 tiene configuración Compose y entorno separados.

## Qué se conserva

- Fórmulas originales de indicadores, sin sustituciones silenciosas.
- Criterios técnicos de la estrategia multiusuario, extraídos como legacy-v1.
- Clases y entidades V1, fuera del arranque V2.
- Documentación de referencia V1 en `docs/v1/README.md`.
- Historial Signal/Movement y credenciales en su base original, que V2 no consulta.

## Qué cambia

- API y worker usan sólo módulos V2.
- Los métodos de envío/cancelación real heredados fallan siempre. Cambiar PAPER_TRADING o TRADING_MODE no habilita LIVE.
- La API V2 tiene DTOs estrictos, salida sin secretos y revalidación de usuario/token.
- El script Docker predeterminado ahora es funcional para V2. El Compose V1 previo no es la ruta de despliegue recomendada.
- El backtest histórico inválido queda explícitamente archivado y omitido; no cuenta como evidencia de rentabilidad.

## Procedimiento

1. Respaldar y registrar el estado V1 sin modificarlo.
2. Crear base y volúmenes V2 independientes.
3. Aplicar exclusivamente la migración aditiva V2.
4. Crear usuarios nuevos de simulación y capital virtual.
5. Verificar snapshots, concurrencia, reentregas y reinicios antes de habilitar entradas PAPER.
6. Comparar estrategias con datos cronológicos y costos.

La transición a LIVE no está implementada y requiere otro trabajo autorizado: auditoría, permisos mínimos, cifrado, reconciliación real y protección externa. No se convierte una posición histórica real en saldo virtual.
