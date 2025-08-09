-- Remove PayPal capture ID from orders table
  DROP INDEX IF EXISTS idx_orders_paypal_capture_id;
  ALTER TABLE orders DROP COLUMN IF EXISTS paypal_capture_id;