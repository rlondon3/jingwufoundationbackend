// handlers/reviews.js
require('dotenv').config();
const {
	ReviewStore,
	validateReview,
	validateCourseRequest,
} = require('../models/review');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * Review Handlers - All business logic for reviews and course requests
 */

// ========================
// PUBLIC REVIEW HANDLERS
// ========================

/**
 * Get all reviews for a course
 * GET /courses/:courseId/reviews
 */
const getCourseReviews = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const store = new ReviewStore(req.app.locals.pool);
		const reviews = await store.getCourseReviews(courseId);
		return res.status(200).json(reviews);
	} catch (error) {
		console.error('Get course reviews error:', error);
		return res.status(500).json({ error: 'Failed to retrieve course reviews' });
	}
};

/**
 * Get course rating summary
 * GET /courses/:courseId/rating-summary
 */
const getCourseRatingSummary = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const store = new ReviewStore(req.app.locals.pool);
		const summary = await store.getCourseRatingSummary(courseId);
		return res.status(200).json(summary);
	} catch (error) {
		console.error('Get course rating summary error:', error);
		return res.status(500).json({ error: 'Failed to retrieve rating summary' });
	}
};

/**
 * Get most requested courses
 * GET /course-requests/popular
 */
const getMostRequestedCourses = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 10;
		const store = new ReviewStore(req.app.locals.pool);
		const requests = await store.getMostRequestedCourses(limit);
		return res.status(200).json(requests);
	} catch (error) {
		console.error('Get most requested courses error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve popular course requests' });
	}
};

// ========================
// USER REVIEW HANDLERS
// ========================

/**
 * Get user's reviews
 * GET /users/:userId/reviews
 */
const getUserReviews = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const store = new ReviewStore(req.app.locals.pool);
		const reviews = await store.getUserReviews(userId);
		return res.status(200).json(reviews);
	} catch (error) {
		console.error('Get user reviews error:', error);
		return res.status(500).json({ error: 'Failed to retrieve user reviews' });
	}
};

/**
 * Get user's specific review for a course
 * GET /users/:userId/courses/:courseId/review
 */
const getUserCourseReview = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const courseId = parseInt(req.params.courseId);
		const store = new ReviewStore(req.app.locals.pool);
		const review = await store.getUserCourseReview(userId, courseId);
		return res.status(200).json(review);
	} catch (error) {
		console.error('Get user course review error:', error);
		return res.status(500).json({ error: 'Failed to retrieve user course review' });
	}
};

/**
 * Create new review
 * POST /reviews
 */
const createReview = async (req, res) => {
	try {
		const reviewData = {
			user_id: req.user.id,
			course_id: req.body.course_id,
			rating: req.body.rating,
			review_text: req.body.review_text,
			is_verified: req.body.is_verified,
			is_published: req.body.is_published,
		};

		// Validate review data
		const { error } = validateReview(reviewData);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new ReviewStore(req.app.locals.pool);

		// Check if user has already reviewed this course
		const hasReviewed = await store.hasUserReviewed(
			reviewData.user_id,
			reviewData.course_id
		);
		if (hasReviewed) {
			return res
				.status(400)
				.json({ error: 'You have already reviewed this course' });
		}

		const review = await store.createReview(reviewData);
		return res.status(201).json(review);
	} catch (error) {
		console.error('Create review error:', error);
		return res.status(500).json({ error: 'Failed to create review' });
	}
};

/**
 * Update existing review
 * PUT /reviews/:id
 */
const updateReview = async (req, res) => {
	try {
		const reviewId = parseInt(req.params.id);
		const reviewData = {
			rating: req.body.rating,
			review_text: req.body.review_text,
			is_published: req.body.is_published,
		};

		// Validate review data
		const { error } = validateReview({
			...reviewData,
			user_id: 1,
			course_id: 1,
		}); // Dummy validation
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new ReviewStore(req.app.locals.pool);
		const review = await store.updateReview(reviewData, reviewId);

		if (!review) {
			return res.status(404).json({ error: 'Review not found' });
		}

		return res.status(200).json(review);
	} catch (error) {
		console.error('Update review error:', error);
		return res.status(500).json({ error: 'Failed to update review' });
	}
};

/**
 * Delete review
 * DELETE /reviews/:id
 */
const deleteReview = async (req, res) => {
	try {
		const reviewId = parseInt(req.params.id);
		const store = new ReviewStore(req.app.locals.pool);
		const review = await store.deleteReview(reviewId);

		if (!review) {
			return res.status(404).json({ error: 'Review not found' });
		}

		return res.status(200).json({
			message: 'Review deleted successfully',
			review: review,
		});
	} catch (error) {
		console.error('Delete review error:', error);
		return res.status(500).json({ error: 'Failed to delete review' });
	}
};

/**
 * Mark review as helpful
 * POST /reviews/:id/helpful
 */
const markReviewHelpful = async (req, res) => {
	try {
		const reviewId = parseInt(req.params.id);
		const store = new ReviewStore(req.app.locals.pool);
		const review = await store.markReviewHelpful(reviewId);

		if (!review) {
			return res.status(404).json({ error: 'Review not found' });
		}

		return res.status(200).json(review);
	} catch (error) {
		console.error('Mark review helpful error:', error);
		return res.status(500).json({ error: 'Failed to mark review as helpful' });
	}
};

