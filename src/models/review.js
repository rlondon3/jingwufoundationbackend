require('dotenv').config();
const Joi = require('joi');

/**
 * ReviewStore handles all review and course request operations
 * Manages star ratings, text reviews, and course requests
 */
class ReviewStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// REVIEW OPERATIONS
	// ========================

	/**
	 * Get all published reviews for a course
	 */
	async getCourseReviews(courseId) {
		try {
			const sql = `
        SELECT 
          r.*,
          u.name as user_name,
          u.avatar as user_avatar
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.course_id = $1 AND r.is_published = true
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [courseId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve course reviews: ${error}`);
		}
	}

	/**
	 * Get course rating summary
	 */
	async getCourseRatingSummary(courseId) {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_reviews,
          ROUND(AVG(rating)::numeric, 2) as average_rating,
          COUNT(*) FILTER (WHERE rating = 5) as five_star,
          COUNT(*) FILTER (WHERE rating = 4) as four_star,
          COUNT(*) FILTER (WHERE rating = 3) as three_star,
          COUNT(*) FILTER (WHERE rating = 2) as two_star,
          COUNT(*) FILTER (WHERE rating = 1) as one_star
        FROM reviews 
        WHERE course_id = $1 AND is_published = true
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [courseId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't retrieve course rating summary: ${error}`);
		}
	}

	/**
	 * Get user's reviews
	 */
	async getUserReviews(userId) {
		try {
			const sql = `
        SELECT 
          r.*,
          c.title as course_title,
          c.thumbnail_url as course_thumbnail
        FROM reviews r
        JOIN courses c ON r.course_id = c.id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user reviews: ${error}`);
		}
	}

	/**
	 * Create new review
	 */
	async createReview(review) {
		try {
			const sql = `
        INSERT INTO reviews (user_id, course_id, rating, review_text, is_verified, is_published)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				review.user_id,
				review.course_id,
				review.rating,
				review.review_text || null,
				review.is_verified || false,
				review.is_published !== false, // Default to true unless explicitly false
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create review: ${error}`);
		}
	}

	/**
	 * Update existing review
	 */
	async updateReview(review, id) {
		try {
			const sql = `
        UPDATE reviews SET 
          rating = $1, review_text = $2, is_published = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				review.rating,
				review.review_text,
				review.is_published,
				id,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update review: ${error}`);
		}
	}

	/**
	 * Delete review
	 */
	async deleteReview(id) {
		try {
			const sql = 'DELETE FROM reviews WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete review: ${error}`);
		}
	}

	/**
	 * Check if user has already reviewed a course
	 */
	async hasUserReviewed(userId, courseId) {
		try {
			const sql =
				'SELECT id FROM reviews WHERE user_id = $1 AND course_id = $2';
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return res.rows.length > 0;
		} catch (error) {
			throw new Error(`Could not check if user has reviewed: ${error}`);
		}
	}

	/**
	 * Get user's specific review for a course
	 */
	async getUserCourseReview(userId, courseId) {
		try {
			const sql = `
        SELECT * FROM reviews 
        WHERE user_id = $1 AND course_id = $2
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return res.rows[0] || null;
		} catch (error) {
			throw new Error(`Could not get user course review: ${error}`);
		}
	}

	/**
	 * Mark review as helpful
	 */
	async markReviewHelpful(reviewId) {
		try {
			const sql = `
        UPDATE reviews SET 
          helpful_count = helpful_count + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [reviewId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not mark review as helpful: ${error}`);
		}
	}

	// ========================
	// COURSE REQUEST OPERATIONS
	// ========================

	/**
	 * Get all course requests
	 */
	async getCourseRequests(status = null) {
		try {
			let sql = `
        SELECT 
          cr.*,
          u.name as user_name,
          u.email as user_email,
          reviewer.name as reviewed_by_name
        FROM course_requests cr
        JOIN users u ON cr.user_id = u.id
        LEFT JOIN users reviewer ON cr.reviewed_by = reviewer.id
      `;

			const params = [];
			if (status) {
				sql += ' WHERE cr.request_status = $1';
				params.push(status);
			}

			sql += ' ORDER BY cr.created_at DESC';

			const client = await this.pool.connect();
			const res = await client.query(sql, params);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve course requests: ${error}`);
		}
	}

	/**
	 * Get user's course requests
	 */
	async getUserCourseRequests(userId) {
		try {
			const sql = `
        SELECT 
          cr.*,
          reviewer.name as reviewed_by_name
        FROM course_requests cr
        LEFT JOIN users reviewer ON cr.reviewed_by = reviewer.id
        WHERE cr.user_id = $1
        ORDER BY cr.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user course requests: ${error}`);
		}
	}

	/**
	 * Create new course request
	 */
	async createCourseRequest(request) {
		try {
			const sql = `
        INSERT INTO course_requests (user_id, requested_course_title, request_description, 
                                   request_priority, request_status)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				request.user_id,
				request.requested_course_title,
				request.request_description || null,
				request.request_priority || 3,
				'pending',
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create course request: ${error}`);
		}
	}

	/**
	 * Update course request status (admin function)
	 */
	async updateCourseRequestStatus(
		requestId,
		status,
		adminId,
		adminNotes = null
	) {
		try {
			const sql = `
        UPDATE course_requests SET 
          request_status = $1, reviewed_by = $2, admin_notes = $3,
          reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				status,
				adminId,
				adminNotes,
				requestId,
			]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update course request status: ${error}`);
		}
	}

	/**
	 * Delete course request
	 */
	async deleteCourseRequest(id) {
		try {
			const sql = 'DELETE FROM course_requests WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete course request: ${error}`);
		}
	}

	/**
	 * Get most requested courses
	 */
	async getMostRequestedCourses(limit = 10) {
		try {
			const sql = `
        SELECT 
          requested_course_title,
          COUNT(*) as request_count,
          AVG(request_priority) as average_priority,
          array_agg(DISTINCT request_status) as statuses
        FROM course_requests
        GROUP BY requested_course_title
        ORDER BY request_count DESC, average_priority DESC
        LIMIT $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve most requested courses: ${error}`);
		}
	}

	// ========================
	// ADMIN OPERATIONS
	// ========================

	/**
	 * Get all reviews (admin view - includes unpublished)
	 */
	async getAllReviews() {
		try {
			const sql = `
        SELECT 
          r.*,
          u.name as user_name,
          u.email as user_email,
          c.title as course_title
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        JOIN courses c ON r.course_id = c.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve all reviews: ${error}`);
		}
	}

	/**
	 * Get review and request statistics
	 */
	async getStats() {
		try {
			const sql = `
        SELECT 
          (SELECT COUNT(*) FROM reviews) as total_reviews,
          (SELECT COUNT(*) FROM reviews WHERE is_published = true) as published_reviews,
          (SELECT COUNT(*) FROM reviews WHERE is_published = false) as unpublished_reviews,
          (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE is_published = true) as overall_average_rating,
          (SELECT COUNT(*) FROM course_requests) as total_requests,
          (SELECT COUNT(*) FROM course_requests WHERE request_status = 'pending') as pending_requests,
          (SELECT COUNT(*) FROM course_requests WHERE request_status = 'approved') as approved_requests,
          (SELECT COUNT(*) FROM course_requests WHERE request_status = 'completed') as completed_requests
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't retrieve statistics: ${error}`);
		}
	}
}

/**
 * Validation schemas for review data
 */
function validateReview(review) {
	const reviewSchema = Joi.object({
		user_id: Joi.number().integer().positive().required(),
		course_id: Joi.number().integer().positive().required(),
		rating: Joi.number().integer().min(1).max(5).required(),
		review_text: Joi.string().max(2000).allow('', null),
		is_verified: Joi.boolean().default(false),
		is_published: Joi.boolean().default(true),
	});

	return reviewSchema.validate(review);
}

function validateCourseRequest(request) {
	const requestSchema = Joi.object({
		user_id: Joi.number().integer().positive().required(),
		requested_course_title: Joi.string().min(1).max(200).required(),
		request_description: Joi.string().max(1000).allow('', null),
		request_priority: Joi.number().integer().min(1).max(5).default(3),
	});

	return requestSchema.validate(request);
}

module.exports = {
	ReviewStore,
	validateReview,
	validateCourseRequest,
};
