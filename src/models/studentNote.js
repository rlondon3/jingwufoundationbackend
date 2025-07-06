require('dotenv').config();
const Joi = require('joi');

/**
 * StudentNotesStore handles all student notes operations
 * Manages notes linked to AI conversations and courses
 */
class StudentNotesStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// STUDENT NOTES OPERATIONS
	// ========================

	/**
	 * Create new student note
	 */
	async createNote(note) {
		try {
			const sql = `
        INSERT INTO student_notes (user_id, ai_conversation_id, course_id, title, note_text)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				note.user_id,
				note.ai_conversation_id,
				note.course_id,
				note.title || null,
				note.note_text,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create note: ${error}`);
		}
	}

	/**
	 * Get user's notes with pagination
	 */
	async getUserNotes(userId, limit = 20, offset = 0) {
		try {
			const sql = `
        SELECT 
          sn.*,
          c.title as course_title,
          ch.question_text,
          ch.created_at as conversation_date
        FROM student_notes sn
        JOIN courses c ON sn.course_id = c.id
        LEFT JOIN ai_conversation_history ch ON sn.ai_conversation_id = ch.id
        WHERE sn.user_id = $1
        ORDER BY sn.created_at DESC
        LIMIT $2 OFFSET $3
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, limit, offset]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get user notes: ${error}`);
		}
	}

	/**
	 * Get notes by course
	 */
	async getNotesByCourse(userId, courseId, limit = 20) {
		try {
			const sql = `
        SELECT 
          sn.*,
          c.title as course_title,
          ch.question_text,
          ch.created_at as conversation_date
        FROM student_notes sn
        JOIN courses c ON sn.course_id = c.id
        LEFT JOIN ai_conversation_history ch ON sn.ai_conversation_id = ch.id
        WHERE sn.user_id = $1 AND sn.course_id = $2
        ORDER BY sn.created_at DESC
        LIMIT $3
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId, limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get notes by course: ${error}`);
		}
	}

	/**
	 * Get single note by ID
	 */
	async getNote(noteId, userId) {
		try {
			const sql = `
        SELECT 
          sn.*,
          c.title as course_title,
          ch.question_text,
          ch.response_text,
          ch.created_at as conversation_date
        FROM student_notes sn
        JOIN courses c ON sn.course_id = c.id
        LEFT JOIN ai_conversation_history ch ON sn.ai_conversation_id = ch.id
        WHERE sn.id = $1 AND sn.user_id = $2
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [noteId, userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get note: ${error}`);
		}
	}

	/**
	 * Update existing note
	 */
	async updateNote(note, noteId, userId) {
		try {
			const sql = `
        UPDATE student_notes SET 
          title = $1, note_text = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND user_id = $4
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				note.title,
				note.note_text,
				noteId,
				userId,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update note: ${error}`);
		}
	}

	/**
	 * Delete note
	 */
	async deleteNote(noteId, userId) {
		try {
			const sql =
				'DELETE FROM student_notes WHERE id = $1 AND user_id = $2 RETURNING *';

			const client = await this.pool.connect();
			const res = await client.query(sql, [noteId, userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete note: ${error}`);
		}
	}

	/**
	 * Search user's notes
	 */
	async searchNotes(userId, searchTerm, limit = 20) {
		try {
			const sql = `
        SELECT 
          sn.*,
          c.title as course_title,
          ch.question_text,
          ch.created_at as conversation_date
        FROM student_notes sn
        JOIN courses c ON sn.course_id = c.id
        LEFT JOIN ai_conversation_history ch ON sn.ai_conversation_id = ch.id
        WHERE sn.user_id = $1 
        AND (sn.title ILIKE $2 OR sn.note_text ILIKE $2)
        ORDER BY sn.created_at DESC
        LIMIT $3
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, `%${searchTerm}%`, limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not search notes: ${error}`);
		}
	}

	/**
	 * Get notes for specific AI conversation
	 */
	async getNotesByConversation(userId, conversationId) {
		try {
			const sql = `
        SELECT 
          sn.*,
          c.title as course_title
        FROM student_notes sn
        JOIN courses c ON sn.course_id = c.id
        WHERE sn.user_id = $1 AND sn.ai_conversation_id = $2
        ORDER BY sn.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, conversationId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get notes by conversation: ${error}`);
		}
	}

	/**
	 * Get user's note statistics
	 */
	async getUserNotesStats(userId) {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_notes,
          COUNT(DISTINCT course_id) as courses_with_notes,
          COUNT(DISTINCT ai_conversation_id) as conversations_with_notes,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as recent_notes
        FROM student_notes
        WHERE user_id = $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get notes stats: ${error}`);
		}
	}

	// ========================
	// ADMIN OPERATIONS
	// ========================

	/**
	 * Get all notes (admin view)
	 */
	async getAllNotes(limit = 50, offset = 0) {
		try {
			const sql = `
        SELECT 
          sn.*,
          u.name as user_name,
          u.email as user_email,
          c.title as course_title
        FROM student_notes sn
        JOIN users u ON sn.user_id = u.id
        JOIN courses c ON sn.course_id = c.id
        ORDER BY sn.created_at DESC
        LIMIT $1 OFFSET $2
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit, offset]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get all notes: ${error}`);
		}
	}

	/**
	 * Get notes analytics (admin)
	 */
	async getNotesAnalytics() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_notes,
          COUNT(DISTINCT user_id) as users_with_notes,
          COUNT(DISTINCT course_id) as courses_with_notes,
          AVG(LENGTH(note_text)) as avg_note_length,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as monthly_notes,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as weekly_notes
        FROM student_notes
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get notes analytics: ${error}`);
		}
	}

	/**
	 * Get most active note-taking users (admin)
	 */
	async getMostActiveNoteUsers(limit = 10) {
		try {
			const sql = `
        SELECT 
          u.id,
          u.name,
          u.email,
          COUNT(sn.id) as note_count,
          COUNT(DISTINCT sn.course_id) as courses_noted,
          MAX(sn.created_at) as last_note_date
        FROM users u
        JOIN student_notes sn ON u.id = sn.user_id
        GROUP BY u.id, u.name, u.email
        ORDER BY note_count DESC
        LIMIT $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get most active note users: ${error}`);
		}
	}
}

/**
 * Validation schema for student notes
 */
function validateStudentNote(note) {
	const noteSchema = Joi.object({
		user_id: Joi.number().integer().positive().required(),
		ai_conversation_id: Joi.number().integer().positive().required(),
		course_id: Joi.number().integer().positive().required(),
		title: Joi.string().max(200).allow('', null),
		note_text: Joi.string().min(1).max(5000).required(),
	});

	return noteSchema.validate(note);
}

module.exports = {
	StudentNotesStore,
	validateStudentNote,
};
