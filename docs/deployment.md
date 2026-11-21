# Despliegue local de simulación

Usar siempre `docker-compose.v2.yml`; el Compose previo se conserva intacto respecto de los cambios locales del usuario. Proyecto Docker `volbot-v2`, sin nombres fijos que colisionen con V1.

Servicios: API, worker, migración aditiva, PostgreSQL16, Redis7 y Kafka3.9.1 KRaft. No se usa ZooKeeper. No se instala UI Kafka pública.

Los puertos externos se enlazan a loopback: API3100, PostgreSQL15432, Redis16379 y Kafka19092, todos configurables. El worker no publica puerto externo. Los volúmenes tienen prefijo del proyecto.

```powershell
Copy-Item .env.v2.example .env.v2
# Completar secretos locales únicos; no usar claves Binance.
docker compose --env-file .env.v2 -f docker-compose.v2.yml up -d --build
docker compose --env-file .env.v2 -f docker-compose.v2.yml run --rm --no-deps api node dist/v2/cli.js seed
docker compose --env-file .env.v2 -f docker-compose.v2.yml ps
```

`V2_POSTGRES_PASSWORD` debe ser URL-safe o codificarse correctamente en la URL. Usar hex aleatorio evita ambigüedad. `V2_JWT_SECRET` necesita 32+ caracteres únicos; `V2_ADMIN_PASSWORD`, 12+.

Health: API `/api/health/live`, readiness `/api/health/ready`; worker `/health/ready` internamente en3101. Readiness requiere mercado fresco y dependencias, y puede degradarse durante precarga o caída pública. Los logs de eventos no incluyen credenciales ni respuestas financieras completas.

Shutdown: detener los procesos permite finalizar transacciones, desconectar Kafka/Redis y cerrar WebSocket. Después de reinicio, outbox/inbox y estado de cuenta recuperan el pipeline. Una sola instancia recolecta mercado mediante advisory lock; no escalar sin medir tiempos de procesamiento.

Para detener sólo V2 sin borrar volúmenes:

```powershell
docker compose --env-file .env.v2 -f docker-compose.v2.yml down
```

No usar `down -v` si se desea conservar resultados. No exponer estos puertos a Internet sin TLS, control de acceso y límites de peticiones en el ingress. La instalación local tiene un broker único y no ofrece alta disponibilidad.
