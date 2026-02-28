// handlers/paypal.js
require('dotenv').config();
const {
	PayPalCustomerStore,
	PayPalSubscriptionStore,
	PayPalOrderStore,
} = require('../models/paypal');
const {
	authenticationToken,
	authenticateUserId,
} = require('../middleware/auth');
const puppeteer = require('puppeteer');

const { OrderStore } = require('../models/order');
const { MessageStore } = require('../models/message');
const OptimizedNeigongAgent = require('../utilis/optimizedAgent');

// PayPal API configuration
const PAYPAL_BASE_URL = process.env.PAYPAL_ENVIRONMENT === 'production' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

// Get PayPal access token
async function getPayPalAccessToken() {
	const auth = Buffer.from(
		`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
	).toString('base64');

	const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
		method: 'POST',
		body: 'grant_type=client_credentials',
		headers: {
			Authorization: `Basic ${auth}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
	});

	const data = await response.json();

	if (!response.ok) {
		console.error('Failed to get PayPal access token:', data);
		throw new Error(
			`PayPal authentication failed: ${data.error_description || data.error}`
		);
	}

	return data.access_token;
}

/**
 * Handle AI Sifu response for written guidance (async background processing)
 * Same as Stripe implementation
 */
async function handleWrittenGuidanceResponse(
	userId,
	questions,
	courseId,
	paypalOrderId = null
) {
	// Create fresh database pool for this background task
	const { Pool } = require('pg');
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		max: 5,
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 5000,
	});
	let client = null;
	try {
		client = await pool.connect();

		// Check if we've already processed this order to prevent duplicates
		if (paypalOrderId) {
			const duplicateCheck = await client.query(
				`
				SELECT m.id FROM messages m
				JOIN conversations c ON m.conversation_id = c.id
				WHERE m.sender_id = (SELECT id FROM users WHERE is_admin = true LIMIT 1)
				AND (c.user1_id = $1 OR c.user2_id = $1)
				AND m.text LIKE '%Thank you for your written guidance questions%'
				AND m.sent_at > NOW() - INTERVAL '1 hour'
				AND m.text LIKE '%' || $2 || '%'
				LIMIT 1
			`,
				[userId, paypalOrderId.slice(-8)]
			); // Use last 8 chars of order ID as marker

			if (duplicateCheck.rows.length > 0) {
				return;
			}
		}

		// Get admin user ID
		const adminQuery = await client.query(
			'SELECT id FROM users WHERE is_admin = true LIMIT 1'
		);
		if (adminQuery.rows.length === 0) {
			console.error('No admin user found for AI Sifu responses');
			return;
		}
		const adminId = adminQuery.rows[0].id;

		client.release();
		client = null;

		// Create separate database pool for AI operations
		const { Pool: AIPool } = require('pg');
		const aiPool = new AIPool({
			connectionString: process.env.DATABASE_URL,
			max: 2,
			idleTimeoutMillis: 10000,
			connectionTimeoutMillis: 5000,
		});

		let aiResponse;
		try {
			const agent = new OptimizedNeigongAgent(aiPool);
			aiResponse = await agent.handleQuery(questions, courseId);
		} finally {
			try {
				await aiPool.end();
			} catch (poolError) {
				console.error('Error closing AI pool:', poolError);
			}
		}

		// Format as professional admin message
		const orderRef = paypalOrderId ? ` [Ref: ${paypalOrderId.slice(-8)}]` : '';
		const responseMessage = `Dear Student,

Thank you for your written guidance questions. I have carefully reviewed your inquiry and am pleased to provide you with the following detailed response:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${aiResponse.response}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I hope this guidance helps you in your martial arts journey. If you need further clarification or wish to discuss these concepts in real-time, please consider booking a Live Consultation for more personalized instruction.

Wishing you continued progress in your training,

The Jing Wu Method Team${orderRef}
📧 Contact us anytime for additional support
🥋 Your martial arts mastery is our mission`;

		// Wait 10 minutes before sending the message
		setTimeout(async () => {
			const { Pool: DelayedPool } = require('pg');
			const delayedPool = new DelayedPool({
				connectionString: process.env.DATABASE_URL,
				max: 5,
				idleTimeoutMillis: 30000,
				connectionTimeoutMillis: 5000,
			});

			try {
				const messageStore = new MessageStore(delayedPool);
				const message = await messageStore.sendMessage(
					adminId,
					userId,
					responseMessage
				);

				// Update booking status from 'scheduled' to 'completed'
				try {
					const { BookingsStore } = require('../models/booking');
					const bookingsStore = new BookingsStore(delayedPool);

					const delayedClient = await delayedPool.connect();
					const bookingQuery = await delayedClient.query(
						`
						SELECT id FROM bookings 
						WHERE user_id = $1 
						AND appointment_type = 'written_guidance' 
						AND status = 'scheduled'
						ORDER BY created_at DESC 
						LIMIT 1
					`,
						[userId]
					);

					if (bookingQuery.rows.length > 0) {
						const bookingId = bookingQuery.rows[0].id;
						await bookingsStore.updateBookingStatus(bookingId, 'completed');
					}
					delayedClient.release();
				} catch (bookingError) {
					console.error(
						`Error updating booking status for user ${userId}:`,
						bookingError
					);
				}
			} catch (messageError) {
				console.error(
					`Error sending delayed written guidance response to user ${userId}:`,
					messageError
				);
			} finally {
				try {
					await delayedPool.end();
				} catch (poolError) {
					console.error('Error closing delayed pool:', poolError);
				}
			}
		}, 10 * 60 * 1000); // 10 minutes delay
	} catch (error) {
		console.error('Error handling written guidance AI response:', error);
		console.error('Error details:', error.message);
	} finally {
		if (client) {
			client.release();
		}
		try {
			await pool.end();
		} catch (poolError) {
			console.error('Error closing background task pool:', poolError);
		}
	}
}

/**
 * PayPal Handlers - All business logic for PayPal operations
 */

/**
 * Setup PayPal subscription plan (run once to create the plan)
 * POST /paypal/setup-subscription-plan
 */
const setupSubscriptionPlan = async (req, res) => {
	try {
		const accessToken = await getPayPalAccessToken();
		
		// First create the product
		const productRequest = {
			name: 'Intensive Mentorship Subscription',
			description: 'Monthly subscription for intensive mentorship program with weekly calls and advanced training',
			type: 'SERVICE',
			category: 'SOFTWARE'
		};
		
		const productResponse = await fetch(`${PAYPAL_BASE_URL}/v1/catalogs/products`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(productRequest),
		});
		
		if (!productResponse.ok) {
			const errorData = await productResponse.json();
			return res.status(500).json({ 
				error: 'Failed to create subscription product',
				details: errorData 
			});
		}
		
		const product = await productResponse.json();
		
		// Then create the plan
		const planRequest = {
			product_id: product.id,
			name: 'Intensive Mentorship Monthly Plan',
			description: 'Monthly subscription for intensive mentorship program - $30/month',
			status: 'ACTIVE',
			billing_cycles: [{
				frequency: {
					interval_unit: 'MONTH',
					interval_count: 1
				},
				tenure_type: 'REGULAR',
				sequence: 1,
				total_cycles: 0, // 0 = infinite billing cycles
				pricing_scheme: {
					fixed_price: {
						value: '100.00',
						currency_code: 'USD'
					}
				}
			}],
			payment_preferences: {
				auto_bill_outstanding: true,
				setup_fee: {
					value: '100.00',
					currency_code: 'USD'
				},
				setup_fee_failure_action: 'CONTINUE',
				payment_failure_threshold: 3
			}
		};
		
		const planResponse = await fetch(`${PAYPAL_BASE_URL}/v1/billing/plans`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(planRequest),
		});
		
		if (!planResponse.ok) {
			const errorData = await planResponse.json();
			return res.status(500).json({ 
				error: 'Failed to create subscription plan',
				details: errorData 
			});
		}
		
		const plan = await planResponse.json();
		
		res.json({
			success: true,
			product_id: product.id,
			plan_id: plan.id,
			message: `Set PAYPAL_INTENSIVE_MENTORSHIP_PLAN_ID=${plan.id} in your environment variables`
		});
		
	} catch (error) {
		console.error('PayPal subscription plan setup error:', error);
		res.status(500).json({ error: 'Failed to setup subscription plan' });
	}
};

