// handlers/resources.js
require('dotenv').config();
const { ResourceStore, validateResource } = require('../models/resource');
const {
	authenticationToken,
	requireAdmin,
	authenticateUserId,
} = require('../middleware/auth');

/**
 * Resource Handlers - All business logic for resource operations
 * Updated to support add-on purchases and access control
 */

// ========================
// PUBLIC RESOURCE HANDLERS (Updated)
// ========================

/**
 * Get all published resources with purchase status for authenticated users
 * GET /resources
 */
const index = async (req, res) => {
	try {
		const userId = req.user?.id || null;
		const resources = await store.index(userId);
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get resources error:', error);
		return res.status(500).json({ error: 'Failed to retrieve resources' });
	}
};

/**
 * Get single resource by ID with access control for add-ons
 * GET /resources/:id
 */
const show = async (req, res) => {
	try {
		const userId = req.user?.id || null;
		const resource = await store.show(parseInt(req.params.id), userId);

		if (!resource) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		// Only show published resources to non-admin users
		if (!resource.is_published && !req.user?.is_admin) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		// Check access for add-on resources
		if (resource.is_add_on && !req.user?.is_admin) {
			if (!userId) {
				// Return limited info for unauthenticated users
				return res.status(200).json({
					...resource,
					content: null,
					video_url: null,
					audio_url: null,
					user_has_access: false,
					access_required: true,
					message:
						'This is a premium add-on. Please sign in and purchase to access full content.',
				});
			}

			// Check if user has purchased this add-on
			const hasAccess = resource.user_has_access;
			if (!hasAccess) {
				return res.status(200).json({
					...resource,
					content: null,
					video_url: null,
					audio_url: null,
					user_has_access: false,
					access_required: true,
					message:
						'This is a premium add-on. Purchase required to access full content.',
				});
			}
		}

		return res.status(200).json(resource);
	} catch (error) {
		console.error('Get resource error:', error);
		return res.status(500).json({ error: 'Failed to retrieve resource' });
	}
};

/**
 * Get resources by type with purchase status
 * GET /resources/type/:type
 */
const getByType = async (req, res) => {
	try {
		const type = req.params.type;

		if (!['blog', 'video', 'audio', 'manual'].includes(type)) {
			return res.status(400).json({ error: 'Invalid resource type' });
		}

		const userId = req.user?.id || null;
		const resources = await store.getByType(type, userId);
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get resources by type error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve resources by type' });
	}
};

/**
 * Get resources by author (unchanged)
 * GET /resources/author/:author
 */
const getByAuthor = async (req, res) => {
	try {
		const author = req.params.author;
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
 * Search resources with purchase status
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

		const userId = req.user?.id || null;
		const resources = await store.search(searchTerm, userId);
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Search resources error:', error);
		return res.status(500).json({ error: 'Failed to search resources' });
	}
};

/**
 * Get resources by course (unchanged)
 * GET /resources/course/:courseId
 */
const getByCourse = async (req, res) => {
	try {
		const courseId = parseInt(req.params.courseId);
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
 * Get all authors (unchanged)
 * GET /resources/authors
 */
const getAuthors = async (req, res) => {
	try {
		const authors = await store.getAuthors();
		return res.status(200).json(authors);
	} catch (error) {
		console.error('Get authors error:', error);
		return res.status(500).json({ error: 'Failed to retrieve authors' });
	}
};

// ========================
// ADD-ON SPECIFIC HANDLERS
// ========================

/**
 * Get all available add-ons with purchase status
 * GET /resources/addons
 */
const getAddOns = async (req, res) => {
	try {
		const userId = req.user?.id || null;
		const addOns = await store.getAddOns(userId);
		return res.status(200).json(addOns);
	} catch (error) {
		console.error('Get add-ons error:', error);
		return res.status(500).json({ error: 'Failed to retrieve add-ons' });
	}
};

/**
 * Check if user has purchased specific add-on
 * GET /users/:userId/resources/:resourceId/access
 */
const checkUserAddOnAccess = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const resourceId = parseInt(req.params.resourceId);

		const hasAccess = await store.hasUserPurchasedAddOn(userId, resourceId);

		return res.status(200).json({ has_access: hasAccess });
	} catch (error) {
		console.error('Check user add-on access error:', error);
		return res.status(500).json({ error: 'Failed to check add-on access' });
	}
};

/**
 * Get user's purchased add-ons
 * GET /users/:userId/resources/purchased
 */
const getUserPurchasedAddOns = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const addOns = await store.getUserPurchasedAddOns(userId);

		return res.status(200).json(addOns);
	} catch (error) {
		console.error('Get user purchased add-ons error:', error);
		return res
			.status(500)
			.json({ error: "Failed to retrieve user's purchased add-ons" });
	}
};

/**
 * Get user's accessible resources (free + purchased add-ons)
 * GET /users/:userId/resources/accessible
 */
