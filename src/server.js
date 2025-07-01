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
const ai_sifu_route = require('./handlers/aiSifu');
const health_route = require('./handlers/health');
const cloudinary_routes = require('./handlers/cloudinary');

const app = express();
const PORT = process.env.PORT || 3001;
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
		'http://localhost:3000',
		'http://localhost:5173',
		'http://127.0.0.1:5173',
	], //change to your frontend URL in production
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization'],
};

// app.options('*', cors(corsOptions));

app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
// Middleware
app.use(helmet());
app.use(morgan('dev'));
app.use(cors(corsOptions));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Main route
app.get('/', function (req, res) {
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
ai_sifu_route(app);
cloudinary_routes(app);

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
