// handlers/messages.js
require('dotenv').config();
const {
	MessageStore,
	validateMessage,
	validateConversation,
} = require('../models/message');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * Message Handlers - All business logic for messaging operations
 */

// ========================
// CONVERSATION HANDLERS
// ========================

/**
 * Get user's conversations
 * GET /users/:userId/conversations
 */
const getUserConversations = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const store = new MessageStore(req.app.locals.pool);
		const rawConversations = await store.getUserConversations(userId);

		// Format conversations for frontend
		const conversations = rawConversations.map((conv) => ({
			id: conv.conversation_id,
			user1_id: conv.user1_id,
			user2_id: conv.user2_id,
			created_at: conv.created_at,
			updated_at: conv.updated_at,
			last_message: conv.latest_message
				? {
						id: 0, // We don't have message ID in the view
						text: conv.latest_message,
						sender_id: conv.latest_sender_id,
						sent_at: conv.last_message_at,
						is_read: conv.latest_message_status === 'read',
				  }
				: null,
			other_user: {
				id: conv.other_user_id,
				name: conv.other_user_name,
				avatar: conv.other_user_avatar,
			},
			unread_count: conv.unread_count || 0,
		}));

		return res.status(200).json(conversations);
	} catch (error) {
		console.error('Get user conversations error:', error);
		return res.status(500).json({ error: 'Failed to retrieve conversations' });
	}
};

/**
 * Get or create conversation between two users
 * POST /conversations
 */
const getOrCreateConversation = async (req, res) => {
	try {
		const { user1_id, user2_id } = req.body;

		// Validate conversation data
		const { error } = validateConversation({ user1_id, user2_id });
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new MessageStore(req.app.locals.pool);
		const conversationId = await store.getOrCreateConversation(
			user1_id,
			user2_id
		);

		return res.status(200).json({ conversation_id: conversationId });
	} catch (error) {
		console.error('Get or create conversation error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to get or create conversation' });
	}
};

/**
 * Get conversation details
 * GET /conversations/:id
 */
const getConversation = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const conversation = await store.getConversation(conversationId, userId);

		if (!conversation) {
			return res
				.status(404)
				.json({ error: 'Conversation not found or access denied' });
		}

		return res.status(200).json(conversation);
	} catch (error) {
		console.error('Get conversation error:', error);
		return res.status(500).json({ error: 'Failed to retrieve conversation' });
	}
};

// ========================
// MESSAGE HANDLERS
// ========================

/**
 * Get messages in a conversation
 * GET /conversations/:id/messages?limit=50&offset=0
 */
const getConversationMessages = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id);
		const userId = req.user.id;
		const limit = parseInt(req.query.limit) || 50;
		const offset = parseInt(req.query.offset) || 0;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new MessageStore(req.app.locals.pool);
		const messages = await store.getConversationMessages(
			conversationId,
			userId,
			limit,
			offset
		);

		return res.status(200).json(messages);
	} catch (error) {
		console.error('Get conversation messages error:', error);
		return res.status(500).json({ error: 'Failed to retrieve messages' });
	}
};

/**
 * Send new message
 * POST /messages
 */
const sendMessage = async (req, res) => {
	try {
		const messageData = {
			sender_id: req.user.id,
			recipient_id: req.body.recipient_id,
			text: req.body.text,
		};

		// Validate message data
		const { error } = validateMessage(messageData);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new MessageStore(req.app.locals.pool);
		const message = await store.sendMessage(
			messageData.sender_id,
			messageData.recipient_id,
			messageData.text
		);

		return res.status(201).json(message);
	} catch (error) {
		console.error('Send message error:', error);
		return res.status(500).json({ error: 'Failed to send message' });
	}
};

/**
 * Mark message as read
 * PUT /messages/:id/read
 */
const markMessageRead = async (req, res) => {
	try {
		const messageId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const message = await store.markMessageRead(messageId, userId);

		if (!message) {
			return res
				.status(404)
				.json({ error: 'Message not found or already read' });
		}

		return res.status(200).json(message);
	} catch (error) {
		console.error('Mark message read error:', error);
		return res.status(500).json({ error: 'Failed to mark message as read' });
	}
};

