require('dotenv').config();
const Joi = require('joi');

/**
 * GuidedFeedbackStore handles all guided feedback operations
 * Manages questions, triggers, and responses tied to course progress
 */
class GuidedFeedbackStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// QUESTION MANAGEMENT
	// ========================

	/**
	 * Get active questions for a course (latest version)
	 */
	async getCourseQuestions(courseId) {
		try {
			const sql = `
				SELECT * FROM course_feedback_questions 
				WHERE course_id = $1 AND is_active = true
				ORDER BY display_order ASC
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [courseId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve course questions: ${error}`);
		}
	}

	/**
	 * Create new question for course
	 */
	async createQuestion(questionData) {
		try {
			const sql = `
				INSERT INTO course_feedback_questions 
				(course_id, question_text, question_type, is_required, display_order, version)
				VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				questionData.course_id,
				questionData.question_text,
				questionData.question_type,
				questionData.is_required || false,
				questionData.display_order,
				questionData.version || 1,
			]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create question: ${error}`);
		}
	}

	/**
	 * Update question (creates new version)
	 */
	async updateQuestion(questionId, questionData) {
		let client;
		try {
			client = await this.pool.connect();
			await client.query('BEGIN');

			// Get current question to copy course_id and increment version
			const currentRes = await client.query(
				'SELECT * FROM course_feedback_questions WHERE id = $1',
				[questionId]
			);

			if (currentRes.rows.length === 0) {
				throw new Error('Question not found');
			}

			const current = currentRes.rows[0];

			// Deactivate old version
			await client.query(
				'UPDATE course_feedback_questions SET is_active = false WHERE id = $1',
				[questionId]
			);

			// Create new version
			const newVersionSql = `
				INSERT INTO course_feedback_questions 
				(course_id, question_text, question_type, is_required, display_order, version)
				VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
			`;

			const newRes = await client.query(newVersionSql, [
				current.course_id,
				questionData.question_text || current.question_text,
				questionData.question_type || current.question_type,
				questionData.is_required !== undefined
					? questionData.is_required
					: current.is_required,
				questionData.display_order !== undefined
					? questionData.display_order
					: current.display_order,
				current.version + 1,
			]);

			await client.query('COMMIT');
			client.release();
			return newRes.rows[0];
		} catch (error) {
			if (client) {
				await client.query('ROLLBACK');
				client.release();
			}
			throw new Error(`Could not update question: ${error}`);
		}
	}

	/**
	 * Delete question (deactivate)
	 */
	async deleteQuestion(questionId) {
		try {
			const sql = `
				UPDATE course_feedback_questions 
				SET is_active = false, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [questionId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete question: ${error}`);
		}
	}

	// ========================
	// TRIGGER MANAGEMENT
	// ========================

	/**
	 * Get active triggers for a course
	 */
	async getCourseTriggers(courseId) {
		try {
			const sql = `
				SELECT * FROM course_feedback_triggers 
				WHERE course_id = $1 AND is_active = true
				ORDER BY trigger_percentage ASC
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [courseId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve course triggers: ${error}`);
		}
	}

	/**
	 * Create feedback trigger
	 */
	async createTrigger(triggerData) {
		try {
			const sql = `
				INSERT INTO course_feedback_triggers 
				(course_id, trigger_percentage, is_blocking)
				VALUES ($1, $2, $3) RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				triggerData.course_id,
				triggerData.trigger_percentage,
				triggerData.is_blocking || false,
			]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create trigger: ${error}`);
		}
	}

	/**
	 * Update trigger
	 */
	async updateTrigger(triggerId, triggerData) {
		try {
			const sql = `
				UPDATE course_feedback_triggers 
				SET trigger_percentage = $1, is_blocking = $2, updated_at = CURRENT_TIMESTAMP
				WHERE id = $3 RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				triggerData.trigger_percentage,
				triggerData.is_blocking,
				triggerId,
			]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update trigger: ${error}`);
		}
	}

	/**
	 * Delete trigger
	 */
	async deleteTrigger(triggerId) {
		try {
			const sql = `
				UPDATE course_feedback_triggers 
				SET is_active = false, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [triggerId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete trigger: ${error}`);
		}
	}

	// ========================
	// FEEDBACK RESPONSES
	// ========================

	/**
	 * Check if user should be prompted for feedback
	 */
	async shouldTriggerFeedback(userId, courseId, currentProgress) {
		try {
			console.log(`[GUIDED FEEDBACK DEBUG] shouldTriggerFeedback called - User: ${userId}, Course: ${courseId}, Progress: ${currentProgress}%`);
			
			const sql = `
				SELECT t.*, 
					CASE WHEN r.id IS NULL THEN true ELSE false END as needs_feedback
				FROM course_feedback_triggers t
				LEFT JOIN reviews r ON r.user_id = $1 AND r.course_id = $2 
					AND r.is_guided_feedback = true AND r.triggered_at_percentage = t.trigger_percentage
				WHERE t.course_id = $2 AND t.is_active = true 
					AND t.trigger_percentage <= $3
				ORDER BY t.trigger_percentage DESC
				LIMIT 1
			`;

			console.log(`[GUIDED FEEDBACK DEBUG] SQL Query:`, sql);
			console.log(`[GUIDED FEEDBACK DEBUG] Query params:`, [userId, courseId, currentProgress]);

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId, currentProgress]);
			client.release();

			console.log(`[GUIDED FEEDBACK DEBUG] Query returned ${res.rows.length} rows:`, res.rows);

			if (res.rows.length > 0) {
				const trigger = res.rows[0];
				console.log(`[GUIDED FEEDBACK DEBUG] Found trigger:`, trigger);
				console.log(`[GUIDED FEEDBACK DEBUG] needs_feedback:`, trigger.needs_feedback);
				
				if (trigger.needs_feedback) {
					console.log(`[GUIDED FEEDBACK DEBUG] Returning trigger for feedback`);
					return trigger;
				} else {
					console.log(`[GUIDED FEEDBACK DEBUG] User already provided feedback for this trigger percentage`);
				}
			} else {
				console.log(`[GUIDED FEEDBACK DEBUG] No active triggers found for this progress level`);
			}
			
			return null;
		} catch (error) {
			console.error(`[GUIDED FEEDBACK DEBUG] Error in shouldTriggerFeedback:`, error);
			throw new Error(`Could not check feedback trigger: ${error}`);
		}
	}

	/**
	 * Create guided feedback review and get questions
	 */
	async initiateFeedback(userId, courseId, triggerPercentage) {
		let client;
		try {
			console.log(`[GUIDED FEEDBACK DEBUG] initiateFeedback model method called - User: ${userId}, Course: ${courseId}, Trigger: ${triggerPercentage}%`);
			
			client = await this.pool.connect();
			await client.query('BEGIN');

			// Create guided feedback review
			// Note: We provide a placeholder rating of 1 for guided feedback reviews 
			// since they're created before the user provides their actual rating
			// The rating will be updated when the user completes the feedback
			const reviewSql = `
				INSERT INTO reviews (user_id, course_id, rating, is_guided_feedback, triggered_at_percentage)
				VALUES ($1, $2, $3, true, $4) RETURNING *
			`;
			console.log(`[GUIDED FEEDBACK DEBUG] Inserting review with SQL:`, reviewSql);
			console.log(`[GUIDED FEEDBACK DEBUG] Review params:`, [userId, courseId, 1, triggerPercentage]);
			
			const reviewRes = await client.query(reviewSql, [
				userId,
				courseId,
				1, // Placeholder rating (1-5 required) - will be updated by user
				triggerPercentage,
			]);
			const review = reviewRes.rows[0];
			console.log(`[GUIDED FEEDBACK DEBUG] Review created:`, review);

			// Get questions for this course
			const questionsSql = `
				SELECT * FROM course_feedback_questions 
				WHERE course_id = $1 AND is_active = true
				ORDER BY display_order ASC
			`;
			console.log(`[GUIDED FEEDBACK DEBUG] Getting questions with SQL:`, questionsSql);
			console.log(`[GUIDED FEEDBACK DEBUG] Questions params:`, [courseId]);
			
			const questionsRes = await client.query(questionsSql, [courseId]);
			console.log(`[GUIDED FEEDBACK DEBUG] Found ${questionsRes.rows.length} questions:`, questionsRes.rows);

			await client.query('COMMIT');
			client.release();

			const result = {
				review: review,
				questions: questionsRes.rows,
			};
			console.log(`[GUIDED FEEDBACK DEBUG] Returning feedback result:`, result);
			return result;
		} catch (error) {
			console.error(`[GUIDED FEEDBACK DEBUG] Error in initiateFeedback model:`, error);
			console.error(`[GUIDED FEEDBACK DEBUG] Error details:`, {
				message: error.message,
				code: error.code,
				detail: error.detail,
				table: error.table,
				column: error.column,
				constraint: error.constraint
			});
			if (client) {
				try {
					await client.query('ROLLBACK');
					client.release();
				} catch (rollbackError) {
					console.error(`[GUIDED FEEDBACK DEBUG] Rollback error:`, rollbackError);
				}
			}
			throw error; // Throw original error instead of wrapping it
		}
	}

	/**
	 * Submit feedback responses
	 */
	async submitFeedbackResponses(reviewId, responses, rating) {
		let client;
		try {
			client = await this.pool.connect();
			await client.query('BEGIN');

			// Get review and user info
			const reviewRes = await client.query(
				'SELECT user_id, course_id FROM reviews WHERE id = $1',
				[reviewId]
			);

			if (reviewRes.rows.length === 0) {
				throw new Error('Review not found');
			}

			const { user_id, course_id } = reviewRes.rows[0];

			// Insert responses
			for (const response of responses) {
				const responseSql = `
					INSERT INTO course_feedback_responses 
					(review_id, question_id, user_id, response_text, response_boolean, question_version)
					VALUES ($1, $2, $3, $4, $5, $6)
				`;

				// Get question version
				const questionRes = await client.query(
					'SELECT version FROM course_feedback_questions WHERE id = $1',
					[response.question_id]
				);

				await client.query(responseSql, [
					reviewId,
					response.question_id,
					user_id,
					response.response_text || null,
					response.response_boolean !== undefined
						? response.response_boolean
						: null,
					questionRes.rows[0].version,
				]);
			}

			// Update review with actual rating if provided
			if (rating !== undefined) {
				await client.query(
					'UPDATE reviews SET rating = $1, feedback_completed_at = CURRENT_TIMESTAMP WHERE id = $2',
					[rating, reviewId]
				);
			} else {
				// Mark feedback as completed without updating rating
				await client.query(
					'UPDATE reviews SET feedback_completed_at = CURRENT_TIMESTAMP WHERE id = $1',
					[reviewId]
				);
			}

			await client.query('COMMIT');
			client.release();
			return true;
		} catch (error) {
			if (client) {
				await client.query('ROLLBACK');
				client.release();
			}
			throw new Error(`Could not submit feedback responses: ${error}`);
		}
	}

	/**
	 * Get user's feedback responses for a review
	 */
	async getFeedbackResponses(reviewId) {
		try {
			const sql = `
				SELECT 
					r.*,
					q.question_text,
					q.question_type,
					q.display_order
				FROM course_feedback_responses r
				JOIN course_feedback_questions q ON r.question_id = q.id
				WHERE r.review_id = $1
				ORDER BY q.display_order ASC
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [reviewId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get feedback responses: ${error}`);
		}
	}

	/**
	 * Check if user has completed required feedback to continue
	 */
	async canUserProgress(userId, courseId, currentProgress) {
		try {
			const sql = `
				SELECT t.trigger_percentage, t.is_blocking,
					CASE WHEN r.feedback_completed_at IS NOT NULL THEN true ELSE false END as completed
				FROM course_feedback_triggers t
				LEFT JOIN reviews r ON r.user_id = $1 AND r.course_id = $2 
					AND r.is_guided_feedback = true AND r.triggered_at_percentage = t.trigger_percentage
					AND r.feedback_completed_at IS NOT NULL
				WHERE t.course_id = $2 AND t.is_active = true AND t.is_blocking = true
					AND t.trigger_percentage <= $3
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId, currentProgress]);
			client.release();

			// If any blocking trigger hasn't been completed, block progress
			for (const trigger of res.rows) {
				if (!trigger.completed) {
					return false;
				}
			}
			return true;
		} catch (error) {
			throw new Error(`Could not check if user can progress: ${error}`);
		}
	}

	// ========================
	// ANALYTICS
	// ========================

	/**
	 * Get aggregated responses for a course
	 */
	async getCourseResponseAnalytics(courseId) {
		try {
			const sql = `
				SELECT 
					q.id as question_id,
					q.question_text,
					q.question_type,
					COUNT(r.id) as total_responses,
					CASE 
						WHEN q.question_type = 'yes_no' THEN
							json_build_object(
								'yes', COUNT(r.id) FILTER (WHERE r.response_boolean = true),
								'no', COUNT(r.id) FILTER (WHERE r.response_boolean = false),
								'yes_percentage', ROUND((COUNT(r.id) FILTER (WHERE r.response_boolean = true) * 100.0 / NULLIF(COUNT(r.id), 0)), 1)
							)
						ELSE null
					END as boolean_stats,
					CASE 
						WHEN q.question_type = 'text' THEN
							array_agg(r.response_text ORDER BY r.created_at DESC) FILTER (WHERE r.response_text IS NOT NULL)
						ELSE null
					END as text_responses
				FROM course_feedback_questions q
				LEFT JOIN course_feedback_responses r ON q.id = r.question_id
				LEFT JOIN reviews rev ON r.review_id = rev.id
				WHERE q.course_id = $1 AND q.is_active = true
				GROUP BY q.id, q.question_text, q.question_type, q.display_order
				ORDER BY q.display_order ASC
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [courseId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get response analytics: ${error}`);
		}
	}
}

/**
 * Validation schemas
 */
function validateQuestion(questionData) {
	const questionSchema = Joi.object({
		course_id: Joi.number().integer().positive().required(),
		question_text: Joi.string().min(1).max(1000).required(),
		question_type: Joi.string().valid('text', 'yes_no').required(),
		is_required: Joi.boolean().default(false),
		display_order: Joi.number().integer().min(1).required(),
		version: Joi.number().integer().min(1).default(1),
	});

	return questionSchema.validate(questionData);
}

function validateTrigger(triggerData) {
	const triggerSchema = Joi.object({
		course_id: Joi.number().integer().positive().required(),
		trigger_percentage: Joi.number().integer().min(0).max(100).required(),
		is_blocking: Joi.boolean().default(false),
	});

	return triggerSchema.validate(triggerData);
}

function validateResponse(responseData) {
	const responseSchema = Joi.object({
		question_id: Joi.number().integer().positive().required(),
		response_text: Joi.string().max(2000).allow('', null),
		response_boolean: Joi.boolean().allow(null),
	}).xor('response_text', 'response_boolean'); // Must have one or the other

	return responseSchema.validate(responseData);
}

module.exports = {
	GuidedFeedbackStore,
	validateQuestion,
	validateTrigger,
	validateResponse,
};
