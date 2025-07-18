require('dotenv').config();
const Joi = require('joi');

/**
 * ClassesStore handles all in-person class operations
 * Manages recurring classes, enrollment, and waitlist functionality
 */
class ClassesStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// CLASS OPERATIONS
	// ========================

	/**
	 * Get all published classes with their sessions
	 */
	async getPublishedClasses() {
		let client;
		try {
			const sql = `
        SELECT 
          c.*,
          (COUNT(ce.id) + COUNT(cme.id)) as current_enrollment,
          COUNT(cw.id) as waitlist_count
        FROM classes c
        LEFT JOIN class_enrollments ce ON c.id = ce.class_id AND ce.status = 'enrolled'
        LEFT JOIN class_manual_enrollments cme ON c.id = cme.class_id AND cme.status = 'enrolled'
        LEFT JOIN class_waitlist cw ON c.id = cw.class_id AND cw.status = 'waiting'
        WHERE c.is_published = true
        GROUP BY c.id
        ORDER BY c.class_name, c.start_time
      `;

			client = await this.pool.connect();
			const res = await client.query(sql);

			// Get sessions for each class
			const classes = res.rows;
			for (let classItem of classes) {
				const sessionsQuery = `
					SELECT id, day_of_week, start_time, end_time 
					FROM class_sessions 
					WHERE class_id = $1 
					ORDER BY 
						CASE day_of_week 
							WHEN 'monday' THEN 1 
							WHEN 'tuesday' THEN 2 
							WHEN 'wednesday' THEN 3 
							WHEN 'thursday' THEN 4 
							WHEN 'friday' THEN 5 
							WHEN 'saturday' THEN 6 
							WHEN 'sunday' THEN 7 
						END, start_time
				`;
				const sessionsRes = await client.query(sessionsQuery, [classItem.id]);
				classItem.sessions = sessionsRes.rows;
			}

			client.release();
			return classes;
		} catch (error) {
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
			throw new Error(`Can't retrieve published classes: ${error}`);
		}
	}

	/**
	 * Get single class with enrollment info and sessions
	 */
	async getClass(id) {
		try {
			return await this.getClassWithSessions(id);
		} catch (error) {
			throw new Error(`Can't find class: ${error}`);
		}
	}

	/**
	 * Helper method to get class with sessions
	 */
	async getClassWithSessions(id) {
		let client;
		try {
			const sql = `
        SELECT 
          c.*,
          (COUNT(ce.id) + COUNT(cme.id)) as current_enrollment,
          COUNT(cw.id) as waitlist_count
        FROM classes c
        LEFT JOIN class_enrollments ce ON c.id = ce.class_id AND ce.status = 'enrolled'
        LEFT JOIN class_manual_enrollments cme ON c.id = cme.class_id AND cme.status = 'enrolled'
        LEFT JOIN class_waitlist cw ON c.id = cw.class_id AND cw.status = 'waiting'
        WHERE c.id = $1
        GROUP BY c.id
      `;

			client = await this.pool.connect();
			const res = await client.query(sql, [id]);

			if (res.rows.length === 0) {
				client.release();
				return null;
			}

			const classItem = res.rows[0];

			// Get sessions
			const sessionsQuery = `
				SELECT id, day_of_week, start_time, end_time 
				FROM class_sessions 
				WHERE class_id = $1 
				ORDER BY 
					CASE day_of_week 
						WHEN 'monday' THEN 1 
						WHEN 'tuesday' THEN 2 
						WHEN 'wednesday' THEN 3 
						WHEN 'thursday' THEN 4 
						WHEN 'friday' THEN 5 
						WHEN 'saturday' THEN 6 
						WHEN 'sunday' THEN 7 
					END, start_time
			`;
			const sessionsRes = await client.query(sessionsQuery, [id]);
			classItem.sessions = sessionsRes.rows;

			client.release();
			return classItem;
		} catch (error) {
			if (client) {
				client.release();
			}
			throw error;
		}
	}

	/**
	 * Create new class with sessions
	 */
	async createClass(classData) {
		let client;
		try {
			client = await this.pool.connect();
			await client.query('BEGIN');

			// Create the main class (including video_embed_url)
			const sql = `
				INSERT INTO classes (
					class_name, description, instructor_name, location, class_type, 
					skill_focus, class_duration, max_capacity, price, age_restrictions, 
					requires_membership, waitlist_enabled, is_published, video_embed_url
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
				RETURNING *
			`;

			const res = await client.query(sql, [
				classData.class_name,
				classData.description,
				classData.instructor_name,
				classData.location,
				classData.class_type,
				classData.skill_focus,
				classData.class_duration,
				classData.max_capacity,
				classData.price,
				classData.age_restrictions || 'All ages',
				classData.requires_membership || false,
				classData.waitlist_enabled || true,
				classData.is_published || false,
				classData.video_embed_url || null,
			]);

			const newClass = res.rows[0];

			// Handle sessions - support both old format (single session) and new format (multiple sessions)
			const sessions = classData.sessions || [
				{
					day_of_week: classData.day_of_week,
					start_time: classData.start_time,
					end_time: classData.end_time,
				},
			];

			// Insert sessions
			for (const session of sessions) {
				const sessionSql = `
					INSERT INTO class_sessions (class_id, day_of_week, start_time, end_time)
					VALUES ($1, $2, $3, $4)
				`;
				await client.query(sessionSql, [
					newClass.id,
					session.day_of_week,
					session.start_time,
					session.end_time,
				]);
			}

			await client.query('COMMIT');
			client.release();

			// Return class with sessions
			return await this.getClassWithSessions(newClass.id);
		} catch (error) {
			if (client) {
				await client.query('ROLLBACK');
				client.release();
			}
			throw new Error(`Could not create class: ${error}`);
		}
	}

	// Updated updateClass method to include video_embed_url
	async updateClass(classData, id) {
		let client;
		try {
			client = await this.pool.connect();
			await client.query('BEGIN');

			// Update the main class (including video_embed_url)
			const sql = `
				UPDATE classes SET 
					class_name = $1, description = $2, instructor_name = $3, location = $4,
					class_type = $5, skill_focus = $6, class_duration = $7, max_capacity = $8, 
					price = $9, age_restrictions = $10, requires_membership = $11, 
					waitlist_enabled = $12, is_published = $13, video_embed_url = $14, 
					updated_at = CURRENT_TIMESTAMP
				WHERE id = $15 RETURNING *
			`;

			const res = await client.query(sql, [
				classData.class_name,
				classData.description,
				classData.instructor_name,
				classData.location,
				classData.class_type,
				classData.skill_focus,
				classData.class_duration,
				classData.max_capacity,
				classData.price,
				classData.age_restrictions,
				classData.requires_membership,
				classData.waitlist_enabled,
				classData.is_published,
				classData.video_embed_url || null,
				id,
			]);

			// Handle sessions update
			if (classData.sessions) {
				// Delete existing sessions
				await client.query('DELETE FROM class_sessions WHERE class_id = $1', [
					id,
				]);

				// Insert new sessions
				for (const session of classData.sessions) {
					const sessionSql = `
						INSERT INTO class_sessions (class_id, day_of_week, start_time, end_time)
						VALUES ($1, $2, $3, $4)
					`;
					await client.query(sessionSql, [
						id,
						session.day_of_week,
						session.start_time,
						session.end_time,
					]);
				}
			} else if (
				classData.day_of_week &&
				classData.start_time &&
				classData.end_time
			) {
				// Handle old format - single session
				await client.query('DELETE FROM class_sessions WHERE class_id = $1', [
					id,
				]);
				const sessionSql = `
					INSERT INTO class_sessions (class_id, day_of_week, start_time, end_time)
					VALUES ($1, $2, $3, $4)
				`;
				await client.query(sessionSql, [
					id,
					classData.day_of_week,
					classData.start_time,
					classData.end_time,
				]);
			}

			await client.query('COMMIT');
			client.release();

			// Return class with sessions
			return await this.getClassWithSessions(id);
		} catch (error) {
			if (client) {
				await client.query('ROLLBACK');
				client.release();
			}
			throw new Error(`Could not update class: ${error}`);
		}
	}

	/**
	 * Delete class
	 */
	async deleteClass(id) {
		try {
			const sql = 'DELETE FROM classes WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete class: ${error}`);
		}
	}

	/**
	 * Add interest for non-registered user
	 */
	async addInterest(classId, contactData) {
		try {
			const client = await this.pool.connect();

			// Check if class exists
			const classRes = await client.query(
				'SELECT * FROM classes WHERE id = $1',
				[classId]
			);

			if (classRes.rows.length === 0) {
				client.release();
				throw new Error('Class not found');
			}

			// Check if email already expressed interest for this class
			const existingRes = await client.query(
				'SELECT * FROM class_waitlist WHERE class_id = $1 AND contact_email = $2',
				[classId, contactData.email]
			);

			if (existingRes.rows.length > 0) {
				client.release();
				throw new Error('Email already registered interest for this class');
			}

			// Add interest
			const interestSql = `
			INSERT INTO class_waitlist (class_id, contact_name, contact_email, contact_phone, status)
			VALUES ($1, $2, $3, $4, 'interested') RETURNING *
		`;

			const interestRes = await client.query(interestSql, [
				classId,
				contactData.name,
				contactData.email,
				contactData.phone || null,
			]);

			client.release();

			return {
				status: 'interested',
				message: 'Interest registered successfully',
				interest: interestRes.rows[0],
			};
		} catch (error) {
			throw new Error(`Could not register interest: ${error.message}`);
		}
	}

	/**
	 * Get class interest list (admin)
	 */
	async getClassInterest(classId) {
		try {
			const sql = `
			SELECT 
				cw.*,
				COALESCE(u.name, cw.contact_name) as display_name,
				COALESCE(u.email, cw.contact_email) as display_email,
				u.phone as user_phone,
				CASE 
					WHEN u.id IS NOT NULL THEN 'registered_user'
					ELSE 'visitor'
				END as user_type,
				ROW_NUMBER() OVER (ORDER BY cw.created_at) as position
			FROM class_waitlist cw
			LEFT JOIN users u ON cw.user_id = u.id
			WHERE cw.class_id = $1 AND cw.status IN ('interested', 'waiting')
			ORDER BY 
				CASE cw.status 
					WHEN 'waiting' THEN 1 
					WHEN 'interested' THEN 2 
				END,
				cw.created_at
		`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [classId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get class interest: ${error.message}`);
		}
	}

	/**
	 * Convert interest to waitlist (admin)
	 */
	async convertInterestToWaitlist(interestId) {
		try {
			const sql = `
			UPDATE class_waitlist 
			SET status = 'waiting', updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND status = 'interested'
			RETURNING *
		`;

			const client = await this.pool.connect();
			const res = await client.query(sql, [interestId]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Interest entry not found or already converted');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(
				`Could not convert interest to waitlist: ${error.message}`
			);
		}
	}

	/**
	 * Remove interest/waitlist entry (admin)
	 */
	async removeInterest(interestId) {
		try {
			const sql = 'DELETE FROM class_waitlist WHERE id = $1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [interestId]);
			client.release();

			if (res.rows.length === 0) {
				throw new Error('Interest entry not found');
			}

			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not remove interest: ${error.message}`);
		}
	}

	// ========================
	// ENROLLMENT OPERATIONS
	// ========================

	/**
	 * Enroll user in class
	 */
	async enrollInClass(userId, classId) {
		try {
			const client = await this.pool.connect();

			// Check if class exists and get details
			const classRes = await client.query(
				'SELECT * FROM classes WHERE id = $1',
				[classId]
			);

			if (classRes.rows.length === 0) {
				client.release();
				throw new Error('Class not found');
			}

			const classInfo = classRes.rows[0];

			// Check if user is already enrolled
			const enrollmentRes = await client.query(
				'SELECT * FROM class_enrollments WHERE user_id = $1 AND class_id = $2',
				[userId, classId]
			);

			if (enrollmentRes.rows.length > 0) {
				client.release();
				throw new Error('User already enrolled in this class');
			}

			// Check current enrollment count
			const countRes = await client.query(
				"SELECT COUNT(*) as count FROM class_enrollments WHERE class_id = $1 AND status = 'enrolled'",
				[classId]
			);

			const currentCount = parseInt(countRes.rows[0].count);

			if (currentCount >= classInfo.max_capacity) {
				// Add to waitlist if enabled
				if (classInfo.waitlist_enabled) {
					const waitlistSql = `
            INSERT INTO class_waitlist (user_id, class_id, status)
            VALUES ($1, $2, 'waiting') RETURNING *
          `;
					const waitlistRes = await client.query(waitlistSql, [
						userId,
						classId,
					]);
					client.release();

					return {
						status: 'waitlisted',
						message: 'Class is full. You have been added to the waitlist.',
						waitlist_entry: waitlistRes.rows[0],
					};
				} else {
					client.release();
					throw new Error('Class is full and waitlist is not enabled');
				}
			}

			// Enroll user
			const enrollmentSql = `
        INSERT INTO class_enrollments (user_id, class_id, status)
        VALUES ($1, $2, 'enrolled') RETURNING *
      `;

			const enrollmentResult = await client.query(enrollmentSql, [
				userId,
				classId,
			]);
			client.release();

			return {
				status: 'enrolled',
				message: 'Successfully enrolled in class',
				enrollment: enrollmentResult.rows[0],
			};
		} catch (error) {
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
			throw new Error(`Could not enroll in class: ${error}`);
		}
	}

	/**
	 * Remove user from class
	 */
	async removeFromClass(userId, classId) {
		try {
			const client = await this.pool.connect();

			// Remove from enrollment
			const enrollmentSql =
				'DELETE FROM class_enrollments WHERE user_id = $1 AND class_id = $2 RETURNING *';
			const enrollmentRes = await client.query(enrollmentSql, [
				userId,
				classId,
			]);

			// Remove from waitlist if present
			const waitlistSql =
				'DELETE FROM class_waitlist WHERE user_id = $1 AND class_id = $2 RETURNING *';
			const waitlistRes = await client.query(waitlistSql, [userId, classId]);

			// If someone was enrolled, check waitlist for next person
			if (enrollmentRes.rows.length > 0) {
				await this.promoteFromWaitlist(classId, client);
			}

			client.release();

			return {
				removed_from_enrollment: enrollmentRes.rows.length > 0,
				removed_from_waitlist: waitlistRes.rows.length > 0,
			};
		} catch (error) {
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
			throw new Error(`Could not remove from class: ${error}`);
		}
	}

	/**
	 * Promote next person from waitlist
	 */
	async promoteFromWaitlist(classId, client = null) {
		try {
			const shouldReleaseClient = !client;
			if (!client) {
				client = await this.pool.connect();
			}

			// Get next person on waitlist
			const waitlistSql = `
        SELECT * FROM class_waitlist 
        WHERE class_id = $1 AND status = 'waiting'
        ORDER BY created_at ASC
        LIMIT 1
      `;

			const waitlistRes = await client.query(waitlistSql, [classId]);

			if (waitlistRes.rows.length > 0) {
				const nextUser = waitlistRes.rows[0];

				// Move from waitlist to enrolled
				await client.query(
					"INSERT INTO class_enrollments (user_id, class_id, status) VALUES ($1, $2, 'enrolled')",
					[nextUser.user_id, classId]
				);

				await client.query('DELETE FROM class_waitlist WHERE id = $1', [
					nextUser.id,
				]);

				if (shouldReleaseClient) {
					client.release();
				}

				return nextUser;
			}

			if (shouldReleaseClient) {
				client.release();
			}
			return null;
		} catch (error) {
			throw new Error(`Could not promote from waitlist: ${error}`);
		}
	}

	/**
	 * Get user's enrolled classes
	 */
	async getUserClasses(userId) {
		try {
			const sql = `
        SELECT 
          c.*,
          ce.enrolled_at,
          ce.status as enrollment_status
        FROM classes c
        JOIN class_enrollments ce ON c.id = ce.class_id
        WHERE ce.user_id = $1 AND ce.status = 'enrolled'
        ORDER BY c.day_of_week, c.start_time
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get user classes: ${error}`);
		}
	}

	/**
	 * Get user's waitlisted classes
	 */
	async getUserWaitlist(userId) {
		try {
			const sql = `
        SELECT 
          c.*,
          cw.joined_waitlist_at,
          cw.status as waitlist_status,
          (SELECT COUNT(*) FROM class_waitlist WHERE class_id = c.id AND created_at < cw.created_at) + 1 as position_in_waitlist
        FROM classes c
        JOIN class_waitlist cw ON c.id = cw.class_id
        WHERE cw.user_id = $1 AND cw.status = 'waiting'
        ORDER BY cw.created_at
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get user waitlist: ${error}`);
		}
	}

	/**
	 * Admin enroll student manually (for offline students)
	 */
	async adminEnrollStudent(classId, studentData) {
		try {
			const client = await this.pool.connect();

			// Check if class exists and get details
			const classRes = await client.query(
				'SELECT * FROM classes WHERE id = $1',
				[classId]
			);

			if (classRes.rows.length === 0) {
				client.release();
				throw new Error('Class not found');
			}

			const classInfo = classRes.rows[0];

			// Check if student is already enrolled (by email)
			const enrollmentRes = await client.query(
				'SELECT * FROM class_manual_enrollments WHERE student_email = $1 AND class_id = $2',
				[studentData.email, classId]
			);

			if (enrollmentRes.rows.length > 0) {
				client.release();
				throw new Error('Student already enrolled in this class');
			}

			// Check current enrollment count (both user and manual enrollments)
			const userCountRes = await client.query(
				"SELECT COUNT(*) as count FROM class_enrollments WHERE class_id = $1 AND status = 'enrolled'",
				[classId]
			);

			const manualCountRes = await client.query(
				"SELECT COUNT(*) as count FROM class_manual_enrollments WHERE class_id = $1 AND status = 'enrolled'",
				[classId]
			);

			const currentCount =
				parseInt(userCountRes.rows[0].count) +
				parseInt(manualCountRes.rows[0].count);

			if (currentCount >= classInfo.max_capacity) {
				client.release();
				throw new Error('Class is full');
			}

			// Enroll student manually
			const enrollmentSql = `
        INSERT INTO class_manual_enrollments (class_id, student_name, student_email, student_phone, notes, status)
        VALUES ($1, $2, $3, $4, $5, 'enrolled') RETURNING *
      `;

			const enrollmentResult = await client.query(enrollmentSql, [
				classId,
				studentData.name,
				studentData.email,
				studentData.phone,
				studentData.notes,
			]);
			client.release();

			return {
				status: 'enrolled',
				message: 'Successfully enrolled student in class',
				enrollment: enrollmentResult.rows[0],
			};
		} catch (error) {
			throw new Error(`Could not enroll student: ${error}`);
		}
	}

	// ========================
	// ADMIN OPERATIONS
	// ========================

	/**
	 * Get all classes with sessions (admin view)
	 */
	async getAllClasses() {
		let client;
		try {
			const sql = `
        SELECT 
          c.*,
          (COUNT(ce.id) + COUNT(cme.id)) as current_enrollment,
          COUNT(cw.id) as waitlist_count
        FROM classes c
        LEFT JOIN class_enrollments ce ON c.id = ce.class_id AND ce.status = 'enrolled'
        LEFT JOIN class_manual_enrollments cme ON c.id = cme.class_id AND cme.status = 'enrolled'
        LEFT JOIN class_waitlist cw ON c.id = cw.class_id AND cw.status = 'waiting'
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `;

			client = await this.pool.connect();
			const res = await client.query(sql);

			// Get sessions for each class
			const classes = res.rows;
			for (let classItem of classes) {
				const sessionsQuery = `
					SELECT id, day_of_week, start_time, end_time 
					FROM class_sessions 
					WHERE class_id = $1 
					ORDER BY 
						CASE day_of_week 
							WHEN 'monday' THEN 1 
							WHEN 'tuesday' THEN 2 
							WHEN 'wednesday' THEN 3 
							WHEN 'thursday' THEN 4 
							WHEN 'friday' THEN 5 
							WHEN 'saturday' THEN 6 
							WHEN 'sunday' THEN 7 
						END, start_time
				`;
				const sessionsRes = await client.query(sessionsQuery, [classItem.id]);
				classItem.sessions = sessionsRes.rows;
			}

			client.release();
			return classes;
		} catch (error) {
			if (client) {
				client.release();
			}
			throw new Error(`Can't retrieve all classes: ${error}`);
		}
	}

	/**
	 * Get class enrollments (admin) - includes both user and manual enrollments
	 */
	async getClassEnrollments(classId) {
		try {
			const client = await this.pool.connect();

			// Get user enrollments
			const userEnrollmentsSql = `
        SELECT 
          ce.*,
          u.name as user_name,
          u.email as user_email,
          'user' as enrollment_type
        FROM class_enrollments ce
        JOIN users u ON ce.user_id = u.id
        WHERE ce.class_id = $1 AND ce.status = 'enrolled'
        ORDER BY ce.enrolled_at
      `;

			// Get manual enrollments
			const manualEnrollmentsSql = `
        SELECT 
          cme.*,
          cme.student_name as user_name,
          cme.student_email as user_email,
          'manual' as enrollment_type
        FROM class_manual_enrollments cme
        WHERE cme.class_id = $1 AND cme.status = 'enrolled'
        ORDER BY cme.enrolled_at
      `;

			const userRes = await client.query(userEnrollmentsSql, [classId]);
			const manualRes = await client.query(manualEnrollmentsSql, [classId]);

			client.release();

			// Combine and sort by enrollment date
			const allEnrollments = [...userRes.rows, ...manualRes.rows];
			allEnrollments.sort(
				(a, b) => new Date(a.enrolled_at) - new Date(b.enrolled_at)
			);

			return allEnrollments;
		} catch (error) {
			throw new Error(`Could not get class enrollments: ${error}`);
		}
	}

	/**
	 * Get class waitlist (admin)
	 */
	async getClassWaitlist(classId) {
		try {
			const sql = `
        SELECT 
          cw.*,
          u.name as user_name,
          u.email as user_email,
          ROW_NUMBER() OVER (ORDER BY cw.created_at) as position
        FROM class_waitlist cw
        JOIN users u ON cw.user_id = u.id
        WHERE cw.class_id = $1 AND cw.status = 'waiting'
        ORDER BY cw.created_at
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [classId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get class waitlist: ${error}`);
		}
	}

	/**
	 * Get class statistics
	 */
	async getClassStats() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_classes,
          COUNT(*) FILTER (WHERE is_published = true) as published_classes,
          COUNT(*) FILTER (WHERE is_published = false) as draft_classes,
          COUNT(DISTINCT instructor_name) as unique_instructors,
          (SELECT COUNT(*) FROM class_enrollments WHERE status = 'enrolled') as total_enrollments,
          (SELECT COUNT(*) FROM class_waitlist WHERE status = 'waiting') as total_waitlisted,
          ROUND(AVG(max_capacity), 0) as avg_class_capacity
        FROM classes
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get class statistics: ${error}`);
		}
	}
}

/**
 * Validation schemas for class data
 */
function validateClass(classData) {
	// Session schema for individual sessions
	const sessionSchema = Joi.object({
		id: Joi.number().integer().optional(), // Allow id for existing sessions
		day_of_week: Joi.string()
			.valid(
				'monday',
				'tuesday',
				'wednesday',
				'thursday',
				'friday',
				'saturday',
				'sunday'
			)
			.required(),
		start_time: Joi.string()
			.pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)
			.required(), // HH:MM or HH:MM:SS format
		end_time: Joi.string()
			.pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)
			.required(),
	});

	const classSchema = Joi.object({
		class_name: Joi.string().min(1).max(200).required(),
		description: Joi.string().max(1000).allow('', null),
		instructor_name: Joi.string().min(1).max(100).required(),
		location: Joi.string().min(1).max(100).required(),
		class_type: Joi.string()
			.valid('beginner', 'intermediate', 'advanced', 'open_level')
			.required(),
		skill_focus: Joi.string().min(1).max(100).required(),
		// Video embed URL for YouTube/Vimeo etc.
		video_embed_url: Joi.string()
			.allow('', null)
			.pattern(/^https?:\/\/.+/)
			.messages({
				'string.pattern.base': 'Video embed URL must be a valid HTTP/HTTPS URL',
			}),
		// Multiple sessions support (new format)
		sessions: Joi.array().items(sessionSchema).min(1),
		// Legacy single session fields (backwards compatibility)
		day_of_week: Joi.string().valid(
			'monday',
			'tuesday',
			'wednesday',
			'thursday',
			'friday',
			'saturday',
			'sunday'
		),
		start_time: Joi.string().pattern(
			/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/
		), // HH:MM or HH:MM:SS format
		end_time: Joi.string().pattern(
			/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/
		),
		class_duration: Joi.number().integer().min(15).max(300).required(), // 15 minutes to 5 hours
		max_capacity: Joi.number().integer().min(1).max(100).required(),
		price: Joi.number().min(0).precision(2).required(),
		age_restrictions: Joi.string().max(100).default('All ages'),
		requires_membership: Joi.boolean().default(false),
		waitlist_enabled: Joi.boolean().default(true),
		is_published: Joi.boolean().default(false),
	})
		// Require either sessions array OR legacy single session fields
		.or('sessions', 'day_of_week');

	return classSchema.validate(classData);
}

module.exports = {
	ClassesStore,
	validateClass,
};
