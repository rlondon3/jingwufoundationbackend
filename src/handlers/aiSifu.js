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
				const agent = new NeigongManualAgent(req.app.locals.pool);
				response = await agent.handleQuery(question, course_id);

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

		// Determine which course to record usage for based on access reason
		let usageCourseId = course_id;
		
		// For global free access, don't assign a course ID - track as global usage
		if (accessCheck.reason === 'global_free_access') {
			usageCourseId = null;
		} else if (!usageCourseId) {
			// Only find course ID for non-global-free access
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

		// Always record usage for question limits, regardless of cache status
		try {
			await store.recordUsage(userId, costCents, usageCourseId, accessCheck.reason);
		} catch (usageError) {
			console.error('Usage recording failed:', usageError.message);
			console.error('Access reason was:', accessCheck.reason);
			console.error('User ID:', userId, 'Course ID:', usageCourseId);
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
		const settings = await store.getAiSifuSettings();
		const userPrefs = await store.getUserPreferences(userId);

		// Check for active AI Sifu subscription
		const client = req.app.locals.pool;
		let activeSubscription = null;
		const subscriptionSql = `
			SELECT status, current_period_end, current_period_start, price_cents, metadata, cancel_at_period_end 
			FROM subscriptions 
			WHERE user_id = $1 
			AND subscription_type = 'ai_sifu' 
			AND status = 'active'
			AND current_period_end > NOW()
			LIMIT 1
		`;
		const subRes = await client.query(subscriptionSql, [userId]);
		
		if (subRes.rows.length > 0) {
			const sub = subRes.rows[0];
			activeSubscription = {
				active: true,
				used: usage.subscription_usage || 0,
				limit: settings.subscriber_limit,
				remaining: Math.max(0, settings.subscriber_limit - (usage.subscription_usage || 0)),
				expires_at: sub.current_period_end,
				cancel_at_period_end: sub.cancel_at_period_end || false,
				course_id: null
			};
		} else {
			activeSubscription = {
				active: false,
				used: 0,
				limit: settings.subscriber_limit,
				remaining: 0,
				expires_at: null,
				course_id: null
			};
		}

		// Global free questions
		const globalFreeQuestions = {
			used: usage.global_free_usage || 0,
			limit: settings.global_free_limit,
			remaining: Math.max(0, settings.global_free_limit - (usage.global_free_usage || 0))
		};

		return res.status(200).json({
			period_start: usage.period_start,
			subscription: activeSubscription,
			global_free_questions: globalFreeQuestions,
			total_cost_cents: usage.total_cost_cents,
			is_admin: req.user.is_admin,
			aiSifu_enabled: settings.enabled && userPrefs.ai_sifu_enabled
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


/**
 * Check user access to AI Sifu for a specific course
 * GET /ai-sifu/access/:courseId
 */
const checkCourseAccess = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const userId = req.user.id;
		const store = new AISifuStore(req.app.locals.pool);

		const accessCheck = await store.canUserAsk(userId, courseId);
		const usage = await store.getUserUsage(userId);
		const settings = await store.getAiSifuSettings();

		return res.status(200).json({
			has_access: accessCheck.canAsk,
			subscription_active: accessCheck.reason === 'subscription_access',
			questions_remaining: accessCheck.remaining || 0,
			free_questions_remaining: Math.max(0, settings.global_free_limit - (usage.global_free_usage || 0)),
			access_reason: accessCheck.reason,
			limit: accessCheck.limit,
			used: accessCheck.used
		});
	} catch (error) {
		console.error('Check course access error:', error);
		return res.status(500).json({ error: 'Failed to check course access' });
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

/**
 * Toggle AI Sifu system on/off (admin only)
 * POST /admin/ai-sifu/toggle
 */
const toggleAiSifuEnabled = async (req, res) => {
	try {
		const { enabled } = req.body;
		const store = new AISifuStore(req.app.locals.pool);

		if (typeof enabled !== 'boolean') {
			return res.status(400).json({ error: 'enabled must be a boolean value' });
		}

		await store.setSystemSetting('ai_sifu_enabled', enabled, 'Global toggle for AI Sifu availability');

		return res.status(200).json({
			message: `AI Sifu ${enabled ? 'enabled' : 'disabled'} successfully`,
			enabled
		});
	} catch (error) {
		console.error('Toggle AI Sifu error:', error);
		return res.status(500).json({ error: 'Failed to toggle AI Sifu' });
	}
};

/**
 * Toggle AI Sifu for a specific user (admin only)
 * POST /admin/ai-sifu/user-toggle/:userId
 */
const toggleUserAiSifuEnabled = async (req, res) => {
	try {
		const { userId } = req.params;
		const { enabled } = req.body;
		const store = new AISifuStore(req.app.locals.pool);

		if (!userId) {
			return res.status(400).json({ error: 'User ID is required' });
		}

		if (typeof enabled !== 'boolean') {
			return res.status(400).json({ error: 'enabled must be a boolean value' });
		}

		// Set user preferences for AI Sifu
		await store.setUserPreferences(userId, { ai_sifu_enabled: enabled });

		return res.status(200).json({
			message: `AI Sifu ${enabled ? 'enabled' : 'disabled'} for user ${userId}`,
			enabled
		});
	} catch (error) {
		console.error('Toggle user AI Sifu error:', error);
		return res.status(500).json({ error: 'Failed to toggle user AI Sifu' });
	}
};

/**
 * Get AI Sifu system settings (admin only)
 * GET /admin/ai-sifu/settings
 */
const getAiSifuSettings = async (req, res) => {
	try {
		const store = new AISifuStore(req.app.locals.pool);
		const settings = await store.getAiSifuSettings();

		return res.status(200).json({
			enabled: settings.enabled,
			monthly_price: settings.price_cents / 100, // Convert cents to dollars
			monthly_question_limit: settings.subscriber_limit,
			free_question_limit: settings.global_free_limit,
			course_question_limit: settings.course_limit
		});
	} catch (error) {
		console.error('Get AI Sifu settings error:', error);
		return res.status(500).json({ error: 'Failed to get AI Sifu settings' });
	}
};

/**
 * Get all users' AI Sifu preferences (admin only)
 * GET /admin/ai-sifu/user-preferences
 */
const getAllUserAiSifuPreferences = async (req, res) => {
	try {
		const client = req.app.locals.pool;
		const sql = `
			SELECT u.id, u.name, u.email, 
				COALESCE(up.ai_sifu_enabled, true) as ai_sifu_enabled
			FROM users u
			LEFT JOIN user_preferences up ON u.id = up.user_id
			WHERE u.is_admin = false
			ORDER BY u.name
		`;
		
		const result = await client.query(sql);
		
		return res.status(200).json(result.rows);
	} catch (error) {
		console.error('Get all user AI Sifu preferences error:', error);
		return res.status(500).json({ error: 'Failed to get user AI Sifu preferences' });
	}
};

/**
 * Update AI Sifu system settings (admin only)
 * PUT /admin/ai-sifu/settings
 */
const updateAiSifuSettings = async (req, res) => {
	try {
		const { 
			enabled, 
			monthly_price, 
			monthly_question_limit, 
			free_question_limit,
			course_question_limit 
		} = req.body;
		const store = new AISifuStore(req.app.locals.pool);

		// Update settings that were provided
		if (typeof enabled === 'boolean') {
			await store.setSystemSetting('ai_sifu_enabled', enabled);
		}
		if (typeof monthly_price === 'number' && monthly_price > 0) {
			await store.setSystemSetting('ai_sifu_price_cents', monthly_price * 100); // Convert to cents
		}
		if (typeof monthly_question_limit === 'number' && monthly_question_limit > 0) {
			await store.setSystemSetting('subscriber_questions_limit', monthly_question_limit);
		}
		if (typeof free_question_limit === 'number' && free_question_limit >= 0) {
			await store.setSystemSetting('global_free_questions_limit', free_question_limit);
		}
		if (typeof course_question_limit === 'number' && course_question_limit > 0) {
			await store.setSystemSetting('course_questions_limit', course_question_limit);
		}

		// Get updated settings
		const updatedSettings = await store.getAiSifuSettings();

		return res.status(200).json({
			message: 'AI Sifu settings updated successfully',
			settings: {
				enabled: updatedSettings.enabled,
				monthly_price: updatedSettings.price_cents / 100,
				monthly_question_limit: updatedSettings.subscriber_limit,
				free_question_limit: updatedSettings.global_free_limit,
				course_question_limit: updatedSettings.course_limit
			}
		});
	} catch (error) {
		console.error('Update AI Sifu settings error:', error);
		return res.status(500).json({ error: 'Failed to update AI Sifu settings' });
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
		case 'ai_sifu_disabled':
			return 'AI Sifu is currently disabled by the administrator.';
		case 'user_disabled':
			return 'AI Sifu is disabled in your preferences. Enable it in your settings.';
		case 'subscription_limit_reached':
			return 'You have reached your monthly subscription limit. Your limit will reset next month.';
		case 'course_limit_reached':
			return 'You have reached your question limit for this course. Subscribe to AI Sifu for higher limits.';
		case 'no_questions_remaining':
			return 'You have used all your free questions. Subscribe to AI Sifu or purchase a course to continue.';
		case 'no_access':
			return 'Purchase a course or subscribe to access AI Sifu guidance.';
		default:
			return 'Access denied. Please check your subscription or course purchase status.';
	}
}

/**
 * AI Sifu route handler - manages all AI Sifu endpoints
 */
/**
 * Activate AI Sifu subscription manually (fallback for webhook issues)
 * POST /ai-sifu/activate-subscription
 */
const activateSubscription = async (req, res) => {
	try {
		const { session_id } = req.body;
		const userId = req.user.id;

		if (!session_id) {
			return res.status(400).json({ error: 'Session ID required' });
		}

		// Get session details from Stripe to verify it's a valid AI Sifu subscription
		const Stripe = require('stripe');
		const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
		
		const session = await stripe.checkout.sessions.retrieve(session_id);
		
		if (session.payment_status !== 'paid' || session.metadata.user_id != userId) {
			return res.status(400).json({ error: 'Invalid session or payment not completed' });
		}

		if (!session.subscription) {
			return res.status(400).json({ error: 'No subscription found in session' });
		}

		// Get subscription details with expanded data
		const subscription = await stripe.subscriptions.retrieve(session.subscription, {
			expand: ['latest_invoice', 'default_payment_method']
		});
		
		console.log('Subscription data:', {
			id: subscription.id,
			status: subscription.status,
			current_period_start: subscription.current_period_start,
			current_period_end: subscription.current_period_end,
			cancel_at_period_end: subscription.cancel_at_period_end
		});
		
		// Handle missing timestamps with fallback dates
		let periodStart, periodEnd;
		
		if (subscription.current_period_start && subscription.current_period_end) {
			periodStart = new Date(subscription.current_period_start * 1000);
			periodEnd = new Date(subscription.current_period_end * 1000);
		} else {
			// Fallback: use subscription creation date and add 1 month
			console.log('⚠️ Missing subscription period dates, using fallback dates based on creation');
			const createdDate = subscription.created ? new Date(subscription.created * 1000) : new Date();
			periodStart = createdDate;
			periodEnd = new Date(createdDate);
			periodEnd.setMonth(periodEnd.getMonth() + 1);
		}
		
		// Create subscription record in database
		const subscriptionSql = `
			INSERT INTO subscriptions (
				user_id, stripe_subscription_id, subscription_type, 
				status, current_period_start, current_period_end, cancel_at_period_end,
				price_cents, metadata
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (stripe_subscription_id) 
			DO UPDATE SET 
				status = EXCLUDED.status,
				current_period_start = EXCLUDED.current_period_start,
				current_period_end = EXCLUDED.current_period_end,
				cancel_at_period_end = EXCLUDED.cancel_at_period_end,
				updated_at = CURRENT_TIMESTAMP
		`;
		
		const priceCents = subscription.items.data[0]?.price?.unit_amount || 1000;
		const metadata = { 
			description: 'AI Sifu Monthly Subscription',
			features: ['12 questions per month', 'Personal AI martial arts guide']
		};
		
		console.log('Using dates:', { periodStart, periodEnd });
		
		await req.app.locals.pool.query(subscriptionSql, [
			userId,
			subscription.id,
			'ai_sifu',
			subscription.status,
			periodStart,
			periodEnd,
			subscription.cancel_at_period_end || false,
			priceCents,
			JSON.stringify(metadata)
		]);

		console.log(`AI Sifu subscription manually activated for user ${userId}: ${subscription.id}`);
		
		res.json({ 
			success: true, 
			message: 'AI Sifu subscription activated',
			subscription_id: subscription.id
		});
	} catch (error) {
		console.error('Error activating AI Sifu subscription:', error);
		res.status(500).json({ error: 'Failed to activate subscription' });
	}
};

/**
 * Cancel AI Sifu subscription
 * POST /ai-sifu/cancel-subscription
 */
const cancelSubscription = async (req, res) => {
	try {
		const userId = req.user.id;

		// Get active subscription from database
		const subscriptionQuery = await req.app.locals.pool.query(
			'SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND subscription_type = $2 AND status = $3',
			[userId, 'ai_sifu', 'active']
		);

		if (subscriptionQuery.rows.length === 0) {
			return res.status(404).json({ error: 'No active AI Sifu subscription found' });
		}

		const stripeSubscriptionId = subscriptionQuery.rows[0].stripe_subscription_id;

		// Cancel subscription in Stripe
		const Stripe = require('stripe');
		const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
		
		const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
			cancel_at_period_end: true
		});

		// Update subscription in database
		await req.app.locals.pool.query(
			'UPDATE subscriptions SET cancel_at_period_end = true, updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = $1',
			[stripeSubscriptionId]
		);

		console.log(`AI Sifu subscription cancelled for user ${userId}: ${stripeSubscriptionId}`);
		
		res.json({ 
			success: true, 
			message: 'Subscription will be cancelled at the end of the current billing period',
			cancels_at: subscription.current_period_end
		});
	} catch (error) {
		console.error('Error cancelling AI Sifu subscription:', error);
		res.status(500).json({ error: 'Failed to cancel subscription' });
	}
};

const ai_sifu_route = (app) => {
	// Public AI Sifu routes (require authentication)
	app.post('/ai-sifu/ask', authenticationToken, askQuestion);
	app.get('/ai-sifu/usage', authenticationToken, getUserUsage);
	app.get('/ai-sifu/history', authenticationToken, getQuestionHistory);
	
	// Subscription routes
	app.post('/ai-sifu/activate-subscription', authenticationToken, activateSubscription);
	app.post('/ai-sifu/cancel-subscription', authenticationToken, cancelSubscription);
	
	// Access routes
	app.get('/ai-sifu/access/:courseId', authenticationToken, checkCourseAccess);

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
	
	// Admin settings and controls
	app.post(
		'/admin/ai-sifu/toggle',
		authenticationToken,
		requireAdmin,
		toggleAiSifuEnabled
	);
	app.post(
		'/admin/ai-sifu/user-toggle/:userId',
		authenticationToken,
		requireAdmin,
		toggleUserAiSifuEnabled
	);
	app.get(
		'/admin/ai-sifu/settings',
		authenticationToken,
		requireAdmin,
		getAiSifuSettings
	);
	app.get(
		'/admin/ai-sifu/user-preferences',
		authenticationToken,
		requireAdmin,
		getAllUserAiSifuPreferences
	);
	app.put(
		'/admin/ai-sifu/settings',
		authenticationToken,
		requireAdmin,
		updateAiSifuSettings
	);
};

module.exports = ai_sifu_route;
