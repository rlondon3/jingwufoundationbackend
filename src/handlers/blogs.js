require('dotenv').config();
const { BlogStore, handleBlogErrors } = require('../models/blog');

/**
 * Blog route handler - manages all blog-related endpoints
 */
const blog_route = (app) => {
	const pool = app.locals.pool;
	const store = new BlogStore(pool);

	/**
	 * Get all blog posts (admin endpoint with filtering)
	 * GET /admin/blog/posts - requires admin authentication
	 */
	const index = async (req, res) => {
		try {
			const filters = {
				status: req.query.status,
				tags: req.query.tags ? req.query.tags.split(',') : undefined,
				search: req.query.search,
				limit: req.query.limit ? parseInt(req.query.limit) : undefined,
			};

			const posts = await store.index(filters);
			return res.status(200).json(posts);
		} catch (error) {
			console.error('Get blog posts error:', error);
			return res.status(500).json({ error: 'Failed to retrieve blog posts' });
		}
	};

	/**
	 * Get published blog posts for public display
	 * GET /blog/posts - public endpoint
	 */
	const getPublishedPosts = async (req, res) => {
		try {
			const limit = req.query.limit ? parseInt(req.query.limit) : null;
			const posts = await store.getPublishedPosts(limit);
			return res.status(200).json(posts);
		} catch (error) {
			console.error('Get published posts error:', error);
			return res.status(500).json({ error: 'Failed to retrieve blog posts' });
		}
	};

	/**
	 * Get single blog post by ID (admin)
	 * GET /admin/blog/post/:id - requires admin authentication
	 */
	const show = async (req, res) => {
		try {
			const post = await store.show(parseInt(req.params.id));
			if (!post) {
				return res.status(404).json({ error: 'Blog post not found' });
			}
			return res.status(200).json(post);
		} catch (error) {
			console.error('Get blog post error:', error);
			return res.status(500).json({ error: 'Failed to retrieve blog post' });
		}
	};

	/**
	 * Get single blog post by slug (public)
	 * GET /blog/post/:slug - public endpoint
	 */
	const getBySlug = async (req, res) => {
		try {
			const post = await store.getBySlug(req.params.slug);
			if (!post) {
				return res.status(404).json({ error: 'Blog post not found' });
			}
			return res.status(200).json(post);
		} catch (error) {
			console.error('Get blog post by slug error:', error);
			return res.status(500).json({ error: 'Failed to retrieve blog post' });
		}
	};

	/**
	 * Create new blog post
	 * POST /admin/blog/post - requires admin authentication
	 */
	const create = async (req, res) => {
		try {
			const post = {
				title: req.body.title,
				content: req.body.content,
				excerpt: req.body.excerpt,
				author: req.body.author || 'Jing Wu Foundation',
				banner_image: req.body.banner_image,
				meta_description: req.body.meta_description,
				status: req.body.status || 'draft',
				tags: req.body.tags || [],
				media: req.body.media || [],
			};

			// Validate blog post data
			const { error } = handleBlogErrors(post);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const newPost = await store.create(post);
			return res.status(201).json({
				message: 'Blog post created successfully',
				post: newPost,
			});
		} catch (error) {
			console.error('Create blog post error:', error);
			return res.status(500).json({ error: 'Failed to create blog post' });
		}
	};

	/**
	 * Update existing blog post
	 * PUT /admin/blog/post/:id - requires admin authentication
	 */
	const update = async (req, res) => {
		const postId = parseInt(req.params.id);

		try {
			const post = {
				title: req.body.title,
				content: req.body.content,
				excerpt: req.body.excerpt,
				author: req.body.author || 'Jing Wu Foundation',
				banner_image: req.body.banner_image,
				meta_description: req.body.meta_description,
				status: req.body.status,
				tags: req.body.tags,
				media: req.body.media,
			};

			// Validate blog post data
			const { error } = handleBlogErrors(post);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const updatedPost = await store.update(post, postId);
			if (!updatedPost) {
				return res.status(404).json({ error: 'Blog post not found' });
			}

			return res.status(200).json({
				message: 'Blog post updated successfully',
				post: updatedPost,
			});
		} catch (error) {
			console.error('Update blog post error:', error);
			return res.status(500).json({ error: 'Failed to update blog post' });
		}
	};

	/**
	 * Delete blog post
	 * DELETE /admin/blog/post/:id - requires admin authentication
	 */
	const deleteBlogPost = async (req, res) => {
		const postId = parseInt(req.params.id);

		try {
			const deletedPost = await store.delete(postId);
			if (!deletedPost) {
				return res.status(404).json({ error: 'Blog post not found' });
			}

			// Clean up Cloudinary images if they exist
			if (deletedPost.banner_image) {
				try {
					const {
						deleteImageDirect,
						extractPublicIdFromUrl,
					} = require('./cloudinary');
					const publicId = extractPublicIdFromUrl(deletedPost.banner_image);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log('Deleted Cloudinary banner image:', publicId);
					}
				} catch (imageError) {
					console.warn(
						'Failed to delete Cloudinary banner image:',
						imageError.message
					);
				}
			}

			return res.status(200).json({
				message: 'Blog post deleted successfully',
				post: deletedPost,
			});
		} catch (error) {
			console.error('Delete blog post error:', error);
			return res.status(500).json({ error: 'Failed to delete blog post' });
		}
	};

	/**
	 * Get all tags with post counts
	 * GET /blog/tags - public endpoint
	 */
	const getAllTags = async (req, res) => {
		try {
			const tags = await store.getAllTags();
			return res.status(200).json(tags);
		} catch (error) {
			console.error('Get tags error:', error);
			return res.status(500).json({ error: 'Failed to retrieve tags' });
		}
	};

	/**
	 * Get posts by tag
	 * GET /blog/tag/:tagName - public endpoint
	 */
	const getPostsByTag = async (req, res) => {
		try {
			const tagName = req.params.tagName;
			const limit = req.query.limit ? parseInt(req.query.limit) : null;
			const posts = await store.getPostsByTag(tagName, limit);
			return res.status(200).json({
				tag: tagName,
				posts: posts,
			});
		} catch (error) {
			console.error('Get posts by tag error:', error);
			return res.status(500).json({ error: 'Failed to retrieve posts by tag' });
		}
	};

	/**
	 * Search blog posts
	 * GET /blog/search - public endpoint
	 */
	const searchPosts = async (req, res) => {
		try {
			const { q: query, limit } = req.query;

			if (!query || query.trim().length < 2) {
				return res
					.status(400)
					.json({ error: 'Search query must be at least 2 characters' });
			}

			const filters = {
				status: 'published',
				search: query.trim(),
				limit: limit ? parseInt(limit) : null,
			};

			const posts = await store.index(filters);
			return res.status(200).json({
				query: query.trim(),
				results: posts.length,
				posts: posts,
			});
		} catch (error) {
			console.error('Search posts error:', error);
			return res.status(500).json({ error: 'Failed to search blog posts' });
		}
	};

	/**
	 * Get recent posts for landing page
	 * GET /blog/recent - public endpoint
	 */
	const getRecentPosts = async (req, res) => {
		try {
			const limit = req.query.limit ? parseInt(req.query.limit) : 3;
			const posts = await store.getPublishedPosts(limit);

			// Format for landing page cards
			const formattedPosts = posts.map((post) => ({
				id: post.id,
				title: post.title,
				excerpt: post.excerpt,
				banner_image: post.banner_image,
				published_at: post.published_at,
				slug: post.slug,
				tags: post.tags || [],
				author: post.author,
			}));

			return res.status(200).json(formattedPosts);
		} catch (error) {
			console.error('Get recent posts error:', error);
			return res.status(500).json({ error: 'Failed to retrieve recent posts' });
		}
	};

	/**
	 * Check if slug is available
	 * POST /admin/blog/check-slug - requires admin authentication
	 */
	const checkSlug = async (req, res) => {
		try {
			const { title, excludeId } = req.body;

			if (!title) {
				return res.status(400).json({ error: 'Title is required' });
			}

			const slug = await store.generateSlug(title, excludeId);
			const isAvailable = !(await store.slugExists(slug, excludeId));

			return res.status(200).json({
				title,
				suggestedSlug: slug,
				isAvailable,
			});
		} catch (error) {
			console.error('Check slug error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to check slug availability' });
		}
	};

	/**
	 * Meta tag injection for social media sharing
	 * GET /api/meta/blog/:slug - serves the blog HTML directly from database with proper meta tags
	 */
	const getPostWithMetaTags = async (req, res) => {
		try {
			const post = await store.getBySlug(req.params.slug);
			console.log(`Meta tag injection request for slug: ${req.params.slug}`);
			
			if (!post) {
				console.log(`Post not found for slug: ${req.params.slug}`);
				return res.status(404).json({ error: 'Blog post not found' });
			}

			console.log(`Found post: ${post.title}`);
			
			// The post.content already contains the full HTML! Just serve it with proper meta tags
			const frontendUrl = process.env.FRONTEND_URL || 'https://jingwupai.org';
			
			// Escape HTML special characters in meta content
			const escapeHtml = (text) => {
				if (!text) return '';
				return text.replace(/"/g, '&quot;').replace(/'/g, '&#039;');
			};

			const safeTitle = escapeHtml(post.title);
			const safeDescription = escapeHtml(post.meta_description || post.excerpt);
			const safeBannerImage = escapeHtml(post.banner_image || '');

			// For human users (not crawlers), redirect to the frontend app
			const userAgent = req.get('User-Agent') || '';
			const isSocialCrawler = /facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|slack|discord|pinterest/i.test(userAgent);
			
			if (!isSocialCrawler) {
				// Redirect human users to the frontend app
				return res.redirect(301, `${frontendUrl}/blog/${post.slug}`);
			}

			// For social media crawlers, serve HTML with proper meta tags
			// Check if the content already has a complete HTML structure
			if (post.content.includes('<!DOCTYPE html>') || post.content.includes('<html')) {
				// Content is already complete HTML - just inject/update meta tags if needed
				let html = post.content;
				
				// Add Open Graph and Twitter meta tags to the head if they don't exist
				const headEndIndex = html.indexOf('</head>');
				if (headEndIndex !== -1 && post.banner_image) {
					const metaTags = `
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${frontendUrl}/blog/${post.slug}" />
    <meta property="og:image" content="${safeBannerImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeBannerImage}" />
`;
					html = html.substring(0, headEndIndex) + metaTags + html.substring(headEndIndex);
				}
				
				res.setHeader('Content-Type', 'text/html; charset=utf-8');
				return res.send(html);
			} else {
				// Content is HTML fragment - wrap it in a complete HTML document
				const completeHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle} - Jing Wu Foundation Blog</title>
    <meta name="description" content="${safeDescription}" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${frontendUrl}/blog/${post.slug}" />
    ${post.banner_image ? `<meta property="og:image" content="${safeBannerImage}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    ${post.banner_image ? `<meta name="twitter:image" content="${safeBannerImage}" />` : ''}
</head>
<body>
${post.content}
</body>
</html>`;
				
				res.setHeader('Content-Type', 'text/html; charset=utf-8');
				return res.send(completeHtml);
			}
			
		} catch (error) {
			console.error('Meta tag injection error:', error);
			return res.status(500).json({ error: 'Failed to retrieve blog post' });
		}
	};


	// Import authentication middleware
	const { authenticationToken, requireAdmin } = require('../middleware/auth');

	// Admin routes (protected)
	app.get('/admin/blog/posts', authenticationToken, requireAdmin, index);
	app.get('/admin/blog/post/:id', authenticationToken, requireAdmin, show);
	app.post('/admin/blog/post', authenticationToken, requireAdmin, create);
	app.put('/admin/blog/post/:id', authenticationToken, requireAdmin, update);
	app.delete(
		'/admin/blog/post/:id',
		authenticationToken,
		requireAdmin,
		deleteBlogPost
	);
	app.post(
		'/admin/blog/check-slug',
		authenticationToken,
		requireAdmin,
		checkSlug
	);

	// Public routes
	app.get('/blog/posts', getPublishedPosts);
	app.get('/blog/post/:slug', getBySlug);
	app.get('/api/meta/blog/:slug', getPostWithMetaTags); // Meta tag injection for social media sharing
	app.get('/blog/tags', getAllTags);
	app.get('/blog/tag/:tagName', getPostsByTag);
	app.get('/blog/search', searchPosts);
	app.get('/blog/recent', getRecentPosts);
};

module.exports = blog_route;
