require('dotenv').config();
const Joi = require('joi');

/**
 * ResourceStore handles all resource operations
 * Manages blog posts, videos, audio content, and their course relationships
 */
class ResourceStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// RESOURCE OPERATIONS
	// ========================

	/**
	 * Get all published resources
	 */
	async index() {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.is_published = true
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve resources: ${error}`);
		}
	}

	/**
	 * Get single resource with related courses
	 */
	async show(id) {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.id = $1
        GROUP BY r.id
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();

			if (res.rows.length === 0) {
				return null;
			}

			// Increment view count for published resources
			if (res.rows[0].is_published) {
				await this.incrementViewCount(id);
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find resource: ${error}`);
		}
	}

	/**
	 * Create new resource
	 */
	async create(resource) {
		try {
			const client = await this.pool.connect();

			try {
				await client.query('BEGIN');

				// Create resource
				const resourceSql = `
          INSERT INTO resources (title, type, content, video_url, audio_url, 
                               thumbnail, description, author, duration, 
                               is_published, view_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
        `;

				const resourceRes = await client.query(resourceSql, [
					resource.title,
					resource.type,
					resource.content || null,
					resource.video_url || null,
					resource.audio_url || null,
					resource.thumbnail || '',
					resource.description || '',
					resource.author,
					resource.duration || null,
					resource.is_published || false,
					0,
				]);

				const resourceId = resourceRes.rows[0].id;

				// Add related courses if provided
				if (resource.related_courses && resource.related_courses.length > 0) {
					await this.addRelatedCourses(
						client,
						resourceId,
						resource.related_courses
					);
				}

				await client.query('COMMIT');

				// Return complete resource with related courses
				return await this.show(resourceId);
			} catch (error) {
				await client.query('ROLLBACK');
				throw error;
			} finally {
				client.release();
			}
		} catch (error) {
			throw new Error(`Could not create resource: ${error}`);
		}
	}

	/**
	 * Update existing resource
	 */
	async update(resource, id) {
		try {
			const client = await this.pool.connect();

			try {
				await client.query('BEGIN');

				// Update resource
				const sql = `
          UPDATE resources SET 
            title = $1, type = $2, content = $3, video_url = $4, audio_url = $5,
            thumbnail = $6, description = $7, author = $8, duration = $9,
            is_published = $10, updated_at = CURRENT_TIMESTAMP
          WHERE id = $11 RETURNING *
        `;

				const res = await client.query(sql, [
					resource.title,
					resource.type,
					resource.content,
					resource.video_url,
					resource.audio_url,
					resource.thumbnail,
					resource.description,
					resource.author,
					resource.duration,
					resource.is_published,
					id,
				]);

				if (res.rows.length === 0) {
					throw new Error('Resource not found');
				}

				// Update related courses
				if (resource.related_courses !== undefined) {
					await client.query(
						'DELETE FROM resource_courses WHERE resource_id = $1',
						[id]
					);
					if (resource.related_courses.length > 0) {
						await this.addRelatedCourses(client, id, resource.related_courses);
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
			throw new Error(`Could not update resource: ${error}`);
		}
	}

	/**
	 * Delete resource
	 */
	async delete(id) {
		try {
			const sql = 'DELETE FROM resources WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete resource: ${error}`);
		}
	}

	// ========================
	// FILTERING & SEARCH
	// ========================

	/**
	 * Get resources by type
	 */
	async getByType(type) {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.type = $1 AND r.is_published = true
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [type]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve resources by type: ${error}`);
		}
	}

	/**
	 * Get resources by author
	 */
	async getByAuthor(author) {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.author = $1 AND r.is_published = true
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [author]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve resources by author: ${error}`);
		}
	}

	/**
	 * Search resources
	 */
	async search(searchTerm) {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.is_published = true
        AND (r.title ILIKE $1 OR r.description ILIKE $1 OR r.content ILIKE $1)
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [`%${searchTerm}%`]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't search resources: ${error}`);
		}
	}

	/**
	 * Get resources related to a course
	 */
	async getByCourse(courseId) {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.is_published = true
        AND EXISTS (
          SELECT 1 FROM resource_courses rc2 
          WHERE rc2.resource_id = r.id AND rc2.course_id = $1
        )
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [courseId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve resources by course: ${error}`);
		}
	}

	// ========================
	// ADMIN OPERATIONS
	// ========================

	/**
	 * Get all resources (admin view - includes unpublished)
	 */
	async adminIndex() {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve all resources: ${error}`);
		}
	}

	/**
	 * Get resource statistics
	 */
	async getStats() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_resources,
          COUNT(*) FILTER (WHERE is_published = true) as published_resources,
          COUNT(*) FILTER (WHERE is_published = false) as draft_resources,
          COUNT(*) FILTER (WHERE type = 'blog') as blog_count,
          COUNT(*) FILTER (WHERE type = 'video') as video_count,
          COUNT(*) FILTER (WHERE type = 'audio') as audio_count,
          COALESCE(SUM(view_count), 0) as total_views,
          COALESCE(AVG(view_count), 0) as avg_views_per_resource
        FROM resources
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't retrieve resource statistics: ${error}`);
		}
	}

	/**
	 * Get all authors
	 */
	async getAuthors() {
		try {
			const sql = `
        SELECT author, COUNT(*) as resource_count
        FROM resources
        WHERE is_published = true
        GROUP BY author
        ORDER BY resource_count DESC, author
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve authors: ${error}`);
		}
	}

	// ========================
	// HELPER METHODS
	// ========================

	/**
	 * Add related courses to resource
	 */
	async addRelatedCourses(client, resourceId, courseIds) {
		const courseSql =
			'INSERT INTO resource_courses (resource_id, course_id) VALUES ($1, $2)';
		for (const courseId of courseIds) {
			await client.query(courseSql, [resourceId, courseId]);
		}
	}

	/**
	 * Increment view count
	 */
	async incrementViewCount(id) {
		try {
			const sql =
				'UPDATE resources SET view_count = view_count + 1 WHERE id = $1';
			const client = await this.pool.connect();
			await client.query(sql, [id]);
			client.release();
		} catch (error) {
			// Don't throw error for view count updates
			console.error('Failed to increment view count:', error);
		}
	}
}

/**
 * Validation schema for resource data
 */
function validateResource(resource) {
	const resourceSchema = Joi.object({
		title: Joi.string().min(1).max(200).required(),
		type: Joi.string().valid('blog', 'video', 'audio').required(),
		content: Joi.string().allow('', null),
		video_url: Joi.string().uri().allow('', null),
		audio_url: Joi.string().uri().allow('', null),
		thumbnail: Joi.string().uri().allow('', null),
		description: Joi.string().max(1000).allow('', null),
		author: Joi.string().min(1).max(100).required(),
		duration: Joi.string().max(20).allow('', null),
		is_published: Joi.boolean().default(false),
		related_courses: Joi.array()
			.items(Joi.number().integer().positive())
			.default([]),
	});

	return resourceSchema.validate(resource);
}

module.exports = {
	ResourceStore,
	validateResource,
};
