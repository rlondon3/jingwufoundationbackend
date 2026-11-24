ALTER TABLE stripe_orders DROP COLUMN IF EXISTS newsletter_opt_in;
ALTER TABLE paypal_orders DROP COLUMN IF EXISTS newsletter_opt_in;