/**
 * Mark all messages in conversation as read
 * PUT /conversations/:id/read
 */
const markConversationRead = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const result = await store.markConversationRead(conversationId, userId);

		return res.status(200).json(result);
	} catch (error) {
		console.error('Mark conversation read error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to mark conversation as read' });
	}
};

// ========================
// MESSAGE DELETION HANDLERS
// ========================

/**
 * Delete message for current user only (hide from their view)
 * DELETE /messages/:id/delete-for-me
 */
const deleteMessageForUser = async (req, res) => {
	try {
		const messageId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const result = await store.deleteMessageForUser(messageId, userId);

		if (!result) {
			return res
				.status(404)
				.json({ error: 'Message not found or already deleted' });
		}

		return res.status(200).json({
			message: 'Message hidden from your view',
			deleted_for_user: result,
		});
	} catch (error) {
		console.error('Delete message for user error:', error);
		return res.status(500).json({ error: 'Failed to delete message for user' });
	}
};

/**
 * Restore deleted message for current user
 * POST /messages/:id/restore
 */
const restoreMessageForUser = async (req, res) => {
	try {
		const messageId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const result = await store.restoreMessageForUser(messageId, userId);

		if (!result) {
			return res
				.status(404)
				.json({ error: 'Message not found in deleted items' });
		}

		return res.status(200).json({
			message: 'Message restored to your view',
			restored: result,
		});
	} catch (error) {
		console.error('Restore message for user error:', error);
		return res.status(500).json({ error: 'Failed to restore message' });
	}
};

/**
 * Delete message globally (sender only - original functionality)
 * DELETE /messages/:id
 */
const deleteMessage = async (req, res) => {
	try {
		const messageId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const message = await store.deleteMessage(messageId, userId);

		return res.status(200).json({
			message: 'Message deleted for everyone',
			deleted_message: message,
		});
	} catch (error) {
		console.error('Delete message error:', error);
		return res.status(500).json({ error: 'Failed to delete message' });
	}
};

/**
 * Delete conversation for current user only (hide from their view)
 * DELETE /conversations/:id/delete-for-me
 */
const deleteConversationForUser = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const result = await store.deleteConversationForUser(
			conversationId,
			userId
		);

		return res.status(200).json({
			message: 'Conversation hidden from your view',
			deleted_count: result.deleted_count,
		});
	} catch (error) {
		console.error('Delete conversation for user error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to delete conversation for user' });
	}
};

/**
 * Delete conversation globally (original functionality)
 * DELETE /conversations/:id
 */
const deleteConversation = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new MessageStore(req.app.locals.pool);
		const result = await store.deleteConversation(conversationId, userId);

		return res.status(200).json({
			message: 'Conversation deleted for everyone',
			deleted_count: result.deleted_count,
		});
	} catch (error) {
		console.error('Delete conversation error:', error);
		return res.status(500).json({ error: 'Failed to delete conversation' });
	}
};

/**
 * Get user's deleted messages (for recovery)
 * GET /users/:userId/messages/deleted
 */
const getUserDeletedMessages = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const limit = parseInt(req.query.limit) || 50;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new MessageStore(req.app.locals.pool);
		const messages = await store.getUserDeletedMessages(userId, limit);

		return res.status(200).json(messages);
	} catch (error) {
		console.error('Get user deleted messages error:', error);
		return res.status(500).json({ error: 'Failed to get deleted messages' });
	}
};

// ========================
// UTILITY HANDLERS
// ========================

/**
 * Get unread message count for user
 * GET /users/:userId/messages/unread-count
 */
const getUnreadCount = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const store = new MessageStore(req.app.locals.pool);
		const count = await store.getUnreadCount(userId);

		return res.status(200).json({ unread_count: count });
	} catch (error) {
		console.error('Get unread count error:', error);
		return res.status(500).json({ error: 'Failed to get unread count' });
	}
};

