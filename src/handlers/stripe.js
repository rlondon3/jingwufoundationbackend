// handlers/stripe.js
require('dotenv').config();
const Stripe = require('stripe');
const {
	StripeCustomerStore,
	StripeSubscriptionStore,
	StripeOrderStore,
} = require('../models/stripe');
const {
	authenticationToken,
	authenticateUserId,
} = require('../middleware/auth');

const { OrderStore } = require('../models/order');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Stripe Handlers - All business logic for Stripe operations
 */

/**
 * Create checkout session
 * POST /stripe/create-checkout
 */
const createCheckout = async (req, res) => {
	try {
		const { price_id, success_url, cancel_url, mode, course_id, course_price } = req.body;
		const userId = req.user.id;

		if (!userId) {
			return res.status(400).json({ error: 'User ID not found in token' });
		}

		if (!success_url || !cancel_url || !mode) {
			return res.status(400).json({ error: 'Missing required parameters' });
		}

		if (!['payment', 'subscription'].includes(mode)) {
			return res.status(400).json({ error: 'Invalid mode' });
		}

		// For course purchases, we need either a price_id or course_id + course_price
		if (mode === 'payment' && !price_id && (!course_id || !course_price)) {
			return res.status(400).json({ error: 'For course purchases, provide either price_id or course_id + course_price' });
		}

		// Initialize stores
		const customerStore = new StripeCustomerStore(req.app.locals.pool);

		// Find or create Stripe customer
		let stripeCustomer = await customerStore.findByUserId(userId);
		let customerId;

		if (!stripeCustomer) {
			// Create new Stripe customer
			const customer = await stripe.customers.create({
				email: req.user.email,
				metadata: { userId: userId.toString() },
			});

			// Save to database
			stripeCustomer = await customerStore.create({
				userId,
				customerId: customer.id,
			});

			customerId = customer.id;
		} else {
			customerId = stripeCustomer.customer_id;
		}

		let lineItems;

		if (price_id) {
			// Use existing Stripe price
			lineItems = [
				{
					price: price_id,
					quantity: 1,
				},
			];
		} else if (course_price) {
			// Get course details for better product naming
			let courseName = `Course ${course_id}`;
			try {
				const courseQuery = await req.app.locals.pool.query(
					'SELECT title FROM courses WHERE id = $1',
					[course_id]
				);
				if (courseQuery.rows.length > 0) {
					courseName = courseQuery.rows[0].title;
				}
			} catch (error) {
				console.error('Error fetching course title:', error);
				// Continue with default name
			}

			// Create dynamic price for course
			lineItems = [
				{
					price_data: {
						currency: 'usd',
						product_data: {
							name: courseName,
							description: `Access to ${courseName} course content`,
							metadata: {
								course_id: course_id.toString(),
							},
						},
						unit_amount: Math.round(course_price * 100), // Convert to cents
					},
					quantity: 1,
				},
			];
		}

		// Create checkout session
		const session = await stripe.checkout.sessions.create({
			customer: customerId,
			payment_method_types: ['card'],
			line_items: lineItems,
			mode,
			success_url,
			cancel_url,
			metadata: {
				course_id: course_id?.toString() || '',
				user_id: userId.toString(),
			},
		});

		const orderStore = new OrderStore(req.app.locals.pool);

		const order = await orderStore.create({
			user_id: userId,
			course_id: course_id,
			order_status: 'pending',
			payment_method: 'stripe',
			stripe_checkout_session_id: session.id,
		});

		res.json({ sessionId: session.id, url: session.url, orderId: order.id });
	} catch (error) {
		console.error('Checkout error:', error);
		res.status(500).json({ error: 'Failed to create checkout session' });
	}
};

/**
 * Stripe webhook handler
 * POST /stripe/webhook
 */
const webhook = async (req, res) => {
	try {
		const sig = req.headers['stripe-signature'];
		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

		let event;
		try {
			event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
		} catch (err) {
			console.error('Webhook signature verification failed:', err.message);
			return res.status(400).send(`Webhook Error: ${err.message}`);
		}

		// Handle the event
		await handleStripeEvent(event, req.app.locals.pool);

		res.json({ received: true });
	} catch (error) {
		console.error('Webhook error:', error);
		res.status(500).json({ error: 'Webhook processing failed' });
	}
};

/**
 * Get user's subscription status
 * GET /stripe/subscription/:userId
 */
const getSubscription = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const customerStore = new StripeCustomerStore(req.app.locals.pool);
		const subscriptionStore = new StripeSubscriptionStore(req.app.locals.pool);

		// Find customer
		const stripeCustomer = await customerStore.findByUserId(userId);
		if (!stripeCustomer) {
			return res.status(404).json({ error: 'No subscription found' });
		}

		// Find subscription
		const subscription = await subscriptionStore.findByCustomerId(
			stripeCustomer.customer_id
		);
		if (!subscription) {
			return res.status(404).json({ error: 'No subscription found' });
		}

		res.json(subscription);
	} catch (error) {
		console.error('Get subscription error:', error);
		res.status(500).json({ error: 'Failed to get subscription' });
	}
};

/**
 * Get user's order history
 * GET /stripe/orders/:userId
 */
