// handlers/ai-sifu.js
require('dotenv').config();
const { AISifuStore, validateAIQuestion } = require('../models/aiSifu');
const { AIConversationStore } = require('../models/aiSifuHistory');
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

		// Check cache first
		let response;
		let cached = false;
		let costCents = 0;

		const cachedResponse = await store.getCachedResponse(question);
		if (cachedResponse) {
			response = cachedResponse.response_data;
			cached = true;
			costCents = 0; // Cached responses don't cost anything
		} else {
			// Generate new AI response

			try {
				const agent = new NeigongManualAgent();
				response = await agent.handleQuery(question);

				// Calculate actual cost
				costCents = agent.estimateResponseCost(question, response);

				// Cache the response for future use
				await store.cacheResponse(question, response);
			} catch (aiError) {
				console.error('AI generation error:', aiError);
				console.error('Error stack:', aiError.stack);
				return res.status(500).json({ error: 'Failed to generate AI response' });
			}
		}

		// Determine which course to record usage for
		let usageCourseId = course_id;
		
		// If no specific course ID provided, use the first enrolled course for usage tracking
		if (!usageCourseId) {
			const client = req.app.locals.pool;
			
			// Try to find first purchased course
			const purchaseQuery = 'SELECT DISTINCT course_id FROM orders WHERE user_id = $1 AND order_status = \'completed\' LIMIT 1';
			const purchaseResult = await client.query(purchaseQuery, [userId]);
			
			if (purchaseResult.rows.length > 0) {
				usageCourseId = purchaseResult.rows[0].course_id;
			} else {
				// Try to find first enrolled course
				const enrollmentQuery = 'SELECT DISTINCT course_id FROM user_courses WHERE user_id = $1 LIMIT 1';
				const enrollmentResult = await client.query(enrollmentQuery, [userId]);
				
				if (enrollmentResult.rows.length > 0) {
					usageCourseId = enrollmentResult.rows[0].course_id;
				}
			}
		}

		// Only record usage for new responses (not cached ones)
		if (!cached) {
			await store.recordUsage(userId, costCents, usageCourseId);
		}

		// Record analytics (always record for tracking purposes)
		const responseTime = Date.now() - startTime;
		await store.recordQuestion(
			userId,
			question,
			cached,
			costCents,
			responseTime,
			usageCourseId || course_id
		);

		// Save to conversation history for "Sifu's Notes" feature
		try {
			const conversationStore = new AIConversationStore(req.app.locals.pool);
			await conversationStore.saveConversation({
				user_id: userId,
				question_text: question,
				response_text: typeof response.response === 'string' ? response.response : JSON.stringify(response.response),
				course_context: usageCourseId || course_id || null,
				cost_cents: costCents,
				response_time_ms: responseTime,
				cached_response: cached,
				session_id: null // Could be enhanced to track sessions later
			});
		} catch (historyError) {
			console.error('Failed to save conversation to history:', historyError);
			// Don't fail the request if history saving fails
		}

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

		// Get user's accessible courses (purchased OR enrolled)
		const client = req.app.locals.pool;
		const coursesSql = `
      SELECT DISTINCT c.id, c.title 
      FROM courses c
      WHERE c.id IN (
        -- Courses purchased via orders
        SELECT DISTINCT o.course_id 
        FROM orders o 
        WHERE o.user_id = $1 AND o.order_status = 'completed'
        UNION
        -- Courses enrolled directly
        SELECT DISTINCT uc.course_id 
        FROM user_courses uc 
        WHERE uc.user_id = $1
      )
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