/**
 * Create PayPal Subscription for Intensive Mentorship
 * POST /paypal/create-subscription
 */
const createSubscription = async (req, res) => {
	try {
		const { 
			full_name, 
			email, 
			phone_number, 
			start_time, 
			end_time, 
			notes, 
			user_id, 
			course_id 
		} = req.body;

		if (!full_name || !email || !user_id) {
			return res.status(400).json({ 
				error: 'Missing required fields: full_name, email, user_id' 
			});
		}

		const accessToken = await getPayPalAccessToken();
		
		// Create compact metadata for custom_id (PayPal limit: 127 chars)
		const compactMetadata = JSON.stringify({
			t: 'ims', // type: intensive_mentorship_subscription
			u: user_id.toString(),
			c: course_id?.toString() || '0'
		});

		// Create subscription request
		const subscriptionRequest = {
			plan_id: process.env.PAYPAL_INTENSIVE_MENTORSHIP_PLAN_ID,
			start_time: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // Start in 5 minutes (updated)
			subscriber: {
				name: {
					given_name: full_name.split(' ')[0],
					surname: full_name.split(' ').slice(1).join(' ') || 'User'
				},
				email_address: email
			},
			application_context: {
				brand_name: 'Jing Wu Foundation',
				locale: 'en-US',
				shipping_preference: 'NO_SHIPPING',
				user_action: 'SUBSCRIBE_NOW',
				payment_method: {
					payer_selected: 'PAYPAL',
					payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED'
				},
				return_url: `${process.env.FRONTEND_URL}/payment/success?subscription=intensive_mentorship&paypal=true${course_id ? `&course_id=${course_id}` : ''}`,
				cancel_url: `${process.env.FRONTEND_URL}/payment/failed?subscription=intensive_mentorship&reason=cancelled&paypal=true${course_id ? `&course_id=${course_id}` : ''}`
			},
			custom_id: compactMetadata
		};

		const response = await fetch(`${PAYPAL_BASE_URL}/v1/billing/subscriptions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(subscriptionRequest),
		});

		if (!response.ok) {
			const errorData = await response.json();
			console.error('PayPal subscription creation failed:', errorData);
			return res.status(500).json({ 
				error: 'Failed to create PayPal subscription',
				details: errorData.message 
			});
		}

		const subscription = await response.json();
		
		// NOTE: For subscriptions, we DO NOT create internal orders immediately
		// The order and booking will be created only when the subscription is activated
		// via the BILLING.SUBSCRIPTION.ACTIVATED webhook event. This prevents
		// duplicate bookings when users cancel before completing payment.

		// Find approval URL
		const approvalUrl = subscription.links.find(
			(link) => link.rel === 'approve'
		)?.href;

		res.json({
			subscriptionId: subscription.id,
			approvalUrl: approvalUrl,
		});
	} catch (error) {
		console.error('PayPal subscription creation error:', error.message);
		res.status(500).json({ error: 'Failed to create subscription' });
	}
};

/**
 * Create Q&A checkout session
 * POST /paypal/create-qa-checkout
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
			course_id,
		} = req.body;

		if (!appointment_type || !full_name || !email || !price || !session_name) {
			return res.status(400).json({ error: 'Missing required parameters' });
		}

		// Route intensive mentorship to subscription API
		if (appointment_type === 'intensive_mentorship' && is_subscription) {
			return await createSubscription(req, res);
		}

		// Initialize stores
		const customerStore = new PayPalCustomerStore(req.app.locals.pool);

		// Create or find PayPal customer record
		let paypalCustomer = await customerStore.findByUserId(user_id);
		let payerId;

		if (!paypalCustomer && user_id) {
			// We'll create the customer record after payment completion when we have payer_id
			payerId = null;
		} else if (paypalCustomer) {
			payerId = paypalCustomer.payer_id;
		}

		// Create PayPal order
		let description;
		switch (appointment_type) {
			case 'written_guidance':
				description =
					'Submit up to 5 written questions • 72-hour written response';
				break;
			case 'video_review':
				description =
					'Submit practice video + 3 questions • Video response within 72hrs';
				break;
			case 'live_consultation':
				description = '20-minute scheduled Zoom call';
				break;
			case 'intensive_mentorship':
				description =
					'Monthly subscription • Weekly 20-min calls • 3 questions/week • Advanced training';
				break;
			default:
				description = `${session_name} session`;
		}

		// Prepare order request
		const orderRequest = {
			intent: is_subscription ? 'AUTHORIZE' : 'CAPTURE',
			purchase_units: [
				{
					amount: {
						currency_code: 'USD',
						value: price.toString(),
					},
					description: description,
					custom_id: JSON.stringify({
						type: 'qa',
						apt: appointment_type,
						uid: user_id?.toString() || '',
						cid: course_id?.toString() || '',
						sub: is_subscription ? '1' : '0',
					}),
				},
			],
			application_context: {
				return_url: `${
					process.env.FRONTEND_URL
				}/payment/success?qa_consultation=${appointment_type}&paypal=true${
					course_id ? `&course_id=${course_id}` : ''
				}&session_name=${encodeURIComponent(session_name)}&price=${price}`,
				cancel_url: `${
					process.env.FRONTEND_URL
				}/payment/failed?qa_consultation=${appointment_type}&reason=cancelled&paypal=true${
					course_id ? `&course_id=${course_id}` : ''
				}`,
				brand_name: 'Jing Wu Foundation',
				user_action: 'CONTINUE',
				shipping_preference: 'NO_SHIPPING',
			},
		};

		// Create order with PayPal
		const accessToken = await getPayPalAccessToken();
		const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(orderRequest),
		});

		if (!response.ok) {
			console.error('PayPal Q&A Checkout API Error');
			throw new Error(`Failed to create PayPal Q&A order: ${response.status}`);
		}

		const order = await response.json();

		// For Q&A consultations, store booking data temporarily in order notes
		// but do NOT create the actual booking until payment is completed.
		// This prevents duplicate bookings when users cancel before payment.
		
		const bookingDataJson = JSON.stringify({
			appointment_type,
			full_name,
			email,
			phone_number: phone_number || null,
			start_time,
			end_time,
			notes: notes || null,
			user_id: user_id,
		});
		
		// Create a temporary order to store booking data, but don't create booking yet
		let internalOrder = null;
		if (user_id) {
			const { OrderStore } = require('../models/order');
			const orderStore = new OrderStore(req.app.locals.pool);

			try {
				internalOrder = await orderStore.createConsultationOrder({
					user_id: user_id,
					course_id: course_id,
					add_on_price: price,
					item_name: session_name,
					order_status: 'pending', // Keep as pending until payment complete
					payment_method: 'paypal',
					paypal_order_id: order.id,
					notes: bookingDataJson, // Store full booking data here
				});
			} catch (orderError) {
				console.error('Failed to create temporary consultation order:', orderError);
				throw orderError;
			}
		}

		// Find approval URL
		const approvalUrl = order.links.find(
			(link) => link.rel === 'approve'
		)?.href;

		res.json({
			orderId: order.id,
			approvalUrl: approvalUrl,
			internalOrderId: internalOrder?.id || null,
		});
	} catch (error) {
		console.error('PayPal Q&A Checkout error:', error);
		res.status(500).json({ error: 'Failed to create checkout session' });
	}
};

/**
 * Create checkout session
 * POST /paypal/create-checkout
 */
const createCheckout = async (req, res) => {
	try {
		const {
			course_id,
			course_price,
			original_price,
			coupon_code,
			coupon_applied,
			resource_id,
			resource_price,
			ai_sifu_subscription,
			ai_sifu_price,
			qa_consultation,
			qa_consultation_type,
			qa_consultation_price,
			qa_session_name,
			qa_booking_data,
		} = req.body;
		const userId = req.user.id;

		console.log('Backend received PayPal checkout data:', {
			course_price,
			course_id
		});

		if (!userId) {
			return res.status(400).json({ error: 'User ID not found in token' });
		}

		// Frontend handles all coupon logic, just use the provided price
		let finalPrice = course_price || resource_price || ai_sifu_price || qa_consultation_price;

		// Validate required parameters
		if (
			!course_price &&
			!resource_price &&
			!ai_sifu_price &&
			!qa_consultation_price
		) {
			return res.status(400).json({ error: 'Price is required' });
		}

		// Initialize stores
		const customerStore = new PayPalCustomerStore(req.app.locals.pool);

		// Determine item details
		let itemName, itemDescription, itemPrice;

		if (course_price) {
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
			}
			itemName = courseName;
			itemDescription = `Access to ${courseName} course content`;
			itemPrice = finalPrice;
		} else if (resource_price) {
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
			}
			itemName = resourceName;
			itemDescription = `Access to ${resourceName} ${
				resourceType === 'manual' ? 'manual' : resourceType
			} content`;
			itemPrice = resource_price;
		} else if (ai_sifu_subscription && ai_sifu_price) {
			itemName = 'AI Sifu Monthly Subscription';
			itemDescription =
				'Get unlimited access to your personal AI martial arts guide with 12 questions monthly';
			itemPrice = ai_sifu_price;
		} else if (qa_consultation && qa_consultation_price) {
			let description;
			switch (qa_consultation_type) {
				case 'written_guidance':
					description =
						'Submit up to 5 written questions • 72-hour written response';
					break;
				case 'video_review':
					description =
						'Submit practice video + 3 questions • Video response within 72hrs';
					break;
				case 'live_consultation':
					description = '20-minute scheduled Zoom call';
					break;
				case 'intensive_mentorship':
					description =
						'Monthly subscription • Weekly 20-min calls • 3 questions/week • Advanced training';
					break;
				default:
					description = `${qa_session_name} consultation`;
			}
			itemName = qa_session_name;
			itemDescription = description;
			itemPrice = qa_consultation_price;
		}

		// Determine return URL and cancel URL based on purchase type
		let returnUrl, cancelUrl;
		if (resource_id) {
			// For in-app resource purchases, go to payment success page first
			returnUrl = `${process.env.FRONTEND_URL}/payment/success?paypal=true&resource_id=${resource_id}`;
			cancelUrl = `${process.env.FRONTEND_URL}/app/resources`;
		} else if (qa_consultation) {
			// For Q&A consultations, include consultation type
			returnUrl = `${
				process.env.FRONTEND_URL
			}/payment/success?qa_consultation=${qa_consultation_type}&paypal=true${
				course_id ? `&course_id=${course_id}` : ''
			}`;
			cancelUrl = `${process.env.FRONTEND_URL}/payment/failed?qa_consultation=${qa_consultation_type}&reason=cancelled&paypal=true${
				course_id ? `&course_id=${course_id}` : ''
			}`;
		} else if (ai_sifu_subscription) {
			// For AI Sifu subscriptions
			returnUrl = `${process.env.FRONTEND_URL}/payment/success?ai_sifu=true&paypal=true`;
			cancelUrl = `${process.env.FRONTEND_URL}/payment/failed?reason=cancelled&paypal=true`;
		} else {
			// For course purchases - check if it's a series
			let isSeries = false;
			if (course_id) {
				try {
					const courseQuery = await req.app.locals.pool.query(
						'SELECT is_series FROM courses WHERE id = $1',
						[course_id]
					);
					if (courseQuery.rows.length > 0) {
						isSeries = courseQuery.rows[0].is_series;
					}
				} catch (error) {
					console.error('Error checking if course is series:', error);
				}
			}
			
			returnUrl = `${process.env.FRONTEND_URL}/payment/success?paypal=true${
				course_id ? `&course_id=${course_id}` : ''
			}${isSeries ? '&series=true' : ''}`;
			cancelUrl = `${process.env.FRONTEND_URL}/payment/failed?reason=cancelled&paypal=true${isSeries ? '&series=true' : ''}`;
		}

		// Prepare order request
		const orderRequest = {
			intent: 'CAPTURE',
			purchase_units: [
				{
					amount: {
						currency_code: 'USD',
						value: itemPrice.toString(),
					},
					description: itemDescription,
					custom_id: JSON.stringify({
						course_id: course_id?.toString() || '',
						resource_id: resource_id?.toString() || '',
						user_id: userId.toString(),
						is_ai_sifu_subscription: ai_sifu_subscription ? 'true' : 'false',
						is_qa_consultation: qa_consultation ? 'true' : 'false',
						qa_consultation_type: qa_consultation_type || '',
						qa_booking_data: qa_booking_data
							? JSON.stringify(qa_booking_data)
							: '',
					}),
				},
			],
			application_context: {
				return_url: returnUrl,
				cancel_url: cancelUrl,
				brand_name: 'Jing Wu Foundation',
				user_action: 'CONTINUE',
				shipping_preference: 'NO_SHIPPING',
			},
		};

		// Create order with PayPal
		const accessToken = await getPayPalAccessToken();
		const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(orderRequest),
		});

		if (!response.ok) {
			throw new Error('Failed to create PayPal order');
		}

		const order = await response.json();

		// Create internal order tracking
		let internalOrder = null;

		// Only create orders for course/resource/consultation purchases, not AI Sifu subscriptions
		if (!ai_sifu_subscription) {
			const orderStore = new OrderStore(req.app.locals.pool);

			if (qa_consultation) {
				internalOrder = await orderStore.createConsultationOrder({
					user_id: userId,
					course_id: course_id,
					add_on_price: qa_consultation_price,
					item_name: qa_session_name,
					order_status: 'pending',
					payment_method: 'paypal',
					paypal_order_id: order.id,
					notes: `Q&A Consultation: ${qa_consultation_type}`,
				});
			} else if (resource_id) {
				try {
					internalOrder = await orderStore.createAddOnOrder({
						user_id: userId,
						course_id: course_id,
						resource_id: resource_id,
						order_status: 'pending',
						payment_method: 'paypal',
						paypal_order_id: order.id,
					});
				} catch (orderError) {
					console.error('Failed to create PayPal add-on order:', orderError);
					throw orderError;
				}
			} else {
				internalOrder = await orderStore.create({
					user_id: userId,
					course_id: course_id,
					order_status: 'pending',
					payment_method: 'paypal',
					paypal_order_id: order.id,
				});
			}
		}

		// Find approval URL
		const approvalUrl = order.links.find(
			(link) => link.rel === 'approve'
		)?.href;

		res.json({
			orderId: order.id,
			approvalUrl: approvalUrl,
			internalOrderId: internalOrder?.id || null,
		});
	} catch (error) {
		console.error('PayPal Checkout error:', error.message);
		res.status(500).json({ error: 'Failed to create checkout session' });
	}
};

/**
 * Create public shop checkout session (no auth required)
 * POST /paypal/create-shop-checkout
 */
const createShopCheckout = async (req, res) => {
	try {
		const { resource_id, resource_price } = req.body;

		if (!resource_id || !resource_price) {
			return res.status(400).json({ error: 'Missing required parameters' });
		}

		// Prepare order request
		const orderRequest = {
			intent: 'CAPTURE',
			purchase_units: [
				{
					amount: {
						currency_code: 'USD',
						value: resource_price.toString(),
					},
					description: `Resource #${resource_id}`,
					custom_id: JSON.stringify({
						resource_id: resource_id.toString(),
						course_id: '99999', // Special shop identifier
						is_shop_purchase: 'true',
					}),
				},
			],
			application_context: {
				return_url: `${process.env.FRONTEND_URL}/download-success?paypal=true`,
				cancel_url: `${process.env.FRONTEND_URL}/shop`,
				brand_name: 'Jing Wu Foundation',
				user_action: 'CONTINUE',
				shipping_preference: 'NO_SHIPPING',
			},
		};

		// Create order with PayPal
		const accessToken = await getPayPalAccessToken();
		const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(orderRequest),
		});

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(
				`Failed to create PayPal shop order: ${
					response.status
				} - ${JSON.stringify(errorData)}`
			);
		}

		const order = await response.json();

		// Store order record in paypal_orders table
		const paypalOrderStore = new PayPalOrderStore(req.app.locals.pool);
		await paypalOrderStore.create({
			paypalOrderId: order.id,
			payerId: null, // Will be updated after payment
			amountValue: parseFloat(resource_price),
			amountCurrency: 'USD',
			paymentStatus: 'pending',
			captureId: null,
			status: 'pending',
		});

		// Find approval URL
		const approvalUrl = order.links.find(
			(link) => link.rel === 'approve'
		)?.href;

		return res.status(200).json({
			orderId: order.id,
			approvalUrl: approvalUrl,
			internalOrderId: null,
		});
	} catch (error) {
		console.error('PayPal Shop checkout error:', error.message);
		res.status(500).json({ error: 'Failed to create shop checkout session' });
	}
};

