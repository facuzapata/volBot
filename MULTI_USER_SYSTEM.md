# Sistema Multi-Usuario - volBot

## Resumen de Cambios

Se ha implementado un sistema multi-usuario que permite que múltiples usuarios operen con sus propias credenciales de Binance y configuraciones personalizadas de trading.

## Arquitectura

### Servicios Principales

1. **MultiBinanceService**: Maneja múltiples clientes de Binance, uno por usuario
2. **MultiUserStrategyService**: Ejecuta estrategias de trading personalizadas por usuario
3. **UsersService**: Gestiona usuarios y sus credenciales

### Entidades

- **User**: Información del usuario y configuración de trading
- **UserCredentials**: Credenciales de API de Binance por usuario
- **Signal**: Señales de trading (ahora incluye `userId`)

## Configuración

### 1. Migración de Base de Datos

Ejecutar el script de migración:

```sql
-- Ver migrations/001_multi_user_system.sql
```

### 2. Variables de Entorno

Las mismas variables existentes, pero ahora cada usuario tendrá sus propias credenciales en la base de datos.

### 3. Usuarios de Prueba

```typescript
// Crear usuario
POST /users
{
  "email": "test@example.com",
  "name": "Usuario Test",
  "capitalPerTrade": 20,
  "maxActiveSignals": 3,
  "profitMargin": 0.005,
  "sellMargin": 0.004
}

// Agregar credenciales
POST /users/{userId}/credentials
{
  "apiKey": "your_binance_api_key",
  "apiSecret": "your_binance_api_secret",
  "isTestnet": true,
  "description": "Testnet credentials"
}
```

## Compatibilidad hacia atrás

### Servicios Originales (Comentados para backup)

- `BinanceService` → Comentado, reemplazado por `MultiBinanceService`
- `StrategyService` → Comentado, reemplazado por `MultiUserStrategyService`

### Para volver a la implementación original:

1. Descomentar los servicios originales en los módulos
2. Comentar los nuevos servicios multi-usuario
3. Revertir los cambios en `BinanceWsService`

## Funcionalidades

### Por Usuario

- **Credenciales independientes**: Cada usuario opera con sus propias API keys
- **Configuración personalizada**: Capital, márgenes, límites por usuario
- **Aislamiento de señales**: Las señales están separadas por usuario
- **Estadísticas individuales**: Tracking de performance por usuario

### Eficiencia

- **Un WebSocket por símbolo**: Compartido entre todos los usuarios
- **Indicadores técnicos compartidos**: Calculados una vez, usados por todos
- **Pool de clientes**: Clientes de Binance reutilizables por usuario

## API Endpoints

```typescript
GET    /users              // Listar todos los usuarios
GET    /users/active       // Listar usuarios activos
GET    /users/:id          // Obtener usuario por ID
POST   /users              // Crear usuario
POST   /users/:id/credentials // Agregar credenciales
PUT    /users/:id/config   // Actualizar configuración
PUT    /users/:id/status   // Activar/desactivar usuario
```

## Logs

Los logs ahora incluyen el identificador del usuario:

```
🟢 [Usuario abc123] SEÑAL DE COMPRA creada: 45000 | Size: 0.0005
📊 [Usuario abc123] Señales activas: 2/3
❌ [Usuario xyz789] Error ejecutando orden de compra: ...
```

## Monitoreo

### Estadísticas por Usuario

```typescript
// Obtener estadísticas de un usuario específico
const stats = await signalDbService.getUserTradingStats(userId);
```

### Gestión de Usuarios en Runtime

```typescript
// Agregar usuario dinámicamente
await multiUserStrategyService.addUser(userId);
await multiBinanceService.addUser(userId);

// Remover usuario
await multiUserStrategyService.removeUser(userId);
await multiBinanceService.removeUser(userId);
```

## Consideraciones de Seguridad

1. **Credenciales encriptadas**: Considerar encriptar las API keys en la base de datos
2. **Rate limiting**: Binance tiene límites por API key
3. **Validación**: Verificar credenciales antes de activar usuarios
4. **Logs seguros**: No logear API keys o secrets

## Testing

1. **Usar Binance Testnet**: `isTestnet: true` en las credenciales
2. **Paper Trading**: Variable `PAPER_TRADING=true`
3. **Usuarios de prueba**: Scripts para crear usuarios de testing

## Próximos Pasos

1. Encriptación de credenciales
2. Dashboard de usuarios
3. API de gestión de usuarios
4. Alertas por usuario
5. Límites de riesgo por usuario
6. Soporte para múltiples símbolos por usuario