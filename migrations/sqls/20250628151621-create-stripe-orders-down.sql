DROP INDEX IF EXISTS idx_stripe_orders_payment_intent_id;
DROP INDEX IF EXISTS idx_stripe_orders_checkout_session_id;
DROP INDEX IF EXISTS idx_stripe_orders_customer_id;
DROP TABLE IF EXISTS stripe_orders;