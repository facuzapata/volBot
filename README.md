# volBot - Sistema de Trading Automatizado Multi-Usuario

<div align="center">

### 🤖 Bot de Trading Profesional con Soporte Multi-Usuario

[![NestJS](https://img.shields.io/badge/NestJS-11.x-ec1a63?style=flat-square)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13%2B-336791?style=flat-square)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=flat-square)](https://redis.io)

</div>

---

## 📋 Descripción

**volBot** es un sistema de trading automatizado profesional que permite a múltiples usuarios tradear simultáneamente en Binance con:

✨ **Características Principales:**
- 👥 **Multi-usuario**: Cada usuario con credenciales independientes
- 💬 **Notificaciones privadas**: Telegram y WhatsApp personalizados
- 📈 **Multi-símbolo**: Operar BTC, ETH, ADA, DOGE, etc. simultáneamente
- ⏱️ **Multi-timeframe**: 1m, 5m, 15m, 1h, 4h, etc.
- 🔐 **Totalmente seguro**: Multi-tenancy real, datos aislados por usuario
- 🚀 **Escalable**: Arquitectura profesional lista para producción

---

## 🏗️ Arquitectura

### Componentes Principales

```
BinanceMultiWsService
    ↓ (Múltiples WebSockets dinámicos)
    ├── BTC 1m
    ├── ETH 5m
    ├── ADA 1h
    └── ...

MultiUserStrategyService
    ↓ (Procesa velas por símbolo)
    ├── User A: BTC 1m
    ├── User B: ETH 5m
    └── User C: ADA 1h

MultiBinanceService
    ↓ (Ejecuta órdenes por usuario)
    ├── User A (credenciales A)
    ├── User B (credenciales B)
    └── User C (credenciales C)

Notificaciones (Telegram/WhatsApp)
    ├── User A en su chat privado
    ├── User B en su chat privado
    └── User C en su chat privado
```

### Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Framework** | NestJS 11 |
| **Lenguaje** | TypeScript 5 |
| **BD Relacional** | PostgreSQL 13+ |
| **Cache** | Redis 7 |
| **Exchange** | Binance API |
| **Notificaciones** | Telegram + WhatsApp |

---

## 🚀 Inicio Rápido

### Prerequisitos

- Node.js 18+
- PostgreSQL 13+
- Redis 7+
- Cuenta en Binance (Testnet para pruebas)

### Instalación

```bash
# Clonar repositorio
git clone <repo-url>
cd volBot

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Ejecutar migraciones
npm run migration:run

# Compilar
npm run build

# Iniciar
npm run start
```

### Configuración en 3 Pasos

#### 1️⃣ Crear Usuario

```sql
INSERT INTO users (email, name, capital_for_signals, capital_per_trade, profit_margin, sell_margin)
VALUES ('trader@example.com', 'Juan Trader', 1000, 50, 0.005, 0.004);
```

#### 2️⃣ Configurar Canales de Notificación

```sql
UPDATE users SET 
  telegram_chat_id = '123456789',      -- Obtener de Telegram Bot
  whatsapp_number = '+54911234567'     -- Formato internacional
WHERE email = 'trader@example.com';
```

#### 3️⃣ Agregar Símbolos a Tradear

```sql
-- Bitcoin 1 minuto
INSERT INTO user_trade_configs (user_id, symbol, timeframe_minutes, notes)
SELECT id, 'BTCUSDT', 1, 'Bitcoin 1 minuto'
FROM users WHERE email = 'trader@example.com';

-- Ethereum 5 minutos
INSERT INTO user_trade_configs (user_id, symbol, timeframe_minutes, notes)
SELECT id, 'ETHUSDT', 5, 'Ethereum 5 minutos'
FROM users WHERE email = 'trader@example.com';
```

---

## 📚 Documentación

- **[MULTI_USER_SYSTEM.md](./MULTI_USER_SYSTEM.md)** - Sistema multi-usuario en detalle
- **[FASE2_TRADE_CONFIGS.md](./FASE2_TRADE_CONFIGS.md)** - Configuración de símbolos por usuario
- **[FASE3_MULTI_WEBSOCKETS.md](./FASE3_MULTI_WEBSOCKETS.md)** - WebSockets multi-símbolo
- **[FASE4_STRATEGY_REFACTOR_PLAN.md](./FASE4_STRATEGY_REFACTOR_PLAN.md)** - Plan de refactorización
- **[CAMBIOS_REALIZADOS.md](./CAMBIOS_REALIZADOS.md)** - Historial de cambios

---

## 📁 Estructura del Proyecto

```
src/
├── app.module.ts
├── main.ts
├── binance/
│   ├── services/
│   │   ├── binance-multi-ws.service.ts      ✨ WebSockets multi-símbolo
│   │   └── multi-binance.service.ts
│   ├── interfaces/
│   │   └── binance-order-response.interface.ts
│   └── binance.module.ts
├── strategy/
│   ├── services/
│   │   ├── multi-user-strategy.service.ts   ✨ Estrategia multi-usuario
│   │   ├── signal-database.service.ts
│   │   └── candle-cache.service.ts
│   ├── entities/
│   ├── interfaces/
│   └── strategy.module.ts
├── notifications/
│   ├── telegram.service.ts                  ✨ Notificaciones por usuario
│   ├── whatsapp.service.ts                  ✨ Notificaciones por usuario
│   └── notifications.module.ts
├── users/
│   ├── entities/
│   │   ├── user.entity.ts
│   │   ├── user-credentials.entity.ts
│   │   └── user-trade-config.entity.ts      ✨ Configuración de símbolos
│   ├── services/
│   │   └── user-trade-config.service.ts
│   └── users.module.ts
├── trading/
│   └── trading.service.ts
└── utils/
    └── indicators.ts
```

---

## 🔄 Flujo de Funcionamiento

```
1. Sistema inicia
   └─> Lee configuraciones de usuarios en BD

2. BinanceMultiWsService
   └─> Crea WebSocket para cada símbolo requerido
       (compartido entre usuarios que lo necesiten)

3. Al llegar vela completada
   └─> MultiUserStrategyService.processCandleMulti()
       ├─> Agrega vela al cache (por símbolo)
       ├─> Calcula indicadores (por símbolo)
       └─> Para cada usuario con este símbolo:
           ├─> Analiza condiciones de mercado
           ├─> Genera señales si corresponde
           └─> Envía notificación privada

4. Órdenes generadas
   └─> MultiBinanceService
       └─> Ejecuta con credenciales del usuario
```

---

## 🔐 Seguridad

✅ **Multi-tenancy Real:**
- Cada usuario operva con sus credenciales
- Las órdenes están filtradas por usuario_id
- Las notificaciones son privadas

✅ **Aislamiento de Datos:**
- Base de datos normalizada
- Índices por usuario
- Queries filtradas por usuario_id

✅ **Mejoras para Producción:**
- Encriptación de credenciales API
- Rate limiting por usuario
- Auditoría de acciones
- MFA para acceso

---

## 📊 Monitoreo

### Logs

El sistema genera logs detallados:

```bash
npm run start

# Salida esperada:
# 🚀 Estrategia multi-usuario inicializada - Modo: PAPER TRADING
# 📥 Cargando configuración para 2 usuarios activos...
# 📡 Conectando WebSocket: BTCUSDT 1m
# ✅ WebSocket conectado: BTCUSDT 1m
# 📊 Esperando más velas para análisis técnico: 25/50
```

### Métricas (Próximas)

```
GET /metrics
  - Usuarios activos
  - WebSockets conectados
  - Señales generadas (total, por usuario)
  - Órdenes ejecutadas
  - Rendimiento por usuario
```

---

## 📝 Variables de Entorno

```env
# Binance
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
BINANCE_TESTNET=true

# Notificaciones
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id  # Fallback global

WHATSAPP_ENABLED=true
WHATSAPP_NUMBER=+5491123456789  # Fallback global

# Trading
PAPER_TRADING=true
PORT=3000

# Base de Datos
DATABASE_URL=postgresql://user:password@localhost/volbot
REDIS_URL=redis://localhost:6379
```

---

## 🧪 Testing

```bash
# Tests unitarios
npm run test

# Tests con cobertura
npm run test:cov

# Tests E2E
npm run test:e2e
```

---

## 🔄 Roadmap

### ✅ Completado

- FASE 1: Notificaciones por usuario
- FASE 2: Configuración de símbolos por usuario
- FASE 3: WebSockets multi-símbolo
- Arquitectura profesional y limpia

### 🔄 En Desarrollo

- FASE 4: Refactorización completa de estrategias

### ⏭️ Próximo

- FASE 5: Dashboard web
- FASE 6: Backtesting multi-usuario
- API REST completa con autenticación
- Monitoring y alertas avanzadas

---

## 🤝 Soporte

Para preguntas o issues, abre un issue en GitHub o contacta al equipo de desarrollo.

---

## 📄 Licencia

Privado - Todos los derechos reservados

---

<div align="center">

**Made with ❤️ by the volBot Team**

</div>

Este sistema modular y extensible permite comenzar con un trading automatizado seguro y controlado, mostrando señales en consola y gestionando trades simulados. Está preparado para escalar a integración con exchanges reales y funcionalidades avanzadas.

Si necesitás ayuda para expandirlo o integrarlo con Binance, avisame.

---

## Licencia

MIT License
