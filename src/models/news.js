// models/news.js
require('dotenv').config();
const Joi = require('joi');

/**
 * NewsStore handles all news/updates operations
 * Manages articles with thumbnails, body images, and tagging system
 */
class NewsStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// NEWS OPERATIONS
	// ========================

	/**
	 * Get all published news (student dashboard view)
	 */
	async index() {
		try {
			const sql = `
        SELECT n.*, 
       array_agg(DISTINCT nt.tag_name) FILTER (WHERE nt.tag_name IS NOT NULL) as tags,
       array_agg(ni.image_url ORDER BY ni.order_sequence) FILTER (WHERE ni.image_url IS NOT NULL) as body_images
FROM news n
LEFT JOIN news_tags nt ON n.id = nt.news_id
LEFT JOIN news_images ni ON n.id = ni.news_id
WHERE n.status = 'published' 
AND (n.publish_at IS NULL OR n.publish_at <= CURRENT_TIMESTAMP)
AND (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)
GROUP BY n.id
ORDER BY n.is_important DESC, n.publish_at DESC, n.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve news: ${error}`);
		}
	}

	/**
	 * Get all news (admin view - includes drafts)
	 */
	async adminIndex() {
		try {
			const sql = `
        SELECT n.*, 
       array_agg(DISTINCT nt.tag_name) FILTER (WHERE nt.tag_name IS NOT NULL) as tags,
       array_agg(ni.image_url ORDER BY ni.order_sequence) FILTER (WHERE ni.image_url IS NOT NULL) as body_images
FROM news n
LEFT JOIN news_tags nt ON n.id = nt.news_id
LEFT JOIN news_images ni ON n.id = ni.news_id
GROUP BY n.id
ORDER BY n.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve all news: ${error}`);
		}
	}

	/**
	 * Get single news article
	 */
	async show(id) {
		try {
			const sql = `
        SELECT n.*, 
       array_agg(DISTINCT nt.tag_name) FILTER (WHERE nt.tag_name IS NOT NULL) as tags,
       array_agg(ni.image_url ORDER BY ni.order_sequence) FILTER (WHERE ni.image_url IS NOT NULL) as body_images
FROM news n
LEFT JOIN news_tags nt ON n.id = nt.news_id
LEFT JOIN news_images ni ON n.id = ni.news_id
WHERE n.id = $1
GROUP BY n.id
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();

			if (res.rows.length === 0) {
				return null;
			}

			// Increment view count for published articles
			if (res.rows[0].status === 'published') {
				await this.incrementViewCount(id);
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find news article: ${error}`);
		}
	}

	/**
	 * Create new news article
	 */
	async create(newsData) {
		try {
			const client = await this.pool.connect();

			try {
				await client.query('BEGIN');

				// Create news article
				const newsSql = `
          INSERT INTO news (title, description, body, thumbnail_url, author_name, 
                           status, is_important, publish_at, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
        `;

				const newsRes = await client.query(newsSql, [
					newsData.title,
					newsData.description,
					newsData.body,
					newsData.thumbnail_url,
					newsData.author_name,
					newsData.status || 'draft',
					newsData.is_important || false,
					newsData.publish_at || null,
					newsData.expires_at || null,
				]);

				const newsId = newsRes.rows[0].id;

				// Add tags if provided
				if (newsData.tags && newsData.tags.length > 0) {
					await this.addTags(client, newsId, newsData.tags);
				}

				// Add body images if provided
				if (newsData.body_images && newsData.body_images.length > 0) {
					await this.addBodyImages(client, newsId, newsData.body_images);
				}

				await client.query('COMMIT');

				// Return complete article with tags and images
				return await this.show(newsId);
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			} finally {
				client.release();
			}
		} catch (error) {
			throw new Error(`Could not create news article: ${error}`);
		}
	}

	/**
	 * Update existing news article
	 */
	async update(newsData, id) {
		try {
			const client = await this.pool.connect();

			try {
				await client.query('BEGIN');

				// Update news article
				const sql = `
          UPDATE news SET 
            title = $1, description = $2, body = $3, thumbnail_url = $4,
            author_name = $5, status = $6, is_important = $7,
            publish_at = $8, expires_at = $9, updated_at = CURRENT_TIMESTAMP
          WHERE id = $10 RETURNING *
        `;

				const res = await client.query(sql, [
					newsData.title,
					newsData.description,
					newsData.body,
					newsData.thumbnail_url,
					newsData.author_name,
					newsData.status,
					newsData.is_important,
					newsData.publish_at,
					newsData.expires_at,
					id,
				]);

				if (res.rows.length === 0) {
					throw new Error('News article not found');
				}

				// Update tags
				if (newsData.tags !== undefined) {
					await client.query('DELETE FROM news_tags WHERE news_id = $1', [id]);
					if (newsData.tags.length > 0) {
						await this.addTags(client, id, newsData.tags);
					}
				}

				// Update body images
				if (newsData.body_images !== undefined) {
					await client.query('DELETE FROM news_images WHERE news_id = $1', [
						id,
					]);
					if (newsData.body_images.length > 0) {
						await this.addBodyImages(client, id, newsData.body_images);
					}
				}

				await client.query('COMMIT');

				return await this.show(id);
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			} finally {
				client.release();
			}
		} catch (error) {
			throw new Error(`Could not update news article: ${error}`);
		}
	}

	/**
	 * Delete news article
	 */
	async delete(id) {
		try {
			const sql = 'DELETE FROM news WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete news article: ${error}`);
		}
	}

	// ========================
	// HELPER METHODS
	// ========================

	/**
	 * Add tags to news article
	 */
	async addTags(client, newsId, tags) {
		const tagSql = 'INSERT INTO news_tags (news_id, tag_name) VALUES ($1, $2)';
		for (const tag of tags) {
			await client.query(tagSql, [newsId, tag.trim()]);
		}
	}

	/**
	 * Add body images to news article
	 */
	async addBodyImages(client, newsId, images) {
		const imageSql =
			'INSERT INTO news_images (news_id, image_url, order_sequence) VALUES ($1, $2, $3)';
		for (let i = 0; i < images.length; i++) {
			await client.query(imageSql, [newsId, images[i], i + 1]);
		}
	}

	/**
	 * Increment view count
	 */
	async incrementViewCount(id) {
		try {
			const sql = 'UPDATE news SET view_count = view_count + 1 WHERE id = $1';
			const client = await this.pool.connect();
			await client.query(sql, [id]);
			client.release();
		} catch (error) {
			// Don't throw error for view count updates
			console.error('Failed to increment view count:', error);
		}
	}

	// ========================
	// FILTERING & SEARCH
	// ========================

	/**
	 * Get news by tag
	 */
	async getByTag(tagName) {
		try {
			const sql = `
        SELECT DISTINCT n.*, 
       array_agg(DISTINCT nt.tag_name) FILTER (WHERE nt.tag_name IS NOT NULL) as tags,
       array_agg(ni.image_url ORDER BY ni.order_sequence) FILTER (WHERE ni.image_url IS NOT NULL) as body_images
FROM news n
LEFT JOIN news_tags nt ON n.id = nt.news_id
LEFT JOIN news_images ni ON n.id = ni.news_id
WHERE n.status = 'published' 
AND EXISTS (SELECT 1 FROM news_tags nt2 WHERE nt2.news_id = n.id AND nt2.tag_name = $1)
GROUP BY n.id
ORDER BY n.is_important DESC, n.publish_at DESC, n.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [tagName]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve news by tag: ${error}`);
		}
	}

	/**
	 * Search news articles
	 */
	async search(searchTerm) {
		try {
			const sql = `
        SELECT DISTINCT n.*, 
       array_agg(DISTINCT nt.tag_name) FILTER (WHERE nt.tag_name IS NOT NULL) as tags,
       array_agg(ni.image_url ORDER BY ni.order_sequence) FILTER (WHERE ni.image_url IS NOT NULL) as body_images
FROM news n
LEFT JOIN news_tags nt ON n.id = nt.news_id
LEFT JOIN news_images ni ON n.id = ni.news_id
WHERE n.status = 'published'
AND (n.title ILIKE $1 OR n.description ILIKE $1 OR n.body ILIKE $1)
GROUP BY n.id
ORDER BY n.is_important DESC, n.publish_at DESC, n.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [`%${searchTerm}%`]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't search news articles: ${error}`);
		}
	}

	/**
	 * Get all unique tags
	 */
	async getAllTags() {
		try {
			const sql = `
        SELECT tag_name, COUNT(*) as usage_count
        FROM news_tags nt
        JOIN news n ON nt.news_id = n.id
        WHERE n.status = 'published'
        GROUP BY tag_name
        ORDER BY usage_count DESC, tag_name
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve tags: ${error}`);
		}
	}

	// ========================
	// ANALYTICS
	// ========================

	/**
	 * Get news statistics
	 */
	async getStats() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_articles,
          COUNT(*) FILTER (WHERE status = 'published') as published_articles,
          COUNT(*) FILTER (WHERE status = 'draft') as draft_articles,
          COUNT(*) FILTER (WHERE is_important = true) as important_articles,
          COALESCE(SUM(view_count), 0) as total_views,
          COALESCE(AVG(view_count), 0) as avg_views_per_article
        FROM news
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't retrieve news statistics: ${error}`);
		}
	}
}

/**
 * Validation schema for news data
 */
function validateNews(news) {
	const newsSchema = Joi.object({
		title: Joi.string().min(1).max(200).required(),
		description: Joi.string().min(1).max(500).required(),
		body: Joi.string().min(1).required(),
		thumbnail_url: Joi.string().uri().allow('', null),
		author_name: Joi.string().min(1).max(100).required(),
		status: Joi.string().valid('draft', 'published').default('draft'),
		is_important: Joi.boolean().default(false),
		publish_at: Joi.date().allow(null),
		expires_at: Joi.date().allow(null),
		tags: Joi.array().items(Joi.string().min(1).max(50)).default([]),
		body_images: Joi.array().items(Joi.string().uri()).default([]),
	});

	return newsSchema.validate(news);
}

module.exports = {
	NewsStore,
	validateNews,
};