// ========================
// COURSE REQUEST HANDLERS
// ========================

/**
 * Get user's course requests
 * GET /users/:userId/course-requests
 */
const getUserCourseRequests = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const store = new ReviewStore(req.app.locals.pool);
		const requests = await store.getUserCourseRequests(userId);
		return res.status(200).json(requests);
	} catch (error) {
		console.error('Get user course requests error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve course requests' });
	}
};

/**
 * Create new course request
 * POST /course-requests
 */
const createCourseRequest = async (req, res) => {
	try {
		const requestData = {
			user_id: req.user.id,
			requested_course_title: req.body.requested_course_title,
			request_description: req.body.request_description,
			request_priority: req.body.request_priority,
		};

		// Validate request data
		const { error } = validateCourseRequest(requestData);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new ReviewStore(req.app.locals.pool);
		const request = await store.createCourseRequest(requestData);
		return res.status(201).json(request);
	} catch (error) {
		console.error('Create course request error:', error);
		return res.status(500).json({ error: 'Failed to create course request' });
	}
};

/**
 * Delete course request (user can delete their own)
 * DELETE /course-requests/:id
 */
const deleteCourseRequest = async (req, res) => {
	try {
		const requestId = parseInt(req.params.id);
		const store = new ReviewStore(req.app.locals.pool);
		const request = await store.deleteCourseRequest(requestId);

		if (!request) {
			return res.status(404).json({ error: 'Course request not found' });
		}

		return res.status(200).json({
			message: 'Course request deleted successfully',
			request: request,
		});
	} catch (error) {
		console.error('Delete course request error:', error);
		return res.status(500).json({ error: 'Failed to delete course request' });
	}
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * Get all reviews (admin view)
 * GET /admin/reviews
 */
const getAllReviews = async (req, res) => {
	try {
		const store = new ReviewStore(req.app.locals.pool);
		const reviews = await store.getAllReviews();
		return res.status(200).json(reviews);
	} catch (error) {
		console.error('Get all reviews error:', error);
		return res.status(500).json({ error: 'Failed to retrieve all reviews' });
	}
};

/**
 * Get all course requests (admin view)
 * GET /admin/course-requests?status=pending
 */
const getAllCourseRequests = async (req, res) => {
	try {
		const status = req.query.status || null;
		const store = new ReviewStore(req.app.locals.pool);
		const requests = await store.getCourseRequests(status);
		return res.status(200).json(requests);
	} catch (error) {
		console.error('Get all course requests error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve course requests' });
	}
};

/**
 * Update course request status (admin only)
 * PUT /admin/course-requests/:id/status
 */
const updateCourseRequestStatus = async (req, res) => {
	try {
		const requestId = parseInt(req.params.id);
		const { status, admin_notes } = req.body;
		const adminId = req.user.id;

		if (!['pending', 'approved', 'rejected', 'completed'].includes(status)) {
			return res.status(400).json({ error: 'Invalid status' });
		}

		const store = new ReviewStore(req.app.locals.pool);
		const request = await store.updateCourseRequestStatus(
			requestId,
			status,
			adminId,
			admin_notes
		);

		if (!request) {
			return res.status(404).json({ error: 'Course request not found' });
		}

		return res.status(200).json(request);
	} catch (error) {
		console.error('Update course request status error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to update course request status' });
	}
};

/**
 * Get review and request statistics
 * GET /admin/reviews/stats
 */
const getStats = async (req, res) => {
	try {
		const store = new ReviewStore(req.app.locals.pool);
		const stats = await store.getStats();
		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get review stats error:', error);
		return res.status(500).json({ error: 'Failed to get statistics' });
	}
};

/**
 * Review route handler - manages all review and course request endpoints
 */
const reviews_route = (app) => {
	// Public routes (no authentication required)
	app.get('/courses/:courseId/reviews', getCourseReviews);
	app.get('/courses/:courseId/rating-summary', getCourseRatingSummary);
	app.get('/course-requests/popular', getMostRequestedCourses);

	// User review routes (authentication required)
	app.get('/users/:userId/reviews', authenticateUserId, getUserReviews);
	app.get('/users/:userId/courses/:courseId/review', authenticateUserId, getUserCourseReview);
	app.post('/reviews', authenticationToken, createReview);
	app.put('/reviews/:id', authenticationToken, updateReview);
	app.delete('/reviews/:id', authenticationToken, deleteReview);
	app.post('/reviews/:id/helpful', authenticationToken, markReviewHelpful);

	// User course request routes (authentication required)
	app.get(
		'/users/:userId/course-requests',
		authenticateUserId,
		getUserCourseRequests
	);
	app.post('/course-requests', authenticationToken, createCourseRequest);
	app.delete('/course-requests/:id', authenticationToken, deleteCourseRequest);

	// Admin routes (admin authentication required)
	app.get('/admin/reviews', authenticationToken, requireAdmin, getAllReviews);
	app.get(
		'/admin/course-requests',
		authenticationToken,
		requireAdmin,
		getAllCourseRequests
	);
	app.put(
		'/admin/course-requests/:id/status',
		authenticationToken,
		requireAdmin,
		updateCourseRequestStatus
	);
	app.get('/admin/reviews/stats', authenticationToken, requireAdmin, getStats);
};

module.exports = reviews_route;
