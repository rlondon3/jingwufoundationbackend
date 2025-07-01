// models/ai-sifu.js
require('dotenv').config();
const Joi = require('joi');
const crypto = require('crypto');

/**
 * AISifuStore handles all AI Sifu operations
 * Manages usage tracking, response caching, and analytics
 */
class AISifuStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// USAGE TRACKING OPERATIONS
	// ========================

	/**
	 * Get user's current usage for this month
	 */
	async getUserUsage(userId) {
		try {
			const currentPeriod = this.getCurrentPeriod();

			const sql = `
        SELECT * FROM ai_usage_tracking 
        WHERE user_id = $1 AND period_start = $2
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, currentPeriod]);
			client.release();

			if (res.rows.length === 0) {
				// Create new usage record for this period
				return await this.createUsageRecord(userId, currentPeriod);
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get user usage: ${error}`);
		}
	}

	/**
	 * Check if user can ask a question (within limits)
	 */
	async canUserAsk(userId, courseId = null) {
		try {
			const client = await this.pool.connect();

			// Get user info
			const userSql = 'SELECT is_admin FROM users WHERE id = $1';
			const userRes = await client.query(userSql, [userId]);

			if (userRes.rows.length === 0) {
				client.release();
				throw new Error('User not found');
			}

			const user = userRes.rows[0];

			// Admin has unlimited access
			if (user.is_admin) {
				client.release();
				return { canAsk: true, reason: 'admin_unlimited' };
			}

			// Get usage data
			const usage = await this.getUserUsage(userId);

			// Check if user has active subscription
			const subscriptionSql = `
        SELECT ss.status FROM stripe_subscriptions ss
        JOIN stripe_customers sc ON ss.customer_id = sc.customer_id
        WHERE sc.user_id = $1 AND ss.status = 'active'
      `;
			const subRes = await client.query(subscriptionSql, [userId]);
			const hasActiveSubscription = subRes.rows.length > 0;

			if (hasActiveSubscription) {
				// Subscriber limit: 100 per month
				if (usage.subscription_usage >= 100) {
					client.release();
					return {
						canAsk: false,
						reason: 'subscription_limit_reached',
						limit: 100,
						used: usage.subscription_usage,
					};
				}
				client.release();
				return { canAsk: true, reason: 'subscription_access' };
			}

			// Check course purchase access
			if (courseId) {
				const purchaseSql = `
          SELECT id FROM orders 
          WHERE user_id = $1 AND course_id = $2 AND order_status = 'completed'
        `;
				const purchaseRes = await client.query(purchaseSql, [userId, courseId]);

				if (purchaseRes.rows.length > 0) {
					const courseUsage = usage.course_purchases_usage[courseId] || 0;
					if (courseUsage >= 10) {
						client.release();
						return {
							canAsk: false,
							reason: 'course_limit_reached',
							courseId,
							limit: 10,
							used: courseUsage,
						};
					}
					client.release();
					return { canAsk: true, reason: 'course_purchase_access' };
				}
			}

			client.release();
			return {
				canAsk: false,
				reason: 'no_access',
				message: 'Purchase a course or subscribe to access AI Sifu',
			};
		} catch (error) {
			throw new Error(`Could not check user access: ${error}`);
		}
	}

	/**
	 * Record AI question usage
	 */
	async recordUsage(userId, costCents, courseId = null) {
		try {
			const currentPeriod = this.getCurrentPeriod();

			const client = await this.pool.connect();

			// Get current usage
			let usage = await this.getUserUsage(userId);

			// Update usage counts
			if (courseId) {
				const courseUsage = usage.course_purchases_usage || {};
				courseUsage[courseId] = (courseUsage[courseId] || 0) + 1;

				const sql = `
          UPDATE ai_usage_tracking 
          SET course_purchases_usage = $1, total_cost_cents = total_cost_cents + $2, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $3 AND period_start = $4
          RETURNING *
        `;

				const res = await client.query(sql, [
					JSON.stringify(courseUsage),
					costCents,
					userId,
					currentPeriod,
				]);

				client.release();
				return res.rows[0];
			} else {
				// Subscription usage
				const sql = `
          UPDATE ai_usage_tracking 
          SET subscription_usage = subscription_usage + 1, total_cost_cents = total_cost_cents + $1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2 AND period_start = $3
          RETURNING *
        `;

				const res = await client.query(sql, [costCents, userId, currentPeriod]);
				client.release();
				return res.rows[0];
			}
		} catch (error) {
			throw new Error(`Could not record usage: ${error}`);
		}
	}

	// ========================
	// RESPONSE CACHING OPERATIONS
	// ========================

	/**
	 * Get cached response for question
	 */
	async getCachedResponse(questionText) {
		try {
			const questionHash = this.hashQuestion(questionText);

			const sql = `
        SELECT * FROM ai_response_cache 
        WHERE question_hash = $1 AND expires_at > CURRENT_TIMESTAMP
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [questionHash]);
			client.release();

			if (res.rows.length > 0) {
				// Increment usage count
				await this.incrementCacheUsage(questionHash);
				return res.rows[0];
			}

			return null;
		} catch (error) {
			throw new Error(`Could not get cached response: ${error}`);
		}
	}

	/**
	 * Cache AI response
	 */
	async cacheResponse(questionText, responseData) {
		try {
			const questionHash = this.hashQuestion(questionText);
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7); // 1 week cache

			const sql = `
        INSERT INTO ai_response_cache (question_hash, question_text, response_data, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (question_hash) 
        DO UPDATE SET 
          response_data = EXCLUDED.response_data,
          usage_count = ai_response_cache.usage_count + 1,
          expires_at = EXCLUDED.expires_at
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				questionHash,
				questionText,
				JSON.stringify(responseData),
				expiresAt,
			]);
			client.release();

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not cache response: ${error}`);
		}
	}

	/**
	 * Clean expired cache entries
	 */
	async cleanExpiredCache() {
		try {
			const sql =
				'DELETE FROM ai_response_cache WHERE expires_at <= CURRENT_TIMESTAMP';

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();

			return res.rowCount;
		} catch (error) {
			throw new Error(`Could not clean expired cache: ${error}`);
		}
	}

	// ========================
	// ANALYTICS OPERATIONS
	// ========================

	/**
	 * Record question for analytics
	 */
	async recordQuestion(
		userId,
		questionText,
		responseCached,
		costCents,
		responseTimeMs,
		courseId = null
	) {
		try {
			const sql = `
        INSERT INTO ai_question_analytics 
        (user_id, question_text, response_cached, cost_cents, response_time_ms, course_context)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				userId,
				questionText,
				responseCached,
				costCents,
				responseTimeMs,
				courseId,
			]);
			client.release();

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not record question analytics: ${error}`);
		}
	}

	/**
	 * Get popular questions
	 */
	async getPopularQuestions(limit = 10) {
		try {
			const sql = `
        SELECT 
          question_text,
          COUNT(*) as ask_count,
          AVG(response_time_ms) as avg_response_time,
          SUM(cost_cents) as total_cost
        FROM ai_question_analytics 
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY question_text
        ORDER BY ask_count DESC
        LIMIT $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit]);
			client.release();

			return res.rows;
		} catch (error) {
			throw new Error(`Could not get popular questions: ${error}`);
		}
	}

	/**
	 * Get AI usage statistics
	 */
	async getUsageStats() {
		try {
			const sql = `
        SELECT 
          COUNT(DISTINCT user_id) as active_users,
          COUNT(*) as total_questions,
          SUM(cost_cents) as total_cost_cents,
          AVG(response_time_ms) as avg_response_time,
          COUNT(*) FILTER (WHERE response_cached = true) as cached_responses,
          COUNT(*) FILTER (WHERE course_context IS NOT NULL) as course_context_questions
        FROM ai_question_analytics 
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get usage stats: ${error}`);
		}
	}

	// ========================
	// HELPER METHODS
	// ========================

	/**
	 * Create new usage record for the current period
	 */
	async createUsageRecord(userId, periodStart) {
		try {
			const sql = `
        INSERT INTO ai_usage_tracking (user_id, period_start, course_purchases_usage, subscription_usage, total_cost_cents)
        VALUES ($1, $2, '{}', 0, 0)
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, periodStart]);
			client.release();

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create usage record: ${error}`);
		}
	}

	/**
	 * Get current period (first day of current month)
	 */
	getCurrentPeriod() {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), 1)
			.toISOString()
			.split('T')[0];
	}

	/**
	 * Hash question for cache key
	 */
	hashQuestion(questionText) {
		// Normalize question (lowercase, remove extra spaces, punctuation)
		const normalized = questionText
			.toLowerCase()
			.replace(/[?.,!]/g, '')
			.replace(/\s+/g, ' ')
			.trim();

		return crypto.createHash('sha256').update(normalized).digest('hex');
	}

	/**
	 * Increment cache usage count
	 */
	async incrementCacheUsage(questionHash) {
		try {
			const sql = `
        UPDATE ai_response_cache 
        SET usage_count = usage_count + 1
        WHERE question_hash = $1
      `;

			const client = await this.pool.connect();
			await client.query(sql, [questionHash]);
			client.release();
		} catch (error) {
			// Don't throw error for cache usage updates
			console.error('Failed to increment cache usage:', error);
		}
	}
}

/**
 * Validation schema for AI Sifu operations
 */
function validateAIQuestion(question) {
	const questionSchema = Joi.object({
		question: Joi.string().min(5).max(500).required(),
		course_id: Joi.number().integer().positive().allow(null),
	});

	return questionSchema.validate(question);
}

module.exports = {
	AISifuStore,
	validateAIQuestion,
};
