const { Client } = require('pg');

class CoursePreviewStore {
	constructor(pool) {
		this.pool = pool;
	}

	async index() {
		try {
			const sql = `
				SELECT cp.*, c.title as course_title
				FROM course_previews cp
				LEFT JOIN courses c ON cp.course_id = c.id
				WHERE cp.is_active = true
				ORDER BY cp.created_at DESC
			`;
			const result = await this.pool.query(sql);
			return result.rows;
		} catch (error) {
			throw new Error(`Could not get course previews: ${error.message}`);
		}
	}

	async show(id) {
		try {
			const sql = `
				SELECT cp.*, c.title as course_title
				FROM course_previews cp
				LEFT JOIN courses c ON cp.course_id = c.id
				WHERE cp.id = $1
			`;
			const result = await this.pool.query(sql, [id]);
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not get course preview ${id}: ${error.message}`);
		}
	}

	async getActivePreviews() {
		try {
			const sql = `
				SELECT cp.*, c.title as course_title
				FROM course_previews cp
				LEFT JOIN courses c ON cp.course_id = c.id
				WHERE cp.is_active = true
				ORDER BY cp.created_at DESC
			`;
			const result = await this.pool.query(sql);
			return result.rows;
		} catch (error) {
			throw new Error(`Could not get active course previews: ${error.message}`);
		}
	}

	async create(preview) {
		try {
			const { course_id, name, description, cta, coupon, url, is_active = true } = preview;
			const sql = `
				INSERT INTO course_previews (course_id, name, description, cta, coupon, url, is_active)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				RETURNING *
			`;
			const result = await this.pool.query(sql, [
				course_id,
				name,
				description,
				cta,
				coupon,
				url,
				is_active
			]);
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not create course preview: ${error.message}`);
		}
	}

	async update(id, preview) {
		try {
			const { course_id, name, description, cta, coupon, url, is_active } = preview;
			const sql = `
				UPDATE course_previews 
				SET course_id = $2, name = $3, description = $4, cta = $5, coupon = $6, url = $7, is_active = $8, updated_at = CURRENT_TIMESTAMP
				WHERE id = $1
				RETURNING *
			`;
			const result = await this.pool.query(sql, [
				id,
				course_id,
				name,
				description,
				cta,
				coupon,
				url,
				is_active
			]);
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not update course preview ${id}: ${error.message}`);
		}
	}

	async delete(id) {
		try {
			const sql = 'DELETE FROM course_previews WHERE id = $1 RETURNING *';
			const result = await this.pool.query(sql, [id]);
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not delete course preview ${id}: ${error.message}`);
		}
	}
}

module.exports = { CoursePreviewStore };