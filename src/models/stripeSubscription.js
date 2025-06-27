import pool from '../config/database.js';

export class StripeSubscription {
	static async upsert(subscriptionData) {
		const {
			customerId,
			subscriptionId,
			priceId,
			currentPeriodStart,
			currentPeriodEnd,
			cancelAtPeriodEnd,
			paymentMethodBrand,
			paymentMethodLast4,
			status,
		} = subscriptionData;

		const query = `
      INSERT INTO stripe_subscriptions (
        customer_id, subscription_id, price_id, current_period_start,
        current_period_end, cancel_at_period_end, payment_method_brand,
        payment_method_last4, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (customer_id)
      DO UPDATE SET
        subscription_id = EXCLUDED.subscription_id,
        price_id = EXCLUDED.price_id,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        payment_method_brand = EXCLUDED.payment_method_brand,
        payment_method_last4 = EXCLUDED.payment_method_last4,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *
    `;

		const result = await pool.query(query, [
			customerId,
			subscriptionId,
			priceId,
			currentPeriodStart,
			currentPeriodEnd,
			cancelAtPeriodEnd,
			paymentMethodBrand,
			paymentMethodLast4,
			status,
		]);

		return result.rows[0];
	}

	static async findByCustomerId(customerId) {
		const query = `
      SELECT * FROM stripe_subscriptions 
      WHERE customer_id = $1 AND deleted_at IS NULL
    `;

		const result = await pool.query(query, [customerId]);
		return result.rows[0];
	}
}
