const { join } = require('path');

/**
 * Keep Puppeteer's Chrome inside the project so it ships with the deploy.
 * pnpm doesn't run Puppeteer's own install script, so `npm run build`
 * downloads it explicitly (Railway runs the build script on every deploy).
 */
module.exports = {
	cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
