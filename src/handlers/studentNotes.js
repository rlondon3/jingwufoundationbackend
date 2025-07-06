// handlers/student-notes.js
require('dotenv').config();
const {
	StudentNotesStore,
	validateStudentNote,
} = require('../models/studentNote');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * Student Notes Handlers - All business logic for student notes operations
 */

// ========================
// USER NOTE HANDLERS
// ========================

/**
 * Create new student note
 * POST /student-notes
 */
const createNote = async (req, res) => {
	try {
		const noteData = {
			user_id: req.user.id,
			ai_conversation_id: req.body.ai_conversation_id,
			course_id: req.body.course_id,
			title: req.body.title,
			note_text: req.body.note_text,
		};

		// Validate note data
		const { error } = validateStudentNote(noteData);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new StudentNotesStore(req.app.locals.pool);
		const note = await store.createNote(noteData);

		return res.status(201).json(note);
	} catch (error) {
		console.error('Create note error:', error);
		return res.status(500).json({ error: 'Failed to create note' });
	}
};

/**
 * Get user's notes
 * GET /users/:userId/notes?limit=20&offset=0
 */
const getUserNotes = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const limit = parseInt(req.query.limit) || 20;
		const offset = parseInt(req.query.offset) || 0;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new StudentNotesStore(req.app.locals.pool);
		const notes = await store.getUserNotes(userId, limit, offset);

		return res.status(200).json(notes);
	} catch (error) {
		console.error('Get user notes error:', error);
		return res.status(500).json({ error: 'Failed to retrieve notes' });
	}
};

/**
 * Get notes by course
 * GET /users/:userId/notes/course/:courseId?limit=20
 */
const getNotesByCourse = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const courseId = parseInt(req.params.courseId);
		const limit = parseInt(req.query.limit) || 20;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new StudentNotesStore(req.app.locals.pool);
		const notes = await store.getNotesByCourse(userId, courseId, limit);

		return res.status(200).json(notes);
	} catch (error) {
		console.error('Get notes by course error:', error);
		return res.status(500).json({ error: 'Failed to retrieve course notes' });
	}
};

/**
 * Get single note by ID
 * GET /student-notes/:id
 */
const getNote = async (req, res) => {
	try {
		const noteId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new StudentNotesStore(req.app.locals.pool);
		const note = await store.getNote(noteId, userId);

		if (!note) {
			return res.status(404).json({ error: 'Note not found' });
		}

		return res.status(200).json(note);
	} catch (error) {
		console.error('Get note error:', error);
		return res.status(500).json({ error: 'Failed to retrieve note' });
	}
};

/**
 * Update existing note
 * PUT /student-notes/:id
 */
const updateNote = async (req, res) => {
	try {
		const noteId = parseInt(req.params.id);
		const userId = req.user.id;
		const noteData = {
			title: req.body.title,
			note_text: req.body.note_text,
		};

		// Basic validation
		if (!noteData.note_text || noteData.note_text.trim().length === 0) {
			return res.status(400).json({ error: 'Note text cannot be empty' });
		}

		if (noteData.note_text.length > 5000) {
			return res
				.status(400)
				.json({ error: 'Note text cannot exceed 5000 characters' });
		}

		const store = new StudentNotesStore(req.app.locals.pool);
		const note = await store.updateNote(noteData, noteId, userId);

		if (!note) {
			return res.status(404).json({ error: 'Note not found' });
		}

		return res.status(200).json(note);
	} catch (error) {
		console.error('Update note error:', error);
		return res.status(500).json({ error: 'Failed to update note' });
	}
};

/**
 * Delete note
 * DELETE /student-notes/:id
 */
const deleteNote = async (req, res) => {
	try {
		const noteId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new StudentNotesStore(req.app.locals.pool);
		const note = await store.deleteNote(noteId, userId);

		if (!note) {
			return res.status(404).json({ error: 'Note not found' });
		}

		return res.status(200).json({
			message: 'Note deleted successfully',
			note: note,
		});
	} catch (error) {
		console.error('Delete note error:', error);
		return res.status(500).json({ error: 'Failed to delete note' });
	}
};

