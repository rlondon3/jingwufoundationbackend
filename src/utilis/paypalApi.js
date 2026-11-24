// utilis/paypalApi.js
require('dotenv').config();

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

// Full order details (status, payer, custom_id) for a PayPal order id
async function getPayPalOrder(orderId) {
	const accessToken = await getPayPalAccessToken();
	const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!response.ok) return null;
	return response.json();
}

module.exports = { PAYPAL_BASE_URL, getPayPalAccessToken, getPayPalOrder };
