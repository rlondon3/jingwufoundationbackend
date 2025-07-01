require('dotenv').config();

/**
 * StripeCustomerStore handles Stripe customer database operations
 */
class StripeCustomerStore {
	constructor(pool) {
		this.pool = pool;
	}

	async create({ userId, customerId }) {
		try {
			const query = `
        INSERT INTO stripe_customers (user_id, customer_id, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        RETURNING *
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [userId, customerId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not create stripe customer: ${error}`);
		}
	}

	async findByUserId(userId) {
		try {
			const query = `
        SELECT * FROM stripe_customers
        WHERE user_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [userId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not find stripe customer by user ID: ${error}`);
		}
	}

	async findByCustomerId(customerId) {
		try {
			const query = `
        SELECT * FROM stripe_customers
        WHERE customer_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [customerId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(
				`Could not find stripe customer by customer ID: ${error}`
			);
		}
	}
}

/**
 * StripeSubscriptionStore handles Stripe subscription database operations
 */
class StripeSubscriptionStore {
	constructor(pool) {
		this.pool = pool;
	}

	async upsert(subscriptionData) {
		try {
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

			const client = await this.pool.connect();
			const result = await client.query(query, [
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
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not upsert stripe subscription: ${error}`);
		}
	}

	async findByCustomerId(customerId) {
		try {
			const query = `
        SELECT * FROM stripe_subscriptions
        WHERE customer_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [customerId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not find stripe subscription: ${error}`);
		}
	}

	async findBySubscriptionId(subscriptionId) {
		try {
			const query = `
        SELECT * FROM stripe_subscriptions
        WHERE subscription_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [subscriptionId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not find stripe subscription by ID: ${error}`);
		}
	}
}

/**
 * StripeOrderStore handles Stripe order database operations
 */
class StripeOrderStore {
	constructor(pool) {
		this.pool = pool;
	}

	async create(orderData) {
		try {
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

			const client = await this.pool.connect();
			const result = await client.query(query, [
				checkoutSessionId,
				paymentIntentId,
				customerId,
				amountSubtotal,
				amountTotal,
				currency,
				paymentStatus,
				status,
			]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not create stripe order: ${error}`);
		}
	}

	async findByCustomerId(customerId) {
		try {
			const query = `
        SELECT * FROM stripe_orders
        WHERE customer_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [customerId]);
			client.release();
			return result.rows;
		} catch (error) {
			throw new Error(`Could not find stripe orders: ${error}`);
		}
	}

	async findByCheckoutSessionId(checkoutSessionId) {
		try {
			const query = `
        SELECT * FROM stripe_orders
        WHERE checkout_session_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [checkoutSessionId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(
				`Could not find stripe order by checkout session: ${error}`
			);
		}
	}

	async findByPaymentIntentId(paymentIntentId) {
		try {
			const query = `
        SELECT * FROM stripe_orders
        WHERE payment_intent_id = $1 AND deleted_at IS NULL
      `;
			const client = await this.pool.connect();
			const result = await client.query(query, [paymentIntentId]);
			client.release();
			return result.rows[0];
		} catch (error) {
			throw new Error(
				`Could not find stripe order by payment intent: ${error}`
			);
		}
	}
}

module.exports = {
	StripeCustomerStore,
	StripeSubscriptionStore,
	StripeOrderStore,
};
