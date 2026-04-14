# volBot - Sistema de Trading Automatizado Multi-Usuario

[![NestJS](https://img.shields.io/badge/NestJS-11.x-ec1a63?style=flat-square)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13%2B-336791?style=flat-square)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=flat-square)](https://redis.io)

---

## Descripción

**volBot** es un sistema de trading automatizado para Binance con soporte multi-usuario.

**Características:**
- Multi-usuario: cada usuario con credenciales y capital independiente
- Notificaciones privadas por Telegram y WhatsApp
- Multi-símbolo y multi-timeframe
- Análisis IA opcional: filtro pre-compra via Ollama (LLM local), controlado por variable de entorno
- Multi-tenancy real: datos y órdenes aislados por usuario

---

## Arquitectura

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
| **Análisis IA** | Ollama (LLM local, qwen2.5) |

---

## Inicio Rápido

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

#### 1. Crear Usuario

```sql
INSERT INTO users (email, name, capital_for_signals, capital_per_trade, profit_margin, sell_margin)
VALUES ('trader@example.com', 'Juan Trader', 1000, 50, 0.005, 0.004);
```

#### 2. Configurar Canales de Notificación

```sql
UPDATE users SET 
  telegram_chat_id = '123456789',      -- Obtener de Telegram Bot
  whatsapp_number = '+54911234567'     -- Formato internacional
WHERE email = 'trader@example.com';
```

#### 3. Agregar Símbolos a Tradear

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

## Documentación

Ver variables de entorno en `.env.example`.

---

## Estructura del Proyecto

```
src/
├── app.module.ts
├── main.ts
├── binance/
│   ├── services/
│   │   ├── binance-multi-ws.service.ts      # WebSockets multi-símbolo
│   │   └── multi-binance.service.ts
│   ├── interfaces/
│   └── binance.module.ts
├── strategy/
│   ├── services/
│   │   ├── multi-user-strategy.service.ts   # Estrategia principal multi-usuario
│   │   ├── ai-analysis.service.ts           # Filtro IA pre-compra via Ollama
│   │   ├── signal-database.service.ts
│   │   └── candle-cache.service.ts
│   ├── entities/
│   ├── interfaces/
│   └── strategy.module.ts
├── notifications/
│   ├── telegram.service.ts
│   ├── whatsapp.service.ts
│   └── notifications.module.ts
├── users/
│   ├── entities/
│   │   ├── user.entity.ts
│   │   ├── user-credentials.entity.ts
│   │   └── user-trade-config.entity.ts
│   ├── services/
│   └── users.module.ts
├── auth/
└── utils/
    └── indicators.ts
```

---

## Flujo de Funcionamiento

```
1. Sistema inicia
   └─> Lee configuraciones de usuarios en BD

2. BinanceMultiWsService
   └─> Crea WebSocket para cada símbolo requerido
       (compartido entre usuarios que lo necesiten)

3. Al llegar vela completada
   └─> MultiUserStrategyService.processCandle()
       ├─> Agrega vela al cache (por símbolo)
       ├─> Calcula indicadores técnicos (RSI, MACD, BB, ATR, SMA/EMA, volumen)
       └─> Para cada usuario con este símbolo:
           ├─> Evalúa condiciones de mercado (6 condiciones)
           ├─> Si pasan >= 5/6 condiciones:
           │   ├─> [ANALISIS_IA=true] AiAnalysisService: consulta Ollama con contexto completo
           │   │   ├─> APPROVE + confidence >= IA_MIN_CONFIDENCE => genera orden
           │   │   └─> REJECT o timeout => bloquea o deja pasar (según IA_BLOCKS_TRADES)
           │   └─> [ANALISIS_IA=false] genera orden directamente
           └─> Envía notificación privada al usuario

4. Orden generada
   └─> MultiBinanceService
       └─> Ejecuta con credenciales del usuario (MARKET buy + LIMIT/OCO sell)
```

---

## Seguridad

**Multi-tenancy real:**
- Cada usuario opera con sus credenciales propias
- Las órdenes están filtradas por usuario_id
- Las notificaciones son privadas

**Aislamiento de datos:**
- Base de datos normalizada, índices por usuario
- Queries filtradas por usuario_id

**Pendiente para producción:**
- Encriptación de credenciales API
- Rate limiting por usuario
- MFA

---

## Monitoreo

Logs en tiempo real con `docker compose logs -f app`.

Ejemplo de salida:
```
MultiUserStrategyService - Estrategia inicializada - Modo: PAPER TRADING
MultiUserStrategyService - WebSocket conectado: BTCUSDT 1m
AiAnalysisService        - [AiAnalysis][Usuario x] Compra aprobada (ollama) conf=0.781
MultiUserStrategyService - [Usuario x] GENERANDO SEÑAL DE COMPRA a 84320.50
```

---

## Variables de Entorno

```env
# Binance
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
BINANCE_TESTNET=true

# Notificaciones
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id

WHATSAPP_ENABLED=false
WHATSAPP_NUMBER=+5491123456789

# Trading
PAPER_TRADING=true
PORT=3000

# Base de Datos
DB_HOST=db
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=postgres
REDIS_URL=redis://redis:6379

# Análisis IA (Ollama)
# ANALISIS_IA=false      => la IA no interviene, opera como siempre
# ANALISIS_IA=true       => cada señal candidata de compra pasa por Ollama
# IA_BLOCKS_TRADES=false => si Ollama falla/timeout, permite la operación igual
# IA_BLOCKS_TRADES=true  => si Ollama falla/timeout, bloquea por seguridad
ANALISIS_IA=false
IA_BLOCKS_TRADES=false
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:1.5b-instruct
OLLAMA_TIMEOUT_MS=20000
IA_MIN_CONFIDENCE=0.65
```

---

## Testing

```bash
npm run test
npm run test:cov
npm run test:e2e
```

---

## Roadmap

**Completado:**
- Multi-usuario con credenciales y capital independiente
- Notificaciones privadas por usuario (Telegram / WhatsApp)
- WebSockets multi-símbolo
- Análisis IA opcional via Ollama

**En desarrollo:**
- Dashboard web
- Backtesting multi-usuario
- API REST completa

---

## Licencia

Privado - Todos los derechos reservados

Si necesitás ayuda para expandirlo o integrarlo con Binance, avisame.

---

## Licencia

MIT License
