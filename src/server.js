require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const users_route = require('./handlers/users');
const courses_route = require('./handlers/courses');
const stripeRoute = require('./handlers/stripe');
const paypalRoute = require('./handlers/paypal');
const ordersRoute = require('./handlers/orders');
const messagesRoute = require('./handlers/messages');
const messageEventsRoute = require('./handlers/messageEvents');
const news_route = require('./handlers/news');
const resources_route = require('./handlers/resources');
const ai_sifu_route = require('./handlers/aiSifu');
const ai_conversations_route = require('./handlers/aiSIfuHistories');
const student_notes_route = require('./handlers/studentNotes');
const health_route = require('./handlers/health');
const reviews_route = require('./handlers/reviews');
const bookings_route = require('./handlers/bookings');
const classes_route = require('./handlers/classes');
const cloudinary_routes = require('./handlers/cloudinary');
const password_reset_route = require('./handlers/passwordReset');
const terms_route = require('./handlers/termsOfService');
const blog_route = require('./handlers/blogs');
const testimonials_route = require('./handlers/testimonials');
const guided_feedback_route = require('./handlers/guidedFeedback');
const subscriptions_route = require('./handlers/subscriptions');
const coursePreviews_route = require('./handlers/coursePreviews');
const backup_routes = require('./handlers/backupRoutes');
const { checkAndProcessContent } = require('../scripts/processContentChunks');
const { checkAndImportPDFs } = require('../scripts/addPDFResources');

const app = express();
const PORT = process.env.PORT || 3000;
const address = `localhost:${PORT}`;

// Database connection
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	max: 20, // Maximum number of connections in the pool
	idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
	connectionTimeoutMillis: 5000, // Return an error after 5 seconds if connection could not be established
	allowExitOnIdle: true, // Allow pool to exit when idle
});

// Connection leak detection (development only)
if (process.env.NODE_ENV === 'development') {
	pool.on('connect', () => {
		console.log('🔗 DB connection acquired');
	});

	pool.on('remove', () => {
		console.log('❌ DB connection removed');
	});

	// Monitor pool usage every 30 seconds
	setInterval(() => {
		const total = pool.totalCount;
		const idle = pool.idleCount;
		const waiting = pool.waitingCount;

		if (total > 15 || waiting > 0) {
			console.warn(
				'⚠️  Pool warning - Total:',
				total,
				'Idle:',
				idle,
				'Waiting:',
				waiting
			);
		}
	}, 30000);
}

pool.on('error', (err) => {
	console.error('❌ Pool error:', err.message);
});

// Make pool available to routes
app.locals.pool = pool;

// Test database connection
const testConnection = async () => {
	try {
		console.log('🔗 Testing database connection...');
		const client = await pool.connect();
		const result = await client.query('SELECT NOW()');
		console.log('✅ Database connected successfully');
		console.log('🕒 Current time from DB:', result.rows[0].now);
		client.release();
	} catch (err) {
		console.error('❌ Database connection error:', err.message);
		console.error('❌ Full error:', err);
		console.error('❌ Server will continue but database operations will fail');
	}
};

// Trust proxy for accurate IP address detection
app.set('trust proxy', true);

// Middleware
app.use(helmet());
app.use(morgan('dev'));
// Express 5.0 compatible CORS setup
app.use((req, res, next) => {
	const origin = req.headers.origin;
	const allowedOrigins = [
		'http://localhost:3000',
		'http://localhost:5173',
		'http://127.0.0.1:5173',
		'https://jingwupai.org',
		'https://www.jingwupai.org',
	];

	if (allowedOrigins.includes(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
	}

	res.setHeader('Access-Control-Allow-Credentials', 'true');
	res.setHeader(
		'Access-Control-Allow-Methods',
		'GET, POST, PUT, DELETE, OPTIONS'
	);
	res.setHeader(
		'Access-Control-Allow-Headers',
		'Content-Type, Authorization, X-Requested-With, authorization'
	);

	if (req.method === 'OPTIONS') {
		res.status(200).end();
		return;
	}

	next();
});

app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/paypal/webhook', express.raw({ type: 'application/json' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Main route
app.get('/', function (_req, res) {
	res.json({
		message: 'Welcome to JingWu Foundation API',
		status: 'Server is running!',
		timestamp: new Date().toISOString(),
	});
});

// Route handlers
users_route(app);
health_route(app);
courses_route(app);
stripeRoute(app);
paypalRoute(app);
ordersRoute(app);
messagesRoute(app);
messageEventsRoute(app);
news_route(app);
resources_route(app);
reviews_route(app);
ai_sifu_route(app);
ai_conversations_route(app);
student_notes_route(app);
bookings_route(app);
classes_route(app);
cloudinary_routes(app);
password_reset_route(app);
terms_route(app);
blog_route(app);
testimonials_route(app);
guided_feedback_route(app);
subscriptions_route(app);
coursePreviews_route(app);
backup_routes(app);

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
	console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
	console.error('❌ Uncaught Exception:', error);
});

// Graceful shutdown
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
	if (isShuttingDown) {
		console.log('🔄 Shutdown already in progress...');
		return;
	}

	isShuttingDown = true;
	console.log(`\n🔄 Shutting down gracefully... (${signal})`);

	try {
		// Close database connections
		console.log('🔄 Closing database connections...');
		if (!pool.ended) {
			await pool.end();
			console.log('✅ Database connections closed');
		}

		console.log('✅ Graceful shutdown complete');
		process.exit(0);
	} catch (error) {
		console.error('❌ Error during shutdown:', error.message);
		process.exit(1);
	}
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start server
const server = app.listen(PORT, async function () {
	console.log(`🚀 Starting app using the server on ${address}`);
	console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
	await testConnection();

	// Auto-import PDF files and process content chunks on startup
	console.log('🔄 Starting PDF import and content processing...');

	// Step 1: Import any new PDF files from assets/resources
	await checkAndImportPDFs();

	// Step 2: Process content chunks (includes new PDFs)
	await checkAndProcessContent();
	console.log('✅ PDF import and content processing completed');
});

module.exports = app;