/**
 * Search user's notes
 * GET /users/:userId/notes/search?q=searchTerm&limit=20
 */
const searchNotes = async (req, res) => {
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

		const store = new StudentNotesStore(req.app.locals.pool);
		const notes = await store.searchNotes(userId, searchTerm, limit);

		return res.status(200).json(notes);
	} catch (error) {
		console.error('Search notes error:', error);
		return res.status(500).json({ error: 'Failed to search notes' });
	}
};

/**
 * Get notes for specific AI conversation
 * GET /ai-conversations/:conversationId/notes
 */
const getNotesByConversation = async (req, res) => {
	try {
		const conversationId = parseInt(req.params.conversationId);
		const userId = req.user.id;

		const store = new StudentNotesStore(req.app.locals.pool);
		const notes = await store.getNotesByConversation(userId, conversationId);

		return res.status(200).json(notes);
	} catch (error) {
		console.error('Get notes by conversation error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve conversation notes' });
	}
};

/**
 * Get user's note statistics
 * GET /users/:userId/notes/stats
 */
const getUserNotesStats = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const store = new StudentNotesStore(req.app.locals.pool);
		const stats = await store.getUserNotesStats(userId);

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get user notes stats error:', error);
		return res.status(500).json({ error: 'Failed to get notes statistics' });
	}
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * Get all notes (admin view)
 * GET /admin/student-notes?limit=50&offset=0
 */
const getAllNotes = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 50;
		const offset = parseInt(req.query.offset) || 0;

		if (limit > 200) {
			return res.status(400).json({ error: 'Limit cannot exceed 200' });
		}

		const store = new StudentNotesStore(req.app.locals.pool);
		const notes = await store.getAllNotes(limit, offset);

		return res.status(200).json(notes);
	} catch (error) {
		console.error('Get all notes error:', error);
		return res.status(500).json({ error: 'Failed to retrieve all notes' });
	}
};

/**
 * Get notes analytics (admin)
 * GET /admin/student-notes/analytics
 */
const getNotesAnalytics = async (req, res) => {
	try {
		const store = new StudentNotesStore(req.app.locals.pool);
		const analytics = await store.getNotesAnalytics();

		return res.status(200).json(analytics);
	} catch (error) {
		console.error('Get notes analytics error:', error);
		return res.status(500).json({ error: 'Failed to get notes analytics' });
	}
};

/**
 * Get most active note-taking users (admin)
 * GET /admin/student-notes/active-users?limit=10
 */
const getMostActiveNoteUsers = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 10;

		if (limit > 50) {
			return res.status(400).json({ error: 'Limit cannot exceed 50' });
		}

		const store = new StudentNotesStore(req.app.locals.pool);
		const users = await store.getMostActiveNoteUsers(limit);

		return res.status(200).json(users);
	} catch (error) {
		console.error('Get most active note users error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to get most active note users' });
	}
};

/**
 * Student Notes route handler - manages all student notes endpoints
 */
const student_notes_route = (app) => {
	// User note routes
	app.post('/student-notes', authenticationToken, createNote);
	app.get('/users/:userId/notes', authenticateUserId, getUserNotes);
	app.get('/users/:userId/notes/course/:courseId', authenticateUserId, getNotesByCourse);
	app.get('/users/:userId/notes/search', authenticateUserId, searchNotes);
	app.get('/users/:userId/notes/stats', authenticateUserId, getUserNotesStats);

	// Individual note routes
	app.get('/student-notes/:id', authenticationToken, getNote);
	app.put('/student-notes/:id', authenticationToken, updateNote);
	app.delete('/student-notes/:id', authenticationToken, deleteNote);

	// Conversation-related notes
	app.get('/ai-conversations/:conversationId/notes', authenticationToken, getNotesByConversation);

	// Admin routes
	app.get('/admin/student-notes', authenticationToken, requireAdmin, getAllNotes);
	app.get('/admin/student-notes/analytics', authenticationToken, requireAdmin, getNotesAnalytics);
	app.get('/admin/student-notes/active-users', authenticationToken, requireAdmin, getMostActiveNoteUsers);
};

module.exports = student_notes_route;
