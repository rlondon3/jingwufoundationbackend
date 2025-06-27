require('dotenv').config();
const Joi = require('joi');

/**
 * CourseStore handles all course-related database operations
 * Manages courses, modules, lessons, features, and user progress tracking
 */
class CourseStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// COURSE OPERATIONS
	// ========================

	/**
	 * Get all published courses with basic info
	 */
	async index() {
		try {
			const sql = `
        SELECT c.*, COUNT(m.id) as module_count 
        FROM courses c 
        LEFT JOIN modules m ON c.id = m.course_id 
        WHERE c.is_published = true 
        GROUP BY c.id 
        ORDER BY c.created_at DESC
      `;
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Can't retrieve courses: ${error}`);
		}
	}

	/**
	 * Get single course with full details (modules, lessons, features)
	 */
	async show(id) {
		try {
			const client = await this.pool.connect();

			// Get course basic info
			const courseSql = 'SELECT * FROM courses WHERE id = $1';
			const courseRes = await client.query(courseSql, [id]);

			if (courseRes.rows.length === 0) {
				client.release();
				return null;
			}

			const course = courseRes.rows[0];

			// Get course features
			const featuresSql = `
        SELECT cf.* FROM course_features cf
        JOIN course_course_features ccf ON cf.id = ccf.feature_id
        WHERE ccf.course_id = $1
      `;
			const featuresRes = await client.query(featuresSql, [id]);

			// Get modules with lessons
			const modulesSql = `
        SELECT m.*, 
               JSON_AGG(
                 JSON_BUILD_OBJECT(
                   'id', l.id,
                   'title', l.title,
                   'lesson_type', l.lesson_type,
                   'duration_minutes', l.duration_minutes,
                   'order_sequence', l.order_sequence,
                   'is_required', l.is_required
                 ) ORDER BY l.order_sequence
               ) as lessons
        FROM modules m
        LEFT JOIN lessons l ON m.id = l.module_id
        WHERE m.course_id = $1
        GROUP BY m.id
        ORDER BY m.order_sequence
      `;
			const modulesRes = await client.query(modulesSql, [id]);

			client.release();

			return {
				...course,
				features: featuresRes.rows,
				modules: modulesRes.rows,
			};
		} catch (error) {
			throw new Error(`Can't find course: ${error}`);
		}
	}

	/**
	 * Create new course
	 */
	async create(course) {
		try {
			const client = await this.pool.connect();

			const sql = `
        INSERT INTO courses (title, category, description, thumbnail_url, instructor_name, 
                           skill_level, language, estimated_hours, regular_price, 
                           prerequisites, learning_objectives, is_published)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *
      `;

			const res = await client.query(sql, [
				course.title,
				course.category,
				course.description,
				course.thumbnail_url,
				course.instructor_name,
				course.skill_level,
				course.language,
				course.estimated_hours,
				course.regular_price,
				course.prerequisites,
				course.learning_objectives,
				course.is_published || false,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create course: ${error}`);
		}
	}

	/**
	 * Update existing course
	 */
	async update(course, id) {
		try {
			const sql = `
        UPDATE courses SET 
          title=$1, category=$2, description=$3, thumbnail_url=$4, 
          instructor_name=$5, skill_level=$6, language=$7, estimated_hours=$8, 
          regular_price=$9, prerequisites=$10, learning_objectives=$11, 
          is_published=$12, updated_at=CURRENT_TIMESTAMP
        WHERE id=$13 RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				course.title,
				course.category,
				course.description,
				course.thumbnail_url,
				course.instructor_name,
				course.skill_level,
				course.language,
				course.estimated_hours,
				course.regular_price,
				course.prerequisites,
				course.learning_objectives,
				course.is_published,
				id,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update course: ${error}`);
		}
	}

	/**
	 * Delete course (and all related modules/lessons)
	 */
	async delete(id) {
		try {
			const sql = 'DELETE FROM courses WHERE id=$1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete course: ${error}`);
		}
	}

	// ========================
	// MODULE OPERATIONS
	// ========================

	/**
	 * Create new module for a course
	 */
	async createModule(module) {
		try {
			const sql = `
        INSERT INTO modules (course_id, title, description, order_sequence)
        VALUES ($1, $2, $3, $4) RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				module.course_id,
				module.title,
				module.description,
				module.order_sequence,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create module: ${error}`);
		}
	}

	/**
	 * Update existing module
	 */
	async updateModule(module, id) {
		try {
			const sql = `
        UPDATE modules SET 
          title=$1, description=$2, order_sequence=$3, updated_at=CURRENT_TIMESTAMP
        WHERE id=$4 RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				module.title,
				module.description,
				module.order_sequence,
				id,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update module: ${error}`);
		}
	}

	/**
	 * Delete module (and all related lessons)
	 */
	async deleteModule(id) {
		try {
			const sql = 'DELETE FROM modules WHERE id=$1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete module: ${error}`);
		}
	}

	// ========================
	// LESSON OPERATIONS
	// ========================

	/**
	 * Create new lesson for a module
	 */
	async createLesson(lesson) {
		try {
			const sql = `
        INSERT INTO lessons (module_id, title, lesson_type, content_url, 
                           content_text, duration_minutes, order_sequence, is_required)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				lesson.module_id,
				lesson.title,
				lesson.lesson_type,
				lesson.content_url,
				lesson.content_text,
				lesson.duration_minutes || 0,
				lesson.order_sequence,
				lesson.is_required !== false,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not create lesson: ${error}`);
		}
	}

	/**
	 * Update existing lesson
	 */
	async updateLesson(lesson, id) {
		try {
			const sql = `
        UPDATE lessons SET 
          title=$1, lesson_type=$2, content_url=$3, content_text=$4, 
          duration_minutes=$5, order_sequence=$6, is_required=$7, updated_at=CURRENT_TIMESTAMP
        WHERE id=$8 RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				lesson.title,
				lesson.lesson_type,
				lesson.content_url,
				lesson.content_text,
				lesson.duration_minutes,
				lesson.order_sequence,
				lesson.is_required,
				id,
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update lesson: ${error}`);
		}
	}

	/**
	 * Delete lesson
	 */
	async deleteLesson(id) {
		try {
			const sql = 'DELETE FROM lessons WHERE id=$1 RETURNING *';
			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete lesson: ${error}`);
		}
	}

	// ========================
	// PROGRESS TRACKING
	// ========================

	/**
	 * Mark lesson as completed for user
	 */
	async markLessonComplete(userId, lessonId, quizScore = null) {
		try {
			const sql = `
        INSERT INTO user_lesson_progress (user_id, lesson_id, completed, completed_at, quiz_score)
			VALUES ($1, $2, true, CURRENT_TIMESTAMP, $3)
			ON CONFLICT (user_id, lesson_id) 
			DO UPDATE SET 
			completed = true, 
			completed_at = CURRENT_TIMESTAMP, 
			quiz_score = $3, 
			updated_at = CURRENT_TIMESTAMP
			RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, lessonId, quizScore]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not mark lesson complete: ${error}`);
		}
	}

	/**
	 * Get user's progress for a course
	 */
	async getUserCourseProgress(userId, courseId) {
		try {
			const sql = `
        SELECT 
          c.title as course_title,
          COUNT(l.id) as total_lessons,
          COUNT(ulp.id) FILTER (WHERE ulp.completed = true) as completed_lessons,
          ROUND(
            (COUNT(ulp.id) FILTER (WHERE ulp.completed = true) * 100.0 / COUNT(l.id))::numeric, 
            2
          ) as progress_percentage
        FROM courses c
        JOIN modules m ON c.id = m.course_id
        JOIN lessons l ON m.id = l.module_id
        LEFT JOIN user_lesson_progress ulp ON l.id = ulp.lesson_id AND ulp.user_id = $1
        WHERE c.id = $2
        GROUP BY c.id, c.title
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId, courseId]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get course progress: ${error}`);
		}
	}

	// ========================
	// UTILITY METHODS
	// ========================

	/**
	 * Get all course categories
	 */
	async getCategories() {
		try {
			const sql =
				'SELECT DISTINCT category FROM courses WHERE is_published = true ORDER BY category';
			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows.map((row) => row.category);
		} catch (error) {
			throw new Error(`Could not get categories: ${error}`);
		}
	}

	/**
	 * Search courses by title or description
	 */
	async searchCourses(searchTerm) {
		try {
			const sql = `
        SELECT * FROM courses 
        WHERE is_published = true 
        AND (title ILIKE $1 OR description ILIKE $1)
        ORDER BY title
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [`%${searchTerm}%`]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not search courses: ${error}`);
		}
	}
}

/**
 * Validation schemas for course data
 */
function validateCourse(course) {
	const courseSchema = Joi.object({
		title: Joi.string().required(),
		category: Joi.string().required(),
		description: Joi.string().required(),
		thumbnail_url: Joi.string().uri().allow(''),
		instructor_name: Joi.string().required(),
		skill_level: Joi.string()
			.valid('Beginner', 'Intermediate', 'Advanced')
			.required(),
		language: Joi.string().default('English'),
		estimated_hours: Joi.number().positive().required(),
		regular_price: Joi.number().positive().required(),
		prerequisites: Joi.string().allow(''),
		learning_objectives: Joi.string().required(),
		is_published: Joi.boolean().default(false),
	});

	return courseSchema.validate(course);
}

function validateModule(module) {
	const moduleSchema = Joi.object({
		course_id: Joi.number().integer().positive().required(),
		title: Joi.string().required(),
		description: Joi.string().allow(''),
		order_sequence: Joi.number().integer().positive().required(),
	});

	return moduleSchema.validate(module);
}

function validateLesson(lesson) {
	const lessonSchema = Joi.object({
		module_id: Joi.number().integer().positive().required(),
		title: Joi.string().required(),
		lesson_type: Joi.string().valid('video', 'article', 'quiz').required(),
		content_url: Joi.string().uri().allow('', null),
		content_text: Joi.string().allow('', null),
		duration_minutes: Joi.number().integer().min(0).default(0),
		order_sequence: Joi.number().integer().positive().required(),
		is_required: Joi.boolean().default(true),
	});

	return lessonSchema.validate(lesson);
}

module.exports = {
	CourseStore,
	validateCourse,
	validateModule,
	validateLesson,
};