/**
 * Get recent messages for user
 * GET /users/:userId/messages/recent?limit=10
 */
const getRecentMessages = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const limit = parseInt(req.query.limit) || 10;

		if (limit > 50) {
			return res.status(400).json({ error: 'Limit cannot exceed 50' });
		}

		const store = new MessageStore(req.app.locals.pool);
		const messages = await store.getRecentMessages(userId, limit);

		return res.status(200).json(messages);
	} catch (error) {
		console.error('Get recent messages error:', error);
		return res.status(500).json({ error: 'Failed to get recent messages' });
	}
};

/**
 * Search messages
 * GET /users/:userId/messages/search?q=searchTerm&limit=20
 */
const searchMessages = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const searchTerm = req.query.q;
		const limit = parseInt(req.query.limit) || 20;

		if (!searchTerm) {
			return res.status(400).json({ error: 'Search term is required' });
		}

		if (searchTerm.length < 2) {
			return res
				.status(400)
				.json({ error: 'Search term must be at least 2 characters' });
		}

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new MessageStore(req.app.locals.pool);
		const messages = await store.searchMessages(userId, searchTerm, limit);

		return res.status(200).json(messages);
	} catch (error) {
		console.error('Search messages error:', error);
		return res.status(500).json({ error: 'Failed to search messages' });
	}
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * Get all conversations (admin view)
 * GET /admin/conversations
 */
const getAllConversations = async (req, res) => {
	try {
		const store = new MessageStore(req.app.locals.pool);
		const conversations = await store.getAllConversations();

		return res.status(200).json(conversations);
	} catch (error) {
		console.error('Get all conversations error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve all conversations' });
	}
};

/**
 * Get message statistics
 * GET /admin/messages/stats
 */
const getMessageStats = async (req, res) => {
	try {
		const store = new MessageStore(req.app.locals.pool);
		const stats = await store.getMessageStats();

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get message stats error:', error);
		return res.status(500).json({ error: 'Failed to get message statistics' });
	}
};

/**
 * Message route handler - manages all messaging-related endpoints
 */
const messages_route = (app) => {
	// User conversation routes
	app.get(
		'/users/:userId/conversations',
		authenticateUserId,
		getUserConversations
	);
	app.get(
		'/users/:userId/messages/unread-count',
		authenticateUserId,
		getUnreadCount
	);
	app.get(
		'/users/:userId/messages/recent',
		authenticateUserId,
		getRecentMessages
	);
	app.get('/users/:userId/messages/search', authenticateUserId, searchMessages);

	// User deleted messages
	app.get(
		'/users/:userId/messages/deleted',
		authenticateUserId,
		getUserDeletedMessages
	);

	// Conversation routes
	app.post('/conversations', authenticationToken, getOrCreateConversation);
	app.get('/conversations/:id', authenticationToken, getConversation);
	app.get(
		'/conversations/:id/messages',
		authenticationToken,
		getConversationMessages
	);
	app.put('/conversations/:id/read', authenticationToken, markConversationRead);

	// Conversation deletion routes
	app.delete('/conversations/:id', authenticationToken, deleteConversation); // Global delete
	app.delete(
		'/conversations/:id/delete-for-me',
		authenticationToken,
		deleteConversationForUser
	); // Per-user delete

	// Message routes
	app.post('/messages', authenticationToken, sendMessage);
	app.put('/messages/:id/read', authenticationToken, markMessageRead);

	// Message deletion routes
	app.delete('/messages/:id', authenticationToken, deleteMessage); // Global delete (sender only)
	app.delete(
		'/messages/:id/delete-for-me',
		authenticationToken,
		deleteMessageForUser
	); // Per-user delete
	app.post('/messages/:id/restore', authenticationToken, restoreMessageForUser); // Restore deleted message

	// Admin routes
	app.get(
		'/admin/conversations',
		authenticationToken,
		requireAdmin,
		getAllConversations
	);
	app.get(
		'/admin/messages/stats',
		authenticationToken,
		requireAdmin,
		getMessageStats
	);
};

module.exports = messages_route;
