ALTER TABLE orders DROP CONSTRAINT IF EXISTS uk_orders_stripe_checkout_session;
DROP INDEX IF EXISTS idx_orders_completed_at;
DROP INDEX IF EXISTS idx_orders_stripe_payment_intent;
DROP INDEX IF EXISTS idx_orders_stripe_checkout_session;
ALTER TABLE orders DROP COLUMN IF EXISTS stripe_checkout_session_id;