SELECT 
  s.id, 
  s.symbol, 
  s."initialPrice", 
  s.status, 
  s."createdAt", 
  m.id as movement_id, 
  m.type as movement_type, 
  m.price, 
  m.quantity, 
  m.status as movement_status, 
  m."binanceOrderId"
FROM signals s 
LEFT JOIN movements m ON s.id = m.signal_id 
WHERE s.status IN ('active', 'matched') 
ORDER BY s."createdAt" DESC 
LIMIT 10;
