// handlers/news.js
require('dotenv').config();
const { NewsStore, validateNews } = require('../models/news');
const { authenticationToken, requireAdmin } = require('../middleware/auth');

/**
 * News Handlers - All business logic for news/updates operations
 */

// ========================
// PUBLIC NEWS HANDLERS (Student Dashboard)
// ========================

/**
 * Get all published news (student dashboard)
 * GET /news
 */
const index = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		const news = await store.index();
		return res.status(200).json(news);
	} catch (error) {
		console.error('Get news error:', error);
		return res.status(500).json({ error: 'Failed to retrieve news' });
	}
};

/**
 * Get single news article
 * GET /news/:id
 */
const show = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		const article = await store.show(parseInt(req.params.id));

		if (!article) {
			return res.status(404).json({ error: 'News article not found' });
		}

		// Only show published articles to non-admin users
		if (article.status !== 'published' && !req.user?.is_admin) {
			return res.status(404).json({ error: 'News article not found' });
		}

		return res.status(200).json(article);
	} catch (error) {
		console.error('Get news article error:', error);
		return res.status(500).json({ error: 'Failed to retrieve news article' });
	}
};

/**
 * Get news by tag
 * GET /news/tag/:tagName
 */
const getByTag = async (req, res) => {
	try {
		const tagName = req.params.tagName;

		const store = new NewsStore(req.app.locals.pool);
		const news = await store.getByTag(tagName);

		return res.status(200).json(news);
	} catch (error) {
		console.error('Get news by tag error:', error);
		return res.status(500).json({ error: 'Failed to retrieve news by tag' });
	}
};

/**
 * Search news articles
 * GET /news/search?q=searchTerm
 */
const search = async (req, res) => {
	try {
		const searchTerm = req.query.q;

		if (!searchTerm) {
			return res.status(400).json({ error: 'Search term is required' });
		}

		if (searchTerm.length < 2) {
			return res
				.status(400)
				.json({ error: 'Search term must be at least 2 characters' });
		}

		const store = new NewsStore(req.app.locals.pool);
		const news = await store.search(searchTerm);

		return res.status(200).json(news);
	} catch (error) {
		console.error('Search news error:', error);
		return res.status(500).json({ error: 'Failed to search news' });
	}
};

/**
 * Get all tags
 * GET /news/tags
 */
const getAllTags = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		const tags = await store.getAllTags();

		return res.status(200).json(tags);
	} catch (error) {
		console.error('Get tags error:', error);
		return res.status(500).json({ error: 'Failed to retrieve tags' });
	}
};

// ========================
// ADMIN NEWS HANDLERS
// ========================

/**
 * Get all news (admin view - includes drafts)
 * GET /admin/news
 */
const adminIndex = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		const news = await store.adminIndex();

		return res.status(200).json(news);
	} catch (error) {
		console.error('Get admin news error:', error);
		return res.status(500).json({ error: 'Failed to retrieve news' });
	}
};

/**
 * Create new news article
 * POST /admin/news
 */
const create = async (req, res) => {
	try {
		// Validate news data
		const { error } = validateNews(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new NewsStore(req.app.locals.pool);
		const article = await store.create(req.body);

		return res.status(201).json(article);
	} catch (error) {
		console.error('Create news error:', error);
		return res.status(500).json({ error: 'Failed to create news article' });
	}
};

/**
 * Update existing news article
 * PUT /admin/news/:id
 */
const update = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		
		// Get the current article first to check for thumbnail changes
		const currentArticle = await store.show(parseInt(req.params.id));
		if (!currentArticle) {
			return res.status(404).json({ error: 'News article not found' });
		}

		// Validate news data
		const { error } = validateNews(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		// Update the article
		const article = await store.update(req.body, parseInt(req.params.id));

		// Clean up old Cloudinary thumbnail if it changed
		if (currentArticle.thumbnail_url && req.body.thumbnail_url && 
			currentArticle.thumbnail_url !== req.body.thumbnail_url) {
			try {
				const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
				const publicId = extractPublicIdFromUrl(currentArticle.thumbnail_url);
				if (publicId) {
					await deleteImageDirect(publicId);
					console.log('Deleted old Cloudinary thumbnail:', publicId);
				}
			} catch (imageError) {
				console.warn('Failed to delete old Cloudinary thumbnail:', imageError.message);
				// Don't fail the operation if image cleanup fails
			}
		}

		return res.status(200).json(article);
	} catch (error) {
		console.error('Update news error:', error);
		return res.status(500).json({ error: 'Failed to update news article' });
	}
};

/**
 * Delete news article
 * DELETE /admin/news/:id
 */
