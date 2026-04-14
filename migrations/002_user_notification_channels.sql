-- Migration: Agregar canales de notificación por usuario
-- Descripción: Permite a cada usuario tener su propio chat de Telegram y número de WhatsApp
-- Fecha: 2026-04-12

-- 1. Agregar columnas de notificación a la tabla users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS telegram_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN DEFAULT true;

-- 2. Crear índices para búsquedas rápidas de usuarios por canal
CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON users(telegram_chat_id) 
WHERE telegram_chat_id IS NOT NULL AND telegram_enabled = true;

CREATE INDEX IF NOT EXISTS idx_users_whatsapp_number ON users(whatsapp_number) 
WHERE whatsapp_number IS NOT NULL AND whatsapp_enabled = true;

-- 3. Comentarios
-- telegram_chat_id: Identificador único del chat privado en Telegram (obtenido al autenticar)
-- whatsapp_number: Número de WhatsApp en formato internacional (ej: +541111111111)
-- telegram_enabled: Flag para deshabilitar notificaciones por Telegram sin borrar datos
-- whatsapp_enabled: Flag para deshabilitar notificaciones por WhatsApp sin borrar datos

-- Verificación
SELECT 'Migration 002 completed successfully' as status;
