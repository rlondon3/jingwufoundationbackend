require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Joi = require('joi');

const { SALT_ROUNDS, PEPPER } = process.env;

class PasswordResetStore {
	constructor(pool) {
		this.pool = pool;
	}

	async createResetRequest(email, securityAnswers) {
		let client;
		try {
			// First verify user exists
			const userSql = 'SELECT * FROM users WHERE email = $1';
			client = await this.pool.connect();
			const userRes = await client.query(userSql, [email]);

			if (userRes.rows.length === 0) {
				client.release();
				return { success: false, message: 'User not found' };
			}

			const user = userRes.rows[0];

			// Verify security answers using existing user data
			const isValid = this.verifySecurityAnswers(user, securityAnswers);

			if (!isValid) {
				client.release();
				return { success: false, message: 'Security verification failed' };
			}

			// Generate temporary password
			const tempPassword = this.generateTempPassword();
			const hashedTempPassword = bcrypt.hashSync(
				tempPassword + `${PEPPER}`,
				parseInt(`${SALT_ROUNDS}`)
			);

			// Create reset request record
			const resetSql = `
				INSERT INTO password_reset_requests (user_id, temp_password_hash, expires_at, is_used) 
				VALUES ($1, $2, $3, $4) 
				ON CONFLICT (user_id) 
				DO UPDATE SET 
					temp_password_hash = $2, 
					expires_at = $3, 
					is_used = $4, 
					created_at = CURRENT_TIMESTAMP
				RETURNING *
			`;

			// Temp password expires in 30 minutes
			const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

			const resetRes = await client.query(resetSql, [
				user.id,
				hashedTempPassword,
				expiresAt,
				false,
			]);

			client.release();

			return {
				success: true,
				tempPassword: tempPassword,
				user: {
					id: user.id,
					email: user.email,
					username: user.username,
					name: user.name,
				},
				expiresAt: expiresAt,
			};
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not create reset request: ${error}`);
		}
	}

	async authenticateWithTempPassword(username, tempPassword) {
		let client;
		try {
			const sql = `
				SELECT 
					u.*,
					prr.temp_password_hash,
					prr.expires_at,
					prr.is_used
				FROM users u
				JOIN password_reset_requests prr ON u.id = prr.user_id
				WHERE u.username = $1 AND prr.is_used = false AND prr.expires_at > CURRENT_TIMESTAMP
			`;

			client = await this.pool.connect();
			const res = await client.query(sql, [username]);

			if (res.rows.length === 0) {
				client.release();
				return null;
			}

			const user = res.rows[0];

			// Verify temp password
			const isValidTemp = bcrypt.compareSync(
				tempPassword + `${PEPPER}`,
				user.temp_password_hash
			);

			if (!isValidTemp) {
				client.release();
				return null;
			}

			// Mark temp password as used
			const updateSql =
				'UPDATE password_reset_requests SET is_used = true WHERE user_id = $1';
			await client.query(updateSql, [user.id]);

			client.release();

			return {
				id: user.id,
				name: user.name,
				email: user.email,
				username: user.username,
				is_admin: user.is_admin,
				requiresPasswordChange: true,
			};
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not authenticate with temp password: ${error}`);
		}
	}

	async setNewPassword(userId, newPassword) {
		let client;
		try {
			const hash = bcrypt.hashSync(
				newPassword + `${PEPPER}`,
				parseInt(`${SALT_ROUNDS}`)
			);

			client = await this.pool.connect();

			// Update user password
			const updateUserSql = `
				UPDATE users SET 
					password = $1, 
					updated_at = CURRENT_TIMESTAMP 
				WHERE id = $2 
				RETURNING id, name, email, username, is_admin
			`;

			const userRes = await client.query(updateUserSql, [hash, userId]);

			// Clean up any existing reset requests for this user
			const cleanupSql =
				'DELETE FROM password_reset_requests WHERE user_id = $1';
			await client.query(cleanupSql, [userId]);

			client.release();

			return userRes.rows[0];
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not set new password: ${error}`);
		}
	}

	async cleanupExpiredRequests() {
		let client;
		try {
			const sql =
				'DELETE FROM password_reset_requests WHERE expires_at < CURRENT_TIMESTAMP OR is_used = true';
			client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rowCount;
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not cleanup expired requests: ${error}`);
		}
	}

	async getResetRequest(userId) {
		let client;
		try {
			const sql = `
				SELECT * FROM password_reset_requests 
				WHERE user_id = $1 AND is_used = false AND expires_at > CURRENT_TIMESTAMP
			`;

			client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();

			return res.rows[0] || null;
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not get reset request: ${error}`);
		}
	}

	verifySecurityAnswers(user, securityAnswers) {
		try {
			// Normalize answers for comparison (lowercase, trim spaces)
			const normalize = (str) => str.toString().toLowerCase().trim();

			// Check username (case-insensitive)
			if (normalize(securityAnswers.username) !== normalize(user.username)) {
				return false;
			}

			// Check city (case-insensitive)
			if (normalize(securityAnswers.city) !== normalize(user.city)) {
				return false;
			}

			// Check country (case-insensitive)
			if (normalize(securityAnswers.country) !== normalize(user.country)) {
				return false;
			}

			return true;
		} catch (error) {
			console.error('Security verification error:', error);
			return false;
		}
	}

	async getSecurityQuestions(email) {
		let client;
		try {
			const sql = 'SELECT username, city, country FROM users WHERE email = $1';
			client = await this.pool.connect();
			const res = await client.query(sql, [email]);
			client.release();

			if (res.rows.length === 0) {
				// Return generic questions to avoid user enumeration
				return {
					questions: [
						'What is your username?',
						'What city are you in?',
						'What country are you in?',
					],
					found: false,
				};
			}

			const user = res.rows[0];
			return {
				questions: [
					'What is your username?',
					'What city are you in?',
					'What country are you in?',
				],
				hints: {
					username: `Starts with "${user.username.charAt(0)}..." (${
						user.username.length
					} characters)`,
					city: `Starts with "${user.city.charAt(0)}..." (${
						user.city.length
					} characters)`,
					country: `Starts with "${user.country.charAt(0)}..." (${
						user.country.length
					} characters)`,
				},
				found: true,
			};
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Could not get security questions: ${error}`);
		}
	}
	generateTempPassword() {
		// Generate a secure temporary password
		const chars =
			'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
		let tempPassword = '';

		for (let i = 0; i < 12; i++) {
			tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
		}

		return tempPassword;
	}
}

function handlePasswordResetErrors(data) {
	const resetSchema = Joi.object({
		email: Joi.string().email().required(),
		securityAnswers: Joi.object({
			username: Joi.string().required().min(1).max(50),
			city: Joi.string().required().min(1).max(100),
			country: Joi.string().required().min(1).max(100),
		}).required(),
	});

	return resetSchema.validate(data);
}

function handleNewPasswordErrors(data) {
	const passwordSchema = Joi.object({
		newPassword: Joi.string()
			.required()
			.pattern(
				/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
			)
			.message(
				'Password must be at least 8 characters long, contain one uppercase letter, one lowercase letter, one number, and one special character'
			),
		confirmPassword: Joi.string()
			.required()
			.valid(Joi.ref('newPassword'))
			.message('Passwords must match'),
	});

	return passwordSchema.validate(data);
}

module.exports = {
	PasswordResetStore,
	handlePasswordResetErrors,
	handleNewPasswordErrors,
};