const deleteNews = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		
		// Get the article first to check for images
		const articleToDelete = await store.show(parseInt(req.params.id));
		if (!articleToDelete) {
			return res.status(404).json({ error: 'News article not found' });
		}

		// Delete the article from database
		const article = await store.delete(parseInt(req.params.id));

		// Clean up Cloudinary images if they exist
		if (articleToDelete.thumbnail_url) {
			try {
				const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
				const publicId = extractPublicIdFromUrl(articleToDelete.thumbnail_url);
				if (publicId) {
					await deleteImageDirect(publicId);
					console.log('Deleted Cloudinary thumbnail:', publicId);
				}
			} catch (imageError) {
				console.warn('Failed to delete Cloudinary thumbnail:', imageError.message);
				// Don't fail the operation if image cleanup fails
			}
		}

		return res.status(200).json({
			message: 'News article deleted successfully',
			article: article,
		});
	} catch (error) {
		console.error('Delete news error:', error);
		return res.status(500).json({ error: 'Failed to delete news article' });
	}
};

/**
 * Publish/unpublish news article
 * PUT /admin/news/:id/status
 */
const updateStatus = async (req, res) => {
	try {
		const { status } = req.body;

		if (!status || !['draft', 'published'].includes(status)) {
			return res
				.status(400)
				.json({ error: 'Valid status (draft or published) is required' });
		}

		const store = new NewsStore(req.app.locals.pool);

		// Get current article
		const currentArticle = await store.show(parseInt(req.params.id));
		if (!currentArticle) {
			return res.status(404).json({ error: 'News article not found' });
		}

		// Update only the status
		const updateData = {
			...currentArticle,
			status: status,
			publish_at:
				status === 'published' && !currentArticle.publish_at
					? new Date()
					: currentArticle.publish_at,
		};

		const article = await store.update(updateData, parseInt(req.params.id));

		return res.status(200).json(article);
	} catch (error) {
		console.error('Update news status error:', error);
		return res.status(500).json({ error: 'Failed to update news status' });
	}
};

// ========================
// ANALYTICS HANDLERS
// ========================

/**
 * Get news statistics
 * GET /admin/news/stats
 */
const getStats = async (req, res) => {
	try {
		const store = new NewsStore(req.app.locals.pool);
		const stats = await store.getStats();

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get news stats error:', error);
		return res.status(500).json({ error: 'Failed to get news statistics' });
	}
};

// ========================
// IMAGE MANAGEMENT HELPERS
// ========================

/**
 * Handle image upload for news
 * POST /admin/news/upload-image
 */
const uploadImage = async (req, res) => {
	try {
		const { image_type } = req.body; // 'thumbnail' or 'body'

		if (!image_type || !['thumbnail', 'body'].includes(image_type)) {
			return res
				.status(400)
				.json({ error: 'Valid image_type (thumbnail or body) is required' });
		}

		// This would integrate with your Cloudinary service
		// For now, return a placeholder response
		return res.status(200).json({
			message: 'Image upload endpoint ready for Cloudinary integration',
			image_type: image_type,
			// In real implementation:
			// image_url: cloudinaryResponse.secure_url
		});
	} catch (error) {
		console.error('Upload image error:', error);
		return res.status(500).json({ error: 'Failed to upload image' });
	}
};

/**
 * News route handler - manages all news-related endpoints
 */
const news_route = (app) => {
	// Public routes (no authentication required)
	app.get('/news', index);
	app.get('/news/tags', getAllTags);
	app.get('/news/search', search);
	app.get('/news/tag/:tagName', getByTag);

	// Public route with optional authentication (for view counting and draft access)
	app.get(
		'/news/:id',
		(req, res, next) => {
			// Try to authenticate but don't require it
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				// Apply authentication middleware if token is provided
				authenticationToken(req, res, next);
			} else {
				// Continue without authentication
				next();
			}
		},
		show
	);

	// Admin-only routes
	app.get('/admin/news', authenticationToken, requireAdmin, adminIndex);
	app.post('/admin/news', authenticationToken, requireAdmin, create);
	app.put('/admin/news/:id', authenticationToken, requireAdmin, update);
	app.delete('/admin/news/:id', authenticationToken, requireAdmin, deleteNews);
	app.put(
		'/admin/news/:id/status',
		authenticationToken,
		requireAdmin,
		updateStatus
	);
	app.get('/admin/news/stats', authenticationToken, requireAdmin, getStats);
	app.post(
		'/admin/news/upload-image',
		authenticationToken,
		requireAdmin,
		uploadImage
	);
};

module.exports = news_route;
