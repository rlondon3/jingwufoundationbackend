// handlers/resources.js
require('dotenv').config();
const { ResourceStore, validateResource } = require('../models/resource');
const { authenticationToken, requireAdmin } = require('../middleware/auth');

/**
 * Resource Handlers - All business logic for resource operations
 */

// ========================
// PUBLIC RESOURCE HANDLERS
// ========================

/**
 * Get all published resources
 * GET /resources
 */
const index = async (req, res) => {
	try {
		const store = new ResourceStore(req.app.locals.pool);
		const resources = await store.index();
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get resources error:', error);
		return res.status(500).json({ error: 'Failed to retrieve resources' });
	}
};

/**
 * Get single resource by ID
 * GET /resources/:id
 */
const show = async (req, res) => {
	try {
		const store = new ResourceStore(req.app.locals.pool);
		const resource = await store.show(parseInt(req.params.id));

		if (!resource) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		// Only show published resources to non-admin users
		if (!resource.is_published && !req.user?.is_admin) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		return res.status(200).json(resource);
	} catch (error) {
		console.error('Get resource error:', error);
		return res.status(500).json({ error: 'Failed to retrieve resource' });
	}
};

/**
 * Get resources by type
 * GET /resources/type/:type
 */
const getByType = async (req, res) => {
	try {
		const type = req.params.type;

		if (!['blog', 'video', 'audio'].includes(type)) {
			return res.status(400).json({ error: 'Invalid resource type' });
		}

		const store = new ResourceStore(req.app.locals.pool);
		const resources = await store.getByType(type);
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get resources by type error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve resources by type' });
	}
};

/**
 * Get resources by author
 * GET /resources/author/:author
 */
const getByAuthor = async (req, res) => {
	try {
		const author = req.params.author;
		const store = new ResourceStore(req.app.locals.pool);
		const resources = await store.getByAuthor(author);
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get resources by author error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve resources by author' });
	}
};

/**
 * Search resources
 * GET /resources/search?q=searchTerm
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

		const store = new ResourceStore(req.app.locals.pool);
		const resources = await store.search(searchTerm);
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Search resources error:', error);
		return res.status(500).json({ error: 'Failed to search resources' });
	}
};

/**
 * Get resources by course
 * GET /resources/course/:courseId
 */
const getByCourse = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
		const store = new ResourceStore(req.app.locals.pool);
		const resources = await store.getByCourse(courseId);
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get resources by course error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve resources by course' });
	}
};

/**
 * Get all authors
 * GET /resources/authors
 */
const getAuthors = async (req, res) => {
	try {
		const store = new ResourceStore(req.app.locals.pool);
		const authors = await store.getAuthors();
		return res.status(200).json(authors);
	} catch (error) {
		console.error('Get authors error:', error);
		return res.status(500).json({ error: 'Failed to retrieve authors' });
	}
};

// ========================
// ADMIN RESOURCE HANDLERS
// ========================

/**
 * Get all resources (admin view - includes drafts)
 * GET /admin/resources
 */
const adminIndex = async (req, res) => {
	try {
		const store = new ResourceStore(req.app.locals.pool);
		const resources = await store.adminIndex();
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get admin resources error:', error);
		return res.status(500).json({ error: 'Failed to retrieve resources' });
	}
};

/**
 * Create new resource
 * POST /admin/resources
 */
const create = async (req, res) => {
	try {
		// Validate resource data
		const { error } = validateResource(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new ResourceStore(req.app.locals.pool);
		const resource = await store.create(req.body);

		return res.status(201).json(resource);
	} catch (error) {
		console.error('Create resource error:', error);
		return res.status(500).json({ error: 'Failed to create resource' });
	}
};

/**
 * Update existing resource
 * PUT /admin/resources/:id
 */
const update = async (req, res) => {
	try {
		// Validate resource data
		const { error } = validateResource(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new ResourceStore(req.app.locals.pool);
		
		// Get current resource for Cloudinary cleanup
		const currentResource = await store.show(parseInt(req.params.id));
		if (!currentResource) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		const resource = await store.update(req.body, parseInt(req.params.id));

		// Clean up old Cloudinary assets if they changed
		const assetsToCheck = [
			{ field: 'thumbnail', current: currentResource.thumbnail, new: req.body.thumbnail },
			{ field: 'video_url', current: currentResource.video_url, new: req.body.video_url },
			{ field: 'audio_url', current: currentResource.audio_url, new: req.body.audio_url }
		];

		for (const asset of assetsToCheck) {
			if (asset.current && asset.new && asset.current !== asset.new) {
				try {
					const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
					const publicId = extractPublicIdFromUrl(asset.current);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log(`Deleted old Cloudinary resource ${asset.field}:`, publicId);
					}
				} catch (imageError) {
					console.warn(`Failed to delete old Cloudinary resource ${asset.field}:`, imageError.message);
					// Don't fail the operation if image cleanup fails
				}
			}
		}

		return res.status(200).json(resource);
	} catch (error) {
		console.error('Update resource error:', error);
		return res.status(500).json({ error: 'Failed to update resource' });
	}
};

/**
 * Delete resource
 * DELETE /admin/resources/:id
 */
const deleteResource = async (req, res) => {
	try {
		const store = new ResourceStore(req.app.locals.pool);
		
		// Get resource details before deletion for Cloudinary cleanup
		const resourceToDelete = await store.show(parseInt(req.params.id));
		if (!resourceToDelete) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		const resource = await store.delete(parseInt(req.params.id));

		// Clean up Cloudinary assets if they exist
		const cloudinaryAssets = [];
		if (resourceToDelete.thumbnail) cloudinaryAssets.push(resourceToDelete.thumbnail);
		if (resourceToDelete.video_url) cloudinaryAssets.push(resourceToDelete.video_url);
		if (resourceToDelete.audio_url) cloudinaryAssets.push(resourceToDelete.audio_url);

		if (cloudinaryAssets.length > 0) {
			try {
				const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
				
				for (const assetUrl of cloudinaryAssets) {
					const publicId = extractPublicIdFromUrl(assetUrl);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log('Deleted Cloudinary resource asset:', publicId);
					}
				}
			} catch (imageError) {
				console.warn('Failed to delete Cloudinary resource assets:', imageError.message);
				// Don't fail the operation if image cleanup fails
			}
		}

		return res.status(200).json({
			message: 'Resource deleted successfully',
			resource: resource,
		});
	} catch (error) {
		console.error('Delete resource error:', error);
		return res.status(500).json({ error: 'Failed to delete resource' });
	}
};

