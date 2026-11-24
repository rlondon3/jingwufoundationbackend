-- Shop buyers who agreed (at checkout) to get news emails about new
-- releases. Unsubscribing sets it back to false on all their orders.
ALTER TABLE stripe_orders
  ADD COLUMN newsletter_opt_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE paypal_orders
  ADD COLUMN newsletter_opt_in BOOLEAN NOT NULL DEFAULT false;