/**
 * Handle large file downloads with extended timeouts
 * Used for HTML content > 10MB
 */
const handleLargeFileDownload = async (resource, res) => {
	console.log(`Processing large file download for: ${resource.title} (${(resource.content?.length / 1024 / 1024).toFixed(2)}MB)`);

	try {
		const browser = await puppeteer.launch({
			headless: true,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-accelerated-2d-canvas',
				'--no-first-run',
				'--no-zygote',
				'--single-process',
				'--disable-gpu',
			],
		});

		try {
			const page = await browser.newPage();

			// Extended timeouts for large files (5 minutes)
			page.setDefaultNavigationTimeout(300000); // 5 minutes
			page.setDefaultTimeout(300000); // 5 minutes

			const content =
				resource.type === 'manual'
					? resource.content
					: resource.content?.replace(/\n/g, '<br>');
			const htmlContent = `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<title>${resource.title}</title>
				</head>
				<body>
					${content || 'No content available'}
				</body>
				</html>
			`;

			console.log('Setting content for large file (this may take a while)...');

			// Use 'domcontentloaded' instead of 'networkidle0' for faster processing
			await page.setContent(htmlContent, {
				waitUntil: 'domcontentloaded',
				timeout: 300000, // 5 minute timeout
			});

			console.log('Generating PDF for large file...');

			const pdfBuffer = await page.pdf({
				format: 'A4',
				printBackground: true,
				margin: {
					top: '0mm',
					right: '0mm',
					bottom: '0mm',
					left: '0mm',
				},
				timeout: 300000, // 5 minute timeout for PDF generation
			});

			await browser.close();

			console.log(`Large file PDF generated successfully: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)}MB`);

			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${resource.title.replace(
					/[^a-zA-Z0-9]/g,
					'-'
				)}.pdf"`
			);
			res.setHeader('Content-Length', pdfBuffer.length);

			return res.send(pdfBuffer);
		} catch (error) {
			await browser.close();
			throw error;
		}
	} catch (error) {
		console.error('Large file download error:', error);

		return res.status(500).json({
			error: 'File is too large to process at this time',
			message: 'Please try again in a few moments. If the problem persists, contact support.',
			isLargeFile: true,
			fileSize: resource.content?.length,
		});
	}
};

