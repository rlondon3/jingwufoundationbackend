  -- Remove index
  DROP INDEX IF EXISTS idx_subscriptions_paypal_subscription_id;

  -- Remove paypal_subscription_id column from subscriptions table
  ALTER TABLE subscriptions
  DROP COLUMN IF EXISTS paypal_subscription_id;