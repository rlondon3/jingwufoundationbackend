  -- Make stripe_subscription_id NOT NULL again (only if no PayPal subscriptions exist)
  UPDATE subscriptions SET stripe_subscription_id = 'PAYPAL_SUB_' || id WHERE stripe_subscription_id IS NULL;
  ALTER TABLE subscriptions
  ALTER COLUMN stripe_subscription_id SET NOT NULL;
