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
 * Create Q&A checkout session
 * POST /stripe/create-qa-checkout-session
 */
const createQACheckout = async (req, res) => {
	try {
		const { 
			appointment_type, 
			full_name, 
			email, 
			phone_number, 
			start_time, 
			end_time, 
			notes, 
			user_id, 
			price, 
			session_name, 
			is_subscription,
			course_id
		} = req.body;

		if (!appointment_type || !full_name || !email || !price || !session_name) {
			return res.status(400).json({ error: 'Missing required parameters' });
		}

		// Initialize stores
		const customerStore = new StripeCustomerStore(req.app.locals.pool);

		// Find or create Stripe customer
		let stripeCustomer = await customerStore.findByUserId(user_id);
		let customerId;

		if (!stripeCustomer) {
			// Create new Stripe customer
			const customer = await stripe.customers.create({
				email: email,
				name: full_name,
				metadata: { userId: user_id?.toString() || 'guest' },
			});

			// Save to database if user_id exists
			if (user_id) {
				stripeCustomer = await customerStore.create({
					userId: user_id,
					customerId: customer.id,
				});
			}

			customerId = customer.id;
		} else {
			customerId = stripeCustomer.customer_id;
		}

		// Create line items based on appointment type
		let lineItems;
		const mode = is_subscription ? 'subscription' : 'payment';
		
		if (is_subscription) {
			// For intensive mentorship subscription
			lineItems = [
				{
					price_data: {
						currency: 'usd',
						product_data: {
							name: session_name,
							description: 'Monthly subscription • Weekly 20-min calls • 3 questions/week • Advanced training',
							metadata: {
								appointment_type: appointment_type,
								is_qa_booking: 'true',
							},
						},
						unit_amount: Math.round(price * 100), // Convert to cents
						recurring: {
							interval: 'month',
						},
					},
					quantity: 1,
				},
			];
		} else {
			// For one-time Q&A sessions
			let description;
			switch (appointment_type) {
				case 'written_guidance':
					description = 'Submit up to 5 written questions • 72-hour written response';
					break;
				case 'video_review':
					description = 'Submit practice video + 3 questions • Video response within 72hrs';
					break;
				case 'live_consultation':
					description = '20-minute scheduled Zoom call';
					break;
				default:
					description = `${session_name} session`;
			}

			lineItems = [
				{
					price_data: {
						currency: 'usd',
						product_data: {
							name: session_name,
							description: description,
							metadata: {
								appointment_type: appointment_type,
								is_qa_booking: 'true',
							},
						},
						unit_amount: Math.round(price * 100), // Convert to cents
					},
					quantity: 1,
				},
			];
		}

		// Create appropriate success/cancel URLs based on appointment type
		let success_url, cancel_url;
		const courseParam = course_id ? `&course_id=${course_id}` : '';
		
		if (is_subscription && appointment_type === 'intensive_mentorship') {
			// Intensive mentorship subscription
			success_url = `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&intensive_mentorship_subscription=true${courseParam}`;
			cancel_url = `${process.env.FRONTEND_URL}/payment/failed?intensive_mentorship_subscription=true&reason=cancelled${courseParam}`;
		} else {
			// Regular Q&A consultations
			success_url = `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&qa_consultation=${appointment_type}${courseParam}`;
			cancel_url = `${process.env.FRONTEND_URL}/payment/failed?qa_consultation=${appointment_type}&reason=cancelled${courseParam}`;
		}

		// Create checkout session
		const session = await stripe.checkout.sessions.create({
			customer: customerId,
			payment_method_types: ['card'],
			line_items: lineItems,
			mode: mode,
			success_url: success_url,
			cancel_url: cancel_url,
			metadata: {
				appointment_type: appointment_type,
				full_name: full_name,
				email: email,
				phone_number: phone_number || '',
				start_time: start_time,
				end_time: end_time,
				notes: notes || '',
				user_id: user_id?.toString() || '',
				course_id: course_id?.toString() || '',
				is_qa_booking: 'true',
				is_subscription: is_subscription ? 'true' : 'false',
			},
		});

		// Create consultation order for all Q&A sessions (including subscriptions)
		let order = null;
		if (user_id) {
			const { OrderStore } = require('../models/order');
			const orderStore = new OrderStore(req.app.locals.pool);
			
			try {
				order = await orderStore.createConsultationOrder({
					user_id: user_id,
					course_id: course_id,
					add_on_price: price,
					item_name: session_name,
					order_status: 'pending',
					payment_method: 'stripe',
					stripe_checkout_session_id: session.id,
					notes: `Q&A Consultation: ${appointment_type}`,
				});
			} catch (orderError) {
				console.error('Failed to create consultation order:', orderError);
				// Continue with checkout session creation even if order creation fails
			}
		}

		res.json({ 
			sessionId: session.id, 
			url: session.url,
			orderId: order?.id || null
		});
	} catch (error) {
		console.error('Q&A Checkout error:', error);
		res.status(500).json({ error: 'Failed to create checkout session' });
	}
};

