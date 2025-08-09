require('dotenv').config();

/**
 * PayPalCustomerStore handles PayPal customer database operations
 */
class PayPalCustomerStore {
	constructor(pool) {
		this.pool = pool;
	}

	async create({ userId, payerId, email }) {
		try {
			const query = `
        INSERT INTO paypal_customers (user_id, payer_id, email, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING *
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [userId, payerId, email]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not create paypal customer: ${error}`);
		}
	}

	async findByUserId(userId) {
		try {
			const query = `
        SELECT * FROM paypal_customers
        WHERE user_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [userId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not find paypal customer by user ID: ${error}`);
		}
	}

	async findByPayerId(payerId) {
		try {
			const query = `
        SELECT * FROM paypal_customers
        WHERE payer_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [payerId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(
				`Could not find paypal customer by payer ID: ${error}`
			);
		}
	}
}

/**
 * PayPalSubscriptionStore handles PayPal subscription database operations
 */
class PayPalSubscriptionStore {
	constructor(pool) {
		this.pool = pool;
	}

	async upsert(subscriptionData) {
		let client;
		try {
			const {
				payerId,
				subscriptionId,
				planId,
				status,
				startTime,
				nextBillingTime,
				subscriptionStatus,
			} = subscriptionData;

			const query = `
        INSERT INTO paypal_subscriptions (
          payer_id, subscription_id, plan_id, status, 
          start_time, next_billing_time, subscription_status,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (payer_id)
        DO UPDATE SET
          subscription_id = EXCLUDED.subscription_id,
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          start_time = EXCLUDED.start_time,
          next_billing_time = EXCLUDED.next_billing_time,
          subscription_status = EXCLUDED.subscription_status,
          updated_at = NOW()
        RETURNING *
      `;

			client = await this.pool.connect();
			const result = await client.query(query, [
				payerId,
				subscriptionId,
				planId,
				status,
				startTime,
				nextBillingTime,
				subscriptionStatus,
			]);
			
			client.release();
			return result.rows[0];
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not upsert paypal subscription: ${error}`);
		}
	}

	async findByPayerId(payerId) {
		try {
			const query = `
        SELECT * FROM paypal_subscriptions
        WHERE payer_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [payerId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not find paypal subscription: ${error}`);
		}
	}

	async findBySubscriptionId(subscriptionId) {
		try {
			const query = `
        SELECT * FROM paypal_subscriptions
        WHERE subscription_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [subscriptionId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not find paypal subscription by ID: ${error}`);
		}
	}
}

/**
 * PayPalOrderStore handles PayPal order database operations
 */
class PayPalOrderStore {
	constructor(pool) {
		this.pool = pool;
	}

	async create(orderData) {
		try {
			const {
				paypalOrderId,
				payerId,
				amountValue,
				amountCurrency,
				paymentStatus,
				captureId,
				status = 'completed',
			} = orderData;

			const query = `
        INSERT INTO paypal_orders (
          paypal_order_id, payer_id, amount_value, amount_currency,
          payment_status, capture_id, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING *
      `;

			const client = await this.pool.connect();
			const result = await client.query(query, [
				paypalOrderId,
				payerId,
				amountValue,
				amountCurrency,
				paymentStatus,
				captureId,
				status,
			]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not create paypal order: ${error}`);
		}
	}

	async findByPayerId(payerId) {
		try {
			const query = `
        SELECT * FROM paypal_orders
        WHERE payer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [payerId]);
			client.release();
			return result.rows;
		} catch (error) {
			throw new Error(`Could not find paypal orders: ${error}`);
		}
	}

	async findByPayPalOrderId(paypalOrderId) {
		try {
			const query = `
        SELECT * FROM paypal_orders
        WHERE paypal_order_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [paypalOrderId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(
				`Could not find paypal order by order ID: ${error}`
			);
		}
	}

	async findByCaptureId(captureId) {
		try {
			const query = `
        SELECT * FROM paypal_orders
        WHERE capture_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [captureId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(
				`Could not find paypal order by capture ID: ${error}`
			);
		}
	}

	async updatePaymentStatus(paypalOrderId, updateData) {
		try {
			const { captureId, paymentStatus, status } = updateData;
			const query = `
				UPDATE paypal_orders 
				SET capture_id = $2, payment_status = $3, status = $4, updated_at = NOW()
				WHERE paypal_order_id = $1 AND deleted_at IS NULL
				RETURNING *
			`;
			const client = await this.pool.connect();
			const result = await client.query(query, [paypalOrderId, captureId, paymentStatus, status]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not update paypal order payment status: ${error}`);
		}
	}
}

module.exports = {
	PayPalCustomerStore,
	PayPalSubscriptionStore,
	PayPalOrderStore,
};