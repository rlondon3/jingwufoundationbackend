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
		console.error('❌ Failed to get PayPal access token:', data);
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
						appointment_type,
						full_name,
						email,
						phone_number: phone_number || '',
						start_time,
						end_time,
						notes: notes || '',
						user_id: user_id?.toString() || '',
						course_id: course_id?.toString() || '',
						is_qa_booking: 'true',
						is_subscription: is_subscription ? 'true' : 'false',
					}),
				},
			],
			application_context: {
				return_url: `${
					process.env.FRONTEND_URL
				}/payment/success?qa_consultation=${appointment_type}&paypal=true${
					course_id ? `&course_id=${course_id}` : ''
				}`,
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
			throw new Error('Failed to create PayPal order');
		}

		const order = await response.json();

		// Create consultation order for tracking
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
					order_status: 'pending',
					payment_method: 'paypal',
					paypal_order_id: order.id,
					notes: `Q&A Consultation: ${appointment_type}`,
				});
			} catch (orderError) {
				console.error('Failed to create consultation order:', orderError);
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
		console.log('🚀 PayPal checkout request received:', req.body);
		const {
			course_id,
			course_price,
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
		console.log('👤 User ID:', userId);

		if (!userId) {
			return res.status(400).json({ error: 'User ID not found in token' });
		}

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

		// Find or prepare customer
		let paypalCustomer = await customerStore.findByUserId(userId);

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
			itemPrice = course_price;
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
			// For course purchases
			returnUrl = `${process.env.FRONTEND_URL}/payment/success?paypal=true${
				course_id ? `&course_id=${course_id}` : ''
			}`;
			cancelUrl = `${process.env.FRONTEND_URL}/payment/failed?reason=cancelled&paypal=true`;
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
					console.log('🔧 Creating PayPal add-on order:', {
						user_id: userId,
						course_id: course_id,
						resource_id: resource_id,
						paypal_order_id: order.id,
					});
					internalOrder = await orderStore.createAddOnOrder({
						user_id: userId,
						course_id: course_id,
						resource_id: resource_id,
						order_status: 'pending',
						payment_method: 'paypal',
						paypal_order_id: order.id,
					});
					console.log('✅ PayPal add-on order created:', internalOrder.id);
				} catch (orderError) {
					console.error('❌ Failed to create PayPal add-on order:', orderError);
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
		console.error('❌ PayPal Checkout error:', error.message);
		console.error('❌ Full error stack:', error.stack);
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
		console.error('❌ PayPal Shop checkout error:', error);
		console.error('❌ Error stack:', error.stack);
		res.status(500).json({ error: 'Failed to create shop checkout session' });
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
		const event = req.body;

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

		// Capture the order
		const accessToken = await getPayPalAccessToken();
		const response = await fetch(
			`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);

		if (!response.ok) {
			throw new Error('Failed to capture PayPal order');
		}

		const capture = await response.json();

		// Handle the captured order
		await handlePayPalEvent(
			{
				event_type: 'CHECKOUT.ORDER.COMPLETED',
				resource: capture,
			},
			req.app.locals.pool
		);

		res.json({
			success: true,
			captureId: capture.purchase_units[0]?.payments?.captures[0]?.id,
			status: capture.status,
		});
	} catch (error) {
		console.error('PayPal Capture error:', error);
		res.status(500).json({ error: 'Failed to capture order' });
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
		const { order_id, course_id, resource_id } = req.body;
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

		if (order.status === 'COMPLETED' && metadata.user_id == userId) {
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
 * Handle PayPal webhook events
 */
async function handlePayPalEvent(event, pool) {
	const eventType = event.event_type || event.type;
	const resource = event.resource;

	if (!resource) {
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
			resource.purchase_units?.[0]?.payments?.captures?.[0]?.id || resource.id;
		const amountValue = parseFloat(
			resource.purchase_units?.[0]?.amount?.value ||
				resource.amount?.value ||
				'0'
		);
		const amountCurrency =
			resource.purchase_units?.[0]?.amount?.currency_code ||
			resource.amount?.currency_code ||
			'USD';
		const customId =
			resource.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ||
			resource.purchase_units?.[0]?.custom_id ||
			resource.custom_id;

		// console.log('🔍 PAYPAL EVENT DEBUG:', {
		// 	eventType,
		// 	orderId,
		// 	captureId,
		// 	customId,
		// 	hasCustomId: !!customId,
		// 	resource_structure: {
		// 		has_purchase_units: !!resource.purchase_units,
		// 		purchase_units_length: resource.purchase_units?.length,
		// 		has_captures: !!resource.purchase_units?.[0]?.payments?.captures,
		// 		captures_length: resource.purchase_units?.[0]?.payments?.captures?.length
		// 	}
		// });

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
				});
			} catch (updateError) {
				console.error('Failed to create or update PayPal order:', updateError);
			}
		}

		// Create customer record if needed
		if (payerId && metadata.user_id) {
			const customerStore = new PayPalCustomerStore(pool);
			try {
				let customer = await customerStore.findByUserId(
					parseInt(metadata.user_id)
				);
				if (!customer) {
					await customerStore.create({
						userId: parseInt(metadata.user_id),
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
		if (metadata.is_qa_booking === 'true') {
			const { OrderStore } = require('../models/order');
			const orderStore = new OrderStore(pool);

			try {
				const completedOrder = await orderStore.completeFromPayPal(
					orderId,
					captureId
				);

				// Trigger AI response for written guidance
				if (
					metadata.appointment_type === 'written_guidance' &&
					completedOrder
				) {
					setTimeout(() => {
						handleWrittenGuidanceResponse(
							parseInt(metadata.user_id),
							metadata.notes,
							metadata.course_id,
							orderId
						).catch((error) => {
							console.error('Background AI response failed:', error);
						});
					}, 100);
				}
			} catch (error) {
				console.error('Failed to complete consultation order from PayPal');
			}
		} else if (metadata.is_shop_purchase === 'true') {
			// Shop purchase - order record already exists in paypal_orders
			console.log(
				`Shop purchase completed for resource ${metadata.resource_id}`
			);
		} else {
			// Complete the main order (course/resource enrollment)
			const { OrderStore } = require('../models/order');
			const orderStore = new OrderStore(pool);

			try {
				await orderStore.completeFromPayPal(orderId, captureId);
			} catch (error) {
				console.error(
					'Failed to complete main order from PayPal:',
					error.message
				);
				console.error('PayPal Order ID:', orderId);
				console.error('Capture ID:', captureId);
			}
		}

		// Handle subscription creation for AI Sifu or intensive mentorship
		if (
			metadata.is_ai_sifu_subscription === 'true' ||
			metadata.appointment_type === 'intensive_mentorship'
		) {
			try {
				let subscriptionType =
					metadata.is_ai_sifu_subscription === 'true'
						? 'ai_sifu'
						: 'intensive_mentorship';
				let subscriptionMetadata = {};

				if (subscriptionType === 'ai_sifu') {
					subscriptionMetadata = {
						description: 'AI Sifu Monthly Subscription',
						features: [
							'12 questions per month',
							'Personal AI martial arts guide',
						],
					};
				} else {
					subscriptionMetadata = {
						description: 'Intensive Mentorship Monthly Subscription',
						features: [
							'Weekly 20-min calls',
							'3 questions per week',
							'Advanced training',
							'Dedicated instructor relationship',
						],
					};
				}

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
					parseInt(metadata.user_id),
					orderId,
					subscriptionType,
					metadata.course_id ? parseInt(metadata.course_id) : null,
					'active',
					startDate,
					endDate,
					false,
					priceCents,
					JSON.stringify(subscriptionMetadata),
				]);
			} catch (error) {
				console.error('Error creating PayPal subscription:', error);
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
	app.post('/paypal/create-shop-checkout', createShopCheckout); // Shop checkout for public purchases
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
