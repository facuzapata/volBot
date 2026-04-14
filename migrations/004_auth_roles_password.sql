-- Migration: Agregar role y password_hash a users para autenticacion segura
-- Fecha: 2026-04-13

ALTER TABLE users
ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Normalizar roles invalidos en caso de datos legacy
UPDATE users
SET role = 'user'
WHERE role IS NULL OR role NOT IN ('admin', 'user');

-- Verificacion
SELECT id, email, role, (password_hash IS NOT NULL) AS has_password
FROM users;
