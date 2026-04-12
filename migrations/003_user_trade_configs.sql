-- Migration: Crear tabla de configuración de símbolos por usuario
-- Descripción: Permite a cada usuario tradear múltiples símbolos/timeframes
-- Fecha: 2026-04-12

-- 1. Crear tabla de configuración de trading por símbolo
CREATE TABLE IF NOT EXISTS user_trade_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    timeframe_minutes INT NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    
    -- Overrides (null = usar valores por defecto del usuario)
    profit_margin_override DECIMAL(5,4),
    sell_margin_override DECIMAL(5,4),
    max_active_signals_override INT,
    capital_per_trade_override DECIMAL(5,2),
    
    notes VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Restricción única: un usuario no puede tener dos configs para el mismo símbolo/timeframe
    CONSTRAINT unique_user_symbol_timeframe UNIQUE(user_id, symbol, timeframe_minutes)
);

-- 2. Crear índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_user_trade_configs_user_id ON user_trade_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_trade_configs_symbol ON user_trade_configs(symbol, is_enabled);
CREATE INDEX IF NOT EXISTS idx_user_trade_configs_timeframe ON user_trade_configs(timeframe_minutes);
CREATE INDEX IF NOT EXISTS idx_user_trade_configs_active ON user_trade_configs(user_id, is_enabled) 
WHERE is_enabled = true;

-- 3. Insertar configuraciones de ejemplo (comentado para producción)
-- Ejemplo: Usuario tradea BTC 1m y 5m, ETH 1m
-- INSERT INTO user_trade_configs (user_id, symbol, timeframe_minutes, notes)
-- SELECT id, 'BTCUSDT', 1, 'Bitcoin 1 minuto' FROM users LIMIT 1;
-- INSERT INTO user_trade_configs (user_id, symbol, timeframe_minutes, notes)
-- SELECT id, 'BTCUSDT', 5, 'Bitcoin 5 minutos' FROM users LIMIT 1;
-- INSERT INTO user_trade_configs (user_id, symbol, timeframe_minutes, notes)
-- SELECT id, 'ETHUSDT', 1, 'Ethereum 1 minuto' FROM users LIMIT 1;

-- Verificación
SELECT 'Migration 003 completed successfully' as status;
