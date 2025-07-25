UPDATE movements 
SET status = 'failed', 
    "binanceError" = '{"error": "Manual cleanup - order not executed in Binance"}'::jsonb
WHERE id = 'a7da992a-b207-4525-9cb0-6e545c80c4b1' 
  AND status = 'pending' 
  AND "binanceOrderId" IS NULL;
