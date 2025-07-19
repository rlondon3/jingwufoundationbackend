// handlers/testimonials.js
require('dotenv').config();
const {
	TestimonialsStore,
	validateTestimonial,
} = require('../models/testimonial');
const { authenticationToken, requireAdmin } = require('../middleware/auth');

/**
 * Testimonials Handlers - All business logic for instructor testimonial operations
 */

// ========================
// PUBLIC TESTIMONIAL HANDLERS
// ========================

/**
 * Get all approved testimonials
 * GET /testimonials
 */
const getPublicTestimonials = async (req, res) => {
	try {
		const limit = req.query.limit ? parseInt(req.query.limit) : null;
		const featuredOnly = req.query.featured === 'true';

		if (limit && (limit < 1 || limit > 100)) {
			return res.status(400).json({ error: 'Limit must be between 1 and 100' });
		}

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonials = await store.getPublicTestimonials(limit, featuredOnly);

		return res.status(200).json(testimonials);
	} catch (error) {
		console.error('Get public testimonials error:', error);
		return res.status(500).json({ error: 'Failed to retrieve testimonials' });
	}
};

/**
 * Get featured testimonials
 * GET /testimonials/featured
 */
const getFeaturedTestimonials = async (req, res) => {
	try {
		const limit = req.query.limit ? parseInt(req.query.limit) : 5;

		if (limit < 1 || limit > 20) {
			return res.status(400).json({ error: 'Limit must be between 1 and 20' });
		}

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonials = await store.getFeaturedTestimonials(limit);

		return res.status(200).json(testimonials);
	} catch (error) {
		console.error('Get featured testimonials error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve featured testimonials' });
	}
};

/**
 * Submit new testimonial
 * POST /testimonials
 */
const submitTestimonial = async (req, res) => {
	try {
		// Validate testimonial data
		const { error } = validateTestimonial(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonial = await store.submitTestimonial(req.body);

		return res.status(201).json({
			message: 'Testimonial submitted successfully and is pending approval',
			testimonial: {
				id: testimonial.id,
				student_name: testimonial.student_name,
				submitted_at: testimonial.submitted_at,
			},
		});
	} catch (error) {
		console.error('Submit testimonial error:', error);
		return res.status(500).json({ error: 'Failed to submit testimonial' });
	}
};

// ========================
// ADMIN TESTIMONIAL HANDLERS
// ========================

/**
 * Get all testimonials (admin view)
 * GET /admin/testimonials
 */
const getAllTestimonials = async (req, res) => {
	try {
		const status = req.query.status; // pending, approved, featured

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonials = await store.getAllTestimonials(status);

		return res.status(200).json(testimonials);
	} catch (error) {
		console.error('Get all testimonials error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve all testimonials' });
	}
};

/**
 * Approve testimonial (admin)
 * PUT /admin/testimonials/:id/approve
 */
const approveTestimonial = async (req, res) => {
	try {
		const testimonialId = parseInt(req.params.id);
		const adminName = req.user.name || req.user.email;

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonial = await store.approveTestimonial(
			testimonialId,
			adminName
		);

		return res.status(200).json({
			message: 'Testimonial approved successfully',
			testimonial: testimonial,
		});
	} catch (error) {
		console.error('Approve testimonial error:', error);
		if (error.message.includes('not found')) {
			return res.status(404).json({ error: 'Testimonial not found' });
		}
		return res.status(500).json({ error: 'Failed to approve testimonial' });
	}
};

/**
 * Reject testimonial (admin)
 * PUT /admin/testimonials/:id/reject
 */
const rejectTestimonial = async (req, res) => {
	try {
		const testimonialId = parseInt(req.params.id);
		const adminName = req.user.name || req.user.email;

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonial = await store.rejectTestimonial(testimonialId, adminName);

		return res.status(200).json({
			message: 'Testimonial rejected successfully',
			testimonial: testimonial,
		});
	} catch (error) {
		console.error('Reject testimonial error:', error);
		if (error.message.includes('not found')) {
			return res.status(404).json({ error: 'Testimonial not found' });
		}
		return res.status(500).json({ error: 'Failed to reject testimonial' });
	}
};

