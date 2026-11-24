ALTER TABLE stripe_orders
  DROP COLUMN IF EXISTS resource_id,
  DROP COLUMN IF EXISTS buyer_email,
  DROP COLUMN IF EXISTS emailed_at,
  DROP COLUMN IF EXISTS email_error;

ALTER TABLE paypal_orders
  DROP COLUMN IF EXISTS resource_id,
  DROP COLUMN IF EXISTS buyer_email,
  DROP COLUMN IF EXISTS emailed_at,
  DROP COLUMN IF EXISTS email_error;