const getOrders = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const customerStore = new StripeCustomerStore(req.app.locals.pool);
		const orderStore = new StripeOrderStore(req.app.locals.pool);

		// Find customer
		const stripeCustomer = await customerStore.findByUserId(userId);
		if (!stripeCustomer) {
			return res.json([]);
		}

		// Find orders
		const orders = await orderStore.findByCustomerId(
			stripeCustomer.customer_id
		);
		res.json(orders);
	} catch (error) {
		console.error('Get orders error:', error);
		res.status(500).json({ error: 'Failed to get orders' });
	}
};

/**
 * Verify payment success and complete enrollment
 * POST /stripe/verify-payment
 */
const verifyPayment = async (req, res) => {
	try {
		const { session_id, course_id } = req.body;
		const userId = req.user.id;

		if (!session_id) {
			return res.status(400).json({ error: 'Session ID required' });
		}

		// Get session details from Stripe
		const session = await stripe.checkout.sessions.retrieve(session_id);
		
		if (session.payment_status === 'paid' && session.metadata.user_id == userId) {
			// Payment was successful, complete the order
			const orderStore = new OrderStore(req.app.locals.pool);
			
			try {
				const completedOrder = await orderStore.completeFromStripe(
					session_id,
					session.payment_intent
				);

				
				return res.json({ 
					success: true, 
					order_id: completedOrder.id,
					enrolled: true 
				});
			} catch (error) {
				// Order might already be completed
				return res.json({ 
					success: true, 
					message: 'Payment already processed',
					enrolled: true 
				});
			}
		} else {
			return res.status(400).json({ error: 'Payment not completed or user mismatch' });
		}
	} catch (error) {
		console.error('Payment verification error:', error);
		res.status(500).json({ error: 'Failed to verify payment' });
	}
};

/**
 * Handle Stripe webhook events
 */
async function handleStripeEvent(event, pool) {
	const stripeData = event?.data?.object ?? {};

	if (!stripeData || !('customer' in stripeData)) {
		return;
	}

	const customerId = stripeData.customer;

	if (!customerId || typeof customerId !== 'string') {
		console.error(`No customer received on event: ${JSON.stringify(event)}`);
		return;
	}

	let isSubscription = true;

	if (event.type === 'checkout.session.completed') {
		const { mode, payment_status } = stripeData;
		isSubscription = mode === 'subscription';

		if (mode === 'payment' && payment_status === 'paid') {
			// Handle one-time payment (course purchases)
			const {
				id: checkout_session_id,
				payment_intent,
				amount_subtotal,
				amount_total,
				currency,
			} = stripeData;

			// Save to Stripe orders table
			const stripeOrderStore = new StripeOrderStore(pool);
			await stripeOrderStore.create({
				checkoutSessionId: checkout_session_id,
				paymentIntentId: payment_intent,
				customerId,
				amountSubtotal: amount_subtotal,
				amountTotal: amount_total,
				currency,
				paymentStatus: payment_status,
				status: 'completed',
			});

			// Complete the main order (course enrollment)
			const { OrderStore } = require('../models/order');
			const orderStore = new OrderStore(pool);

			try {
				const completedOrder = await orderStore.completeFromStripe(
					checkout_session_id,
					payment_intent
				);

			} catch (error) {
				console.error(
					`Failed to complete main order for session ${checkout_session_id}:`,
					error
				);
				// Stripe payment succeeded but order completion failed - needs manual review
			}
		}
	}

	if (isSubscription) {
			await syncCustomerFromStripe(customerId, pool);
	}
}

/**
 * Sync customer subscription data from Stripe
 */
async function syncCustomerFromStripe(customerId, pool) {
	try {
		const subscriptionStore = new StripeSubscriptionStore(pool);

		// Fetch latest subscription data from Stripe
		const subscriptions = await stripe.subscriptions.list({
			customer: customerId,
			limit: 1,
			status: 'all',
			expand: ['data.default_payment_method'],
		});

		if (subscriptions.data.length === 0) {
				await subscriptionStore.upsert({
				customerId,
				subscriptionId: null,
				priceId: null,
				currentPeriodStart: null,
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				paymentMethodBrand: null,
				paymentMethodLast4: null,
				status: 'not_started',
			});
			return;
		}

		const subscription = subscriptions.data[0];

		// Store subscription state
		await subscriptionStore.upsert({
			customerId,
			subscriptionId: subscription.id,
			priceId: subscription.items.data[0].price.id,
			currentPeriodStart: subscription.current_period_start,
			currentPeriodEnd: subscription.current_period_end,
			cancelAtPeriodEnd: subscription.cancel_at_period_end,
			paymentMethodBrand:
				subscription.default_payment_method?.card?.brand || null,
			paymentMethodLast4:
				subscription.default_payment_method?.card?.last4 || null,
			status: subscription.status,
		});

	} catch (error) {
		console.error(
			`Failed to sync subscription for customer ${customerId}:`,
			error
		);
		throw error;
	}
}

/**
 * Stripe route handler - manages all Stripe-related endpoints
 */
const stripe_route = (app) => {
	// Public webhook endpoint (must use raw body parser)
	app.post('/stripe/webhook', webhook);

	// Protected routes
	app.post('/stripe/create-checkout', authenticationToken, createCheckout);
	app.post('/stripe/verify-payment', authenticationToken, verifyPayment);
	app.get('/stripe/subscription/:userId', authenticateUserId, getSubscription);
	app.get('/stripe/orders/:userId', authenticateUserId, getOrders);
};

module.exports = stripe_route;
