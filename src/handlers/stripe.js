import express from 'express';
import Stripe from 'stripe';
import { authenticateToken } from '../middleware/auth.js';
import { StripeCustomer } from '../models/StripeCustomer.js';
import { StripeSubscription } from '../models/StripeSubscription.js';
import { StripeOrder } from '../models/StripeOrder.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create checkout session
router.post('/create-checkout', authenticateToken, async (req, res) => {
	try {
		const { price_id, success_url, cancel_url, mode } = req.body;
		const userId = req.user.userId;

		if (!price_id || !success_url || !cancel_url || !mode) {
			return res.status(400).json({ error: 'Missing required parameters' });
		}

		if (!['payment', 'subscription'].includes(mode)) {
			return res.status(400).json({ error: 'Invalid mode' });
		}

		// Find or create Stripe customer
		let stripeCustomer = await StripeCustomer.findByUserId(userId);
		let customerId;

		if (!stripeCustomer) {
			// Create new Stripe customer
			const customer = await stripe.customers.create({
				email: req.user.email,
				metadata: { userId: userId.toString() },
			});

			// Save to database
			stripeCustomer = await StripeCustomer.create({
				userId,
				customerId: customer.id,
			});

			customerId = customer.id;
		} else {
			customerId = stripeCustomer.customer_id;
		}

		// Create checkout session
		const session = await stripe.checkout.sessions.create({
			customer: customerId,
			payment_method_types: ['card'],
			line_items: [
				{
					price: price_id,
					quantity: 1,
				},
			],
			mode,
			success_url,
			cancel_url,
		});

		res.json({ sessionId: session.id, url: session.url });
	} catch (error) {
		console.error('Checkout error:', error);
		res.status(500).json({ error: error.message });
	}
});

// Stripe webhook
router.post(
	'/webhook',
	express.raw({ type: 'application/json' }),
	async (req, res) => {
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
			await handleStripeEvent(event);

			res.json({ received: true });
		} catch (error) {
			console.error('Webhook error:', error);
			res.status(500).json({ error: error.message });
		}
	}
);

async function handleStripeEvent(event) {
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
			// Handle one-time payment
			const {
				id: checkout_session_id,
				payment_intent,
				amount_subtotal,
				amount_total,
				currency,
			} = stripeData;

			await StripeOrder.create({
				checkoutSessionId: checkout_session_id,
				paymentIntentId: payment_intent,
				customerId,
				amountSubtotal: amount_subtotal,
				amountTotal: amount_total,
				currency,
				paymentStatus: payment_status,
				status: 'completed',
			});

			console.log(
				`Successfully processed one-time payment for session: ${checkout_session_id}`
			);
		}
	}

	if (isSubscription) {
		console.log(`Starting subscription sync for customer: ${customerId}`);
		await syncCustomerFromStripe(customerId);
	}
}

async function syncCustomerFromStripe(customerId) {
	try {
		// Fetch latest subscription data from Stripe
		const subscriptions = await stripe.subscriptions.list({
			customer: customerId,
			limit: 1,
			status: 'all',
			expand: ['data.default_payment_method'],
		});

		if (subscriptions.data.length === 0) {
			console.log(`No subscriptions found for customer: ${customerId}`);
			await StripeSubscription.upsert({
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
		await StripeSubscription.upsert({
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

		console.log(`Successfully synced subscription for customer: ${customerId}`);
	} catch (error) {
		console.error(
			`Failed to sync subscription for customer ${customerId}:`,
			error
		);
		throw error;
	}
}

export default router;
