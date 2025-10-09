-- Script para identificar y corregir señales inconsistentes
-- Primero, ver todas las señales activas con sus movimientos

SELECT 
    s.id, 
    s.status, 
    s."initialPrice", 
    s."createdAt",
    COUNT(m.id) as movement_count,
    COUNT(CASE WHEN m.type = 'BUY' AND m.status = 'FILLED' THEN 1 END) as buy_filled,
    COUNT(CASE WHEN m.type = 'SELL' AND m.status = 'FILLED' THEN 1 END) as sell_filled,
    CASE 
        WHEN COUNT(CASE WHEN m.type = 'BUY' AND m.status = 'FILLED' THEN 1 END) > 0 
             AND COUNT(CASE WHEN m.type = 'SELL' AND m.status = 'FILLED' THEN 1 END) > 0 
        THEN 'SHOULD_BE_MATCHED'
        WHEN COUNT(CASE WHEN m.type = 'BUY' AND m.status = 'FILLED' THEN 1 END) > 0 
             AND COUNT(CASE WHEN m.type = 'SELL' AND m.status = 'FILLED' THEN 1 END) = 0 
        THEN 'ACTIVE_BUY'
        ELSE 'NO_FILLS'
    END as actual_status
FROM signals s 
LEFT JOIN movements m ON s.id = m."signalId" 
WHERE s.status = 'active'
GROUP BY s.id, s.status, s."initialPrice", s."createdAt" 
ORDER BY s."createdAt" DESC;
