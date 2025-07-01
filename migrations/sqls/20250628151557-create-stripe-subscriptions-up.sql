CREATE TABLE stripe_subscriptions (
  id SERIAL PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL UNIQUE,
  subscription_id VARCHAR(255) NULL,
  price_id VARCHAR(255) NULL,
  current_period_start INTEGER NULL,
  current_period_end INTEGER NULL,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  payment_method_brand VARCHAR(50) NULL,
  payment_method_last4 VARCHAR(4) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_stripe_subscriptions_customer_id ON stripe_subscriptions(customer_id);
CREATE INDEX idx_stripe_subscriptions_subscription_id ON stripe_subscriptions(subscription_id);