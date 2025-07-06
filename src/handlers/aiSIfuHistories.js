// handlers/ai-conversations.js
require('dotenv').config();
const {
	AIConversationStore,
	validateConversation,
} = require('../models/aiSifuHistory');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * AI Conversation History Handlers - All business logic for conversation history
 */

// ========================
// USER CONVERSATION HANDLERS
// ========================

/**
 * Get user's conversation history
 * GET /users/:userId/ai-conversations?limit=20&offset=0
 */
const getUserConversations = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const limit = parseInt(req.query.limit) || 20;
		const offset = parseInt(req.query.offset) || 0;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new AIConversationStore(req.app.locals.pool);
		const conversations = await store.getUserConversations(
			userId,
			limit,
			offset
		);

		return res.status(200).json(conversations);
	} catch (error) {
		console.error('Get user conversations error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve conversation history' });
	}
};

/**
 * Get single conversation by ID
 * GET /ai-conversations/:id
 */
const getConversation = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new AIConversationStore(req.app.locals.pool);
		const conversation = await store.getConversation(conversationId, userId);

		if (!conversation) {
			return res.status(404).json({ error: 'Conversation not found' });
		}

		return res.status(200).json(conversation);
	} catch (error) {
		console.error('Get conversation error:', error);
		return res.status(500).json({ error: 'Failed to retrieve conversation' });
	}
};

/**
 * Search user's conversations
 * GET /users/:userId/ai-conversations/search?q=searchTerm&limit=20
 */
const searchUserConversations = async (req, res) => {
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

		const store = new AIConversationStore(req.app.locals.pool);
		const conversations = await store.searchUserConversations(
			userId,
			searchTerm,
			limit
		);

		return res.status(200).json(conversations);
	} catch (error) {
		console.error('Search conversations error:', error);
		return res.status(500).json({ error: 'Failed to search conversations' });
	}
};

/**
 * Get conversations by course
 * GET /users/:userId/ai-conversations/course/:courseId?limit=20
 */
const getConversationsByCourse = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const courseId = parseInt(req.params.courseId);
		const limit = parseInt(req.query.limit) || 20;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new AIConversationStore(req.app.locals.pool);
		const conversations = await store.getConversationsByCourse(
			userId,
			courseId,
			limit
		);

		return res.status(200).json(conversations);
	} catch (error) {
		console.error('Get conversations by course error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve course conversations' });
	}
};

/**
 * Delete conversation
 * DELETE /ai-conversations/:id
 */
const deleteConversation = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new AIConversationStore(req.app.locals.pool);
		const conversation = await store.deleteConversation(conversationId, userId);

		if (!conversation) {
			return res.status(404).json({ error: 'Conversation not found' });
		}

		return res.status(200).json({
			message: 'Conversation deleted successfully',
			conversation: conversation,
		});
	} catch (error) {
		console.error('Delete conversation error:', error);
		return res.status(500).json({ error: 'Failed to delete conversation' });
	}
};

/**
 * Get user's conversation statistics
 * GET /users/:userId/ai-conversations/stats
 */
const getUserConversationStats = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const store = new AIConversationStore(req.app.locals.pool);
		const stats = await store.getUserConversationStats(userId);

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get user conversation stats error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to get conversation statistics' });
	}
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * Get all conversations (admin view)
 * GET /admin/ai-conversations?limit=50&offset=0
 */
const getAllConversations = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 50;
		const offset = parseInt(req.query.offset) || 0;

		if (limit > 200) {
			return res.status(400).json({ error: 'Limit cannot exceed 200' });
		}

		const store = new AIConversationStore(req.app.locals.pool);
		const conversations = await store.getAllConversations(limit, offset);

		return res.status(200).json(conversations);
	} catch (error) {
		console.error('Get all conversations error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve all conversations' });
	}
};

/**
 * Get conversation analytics (admin)
 * GET /admin/ai-conversations/analytics
 */
const getConversationAnalytics = async (req, res) => {
	try {
		const store = new AIConversationStore(req.app.locals.pool);
		const analytics = await store.getConversationAnalytics();

		return res.status(200).json(analytics);
	} catch (error) {
		console.error('Get conversation analytics error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to get conversation analytics' });
	}
};

/**
 * Get most active users (admin)
 * GET /admin/ai-conversations/active-users?limit=10
 */
const getMostActiveUsers = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 10;

		if (limit > 50) {
			return res.status(400).json({ error: 'Limit cannot exceed 50' });
		}

		const store = new AIConversationStore(req.app.locals.pool);
		const users = await store.getMostActiveUsers(limit);

		return res.status(200).json(users);
	} catch (error) {
		console.error('Get most active users error:', error);
		return res.status(500).json({ error: 'Failed to get most active users' });
	}
};

/**
 * Clean old conversations (admin)
 * POST /admin/ai-conversations/cleanup
 */
const cleanOldConversations = async (req, res) => {
	try {
		const daysOld = parseInt(req.body.days_old) || 365;

		if (daysOld < 30) {
			return res
				.status(400)
				.json({ error: 'Cannot delete conversations newer than 30 days' });
		}

		const store = new AIConversationStore(req.app.locals.pool);
		const deletedCount = await store.cleanOldConversations(daysOld);

		return res.status(200).json({
			message: 'Old conversations cleaned successfully',
			deleted_count: deletedCount,
			days_threshold: daysOld,
		});
	} catch (error) {
		console.error('Clean old conversations error:', error);
		return res.status(500).json({ error: 'Failed to clean old conversations' });
	}
};

/**
 * Create conversation record (internal use - called from AI Sifu handler)
 * POST /ai-conversations
 */
const saveConversation = async (req, res) => {
	try {
		// Validate conversation data
		const { error } = validateConversation(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new AIConversationStore(req.app.locals.pool);
		const conversation = await store.saveConversation(req.body);

		return res.status(201).json(conversation);
	} catch (error) {
		console.error('Save conversation error:', error);
		return res.status(500).json({ error: 'Failed to save conversation' });
	}
};

/**
 * AI Conversation route handler - manages all conversation history endpoints
 */
const ai_conversations_route = (app) => {
	// User conversation routes
	app.get(
		'/users/:userId/ai-conversations',
		authenticateUserId,
		getUserConversations
	);
	app.get(
		'/users/:userId/ai-conversations/search',
		authenticateUserId,
		searchUserConversations
	);
	app.get(
		'/users/:userId/ai-conversations/course/:courseId',
		authenticateUserId,
		getConversationsByCourse
	);
	app.get(
		'/users/:userId/ai-conversations/stats',
		authenticateUserId,
		getUserConversationStats
	);

	// Individual conversation routes
	app.get('/ai-conversations/:id', authenticationToken, getConversation);
	app.delete('/ai-conversations/:id', authenticationToken, deleteConversation);

	// Internal route for saving conversations (used by AI Sifu)
	app.post('/ai-conversations', authenticationToken, saveConversation);

	// Admin routes
	app.get(
		'/admin/ai-conversations',
		authenticationToken,
		requireAdmin,
		getAllConversations
	);
	app.get(
		'/admin/ai-conversations/analytics',
		authenticationToken,
		requireAdmin,
		getConversationAnalytics
	);
	app.get(
		'/admin/ai-conversations/active-users',
		authenticationToken,
		requireAdmin,
		getMostActiveUsers
	);
	app.post(
		'/admin/ai-conversations/cleanup',
		authenticationToken,
		requireAdmin,
		cleanOldConversations
	);
};

module.exports = ai_conversations_route;
