require('dotenv').config();
const Joi = require('joi');

/**
 * ResourceStore handles all resource operations
 * Manages blog posts, videos, audio content, their course relationships, and add-on purchases
 */
class ResourceStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// RESOURCE OPERATIONS
	// ========================

	/**
	 * Get all published resources with purchase status for user
	 */
	async index(userId = null) {
		try {
			let sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
      `;

			if (userId) {
				sql += `,
          CASE 
            WHEN r.is_add_on = TRUE THEN 
              EXISTS(
                SELECT 1 FROM orders o 
                WHERE o.resource_id = r.id 
                AND o.user_id = $1 
                AND o.order_status = 'completed'
                AND o.is_add_on = TRUE
              )
            ELSE TRUE
          END as user_has_access
        `;
			}

			sql += `
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.is_published = true
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = userId
				? await client.query(sql, [userId])
				: await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve resources: ${error}`);
		}
	}

	/**
	 * Get single resource with related courses and purchase status
	 */
	async show(id, userId = null) {
		try {
			let sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
      `;

			if (userId) {
				sql += `,
          CASE 
            WHEN r.is_add_on = TRUE THEN 
              EXISTS(
                SELECT 1 FROM orders o 
                WHERE o.resource_id = r.id 
                AND o.user_id = $2 
                AND o.order_status = 'completed'
                AND o.is_add_on = TRUE
              )
            ELSE TRUE
          END as user_has_access
        `;
			}

			sql += `
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.id = $1
        GROUP BY r.id
      `;

			const client = await this.pool.connect();
			const res = userId
				? await client.query(sql, [id, userId])
				: await client.query(sql, [id]);
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
                               is_published, is_add_on, price, stripe_price_id, view_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
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
					resource.is_add_on || false,
					resource.price || null,
					resource.stripe_price_id || null,
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
            is_published = $10, is_add_on = $11, price = $12, stripe_price_id = $13,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $14 RETURNING *
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
					resource.is_add_on,
					resource.price,
					resource.stripe_price_id,
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
	// ADD-ON SPECIFIC METHODS
	// ========================

	/**
	 * Get all available add-ons (paid resources)
	 */
	async getAddOns(userId = null) {
		try {
			let sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
      `;

			if (userId) {
				sql += `,
          EXISTS(
            SELECT 1 FROM orders o 
            WHERE o.resource_id = r.id 
            AND o.user_id = $2 
            AND o.order_status = 'completed'
            AND o.is_add_on = TRUE
          ) as user_has_purchased
        `;
			}

			sql += `
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.is_published = true AND r.is_add_on = true
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = userId
				? await client.query(sql, [userId])
				: await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve add-ons: ${error}`);
		}
	}

	/**
	 * Check if user has purchased specific add-on
	 */
	async hasUserPurchasedAddOn(userId, resourceId) {
		try {
			const sql = `
        SELECT EXISTS(
          SELECT 1 FROM orders o 
          WHERE o.resource_id = $1 
          AND o.user_id = $2 
          AND o.order_status = 'completed'
          AND o.is_add_on = TRUE
        ) as has_purchased
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [resourceId, userId]);
			client.release();
			return res.rows[0].has_purchased;
		} catch (error) {
			throw new Error(`Could not check add-on purchase status: ${error}`);
		}
	}

	/**
	 * Get user's purchased add-ons
	 */
	async getUserPurchasedAddOns(userId) {
		try {
			const sql = `
        SELECT 
          r.*,
          o.completed_at as purchase_date,
          o.add_on_price as paid_price
        FROM resources r
        JOIN orders o ON r.id = o.resource_id
        WHERE o.user_id = $1 
        AND o.order_status = 'completed'
        AND o.is_add_on = TRUE
        AND r.is_published = true
        ORDER BY o.completed_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user's purchased add-ons: ${error}`);
		}
	}

	/**
	 * Get user's accessible resources (free + purchased add-ons)
	 */
	async getUserAccessibleResources(userId) {
		try {
			const sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses,
          CASE 
            WHEN r.is_add_on = FALSE THEN 'free'
            ELSE 'purchased'
          END as access_type
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.is_published = true
        AND (
          r.is_add_on = FALSE 
          OR EXISTS(
            SELECT 1 FROM orders o 
            WHERE o.resource_id = r.id 
            AND o.user_id = $1 
            AND o.order_status = 'completed'
            AND o.is_add_on = TRUE
          )
        )
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve user's accessible resources: ${error}`);
		}
	}

	// ========================
	// FILTERING & SEARCH (Updated to include add-on status)
	// ========================

	/**
	 * Get resources by type with purchase status
	 */
	async getByType(type, userId = null) {
		try {
			let sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
      `;

			if (userId) {
				sql += `,
          CASE 
            WHEN r.is_add_on = TRUE THEN 
              EXISTS(
                SELECT 1 FROM orders o 
                WHERE o.resource_id = r.id 
                AND o.user_id = $3 
                AND o.order_status = 'completed'
                AND o.is_add_on = TRUE
              )
            ELSE TRUE
          END as user_has_access
        `;
			}

			sql += `
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.type = $1 AND r.is_published = true
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = userId
				? await client.query(sql, [type, userId])
				: await client.query(sql, [type]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve resources by type: ${error}`);
		}
	}

	/**
	 * Search resources with purchase status
	 */
	async search(searchTerm, userId = null) {
		try {
			let sql = `
        SELECT 
          r.*,
          array_agg(rc.course_id) FILTER (WHERE rc.course_id IS NOT NULL) as related_courses
      `;

			if (userId) {
				sql += `,
          CASE 
            WHEN r.is_add_on = TRUE THEN 
              EXISTS(
                SELECT 1 FROM orders o 
                WHERE o.resource_id = r.id 
                AND o.user_id = $3 
                AND o.order_status = 'completed'
                AND o.is_add_on = TRUE
              )
            ELSE TRUE
          END as user_has_access
        `;
			}

			sql += `
        FROM resources r
        LEFT JOIN resource_courses rc ON r.id = rc.resource_id
        WHERE r.is_published = true
        AND (r.title ILIKE $1 OR r.description ILIKE $1 OR r.content ILIKE $1)
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `;

			const client = await this.pool.connect();
			const res = userId
				? await client.query(sql, [`%${searchTerm}%`, userId])
				: await client.query(sql, [`%${searchTerm}%`]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't search resources: ${error}`);
		}
	}

	// ========================
	// EXISTING METHODS (unchanged)
	// ========================

	async getByAuthor(author) {
		// ... existing implementation
	}

	async getByCourse(courseId) {
		// ... existing implementation
	}

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
			throw new Error(`Can't retrieve admin resources: ${error}`);
		}
	}

	async getStats() {
		// ... existing implementation
	}

	async getAuthors() {
		// ... existing implementation
	}

	async addRelatedCourses(client, resourceId, courseIds) {
		try {
			if (!courseIds || courseIds.length === 0) {
				return;
			}

			// Build the INSERT query with multiple values
			const values = courseIds.map((courseId, index) => {
				const resourceParam = index * 2 + 1;
				const courseParam = index * 2 + 2;
				return `($${resourceParam}, $${courseParam})`;
			}).join(', ');

			const sql = `
				INSERT INTO resource_courses (resource_id, course_id) 
				VALUES ${values}
				ON CONFLICT (resource_id, course_id) DO NOTHING
			`;

			// Flatten the parameters: [resourceId, courseId1, resourceId, courseId2, ...]
			const params = courseIds.flatMap(courseId => [resourceId, courseId]);

			await client.query(sql, params);
		} catch (error) {
			throw new Error(`Could not add related courses: ${error}`);
		}
	}

	async incrementViewCount(id) {
		// ... existing implementation
	}
}

