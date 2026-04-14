-- Migration: Agregar status STOPPED a signals.status
-- Fecha: 2026-04-13

DO $$
DECLARE
    status_data_type text;
    status_udt_name text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'signals'
    ) THEN
        RAISE NOTICE 'La tabla public.signals no existe. No se aplica migracion.';
        RETURN;
    END IF;

    SELECT c.data_type, c.udt_name
    INTO status_data_type, status_udt_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'signals'
      AND c.column_name = 'status';

    IF status_data_type IS NULL THEN
        RAISE NOTICE 'La columna public.signals.status no existe. No se aplica migracion.';
        RETURN;
    END IF;

    IF status_data_type IN ('character varying', 'text') THEN
        RAISE NOTICE 'public.signals.status usa %; no hay enum que actualizar.', status_data_type;
        RETURN;
    END IF;

    IF status_data_type = 'USER-DEFINED' AND status_udt_name IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
            FROM pg_type t
            WHERE t.typname = status_udt_name
        ) THEN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_enum e
                INNER JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = status_udt_name
                  AND e.enumlabel = 'stopped'
            ) THEN
                EXECUTE format('ALTER TYPE %I ADD VALUE ''stopped''', status_udt_name);
            END IF;
        ELSE
            RAISE NOTICE 'El tipo % de public.signals.status no existe en pg_type.', status_udt_name;
        END IF;
        RETURN;
    END IF;

    RAISE NOTICE 'Tipo de public.signals.status no manejado: %, udt_name=%', status_data_type, status_udt_name;
END $$;

-- Verificacion
SELECT c.table_name, c.column_name, c.data_type, c.udt_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
    AND c.table_name = 'signals'
    AND c.column_name = 'status';

SELECT t.typname, e.enumlabel
FROM pg_type t
INNER JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = (
        SELECT c.udt_name
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
            AND c.table_name = 'signals'
            AND c.column_name = 'status'
            AND c.data_type = 'USER-DEFINED'
)
ORDER BY t.typname, e.enumsortorder;