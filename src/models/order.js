require('dotenv').config();
const Joi = require('joi');

/**
 * OrderStore handles all order-related database operations
 * Manages course purchases, order status tracking, and automatic user enrollment
 */
class OrderStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// ORDER OPERATIONS
	// ========================

	/**
	 * Get all orders (admin view)
	 */
	async index() {
		try {
			const sql = `
        SELECT o.*, u.name as user_name, u.email as user_email, 
               c.title as course_title, c.category as course_category
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN courses c ON o.course_id = c.id
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
               c.instructor_name, c.thumbnail_url
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN courses c ON o.course_id = c.id
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
	 * Get order by order number
	 */
	async getByOrderNumber(orderNumber) {
		try {
			const sql = `
        SELECT o.*, u.name as user_name, u.email as user_email,
               c.title as course_title, c.category as course_category
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN courses c ON o.course_id = c.id
        WHERE o.order_number = $1
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [orderNumber]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find order by number: ${error}`);
		}
	}

	/**
	 * Create new order (course purchase initiation)
	 */
	async create(order) {
		try {
			const client = await this.pool.connect();

			// Get current course price
			const courseSql =
				'SELECT regular_price FROM courses WHERE id = $1 AND is_published = true';
			const courseRes = await client.query(courseSql, [order.course_id]);

			if (courseRes.rows.length === 0) {
				client.release();
				throw new Error('Course not found or not published');
			}

			const coursePrice = courseRes.rows[0].regular_price;

			// Check if user already purchased this course
			const existingSql = `
        SELECT id FROM orders 
        WHERE user_id = $1 AND course_id = $2 AND order_status = 'completed'
      `;
			const existingRes = await client.query(existingSql, [
				order.user_id,
				order.course_id,
			]);

			if (existingRes.rows.length > 0) {
				client.release();
				throw new Error('User has already purchased this course');
			}

			// Create order
			const sql = `
        INSERT INTO orders (user_id, course_id, course_price, order_status, payment_method, notes)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
      `;

			const res = await client.query(sql, [
				order.user_id,
				order.course_id,
				coursePrice,
				order.order_status || 'pending',
				order.payment_method || 'stripe',
				order.notes || null,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create order: ${error}`);
		}
	}

	/**
	 * Update order status (key method for payment processing)
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

	// ========================
	// USER ORDER QUERIES
	// ========================

	/**
	 * Get all orders for a specific user
	 */
	async getUserOrders(userId) {
		try {
			const sql = `
        SELECT o.*, c.title as course_title, c.thumbnail_url, c.category
        FROM orders o
        JOIN courses c ON o.course_id = c.id
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
	 * Get user's completed orders (purchased courses)
	 */
	async getUserPurchases(userId) {
		try {
			const sql = `
        SELECT o.*, c.title as course_title, c.thumbnail_url, c.category, c.instructor_name
        FROM orders o
        JOIN courses c ON o.course_id = c.id
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
	 * Check if user has purchased a specific course
	 */
	async hasUserPurchased(userId, courseId) {
		try {
			const sql = `
        SELECT id FROM orders 
        WHERE user_id = $1 AND course_id = $2 AND order_status = 'completed'
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
	// ANALYTICS & REPORTING
	// ========================

	/**
	 * Get successful orders (completed purchases only)
	 */
	async getSuccessfulOrders() {
		try {
			const sql = `
        SELECT * FROM successful_orders
        ORDER BY completed_at DESC
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
	 * Get order statistics
	 */
	async getOrderStats() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE order_status = 'completed') as completed_orders,
          COUNT(*) FILTER (WHERE order_status = 'pending') as pending_orders,
          COUNT(*) FILTER (WHERE order_status = 'failed') as failed_orders,
          COALESCE(SUM(course_price) FILTER (WHERE order_status = 'completed'), 0) as total_revenue,
          COALESCE(AVG(course_price) FILTER (WHERE order_status = 'completed'), 0) as avg_order_value
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
	 * Get revenue by date range
	 */
	async getRevenueByDateRange(startDate, endDate) {
		try {
			const sql = `
        SELECT 
          DATE(completed_at) as date,
          COUNT(*) as orders_count,
          SUM(course_price) as daily_revenue
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
	 * Get top selling courses
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
        WHERE o.order_status = 'completed'
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
}

/**
 * Validation schema for order data
 */
function validateOrder(order) {
	const orderSchema = Joi.object({
		user_id: Joi.number().integer().positive().required(),
		course_id: Joi.number().integer().positive().required(),
		order_status: Joi.string()
			.valid('pending', 'completed', 'failed', 'cancelled', 'refunded')
			.default('pending'),
		payment_method: Joi.string().default('stripe'),
		notes: Joi.string().allow('', null),
	});

	return orderSchema.validate(order);
}

module.exports = { OrderStore, validateOrder };
