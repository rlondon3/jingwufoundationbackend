 -- PayPal customers table
  CREATE TABLE paypal_customers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      payer_id VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL,
      UNIQUE(user_id),
      UNIQUE(payer_id)
  );

  -- PayPal subscriptions table
  CREATE TABLE paypal_subscriptions (
      id SERIAL PRIMARY KEY,
      payer_id VARCHAR(255) NOT NULL,
      subscription_id VARCHAR(255) UNIQUE,
      plan_id VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      start_time TIMESTAMP,
      next_billing_time TIMESTAMP,
      subscription_status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL,
      UNIQUE(payer_id)
  );

  -- PayPal orders table
  CREATE TABLE paypal_orders (
      id SERIAL PRIMARY KEY,
      paypal_order_id VARCHAR(255) NOT NULL UNIQUE,
      payer_id VARCHAR(255),
      amount_value DECIMAL(10,2) NOT NULL,
      amount_currency VARCHAR(3) DEFAULT 'USD',
      payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      capture_id VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL
  );

  -- Add PayPal order ID to existing orders table
  ALTER TABLE orders ADD COLUMN paypal_order_id VARCHAR(255);

  -- Create indexes for performance
  CREATE INDEX idx_paypal_customers_user_id ON paypal_customers(user_id);
  CREATE INDEX idx_paypal_customers_payer_id ON paypal_customers(payer_id);
  CREATE INDEX idx_paypal_subscriptions_payer_id ON paypal_subscriptions(payer_id);
  CREATE INDEX idx_paypal_subscriptions_subscription_id ON paypal_subscriptions(subscription_id);
  CREATE INDEX idx_paypal_orders_paypal_order_id ON paypal_orders(paypal_order_id);
  CREATE INDEX idx_paypal_orders_payer_id ON paypal_orders(payer_id);
  CREATE INDEX idx_orders_paypal_order_id ON orders(paypal_order_id);