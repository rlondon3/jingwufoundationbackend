// handlers/shopPurchases.js
require('dotenv').config();
const Joi = require('joi');
const { ShopPurchaseStore } = require('../models/shopPurchase');
const { ResourceStore } = require('../models/resource');
const { authenticationToken, requireAdmin } = require('../middleware/auth');
const { sendMail } = require('../utilis/mailer');
const { generateResourcePdf, pdfFileName } = require('../utilis/resourcePdf');
const { escapeHtml, COLORS, FONT, SANS, LOGO_URL } = require('../utilis/newsletterTemplate');

/**
 * Shop purchase delivery - email the buyer a PDF copy of what they bought
 */

// SES caps a message at 40MB after base64 encoding
const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;

const emailSchema = Joi.string().trim().lowercase().email().max(255);

const renderPurchaseEmail = (resource) => {
	const title = escapeHtml(resource.title);
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your copy of ${title}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${COLORS.card};border-radius:10px;overflow:hidden;">
    <tr><td align="center" style="background:${COLORS.header};padding:22px 24px;">
      <img src="${LOGO_URL}" width="56" height="56" alt="Jing Wu Foundation" style="display:block;border:0;margin:0 auto 8px;">
      <div style="font-family:${FONT};font-size:20px;letter-spacing:.04em;color:#ffffff;">Jing Wu Foundation</div>
    </td></tr>
    <tr><td style="padding:36px 40px;">
      <h1 style="margin:0 0 18px;font-family:${FONT};font-size:26px;line-height:1.3;font-weight:normal;color:${COLORS.heading};">Thank you for your purchase</h1>
      <p style="margin:0 0 18px;font-family:${FONT};font-size:17px;line-height:1.65;color:${COLORS.text};">Your copy of <strong>${title}</strong> is attached to this email as a PDF.</p>
      <p style="margin:0;font-family:${FONT};font-size:17px;line-height:1.65;color:${COLORS.text};">If you have any trouble opening it, just reply to this email and we'll help.</p>
    </td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding:22px 24px;font-family:${SANS};font-size:12px;color:${COLORS.muted};">
      <a href="https://jingwupai.org" style="color:${COLORS.muted};text-decoration:underline;">jingwupai.org</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

	const text = [
		'Thank you for your purchase',
		'',
		`Your copy of ${resource.title} is attached to this email as a PDF.`,
		'',
		"If you have any trouble opening it, just reply to this email and we'll help.",
		'',
		'Jing Wu Foundation — https://jingwupai.org',
	].join('\n');

	return { subject: `Your copy of ${resource.title}`, html, text };
};

/**
 * Render a resource as a PDF and email it to one address
 */
const emailResourceCopy = async (pool, resourceId, to) => {
	const resource = await new ResourceStore(pool).show(resourceId);
	if (!resource) throw new Error(`Resource ${resourceId} not found`);

	const pdf = await generateResourcePdf(resource);
	if (pdf.length > MAX_ATTACHMENT_BYTES) {
		throw new Error(`PDF is ${(pdf.length / 1024 / 1024).toFixed(1)}MB, too large to email`);
	}

	const { subject, html, text } = renderPurchaseEmail(resource);
	await sendMail({
		to,
		subject,
		html,
		text,
		attachments: [
			{ filename: pdfFileName(resource), content: pdf, contentType: 'application/pdf' },
		],
	});
};

/**
 * Email an order's copy, recording success or the error on the order row
 * so the admin dashboard shows what happened.
 */
const emailPurchase = async (pool, provider, order, to) => {
	const store = new ShopPurchaseStore(pool);
	try {
		await emailResourceCopy(pool, order.resource_id, to);
		await store.recordEmailSent(provider, order.id, to);
		console.log(`Shop copy of resource ${order.resource_id} emailed (${provider} order ${order.id})`);
	} catch (error) {
		console.error(`Shop email failed (${provider} order ${order.id}):`, error.message);
		await store.recordEmailFailed(provider, order.id, error.message);
		throw error;
	}
};

/**
 * Called when a shop payment completes. Emails the copy in the background
 * so the webhook / capture response isn't held up by PDF rendering.
 */
const deliverShopPurchase = async (pool, provider, orderRef) => {
	const order = await new ShopPurchaseStore(pool).claimAutoEmail(provider, orderRef);
	if (!order) return;
	emailPurchase(pool, provider, order, order.buyer_email).catch(() => {});
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * GET /admin/shop-purchases
 */
const index = async (req, res) => {
	try {
		const purchases = await new ShopPurchaseStore(req.app.locals.pool).list();
		res.json(purchases);
	} catch (error) {
		console.error('Error listing shop purchases:', error);
		res.status(500).json({ error: 'Failed to load shop purchases' });
	}
};

/**
 * Resend the PDF, optionally to a corrected address
 * POST /admin/shop-purchases/:provider/:id/send  { email? }
 */
const resend = async (req, res) => {
	const { provider } = req.params;
	if (!['stripe', 'paypal'].includes(provider)) {
		return res.status(400).json({ error: 'Unknown provider' });
	}
	try {
		const pool = req.app.locals.pool;
		const order = await new ShopPurchaseStore(pool).findById(provider, parseInt(req.params.id));
		if (!order || !order.resource_id) {
			return res.status(404).json({ error: 'Shop purchase not found' });
		}

		const { value: to, error } = emailSchema
			.required()
			.validate(req.body?.email || order.buyer_email);
		if (error) {
			return res.status(400).json({ error: 'Enter a valid email address' });
		}

		await emailPurchase(pool, provider, order, to);
		res.json({ success: true, email: to });
	} catch (error) {
		res.status(500).json({ error: `Email failed: ${error.message}` });
	}
};

/**
 * Send any resource's PDF to any address, without an order
 * POST /admin/shop-purchases/send  { resource_id, email }
 */
const sendCopy = async (req, res) => {
	const { value, error } = Joi.object({
		resource_id: Joi.number().integer().positive().required(),
		email: emailSchema.required(),
	}).validate(req.body || {});
	if (error) {
		return res.status(400).json({ error: 'Choose a resource and enter a valid email address' });
	}
	try {
		await emailResourceCopy(req.app.locals.pool, value.resource_id, value.email);
		console.log(`Admin emailed resource ${value.resource_id} copy`);
		res.json({ success: true, email: value.email });
	} catch (error) {
		console.error('Admin resource email failed:', error.message);
		res.status(500).json({ error: `Email failed: ${error.message}` });
	}
};

const shop_purchases_route = (app) => {
	app.get('/admin/shop-purchases', authenticationToken, requireAdmin, index);
	app.post('/admin/shop-purchases/send', authenticationToken, requireAdmin, sendCopy);
	app.post('/admin/shop-purchases/:provider/:id/send', authenticationToken, requireAdmin, resend);
};

module.exports = shop_purchases_route;
module.exports.deliverShopPurchase = deliverShopPurchase;
module.exports.emailSchema = emailSchema;
