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

			// Get system settings
			const settings = await this.getAiSifuSettings();
			
			// Check if AI Sifu is globally enabled
			if (!settings.enabled) {
				client.release();
				return {
					canAsk: false,
					reason: 'ai_sifu_disabled',
					message: 'AI Sifu is currently disabled by administrator'
				};
			}

			// Get user info and preferences
			const userSql = 'SELECT is_admin FROM users WHERE id = $1';
			const userRes = await client.query(userSql, [userId]);

			if (userRes.rows.length === 0) {
				client.release();
				throw new Error('User not found');
			}

			const user = userRes.rows[0];
			const userPrefs = await this.getUserPreferences(userId);

			// Check if user has AI Sifu enabled in their preferences
			if (!userPrefs.ai_sifu_enabled) {
				client.release();
				return {
					canAsk: false,
					reason: 'user_disabled',
					message: 'AI Sifu is disabled in your preferences'
				};
			}

			// Admin has unlimited access
			if (user.is_admin) {
				client.release();
				return { canAsk: true, reason: 'admin_unlimited' };
			}

			// Get usage data
			const usage = await this.getUserUsage(userId);

			// Check if user has active AI Sifu subscription
			const subscriptionSql = `
				SELECT status, current_period_end, current_period_start 
				FROM subscriptions 
				WHERE user_id = $1 
				AND subscription_type = 'ai_sifu' 
				AND status = 'active'
				AND current_period_end > NOW()
				LIMIT 1
			`;
			const subRes = await client.query(subscriptionSql, [userId]);
			
			if (subRes.rows.length > 0) {
				// User has active AI Sifu subscription
				if (usage.subscription_usage >= settings.subscriber_limit) {
					client.release();
					return {
						canAsk: false,
						reason: 'subscription_limit_reached',
						limit: settings.subscriber_limit,
						used: usage.subscription_usage,
						courseId
					};
				}
				client.release();
				return { canAsk: true, reason: 'subscription_access', courseId };
			}

			// Check global free questions (priority for all users)
			const globalUsage = usage.global_free_usage || 0;
			console.log(`Checking global free access for user ${userId}: used=${globalUsage}, limit=${settings.global_free_limit}`);
			if (globalUsage < settings.global_free_limit) {
				console.log(`Granting global_free_access to user ${userId}`);
				client.release();
				return { 
					canAsk: true, 
					reason: 'global_free_access',
					remaining: settings.global_free_limit - globalUsage,
					limit: settings.global_free_limit,
					used: globalUsage
				};
			}

			client.release();
			return {
				canAsk: false,
				reason: 'no_questions_remaining',
				message: 'You have used all your free questions. Subscribe to AI Sifu or purchase a course to continue.',
				global_free_used: globalUsage,
				global_free_limit: settings.global_free_limit
			};
		} catch (error) {
			throw new Error(`Could not check user access: ${error}`);
		}
	}

	/**
	 * Record AI question usage
	 */
	async recordUsage(userId, costCents, courseId = null, accessReason = null) {
		try {
			const currentPeriod = this.getCurrentPeriod();
			const client = await this.pool.connect();

			// Debug logging to track usage recording
			console.log(`Recording usage for user ${userId}: accessReason=${accessReason}, courseId=${courseId}, costCents=${costCents}`);

			// Determine which usage counter to increment based on access reason
			if (accessReason === 'global_free_access') {
				// Increment global free usage
				console.log(`Incrementing global_free_usage for user ${userId}`);
				const sql = `
					UPDATE ai_usage_tracking 
					SET global_free_usage = global_free_usage + 1, total_cost_cents = total_cost_cents + $1, updated_at = CURRENT_TIMESTAMP
					WHERE user_id = $2 AND period_start = $3
					RETURNING *
				`;

				const res = await client.query(sql, [costCents, userId, currentPeriod]);
				console.log(`Global free usage updated. New global_free_usage: ${res.rows[0]?.global_free_usage}`);
				client.release();
				return res.rows[0];

			} else if (accessReason === 'subscription_access' || accessReason === 'admin_unlimited') {
				// Increment subscription usage
				const sql = `
					UPDATE ai_usage_tracking 
					SET subscription_usage = subscription_usage + 1, total_cost_cents = total_cost_cents + $1, updated_at = CURRENT_TIMESTAMP
					WHERE user_id = $2 AND period_start = $3
					RETURNING *
				`;

				const res = await client.query(sql, [costCents, userId, currentPeriod]);
				client.release();
				return res.rows[0];

			} else {
				// Unknown access reason - log error and don't increment any counter
				console.error(`Unknown access reason: ${accessReason} for user ${userId}. Not recording usage.`);
				client.release();
				throw new Error(`Unknown access reason: ${accessReason}`);
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
        INSERT INTO ai_usage_tracking (user_id, period_start, course_purchases_usage, subscription_usage, global_free_usage, total_cost_cents)
        VALUES ($1, $2, '{}', 0, 0, 0)
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

	// ========================
	// SYSTEM SETTINGS OPERATIONS
	// ========================

	/**
	 * Get system setting value
	 */
	async getSystemSetting(key, defaultValue = null) {
		try {
			const sql = `SELECT setting_value FROM system_settings WHERE setting_key = $1`;
			
			const client = await this.pool.connect();
			const res = await client.query(sql, [key]);
			client.release();

			if (res.rows.length > 0) {
				const value = res.rows[0].setting_value;
				// Try to parse as number, boolean, or return as string
				if (value === 'true') return true;
				if (value === 'false') return false;
				if (!isNaN(value) && !isNaN(parseFloat(value))) return parseFloat(value);
				return value;
			}

			return defaultValue;
		} catch (error) {
			console.error(`Failed to get system setting ${key}:`, error);
			return defaultValue;
		}
	}

	/**
	 * Set system setting value
	 */
	async setSystemSetting(key, value, description = null) {
		try {
			const sql = `
				INSERT INTO system_settings (setting_key, setting_value, description, updated_at)
				VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
				ON CONFLICT (setting_key) 
				DO UPDATE SET 
					setting_value = EXCLUDED.setting_value,
					description = COALESCE(EXCLUDED.description, system_settings.description),
					updated_at = CURRENT_TIMESTAMP
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [key, String(value), description]);
			client.release();

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not set system setting: ${error}`);
		}
	}

	/**
	 * Get all AI Sifu system settings
	 */
	async getAiSifuSettings() {
		try {
			const settings = {};
			settings.enabled = await this.getSystemSetting('ai_sifu_enabled', true);
			settings.global_free_limit = await this.getSystemSetting('global_free_questions_limit', 3);
			settings.course_limit = await this.getSystemSetting('course_questions_limit', 10);
			settings.subscriber_limit = await this.getSystemSetting('subscriber_questions_limit', 12);
			settings.price_cents = await this.getSystemSetting('ai_sifu_price_cents', 1000);

			return settings;
		} catch (error) {
			throw new Error(`Could not get AI Sifu settings: ${error}`);
		}
	}

	// ========================
	// USER PREFERENCES OPERATIONS
	// ========================

	/**
	 * Get user preferences
	 */
	async getUserPreferences(userId) {
		try {
			const sql = `
				SELECT * FROM user_preferences WHERE user_id = $1
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();

			if (res.rows.length > 0) {
				return res.rows[0];
			}

			// Return defaults if no preferences exist
			return {
				user_id: userId,
				ai_sifu_enabled: true,
				email_notifications: true
			};
		} catch (error) {
			throw new Error(`Could not get user preferences: ${error}`);
		}
	}

	/**
	 * Set user preferences
	 */
	async setUserPreferences(userId, preferences) {
		try {
			const sql = `
				INSERT INTO user_preferences (user_id, ai_sifu_enabled, email_notifications, updated_at)
				VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
				ON CONFLICT (user_id) 
				DO UPDATE SET 
					ai_sifu_enabled = EXCLUDED.ai_sifu_enabled,
					email_notifications = EXCLUDED.email_notifications,
					updated_at = CURRENT_TIMESTAMP
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				userId,
				preferences.ai_sifu_enabled !== undefined ? preferences.ai_sifu_enabled : true,
				preferences.email_notifications !== undefined ? preferences.email_notifications : true
			]);
			client.release();

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not set user preferences: ${error}`);
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