/**
 * Public resource download after shop purchase
 * GET /paypal/shop-download/:orderId
 */
const shopDownload = async (req, res) => {
	try {
		const { orderId } = req.params;

		// Verify payment was completed
		const paypalOrderStore = new PayPalOrderStore(req.app.locals.pool);
		const order = await paypalOrderStore.findByPayPalOrderId(orderId);

		if (!order) {
			return res.status(404).json({ error: 'Order not found' });
		}

		// Check payment status
		if (order.payment_status !== 'COMPLETED') {
			return res.status(404).json({ error: 'Payment not completed yet' });
		}

		// Get PayPal order details to extract resource info
		const accessToken = await getPayPalAccessToken();
		const response = await fetch(
			`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);

		if (!response.ok) {
			return res.status(404).json({ error: 'PayPal order not found' });
		}

		const paypalOrder = await response.json();

		const customId = paypalOrder.purchase_units[0]?.custom_id;
		if (!customId) {
			return res.status(404).json({ error: 'Resource information not found' });
		}

		const metadata = JSON.parse(customId);
		const resourceId = metadata.resource_id;

		if (!resourceId) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		// Get resource from database
		const { ResourceStore } = require('../models/resource');
		const resourceStore = new ResourceStore(req.app.locals.pool);
		const resource = await resourceStore.show(parseInt(resourceId));

		if (!resource) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		// Check content size - if > 10MB, use special large file handler
		const contentSize = resource.content?.length || 0;
		const sizeMB = contentSize / 1024 / 1024;

		if (contentSize > 10000000) { // 10MB threshold
			console.log(`Large file detected (${sizeMB.toFixed(2)}MB) - using extended timeout handler`);
			return handleLargeFileDownload(resource, res);
		}

		// Normal file processing for files < 10MB
		console.log(`Processing standard file (${sizeMB.toFixed(2)}MB)`);

		// Generate PDF using puppeteer
		const browser = await puppeteer.launch({
			headless: true,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-accelerated-2d-canvas',
				'--no-first-run',
				'--no-zygote',
				'--single-process',
				'--disable-gpu',
			],
		});

		try {
			const page = await browser.newPage();

			const content =
				resource.type === 'manual'
					? resource.content
					: resource.content?.replace(/\n/g, '<br>');
			const htmlContent = `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<title>${resource.title}</title>
				</head>
				<body>
					${content || 'No content available'}
				</body>
				</html>
			`;

			await page.setContent(htmlContent, {
				waitUntil: 'networkidle0',
			});

			const pdfBuffer = await page.pdf({
				format: 'A4',
				printBackground: true,
				margin: {
					top: '0mm',
					right: '0mm',
					bottom: '0mm',
					left: '0mm',
				},
			});

			await browser.close();

			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${resource.title.replace(
					/[^a-zA-Z0-9]/g,
					'-'
				)}.pdf"`
			);
			res.setHeader('Content-Length', pdfBuffer.length);

			return res.send(pdfBuffer);
		} catch (error) {
			await browser.close();
			throw error;
		}
	} catch (error) {
		console.error('PayPal Shop download error:', error);
		res.status(500).json({ error: 'Failed to process download' });
	}
};

