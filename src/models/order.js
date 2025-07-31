require('dotenv').config();
const Joi = require('joi');

/**
 * OrderStore handles all order-related database operations
 * Supports both course purchases and add-on resource purchases
 * Integrated with Stripe for payment processing
 */
class OrderStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// ORDER OPERATIONS
	// ========================

	/**
	 * Get all orders (admin view) - includes both courses and add-ons
	 */
	async index() {
		try {
			const sql = `
        SELECT o.*, u.name as user_name, u.email as user_email, 
               c.title as course_title, c.category as course_category,
               r.title as resource_title, r.type as resource_type,
               so.checkout_session_id, so.payment_intent_id, so.amount_total as stripe_amount,
               CASE 
                 WHEN o.is_add_on = TRUE THEN 'add-on'
                 ELSE 'course'
               END as order_type
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN courses c ON o.course_id = c.id
        LEFT JOIN resources r ON o.resource_id = r.id
        LEFT JOIN stripe_orders so ON o.stripe_checkout_session_id = so.checkout_session_id
        ORDER BY o.created_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve orders: ${error}`);
		}
	}

	/**
	 * Get single order by ID
	 */
	async show(id) {
		try {
			const sql = `
        SELECT o.*, u.name as user_name, u.email as user_email,
               c.title as course_title, c.category as course_category,
               c.instructor_name, c.thumbnail_url as course_thumbnail,
               r.title as resource_title, r.type as resource_type, 
               r.thumbnail as resource_thumbnail,
               so.checkout_session_id, so.payment_intent_id, so.amount_total as stripe_amount,
               so.payment_status as stripe_payment_status,
               CASE 
                 WHEN o.is_add_on = TRUE THEN 'add-on'
                 ELSE 'course'
               END as order_type
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN courses c ON o.course_id = c.id
        LEFT JOIN resources r ON o.resource_id = r.id
        LEFT JOIN stripe_orders so ON o.stripe_checkout_session_id = so.checkout_session_id
        WHERE o.id = $1
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find order: ${error}`);
		}
	}

	/**
	 * Get order by Stripe checkout session ID
	 */
	async getByStripeSession(checkoutSessionId) {
		try {
			const sql = `
        SELECT o.*, u.name as user_name, u.email as user_email,
               c.title as course_title, c.category as course_category,
               r.title as resource_title, r.type as resource_type
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN courses c ON o.course_id = c.id
        LEFT JOIN resources r ON o.resource_id = r.id
        WHERE o.stripe_checkout_session_id = $1
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [checkoutSessionId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find order by Stripe session: ${error}`);
		}
	}

	/**
	 * Create new course order (existing flow - unchanged)
	 */
	async create(order) {
		try {
			const client = await this.pool.connect();

			// Get current course price
			const courseSql =
				'SELECT regular_price, title FROM courses WHERE id = $1';
			const courseRes = await client.query(courseSql, [order.course_id]);

			if (courseRes.rows.length === 0) {
				client.release();
				throw new Error('Course not found');
			}

			const { regular_price: coursePrice, title: courseTitle } =
				courseRes.rows[0];

			// Check if user is currently enrolled in this course
			const enrollmentSql = `
        SELECT id FROM user_courses 
        WHERE user_id = $1 AND course_id = $2
      `;
			const enrollmentRes = await client.query(enrollmentSql, [
				order.user_id,
				order.course_id,
			]);

			if (enrollmentRes.rows.length > 0) {
				client.release();
				throw new Error('User is already enrolled in this course');
			}

			// Create course order
			const sql = `
        INSERT INTO orders (user_id, course_id, course_price, order_status, 
                           payment_method, stripe_checkout_session_id, notes,
                           is_add_on, item_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
      `;

			const res = await client.query(sql, [
				order.user_id,
				order.course_id,
				coursePrice,
				order.order_status || 'pending',
				order.payment_method || 'stripe',
				order.stripe_checkout_session_id || null,
				order.notes || null,
				false, // is_add_on = false for course orders
				courseTitle,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create course order: ${error}`);
		}
	}

	/**
	 * Create new add-on order (new method)
	 */
	async createAddOnOrder(order) {
		try {
			const client = await this.pool.connect();

			// Get resource details and verify it's a paid add-on
			const resourceSql = `
        SELECT price, title, is_add_on 
        FROM resources 
        WHERE id = $1 AND is_published = true
      `;
			const resourceRes = await client.query(resourceSql, [order.resource_id]);

			if (resourceRes.rows.length === 0) {
				client.release();
				throw new Error('Resource not found or not published');
			}

			const { price, title: resourceTitle, is_add_on } = resourceRes.rows[0];

			if (!is_add_on || !price) {
				client.release();
				throw new Error('Resource is not a paid add-on');
			}

			// Check if user has already purchased this add-on
			const existingOrderSql = `
        SELECT id FROM orders 
        WHERE user_id = $1 AND resource_id = $2 AND order_status = 'completed' AND is_add_on = TRUE
      `;
			const existingOrderRes = await client.query(existingOrderSql, [
				order.user_id,
				order.resource_id,
			]);

			if (existingOrderRes.rows.length > 0) {
				client.release();
				throw new Error('User has already purchased this add-on');
			}

			// Create add-on order
			const sql = `
        INSERT INTO orders (user_id, course_id, resource_id, add_on_price, course_price, order_status, 
                           payment_method, stripe_checkout_session_id, notes,
                           is_add_on, item_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
      `;

			const res = await client.query(sql, [
				order.user_id,
				order.course_id,
				order.resource_id,
				price,
				0, // course_price = 0 for add-on orders
				order.order_status || 'pending',
				order.payment_method || 'stripe',
				order.stripe_checkout_session_id || null,
				order.notes || null,
				true, // is_add_on = true for add-on orders
				resourceTitle,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create add-on order: ${error}`);
		}
	}

	/**
	 * Update order status (works for both course and add-on orders)
	 */
	async updateStatus(
		orderId,
		status,
		stripePaymentIntentId = null,
		notes = null
	) {
		try {
			const sql = `
        UPDATE orders SET 
          order_status = $1,
          stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
          notes = COALESCE($3, notes),
          completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 RETURNING *
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [
				status,
				stripePaymentIntentId,
				notes,
				orderId,
			]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Order not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update order status: ${error}`);
		}
	}

	/**
	 * Complete order from Stripe webhook (handles both courses and add-ons)
	 */
	async completeFromStripe(checkoutSessionId, stripePaymentIntentId = null) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Update order status
			const orderSql = `
        UPDATE orders SET 
          order_status = 'completed',
          stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          notes = 'Payment completed via Stripe'
        WHERE stripe_checkout_session_id = $1 RETURNING *
      `;
			const orderRes = await client.query(orderSql, [
				checkoutSessionId,
				stripePaymentIntentId,
			]);

			if (orderRes.rows.length === 0) {
				throw new Error('Order not found for Stripe session');
			}

			const completedOrder = orderRes.rows[0];

			// Handle enrollment based on order type
			if (!completedOrder.is_add_on && completedOrder.course_id) {
				// Course enrollment (existing logic)
				const enrollmentSql = `
          INSERT INTO user_courses (user_id, course_id, start_date, progress) 
          VALUES ($1, $2, CURRENT_TIMESTAMP, 0) 
          ON CONFLICT (user_id, course_id) DO UPDATE SET 
            start_date = CURRENT_TIMESTAMP,
            progress = 0
          RETURNING *
        `;
				await client.query(enrollmentSql, [
					completedOrder.user_id,
					completedOrder.course_id,
				]);
			}
			// For add-on orders, no additional enrollment needed - access is granted via order record

			await client.query('COMMIT');

			return completedOrder;
		} catch (error) {
			await client.query('ROLLBACK');
			throw new Error(`Could not complete order from Stripe: ${error}`);
		} finally {
			client.release();
		}
	}

	// ========================
	// ADD-ON SPECIFIC METHODS
	// ========================

	/**
	 * Get all add-on orders
	 */
	async getAddOnOrders() {
		try {
			const sql = `
        SELECT o.*, u.name as user_name, u.email as user_email,
               r.title as resource_title, r.type as resource_type,
               so.checkout_session_id, so.payment_intent_id, so.amount_total as stripe_amount
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN resources r ON o.resource_id = r.id
        LEFT JOIN stripe_orders so ON o.stripe_checkout_session_id = so.checkout_session_id
        WHERE o.is_add_on = TRUE
        ORDER BY o.created_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve add-on orders: ${error}`);
		}
	}

	/**
	 * Check if user has purchased specific add-on
	 */
	async hasUserPurchasedAddOn(userId, resourceId) {
		try {
			const sql = `
        SELECT EXISTS(
          SELECT 1 FROM orders 
          WHERE user_id = $1 AND resource_id = $2 
          AND order_status = 'completed' AND is_add_on = TRUE
        ) as has_purchased
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, resourceId]);
			client.release();
			return res.rows[0].has_purchased;
		} catch (error) {
			throw new Error(`Could not check add-on purchase status: ${error}`);
		}
	}

	/**
	 * Get user's purchased add-ons
	 */
	async getUserPurchasedAddOns(userId) {
		try {
			const sql = `
        SELECT o.*, r.title as resource_title, r.type as resource_type,
               r.thumbnail, r.description
        FROM orders o
        JOIN resources r ON o.resource_id = r.id
        WHERE o.user_id = $1 AND o.order_status = 'completed' AND o.is_add_on = TRUE
        ORDER BY o.completed_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user's purchased add-ons: ${error}`);
		}
	}

	// ========================
	// USER ORDER QUERIES (Updated)
	// ========================

	/**
	 * Get all orders for a specific user (courses and add-ons)
	 */
	async getUserOrders(userId) {
		try {
			const sql = `
        SELECT o.*, 
               c.title as course_title, c.thumbnail_url as course_thumbnail, c.category,
               r.title as resource_title, r.thumbnail as resource_thumbnail, r.type as resource_type,
               so.checkout_session_id, so.payment_status as stripe_payment_status,
               CASE 
                 WHEN o.is_add_on = TRUE THEN 'add-on'
                 ELSE 'course'
               END as order_type
        FROM orders o
        LEFT JOIN courses c ON o.course_id = c.id
        LEFT JOIN resources r ON o.resource_id = r.id
        LEFT JOIN stripe_orders so ON o.stripe_checkout_session_id = so.checkout_session_id
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user orders: ${error}`);
		}
	}

	/**
	 * Get user's completed orders (purchased courses and add-ons)
	 */
	async getUserPurchases(userId) {
		try {
			const sql = `
        SELECT o.*, 
               c.title as course_title, c.thumbnail_url as course_thumbnail, c.category, c.instructor_name,
               r.title as resource_title, r.thumbnail as resource_thumbnail, r.type as resource_type,
               CASE 
                 WHEN o.is_add_on = TRUE THEN 'add-on'
                 ELSE 'course'
               END as purchase_type
        FROM orders o
        LEFT JOIN courses c ON o.course_id = c.id
        LEFT JOIN resources r ON o.resource_id = r.id
        WHERE o.user_id = $1 AND o.order_status = 'completed'
        ORDER BY o.completed_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user purchases: ${error}`);
		}
	}

	/**
	 * Check if user has purchased a specific course (unchanged)
	 */
	async hasUserPurchased(userId, courseId) {
		try {
			const sql = `
        SELECT id FROM orders 
        WHERE user_id = $1 AND course_id = $2 AND order_status = 'completed' AND is_add_on = FALSE
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return res.rows.length > 0;
		} catch (error) {
			throw new Error(`Could not check purchase status: ${error}`);
		}
	}

	// ========================
	// ANALYTICS & REPORTING (Updated)
	// ========================

	/**
	 * Get successful orders (completed purchases only)
	 */
	async getSuccessfulOrders() {
		try {
			const sql = `
        SELECT o.*, 
               c.title as course_title, 
               r.title as resource_title, r.type as resource_type,
               u.name as user_name,
               so.amount_total as stripe_amount, so.currency,
               CASE 
                 WHEN o.is_add_on = TRUE THEN 'add-on'
                 ELSE 'course'
               END as order_type
        FROM orders o
        LEFT JOIN courses c ON o.course_id = c.id
        LEFT JOIN resources r ON o.resource_id = r.id
        JOIN users u ON o.user_id = u.id
        LEFT JOIN stripe_orders so ON o.stripe_checkout_session_id = so.checkout_session_id
        WHERE o.order_status = 'completed'
        ORDER BY o.completed_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve successful orders: ${error}`);
		}
	}

	/**
	 * Get order statistics (updated to include add-ons)
	 */
	async getOrderStats() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE order_status = 'completed') as completed_orders,
          COUNT(*) FILTER (WHERE order_status = 'pending') as pending_orders,
          COUNT(*) FILTER (WHERE order_status = 'failed') as failed_orders,
          COUNT(*) FILTER (WHERE is_add_on = TRUE) as total_addon_orders,
          COUNT(*) FILTER (WHERE is_add_on = FALSE) as total_course_orders,
          COUNT(*) FILTER (WHERE order_status = 'completed' AND is_add_on = TRUE) as completed_addon_orders,
          COUNT(*) FILTER (WHERE order_status = 'completed' AND is_add_on = FALSE) as completed_course_orders,
          COALESCE(SUM(course_price) FILTER (WHERE order_status = 'completed' AND is_add_on = FALSE), 0) as course_revenue,
          COALESCE(SUM(add_on_price) FILTER (WHERE order_status = 'completed' AND is_add_on = TRUE), 0) as addon_revenue,
          COALESCE(SUM(COALESCE(course_price, 0) + COALESCE(add_on_price, 0)) FILTER (WHERE order_status = 'completed'), 0) as total_revenue,
          COALESCE(AVG(COALESCE(course_price, add_on_price)) FILTER (WHERE order_status = 'completed'), 0) as avg_order_value
        FROM orders
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't retrieve order statistics: ${error}`);
		}
	}

	/**
	 * Get revenue by date range (updated for add-ons)
	 */
	async getRevenueByDateRange(startDate, endDate) {
		try {
			const sql = `
        SELECT 
          DATE(completed_at) as date,
          COUNT(*) as orders_count,
          COUNT(*) FILTER (WHERE is_add_on = FALSE) as course_orders,
          COUNT(*) FILTER (WHERE is_add_on = TRUE) as addon_orders,
          COALESCE(SUM(course_price) FILTER (WHERE is_add_on = FALSE), 0) as course_revenue,
          COALESCE(SUM(add_on_price) FILTER (WHERE is_add_on = TRUE), 0) as addon_revenue,
          COALESCE(SUM(COALESCE(course_price, 0) + COALESCE(add_on_price, 0)), 0) as daily_revenue
        FROM orders 
        WHERE order_status = 'completed' 
        AND completed_at >= $1 
        AND completed_at <= $2
        GROUP BY DATE(completed_at)
        ORDER BY date DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [startDate, endDate]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve revenue data: ${error}`);
		}
	}

	/**
	 * Get top selling courses (unchanged)
	 */
	async getTopSellingCourses(limit = 10) {
		try {
			const sql = `
        SELECT 
          c.id, c.title, c.category, c.instructor_name, c.regular_price,
          COUNT(o.id) as total_sales,
          SUM(o.course_price) as total_revenue
        FROM courses c
        JOIN orders o ON c.id = o.course_id
        WHERE o.order_status = 'completed' AND o.is_add_on = FALSE
        GROUP BY c.id, c.title, c.category, c.instructor_name, c.regular_price
        ORDER BY total_sales DESC
        LIMIT $1
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve top selling courses: ${error}`);
		}
	}

	/**
	 * Get top selling add-ons (new method)
	 */
	async getTopSellingAddOns(limit = 10) {
		try {
			const sql = `
        SELECT 
          r.id, r.title, r.type, r.author, r.price,
          COUNT(o.id) as total_sales,
          SUM(o.add_on_price) as total_revenue
        FROM resources r
        JOIN orders o ON r.id = o.resource_id
        WHERE o.order_status = 'completed' AND o.is_add_on = TRUE
        GROUP BY r.id, r.title, r.type, r.author, r.price
        ORDER BY total_sales DESC
        LIMIT $1
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve top selling add-ons: ${error}`);
		}
	}

	// ========================
	// EXISTING METHODS (unchanged)
	// ========================

	/**
	 * Link existing order to Stripe session
	 */
	async linkToStripeSession(orderId, checkoutSessionId) {
		try {
			const sql = `
        UPDATE orders SET 
          stripe_checkout_session_id = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 RETURNING *
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [checkoutSessionId, orderId]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Order not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not link order to Stripe: ${error}`);
		}
	}

	/**
	 * Complete order (marks as completed and triggers enrollment)
	 */
	async completeOrder(orderId, stripePaymentIntentId = null) {
		try {
			return await this.updateStatus(
				orderId,
				'completed',
				stripePaymentIntentId,
				'Payment successful'
			);
		} catch (error) {
			throw new Error(`Could not complete order: ${error}`);
		}
	}

	/**
	 * Cancel order
	 */
	async cancelOrder(orderId, reason = 'Cancelled by user') {
		try {
			return await this.updateStatus(orderId, 'cancelled', null, reason);
		} catch (error) {
			throw new Error(`Could not cancel order: ${error}`);
		}
	}

	/**
	 * Mark order as failed
	 */
	async failOrder(orderId, reason = 'Payment failed') {
		try {
			return await this.updateStatus(orderId, 'failed', null, reason);
		} catch (error) {
			throw new Error(`Could not fail order: ${error}`);
		}
	}
}

