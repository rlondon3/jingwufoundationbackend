// models/coupon.js
require('dotenv').config();
const Joi = require('joi');

/**
 * CouponStore handles all coupon operations
 * Manages discount codes for both Stripe and PayPal
 */
class CouponStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// COUPON OPERATIONS
	// ========================

	/**
	 * Get all coupons (admin view)
	 */
	async index() {
		try {
			const sql = `
				SELECT * FROM coupons 
				ORDER BY created_at DESC
			`;
			const result = await this.pool.query(sql);
			return result.rows;
		} catch (error) {
			console.error('Error fetching coupons:', error);
			throw error;
		}
	}

	/**
	 * Get active coupons (for dashboard display)
	 */
	async getActiveCoupons() {
		try {
			const sql = `
				SELECT code, percent_off, amount_off, currency 
				FROM coupons 
				WHERE (redeem_by IS NULL OR redeem_by > NOW())
				ORDER BY created_at DESC
				LIMIT 1
			`;
			const result = await this.pool.query(sql);
			return result.rows;
		} catch (error) {
			console.error('Error fetching active coupons:', error);
			throw error;
		}
	}

	/**
	 * Get coupon by ID
	 */
	async show(id) {
		try {
			const sql = 'SELECT * FROM coupons WHERE id = $1';
			const result = await this.pool.query(sql, [id]);
			return result.rows[0];
		} catch (error) {
			console.error('Error fetching coupon:', error);
			throw error;
		}
	}

	/**
	 * Get coupon by code (for validation)
	 */
	async getByCode(code) {
		try {
			const sql = `
				SELECT * FROM coupons 
				WHERE UPPER(code) = UPPER($1)
				AND (redeem_by IS NULL OR redeem_by > NOW())
			`;
			const result = await this.pool.query(sql, [code]);
			return result.rows[0];
		} catch (error) {
			console.error('Error fetching coupon by code:', error);
			throw error;
		}
	}

	/**
	 * Create a new coupon
	 */
	async create(couponData) {
		const schema = Joi.object({
			stripe_coupon_id: Joi.string().required(),
			code: Joi.string().min(3).max(50).required(),
			percent_off: Joi.number().integer().min(1).max(100).allow(null),
			amount_off: Joi.number().integer().min(1).allow(null),
			currency: Joi.string().length(3).default('USD'),
			duration: Joi.string().valid('once', 'repeating', 'forever').required(),
			duration_in_months: Joi.number().integer().min(1).allow(null),
			max_redemptions: Joi.number().integer().min(1).allow(null),
			redeem_by: Joi.date().allow(null)
		});

		const { error, value } = schema.validate(couponData);
		if (error) {
			throw new Error(`Validation error: ${error.details[0].message}`);
		}

		try {
			const sql = `
				INSERT INTO coupons (
					stripe_coupon_id, code, percent_off, amount_off, currency,
					duration, duration_in_months, max_redemptions, redeem_by
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				RETURNING *
			`;
			
			const values = [
				value.stripe_coupon_id,
				value.code.toUpperCase(),
				value.percent_off,
				value.amount_off,
				value.currency,
				value.duration,
				value.duration_in_months,
				value.max_redemptions,
				value.redeem_by
			];

			const result = await this.pool.query(sql, values);
			return result.rows[0];
		} catch (error) {
			if (error.code === '23505') { // Unique constraint violation
				throw new Error('A coupon with this code already exists');
			}
			console.error('Error creating coupon:', error);
			throw error;
		}
	}

	/**
	 * Update coupon
	 */
	async update(id, couponData) {
		const schema = Joi.object({
			code: Joi.string().min(3).max(50),
			percent_off: Joi.number().integer().min(1).max(100).allow(null),
			amount_off: Joi.number().integer().min(1).allow(null),
			currency: Joi.string().length(3),
			duration: Joi.string().valid('once', 'repeating', 'forever'),
			duration_in_months: Joi.number().integer().min(1).allow(null),
			max_redemptions: Joi.number().integer().min(1).allow(null),
			redeem_by: Joi.date().allow(null)
		});

		const { error, value } = schema.validate(couponData);
		if (error) {
			throw new Error(`Validation error: ${error.details[0].message}`);
		}

		try {
			const fields = [];
			const values = [];
			let paramCount = 1;

			Object.entries(value).forEach(([key, val]) => {
				if (val !== undefined) {
					fields.push(`${key} = $${paramCount}`);
					values.push(key === 'code' ? val.toUpperCase() : val);
					paramCount++;
				}
			});

			if (fields.length === 0) {
				throw new Error('No fields to update');
			}

			fields.push(`updated_at = CURRENT_TIMESTAMP`);
			values.push(id);

			const sql = `
				UPDATE coupons 
				SET ${fields.join(', ')} 
				WHERE id = $${paramCount}
				RETURNING *
			`;

			const result = await this.pool.query(sql, values);
			return result.rows[0];
		} catch (error) {
			if (error.code === '23505') {
				throw new Error('A coupon with this code already exists');
			}
			console.error('Error updating coupon:', error);
			throw error;
		}
	}

	/**
	 * Delete coupon
	 */
	async delete(id) {
		try {
			const sql = 'DELETE FROM coupons WHERE id = $1 RETURNING *';
			const result = await this.pool.query(sql, [id]);
			return result.rows[0];
		} catch (error) {
			console.error('Error deleting coupon:', error);
			throw error;
		}
	}

	/**
	 * Validate coupon for PayPal checkout
	 */
	async validateForPayPal(code) {
		try {
			const coupon = await this.getByCode(code);
			
			if (!coupon) {
				return {
					valid: false,
					error: 'Invalid coupon code'
				};
			}

			// Check if coupon has expired
			if (coupon.redeem_by && new Date(coupon.redeem_by) < new Date()) {
				return {
					valid: false,
					error: 'This coupon has expired'
				};
			}

			return {
				valid: true,
				coupon: coupon,
				percent_off: coupon.percent_off,
				amount_off: coupon.amount_off,
				currency: coupon.currency
			};
		} catch (error) {
			console.error('Error validating coupon for PayPal:', error);
			return {
				valid: false,
				error: 'Failed to validate coupon'
			};
		}
	}
}

module.exports = { CouponStore };