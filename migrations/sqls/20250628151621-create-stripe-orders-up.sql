CREATE TABLE stripe_orders (
  id SERIAL PRIMARY KEY,
  checkout_session_id VARCHAR(255) NOT NULL UNIQUE,
  payment_intent_id VARCHAR(255) NULL,
  customer_id VARCHAR(255) NOT NULL,
  amount_subtotal INTEGER NOT NULL,
  amount_total INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  payment_status VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_stripe_orders_customer_id ON stripe_orders(customer_id);
CREATE INDEX idx_stripe_orders_checkout_session_id ON stripe_orders(checkout_session_id);
CREATE INDEX idx_stripe_orders_payment_intent_id ON stripe_orders(payment_intent_id);