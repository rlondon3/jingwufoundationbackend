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
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
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
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
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
          p.profile AS privacy_profile,
          p.progress AS privacy_progress,
          p.courses AS privacy_courses
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
			const privacyObject = {
				profile: user.privacy_profile || 'public',
				progress: user.privacy_progress || 'public',
				courses: user.privacy_courses || 'public',
			};
			return {
				...user,
				privacy: privacyObject,
			};
		} catch (error) {
			throw new Error(`Could not get user with privacy: ${error}`);
		}
	}

	async getUserCourses(userId) {
		try {
			const sql = `
        SELECT * FROM user_courses 
        WHERE user_id = $1 AND is_active = true 
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

	async getCourseEnrollmentCounts() {
		try {
			const sql = `
				SELECT 
					c.id as course_id,
					c.title as course_title,
					c.description as course_description,
					COUNT(uc.user_id) as enrollment_count,
					COUNT(CASE WHEN uc.progress = 100 THEN 1 END) as completed_count,
					COUNT(CASE WHEN uc.progress < 100 THEN 1 END) as active_count
				FROM courses c
				LEFT JOIN user_courses uc ON c.id = uc.course_id
				GROUP BY c.id, c.title, c.description
				ORDER BY enrollment_count DESC
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get course enrollment counts: ${error}`);
		}
	}

	async getAllEnrollments() {
		try {
			const sql = `
				SELECT 
					uc.*,
					u.name as user_name,
					u.username,
					u.email,
					u.avatar as user_avatar,
					c.title as course_title,
					c.description as course_description
				FROM user_courses uc
				LEFT JOIN users u ON uc.user_id = u.id
				LEFT JOIN courses c ON uc.course_id = c.id
				ORDER BY uc.start_date DESC
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get all enrollments: ${error}`);
		}
	}

	async getEnrollment(userId, courseId) {
		try {
			const sql = `
				 SELECT 
                uc.*,
                u.name as user_name,
                u.username,
                u.email,
                u.avatar as user_avatar,
                c.title as course_title,
                c.description as course_description
				FROM user_courses uc
				LEFT JOIN courses c ON uc.course_id = c.id
				WHERE uc.user_id = $1 AND uc.course_id = $2
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return res.rows[0] || null;
		} catch (error) {
			throw new Error(`Could not get enrollment: ${error}`);
		}
	}

	async enrollUserInCourse(userId, courseId, startDate) {
		try {
			const sql = `
        INSERT INTO user_courses (user_id, course_id, start_date, progress, is_active) 
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId, startDate, 0, true]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not enroll user in course: ${error}`);
		}
	}

	async isUserEnrolled(userId, courseId) {
		try {
			const sql = `
				SELECT COUNT(*) FROM user_courses 
				WHERE user_id = $1 AND course_id = $2 AND is_active = true
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return parseInt(res.rows[0].count) > 0;
		} catch (error) {
			throw new Error(`Could not check enrollment: ${error}`);
		}
	}

	async isUserEnrolledAny(userId, courseId) {
		try {
			const sql = `
				SELECT COUNT(*) FROM user_courses 
				WHERE user_id = $1 AND course_id = $2
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return parseInt(res.rows[0].count) > 0;
		} catch (error) {
			throw new Error(`Could not check enrollment: ${error}`);
		}
	}

	async updateEnrollmentStatus(userId, courseId, isActive) {
		try {
			const sql = `
				UPDATE user_courses 
				SET is_active = $3, updated_at = CURRENT_TIMESTAMP
				WHERE user_id = $1 AND course_id = $2 
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId, isActive]);
			client.release();
			
			if (res.rows.length === 0) {
				throw new Error('Enrollment not found');
			}
			
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update enrollment status: ${error}`);
		}
	}

	async suspendUserFromCourse(userId, courseId) {
		try {
			const sql = `
				UPDATE user_courses 
				SET is_active = false, updated_at = CURRENT_TIMESTAMP
				WHERE user_id = $1 AND course_id = $2 
				RETURNING *
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return res.rows[0] || null;
		} catch (error) {
			throw new Error(`Could not suspend user from course: ${error}`);
		}
	}

	async unenrollUserFromCourse(userId, courseId) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');

			// Delete user's lesson progress data for this course
			await client.query(`
				DELETE FROM user_lesson_progress 
				WHERE user_id = $1 
				AND lesson_id IN (
					SELECT l.id FROM lessons l 
					JOIN modules m ON l.module_id = m.id 
					WHERE m.course_id = $2
				)
			`, [userId, courseId]);

			// Delete user's quiz responses for this course
			await client.query(`
				DELETE FROM user_quiz_responses 
				WHERE user_id = $1 
				AND lesson_id IN (
					SELECT l.id FROM lessons l 
					JOIN modules m ON l.module_id = m.id 
					WHERE m.course_id = $2
				)
			`, [userId, courseId]);

			// Delete user's guided feedback responses for this course
			// Note: We preserve reviews as they are valuable course feedback data
			await client.query(`
				DELETE FROM course_feedback_responses 
				WHERE user_id = $1 
				AND review_id IN (
					SELECT r.id FROM reviews r 
					WHERE r.user_id = $1 AND r.course_id = $2
				)
			`, [userId, courseId]);

			// Finally, delete the main enrollment record
			const enrollmentResult = await client.query(`
				DELETE FROM user_courses 
				WHERE user_id = $1 AND course_id = $2 
				RETURNING *
			`, [userId, courseId]);

			await client.query('COMMIT');
			return enrollmentResult.rows[0] || null;
		} catch (error) {
			await client.query('ROLLBACK');
			throw new Error(`Could not unenroll user from course: ${error}`);
		} finally {
			client.release();
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
		let client;
		try {
			const sql = 'SELECT * FROM users WHERE username=($1)';
			client = await this.pool.connect();
			const res = await client.query(sql, [username]);

			if (res.rows.length) {
				const user = res.rows[0];
				
				// Check if account is active
				if (!user.is_active) {
					client.release();
					throw new Error('Account has been deactivated. Please contact support for reactivation.');
				}
				
				const isValid = bcrypt.compareSync(
					password + `${PEPPER}`,
					user.password
				);
				if (isValid) {
					client.release();
					return user;
				}
			} else {
				client.release();
				return null;
			}
		} catch (error) {
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
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

	async calculateCourseProgress(userId, courseId) {
		try {
			const sql = `
				SELECT 
					COUNT(l.id) as total_lessons,
					COUNT(ulp.id) FILTER (WHERE ulp.completed = true) as completed_lessons,
					CASE 
						WHEN COUNT(l.id) > 0 
						THEN ROUND((COUNT(ulp.id) FILTER (WHERE ulp.completed = true) * 100.0 / COUNT(l.id))::numeric, 0)
						ELSE 0 
					END as calculated_progress
				FROM courses c
				JOIN modules m ON c.id = m.course_id
				JOIN lessons l ON m.id = l.module_id
				LEFT JOIN user_lesson_progress ulp ON l.id = ulp.lesson_id AND ulp.user_id = $1
				WHERE c.id = $2
				GROUP BY c.id
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();

			const result = res.rows[0];
			if (result) {
				const newProgress = parseInt(result.calculated_progress);
				console.log(`[GUIDED FEEDBACK DEBUG] calculateCourseProgress - User ${userId}, Course ${courseId}, Progress ${newProgress}%`);
				
				// Update the user_courses table with calculated progress
				await this.updateCourseProgress(
					userId,
					courseId,
					newProgress
				);
				
				// Check for feedback triggers after progress update
				try {
					const { GuidedFeedbackStore } = require('./guidedFeedback');
					const feedbackStore = new GuidedFeedbackStore(this.pool);
					
					console.log(`[GUIDED FEEDBACK DEBUG] Checking feedback triggers...`);
					const shouldTrigger = await feedbackStore.shouldTriggerFeedback(
						userId,
						courseId,
						newProgress
					);
					console.log(`[GUIDED FEEDBACK DEBUG] shouldTrigger result:`, shouldTrigger);
					
					if (shouldTrigger) {
						console.log(`[GUIDED FEEDBACK DEBUG] Returning feedback trigger data:`, shouldTrigger);
						// Return progress with feedback trigger info
						return {
							progress: newProgress,
							feedbackTrigger: shouldTrigger
						};
					} else {
						console.log(`[GUIDED FEEDBACK DEBUG] No feedback trigger needed for this progress level`);
					}
				} catch (feedbackError) {
					console.error('[GUIDED FEEDBACK DEBUG] Error checking feedback triggers:', feedbackError);
					console.warn('Failed to check feedback triggers:', feedbackError.message);
					// Don't fail progress update if feedback check fails
				}
				
				return newProgress;
			}

			return 0;
		} catch (error) {
			throw new Error(`Could not calculate course progress: ${error}`);
		}
	}

	async updateUserStatus(userId, isActive) {
		try {
			const sql = `
				UPDATE users 
				SET is_active = $2, updated_at = CURRENT_TIMESTAMP 
				WHERE id = $1 
				RETURNING id, name, email, username, is_admin, is_active
			`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, isActive]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update user status: ${error}`);
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
			.optional()
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
