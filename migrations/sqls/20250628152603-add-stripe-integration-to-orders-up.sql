-- Add only the missing column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255) NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_stripe_checkout_session ON orders(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent ON orders(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_orders_completed_at ON orders(completed_at);

-- Add unique constraint for checkout session
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_orders_stripe_checkout_session') THEN
        ALTER TABLE orders ADD CONSTRAINT uk_orders_stripe_checkout_session UNIQUE (stripe_checkout_session_id);
    END IF;
END $$;