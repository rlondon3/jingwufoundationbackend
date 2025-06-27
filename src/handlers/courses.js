// handlers/courses.js
require('dotenv').config();
const {
	CourseStore,
	validateCourse,
	validateModule,
	validateLesson,
} = require('../models/course');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * Course Handlers - All business logic for course operations
 */

// ========================
// COURSE HANDLERS
// ========================

/**
 * Get all published courses
 * GET /courses
 */

const courses_route = (app) => {
	const pool = app.locals.pool;
	const store = new CourseStore(pool);

	const index = async (req, res) => {
		try {
			const store = new CourseStore(req.app.locals.pool);
			const courses = await store.index();
			return res.status(200).json(courses);
		} catch (error) {
			console.error('Get courses error:', error);
			return res.status(500).json({ error: 'Failed to retrieve courses' });
		}
	};

	/**
	 * Get single course with full details
	 * GET /courses/:id
	 */
	const show = async (req, res) => {
		try {
			const store = new CourseStore(req.app.locals.pool);
			const course = await store.show(parseInt(req.params.id));

			if (!course) {
				return res.status(404).json({ error: 'Course not found' });
			}

			return res.status(200).json(course);
		} catch (error) {
			console.error('Get course error:', error);
			return res.status(500).json({ error: 'Failed to retrieve course' });
		}
	};

	/**
	 * Create new course
	 * POST /courses
	 */
	const create = async (req, res) => {
		try {
			// Validate course data
			const { error } = validateCourse(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const store = new CourseStore(req.app.locals.pool);
			const newCourse = await store.create(req.body);

			return res.status(201).json(newCourse);
		} catch (error) {
			console.error('Create course error:', error);
			return res.status(500).json({ error: 'Failed to create course' });
		}
	};

	/**
	 * Update existing course
	 * PUT /courses/:id
	 */
	const update = async (req, res) => {
		try {
			// Validate course data
			const { error } = validateCourse(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const store = new CourseStore(req.app.locals.pool);
			const updatedCourse = await store.update(
				req.body,
				parseInt(req.params.id)
			);

			if (!updatedCourse) {
				return res.status(404).json({ error: 'Course not found' });
			}

			return res.status(200).json(updatedCourse);
		} catch (error) {
			console.error('Update course error:', error);
			return res.status(500).json({ error: 'Failed to update course' });
		}
	};

	/**
	 * Delete course
	 * DELETE /courses/:id
	 */
	const deleteCourse = async (req, res) => {
		try {
			const store = new CourseStore(req.app.locals.pool);
			const deletedCourse = await store.delete(parseInt(req.params.id));

			if (!deletedCourse) {
				return res.status(404).json({ error: 'Course not found' });
			}

			return res.status(200).json({
				message: 'Course deleted successfully',
				course: deletedCourse,
			});
		} catch (error) {
			console.error('Delete course error:', error);
			return res.status(500).json({ error: 'Failed to delete course' });
		}
	};

	// ========================
	// MODULE HANDLERS
	// ========================

	/**
	 * Create new module for a course
	 * POST /courses/:courseId/modules
	 */
	const createModule = async (req, res) => {
		try {
			const moduleData = {
				...req.body,
				course_id: parseInt(req.params.courseId),
			};

			// Validate module data
			const { error } = validateModule(moduleData);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const store = new CourseStore(req.app.locals.pool);
			const newModule = await store.createModule(moduleData);

			return res.status(201).json(newModule);
		} catch (error) {
			console.error('Create module error:', error);
			return res.status(500).json({ error: 'Failed to create module' });
		}
	};

	/**
	 * Update existing module
	 * PUT /modules/:id
	 */
	const updateModule = async (req, res) => {
		try {
			// Validate module data
			const { error } = validateModule(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const store = new CourseStore(req.app.locals.pool);
			const updatedModule = await store.updateModule(
				req.body,
				parseInt(req.params.id)
			);

			if (!updatedModule) {
				return res.status(404).json({ error: 'Module not found' });
			}

			return res.status(200).json(updatedModule);
		} catch (error) {
			console.error('Update module error:', error);
			return res.status(500).json({ error: 'Failed to update module' });
		}
	};

	/**
	 * Delete module
	 * DELETE /modules/:id
	 */
	const deleteModule = async (req, res) => {
		try {
			const store = new CourseStore(req.app.locals.pool);
			const deletedModule = await store.deleteModule(parseInt(req.params.id));

			if (!deletedModule) {
				return res.status(404).json({ error: 'Module not found' });
			}

			return res.status(200).json({
				message: 'Module deleted successfully',
				module: deletedModule,
			});
		} catch (error) {
			console.error('Delete module error:', error);
			return res.status(500).json({ error: 'Failed to delete module' });
		}
	};

	// ========================
	// LESSON HANDLERS
	// ========================

	/**
	 * Create new lesson for a module
	 * POST /modules/:moduleId/lessons
	 */
	const createLesson = async (req, res) => {
		try {
			const lessonData = {
				...req.body,
				module_id: parseInt(req.params.moduleId),
			};

			// Validate lesson data
			const { error } = validateLesson(lessonData);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const store = new CourseStore(req.app.locals.pool);
			const newLesson = await store.createLesson(lessonData);

			return res.status(201).json(newLesson);
		} catch (error) {
			console.error('Create lesson error:', error);
			return res.status(500).json({ error: 'Failed to create lesson' });
		}
	};

	/**
	 * Update existing lesson
	 * PUT /lessons/:id
	 */
	const updateLesson = async (req, res) => {
		try {
			// Validate lesson data
			const { error } = validateLesson(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const store = new CourseStore(req.app.locals.pool);
			const updatedLesson = await store.updateLesson(
				req.body,
				parseInt(req.params.id)
			);

			if (!updatedLesson) {
				return res.status(404).json({ error: 'Lesson not found' });
			}

			return res.status(200).json(updatedLesson);
		} catch (error) {
			console.error('Update lesson error:', error);
			return res.status(500).json({ error: 'Failed to update lesson' });
		}
	};

	/**
	 * Delete lesson
	 * DELETE /lessons/:id
	 */
	const deleteLesson = async (req, res) => {
		try {
			const store = new CourseStore(req.app.locals.pool);
			const deletedLesson = await store.deleteLesson(parseInt(req.params.id));

			if (!deletedLesson) {
				return res.status(404).json({ error: 'Lesson not found' });
			}

			return res.status(200).json({
				message: 'Lesson deleted successfully',
				lesson: deletedLesson,
			});
		} catch (error) {
			console.error('Delete lesson error:', error);
			return res.status(500).json({ error: 'Failed to delete lesson' });
		}
	};

	// ========================
	// PROGRESS HANDLERS
	// ========================

	/**
	 * Mark lesson as completed
	 * POST /lessons/:lessonId/complete
	 */
	const markLessonComplete = async (req, res) => {
		try {
			const { lessonId } = req.params;
			const { userId, quizScore } = req.body;

			if (!userId) {
				return res.status(400).json({ error: 'User ID is required' });
			}

			const store = new CourseStore(req.app.locals.pool);
			const progress = await store.markLessonComplete(
				parseInt(userId),
				parseInt(lessonId),
				quizScore
			);

			return res.status(200).json(progress);
		} catch (error) {
			console.error('Mark lesson complete error:', error);
			return res.status(500).json({ error: 'Failed to mark lesson complete' });
		}
	};

	/**
	 * Get user's course progress
	 * GET /users/:userId/courses/:courseId/progress
	 */
	const getUserCourseProgress = async (req, res) => {
		try {
			const { userId, courseId } = req.params;

			const store = new CourseStore(req.app.locals.pool);
			const progress = await store.getUserCourseProgress(
				parseInt(userId),
				parseInt(courseId)
			);

			if (!progress) {
				return res.status(404).json({ error: 'Course progress not found' });
			}

			return res.status(200).json(progress);
		} catch (error) {
			console.error('Get course progress error:', error);
			return res.status(500).json({ error: 'Failed to get course progress' });
		}
	};

	// ========================
	// UTILITY HANDLERS
	// ========================

	/**
	 * Get all course categories
	 * GET /courses/categories
	 */
	const getCategories = async (req, res) => {
		try {
			const store = new CourseStore(req.app.locals.pool);
			const categories = await store.getCategories();
			return res.status(200).json(categories);
		} catch (error) {
			console.error('Get categories error:', error);
			return res.status(500).json({ error: 'Failed to get categories' });
		}
	};

	/**
	 * Search courses
	 * GET /courses/search?q=searchTerm
	 */
	const searchCourses = async (req, res) => {
		try {
			const { q: searchTerm } = req.query;

			if (!searchTerm) {
				return res.status(400).json({ error: 'Search term is required' });
			}

			const store = new CourseStore(req.app.locals.pool);
			const courses = await store.searchCourses(searchTerm);
			return res.status(200).json(courses);
		} catch (error) {
			console.error('Search courses error:', error);
			return res.status(500).json({ error: 'Failed to search courses' });
		}
	};

	// Public routes
	app.get('/courses', index);
	app.get('/courses/categories', getCategories);
	app.get('/courses/search', searchCourses);
	app.get('/courses/:id', show);

	// Protected routes (admin only)
	app.post('/courses', authenticationToken, requireAdmin, create);
	app.put('/courses/:id', authenticationToken, requireAdmin, update);
	app.delete('/courses/:id', authenticationToken, requireAdmin, deleteCourse);

	// Module routes (admin only)
	app.post(
		'/courses/:courseId/modules',
		authenticationToken,
		requireAdmin,
		createModule
	);
	app.put('/modules/:id', authenticationToken, requireAdmin, updateModule);
	app.delete('/modules/:id', authenticationToken, requireAdmin, deleteModule);

	// Lesson routes (admin only)
	app.post(
		'/modules/:moduleId/lessons',
		authenticationToken,
		requireAdmin,
		createLesson
	);
	app.put('/lessons/:id', authenticationToken, requireAdmin, updateLesson);
	app.delete('/lessons/:id', authenticationToken, requireAdmin, deleteLesson);

	// Progress routes
	app.post(
		'/lessons/:lessonId/complete',
		authenticationToken,
		markLessonComplete
	);
	app.get(
		'/users/:userId/courses/:courseId/progress',
		authenticateUserId,
		getUserCourseProgress
	);
};

module.exports = courses_route;
