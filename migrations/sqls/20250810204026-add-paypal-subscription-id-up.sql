  -- Add paypal_subscription_id column to subscriptions table
  ALTER TABLE subscriptions
  ADD COLUMN paypal_subscription_id VARCHAR(255) UNIQUE;

  -- Add index for performance
  CREATE INDEX idx_subscriptions_paypal_subscription_id
  ON subscriptions(paypal_subscription_id);