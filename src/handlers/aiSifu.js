// handlers/ai-sifu.js
require('dotenv').config();
const { AISifuStore, validateAIQuestion } = require('../models/aiSifu');
const { authenticationToken, requireAdmin } = require('../middleware/auth');
const { NeigongManualAgent } = require('../utilis/agent');

/**
 * AI Sifu Handlers - All business logic for AI Sifu operations
 */

// ========================
// MAIN AI SIFU HANDLERS
// ========================

/**
 * Ask AI Sifu a question
 * POST /ai-sifu/ask
 */
const askQuestion = async (req, res) => {
	const startTime = Date.now();

	try {
		const { question, course_id } = req.body;
		const userId = req.user.id;

		// Validate question data
		const { error } = validateAIQuestion({ question, course_id });
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new AISifuStore(req.app.locals.pool);

		// Check if user can ask questions
		const accessCheck = await store.canUserAsk(userId, course_id);
		if (!accessCheck.canAsk) {
			return res.status(403).json({
				error: 'Access denied',
				reason: accessCheck.reason,
				limit: accessCheck.limit,
				used: accessCheck.used,
				courseId: accessCheck.courseId,
				message:
					accessCheck.message || getAccessDeniedMessage(accessCheck.reason),
			});
		}

		// TEMPORARILY DISABLE CACHE - ALWAYS GENERATE NEW RESPONSE
		let response;
		let cached = false;
		let costCents = 0;

		// Comment out cache check for now
		// const cachedResponse = await store.getCachedResponse(question);
		// if (cachedResponse) { ... }

		// Always generate new AI response for debugging
		console.log('Generating new AI response for:', question);

		try {
			console.log('Creating NeigongManualAgent...');
			const agent = new NeigongManualAgent();
			console.log('Agent created successfully');

			console.log('Calling agent.handleQuery...');
			response = await agent.handleQuery(question);
			console.log(
				'Agent response received:',
				JSON.stringify(response, null, 2)
			);

			// Calculate actual cost
			costCents = agent.estimateResponseCost(question, response);
			console.log('Estimated cost:', costCents);

			// Temporarily disable caching too
			// await store.cacheResponse(question, response);
			console.log('Skipping cache storage for debugging');
		} catch (aiError) {
			console.error('AI generation error:', aiError);
			console.error('Error stack:', aiError.stack);
			return res.status(500).json({ error: 'Failed to generate AI response' });
		}

		// Record usage
		await store.recordUsage(userId, costCents, course_id);

		// Record analytics
		const responseTime = Date.now() - startTime;
		await store.recordQuestion(
			userId,
			question,
			cached,
			costCents,
			responseTime,
			course_id
		);

		return res.status(200).json({
			response: response.response,
			terms_used: response.terms_used || [],
			manual_sections: response.manual_sections || [],
			classical_references: response.classical_references || [],
			cached,
			response_time_ms: responseTime,
			cost_cents: costCents,
		});
	} catch (error) {
		console.error('Ask question error:', error);
		return res.status(500).json({ error: 'Failed to process question' });
	}
};

/**
 * Get user's usage status
 * GET /ai-sifu/usage
 */
const getUserUsage = async (req, res) => {
	try {
		const userId = req.user.id;
		const store = new AISifuStore(req.app.locals.pool);

		const usage = await store.getUserUsage(userId);

		// Get user's purchased courses
		const client = req.app.locals.pool;
		const coursesSql = `
      SELECT DISTINCT c.id, c.title 
      FROM courses c
      JOIN orders o ON c.id = o.course_id
      WHERE o.user_id = $1 AND o.order_status = 'completed'
    `;
		const coursesRes = await client.query(coursesSql, [userId]);

		// Check subscription status
		const subscriptionSql = `
      SELECT ss.status FROM stripe_subscriptions ss
      JOIN stripe_customers sc ON ss.customer_id = sc.customer_id
      WHERE sc.user_id = $1 AND ss.status = 'active'
    `;
		const subRes = await client.query(subscriptionSql, [userId]);
		const hasActiveSubscription = subRes.rows.length > 0;

		// Calculate usage by course
		const courseUsage = [];
		for (const course of coursesRes.rows) {
			const used = usage.course_purchases_usage[course.id] || 0;
			courseUsage.push({
				course_id: course.id,
				course_title: course.title,
				used,
				limit: 10,
				remaining: Math.max(0, 10 - used),
			});
		}

		return res.status(200).json({
			period_start: usage.period_start,
			subscription: {
				active: hasActiveSubscription,
				used: usage.subscription_usage,
				limit: 100,
				remaining: Math.max(0, 100 - usage.subscription_usage),
			},
			courses: courseUsage,
			total_cost_cents: usage.total_cost_cents,
			is_admin: req.user.is_admin,
		});
	} catch (error) {
		console.error('Get user usage error:', error);
		return res.status(500).json({ error: 'Failed to get usage information' });
	}
};

/**
 * Get user's question history
 * GET /ai-sifu/history?limit=20
 */