/**
 * Get resource info for shop purchase (without downloading)
 * GET /paypal/shop-info/:orderId
 */
const shopInfo = async (req, res) => {
	try {
		const { orderId } = req.params;

		// Verify payment was completed
		const paypalOrderStore = new PayPalOrderStore(req.app.locals.pool);
		const order = await paypalOrderStore.findByPayPalOrderId(orderId);

		if (!order) {
			return res.status(404).json({ error: 'Order not found' });
		}

		// Check payment status
		if (order.payment_status !== 'COMPLETED') {
			return res.status(404).json({ error: 'Payment not completed yet' });
		}

		// Get resource_id directly from PayPal API since we know the order was captured successfully
		// We need to retrieve the PayPal order to get the custom_id with resource information
		const accessToken = await getPayPalAccessToken();
		const paypalResponse = await fetch(
			`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);

		if (!paypalResponse.ok) {
			return res.status(404).json({ error: 'PayPal order not found' });
		}

		const paypalOrder = await paypalResponse.json();
		const customId =
			paypalOrder.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;

		if (!customId) {
			return res.status(404).json({ error: 'Order metadata not found' });
		}

		let metadata;
		try {
			metadata = JSON.parse(customId);
		} catch (error) {
			return res.status(404).json({ error: 'Invalid order metadata' });
		}

		const resourceId = metadata.resource_id;
		if (!resourceId) {
			return res.status(404).json({ error: 'Resource information not found' });
		}

		// Get resource from database
		const { ResourceStore } = require('../models/resource');
		const resourceStore = new ResourceStore(req.app.locals.pool);
		const resource = await resourceStore.show(parseInt(resourceId));

		if (!resource) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		return res.json({
			success: true,
			resource: {
				id: resource.id,
				title: resource.title,
				author: resource.author || 'JingWu Foundation',
				type: resource.type || 'Resource',
				category: resource.category,
			},
			order_id: orderId,
		});
	} catch (error) {
		console.error('PayPal Shop info error:', error);
		res.status(500).json({ error: 'Failed to get resource info' });
	}
};

/**
 * PayPal webhook handler
 * POST /paypal/webhook
 */
const webhook = async (req, res) => {
	try {
		// PayPal webhook verification would go here
		// For now, we'll handle the common webhook events
		
		// Parse the raw buffer data to JSON
		let event;
		if (Buffer.isBuffer(req.body)) {
			const rawBody = req.body.toString('utf8');
			event = JSON.parse(rawBody);
		} else {
			event = req.body;
		}

		// Handle the event
		await handlePayPalEvent(event, req.app.locals.pool);

		res.json({ received: true });
	} catch (error) {
		console.error('PayPal Webhook processing failed:', error);
		res.status(500).json({ error: 'Webhook processing failed' });
	}
};

/**
 * Capture PayPal order after approval
 * POST /paypal/capture/:orderId
 */
const captureOrder = async (req, res) => {
	try {
		const { orderId } = req.params;

		// Get order details first to check if it needs capture or authorization handling
		const accessToken = await getPayPalAccessToken();
		const orderResponse = await fetch(
			`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);

		if (!orderResponse.ok) {
			const errorData = await orderResponse.json().catch(() => null);
			console.error('Failed to get PayPal order details:', errorData);
			throw new Error('Failed to get order details');
		}

		const orderDetails = await orderResponse.json();

		// Check if order is approved before attempting capture
		if (orderDetails.status !== 'APPROVED') {
			
			// Return appropriate error based on status
			let errorMessage = 'Order not approved for payment';
			let errorCode = 'ORDER_NOT_APPROVED';
			
			if (orderDetails.status === 'CREATED') {
				errorMessage = 'Payment was not completed. Please complete the payment process on PayPal.';
			} else if (orderDetails.status === 'CANCELLED') {
				errorMessage = 'Payment was cancelled. No charges were made.';
				errorCode = 'ORDER_CANCELLED';
			} else if (orderDetails.status === 'EXPIRED') {
				errorMessage = 'Payment session expired. Please start the payment process again.';
				errorCode = 'ORDER_EXPIRED';
			}
			
			return res.status(422).json({
				error: errorMessage,
				code: errorCode,
				status: orderDetails.status
			});
		}

		// Handle based on order intent
		let response;
		if (orderDetails.intent === 'AUTHORIZE') {
			// For AUTHORIZE intent (subscriptions), use authorize endpoint
			response = await fetch(
				`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/authorize`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${accessToken}`,
					},
				}
			);
		} else {
			// For CAPTURE intent, use capture endpoint
			response = await fetch(
				`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${accessToken}`,
					},
				}
			);
		}

		if (!response.ok) {
			throw new Error(`Failed to capture PayPal order: ${response.status}`);
		}

		const result = await response.json();

		// Handle the completed order (either captured or authorized)
		await handlePayPalEvent(
			{
				event_type: 'CHECKOUT.ORDER.COMPLETED',
				resource: result,
			},
			req.app.locals.pool
		);

		// Return appropriate response based on intent
		if (orderDetails.intent === 'AUTHORIZE') {
			res.json({
				success: true,
				authorizationId: result.purchase_units[0]?.payments?.authorizations[0]?.id,
				status: result.status,
				intent: 'AUTHORIZE'
			});
		} else {
			res.json({
				success: true,
				captureId: result.purchase_units[0]?.payments?.captures[0]?.id,
				status: result.status,
				intent: 'CAPTURE'
			});
		}
	} catch (error) {
		console.error('PayPal Capture error:', error);
		
		// Parse PayPal-specific error messages for better user experience
		let userMessage = 'Failed to process payment';
		let errorCode = 'CAPTURE_FAILED';
		
		if (error.message && error.message.includes('PAYER_CANNOT_PAY')) {
			userMessage = 'Payment method declined. Please try a different payment method or check your PayPal account.';
			errorCode = 'PAYER_CANNOT_PAY';
		} else if (error.message && error.message.includes('INSUFFICIENT_FUNDS')) {
			userMessage = 'Insufficient funds in PayPal account. Please add funds or use a different payment method.';
			errorCode = 'INSUFFICIENT_FUNDS';
		} else if (error.message && error.message.includes('UNPROCESSABLE_ENTITY')) {
			userMessage = 'Payment could not be processed. Please try again or use a different payment method.';
			errorCode = 'UNPROCESSABLE_ENTITY';
		} else if (error.message && error.message.includes('422')) {
			userMessage = 'Payment validation failed. Please check your payment details and try again.';
			errorCode = 'VALIDATION_FAILED';
		}
		
		res.status(422).json({ 
			error: userMessage,
			code: errorCode,
			details: error.message
		});
	}
};

/**
 * Get user's subscription status
 * GET /paypal/subscription/:userId
 */
const getSubscription = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const customerStore = new PayPalCustomerStore(req.app.locals.pool);
		const subscriptionStore = new PayPalSubscriptionStore(req.app.locals.pool);

		// Find customer
		const paypalCustomer = await customerStore.findByUserId(userId);
		if (!paypalCustomer) {
			return res.status(404).json({ error: 'No subscription found' });
		}

		// Find subscription
		const subscription = await subscriptionStore.findByPayerId(
			paypalCustomer.payer_id
		);
		if (!subscription) {
			return res.status(404).json({ error: 'No subscription found' });
		}

		res.json(subscription);
	} catch (error) {
		console.error('Get PayPal subscription error:', error);
		res.status(500).json({ error: 'Failed to get subscription' });
	}
};

/**
 * Get user's order history
 * GET /paypal/orders/:userId
 */
const getOrders = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const customerStore = new PayPalCustomerStore(req.app.locals.pool);
		const orderStore = new PayPalOrderStore(req.app.locals.pool);

		// Find customer
		const paypalCustomer = await customerStore.findByUserId(userId);
		if (!paypalCustomer) {
			return res.json([]);
		}

		// Find orders
		const orders = await orderStore.findByPayerId(paypalCustomer.payer_id);
		res.json(orders);
	} catch (error) {
		console.error('Get PayPal orders error:', error);
		res.status(500).json({ error: 'Failed to get orders' });
	}
};

/**
 * Verify payment success and complete enrollment
 * POST /paypal/verify-payment
 */
const verifyPayment = async (req, res) => {
	try {
		const { order_id, resource_id } = req.body;
		const userId = req.user.id;

		if (!order_id) {
			return res.status(400).json({ error: 'Order ID required' });
		}

		// Get order details from PayPal
		const accessToken = await getPayPalAccessToken();
		const response = await fetch(
			`${PAYPAL_BASE_URL}/v2/checkout/orders/${order_id}`,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);

		if (!response.ok) {
			return res.status(400).json({ error: 'Order not found' });
		}

		const order = await response.json();
		const customId = order.purchase_units[0]?.custom_id;
		if (!customId) {
			return res.status(400).json({ error: 'Order metadata not found' });
		}

		const metadata = JSON.parse(customId);

		// Extract user_id from both old and new formats
		const orderUserId = metadata.user_id || metadata.u;
		if (order.status === 'COMPLETED' && orderUserId == userId) {
			// Payment was successful, complete the order
			const orderStore = new OrderStore(req.app.locals.pool);

			try {
				const completedOrder = await orderStore.completeFromPayPal(
					order_id,
					order.purchase_units[0]?.payments?.captures[0]?.id
				);

				return res.json({
					success: true,
					order_id: completedOrder.id,
					enrolled: true,
					resource_access: resource_id ? true : false,
				});
			} catch (error) {
				// Order might already be completed
				return res.json({
					success: true,
					message: 'Payment already processed',
					enrolled: true,
					resource_access: resource_id ? true : false,
				});
			}
		} else {
			return res
				.status(400)
				.json({ error: 'Payment not completed or user mismatch' });
		}
	} catch (error) {
		console.error('PayPal Payment verification error:', error);
		res.status(500).json({ error: 'Failed to verify payment' });
	}
};

/**
 * Manual subscription activation (for testing when webhooks don't work)
 * POST /paypal/manual-subscription-activate
 */
const manualSubscriptionActivate = async (req, res) => {
	try {
		const { subscription_id, user_id, full_name, email, course_id } = req.body;
		
		if (!subscription_id || !user_id || !full_name || !email) {
			return res.status(400).json({ error: 'Missing required fields: subscription_id, user_id, full_name, email' });
		}
		
		// Create the resource object that would come from PayPal webhook
		const resource = {
			id: subscription_id,
			custom_id: JSON.stringify({
				type: 'intensive_mentorship_subscription',
				user_id: user_id,
				course_id: course_id || null,
				full_name: full_name,
				email: email
			})
		};
		
		
		// Call the same handler as the webhook would
		await handleSubscriptionActivated(resource, req.app.locals.pool);
		
		res.json({ 
			success: true, 
			message: 'Subscription activated manually',
			subscription_id: subscription_id
		});
	} catch (error) {
		console.error('Manual subscription activation failed:', error);
		res.status(500).json({ error: 'Failed to activate subscription', details: error.message });
	}
};

/**
 * Handle PayPal Subscription Events
 */
async function handleSubscriptionActivated(resource, pool) {
	const client = await pool.connect();
	try {
		// Start transaction
		await client.query('BEGIN');
		
		const subscriptionId = resource.id;
		const customId = resource.custom_id;
		
		
		if (!customId) {
			console.error('No custom_id found in subscription activation');
			await client.query('ROLLBACK');
			return;
		}

		const metadata = JSON.parse(customId);
		
		// Create subscription record FIRST for intensive mentorship (handle both old and new formats)
		if (metadata.type === 'intensive_mentorship_subscription' || metadata.t === 'ims') {
			// Extract user_id and course_id from both old and new formats
			const userId = metadata.user_id || metadata.u;
			const courseId = metadata.course_id || metadata.c;

			// Check for existing active intensive mentorship subscriptions for this user
			// Also check that we don't have any existing booking or PayPal subscription records
			const existingSubscriptionCheck = await client.query(
				`SELECT s.id, s.paypal_subscription_id, s.paypal_order_id
				FROM subscriptions s 
				WHERE s.user_id = $1 
				AND s.subscription_type = 'intensive_mentorship' 
				AND s.status = 'active'
				AND s.paypal_subscription_id != $2`,
				[parseInt(userId), subscriptionId]
			);
			
			// Additional check for PayPal subscription records in paypal_subscriptions table
			// This ensures we don't have duplicate PayPal subscription records
			const existingPayPalSubCheck = await client.query(
				`SELECT id FROM paypal_subscriptions 
				WHERE subscription_id = $1 AND subscription_status = 'ACTIVE'`,
				[subscriptionId]
			);
			
			if (existingPayPalSubCheck.rows.length > 0) {
				await client.query('ROLLBACK');
				return;
			}
			
			// Only block if there's an active subscription AND it still has related PayPal records
			// This allows reactivation after proper admin deletion
			if (existingSubscriptionCheck.rows.length > 0) {
				const existingSub = existingSubscriptionCheck.rows[0];
				
				// Check if the existing subscription has valid PayPal records
				const hasValidPayPalRecords = await client.query(
					`SELECT 1 FROM paypal_subscriptions ps 
					WHERE ps.subscription_id = $1 
					OR EXISTS (
						SELECT 1 FROM paypal_orders po 
						WHERE po.paypal_order_id = $2 AND po.payment_status = 'COMPLETED'
					)`,
					[existingSub.paypal_subscription_id, existingSub.paypal_order_id]
				);
				
				// Only block if there are still valid PayPal records (incomplete deletion)
				if (hasValidPayPalRecords.rows.length > 0) {
					await client.query('ROLLBACK');
					return;
				} else {
					// Clean up orphaned subscription record if no PayPal records exist
					await client.query(
						'DELETE FROM subscriptions WHERE id = $1',
						[existingSub.id]
					);
				}
			}

			// Create subscription record first
			const subscriptionSql = `
				INSERT INTO subscriptions (
					user_id, paypal_subscription_id, subscription_type, resource_id, 
					status, current_period_start, current_period_end, cancel_at_period_end,
					price_cents, metadata
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				ON CONFLICT (paypal_subscription_id) 
				DO UPDATE SET 
					status = EXCLUDED.status,
					current_period_start = EXCLUDED.current_period_start,
					current_period_end = EXCLUDED.current_period_end,
					updated_at = CURRENT_TIMESTAMP
				RETURNING id
			`;

			const startDate = resource.start_time ? new Date(resource.start_time) : new Date();
			const endDate = resource.billing_info?.next_billing_time 
				? new Date(resource.billing_info.next_billing_time)
				: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
			const priceCents = Math.round((parseFloat(resource.billing_info?.cycle_executions?.[0]?.pricing_scheme?.fixed_price?.value || '100.00')) * 100);

			const subscriptionResult = await client.query(subscriptionSql, [
				parseInt(userId),
				subscriptionId,
				'intensive_mentorship',
				courseId && courseId !== '0' ? parseInt(courseId) : null,
				'active',
				startDate,
				endDate,
				false,
				priceCents,
				JSON.stringify({
					description: 'Intensive Mentorship Monthly Subscription',
					features: [
						'Weekly 20-min calls',
						'3 questions per week', 
						'Advanced training',
						'Dedicated instructor relationship'
					]
				})
			]);


			// Only create booking and order AFTER subscription is successful
			// Create a pool-like object that uses our transaction client
			const transactionClient = {
				query: (sql, params) => client.query(sql, params),
				release: () => {} // Do nothing - don't release during transaction
			};
			const transactionPool = {
				connect: () => Promise.resolve(transactionClient),
				query: (sql, params) => client.query(sql, params)
			};
			
			const { BookingsStore } = require('../models/booking');
			const bookingsStore = new BookingsStore(transactionPool);
			const { OrderStore } = require('../models/order');
			const orderStore = new OrderStore(transactionPool);

			// Create internal order for the subscription (only if it doesn't exist)
			try {
				// Check if order already exists to prevent duplicates
				const existingOrder = await orderStore.getByPayPalOrder(subscriptionId);
				if (!existingOrder) {
					await orderStore.createConsultationOrder({
						user_id: parseInt(userId),
						course_id: courseId && courseId !== '0' ? parseInt(courseId) : null,
						add_on_price: 100.00, // Subscription price
						item_name: 'Intensive Mentorship Subscription',
						order_status: 'completed', // Mark as completed since subscription is activated
						payment_method: 'paypal',
						paypal_order_id: subscriptionId,
						notes: JSON.stringify({
							subscription_type: 'intensive_mentorship',
							subscription_id: subscriptionId,
							subscription_record_id: subscriptionResult.rows[0].id,
							activated_at: new Date().toISOString()
						}),
					});
				}
				
				// Create the booking
				const bookingData = {
					appointment_type: 'intensive_mentorship',
					full_name: metadata.full_name || 'Subscription User',
					email: metadata.email || 'unknown@email.com',
					phone_number: metadata.phone_number || null,
					start_time: metadata.start_time || new Date().toISOString(),
					end_time: metadata.end_time || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
					notes: metadata.notes || 'Intensive mentorship subscription',
					user_id: parseInt(userId),
					status: 'confirmed'
				};
				
				// Check for duplicates
				const existingBookings = await bookingsStore.getBookingsByEmail(bookingData.email);
				const duplicateBooking = existingBookings.find(booking => 
					booking.appointment_type === 'intensive_mentorship' &&
					booking.user_id === bookingData.user_id &&
					booking.status !== 'cancelled'
				);
				
				if (!duplicateBooking) {
					await bookingsStore.createBooking(bookingData);
				}
			} catch (error) {
				console.error('Failed to create booking after subscription activation:', error);
			}
		}

		// Commit transaction
		await client.query('COMMIT');

	} catch (error) {
		console.error('Error handling subscription activation:', error);
		if (client) {
			await client.query('ROLLBACK');
		}
		throw error;
	} finally {
		if (client) {
			client.release();
		}
	}
}

async function handleSubscriptionCancelled(resource, pool) {
	try {
		const subscriptionId = resource.id;
		
		// Update subscription status
		const updateSql = `
			UPDATE subscriptions 
			SET status = 'cancelled', cancel_at_period_end = true, updated_at = CURRENT_TIMESTAMP
			WHERE paypal_subscription_id = $1
		`;
		await pool.query(updateSql, [subscriptionId]);
		
	} catch (error) {
		console.error('Error handling subscription cancellation:', error);
	}
}

async function handleSubscriptionPaymentCompleted(resource, pool) {
	try {
		const subscriptionId = resource.billing_agreement_id;
		
		// Update next billing date
		const updateSql = `
			UPDATE subscriptions 
			SET 
				current_period_start = current_period_end,
				current_period_end = current_period_end + INTERVAL '1 month',
				updated_at = CURRENT_TIMESTAMP
			WHERE paypal_subscription_id = $1
		`;
		await pool.query(updateSql, [subscriptionId]);
		
	} catch (error) {
		console.error('Error handling subscription payment completion:', error);
	}
}

async function handleSubscriptionPaymentFailed(resource, pool) {
	try {
		const subscriptionId = resource.billing_agreement_id;
		
		if (!subscriptionId) {
			console.error('No subscription ID found in payment failure event');
			return;
		}
		
		// Update subscription status to past_due
		const updateSql = `
			UPDATE subscriptions 
			SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
			WHERE paypal_subscription_id = $1
			RETURNING user_id, subscription_type
		`;
		
		const result = await pool.query(updateSql, [subscriptionId]);
		
		if (result.rows.length > 0) {
			const { user_id, subscription_type } = result.rows[0];
			
			// For intensive mentorship, pause access but don't cancel bookings yet
			// Give user a grace period to update payment method
			if (subscription_type === 'intensive_mentorship') {
				// Could implement notification logic here
				// For now, just mark as past_due to give user grace period
			}
		}
		
	} catch (error) {
		console.error('Error handling subscription payment failure:', error.message);
	}
}

/**
 * Handle PayPal webhook events
 */
async function handlePayPalEvent(event, pool) {
	const eventType = event.event_type || event.type;
	const resource = event.resource;

	if (!resource) {
		return;
	}

	// Handle subscription events
	if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
		await handleSubscriptionActivated(resource, pool);
		return;
	}

	if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
		await handleSubscriptionCancelled(resource, pool);
		return;
	}

	if (eventType === 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED') {
		await handleSubscriptionPaymentCompleted(resource, pool);
		return;
	}

	if (eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
		await handleSubscriptionPaymentFailed(resource, pool);
		return;
	}

	if (
		eventType === 'CHECKOUT.ORDER.COMPLETED' ||
		eventType === 'PAYMENT.CAPTURE.COMPLETED'
	) {
		// Handle completed payments
		const orderId = resource.id;
		const payerId = resource.payer?.payer_id;
		const captureId =
			resource.purchase_units?.[0]?.payments?.captures?.[0]?.id || 
			resource.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ||
			resource.id;
		
		// Extract amount from multiple possible locations
		let amountValue = 0;
		
		if (resource.purchase_units?.[0]?.amount?.value) {
			amountValue = parseFloat(resource.purchase_units[0].amount.value);
		} else if (resource.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value) {
			amountValue = parseFloat(resource.purchase_units[0].payments.captures[0].amount.value);
		} else if (resource.amount?.value) {
			amountValue = parseFloat(resource.amount.value);
		}
		
		const amountCurrency =
			resource.purchase_units?.[0]?.amount?.currency_code ||
			resource.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code ||
			resource.amount?.currency_code ||
			'USD';
		const customId =
			resource.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ||
			resource.purchase_units?.[0]?.payments?.authorizations?.[0]?.custom_id ||
			resource.purchase_units?.[0]?.custom_id ||
			resource.custom_id;


		if (!customId) {
			console.error('No custom_id found in PayPal event');
			return;
		}

		let metadata;
		try {
			metadata = JSON.parse(customId);
		} catch (error) {
			console.error('Failed to parse PayPal custom_id:', error);
			return;
		}

		// Save to PayPal orders table
		const paypalOrderStore = new PayPalOrderStore(pool);
		try {
			await paypalOrderStore.create({
				paypalOrderId: orderId,
				payerId: payerId,
				amountValue: amountValue,
				amountCurrency: amountCurrency,
				paymentStatus: 'COMPLETED',
				captureId: captureId,
				status: 'completed',
			});
		} catch (error) {
			// Order might already exist, try to update it
			try {
				await paypalOrderStore.updatePaymentStatus(orderId, {
					captureId: captureId,
					paymentStatus: 'COMPLETED',
					status: 'completed',
					amountValue: amountValue,
					amountCurrency: amountCurrency,
				});
			} catch (updateError) {
				console.error('Failed to create or update PayPal order:', updateError);
			}
		}

		// Create customer record if needed
		if (payerId && metadata.uid) {
			const customerStore = new PayPalCustomerStore(pool);
			try {
				let customer = await customerStore.findByUserId(
					parseInt(metadata.uid)
				);
				if (!customer) {
					await customerStore.create({
						userId: parseInt(metadata.uid),
						payerId: payerId,
						email: resource.payer?.email_address || '',
					});
				}
			} catch (customerError) {
				console.error(
					'Failed to create PayPal customer record:',
					customerError
				);
			}
		}

		// Handle Q&A consultation
		if (metadata.type === 'qa') {
			const { OrderStore } = require('../models/order');
			const { BookingsStore } = require('../models/booking');
			const orderStore = new OrderStore(pool);
			const bookingsStore = new BookingsStore(pool);

			try {
				// Complete the existing internal order
				const completedOrder = await orderStore.completeFromPayPal(orderId, captureId);

				// Create booking after successful payment - retrieve data from internal order
				if (completedOrder) {
					// Get the internal order to retrieve booking data
					const internalOrder = await orderStore.getByPayPalOrder(orderId);
					
					if (internalOrder && internalOrder.notes) {
						// Parse the booking data from order notes
						let bookingData;
						try {
							bookingData = JSON.parse(internalOrder.notes);
						} catch (parseError) {
							console.error('Failed to parse booking data from order notes:', parseError);
							throw new Error(`Invalid booking data in order notes: ${parseError.message}`);
						}
						
						// Check for duplicate bookings
						const existingBookings = await bookingsStore.getBookingsByEmail(bookingData.email);
						const duplicateBooking = existingBookings.find(booking => 
							booking.appointment_type === metadata.apt &&
							booking.user_id === bookingData.user_id &&
							booking.status !== 'cancelled' &&
							// For same appointment type and time, check duplicates
							(booking.start_time === bookingData.start_time && booking.end_time === bookingData.end_time)
						);
						
						if (!duplicateBooking) {
							// Set proper status based on appointment type
							bookingData.status = metadata.apt === 'live_consultation' ? 'scheduled' : 'confirmed';
							
							// Create the booking
							const createdBooking = await bookingsStore.createBooking(bookingData);
							
							// Trigger AI response for written guidance
							if (metadata.apt === 'written_guidance' && createdBooking) {
								setTimeout(() => {
									handleWrittenGuidanceResponse(
										parseInt(metadata.uid),
										createdBooking.notes,
										metadata.cid,
										orderId
									).catch((error) => {
										console.error('Background AI response failed:', error);
									});
								}, 100);
							}
						}
					} else {
						console.error('No booking data found in internal order notes');
					}
				}
			} catch (error) {
				console.error('Failed to complete Q&A consultation order:', error);
			}
		} else if (metadata.is_shop_purchase === 'true') {
			// Shop purchase - order record already exists in paypal_orders
		} else {
			// Complete the main order (course/resource enrollment)
			const { OrderStore } = require('../models/order');
			const orderStore = new OrderStore(pool);

			try {
				await orderStore.completeFromPayPal(orderId, captureId);
			} catch (error) {
				console.error('Failed to complete main order from PayPal:', error.message);
			}
		}

		// Handle subscription creation for AI Sifu only (intensive mentorship now uses proper PayPal subscriptions)
		if (metadata.is_ai_sifu_subscription === 'true') {
			try {
				const subscriptionMetadata = {
					description: 'AI Sifu Monthly Subscription',
					features: [
						'12 questions per month',
						'Personal AI martial arts guide',
					],
				};

				// Create subscription record in general subscriptions table
				const subscriptionSql = `
					INSERT INTO subscriptions (
						user_id, paypal_order_id, subscription_type, resource_id, 
						status, current_period_start, current_period_end, cancel_at_period_end,
						price_cents, metadata
					)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
					ON CONFLICT (paypal_order_id) 
					DO UPDATE SET 
						status = EXCLUDED.status,
						current_period_start = EXCLUDED.current_period_start,
						current_period_end = EXCLUDED.current_period_end,
						updated_at = CURRENT_TIMESTAMP
				`;

				const startDate = new Date();
				const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
				const priceCents = Math.round(amountValue * 100);

				await pool.query(subscriptionSql, [
					parseInt(metadata.uid),
					orderId,
					'ai_sifu',
					metadata.cid ? parseInt(metadata.cid) : null,
					'active',
					startDate,
					endDate,
					false,
					priceCents,
					JSON.stringify(subscriptionMetadata),
				]);
			} catch (error) {
				console.error('Error creating PayPal AI Sifu subscription:', error);
			}
		}
	}
}

/**
 * PayPal route handler - manages all PayPal-related endpoints
 */
const paypal_route = (app) => {
	// Public webhook endpoint
	app.post('/paypal/webhook', webhook);

	// Public routes
	app.post('/paypal/create-qa-checkout', createQACheckout); // Q&A checkout can be used by guests
	app.post('/paypal/create-subscription', createSubscription); // Intensive mentorship subscription creation
	app.post('/paypal/setup-subscription-plan', setupSubscriptionPlan); // Setup subscription plan (run once)
	app.post('/paypal/create-shop-checkout', createShopCheckout); // Shop checkout for public purchases
	app.post('/paypal/manual-subscription-activate', manualSubscriptionActivate); // Manual subscription activation for testing
	app.get('/paypal/shop-download/:orderId', shopDownload); // Public download after shop purchase
	app.get('/paypal/shop-info/:orderId', shopInfo); // Get resource info without download
	app.post('/paypal/capture/:orderId', captureOrder); // Capture order after approval

	// Protected routes
	app.post('/paypal/create-checkout', authenticationToken, createCheckout);
	app.post('/paypal/verify-payment', authenticationToken, verifyPayment);
	app.get('/paypal/subscription/:userId', authenticateUserId, getSubscription);
	app.get('/paypal/orders/:userId', authenticateUserId, getOrders);
};

module.exports = paypal_route;
