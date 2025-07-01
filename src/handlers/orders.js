// handlers/orders.js
require('dotenv').config();
const { OrderStore, validateOrder } = require('../models/order');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * Order Handlers - All business logic for order operations
 */

// ========================
// ORDER HANDLERS
// ========================

/**
 * Get all orders (admin view)
 * GET /orders
 */
const index = async (req, res) => {
	try {
		const store = new OrderStore(req.app.locals.pool);
		const orders = await store.index();
		return res.status(200).json(orders);
	} catch (error) {
		console.error('Get orders error:', error);
		return res.status(500).json({ error: 'Failed to retrieve orders' });
	}
};

/**
 * Get single order by ID
 * GET /orders/:id
 */
const show = async (req, res) => {
	try {
		const store = new OrderStore(req.app.locals.pool);
		const order = await store.show(parseInt(req.params.id));

		if (!order) {
			return res.status(404).json({ error: 'Order not found' });
		}

		return res.status(200).json(order);
	} catch (error) {
		console.error('Get order error:', error);
		return res.status(500).json({ error: 'Failed to retrieve order' });
	}
};

/**
 * Create new order (course purchase initiation)
 * POST /orders
 */
const create = async (req, res) => {
	try {
		// Validate order data
		const { error } = validateOrder(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new OrderStore(req.app.locals.pool);
		const newOrder = await store.create(req.body);

		return res.status(201).json(newOrder);
	} catch (error) {
		console.error('Create order error:', error);
		return res.status(500).json({ error: 'Failed to create order' });
	}
};

/**
 * Update order status
 * PUT /orders/:id/status
 */
const updateStatus = async (req, res) => {
	try {
		const { status, stripe_payment_intent_id, notes } = req.body;

		if (!status) {
			return res.status(400).json({ error: 'Status is required' });
		}

		const validStatuses = [
			'pending',
			'completed',
			'failed',
			'cancelled',
			'refunded',
		];
		if (!validStatuses.includes(status)) {
			return res.status(400).json({ error: 'Invalid status' });
		}

		const store = new OrderStore(req.app.locals.pool);
		const updatedOrder = await store.updateStatus(
			parseInt(req.params.id),
			status,
			stripe_payment_intent_id,
			notes
		);

		return res.status(200).json(updatedOrder);
	} catch (error) {
		console.error('Update order status error:', error);
		return res.status(500).json({ error: 'Failed to update order status' });
	}
};

/**
 * Complete order
 * PUT /orders/:id/complete
 */
const completeOrder = async (req, res) => {
	try {
		const { stripe_payment_intent_id } = req.body;

		const store = new OrderStore(req.app.locals.pool);
		const completedOrder = await store.completeOrder(
			parseInt(req.params.id),
			stripe_payment_intent_id
		);

		return res.status(200).json(completedOrder);
	} catch (error) {
		console.error('Complete order error:', error);
		return res.status(500).json({ error: 'Failed to complete order' });
	}
};

/**
 * Cancel order
 * PUT /orders/:id/cancel
 */
const cancelOrder = async (req, res) => {
	try {
		const { reason } = req.body;

		const store = new OrderStore(req.app.locals.pool);
		const cancelledOrder = await store.cancelOrder(
			parseInt(req.params.id),
			reason
		);

		return res.status(200).json(cancelledOrder);
	} catch (error) {
		console.error('Cancel order error:', error);
		return res.status(500).json({ error: 'Failed to cancel order' });
	}
};

/**
 * Mark order as failed
 * PUT /orders/:id/fail
 */
const failOrder = async (req, res) => {
	try {
		const { reason } = req.body;

		const store = new OrderStore(req.app.locals.pool);
		const failedOrder = await store.failOrder(parseInt(req.params.id), reason);

		return res.status(200).json(failedOrder);
	} catch (error) {
		console.error('Fail order error:', error);
		return res.status(500).json({ error: 'Failed to mark order as failed' });
	}
};

/**
 * Link order to Stripe session
 * PUT /orders/:id/link-stripe
 */
const linkToStripeSession = async (req, res) => {
	try {
		const { checkout_session_id } = req.body;

		if (!checkout_session_id) {
			return res.status(400).json({ error: 'Checkout session ID is required' });
		}

		const store = new OrderStore(req.app.locals.pool);
		const linkedOrder = await store.linkToStripeSession(
			parseInt(req.params.id),
			checkout_session_id
		);

		return res.status(200).json(linkedOrder);
	} catch (error) {
		console.error('Link order to Stripe error:', error);
		return res.status(500).json({ error: 'Failed to link order to Stripe' });
	}
};

// ========================
// USER ORDER HANDLERS
// ========================

/**
 * Get user's orders
 * GET /users/:userId/orders
 */
const getUserOrders = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const store = new OrderStore(req.app.locals.pool);
		const orders = await store.getUserOrders(userId);

		return res.status(200).json(orders);
	} catch (error) {
		console.error('Get user orders error:', error);
		return res.status(500).json({ error: 'Failed to retrieve user orders' });
	}
};

