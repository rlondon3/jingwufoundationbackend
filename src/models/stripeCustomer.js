import pool from '../config/database.js';

export class StripeCustomer {
	static async create({ userId, customerId }) {
		const query = `
      INSERT INTO stripe_customers (user_id, customer_id, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      RETURNING *
    `;

		const result = await pool.query(query, [userId, customerId]);
		return result.rows[0];
	}

	static async findByUserId(userId) {
		const query = `
      SELECT * FROM stripe_customers 
      WHERE user_id = $1 AND deleted_at IS NULL
    `;

		const result = await pool.query(query, [userId]);
		return result.rows[0];
	}

	static async findByCustomerId(customerId) {
		const query = `
      SELECT * FROM stripe_customers 
      WHERE customer_id = $1 AND deleted_at IS NULL
    `;

		const result = await pool.query(query, [customerId]);
		return result.rows[0];
	}
}
