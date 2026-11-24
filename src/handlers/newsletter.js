// handlers/newsletter.js
require('dotenv').config();
const crypto = require('crypto');
const { NewsStore } = require('../models/news');
const { authenticationToken, requireAdmin } = require('../middleware/auth');
const { sendMail, isConfigured } = require('../utilis/mailer');
const { renderNewsletter, escapeHtml } = require('../utilis/newsletterTemplate');

/**
 * Newsletter Handlers - email a news article to every community member
 */

// Delay between sends so we stay under provider rate limits
const SEND_DELAY_MS = parseInt(process.env.NEWSLETTER_SEND_DELAY_MS || '400');

const frontendUrl = () => process.env.FRONTEND_URL || 'https://jingwupai.org';

// Public URL of this API, used for unsubscribe links
const apiUrl = (req) =>
	process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

const unsubscribeToken = (userId) =>
	crypto
		.createHmac('sha256', process.env.TOKEN_SECRET)
		.update(`newsletter-unsubscribe:${userId}`)
		.digest('hex');

const isValidToken = (userId, token) => {
	if (!userId || typeof token !== 'string') return false;
	const expected = Buffer.from(unsubscribeToken(userId));
	const given = Buffer.from(token);
	return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

const buildEmail = (req, article, userId) => {
	const unsubscribeUrl = userId
		? `${apiUrl(req)}/newsletter/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`
		: `${apiUrl(req)}/newsletter/unsubscribe?test=1`;
	const email = renderNewsletter(article, {
		articleUrl: `${frontendUrl()}/app/news/${article.id}`,
		unsubscribeUrl,
	});
	email.headers = userId
		? {
				'List-Unsubscribe': `<${unsubscribeUrl}>`,
				'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
		  }
		: undefined;
	return email;
};

// Leave out a thumbnail that no longer loads rather than email a broken image
const withWorkingThumbnail = async (article) => {
	if (!article?.thumbnail_url) return article;
	try {
		const res = await fetch(article.thumbnail_url, { method: 'HEAD' });
		if (res.ok) return article;
	} catch (error) {
		// fall through
	}
	console.warn(`Newsletter: dropping unreachable thumbnail ${article.thumbnail_url}`);
	return { ...article, thumbnail_url: null };
};

const getRecipients = async (pool) => {
	const res = await pool.query(
		`SELECT id, email FROM users
		 WHERE is_active = true AND newsletter_unsubscribed_at IS NULL
		 ORDER BY id`
	);
	return res.rows;
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * Rendered email HTML for previewing in the admin panel
 * GET /admin/news/:id/newsletter/preview
 */
const preview = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		const found = await store.show(parseInt(req.params.id));
		if (!found) {
			return res.status(404).json({ error: 'News article not found' });
		}
		const article = await withWorkingThumbnail(found);
		const { html } = buildEmail(req, article, req.user.id);
		return res.status(200).type('html').send(html);
	} catch (error) {
		console.error('Newsletter preview error:', error);
		return res.status(500).json({ error: 'Failed to render newsletter' });
	}
};

/**
 * How many members a newsletter would go to
 * GET /admin/newsletter/audience
 */
const audience = async (req, res) => {
	try {
		const recipients = await getRecipients(req.app.locals.pool);
		return res.status(200).json({
			count: recipients.length,
			email_configured: isConfigured(),
		});
	} catch (error) {
		console.error('Newsletter audience error:', error);
		return res.status(500).json({ error: 'Failed to count newsletter audience' });
	}
};

/**
 * Send one copy to a single address (defaults to the admin's own email)
 * POST /admin/news/:id/newsletter/test
 */
const sendTest = async (req, res) => {
	try {
		if (!isConfigured()) {
			return res.status(503).json({ error: 'Email is not configured on the server' });
		}
		const to = req.body?.email || req.user.email;
		if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
			return res.status(400).json({ error: 'A valid email address is required' });
		}

		const store = new NewsStore(req.app.locals.pool);
		const found = await store.show(parseInt(req.params.id));
		if (!found) {
			return res.status(404).json({ error: 'News article not found' });
		}
		const article = await withWorkingThumbnail(found);

		const { subject, html, text } = buildEmail(req, article, null);
		await sendMail({ to, subject: `[TEST] ${subject}`, html, text });

		return res.status(200).json({ message: `Test email sent to ${to}` });
	} catch (error) {
		console.error('Newsletter test send error:', error);
		return res.status(500).json({ error: `Failed to send test email: ${error.message}` });
	}
};

/**
 * Email the article to every subscribed member. Runs in the background;
 * an article can only ever be sent once.
 * POST /admin/news/:id/newsletter/send
 */
