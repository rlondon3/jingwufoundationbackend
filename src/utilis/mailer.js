// utilis/mailer.js
require('dotenv').config();
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

/**
 * Outgoing email through Amazon SES. The sending domain (jingwupai.org)
 * must be a verified identity in the same region.
 *
 * Env:
 *   AWS_SES_REGION, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY
 *   MAIL_FROM            e.g. "Jing Wu Foundation <news@jingwupai.org>"
 *   NEWSLETTER_REPLY_TO  reply-to address (default admin@jingwupai.org)
 */

let client = null;

const isConfigured = () =>
	Boolean(
		process.env.AWS_SES_REGION &&
			process.env.AWS_SES_ACCESS_KEY_ID &&
			process.env.AWS_SES_SECRET_ACCESS_KEY &&
			process.env.MAIL_FROM
	);

const getClient = () => {
	if (!isConfigured()) {
		throw new Error('Email is not configured: set the AWS_SES_* variables and MAIL_FROM');
	}
	if (!client) {
		client = new SESv2Client({
			region: process.env.AWS_SES_REGION,
			credentials: {
				accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
				secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
			},
		});
	}
	return client;
};

/**
 * Send one email. `headers` lets callers add List-Unsubscribe etc.
 */
const sendMail = async ({ to, subject, html, text, headers }) => {
	return getClient().send(
		new SendEmailCommand({
			FromEmailAddress: process.env.MAIL_FROM,
			Destination: { ToAddresses: [to] },
			ReplyToAddresses: [process.env.NEWSLETTER_REPLY_TO || 'admin@jingwupai.org'],
			Content: {
				Simple: {
					Subject: { Data: subject, Charset: 'UTF-8' },
					Body: {
						Html: { Data: html, Charset: 'UTF-8' },
						...(text && { Text: { Data: text, Charset: 'UTF-8' } }),
					},
					Headers: Object.entries(headers || {}).map(([Name, Value]) => ({
						Name,
						Value,
					})),
				},
			},
		})
	);
};

module.exports = { sendMail, isConfigured };
