-- A reunion deposit can now be discounted by a Stripe coupon, so the recorded
-- amount is no longer always the $600 list price. Widen amount_usd so it can
-- hold cents, and keep the code that was applied for reporting.
ALTER TABLE reunion_deposits
  ALTER COLUMN amount_usd TYPE NUMERIC(10,2) USING amount_usd::NUMERIC(10,2);

ALTER TABLE reunion_deposits
  ADD COLUMN coupon_code VARCHAR(255) NULL;