/**
 * Updated validation schema for order data including add-on orders
 */
function validateOrder(order) {
	const orderSchema = Joi.object({
		user_id: Joi.number().integer().positive().required(),
		course_id: Joi.number().integer().positive().allow(null),
		resource_id: Joi.number().integer().positive().allow(null),
		order_status: Joi.string()
			.valid('pending', 'completed', 'failed', 'cancelled', 'refunded')
			.default('pending'),
		payment_method: Joi.string().default('stripe'),
		stripe_checkout_session_id: Joi.string().allow('', null),
		notes: Joi.string().allow('', null),
		is_add_on: Joi.boolean().default(false),
	}).custom((value, helpers) => {
		// Validate that either course_id or resource_id is provided, but not both
		if (value.is_add_on) {
			if (!value.resource_id || value.course_id) {
				return helpers.error('custom.addon-validation');
			}
		} else {
			if (!value.course_id || value.resource_id) {
				return helpers.error('custom.course-validation');
			}
		}
		return value;
	}, 'Order type validation');

	return orderSchema.validate(order, {
		messages: {
			'custom.addon-validation':
				'Add-on orders must have resource_id and no course_id',
			'custom.course-validation':
				'Course orders must have course_id and no resource_id',
		},
	});
}

module.exports = { OrderStore, validateOrder };
