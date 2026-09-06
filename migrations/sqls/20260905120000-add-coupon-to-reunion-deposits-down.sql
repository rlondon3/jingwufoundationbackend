ALTER TABLE reunion_deposits
  DROP COLUMN IF EXISTS coupon_code;

-- Any discounted amount that was not a whole number of dollars is rounded.
ALTER TABLE reunion_deposits
  ALTER COLUMN amount_usd TYPE INTEGER USING ROUND(amount_usd)::INTEGER;
