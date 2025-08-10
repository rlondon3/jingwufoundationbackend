 -- Remove paypal_order_id column from subscriptions table
  DROP INDEX IF EXISTS idx_subscriptions_paypal_order_id;
  ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS paypal_order_id;