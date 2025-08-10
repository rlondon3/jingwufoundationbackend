  -- Make stripe_subscription_id nullable for PayPal subscriptions
  ALTER TABLE subscriptions
  ALTER COLUMN stripe_subscription_id DROP NOT NULL;