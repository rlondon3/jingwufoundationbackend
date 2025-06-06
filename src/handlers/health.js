// handlers/health.js

const health_route = (app) => {
	const pool = app.locals.pool;

	// Health check endpoint
	app.get('/health', async (req, res) => {
		try {
			const client = await pool.connect();
			const result = await client.query('SELECT 1');
			client.release();

			res.json({
				status: 'healthy',
				database: 'connected',
				timestamp: new Date().toISOString(),
			});
		} catch (err) {
			res.status(500).json({
				status: 'error',
				database: 'disconnected',
				error: err.message,
				timestamp: new Date().toISOString(),
			});
		}
	});

	// Database info endpoint
	app.get('/api/db-info', async (req, res) => {
		try {
			const client = await pool.connect();
			const result = await client.query(`
          SELECT 
            current_database() as database_name,
            current_user as user_name,
            version() as postgresql_version,
            NOW() as current_time
        `);
			client.release();

			res.json({
				success: true,
				data: result.rows[0],
			});
		} catch (err) {
			console.error('Database info error:', err);
			res.status(500).json({
				success: false,
				error: err.message,
			});
		}
	});

	// Test database operations
	app.get('/api/test-db', async (req, res) => {
		try {
			const client = await pool.connect();

			// Test creating a temporary table
			await client.query(`
          CREATE TEMP TABLE test_connection (
            id SERIAL PRIMARY KEY,
            test_message VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

			// Insert test data
			await client.query(
				'INSERT INTO test_connection (test_message) VALUES ($1)',
				['Database connection test successful']
			);

			// Retrieve test data
			const result = await client.query('SELECT * FROM test_connection');

			client.release();

			res.json({
				success: true,
				message: 'Database test completed successfully',
				data: result.rows[0],
			});
		} catch (err) {
			console.error('Database test error:', err);
			res.status(500).json({
				success: false,
				error: err.message,
			});
		}
	});
};

module.exports = health_route;
