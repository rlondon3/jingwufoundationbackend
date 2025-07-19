require('dotenv').config();
const Joi = require('joi');

/**
 * TestimonialsStore handles all instructor testimonial operations
 * Manages testimonial submissions, approval workflow, and display
 */
class TestimonialsStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// PUBLIC OPERATIONS
	// ========================

	/**
	 * Get all approved and public testimonials
	 */
	async getPublicTestimonials(limit = null, featuredOnly = false) {
		let client;
		try {
			let sql = `
				SELECT 
					id, student_name, student_location, instructor_context,
					testimonial_text, photo_url, video_url, is_featured,
					submitted_at, approved_at
				FROM testimonials 
				WHERE is_approved = true AND is_public = true
			`;

			if (featuredOnly) {
				sql += ` AND is_featured = true`;
			}

			sql += ` ORDER BY is_featured DESC, approved_at DESC`;

			if (limit) {
				sql += ` LIMIT $1`;
			}

			client = await this.pool.connect();
			const res = limit
				? await client.query(sql, [limit])
				: await client.query(sql);

			client.release();
			return res.rows;
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Can't retrieve public testimonials: ${error}`);
		}
	}

	/**
	 * Get featured testimonials only
	 */
	async getFeaturedTestimonials(limit = 5) {
		try {
			return await this.getPublicTestimonials(limit, true);
		} catch (error) {
			throw new Error(`Can't retrieve featured testimonials: ${error}`);
		}
	}

	/**
	 * Submit new testimonial
	 */
	async submitTestimonial(testimonialData) {
		let client;
		try {
			const sql = `
				INSERT INTO testimonials (
					student_name, student_email, student_location, 
					instructor_context, testimonial_text, photo_url, video_url
				) VALUES ($1, $2, $3, $4, $5, $6, $7)
				RETURNING *
			`;

			client = await this.pool.connect();
			const res = await client.query(sql, [
				testimonialData.student_name,
				testimonialData.student_email || null,
				testimonialData.student_location || null,
				testimonialData.instructor_context,
				testimonialData.testimonial_text,
				testimonialData.photo_url || null,
				testimonialData.video_url || null,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not submit testimonial: ${error}`);
		}
	}

	// ========================
	// ADMIN OPERATIONS
	// ========================

	/**
	 * Get all testimonials with optional status filter
	 */
	async getAllTestimonials(status = null) {
		let client;
		try {
			let sql = `
				SELECT * FROM testimonials
			`;
			let params = [];

			if (status === 'pending') {
				sql += ` WHERE is_approved = false`;
			} else if (status === 'approved') {
				sql += ` WHERE is_approved = true`;
			} else if (status === 'featured') {
				sql += ` WHERE is_featured = true`;
			}

			sql += ` ORDER BY submitted_at DESC`;

			client = await this.pool.connect();
			const res = await client.query(sql, params);
			client.release();
			return res.rows;
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Can't retrieve all testimonials: ${error}`);
		}
	}

	/**
	 * Approve testimonial
	 */
	async approveTestimonial(id, adminName) {
		try {
			const sql = `
				UPDATE testimonials 
				SET is_approved = true, approved_at = CURRENT_TIMESTAMP, 
					approved_by = $2, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [id, adminName]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Testimonial not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not approve testimonial: ${error}`);
		}
	}

	/**
	 * Reject testimonial (set as not approved)
	 */
	async rejectTestimonial(id, adminName) {
		try {
			const sql = `
				UPDATE testimonials 
				SET is_approved = false, approved_at = NULL, 
					approved_by = $2, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [id, adminName]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Testimonial not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not reject testimonial: ${error}`);
		}
	}

	/**
	 * Toggle featured status
	 */
	async toggleFeatured(id) {
		try {
			const sql = `
				UPDATE testimonials 
				SET is_featured = NOT is_featured, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Testimonial not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not toggle featured status: ${error}`);
		}
	}

	/**
	 * Update testimonial
	 */
	async updateTestimonial(id, testimonialData) {
		try {
			const sql = `
				UPDATE testimonials 
				SET student_name = $2, student_email = $3, student_location = $4,
					instructor_context = $5, testimonial_text = $6, photo_url = $7,
					video_url = $8, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1 
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				id,
				testimonialData.student_name,
				testimonialData.student_email || null,
				testimonialData.student_location || null,
				testimonialData.instructor_context,
				testimonialData.testimonial_text,
				testimonialData.photo_url || null,
				testimonialData.video_url || null,
			]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Testimonial not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update testimonial: ${error}`);
		}
	}

	/**
	 * Delete testimonial
	 */
	async deleteTestimonial(id) {
		try {
			const sql = 'DELETE FROM testimonials WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Testimonial not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete testimonial: ${error}`);
		}
	}

	/**
	 * Get testimonial statistics
	 */
	async getTestimonialStats() {
		try {
			const sql = `
				SELECT 
					COUNT(*) as total_testimonials,
					COUNT(*) FILTER (WHERE is_approved = true) as approved_testimonials,
					COUNT(*) FILTER (WHERE is_approved = false) as pending_testimonials,
					COUNT(*) FILTER (WHERE is_featured = true) as featured_testimonials,
					COUNT(*) FILTER (WHERE is_public = true AND is_approved = true) as public_testimonials
				FROM testimonials
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get testimonial statistics: ${error}`);
		}
	}
}

/**
 * Validation schema for testimonial data
 */
function validateTestimonial(testimonialData) {
	const testimonialSchema = Joi.object({
		student_name: Joi.string().min(2).max(100).required(),
		student_email: Joi.string().email().max(255).allow('', null),
		student_location: Joi.string().max(100).allow('', null),
		instructor_context: Joi.string().min(10).max(200).required(),
		testimonial_text: Joi.string().min(100).max(2000).required(),
		photo_url: Joi.string().uri().allow('', null),
		video_url: Joi.string().uri().allow('', null),
	});

	return testimonialSchema.validate(testimonialData);
}

module.exports = {
	TestimonialsStore,
	validateTestimonial,
};
