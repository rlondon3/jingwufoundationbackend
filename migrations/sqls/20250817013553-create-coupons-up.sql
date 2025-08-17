CREATE TABLE coupons (
    id SERIAL PRIMARY KEY,
    stripe_coupon_id VARCHAR(255) NOT NULL,
    code VARCHAR(100) UNIQUE NOT NULL,
    percent_off INTEGER,
    amount_off INTEGER,
    currency VARCHAR(10),
    duration VARCHAR(20) NOT NULL,
    duration_in_months INTEGER,
    max_redemptions INTEGER,
    redeem_by TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookup by Stripe coupon ID
CREATE INDEX idx_coupons_stripe_id ON coupons (stripe_coupon_id);

-- Index for redeem_by to query active coupons
CREATE INDEX idx_coupons_redeem_by ON coupons (redeem_by);
