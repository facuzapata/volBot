-- Migration script para sistema multi-usuario
-- Fecha: 2025-10-09

-- 1. Crear tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    capital_for_signals DECIMAL(10,2) DEFAULT 100.00,
    profit_margin DECIMAL(5,4) DEFAULT 0.0050,
    sell_margin DECIMAL(5,4) DEFAULT 0.0040,
    max_active_signals INTEGER DEFAULT 3,
    is_active BOOLEAN DEFAULT true,
    capital_per_trade DECIMAL(5,2) DEFAULT 20.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Crear tabla de credenciales de usuario
CREATE TABLE IF NOT EXISTS user_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key VARCHAR(255) NOT NULL,
    api_secret VARCHAR(255) NOT NULL,
    is_testnet BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    description VARCHAR(255),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Agregar campo user_id a la tabla signals (nullable para compatibilidad)
ALTER TABLE signals 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 4. Crear índices para optimización
CREATE INDEX IF NOT EXISTS idx_signals_user_id ON signals(user_id);
CREATE INDEX IF NOT EXISTS idx_signals_user_status ON signals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- 5. Insertar usuarios de prueba (opcional - comentar en producción)
-- INSERT INTO users (email, name, capital_for_signals, capital_per_trade, max_active_signals) 
-- VALUES 
-- ('user1@example.com', 'Usuario 1', 100.00, 20.00, 3),
-- ('user2@example.com', 'Usuario 2', 200.00, 40.00, 5);

-- 6. Insertar credenciales de prueba (opcional - comentar en producción)
-- Nota: Reemplazar con credenciales reales de Binance Testnet
-- INSERT INTO user_credentials (api_key, api_secret, is_testnet, user_id)
-- SELECT 'your_api_key_here', 'your_api_secret_here', true, id FROM users WHERE email = 'user1@example.com';

-- 7. Comentarios y notas
-- - Las señales existentes tendrán user_id = NULL (compatibilidad hacia atrás)
-- - Se puede migrar señales existentes a un usuario específico si es necesario
-- - Los nuevos servicios multi-usuario manejarán automáticamente el user_id
-- - Para testing, usar Binance Testnet (is_testnet = true)

-- 8. Verificar la migración
-- SELECT 'Migration completed successfully' as status;