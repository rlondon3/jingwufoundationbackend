const { CoursePreviewStore } = require('../models/coursePreview');
const { authenticationToken, requireAdmin } = require('../middleware/auth');

const coursePreviews_route = (app) => {
	const pool = app.locals.pool;
	const store = new CoursePreviewStore(pool);

	// Get all active course previews (public endpoint)
	const getActivePreviews = async (req, res) => {
		try {
			const previews = await store.getActivePreviews();
			return res.status(200).json(previews);
		} catch (error) {
			console.error('Get active previews error:', error);
			return res.status(500).json({ error: error.message });
		}
	};

	// Admin endpoints for managing course previews
	const index = async (req, res) => {
		try {
			const previews = await store.index();
			return res.status(200).json(previews);
		} catch (error) {
			console.error('Get all previews error:', error);
			return res.status(500).json({ error: error.message });
		}
	};

	const show = async (req, res) => {
		try {
			const { id } = req.params;
			const preview = await store.show(id);
			if (!preview) {
				return res.status(404).json({ error: 'Course preview not found' });
			}
			return res.status(200).json(preview);
		} catch (error) {
			console.error('Get preview error:', error);
			return res.status(500).json({ error: error.message });
		}
	};

	const create = async (req, res) => {
		try {
			const { course_id, name, description, cta, coupon, url, is_active } = req.body;

			// Validate required fields
			if (!course_id || !name || !cta || !url) {
				return res.status(400).json({ 
					error: 'Missing required fields: course_id, name, cta, url' 
				});
			}

			const preview = await store.create({
				course_id,
				name,
				description,
				cta,
				coupon,
				url,
				is_active
			});

			return res.status(201).json(preview);
		} catch (error) {
			console.error('Create preview error:', error);
			return res.status(500).json({ error: error.message });
		}
	};

	const update = async (req, res) => {
		try {
			const { id } = req.params;
			const { course_id, name, description, cta, coupon, url, is_active } = req.body;

			const preview = await store.update(id, {
				course_id,
				name,
				description,
				cta,
				coupon,
				url,
				is_active
			});

			if (!preview) {
				return res.status(404).json({ error: 'Course preview not found' });
			}

			return res.status(200).json(preview);
		} catch (error) {
			console.error('Update preview error:', error);
			return res.status(500).json({ error: error.message });
		}
	};

	const deletePreview = async (req, res) => {
		try {
			const { id } = req.params;
			const preview = await store.delete(id);
			if (!preview) {
				return res.status(404).json({ error: 'Course preview not found' });
			}
			return res.status(200).json({ message: 'Course preview deleted successfully' });
		} catch (error) {
			console.error('Delete preview error:', error);
			return res.status(500).json({ error: error.message });
		}
	};

	// Public routes
	app.get('/course-previews/active', getActivePreviews);

	// Admin routes
	app.get('/admin/course-previews', authenticationToken, requireAdmin, index);
	app.get('/admin/course-previews/:id', authenticationToken, requireAdmin, show);
	app.post('/admin/course-previews', authenticationToken, requireAdmin, create);
	app.put('/admin/course-previews/:id', authenticationToken, requireAdmin, update);
	app.delete('/admin/course-previews/:id', authenticationToken, requireAdmin, deletePreview);
};

module.exports = coursePreviews_route;