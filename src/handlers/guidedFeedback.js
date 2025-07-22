// handlers/guided-feedback.js
require('dotenv').config();
const {
	GuidedFeedbackStore,
	validateQuestion,
	validateTrigger,
	validateResponse,
} = require('../models/guidedFeedback');
const { authenticationToken, requireAdmin } = require('../middleware/auth');

/**
 * Guided Feedback Handlers - All business logic for guided feedback operations
 */

// ========================
// STUDENT FEEDBACK HANDLERS
// ========================

/**
 * Check if user should be prompted for feedback
 * GET /courses/:courseId/feedback/check?progress=40
 */
const checkFeedbackTrigger = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const currentProgress = parseInt(req.query.progress);
		const userId = req.user.id;

		if (!currentProgress || currentProgress < 0 || currentProgress > 100) {
			return res
				.status(400)
				.json({ error: 'Valid progress percentage required (0-100)' });
		}

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const trigger = await store.shouldTriggerFeedback(
			userId,
			courseId,
			currentProgress
		);

		return res.status(200).json({
			should_trigger: !!trigger,
			trigger: trigger,
		});
	} catch (error) {
		console.error('Check feedback trigger error:', error);
		return res.status(500).json({ error: 'Failed to check feedback trigger' });
	}
};

/**
 * Initiate guided feedback session
 * POST /courses/:courseId/feedback/initiate
 */
const initiateFeedback = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const { trigger_percentage } = req.body;
		const userId = req.user.id;

		if (
			!trigger_percentage ||
			trigger_percentage < 0 ||
			trigger_percentage > 100
		) {
			return res
				.status(400)
				.json({ error: 'Valid trigger percentage required' });
		}


		const store = new GuidedFeedbackStore(req.app.locals.pool);
		
		const feedback = await store.initiateFeedback(
			userId,
			courseId,
			trigger_percentage
		);

		return res.status(201).json({
			message: 'Feedback session initiated',
			review_id: feedback.review_id,
			questions: feedback.questions,
		});
	} catch (error) {
		console.error('Initiate feedback error:', error);
		return res.status(500).json({ error: 'Failed to initiate feedback' });
	}
};

/**
 * Submit feedback responses
 * POST /feedback/:reviewId/responses
 */
const submitFeedbackResponses = async (req, res) => {
	try {
		const reviewId = parseInt(req.params.reviewId);
		const { responses, rating } = req.body;

		if (!Array.isArray(responses) || responses.length === 0) {
			return res.status(400).json({ error: 'Responses array required' });
		}

		// Validate rating if provided
		if (rating !== undefined && (rating < 1 || rating > 5)) {
			return res.status(400).json({ error: 'Rating must be between 1 and 5' });
		}

		// Validate each response
		for (const response of responses) {
			const { error } = validateResponse(response);
			if (error) {
				return res
					.status(400)
					.json({ error: `Invalid response: ${error.details[0].message}` });
			}
		}

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		await store.submitFeedbackResponses(reviewId, responses, rating);

		return res.status(200).json({
			message: 'Feedback responses submitted successfully',
		});
	} catch (error) {
		console.error('Submit feedback responses error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to submit feedback responses' });
	}
};

/**
 * Get user's feedback responses
 * GET /feedback/:reviewId/responses
 */
const getFeedbackResponses = async (req, res) => {
	try {
		const reviewId = parseInt(req.params.reviewId);

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const responses = await store.getFeedbackResponses(reviewId);

		return res.status(200).json(responses);
	} catch (error) {
		console.error('Get feedback responses error:', error);
		return res.status(500).json({ error: 'Failed to get feedback responses' });
	}
};

/**
 * Check if user can progress in course
 * GET /courses/:courseId/progress/check?progress=80
 */
const checkCanProgress = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const currentProgress = parseInt(req.query.progress);
		const userId = req.user.id;

		if (!currentProgress || currentProgress < 0 || currentProgress > 100) {
			return res
				.status(400)
				.json({ error: 'Valid progress percentage required (0-100)' });
		}

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const canProgress = await store.canUserProgress(
			userId,
			courseId,
			currentProgress
		);

		return res.status(200).json({
			can_progress: canProgress,
			message: canProgress
				? 'User can continue'
				: 'Required feedback must be completed before proceeding',
		});
	} catch (error) {
		console.error('Check can progress error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to check progress permissions' });
	}
};

