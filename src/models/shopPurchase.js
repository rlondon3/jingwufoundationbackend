// models/shopPurchase.js
require('dotenv').config();

/**
 * Shop (guest checkout) purchases, read across the existing stripe_orders
 * and paypal_orders tables. A row with a resource_id is a shop purchase.
 */

const TABLES = {
	stripe: { table: 'stripe_orders', ref: 'checkout_session_id' },
	paypal: { table: 'paypal_orders', ref: 'paypal_order_id' },
};

const tableFor = (provider) => {
	const t = TABLES[provider];
	if (!t) throw new Error(`Unknown provider: ${provider}`);
	return t;
};

class ShopPurchaseStore {
	constructor(pool) {
		this.pool = pool;
	}

	// Completed shop purchases, newest first
	async list() {
		const res = await this.pool.query(
			`SELECT * FROM (
			   SELECT 'stripe' AS provider, s.id, s.checkout_session_id AS order_ref,
			          s.resource_id, r.title AS resource_title,
			          ROUND(s.amount_total / 100.0, 2) AS amount, UPPER(s.currency) AS currency,
			          s.buyer_email, s.emailed_at, s.email_error, s.created_at
			   FROM stripe_orders s
			   LEFT JOIN resources r ON r.id = s.resource_id
			   WHERE s.resource_id IS NOT NULL AND s.status = 'completed'
			     AND s.deleted_at IS NULL
			   UNION ALL
			   SELECT 'paypal', p.id, p.paypal_order_id,
			          p.resource_id, r.title,
			          p.amount_value, p.amount_currency,
			          p.buyer_email, p.emailed_at, p.email_error, p.created_at
			   FROM paypal_orders p
			   LEFT JOIN resources r ON r.id = p.resource_id
			   WHERE p.resource_id IS NOT NULL AND p.payment_status = 'COMPLETED'
			     AND p.deleted_at IS NULL
			 ) purchases
			 ORDER BY created_at DESC`
		);
		return res.rows;
	}

	async findById(provider, id) {
		const { table } = tableFor(provider);
		const res = await this.pool.query(
			`SELECT id, resource_id, buyer_email, emailed_at FROM ${table} WHERE id = $1`,
			[id]
		);
		return res.rows[0];
	}

	/**
	 * Claim the automatic email for a just-paid order, so the webhook and
	 * the success page can't both send it. Returns the row, or undefined
	 * if it isn't a shop order with an email or was already claimed.
	 */
	async claimAutoEmail(provider, orderRef) {
		const { table, ref } = tableFor(provider);
		const res = await this.pool.query(
			`UPDATE ${table} SET emailed_at = NOW(), email_error = NULL
			 WHERE ${ref} = $1 AND resource_id IS NOT NULL
			   AND buyer_email IS NOT NULL AND emailed_at IS NULL
			 RETURNING id, resource_id, buyer_email`,
			[orderRef]
		);
		return res.rows[0];
	}

	async recordEmailSent(provider, id, email) {
		const { table } = tableFor(provider);
		await this.pool.query(
			`UPDATE ${table} SET emailed_at = NOW(), email_error = NULL, buyer_email = $2
			 WHERE id = $1`,
			[id, email]
		);
	}

	async recordEmailFailed(provider, id, error) {
		const { table } = tableFor(provider);
		await this.pool.query(
			`UPDATE ${table} SET emailed_at = NULL, email_error = $2 WHERE id = $1`,
			[id, String(error).slice(0, 1000)]
		);
	}
}

module.exports = { ShopPurchaseStore };
