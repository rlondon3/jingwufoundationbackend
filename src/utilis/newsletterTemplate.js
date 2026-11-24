// utilis/newsletterTemplate.js

/**
 * Renders a news article as a newsletter email (HTML + plain text).
 * Email clients need tables and inline styles, so this is deliberately
 * old-fashioned markup.
 */

const LOGO_URL =
	'https://res.cloudinary.com/dvao1isqe/image/upload/v1753240648/logo_s8xpbi.png';

const COLORS = {
	page: '#f2e9df', // primary-100
	card: '#ffffff',
	header: '#4d3621', // primary-800
	accent: '#bf915b', // primary-500
	button: '#735231', // primary-700
	heading: '#261b10', // primary-900
	text: '#3d3229',
	muted: '#8a7a6a',
	rule: '#e6d3be', // primary-200
};

const FONT = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const escapeHtml = (str = '') =>
	String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

// Escape first, then turn bare URLs into links
const linkify = (escaped) =>
	escaped.replace(
		/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g,
		`<a href="$1" style="color:${COLORS.button};text-decoration:underline;">$1</a>`
	);

// Blank lines separate paragraphs; single newlines become line breaks
const bodyToHtml = (body = '') =>
	body
		.replace(/\r\n/g, '\n')
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map(
			(p) =>
				`<p style="margin:0 0 18px;font-family:${FONT};font-size:17px;line-height:1.65;color:${COLORS.text};">${linkify(
					escapeHtml(p)
				).replace(/\n/g, '<br>')}</p>`
		)
		.join('\n');

const formatDate = (d) =>
	new Date(d || Date.now()).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});

/**
 * @param {object} article  news row (title, description, body, thumbnail_url, author_name,
 *                          publish_at, tags, button_text, button_url)
 * @param {object} opts     { unsubscribeUrl }
 */
const renderNewsletter = (article, { unsubscribeUrl }) => {
	const title = escapeHtml(article.title);
	const description = escapeHtml(article.description);
	const author = escapeHtml(article.author_name);
	const date = formatDate(article.publish_at || article.created_at);
	const tags = (article.tags || []).filter(Boolean);

	const thumbnail = article.thumbnail_url
		? `<tr><td style="padding:0;"><img src="${escapeHtml(
				article.thumbnail_url
		  )}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`
		: '';

	const importantBadge = article.is_important
		? `<span style="display:inline-block;margin-right:8px;padding:3px 10px;border-radius:12px;background:#fbeaea;color:#a12b2b;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Important</span>`
		: '';

	const hasButton = Boolean(article.button_text && article.button_url);
	const button = hasButton
		? `<tr><td align="center" style="padding:28px 40px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border-radius:6px;background:${COLORS.button};">
          <a href="${escapeHtml(article.button_url)}" style="display:inline-block;padding:13px 28px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(
				article.button_text
		  )}</a>
        </td>
      </tr></table>
    </td></tr>`
		: `<tr><td style="padding:0 0 32px;"></td></tr>`;

	const tagRow = tags.length
		? `<p style="margin:24px 0 0;font-family:${SANS};font-size:12px;color:${COLORS.muted};">${tags
				.map(
					(t) =>
						`<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:12px;background:${COLORS.page};color:${COLORS.button};">${escapeHtml(
							t
						)}</span>`
				)
				.join('')}</p>`
		: '';

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${description}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${COLORS.card};border-radius:10px;overflow:hidden;">
    <tr><td align="center" style="background:${COLORS.header};padding:22px 24px;">
      <img src="${LOGO_URL}" width="56" height="56" alt="Jing Wu Foundation" style="display:block;border:0;margin:0 auto 8px;">
      <div style="font-family:${FONT};font-size:20px;letter-spacing:.04em;color:#ffffff;">Jing Wu Foundation</div>
      <div style="font-family:${SANS};font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${COLORS.accent};margin-top:4px;">News &amp; Updates</div>
    </td></tr>
    ${thumbnail}
    <tr><td style="padding:36px 40px 8px;">
      <p style="margin:0 0 14px;font-family:${SANS};font-size:12px;color:${COLORS.muted};">${importantBadge}${date}</p>
      <h1 style="margin:0 0 14px;font-family:${FONT};font-size:30px;line-height:1.25;font-weight:normal;color:${COLORS.heading};">${title}</h1>
      <p style="margin:0 0 26px;font-family:${FONT};font-size:19px;line-height:1.5;font-style:italic;color:${COLORS.button};">${description}</p>
      <div style="height:2px;width:56px;background:${COLORS.accent};margin:0 0 26px;"></div>
      ${bodyToHtml(article.body)}
      <p style="margin:8px 0 0;font-family:${SANS};font-size:14px;color:${COLORS.muted};">&mdash; ${author}</p>
      ${tagRow}
    </td></tr>
    ${button}
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding:22px 24px;font-family:${SANS};font-size:12px;line-height:1.6;color:${COLORS.muted};">
      You're receiving this because you're a member of the Jing Wu Foundation community.<br>
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe from news emails</a>
      &nbsp;&middot;&nbsp;
      <a href="https://jingwupai.org" style="color:${COLORS.muted};text-decoration:underline;">jingwupai.org</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

	const text = [
		'JING WU FOUNDATION — NEWS & UPDATES',
		'',
		article.title,
		date,
		'',
		article.description,
		'',
		(article.body || '').trim(),
		'',
		`— ${article.author_name}`,
		'',
		...(hasButton ? [`${article.button_text}: ${article.button_url}`, ''] : []),
		'---',
		"You're receiving this because you're a member of the Jing Wu Foundation community.",
		`Unsubscribe: ${unsubscribeUrl}`,
	].join('\n');

	return { subject: article.title, html, text };
};

module.exports = { renderNewsletter, escapeHtml, COLORS, FONT, SANS, LOGO_URL };
