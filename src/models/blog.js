require('dotenv').config();
const Joi = require('joi');

class BlogStore {
	constructor(pool) {
		this.pool = pool;
	}

	/**
	 * Get all blog posts with optional filtering
	 */
	async index(filters = {}) {
		try {
			let sql = `
				SELECT 
					bp.*,
					ARRAY_AGG(DISTINCT bt.tag_name) FILTER (WHERE bt.tag_name IS NOT NULL) as tags,
					ARRAY_AGG(DISTINCT bm.media_url) FILTER (WHERE bm.media_url IS NOT NULL) as media_urls,
					ARRAY_AGG(DISTINCT bm.media_type) FILTER (WHERE bm.media_type IS NOT NULL) as media_types
				FROM blog_posts bp
				LEFT JOIN blog_tags bt ON bp.id = bt.post_id
				LEFT JOIN blog_media bm ON bp.id = bm.post_id
			`;

			const params = [];
			const conditions = [];

			// Filter by status
			if (filters.status) {
				conditions.push(`bp.status = $${params.length + 1}`);
				params.push(filters.status);
			}

			// Filter by tags
			if (filters.tags && filters.tags.length > 0) {
				conditions.push(`bp.id IN (
					SELECT post_id FROM blog_tags 
					WHERE tag_name = ANY($${params.length + 1})
				)`);
				params.push(filters.tags);
			}

			// Filter by search term (title or excerpt)
			if (filters.search) {
				conditions.push(`(
					bp.title ILIKE $${params.length + 1} OR 
					bp.excerpt ILIKE $${params.length + 1}
				)`);
				params.push(`%${filters.search}%`);
			}

			if (conditions.length > 0) {
				sql += ` WHERE ${conditions.join(' AND ')}`;
			}

			sql += `
				GROUP BY bp.id
				ORDER BY 
					CASE WHEN bp.status = 'published' THEN bp.published_at ELSE bp.created_at END DESC
			`;

			// Add limit if specified
			if (filters.limit) {
				sql += ` LIMIT $${params.length + 1}`;
				params.push(filters.limit);
			}

			const client = await this.pool.connect();
			const res = await client.query(sql, params);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve blog posts: ${error}`);
		}
	}

	/**
	 * Get published posts for public display
	 */
	async getPublishedPosts(limit = null) {
		return await this.index({
			status: 'published',
			limit: limit,
		});
	}

	/**
	 * Get single blog post by ID
	 */
	async show(id) {
		try {
			const sql = `
				SELECT 
					bp.*,
					ARRAY_AGG(DISTINCT bt.tag_name) FILTER (WHERE bt.tag_name IS NOT NULL) as tags,
					ARRAY_AGG(DISTINCT bm.media_url) FILTER (WHERE bm.media_url IS NOT NULL) as media_urls,
					ARRAY_AGG(DISTINCT bm.media_type) FILTER (WHERE bm.media_type IS NOT NULL) as media_types
				FROM blog_posts bp
				LEFT JOIN blog_tags bt ON bp.id = bt.post_id
				LEFT JOIN blog_media bm ON bp.id = bm.post_id
				WHERE bp.id = $1
				GROUP BY bp.id
			`;
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find blog post: ${error}`);
		}
	}

	/**
	 * Get blog post by slug for public access
	 */
	async getBySlug(slug) {
		try {
			const sql = `
				SELECT 
					bp.*,
					ARRAY_AGG(DISTINCT bt.tag_name) FILTER (WHERE bt.tag_name IS NOT NULL) as tags,
					ARRAY_AGG(DISTINCT bm.media_url) FILTER (WHERE bm.media_url IS NOT NULL) as media_urls,
					ARRAY_AGG(DISTINCT bm.media_type) FILTER (WHERE bm.media_type IS NOT NULL) as media_types
				FROM blog_posts bp
				LEFT JOIN blog_tags bt ON bp.id = bt.post_id
				LEFT JOIN blog_media bm ON bp.id = bm.post_id
				WHERE bp.slug = $1 AND bp.status = 'published'
				GROUP BY bp.id
			`;
			const client = await this.pool.connect();
			const res = await client.query(sql, [slug]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find blog post by slug: ${error}`);
		}
	}

	/**
	 * Generate unique slug from title
	 */
	async generateSlug(title, excludeId = null) {
		let baseSlug = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');

		let slug = baseSlug;
		let counter = 1;

		while (await this.slugExists(slug, excludeId)) {
			slug = `${baseSlug}-${counter}`;
			counter++;
		}

		return slug;
	}

	/**
	 * Check if slug exists
	 */
	async slugExists(slug, excludeId = null) {
		try {
			let sql = 'SELECT COUNT(*) FROM blog_posts WHERE slug = $1';
			const params = [slug];

			if (excludeId) {
				sql += ' AND id != $2';
				params.push(excludeId);
			}

			const client = await this.pool.connect();
			const res = await client.query(sql, params);
			client.release();
			return parseInt(res.rows[0].count) > 0;
		} catch (error) {
			throw new Error(`Can't check slug existence: ${error}`);
		}
	}

	/**
	 * Create new blog post
	 */
	async create(post) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Generate slug
			const slug = await this.generateSlug(post.title);

			// Create blog post
			const postSql = `
				INSERT INTO blog_posts 
				(title, content, excerpt, author, banner_image, slug, meta_description, status, published_at) 
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
				RETURNING *
			`;

			const publishedAt = post.status === 'published' ? new Date() : null;

			const postRes = await client.query(postSql, [
				post.title,
				post.content,
				post.excerpt,
				post.author || 'Jing Wu Foundation',
				post.banner_image,
				slug,
				post.meta_description,
				post.status || 'draft',
				publishedAt,
			]);

			const newPost = postRes.rows[0];

			// Add tags
			if (post.tags && post.tags.length > 0) {
				await this.addTags(client, newPost.id, post.tags);
			}

			// Add media
			if (post.media && post.media.length > 0) {
				await this.addMedia(client, newPost.id, post.media);
			}

			await client.query('COMMIT');
			return await this.show(newPost.id);
		} catch (error) {
			await client.query('ROLLBACK');
			throw new Error(`Could not create blog post: ${error}`);
		} finally {
			client.release();
		}
	}

	/**
	 * Update existing blog post
	 */
	async update(post, id) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Get current post to check for slug changes
			const currentPost = await this.show(id);
			if (!currentPost) {
				throw new Error('Blog post not found');
			}

			// Generate new slug if title changed
			let slug = currentPost.slug;
			if (post.title && post.title !== currentPost.title) {
				slug = await this.generateSlug(post.title, id);
			}

			// Update published_at if status changes to published
			let publishedAt = currentPost.published_at;
			if (post.status === 'published' && currentPost.status !== 'published') {
				publishedAt = new Date();
			} else if (post.status === 'draft') {
				publishedAt = null;
			}

			// Update blog post
			const postSql = `
				UPDATE blog_posts SET 
					title = $1,
					content = $2,
					excerpt = $3,
					author = $4,
					banner_image = $5,
					slug = $6,
					meta_description = $7,
					status = $8,
					published_at = $9,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = $10 
				RETURNING *
			`;

			await client.query(postSql, [
				post.title,
				post.content,
				post.excerpt,
				post.author || 'Jing Wu Foundation',
				post.banner_image,
				slug,
				post.meta_description,
				post.status,
				publishedAt,
				id,
			]);

			// Update tags
			if (post.tags !== undefined) {
				await this.replaceTags(client, id, post.tags);
			}

			// Update media
			if (post.media !== undefined) {
				await this.replaceMedia(client, id, post.media);
			}

			await client.query('COMMIT');
			return await this.show(id);
		} catch (error) {
			await client.query('ROLLBACK');
			throw new Error(`Could not update blog post: ${error}`);
		} finally {
			client.release();
		}
	}

	/**
	 * Delete blog post
	 */
	async delete(id) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Get post before deletion for cleanup
			const post = await this.show(id);
			if (!post) {
				throw new Error('Blog post not found');
			}

			// Delete tags and media (CASCADE should handle this, but explicit is better)
			await client.query('DELETE FROM blog_tags WHERE post_id = $1', [id]);
			await client.query('DELETE FROM blog_media WHERE post_id = $1', [id]);

			// Delete post
			const deleteRes = await client.query(
				'DELETE FROM blog_posts WHERE id = $1 RETURNING *',
				[id]
			);

			await client.query('COMMIT');
			return deleteRes.rows[0];
		} catch (error) {
			await client.query('ROLLBACK');
			throw new Error(`Could not delete blog post: ${error}`);
		} finally {
			client.release();
		}
	}

	/**
	 * Add tags to a post
	 */
	async addTags(client, postId, tags) {
		if (!tags || tags.length === 0) return;

		const tagSql = 'INSERT INTO blog_tags (post_id, tag_name) VALUES ($1, $2)';
		for (const tag of tags) {
			if (tag && tag.trim()) {
				await client.query(tagSql, [postId, tag.trim().toLowerCase()]);
			}
		}
	}

	/**
	 * Replace all tags for a post
	 */
	async replaceTags(client, postId, tags) {
		// Remove existing tags
		await client.query('DELETE FROM blog_tags WHERE post_id = $1', [postId]);

		// Add new tags
		if (tags && tags.length > 0) {
			await this.addTags(client, postId, tags);
		}
	}

	/**
	 * Add media to a post
	 */
	async addMedia(client, postId, mediaItems) {
		if (!mediaItems || mediaItems.length === 0) return;

		const mediaSql =
			'INSERT INTO blog_media (post_id, media_url, media_type, caption) VALUES ($1, $2, $3, $4)';
		for (const media of mediaItems) {
			if (media && media.url) {
				await client.query(mediaSql, [
					postId,
					media.url,
					media.type || 'image',
					media.caption || null,
				]);
			}
		}
	}

	/**
	 * Replace all media for a post
	 */
	async replaceMedia(client, postId, mediaItems) {
		// Remove existing media
		await client.query('DELETE FROM blog_media WHERE post_id = $1', [postId]);

		// Add new media
		if (mediaItems && mediaItems.length > 0) {
			await this.addMedia(client, postId, mediaItems);
		}
	}

	/**
	 * Get all unique tags
	 */
	async getAllTags() {
		try {
			const sql = `
				SELECT 
					tag_name,
					COUNT(*) as post_count
				FROM blog_tags bt
				JOIN blog_posts bp ON bt.post_id = bp.id
				WHERE bp.status = 'published'
				GROUP BY tag_name
				ORDER BY post_count DESC, tag_name ASC
			`;
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve tags: ${error}`);
		}
	}

	/**
	 * Get posts by tag
	 */
	async getPostsByTag(tagName, limit = null) {
		return await this.index({
			status: 'published',
			tags: [tagName],
			limit: limit,
		});
	}
}

/**
 * Validation schema for blog posts
 */
function handleBlogErrors(post) {
	const blogSchema = Joi.object({
		title: Joi.string().min(1).max(200).required(),
		content: Joi.string().max(31457280).required(),
		excerpt: Joi.string().max(500).required(),
		author: Joi.string().default('Jing Wu Foundation'),
		banner_image: Joi.string().uri().allow(''),
		meta_description: Joi.string().max(160).allow(''),
		status: Joi.string().valid('draft', 'published').default('draft'),
		tags: Joi.array().items(Joi.string().max(50)).default([]),
		media: Joi.array()
			.items(
				Joi.object({
					url: Joi.string().uri().required(),
					type: Joi.string().valid('image', 'video').default('image'),
					caption: Joi.string().max(200).allow(''),
				})
			)
			.default([]),
	});

	return blogSchema.validate(post);
}

module.exports = { BlogStore, handleBlogErrors };