const getQuestionHistory = async (req, res) => {
	try {
		const userId = req.user.id;
		const limit = parseInt(req.query.limit) || 20;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const sql = `
      SELECT 
        aqa.question_text,
        aqa.response_cached,
        aqa.cost_cents,
        aqa.response_time_ms,
        aqa.course_context,
        aqa.created_at,
        c.title as course_title
      FROM ai_question_analytics aqa
      LEFT JOIN courses c ON aqa.course_context = c.id
      WHERE aqa.user_id = $1
      ORDER BY aqa.created_at DESC
      LIMIT $2
    `;

		const client = req.app.locals.pool;
		const res_query = await client.query(sql, [userId, limit]);

		return res.status(200).json(res_query.rows);
	} catch (error) {
		console.error('Get question history error:', error);
		return res.status(500).json({ error: 'Failed to get question history' });
	}
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * Get AI Sifu analytics (admin only)
 * GET /admin/ai-sifu/analytics
 */
const getAnalytics = async (req, res) => {
	try {
		const store = new AISifuStore(req.app.locals.pool);

		const stats = await store.getUsageStats();
		const popularQuestions = await store.getPopularQuestions(10);

		// Get cache statistics
		const client = req.app.locals.pool;
		const cacheSql = `
      SELECT 
        COUNT(*) as total_cached,
        SUM(usage_count) as total_cache_hits,
        AVG(usage_count) as avg_usage_per_question
      FROM ai_response_cache
      WHERE expires_at > CURRENT_TIMESTAMP
    `;
		const cacheRes = await client.query(cacheSql);

		// Get cost breakdown
		const costSql = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as questions_count,
        SUM(cost_cents) as daily_cost_cents,
        COUNT(*) FILTER (WHERE response_cached = true) as cached_count
      FROM ai_question_analytics
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;
		const costRes = await client.query(costSql);

		return res.status(200).json({
			overview: stats,
			popular_questions: popularQuestions,
			cache_stats: cacheRes.rows[0],
			daily_costs: costRes.rows,
		});
	} catch (error) {
		console.error('Get analytics error:', error);
		return res.status(500).json({ error: 'Failed to get analytics' });
	}
};

/**
 * Get popular questions (admin)
 * GET /admin/ai-sifu/popular-questions?limit=20
 */
const getPopularQuestions = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 20;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new AISifuStore(req.app.locals.pool);
		const questions = await store.getPopularQuestions(limit);

		return res.status(200).json(questions);
	} catch (error) {
		console.error('Get popular questions error:', error);
		return res.status(500).json({ error: 'Failed to get popular questions' });
	}
};

/**
 * Clean expired cache entries (admin)
 * POST /admin/ai-sifu/clean-cache
 */
const cleanCache = async (req, res) => {
	try {
		const store = new AISifuStore(req.app.locals.pool);
		const deletedCount = await store.cleanExpiredCache();

		return res.status(200).json({
			message: 'Cache cleaned successfully',
			deleted_entries: deletedCount,
		});
	} catch (error) {
		console.error('Clean cache error:', error);
		return res.status(500).json({ error: 'Failed to clean cache' });
	}
};

/**
 * Get user usage details (admin)
 * GET /admin/ai-sifu/user-usage/:userId
 */
const getUserUsageAdmin = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const store = new AISifuStore(req.app.locals.pool);

		const usage = await store.getUserUsage(userId);

		// Get user's question history
		const sql = `
      SELECT 
        aqa.*,
        c.title as course_title
      FROM ai_question_analytics aqa
      LEFT JOIN courses c ON aqa.course_context = c.id
      WHERE aqa.user_id = $1
      ORDER BY aqa.created_at DESC
      LIMIT 50
    `;

		const client = req.app.locals.pool;
		const questionsRes = await client.query(sql, [userId]);

		return res.status(200).json({
			usage,
			recent_questions: questionsRes.rows,
		});
	} catch (error) {
		console.error('Get user usage admin error:', error);
		return res.status(500).json({ error: 'Failed to get user usage details' });
	}
};

// ========================
// HELPER FUNCTIONS
// ========================

/**
 * Get appropriate access denied message
 */
function getAccessDeniedMessage(reason) {
	switch (reason) {
		case 'subscription_limit_reached':
			return 'You have reached your monthly limit of 100 questions. Your limit will reset next month.';
		case 'course_limit_reached':
			return 'You have reached your limit of 10 questions for this course. Purchase a subscription for higher limits.';
		case 'no_access':
			return 'Purchase a course or subscribe to access AI Sifu guidance.';
		default:
			return 'Access denied. Please check your subscription or course purchase status.';
	}
}

/**
 * AI Sifu route handler - manages all AI Sifu endpoints
 */
const ai_sifu_route = (app) => {
	// Public AI Sifu routes (require authentication)
	app.post('/ai-sifu/ask', authenticationToken, askQuestion);
	app.get('/ai-sifu/usage', authenticationToken, getUserUsage);
	app.get('/ai-sifu/history', authenticationToken, getQuestionHistory);

	// Admin routes
	app.get(
		'/admin/ai-sifu/analytics',
		authenticationToken,
		requireAdmin,
		getAnalytics
	);
	app.get(
		'/admin/ai-sifu/popular-questions',
		authenticationToken,
		requireAdmin,
		getPopularQuestions
	);
	app.post(
		'/admin/ai-sifu/clean-cache',
		authenticationToken,
		requireAdmin,
		cleanCache
	);
	app.get(
		'/admin/ai-sifu/user-usage/:userId',
		authenticationToken,
		requireAdmin,
		getUserUsageAdmin
	);
};

module.exports = ai_sifu_route;
