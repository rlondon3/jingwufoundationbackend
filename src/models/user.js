require('dotenv').config();
const bcrypt = require('bcryptjs');
const Joi = require('joi');

const { SALT_ROUNDS, PEPPER } = process.env;

class UserStore {
	constructor(pool) {
		this.pool = pool;
	}

	async index() {
		try {
			const sql = 'SELECT * FROM users;';
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve users: ${error}`);
		}
	}

	async show(id) {
		try {
			const sql = 'SELECT * FROM users WHERE id=($1);';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Can't find user: ${error}`);
		}
	}

	async create(user) {
		try {
			const client = await this.pool.connect();
			const sql = `
        INSERT INTO users (name, email, avatar, username, password, is_admin, city, country, martial_art, experience, current_courses) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
      `;

			const hash = bcrypt.hashSync(
				user.password + `${PEPPER}`,
				parseInt(`${SALT_ROUNDS}`)
			);

			const res = await client.query(sql, [
				user.name,
				user.email,
				user.avatar,
				user.username,
				hash,
				user.is_admin,
				user.city,
				user.country,
				user.martial_art,
				user.experience,
				user.current_courses || [],
			]);

			// Create privacy settings for new user
			const privacySql = `
        INSERT INTO privacy_settings (user_id, profile, progress, courses) 
        VALUES ($1, $2, $3, $4) RETURNING *
      `;

			await client.query(privacySql, [
				res.rows[0].id,
				user.privacy?.profile || 'public',
				user.privacy?.progress || 'public',
				user.privacy?.courses || 'public',
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not add user: ${error}`);
		}
	}

	async update(user, id) {
		try {
			const sql = `
        UPDATE users SET 
          name=($1), 
          email=($2), 
          avatar=($3), 
          username=($4),
          password=($5),
          is_admin=($6), 
          city=($7), 
          country=($8), 
          martial_art=($9), 
          experience=($10), 
          current_courses=($11),
          updated_at=CURRENT_TIMESTAMP
        WHERE id=($12) RETURNING *
      `;

			const hash = bcrypt.hashSync(
				user.password + `${PEPPER}`,
				parseInt(`${SALT_ROUNDS}`)
			);

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				user.name,
				user.email,
				user.avatar,
				user.username,
				hash,
				user.is_admin,
				user.city,
				user.country,
				user.martial_art,
				user.experience,
				user.current_courses || [],
				id,
			]);

			// Update privacy settings if provided
			if (user.privacy) {
				const privacySql = `
          UPDATE privacy_settings SET 
            profile=($1), 
            progress=($2), 
            courses=($3),
            updated_at=CURRENT_TIMESTAMP
          WHERE user_id=($4)
        `;

				await client.query(privacySql, [
					user.privacy.profile,
					user.privacy.progress,
					user.privacy.courses,
					id,
				]);
			}

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update user: ${error}`);
		}
	}

	async delete(id) {
		try {
			const sql = 'DELETE FROM users WHERE id=($1) RETURNING *;';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete user: ${error}`);
		}
	}

	async getUserWithPrivacy(id) {
		try {
			const sql = `
        SELECT 
          u.*,
          p.profile,
          p.progress,
          p.courses
        FROM users u
        LEFT JOIN privacy_settings p ON u.id = p.user_id
        WHERE u.id = $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();

			if (res.rows.length === 0) {
				return null;
			}

			const user = res.rows[0];
			return {
				...user,
				privacy: {
					profile: user.profile,
					progress: user.progress,
					courses: user.courses,
				},
			};
		} catch (error) {
			throw new Error(`Could not get user with privacy: ${error}`);
		}
	}

	async getUserCourses(userId) {
		try {
			const sql = `
        SELECT * FROM user_courses 
        WHERE user_id = $1 
        ORDER BY start_date DESC
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get user courses: ${error}`);
		}
	}

	async enrollUserInCourse(userId, courseId, startDate) {
		try {
			const sql = `
        INSERT INTO user_courses (user_id, course_id, start_date, progress) 
        VALUES ($1, $2, $3, $4) RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId, startDate, 0]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not enroll user in course: ${error}`);
		}
	}

	async updateCourseProgress(userId, courseId, progress) {
		try {
			const sql = `
        UPDATE user_courses SET 
          progress = $1,
          completed_date = CASE WHEN $1 = 100 THEN CURRENT_DATE ELSE completed_date END,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2 AND course_id = $3 
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [progress, userId, courseId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update course progress: ${error}`);
		}
	}

	async emailExists(email) {
		const client = await this.pool.connect();
		try {
			const sql = 'SELECT COUNT(*) FROM users WHERE email = $1';
			const res = await client.query(sql, [email]);
			if (res.rows) {
				return parseInt(res.rows[0].count) > 0;
			}
			return false;
		} finally {
			client.release();
		}
	}

	async authenticate(username, password) {
		try {
			const sql = 'SELECT * FROM users WHERE username=($1)';
			const client = await this.pool.connect();
			const res = await client.query(sql, [username]);

			if (res.rows.length) {
				const isValid = bcrypt.compareSync(
					password + `${PEPPER}`,
					res.rows[0].password
				);
				if (isValid) {
					client.release();
					return res.rows[0];
				}
			}

			client.release();
			return null;
		} catch (error) {
			throw new Error(`Could not authenticate: ${error}`);
		}
	}

	async usernameExists(username) {
		const client = await this.pool.connect();
		try {
			const sql = 'SELECT COUNT(*) FROM users WHERE username = $1';
			const res = await client.query(sql, [username]);
			if (res.rows) {
				return parseInt(res.rows[0].count) > 0;
			}
			return false;
		} finally {
			client.release();
		}
	}

	async getAdmins() {
		try {
			const sql = 'SELECT * FROM users WHERE is_admin = true;';
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve admins: ${error}`);
		}
	}

	async getStudents() {
		try {
			const sql = 'SELECT * FROM users WHERE is_admin = false;';
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve students: ${error}`);
		}
	}
}

function handleUserErrors(user) {
	const userSchema = Joi.object({
		name: Joi.string().required(),
		email: Joi.string().email().required(),
		avatar: Joi.string().uri().allow(''),
		username: Joi.string().required(),
		password: Joi.string()
			.required()
			.pattern(
				/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
			)
			.message(
				'Password must be at least 8 characters long, contain one uppercase letter, one lowercase letter, one number, and one special character'
			),
		is_admin: Joi.boolean().default(false),
		city: Joi.string().required(),
		country: Joi.string().required(),
		martial_art: Joi.string().required(),
		experience: Joi.number().integer().min(0).required(),
		current_courses: Joi.array().items(Joi.number().integer()).default([]),
		privacy: Joi.object({
			profile: Joi.string().valid('public', 'private').default('public'),
			progress: Joi.string().valid('public', 'private').default('public'),
			courses: Joi.string().valid('public', 'private').default('public'),
		}).optional(),
	});

	return userSchema.validate(user);
}

module.exports = { UserStore, handleUserErrors };
