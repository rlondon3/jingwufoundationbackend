require('dotenv').config();
const Joi = require('joi');

/**
 * AIConversationStore handles all AI conversation history operations
 * Manages permanent storage of question-answer pairs
 */
class AIConversationStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// CONVERSATION HISTORY OPERATIONS
	// ========================

	/**
	 * Save conversation (question + answer) to permanent history
	 */
	async saveConversation(conversationData) {
		try {
			const sql = `
        INSERT INTO ai_conversation_history 
        (user_id, question_text, response_text, course_context, cost_cents, 
         response_time_ms, cached_response, session_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				conversationData.user_id,
				conversationData.question_text,
				conversationData.response_text,
				conversationData.course_context || null,
				conversationData.cost_cents || 0,
				conversationData.response_time_ms || 0,
				conversationData.cached_response || false,
				conversationData.session_id || null,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not save conversation: ${error}`);
		}
	}

	/**
	 * Get user's conversation history with pagination
	 */
	async getUserConversations(userId, limit = 20, offset = 0) {
		try {
			const sql = `
        SELECT 
          ch.*,
          c.title as course_title,
          c.thumbnail_url as course_thumbnail
        FROM ai_conversation_history ch
        LEFT JOIN courses c ON ch.course_context = c.id
        WHERE ch.user_id = $1
        ORDER BY ch.created_at DESC
        LIMIT $2 OFFSET $3
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, limit, offset]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get user conversations: ${error}`);
		}
	}

	/**
	 * Get conversation by ID (with user verification)
	 */
	async getConversation(conversationId, userId) {
		try {
			const sql = `
        SELECT 
          ch.*,
          c.title as course_title,
          c.description as course_description
        FROM ai_conversation_history ch
        LEFT JOIN courses c ON ch.course_context = c.id
        WHERE ch.id = $1 AND ch.user_id = $2
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [conversationId, userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get conversation: ${error}`);
		}
	}

	/**
	 * Search user's conversation history
	 */
	async searchUserConversations(userId, searchTerm, limit = 20) {
		try {
			const sql = `
        SELECT 
          ch.*,
          c.title as course_title
        FROM ai_conversation_history ch
        LEFT JOIN courses c ON ch.course_context = c.id
        WHERE ch.user_id = $1 
        AND (ch.question_text ILIKE $2 OR ch.response_text ILIKE $2)
        ORDER BY ch.created_at DESC
        LIMIT $3
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, `%${searchTerm}%`, limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not search conversations: ${error}`);
		}
	}

	/**
	 * Get conversations by course context
	 */
	async getConversationsByCourse(userId, courseId, limit = 20) {
		try {
			const sql = `
        SELECT 
          ch.*,
          c.title as course_title
        FROM ai_conversation_history ch
        LEFT JOIN courses c ON ch.course_context = c.id
        WHERE ch.user_id = $1 AND ch.course_context = $2
        ORDER BY ch.created_at DESC
        LIMIT $3
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId, limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get conversations by course: ${error}`);
		}
	}

	/**
	 * Delete conversation (user can delete their own history)
	 */
	async deleteConversation(conversationId, userId) {
		try {
			const sql = `
        DELETE FROM ai_conversation_history 
        WHERE id = $1 AND user_id = $2 
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [conversationId, userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete conversation: ${error}`);
		}
	}

	/**
	 * Get conversation statistics for user
	 */
	async getUserConversationStats(userId) {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_conversations,
          COUNT(DISTINCT course_context) as courses_discussed,
          SUM(cost_cents) as total_cost_cents,
          AVG(response_time_ms) as avg_response_time,
          COUNT(*) FILTER (WHERE cached_response = true) as cached_responses,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as recent_conversations
        FROM ai_conversation_history
        WHERE user_id = $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get conversation stats: ${error}`);
		}
	}

	// ========================
	// ADMIN OPERATIONS
	// ========================

	/**
	 * Get all conversations (admin view)
	 */
	async getAllConversations(limit = 50, offset = 0) {
		try {
			const sql = `
        SELECT 
          ch.*,
          u.name as user_name,
          u.email as user_email,
          c.title as course_title
        FROM ai_conversation_history ch
        LEFT JOIN users u ON ch.user_id = u.id
        LEFT JOIN courses c ON ch.course_context = c.id
        ORDER BY ch.created_at DESC
        LIMIT $1 OFFSET $2
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit, offset]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get all conversations: ${error}`);
		}
	}

	/**
	 * Get conversation analytics (admin)
	 */
	async getConversationAnalytics() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_conversations,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(cost_cents) as total_cost_cents,
          AVG(response_time_ms) as avg_response_time,
          COUNT(*) FILTER (WHERE cached_response = true) as cached_responses,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as monthly_conversations,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as weekly_conversations
        FROM ai_conversation_history
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get conversation analytics: ${error}`);
		}
	}

	/**
	 * Get most active users (admin)
	 */
	async getMostActiveUsers(limit = 10) {
		try {
			const sql = `
        SELECT 
          u.id,
          u.name,
          u.email,
          COUNT(ch.id) as conversation_count,
          SUM(ch.cost_cents) as total_cost,
          MAX(ch.created_at) as last_conversation
        FROM users u
        JOIN ai_conversation_history ch ON u.id = ch.user_id
        GROUP BY u.id, u.name, u.email
        ORDER BY conversation_count DESC
        LIMIT $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get most active users: ${error}`);
		}
	}

	/**
	 * Clean old conversations (admin - for GDPR compliance)
	 */
	async cleanOldConversations(daysOld = 365) {
		try {
			const sql = `
        DELETE FROM ai_conversation_history 
        WHERE created_at < CURRENT_DATE - INTERVAL '$1 days'
        AND user_id NOT IN (
          SELECT DISTINCT user_id FROM stripe_subscriptions 
          WHERE status = 'active'
        )
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [daysOld]);
			client.release();
			return res.rowCount;
		} catch (error) {
			throw new Error(`Could not clean old conversations: ${error}`);
		}
	}

	// ========================
	// BADGE NOTIFICATION METHODS
	// ========================

	/**
	 * Get count of unread conversations for a user
	 */
	async getUnreadConversationCount(userId) {
		try {
			const sql = `
				SELECT COUNT(*) as unread_count
				FROM ai_conversation_history
				WHERE user_id = $1 AND is_viewed = FALSE
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return parseInt(res.rows[0].unread_count) || 0;
		} catch (error) {
			throw new Error(`Could not get unread conversation count: ${error}`);
		}
	}

	/**
	 * Get count of unread notes for a user
	 */
	async getUnreadNotesCount(userId) {
		try {
			const sql = `
				SELECT COUNT(*) as unread_count
				FROM student_notes
				WHERE user_id = $1 AND is_read = FALSE
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return parseInt(res.rows[0].unread_count) || 0;
		} catch (error) {
			throw new Error(`Could not get unread notes count: ${error}`);
		}
	}

	/**
	 * Mark specific conversations as viewed
	 */
	async markConversationsAsViewed(userId, conversationIds) {
		try {
			const sql = `
				UPDATE ai_conversation_history 
				SET is_viewed = TRUE 
				WHERE user_id = $1 AND id = ANY($2::int[])
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, conversationIds]);
			client.release();
			return res.rowCount;
		} catch (error) {
			throw new Error(`Could not mark conversations as viewed: ${error}`);
		}
	}

	/**
	 * Mark all conversations as viewed for a user
	 */
	async markAllConversationsAsViewed(userId) {
		try {
			const sql = `
				UPDATE ai_conversation_history 
				SET is_viewed = TRUE 
				WHERE user_id = $1 AND is_viewed = FALSE
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rowCount;
		} catch (error) {
			throw new Error(`Could not mark all conversations as viewed: ${error}`);
		}
	}

	/**
	 * Mark specific notes as read
	 */
	async markNotesAsRead(userId, noteIds) {
		try {
			const sql = `
				UPDATE student_notes 
				SET is_read = TRUE 
				WHERE user_id = $1 AND id = ANY($2::int[])
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, noteIds]);
			client.release();
			return res.rowCount;
		} catch (error) {
			throw new Error(`Could not mark notes as read: ${error}`);
		}
	}

	/**
	 * Mark all notes as read for a user
	 */
	async markAllNotesAsRead(userId) {
		try {
			const sql = `
				UPDATE student_notes 
				SET is_read = TRUE 
				WHERE user_id = $1 AND is_read = FALSE
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rowCount;
		} catch (error) {
			throw new Error(`Could not mark all notes as read: ${error}`);
		}
	}

	/**
	 * Get conversations with unread status for display (includes badge info)
	 */
	async getUserConversationsWithBadges(userId, limit = 20, offset = 0) {
		try {
			const sql = `
				SELECT 
					id,
					user_id,
					question_text,
					response_text,
					course_context,
					cost_cents,
					response_time_ms,
					cached_response,
					session_id,
					is_viewed,
					created_at,
					c.title as course_title
				FROM ai_conversation_history ach
				LEFT JOIN courses c ON ach.course_context = c.id
				WHERE ach.user_id = $1
				ORDER BY ach.created_at DESC
				LIMIT $2 OFFSET $3
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, limit, offset]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get user conversations with badges: ${error}`);
		}
	}
}

/**
 * Validation schema for conversation data
 */
function validateConversation(conversation) {
	const conversationSchema = Joi.object({
		user_id: Joi.number().integer().positive().required(),
		question_text: Joi.string().min(1).max(2000).required(),
		response_text: Joi.string().min(1).required(),
		course_context: Joi.number().integer().positive().allow(null),
		cost_cents: Joi.number().integer().min(0).default(0),
		response_time_ms: Joi.number().integer().min(0).default(0),
		cached_response: Joi.boolean().default(false),
		session_id: Joi.string().allow(null),
	});

	return conversationSchema.validate(conversation);
}

module.exports = {
	AIConversationStore,
	validateConversation,
};