/**
 * Create checkout session
 * POST /stripe/create-checkout
 */
const createCheckout = async (req, res) => {
	try {
		const { 
			price_id, success_url, cancel_url, mode, 
			course_id, course_price, 
			resource_id, resource_price, 
			ai_sifu_subscription, ai_sifu_price,
			qa_consultation, qa_consultation_type, qa_consultation_price, qa_session_name, qa_booking_data
		} = req.body;
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

		// For purchases, we need either a price_id, course_id + course_price, resource_id + resource_price, ai_sifu_subscription + ai_sifu_price, or qa_consultation + qa_consultation_price
		if (mode === 'payment' && !price_id && (!course_id || !course_price) && (!resource_id || !resource_price) && !ai_sifu_subscription && (!qa_consultation || !qa_consultation_price)) {
			return res.status(400).json({ error: 'For purchases, provide either price_id, course_id + course_price, resource_id + resource_price, ai_sifu_subscription + ai_sifu_price, or qa_consultation + qa_consultation_price' });
		}
		
		// For AI Sifu subscriptions, we need ai_sifu_price
		if (mode === 'subscription' && ai_sifu_subscription && !ai_sifu_price) {
			return res.status(400).json({ error: 'For AI Sifu subscriptions, ai_sifu_price is required' });
		}
		
		// For Q&A consultations, we need qa_consultation_price and qa_session_name
		if (qa_consultation && (!qa_consultation_price || !qa_session_name)) {
			return res.status(400).json({ error: 'For Q&A consultations, qa_consultation_price and qa_session_name are required' });
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
		} else if (resource_price) {
			// Get resource details for better product naming
			let resourceName = `Resource ${resource_id}`;
			let resourceType = 'resource';
			try {
				const resourceQuery = await req.app.locals.pool.query(
					'SELECT title, type FROM resources WHERE id = $1',
					[resource_id]
				);
				if (resourceQuery.rows.length > 0) {
					resourceName = resourceQuery.rows[0].title;
					resourceType = resourceQuery.rows[0].type;
				}
			} catch (error) {
				console.error('Error fetching resource title:', error);
				// Continue with default name
			}

			// Create dynamic price for resource add-on
			lineItems = [
				{
					price_data: {
						currency: 'usd',
						product_data: {
							name: resourceName,
							description: `Access to ${resourceName} ${resourceType === 'manual' ? 'manual' : resourceType} content`,
							metadata: {
								resource_id: resource_id.toString(),
							},
						},
						unit_amount: Math.round(resource_price * 100), // Convert to cents
					},
					quantity: 1,
				},
			];
		} else if (ai_sifu_subscription && ai_sifu_price) {
			// Create dynamic price for AI Sifu subscription
			lineItems = [
				{
					price_data: {
						currency: 'usd',
						product_data: {
							name: 'AI Sifu Monthly Subscription',
							description: 'Get unlimited access to your personal AI martial arts guide with 12 questions monthly',
							metadata: {
								is_ai_sifu_subscription: 'true',
							},
						},
						unit_amount: Math.round(ai_sifu_price * 100), // Convert to cents
						recurring: {
							interval: 'month',
						},
					},
					quantity: 1,
				},
			];
		} else if (qa_consultation && qa_consultation_price) {
			// Create dynamic price for Q&A consultation
			let description;
			switch (qa_consultation_type) {
				case 'written_guidance':
					description = 'Submit up to 5 written questions • 72-hour written response';
					break;
				case 'video_review':
					description = 'Submit practice video + 3 questions • Video response within 72hrs';
					break;
				case 'live_consultation':
					description = '20-minute scheduled Zoom call';
					break;
				case 'intensive_mentorship':
					description = 'Monthly subscription • Weekly 20-min calls • 3 questions/week • Advanced training';
					break;
				default:
					description = `${qa_session_name} consultation`;
			}

			const priceData = {
				currency: 'usd',
				product_data: {
					name: qa_session_name,
					description: description,
					metadata: {
						is_qa_consultation: 'true',
						qa_consultation_type: qa_consultation_type,
					},
				},
				unit_amount: Math.round(qa_consultation_price * 100), // Convert to cents
			};

			// Add recurring for intensive mentorship subscription
			if (qa_consultation_type === 'intensive_mentorship') {
				priceData.recurring = {
					interval: 'month',
				};
			}

			lineItems = [
				{
					price_data: priceData,
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
				resource_id: resource_id?.toString() || '',
				user_id: userId.toString(),
				is_ai_sifu_subscription: ai_sifu_subscription ? 'true' : 'false',
				is_qa_consultation: qa_consultation ? 'true' : 'false',
				qa_consultation_type: qa_consultation_type || '',
				qa_booking_data: qa_booking_data ? JSON.stringify(qa_booking_data) : '',
			},
		});

		let order = null;
		
		// Only create orders for course/resource/consultation purchases, not AI Sifu subscriptions
		if (!ai_sifu_subscription) {
			const orderStore = new OrderStore(req.app.locals.pool);

			if (qa_consultation) {
				// Create consultation order (Q&A add-on)
				order = await orderStore.createConsultationOrder({
					user_id: userId,
					course_id: course_id,
					add_on_price: qa_consultation_price,
					item_name: qa_session_name,
					order_status: 'pending',
					payment_method: 'stripe',
					stripe_checkout_session_id: session.id,
					notes: `Q&A Consultation: ${qa_consultation_type}`,
				});
			} else if (resource_id) {
				// Create add-on order for resource (linked to course)
				order = await orderStore.createAddOnOrder({
					user_id: userId,
					course_id: course_id,
					resource_id: resource_id,
					order_status: 'pending',
					payment_method: 'stripe',
					stripe_checkout_session_id: session.id,
				});
			} else {
				// Create regular course order
				order = await orderStore.create({
					user_id: userId,
					course_id: course_id,
					order_status: 'pending',
					payment_method: 'stripe',
					stripe_checkout_session_id: session.id,
				});
			}
		}

		res.json({ 
			sessionId: session.id, 
			url: session.url, 
			orderId: order?.id || null 
		});
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
		console.error('Webhook processing failed');
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
		const { session_id, course_id, resource_id } = req.body;
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
					enrolled: true,
					resource_access: resource_id ? true : false
				});
			} catch (error) {
				// Order might already be completed
				return res.json({ 
					success: true, 
					message: 'Payment already processed',
					enrolled: true,
					resource_access: resource_id ? true : false
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
		

		if ((mode === 'payment' || mode === 'subscription') && payment_status === 'paid') {
			// Handle one-time payment (course purchases or Q&A bookings)
			const {
				id: checkout_session_id,
				payment_intent,
				amount_subtotal,
				amount_total,
				currency,
				metadata
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

			// Check if this is a Q&A consultation
			if (metadata?.is_qa_booking === 'true') {
				// Complete the consultation order first
				const { OrderStore } = require('../models/order');
				const orderStore = new OrderStore(pool);

				try {
					await orderStore.completeFromStripe(
						checkout_session_id,
						payment_intent
					);
				} catch (error) {
					console.error('Failed to complete consultation order');
				}

				// Note: Booking is already created by frontend before payment
				// Webhook only handles payment/order completion
			} else {
				// Complete the main order (course/resource enrollment)
				const { OrderStore } = require('../models/order');
				const orderStore = new OrderStore(pool);

				try {
					await orderStore.completeFromStripe(
						checkout_session_id,
						payment_intent
					);
				} catch (error) {
					console.error('Failed to complete main order');
					// Stripe payment succeeded but order completion failed - needs manual review
				}
			}
		}
	}

	if (isSubscription) {
		await syncCustomerFromStripe(customerId, pool);
		
		// Handle subscription events
		if ((event.type === 'checkout.session.completed' && stripeData.subscription) ||
			event.type.startsWith('customer.subscription.')) {
			try {
				// Get subscription ID based on event type
				let subscriptionId;
				let userId;
				
				if (event.type === 'checkout.session.completed') {
					subscriptionId = stripeData.subscription;
					userId = parseInt(stripeData.metadata.user_id);
				} else if (event.type.startsWith('customer.subscription.')) {
					subscriptionId = stripeData.id;
					// For subscription events, get user from customer
					const customerQuery = await pool.query(
						'SELECT user_id FROM stripe_customers WHERE customer_id = $1',
						[customerId]
					);
					if (customerQuery.rows.length === 0) {
							return;
					}
					userId = customerQuery.rows[0].user_id;
					}
				
				// Get the subscription details from Stripe
				const subscription = await stripe.subscriptions.retrieve(subscriptionId);
				
				// Determine subscription type and details
				let subscriptionType = 'general';
				let resourceId = null;
				let metadata = {};
				
				if (event.type === 'checkout.session.completed' && stripeData.metadata?.is_ai_sifu_subscription === 'true') {
					subscriptionType = 'ai_sifu';
					metadata = { 
						description: 'AI Sifu Monthly Subscription',
						features: ['12 questions per month', 'Personal AI martial arts guide']
					};
				} else if (event.type === 'checkout.session.completed' && stripeData.metadata?.is_qa_booking === 'true' && stripeData.metadata?.appointment_type === 'intensive_mentorship') {
					subscriptionType = 'intensive_mentorship';
					metadata = {
						description: 'Intensive Mentorship Monthly Subscription',
						features: ['Weekly 20-min calls', '3 questions per week', 'Advanced training', 'Dedicated instructor relationship'],
						appointment_type: stripeData.metadata.appointment_type,
						full_name: stripeData.metadata.full_name,
						email: stripeData.metadata.email,
						phone_number: stripeData.metadata.phone_number,
						start_time: stripeData.metadata.start_time,
						end_time: stripeData.metadata.end_time,
						notes: stripeData.metadata.notes
					};
					
				} else if (event.type === 'checkout.session.completed' && stripeData.metadata?.course_id) {
					subscriptionType = 'course';
					resourceId = parseInt(stripeData.metadata.course_id);
				} else if (event.type.startsWith('customer.subscription.')) {
					// For subscription events, determine type from product name or metadata
					const productName = subscription.items.data[0]?.price?.product?.name || 
					                   subscription.items.data[0]?.price?.nickname || '';
					const productMetadata = subscription.items.data[0]?.price?.product?.metadata || {};
					
					if (productName.includes('AI Sifu') || productName.includes('ai_sifu')) {
						subscriptionType = 'ai_sifu';
						metadata = { 
							description: 'AI Sifu Monthly Subscription',
							features: ['12 questions per month', 'Personal AI martial arts guide']
						};
					} else if (productName.includes('Intensive Mentorship') || productMetadata.appointment_type === 'intensive_mentorship') {
						subscriptionType = 'intensive_mentorship';
						metadata = {
							description: 'Intensive Mentorship Monthly Subscription',
							features: ['Weekly 20-min calls', '3 questions per week', 'Advanced training', 'Dedicated instructor relationship']
						};
					}
				}
				
				// Create subscription record in general subscriptions table
				const subscriptionSql = `
					INSERT INTO subscriptions (
						user_id, stripe_subscription_id, subscription_type, resource_id, 
						status, current_period_start, current_period_end, cancel_at_period_end,
						price_cents, metadata
					)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
					ON CONFLICT (stripe_subscription_id) 
					DO UPDATE SET 
						status = EXCLUDED.status,
						current_period_start = EXCLUDED.current_period_start,
						current_period_end = EXCLUDED.current_period_end,
						cancel_at_period_end = EXCLUDED.cancel_at_period_end,
						updated_at = CURRENT_TIMESTAMP
				`;
				
				// Calculate price in cents from subscription
				const priceCents = subscription.items.data[0]?.price?.unit_amount || 0;
				
				// Skip creating 'general' subscriptions from customer.subscription.created events
				// These are handled better by checkout.session.completed events with proper metadata
				if (subscriptionType === 'general' && event.type === 'customer.subscription.created') {
						return;
				}
				
				// Validate and convert timestamps
				const startDate = subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : new Date();
				const endDate = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default to 30 days from now
				
				await pool.query(subscriptionSql, [
					userId,
					subscription.id,
					subscriptionType,
					resourceId,
					subscription.status,
					startDate,
					endDate,
					subscription.cancel_at_period_end,
					priceCents,
					JSON.stringify(metadata)
				]);
				
			} catch (error) {
				console.error('Error activating subscription:', error);
			}
		}
	}

	// Handle subscription deletion/cancellation events
	if (event.type === 'customer.subscription.deleted' || 
		(event.type === 'customer.subscription.updated' && stripeData.status === 'canceled')) {
		try {
			const subscriptionId = stripeData.id;

			// Update subscription status in both tables
			await pool.query(
				'UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = $2',
				['cancelled', subscriptionId]
			);

			await pool.query(
				'UPDATE stripe_subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE subscription_id = $2',
				['canceled', subscriptionId]
			);

		} catch (error) {
			console.error('Error updating cancelled subscription:', error);
		}
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

		let subscription = subscriptions.data[0];
		
		// Fetch full subscription details to ensure we have period dates
		subscription = await stripe.subscriptions.retrieve(subscription.id, {
			expand: ['default_payment_method']
		});
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
		console.error('Failed to sync subscription for customer');
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
	app.post('/stripe/create-qa-checkout-session', createQACheckout); // Q&A checkout can be used by guests
	app.post('/stripe/verify-payment', authenticationToken, verifyPayment);
	app.get('/stripe/subscription/:userId', authenticateUserId, getSubscription);
	app.get('/stripe/orders/:userId', authenticateUserId, getOrders);
};

module.exports = stripe_route;
