-- Remove indexes
  DROP INDEX IF EXISTS idx_orders_paypal_order_id;
  DROP INDEX IF EXISTS idx_paypal_orders_payer_id;
  DROP INDEX IF EXISTS idx_paypal_orders_paypal_order_id;
  DROP INDEX IF EXISTS idx_paypal_subscriptions_subscription_id;
  DROP INDEX IF EXISTS idx_paypal_subscriptions_payer_id;
  DROP INDEX IF EXISTS idx_paypal_customers_payer_id;
  DROP INDEX IF EXISTS idx_paypal_customers_user_id;

  -- Remove PayPal order ID from orders table
  ALTER TABLE orders DROP COLUMN IF EXISTS paypal_order_id;

  -- Drop PayPal tables
  DROP TABLE IF EXISTS paypal_orders;
  DROP TABLE IF EXISTS paypal_subscriptions;
  DROP TABLE IF EXISTS paypal_customers;