const sendToAll = async (req, res) => {
	const pool = req.app.locals.pool;
	const id = parseInt(req.params.id);

	try {
		if (!isConfigured()) {
			return res.status(503).json({ error: 'Email is not configured on the server' });
		}

		// Claim the send atomically so a double click can't send twice
		const claim = await pool.query(
			`UPDATE news SET newsletter_sent_at = CURRENT_TIMESTAMP
			 WHERE id = $1 AND status = 'published' AND newsletter_sent_at IS NULL
			 RETURNING id`,
			[id]
		);
		if (claim.rows.length === 0) {
			const existing = await pool.query(
				'SELECT status, newsletter_sent_at FROM news WHERE id = $1',
				[id]
			);
			if (existing.rows.length === 0) {
				return res.status(404).json({ error: 'News article not found' });
			}
			if (existing.rows[0].newsletter_sent_at) {
				return res.status(409).json({ error: 'This article was already sent as a newsletter' });
			}
			return res.status(400).json({ error: 'Only published articles can be sent' });
		}

		const store = new NewsStore(pool);
		const article = await withWorkingThumbnail(await store.show(id));
		const recipients = await getRecipients(pool);

		res.status(202).json({
			message: `Sending to ${recipients.length} members`,
			recipient_count: recipients.length,
		});

		let sent = 0;
		const failures = [];
		for (const user of recipients) {
			try {
				const { subject, html, text, headers } = buildEmail(req, article, user.id);
				await sendMail({ to: user.email, subject, html, text, headers });
				sent++;
			} catch (error) {
				failures.push(user.email);
				console.error(`Newsletter ${id} failed for ${user.email}:`, error.message);
			}
			await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
		}

		// If nothing went out (e.g. SES still in sandbox), allow a retry
		await pool.query(
			sent > 0
				? 'UPDATE news SET newsletter_recipient_count = $1 WHERE id = $2'
				: 'UPDATE news SET newsletter_sent_at = NULL, newsletter_recipient_count = $1 WHERE id = $2',
			[sent, id]
		);
		console.log(
			`Newsletter ${id} finished: ${sent} sent, ${failures.length} failed`
		);
	} catch (error) {
		console.error('Newsletter send error:', error);
		if (!res.headersSent) {
			// Release the claim so the admin can retry
			await pool
				.query('UPDATE news SET newsletter_sent_at = NULL WHERE id = $1', [id])
				.catch(() => {});
			return res.status(500).json({ error: 'Failed to send newsletter' });
		}
	}
};

// ========================
// PUBLIC HANDLERS
// ========================

const unsubscribePage = (heading, message, action = '') => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)} · Jing Wu Foundation</title></head>
<body style="margin:0;padding:48px 16px;background:#f2e9df;font-family:Georgia,serif;color:#261b10;text-align:center;">
<div style="max-width:460px;margin:0 auto;background:#fff;border-radius:10px;padding:36px 28px;">
<h1 style="font-weight:normal;font-size:26px;margin:0 0 12px;">${escapeHtml(heading)}</h1>
<p style="font-size:16px;line-height:1.6;color:#3d3229;margin:0 0 20px;">${message}</p>
${action}<a href="${frontendUrl()}" style="color:#735231;">Return to jingwupai.org</a>
</div></body></html>`;

/**
 * GET only shows a confirm button, because link scanners (e.g. Outlook
 * Safe Links) open every link in an email. POST unsubscribes; it serves
 * both that button and the one-click unsubscribe mail clients use.
 * GET|POST /newsletter/unsubscribe?u=<userId>&t=<token>
 */
const unsubscribe = async (req, res) => {
	if (req.query.test) {
		return res
			.status(200)
			.type('html')
			.send(
				unsubscribePage(
					'This was a test email',
					"In the real newsletter, this link lets each member unsubscribe. Nobody's subscription was changed."
				)
			);
	}

	const userId = parseInt(req.query.u);
	if (!isValidToken(userId, req.query.t)) {
		return res
			.status(400)
			.type('html')
			.send(
				unsubscribePage(
					'Link not valid',
					'This unsubscribe link is incomplete or has expired. Please contact admin@jingwupai.org and we will remove you.'
				)
			);
	}
	if (req.method === 'GET') {
		return res
			.status(200)
			.type('html')
			.send(
				unsubscribePage(
					'Unsubscribe from news emails?',
					"You'll stop receiving news emails from the Jing Wu Foundation. Your account and courses are unaffected.",
					`<form method="post" style="margin:0 0 20px;"><button type="submit" style="padding:12px 26px;border:0;border-radius:6px;background:#735231;color:#fff;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;cursor:pointer;">Unsubscribe</button></form>`
				)
			);
	}

	try {
		await req.app.locals.pool.query(
			`UPDATE users SET newsletter_unsubscribed_at = COALESCE(newsletter_unsubscribed_at, CURRENT_TIMESTAMP)
			 WHERE id = $1`,
			[userId]
		);
		return res
			.status(200)
			.type('html')
			.send(
				unsubscribePage(
					"You've been unsubscribed",
					'You will no longer receive news emails from the Jing Wu Foundation. Your account and courses are unaffected.'
				)
			);
	} catch (error) {
		console.error('Newsletter unsubscribe error:', error);
		return res.status(500).type('html').send(unsubscribePage('Something went wrong', 'Please try again later.'));
	}
};

const newsletter_route = (app) => {
	app.get('/newsletter/unsubscribe', unsubscribe);
	app.post('/newsletter/unsubscribe', unsubscribe);

	app.get('/admin/newsletter/audience', authenticationToken, requireAdmin, audience);
	app.get('/admin/news/:id/newsletter/preview', authenticationToken, requireAdmin, preview);
	app.post('/admin/news/:id/newsletter/test', authenticationToken, requireAdmin, sendTest);
	app.post('/admin/news/:id/newsletter/send', authenticationToken, requireAdmin, sendToAll);
};

module.exports = newsletter_route;
