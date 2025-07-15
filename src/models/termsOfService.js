require('dotenv').config();
const Joi = require('joi');

class TermsOfServiceStore {
	constructor(pool) {
		this.pool = pool;
	}

	/**
	 * Get all terms of service records (admin only)
	 */
	async index() {
		try {
			const sql = `
				SELECT 
					tos.*,
					u.username,
					u.name as user_name,
					u.email
				FROM terms_of_service tos
				LEFT JOIN users u ON tos.user_id = u.id
				ORDER BY tos.accepted_at DESC
			`;
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve terms of service records: ${error}`);
		}
	}

	/**
	 * Get terms of service record by user ID
	 */
	async getByUserId(userId) {
		try {
			const sql = `
				SELECT * FROM terms_of_service 
				WHERE user_id = $1 
				ORDER BY accepted_at DESC 
				LIMIT 1
			`;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows[0] || null;
		} catch (error) {
			throw new Error(`Can't find terms of service record: ${error}`);
		}
	}

	/**
	 * Check if user has accepted current terms of service
	 */
	async hasAcceptedCurrentTerms(userId, currentVersion = '1.0') {
		try {
			const sql = `
				SELECT * FROM terms_of_service 
				WHERE user_id = $1 
				AND accepted = true 
				AND version = $2
				ORDER BY accepted_at DESC 
				LIMIT 1
			`;
			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, currentVersion]);
			client.release();
			return res.rows.length > 0;
		} catch (error) {
			throw new Error(`Can't check terms acceptance: ${error}`);
		}
	}

	/**
	 * Accept terms of service for a user
	 */
	async acceptTerms(
		userId,
		version = '1.0',
		ipAddress = null,
		userAgent = null
	) {
		try {
			// Check if user already accepted this version
			const hasAccepted = await this.hasAcceptedCurrentTerms(userId, version);
			if (hasAccepted) {
				// User has already accepted - return the existing record instead of throwing error
				const existingRecord = await this.getByUserId(userId);
				if (existingRecord && existingRecord.version === version && existingRecord.accepted) {
					return existingRecord;
				}
			}

			const sql = `
				INSERT INTO terms_of_service 
				(user_id, accepted, version, ip_address, user_agent, accepted_at) 
				VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) 
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				userId,
				true,
				version,
				ipAddress,
				userAgent,
			]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not accept terms of service: ${error}`);
		}
	}

	/**
	 * Revoke terms of service acceptance (admin only)
	 */
	async revokeTerms(userId, reason = null) {
		try {
			const sql = `
				UPDATE terms_of_service 
				SET 
					accepted = false,
					revoked_at = CURRENT_TIMESTAMP,
					revocation_reason = $2
				WHERE user_id = $1 AND accepted = true
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, reason]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not revoke terms of service: ${error}`);
		}
	}

	/**
	 * Get users who haven't accepted current terms
	 */
	async getUsersWithoutCurrentTerms(currentVersion = '1.0') {
		try {
			const sql = `
				SELECT 
					u.id,
					u.username,
					u.name,
					u.email,
					u.created_at as user_created_at
				FROM users u
				LEFT JOIN terms_of_service tos ON u.id = tos.user_id 
					AND tos.accepted = true 
					AND tos.version = $1
				WHERE tos.id IS NULL
				ORDER BY u.created_at DESC
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [currentVersion]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get users without current terms: ${error}`);
		}
	}

	/**
	 * Get acceptance statistics
	 */
	async getAcceptanceStats(version = '1.0') {
		try {
			const sql = `
				SELECT 
					COUNT(DISTINCT u.id) as total_users,
					COUNT(DISTINCT tos.user_id) as accepted_users,
					ROUND(
						(COUNT(DISTINCT tos.user_id)::decimal / COUNT(DISTINCT u.id)) * 100, 
						2
					) as acceptance_rate
				FROM users u
				LEFT JOIN terms_of_service tos ON u.id = tos.user_id 
					AND tos.accepted = true 
					AND tos.version = $1
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [version]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get acceptance statistics: ${error}`);
		}
	}

	/**
	 * Delete terms of service record (admin only)
	 */
	async delete(id) {
		try {
			const sql = 'DELETE FROM terms_of_service WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete terms of service record: ${error}`);
		}
	}
}

/**
 * Validation schema for terms of service operations
 */
function handleTermsErrors(data) {
	const termsSchema = Joi.object({
		user_id: Joi.number().integer().required(),
		version: Joi.string().default('1.0'),
		ip_address: Joi.string().ip().allow(null),
		user_agent: Joi.string().allow(null),
		reason: Joi.string().allow(null), // for revocation
	});

	return termsSchema.validate(data);
}

module.exports = { TermsOfServiceStore, handleTermsErrors };