/**
 * Check if feedback should be triggered for user at current progress
 * GET /courses/:courseId/feedback/should-trigger?progress=50
 */
const shouldTriggerFeedback = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const currentProgress = parseInt(req.query.progress);
		const userId = req.user.id;

		if (!currentProgress || currentProgress < 0 || currentProgress > 100) {
			return res
				.status(400)
				.json({ error: 'Valid progress percentage required (0-100)' });
		}

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const trigger = await store.shouldTriggerFeedback(
			userId,
			courseId,
			currentProgress
		);

		return res.status(200).json(trigger);
	} catch (error) {
		console.error('Should trigger feedback error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to check feedback trigger' });
	}
};

// ========================
// ADMIN QUESTION MANAGEMENT
// ========================

/**
 * Get course questions (admin)
 * GET /admin/courses/:courseId/feedback/questions
 */
const getCourseQuestions = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const questions = await store.getCourseQuestions(courseId);

		return res.status(200).json(questions);
	} catch (error) {
		console.error('Get course questions error:', error);
		return res.status(500).json({ error: 'Failed to get course questions' });
	}
};

/**
 * Create new question (admin)
 * POST /admin/courses/:courseId/feedback/questions
 */
const createQuestion = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const questionData = {
			course_id: courseId,
			question_text: req.body.question_text,
			question_type: req.body.question_type,
			is_required: req.body.is_required,
			display_order: req.body.display_order,
			version: req.body.version,
		};

		const { error } = validateQuestion(questionData);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const question = await store.createQuestion(questionData);

		return res.status(201).json({
			message: 'Question created successfully',
			question: question,
		});
	} catch (error) {
		console.error('Create question error:', error);
		return res.status(500).json({ error: 'Failed to create question' });
	}
};

/**
 * Update question (creates new version) (admin)
 * PUT /admin/feedback/questions/:id
 */
const updateQuestion = async (req, res) => {
	try {
		const questionId = parseInt(req.params.id);
		const questionData = {
			question_text: req.body.question_text,
			question_type: req.body.question_type,
			is_required: req.body.is_required,
			display_order: req.body.display_order,
		};

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const question = await store.updateQuestion(questionId, questionData);

		return res.status(200).json({
			message: 'Question updated successfully (new version created)',
			question: question,
		});
	} catch (error) {
		console.error('Update question error:', error);
		if (error.message.includes('not found')) {
			return res.status(404).json({ error: 'Question not found' });
		}
		return res.status(500).json({ error: 'Failed to update question' });
	}
};

/**
 * Delete question (admin)
 * DELETE /admin/feedback/questions/:id
 */
const deleteQuestion = async (req, res) => {
	try {
		const questionId = parseInt(req.params.id);

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const question = await store.deleteQuestion(questionId);

		if (!question) {
			return res.status(404).json({ error: 'Question not found' });
		}

		return res.status(200).json({
			message: 'Question deleted successfully',
			question: question,
		});
	} catch (error) {
		console.error('Delete question error:', error);
		return res.status(500).json({ error: 'Failed to delete question' });
	}
};

// ========================
// ADMIN TRIGGER MANAGEMENT
// ========================

/**
 * Get course triggers (admin)
 * GET /admin/courses/:courseId/feedback/triggers
 */
const getCourseTriggers = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const triggers = await store.getCourseTriggers(courseId);

		return res.status(200).json(triggers);
	} catch (error) {
		console.error('Get course triggers error:', error);
		return res.status(500).json({ error: 'Failed to get course triggers' });
	}
};

/**
 * Create trigger (admin)
 * POST /admin/courses/:courseId/feedback/triggers
 */
const createTrigger = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const triggerData = {
			course_id: courseId,
			trigger_percentage: req.body.trigger_percentage,
			is_blocking: req.body.is_blocking,
		};

		const { error } = validateTrigger(triggerData);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const trigger = await store.createTrigger(triggerData);

		return res.status(201).json({
			message: 'Trigger created successfully',
			trigger: trigger,
		});
	} catch (error) {
		console.error('Create trigger error:', error);
		if (error.message.includes('unique_course_trigger_percentage')) {
			return res
				.status(400)
				.json({ error: 'Trigger percentage already exists for this course' });
		}
		return res.status(500).json({ error: 'Failed to create trigger' });
	}
};