/**
 * Toggle featured status (admin)
 * PUT /admin/testimonials/:id/featured
 */
const toggleFeatured = async (req, res) => {
	try {
		const testimonialId = parseInt(req.params.id);

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonial = await store.toggleFeatured(testimonialId);

		return res.status(200).json({
			message: 'Featured status updated successfully',
			testimonial: testimonial,
		});
	} catch (error) {
		console.error('Toggle featured error:', error);
		if (error.message.includes('not found')) {
			return res.status(404).json({ error: 'Testimonial not found' });
		}
		return res.status(500).json({ error: 'Failed to update featured status' });
	}
};

/**
 * Update testimonial (admin)
 * PUT /admin/testimonials/:id
 */
const updateTestimonial = async (req, res) => {
	try {
		const testimonialId = parseInt(req.params.id);

		// Validate testimonial data
		const { error } = validateTestimonial(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonial = await store.updateTestimonial(testimonialId, req.body);

		return res.status(200).json({
			message: 'Testimonial updated successfully',
			testimonial: testimonial,
		});
	} catch (error) {
		console.error('Update testimonial error:', error);
		if (error.message.includes('not found')) {
			return res.status(404).json({ error: 'Testimonial not found' });
		}
		return res.status(500).json({ error: 'Failed to update testimonial' });
	}
};

/**
 * Delete testimonial (admin)
 * DELETE /admin/testimonials/:id
 */
const deleteTestimonial = async (req, res) => {
	try {
		const testimonialId = parseInt(req.params.id);

		const store = new TestimonialsStore(req.app.locals.pool);
		const testimonial = await store.deleteTestimonial(testimonialId);

		return res.status(200).json({
			message: 'Testimonial deleted successfully',
			testimonial: testimonial,
		});
	} catch (error) {
		console.error('Delete testimonial error:', error);
		if (error.message.includes('not found')) {
			return res.status(404).json({ error: 'Testimonial not found' });
		}
		return res.status(500).json({ error: 'Failed to delete testimonial' });
	}
};

/**
 * Get testimonial statistics (admin)
 * GET /admin/testimonials/stats
 */
const getTestimonialStats = async (req, res) => {
	try {
		const store = new TestimonialsStore(req.app.locals.pool);
		const stats = await store.getTestimonialStats();

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get testimonial stats error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to get testimonial statistics' });
	}
};

/**
 * Testimonials route handler - manages all instructor testimonial endpoints
 */
const testimonials_route = (app) => {
	// Public routes (no authentication required)
	app.get('/testimonials', getPublicTestimonials);
	app.get('/testimonials/featured', getFeaturedTestimonials);
	app.post('/testimonials', submitTestimonial);

	// Admin routes (admin authentication required)
	app.get(
		'/admin/testimonials',
		authenticationToken,
		requireAdmin,
		getAllTestimonials
	);
	app.get(
		'/admin/testimonials/stats',
		authenticationToken,
		requireAdmin,
		getTestimonialStats
	);
	app.put(
		'/admin/testimonials/:id/approve',
		authenticationToken,
		requireAdmin,
		approveTestimonial
	);
	app.put(
		'/admin/testimonials/:id/reject',
		authenticationToken,
		requireAdmin,
		rejectTestimonial
	);
	app.put(
		'/admin/testimonials/:id/featured',
		authenticationToken,
		requireAdmin,
		toggleFeatured
	);
	app.put(
		'/admin/testimonials/:id',
		authenticationToken,
		requireAdmin,
		updateTestimonial
	);
	app.delete(
		'/admin/testimonials/:id',
		authenticationToken,
		requireAdmin,
		deleteTestimonial
	);
};

module.exports = testimonials_route;
