-- Shop (guest checkout) purchases already live in stripe_orders /
-- paypal_orders. Record what was bought, the email the buyer gave for
-- their copy, and whether the PDF was emailed. A row with a resource_id
-- is a shop purchase.
ALTER TABLE stripe_orders
  ADD COLUMN resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  ADD COLUMN buyer_email VARCHAR(255),
  ADD COLUMN emailed_at TIMESTAMP,
  ADD COLUMN email_error TEXT;

ALTER TABLE paypal_orders
  ADD COLUMN resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  ADD COLUMN buyer_email VARCHAR(255),
  ADD COLUMN emailed_at TIMESTAMP,
  ADD COLUMN email_error TEXT;
