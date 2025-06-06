require('dotenv').config();
const Joi = require('joi');

/**
 * MessageStore handles all messaging operations
 * Manages conversations, threaded messages, and read status tracking
 */
class MessageStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// CONVERSATION OPERATIONS
	// ========================

	/**
	 * Get all conversations for a user with latest message preview
	 */
	async getUserConversations(userId) {
		try {
			const sql = `
        SELECT 
          cl.*,
          CASE 
            WHEN cl.user1_id = $1 THEN cl.user2_name
            ELSE cl.user1_name
          END as other_user_name,
          CASE 
            WHEN cl.user1_id = $1 THEN cl.user2_avatar
            ELSE cl.user1_avatar
          END as other_user_avatar,
          CASE 
            WHEN cl.user1_id = $1 THEN cl.user2_id
            ELSE cl.user1_id
          END as other_user_id,
          CASE 
            WHEN cl.user1_id = $1 THEN cl.user1_unread_count
            ELSE cl.user2_unread_count
          END as unread_count
        FROM conversation_list cl
        WHERE cl.user1_id = $1 OR cl.user2_id = $1
        ORDER BY cl.last_message_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user conversations: ${error}`);
		}
	}

	/**
	 * Get or create conversation between two users
	 */
	async getOrCreateConversation(userId1, userId2) {
		try {
			const client = await this.pool.connect();
			const res = await client.query(
				'SELECT get_or_create_conversation($1, $2) as conversation_id',
				[userId1, userId2]
			);
			client.release();
			return res.rows[0].conversation_id;
		} catch (error) {
			throw new Error(`Could not get or create conversation: ${error}`);
		}
	}

	/**
	 * Get conversation details with participant info
	 */
	async getConversation(conversationId, userId) {
		try {
			const sql = `
        SELECT 
          c.*,
          CASE 
            WHEN c.user1_id = $2 THEN u2.name
            ELSE u1.name
          END as other_user_name,
          CASE 
            WHEN c.user1_id = $2 THEN u2.avatar
            ELSE u1.avatar
          END as other_user_avatar,
          CASE 
            WHEN c.user1_id = $2 THEN u2.id
            ELSE u1.id
          END as other_user_id
        FROM conversations c
        JOIN users u1 ON c.user1_id = u1.id
        JOIN users u2 ON c.user2_id = u2.id
        WHERE c.id = $1 AND ($2 = c.user1_id OR $2 = c.user2_id)
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [conversationId, userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find conversation: ${error}`);
		}
	}

	// ========================
	// MESSAGE OPERATIONS
	// ========================

	/**
	 * Get all messages in a conversation (chronological, most recent first)
	 */
	async getConversationMessages(
		conversationId,
		userId,
		limit = 50,
		offset = 0
	) {
		try {
			// First verify user has access to this conversation
			const accessSql = `
        SELECT id FROM conversations 
        WHERE id = $1 AND ($2 = user1_id OR $2 = user2_id)
      `;

			const client = await this.pool.connect();
			const accessRes = await client.query(accessSql, [conversationId, userId]);

			if (accessRes.rows.length === 0) {
				client.release();
				throw new Error('Access denied to conversation');
			}

			// Get messages
			const sql = `
        SELECT 
          m.*,
          u.name as sender_name,
          u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = $1
        ORDER BY m.sent_at DESC
        LIMIT $2 OFFSET $3
      `;

			const res = await client.query(sql, [conversationId, limit, offset]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve conversation messages: ${error}`);
		}
	}

	/**
	 * Send new message
	 */
	async sendMessage(senderId, recipientId, text) {
		try {
			const client = await this.pool.connect();

			// Get or create conversation
			const conversationId = await this.getOrCreateConversation(
				senderId,
				recipientId
			);

			// Insert message
			const sql = `
        INSERT INTO messages (conversation_id, sender_id, text, message_status, sent_at)
        VALUES ($1, $2, $3, 'sent', CURRENT_TIMESTAMP) RETURNING *
      `;

			const res = await client.query(sql, [conversationId, senderId, text]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not send message: ${error}`);
		}
	}

	/**
	 * Mark message as read
	 */
	async markMessageRead(messageId, userId) {
		try {
			// Only allow marking messages as read if user is the recipient (not sender)
			const sql = `
        UPDATE messages SET 
          message_status = 'read',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 
        AND sender_id != $2
        AND message_status = 'sent'
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [messageId, userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not mark message as read: ${error}`);
		}
	}

	/**
	 * Mark all messages in conversation as read (for recipient)
	 */
	async markConversationRead(conversationId, userId) {
		try {
			const sql = `
        UPDATE messages SET 
          message_status = 'read',
          updated_at = CURRENT_TIMESTAMP
        WHERE conversation_id = $1 
        AND sender_id != $2
        AND message_status = 'sent'
        RETURNING COUNT(*) as marked_count
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [conversationId, userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not mark conversation as read: ${error}`);
		}
	}

	/**
	 * Delete message (soft delete - just mark as deleted)
	 */
	async deleteMessage(messageId, userId) {
		try {
			// Only allow sender to delete their own messages
			const sql = `
        UPDATE messages SET 
          text = '[Message deleted]',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND sender_id = $2
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [messageId, userId]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Message not found or access denied');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete message: ${error}`);
		}
	}

	// ========================
	// UTILITY METHODS
	// ========================

	/**
	 * Get unread message count for user
	 */
	async getUnreadCount(userId) {
		try {
			const sql = `
        SELECT COUNT(*) as unread_count
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE (c.user1_id = $1 OR c.user2_id = $1)
        AND m.sender_id != $1
        AND m.message_status = 'sent'
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return parseInt(res.rows[0].unread_count);
		} catch (error) {
			throw new Error(`Could not get unread count: ${error}`);
		}
	}

	/**
	 * Get recent messages for user (across all conversations)
	 */
	async getRecentMessages(userId, limit = 10) {
		try {
			const sql = `
        SELECT 
          m.*,
          u.name as sender_name,
          u.avatar as sender_avatar,
          CASE 
            WHEN c.user1_id = $1 THEN u2.name
            ELSE u1.name
          END as other_user_name
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        JOIN users u ON m.sender_id = u.id
        JOIN users u1 ON c.user1_id = u1.id
        JOIN users u2 ON c.user2_id = u2.id
        WHERE (c.user1_id = $1 OR c.user2_id = $1)
        ORDER BY m.sent_at DESC
        LIMIT $2
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get recent messages: ${error}`);
		}
	}

	/**
	 * Search messages by text content
	 */
	async searchMessages(userId, searchTerm, limit = 20) {
		try {
			const sql = `
        SELECT 
          m.*,
          u.name as sender_name,
          c.id as conversation_id
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        JOIN users u ON m.sender_id = u.id
        WHERE (c.user1_id = $1 OR c.user2_id = $1)
        AND m.text ILIKE $2
        AND m.text != '[Message deleted]'
        ORDER BY m.sent_at DESC
        LIMIT $3
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, `%${searchTerm}%`, limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not search messages: ${error}`);
		}
	}

	// ========================
	// ADMIN OPERATIONS
	// ========================

	/**
	 * Get all conversations (admin view)
	 */
	async getAllConversations() {
		try {
			const sql = `
        SELECT * FROM conversation_list
        ORDER BY last_message_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve all conversations: ${error}`);
		}
	}

	/**
	 * Get message statistics
	 */
	async getMessageStats() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_messages,
          COUNT(DISTINCT conversation_id) as total_conversations,
          COUNT(*) FILTER (WHERE message_status = 'sent') as unread_messages,
          COUNT(*) FILTER (WHERE message_status = 'read') as read_messages,
          COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE - INTERVAL '24 hours') as messages_last_24h
        FROM messages
        WHERE text != '[Message deleted]'
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get message statistics: ${error}`);
		}
	}
}

/**
 * Validation schemas for message data
 */
function validateMessage(message) {
	const messageSchema = Joi.object({
		sender_id: Joi.number().integer().positive().required(),
		recipient_id: Joi.number().integer().positive().required(),
		text: Joi.string().min(1).max(2000).required(),
	});

	return messageSchema.validate(message);
}

function validateConversation(conversation) {
	const conversationSchema = Joi.object({
		user1_id: Joi.number().integer().positive().required(),
		user2_id: Joi.number()
			.integer()
			.positive()
			.required()
			.invalid(Joi.ref('user1_id')),
	});

	return conversationSchema.validate(conversation);
}

module.exports = {
	MessageStore,
	validateMessage,
	validateConversation,
};
