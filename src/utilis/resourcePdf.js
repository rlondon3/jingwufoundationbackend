// utilis/resourcePdf.js
const puppeteer = require('puppeteer');

/**
 * Renders a resource (ebook/manual) as a PDF, the same way the shop
 * download does, so an emailed copy matches the downloaded one.
 */

// Content above this size skips waiting for images to settle
const LARGE_CONTENT_BYTES = 10000000;

// Chrome is memory hungry; render one PDF at a time
let queue = Promise.resolve();

const renderPdf = async (resource) => {
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
		page.setDefaultTimeout(300000);

		const content =
			resource.type === 'manual'
				? resource.content
				: resource.content?.replace(/\n/g, '<br>');
		const html = `
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

		const isLarge = (resource.content?.length || 0) > LARGE_CONTENT_BYTES;
		await page.setContent(html, {
			waitUntil: isLarge ? 'domcontentloaded' : 'networkidle0',
			timeout: 300000,
		});

		const pdf = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
			timeout: 300000,
		});
		return Buffer.from(pdf);
	} finally {
		await browser.close();
	}
};

const generateResourcePdf = (resource) => {
	const result = queue.then(() => renderPdf(resource));
	queue = result.catch(() => {});
	return result;
};

const pdfFileName = (resource) =>
	`${resource.title.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;

module.exports = { generateResourcePdf, pdfFileName };
