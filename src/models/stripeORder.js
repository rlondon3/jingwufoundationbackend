import pool from '../config/database.js';

export class StripeOrder {
	static async create(orderData) {
		const {
			checkoutSessionId,
			paymentIntentId,
			customerId,
			amountSubtotal,
			amountTotal,
			currency,
			paymentStatus,
			status = 'completed',
		} = orderData;

		const query = `
      INSERT INTO stripe_orders (
        checkout_session_id, payment_intent_id, customer_id,
        amount_subtotal, amount_total, currency, payment_status,
        status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `;

		const result = await pool.query(query, [
			checkoutSessionId,
			paymentIntentId,
			customerId,
			amountSubtotal,
			amountTotal,
			currency,
			paymentStatus,
			status,
		]);

		return result.rows[0];
	}

	static async findByCustomerId(customerId) {
		const query = `
      SELECT * FROM stripe_orders 
      WHERE customer_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;

		const result = await pool.query(query, [customerId]);
		return result.rows;
	}
}
