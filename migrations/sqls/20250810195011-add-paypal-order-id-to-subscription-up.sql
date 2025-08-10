-- Add paypal_order_id column to subscriptions table
  ALTER TABLE subscriptions
  ADD COLUMN paypal_order_id VARCHAR(255) UNIQUE;

  -- Create index for better query performance
  CREATE INDEX idx_subscriptions_paypal_order_id ON subscriptions(paypal_order_id);