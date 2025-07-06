require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const users_route = require('./handlers/users');
const courses_route = require('./handlers/courses');
const stripeRoute = require('./handlers/stripe');
const ordersRoute = require('./handlers/orders');
const messagesRoute = require('./handlers/messages');
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

const app = express();
const PORT = process.env.PORT || 3002;
const address = `localhost:${PORT}`;

// Database connection
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
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

// CORS configuration
const corsOptions = {
	origin: [
		'http://localhost:3002',
		'http://localhost:5173',
		'http://127.0.0.1:5173',
	], //change to your frontend URL in production
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
	optionsSuccessStatus: 200,
};

// Middleware
app.use(helmet());
app.use(morgan('dev'));
// Express 5.0 compatible CORS setup
app.use((req, res, next) => {
	const origin = req.headers.origin;
	const allowedOrigins = [
		'http://localhost:3002',
		'http://localhost:5173',
		'http://127.0.0.1:5173',
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
		'Content-Type, Authorization, X-Requested-With'
	);

	if (req.method === 'OPTIONS') {
		res.status(200).end();
		return;
	}

	next();
});

app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
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
ordersRoute(app);
messagesRoute(app);
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

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
	console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
	console.error('❌ Uncaught Exception:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
	console.log('\n🔄 Shutting down gracefully...');
	await pool.end();
	console.log('✅ Database connections closed');
	process.exit(0);
});

// Start server
app.listen(PORT, async function () {
	console.log(`🚀 Starting app using the server on ${address}`);
	console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
	await testConnection();
});

module.exports = app;