/**
 * Get user's purchases (completed orders)
 * GET /users/:userId/purchases
 */
const getUserPurchases = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const store = new OrderStore(req.app.locals.pool);
		const purchases = await store.getUserPurchases(userId);

		return res.status(200).json(purchases);
	} catch (error) {
		console.error('Get user purchases error:', error);
		return res.status(500).json({ error: 'Failed to retrieve user purchases' });
	}
};

/**
 * Check if user has purchased a course
 * GET /users/:userId/courses/:courseId/purchased
 */
const checkUserPurchase = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const courseId = parseInt(req.params.courseId);

		const store = new OrderStore(req.app.locals.pool);
		const hasPurchased = await store.hasUserPurchased(userId, courseId);

		return res.status(200).json({ has_purchased: hasPurchased });
	} catch (error) {
		console.error('Check user purchase error:', error);
		return res.status(500).json({ error: 'Failed to check purchase status' });
	}
};

// ========================
// ANALYTICS HANDLERS
// ========================

/**
 * Get successful orders (admin analytics)
 * GET /orders/successful
 */
const getSuccessfulOrders = async (req, res) => {
	try {
		const store = new OrderStore(req.app.locals.pool);
		const orders = await store.getSuccessfulOrders();

		return res.status(200).json(orders);
	} catch (error) {
		console.error('Get successful orders error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve successful orders' });
	}
};

/**
 * Get order statistics
 * GET /orders/stats
 */
const getOrderStats = async (req, res) => {
	try {
		const store = new OrderStore(req.app.locals.pool);
		const stats = await store.getOrderStats();

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get order stats error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve order statistics' });
	}
};

/**
 * Get revenue by date range
 * GET /orders/revenue?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
const getRevenueByDateRange = async (req, res) => {
	try {
		const { start_date, end_date } = req.query;

		if (!start_date || !end_date) {
			return res
				.status(400)
				.json({ error: 'Start date and end date are required' });
		}

		const store = new OrderStore(req.app.locals.pool);
		const revenue = await store.getRevenueByDateRange(start_date, end_date);

		return res.status(200).json(revenue);
	} catch (error) {
		console.error('Get revenue by date range error:', error);
		return res.status(500).json({ error: 'Failed to retrieve revenue data' });
	}
};

/**
 * Get top selling courses
 * GET /orders/top-courses?limit=10
 */
const getTopSellingCourses = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 10;

		if (limit <= 0 || limit > 100) {
			return res.status(400).json({ error: 'Limit must be between 1 and 100' });
		}

		const store = new OrderStore(req.app.locals.pool);
		const courses = await store.getTopSellingCourses(limit);

		return res.status(200).json(courses);
	} catch (error) {
		console.error('Get top selling courses error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve top selling courses' });
	}
};

/**
 * Order route handler - manages all order-related endpoints
 */
const orders_route = (app) => {
	// Admin-only routes
	app.get('/orders', authenticationToken, requireAdmin, index);
	app.get(
		'/orders/successful',
		authenticationToken,
		requireAdmin,
		getSuccessfulOrders
	);
	app.get('/orders/stats', authenticationToken, requireAdmin, getOrderStats);
	app.get(
		'/orders/revenue',
		authenticationToken,
		requireAdmin,
		getRevenueByDateRange
	);
	app.get(
		'/orders/top-courses',
		authenticationToken,
		requireAdmin,
		getTopSellingCourses
	);
	app.get('/orders/:id', authenticationToken, requireAdmin, show);
	app.put(
		'/orders/:id/status',
		authenticationToken,
		requireAdmin,
		updateStatus
	);
	app.put(
		'/orders/:id/complete',
		authenticationToken,
		requireAdmin,
		completeOrder
	);
	app.put('/orders/:id/cancel', authenticationToken, requireAdmin, cancelOrder);
	app.put('/orders/:id/fail', authenticationToken, requireAdmin, failOrder);
	app.put(
		'/orders/:id/link-stripe',
		authenticationToken,
		requireAdmin,
		linkToStripeSession
	);

	// User routes (authenticated users can create orders and view their own)
	app.post('/orders', authenticationToken, create);
	app.get('/users/:userId/orders', authenticateUserId, getUserOrders);
	app.get('/users/:userId/purchases', authenticateUserId, getUserPurchases);
	app.get(
		'/users/:userId/courses/:courseId/purchased',
		authenticateUserId,
		checkUserPurchase
	);
};

module.exports = orders_route;