/**
 * Updated validation schema for resource data including add-on fields
 */
function validateResource(resource) {
	const resourceSchema = Joi.object({
		title: Joi.string().min(1).max(200).required(),
		type: Joi.string().valid('blog', 'video', 'audio', 'manual').required(),
		content: Joi.string().allow('', null),
		video_url: Joi.string().uri().allow('', null),
		audio_url: Joi.string().uri().allow('', null),
		thumbnail: Joi.string().uri().allow('', null),
		description: Joi.string().max(1000).allow('', null),
		author: Joi.string().min(1).max(100).required(),
		duration: Joi.string().max(20).allow('', null),
		is_published: Joi.boolean().default(false),
		is_add_on: Joi.boolean().default(false),
		price: Joi.number().precision(2).min(0).allow(null),
		stripe_price_id: Joi.string().allow('', null),
		related_courses: Joi.array()
			.items(Joi.number().integer().positive())
			.default([]),
	}).custom((value, helpers) => {
		// If is_add_on is true, price should be provided
		if (value.is_add_on && !value.price) {
			return helpers.error('custom.addon-price-required');
		}
		return value;
	}, 'Add-on price validation');

	return resourceSchema.validate(resource, {
		messages: {
			'custom.addon-price-required':
				'Price is required when resource is marked as add-on',
		},
	});
}

module.exports = {
	ResourceStore,
	validateResource,
};