const getUserAccessibleResources = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);

		const resources = await store.getUserAccessibleResources(userId);

		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get user accessible resources error:', error);
		return res
			.status(500)
			.json({ error: "Failed to retrieve user's accessible resources" });
	}
};

// ========================
// ADMIN RESOURCE HANDLERS (Updated)
// ========================

/**
 * Get all resources (admin view - includes drafts and add-ons)
 * GET /admin/resources
 */
const adminIndex = async (req, res) => {
	try {
		const resources = await store.adminIndex();
		return res.status(200).json(resources);
	} catch (error) {
		console.error('Get admin resources error:', error);
		return res.status(500).json({ error: 'Failed to retrieve resources' });
	}
};

/**
 * Create new resource (updated to support add-ons)
 * POST /admin/resources
 */
const create = async (req, res) => {
	try {
		// Validate resource data
		const { error } = validateResource(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const resource = await store.create(req.body);

		return res.status(201).json(resource);
	} catch (error) {
		console.error('Create resource error:', error);
		return res.status(500).json({ error: 'Failed to create resource' });
	}
};

/**
 * Update existing resource (updated to support add-ons)
 * PUT /admin/resources/:id
 */
const update = async (req, res) => {
	try {
		// Validate resource data
		const { error } = validateResource(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}


		// Get current resource for Cloudinary cleanup
		const currentResource = await store.show(parseInt(req.params.id));
		if (!currentResource) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		const resource = await store.update(req.body, parseInt(req.params.id));

		// Clean up old Cloudinary assets if they changed
		const assetsToCheck = [
			{
				field: 'thumbnail',
				current: currentResource.thumbnail,
				new: req.body.thumbnail,
			},
			{
				field: 'video_url',
				current: currentResource.video_url,
				new: req.body.video_url,
			},
			{
				field: 'audio_url',
				current: currentResource.audio_url,
				new: req.body.audio_url,
			},
		];

		for (const asset of assetsToCheck) {
			if (asset.current && asset.new && asset.current !== asset.new) {
				try {
					const {
						deleteImageDirect,
						extractPublicIdFromUrl,
					} = require('./cloudinary');
					const publicId = extractPublicIdFromUrl(asset.current);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log(
							`Deleted old Cloudinary resource ${asset.field}:`,
							publicId
						);
					}
				} catch (imageError) {
					console.warn(
						`Failed to delete old Cloudinary resource ${asset.field}:`,
						imageError.message
					);
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
 * Delete resource (unchanged)
 * DELETE /admin/resources/:id
 */
const deleteResource = async (req, res) => {
	try {

		// Get resource details before deletion for Cloudinary cleanup
		const resourceToDelete = await store.show(parseInt(req.params.id));
		if (!resourceToDelete) {
			return res.status(404).json({ error: 'Resource not found' });
		}

		const resource = await store.delete(parseInt(req.params.id));

		// Clean up Cloudinary assets if they exist
		const cloudinaryAssets = [];
		if (resourceToDelete.thumbnail)
			cloudinaryAssets.push(resourceToDelete.thumbnail);
		if (resourceToDelete.video_url)
			cloudinaryAssets.push(resourceToDelete.video_url);
		if (resourceToDelete.audio_url)
			cloudinaryAssets.push(resourceToDelete.audio_url);

		if (cloudinaryAssets.length > 0) {
			try {
				const {
					deleteImageDirect,
					extractPublicIdFromUrl,
				} = require('./cloudinary');

				for (const assetUrl of cloudinaryAssets) {
					const publicId = extractPublicIdFromUrl(assetUrl);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log('Deleted Cloudinary resource asset:', publicId);
					}
				}
			} catch (imageError) {
				console.warn(
					'Failed to delete Cloudinary resource assets:',
					imageError.message
				);
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
 * Get resource statistics (unchanged)
 * GET /admin/resources/stats
 */
const getStats = async (req, res) => {
	try {
		const stats = await store.getStats();
		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get resource stats error:', error);
		return res.status(500).json({ error: 'Failed to get resource statistics' });
	}
};

// ========================
// MEDIA UPLOAD HANDLERS (unchanged)
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
 * Updated to include add-on endpoints and access control
 */
const resources_route = (app) => {
	const pool = app.locals.pool;
	const store = new ResourceStore(pool);

	/**
	 * Get resource with meta tags for social media sharing
	 * GET /api/meta/resource/:id
	 */
	const getResourceWithMetaTags = async (req, res) => {
		try {
			const resourceId = parseInt(req.params.id);

			// Fetch resource without user context (no access control for meta tags)
			const resource = await store.show(resourceId, null);

			console.log(`Meta tag injection request for resource ID: ${resourceId}`);

			if (!resource) {
				console.log(`Resource not found for ID: ${resourceId}`);
				return res.status(404).json({ error: 'Resource not found' });
			}

			// Only serve published resources
			if (!resource.is_published) {
				return res.status(404).json({ error: 'Resource not found' });
			}

			console.log(`Found resource: ${resource.title}`);

			const frontendUrl = process.env.FRONTEND_URL || 'https://jingwupai.org';

			// Escape HTML special characters in meta content
			const escapeHtml = (text) => {
				if (!text) return '';
				return text
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;')
					.replace(/'/g, '&#039;');
			};

			const safeTitle = escapeHtml(resource.title);
			const safeAuthor = escapeHtml(resource.author);

			// Build description with fallback logic
			let description = resource.description;
			if (!description || description.trim() === '') {
				description = `${resource.title} by ${resource.author} - Premium martial arts resource`;
			}
			const safeDescription = escapeHtml(description);

			// Handle thumbnail with fallback to logo
			const logoUrl =
				'https://res.cloudinary.com/dvao1isqe/image/upload/v1753240648/logo_s8xpbi.png';
			const safeThumbnail = escapeHtml(resource.thumbnail || logoUrl);

			// Detect social media crawlers
			const userAgent = req.get('User-Agent') || '';
			const isSocialCrawler =
				/facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|slack|discord|pinterest/i.test(
					userAgent
				);

			// For human users, redirect to the frontend app
			if (!isSocialCrawler) {
				return res.redirect(
					301,
					`${frontendUrl}/shop/resource/${resource.id}`
				);
			}

			// For social media crawlers, serve HTML with proper meta tags
			const resourceType = resource.type; // blog, video, audio, manual, pdf
			const ogType =
				resourceType === 'video'
					? 'video.other'
					: resourceType === 'audio'
						? 'music.song'
						: resource.is_add_on
							? 'product'
							: 'article';

			// Build price meta tags for add-ons
			const priceTags =
				resource.is_add_on && resource.price
					? `
    <meta property="product:price:amount" content="${resource.price}" />
    <meta property="product:price:currency" content="USD" />
    <meta property="og:availability" content="instock" />`
					: '';

			const completeHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle} - Jing Wu Foundation</title>
    <meta name="description" content="${safeDescription}" />

    <!-- Open Graph Meta Tags -->
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:url" content="${frontendUrl}/shop/resource/${resource.id}" />
    <meta property="og:image" content="${safeThumbnail}" />
    <meta property="og:site_name" content="Jing Wu Foundation" />${priceTags}

    <!-- Twitter Card Meta Tags -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeThumbnail}" />

    <!-- Additional Meta Tags -->
    <meta name="author" content="${safeAuthor}" />
    <meta name="resource-type" content="${resource.type}" />
    <link rel="canonical" href="${frontendUrl}/shop/resource/${resource.id}" />

    <!-- Redirect after 0 seconds to frontend (for crawlers that follow meta refresh) -->
    <meta http-equiv="refresh" content="0;url=${frontendUrl}/shop/resource/${resource.id}">
</head>
<body>
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
        <img src="${safeThumbnail}" alt="${safeTitle}" style="width: 100%; max-width: 400px; height: auto; border-radius: 8px; margin-bottom: 20px;" />
        <h1>${safeTitle}</h1>
        <p><strong>By:</strong> ${safeAuthor}</p>
        <p>${safeDescription}</p>${
				resource.is_add_on && resource.price
					? `
        <p><strong>Price:</strong> $${resource.price} USD</p>`
					: ''
			}
        <p><a href="${frontendUrl}/shop/resource/${resource.id}">View on Jing Wu Foundation</a></p>
    </div>
</body>
</html>`;

			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
			res.setHeader('X-Content-Type-Options', 'nosniff');
			return res.send(completeHtml);
		} catch (error) {
			console.error('Meta tag injection error:', error);
			return res.status(500).json({ error: 'Failed to retrieve resource' });
		}
	};

	// Public routes with optional authentication for purchase status
	app.get(
		'/resources',
		(req, res, next) => {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		index
	);

	app.get(
		'/resources/addons',
		(req, res, next) => {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		getAddOns
	);

	app.get('/resources/authors', getAuthors);
	app.get(
		'/resources/search',
		(req, res, next) => {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		search
	);

	app.get(
		'/resources/type/:type',
		(req, res, next) => {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		getByType
	);

	app.get('/resources/author/:author', getByAuthor);
	app.get('/resources/course/:courseId', getByCourse);

	// Meta tag endpoint for social sharing (must come before /resources/:id)
	app.get('/api/meta/resource/:id', getResourceWithMetaTags);

	// Resource detail with access control
	app.get(
		'/resources/:id',
		(req, res, next) => {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		show
	);

	// User-specific routes (require authentication)
	app.get(
		'/users/:userId/resources/purchased',
		authenticateUserId,
		getUserPurchasedAddOns
	);
	app.get(
		'/users/:userId/resources/accessible',
		authenticateUserId,
		getUserAccessibleResources
	);
	app.get(
		'/users/:userId/resources/:resourceId/access',
		authenticateUserId,
		checkUserAddOnAccess
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