/**
 * Update trigger (admin)
 * PUT /admin/feedback/triggers/:id
 */
const updateTrigger = async (req, res) => {
	try {
		const triggerId = parseInt(req.params.id);
		const triggerData = {
			trigger_percentage: req.body.trigger_percentage,
			is_blocking: req.body.is_blocking,
		};

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const trigger = await store.updateTrigger(triggerId, triggerData);

		if (!trigger) {
			return res.status(404).json({ error: 'Trigger not found' });
		}

		return res.status(200).json({
			message: 'Trigger updated successfully',
			trigger: trigger,
		});
	} catch (error) {
		console.error('Update trigger error:', error);
		return res.status(500).json({ error: 'Failed to update trigger' });
	}
};

/**
 * Delete trigger (admin)
 * DELETE /admin/feedback/triggers/:id
 */
const deleteTrigger = async (req, res) => {
	try {
		const triggerId = parseInt(req.params.id);

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const trigger = await store.deleteTrigger(triggerId);

		if (!trigger) {
			return res.status(404).json({ error: 'Trigger not found' });
		}

		return res.status(200).json({
			message: 'Trigger deleted successfully',
			trigger: trigger,
		});
	} catch (error) {
		console.error('Delete trigger error:', error);
		return res.status(500).json({ error: 'Failed to delete trigger' });
	}
};

// ========================
// ADMIN ANALYTICS
// ========================

/**
 * Get course response analytics (admin)
 * GET /admin/courses/:courseId/feedback/analytics
 */
const getCourseResponseAnalytics = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);

		const store = new GuidedFeedbackStore(req.app.locals.pool);
		const analytics = await store.getCourseResponseAnalytics(courseId);

		return res.status(200).json(analytics);
	} catch (error) {
		console.error('Get course response analytics error:', error);
		return res.status(500).json({ error: 'Failed to get response analytics' });
	}
};

/**
 * Guided Feedback route handler - manages all guided feedback endpoints
 */
const guided_feedback_route = (app) => {
	// Student feedback routes (authentication required)
	app.get(
		'/courses/:courseId/feedback/check',
		authenticationToken,
		checkFeedbackTrigger
	);
	app.post(
		'/courses/:courseId/feedback/initiate',
		authenticationToken,
		initiateFeedback
	);
	app.post(
		'/feedback/:reviewId/responses',
		authenticationToken,
		submitFeedbackResponses
	);
	app.get(
		'/feedback/:reviewId/responses',
		authenticationToken,
		getFeedbackResponses
	);
	app.get(
		'/courses/:courseId/progress/check',
		authenticationToken,
		checkCanProgress
	);
	app.get(
		'/courses/:courseId/feedback/should-trigger',
		authenticationToken,
		shouldTriggerFeedback
	);

	// Admin question management routes
	app.get(
		'/admin/courses/:courseId/feedback/questions',
		authenticationToken,
		requireAdmin,
		getCourseQuestions
	);
	app.post(
		'/admin/courses/:courseId/feedback/questions',
		authenticationToken,
		requireAdmin,
		createQuestion
	);
	app.put(
		'/admin/feedback/questions/:id',
		authenticationToken,
		requireAdmin,
		updateQuestion
	);
	app.delete(
		'/admin/feedback/questions/:id',
		authenticationToken,
		requireAdmin,
		deleteQuestion
	);

	// Admin trigger management routes
	app.get(
		'/admin/courses/:courseId/feedback/triggers',
		authenticationToken,
		requireAdmin,
		getCourseTriggers
	);
	app.post(
		'/admin/courses/:courseId/feedback/triggers',
		authenticationToken,
		requireAdmin,
		createTrigger
	);
	app.put(
		'/admin/feedback/triggers/:id',
		authenticationToken,
		requireAdmin,
		updateTrigger
	);
	app.delete(
		'/admin/feedback/triggers/:id',
		authenticationToken,
		requireAdmin,
		deleteTrigger
	);

	// Admin analytics routes
	app.get(
		'/admin/courses/:courseId/feedback/analytics',
		authenticationToken,
		requireAdmin,
		getCourseResponseAnalytics
	);
};

module.exports = guided_feedback_route;