/**
 * Get resource statistics
 * GET /admin/resources/stats
 */
const getStats = async (req, res) => {
	try {
		const store = new ResourceStore(req.app.locals.pool);
		const stats = await store.getStats();
		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get resource stats error:', error);
		return res.status(500).json({ error: 'Failed to get resource statistics' });
	}
};

// ========================
// MEDIA UPLOAD HANDLERS
// ========================

/**
 * Upload audio file for resource
 * POST /admin/resources/upload-audio
 */
const uploadAudio = async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No audio file provided' });
		}

		// This would integrate with your Cloudinary service
		// For now, return a placeholder response
		return res.status(200).json({
			message: 'Audio upload endpoint ready for Cloudinary integration',
			file_info: {
				filename: req.file.filename,
				size: req.file.size,
				mimetype: req.file.mimetype,
			},
			// In real implementation:
			// audio_url: cloudinaryResponse.secure_url,
			// duration: cloudinaryResponse.duration
		});
	} catch (error) {
		console.error('Upload audio error:', error);
		return res.status(500).json({ error: 'Failed to upload audio' });
	}
};

/**
 * Upload video file for resource
 * POST /admin/resources/upload-video
 */
const uploadVideo = async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No video file provided' });
		}

		// This would integrate with your Cloudinary service
		// For now, return a placeholder response
		return res.status(200).json({
			message: 'Video upload endpoint ready for Cloudinary integration',
			file_info: {
				filename: req.file.filename,
				size: req.file.size,
				mimetype: req.file.mimetype,
			},
			// In real implementation:
			// video_url: cloudinaryResponse.secure_url,
			// duration: cloudinaryResponse.duration
		});
	} catch (error) {
		console.error('Upload video error:', error);
		return res.status(500).json({ error: 'Failed to upload video' });
	}
};

/**
 * Upload image/thumbnail for resource
 * POST /admin/resources/upload-image
 */
const uploadImage = async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No image file provided' });
		}

		// This would integrate with your Cloudinary service
		// For now, return a placeholder response
		return res.status(200).json({
			message: 'Image upload endpoint ready for Cloudinary integration',
			file_info: {
				filename: req.file.filename,
				size: req.file.size,
				mimetype: req.file.mimetype,
			},
			// In real implementation:
			// thumbnail_url: cloudinaryResponse.secure_url
		});
	} catch (error) {
		console.error('Upload image error:', error);
		return res.status(500).json({ error: 'Failed to upload image' });
	}
};

/**
 * Resource route handler - manages all resource-related endpoints
 */
const resources_route = (app) => {
	// Public routes (no authentication required)
	app.get('/resources', index);
	app.get('/resources/authors', getAuthors);
	app.get('/resources/search', search);
	app.get('/resources/type/:type', getByType);
	app.get('/resources/author/:author', getByAuthor);
	app.get('/resources/course/:courseId', getByCourse);

	// Public route with optional authentication (for view counting and draft access)
	app.get(
		'/resources/:id',
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
	app.get('/admin/resources', authenticationToken, requireAdmin, adminIndex);
	app.post('/admin/resources', authenticationToken, requireAdmin, create);
	app.put('/admin/resources/:id', authenticationToken, requireAdmin, update);
	app.delete(
		'/admin/resources/:id',
		authenticationToken,
		requireAdmin,
		deleteResource
	);
	app.get(
		'/admin/resources/stats',
		authenticationToken,
		requireAdmin,
		getStats
	);

	// Media upload routes (admin only)
	app.post(
		'/admin/resources/upload-audio',
		authenticationToken,
		requireAdmin,
		uploadAudio
	);
	app.post(
		'/admin/resources/upload-video',
		authenticationToken,
		requireAdmin,
		uploadVideo
	);
	app.post(
		'/admin/resources/upload-image',
		authenticationToken,
		requireAdmin,
		uploadImage
	);
};

module.exports = resources_route;
