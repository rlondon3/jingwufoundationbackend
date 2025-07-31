 CREATE TABLE subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
      subscription_type VARCHAR(50) NOT NULL, -- 'ai_sifu', 'course', 'qa', 'premium', etc.
      resource_id INTEGER NULL, -- course_id, resource_id, etc. for type-specific subscriptions
      status VARCHAR(50) NOT NULL, -- 'active', 'canceled', 'past_due', 'incomplete', etc.
      current_period_start TIMESTAMP NOT NULL,
      current_period_end TIMESTAMP NOT NULL,
      cancel_at_period_end BOOLEAN DEFAULT FALSE,
      price_cents INTEGER NOT NULL, -- subscription price in cents
      currency VARCHAR(3) DEFAULT 'usd',
      metadata JSONB DEFAULT '{}', -- flexible metadata for different subscription types
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Indexes for performance
  CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
  CREATE INDEX idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);
  CREATE INDEX idx_subscriptions_type ON subscriptions(subscription_type);
  CREATE INDEX idx_subscriptions_status ON subscriptions(status);
  CREATE INDEX idx_subscriptions_user_type ON subscriptions(user_id, subscription_type);
  CREATE INDEX idx_subscriptions_resource ON subscriptions(subscription_type, resource_id);