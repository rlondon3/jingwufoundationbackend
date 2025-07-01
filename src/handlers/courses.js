// handlers/courses.js
require('dotenv').config();
const {
	CourseStore,
	validateCourse,
	validateModule,
	validateLesson,
} = require('../models/course');
const { authenticationToken, requireAdmin } = require('../middleware/auth');

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

			console.log('=== BACKEND RESPONSE DEBUG ===');
			console.log(
				'Course object before sending to frontend:',
				JSON.stringify(course, null, 2)
			);
			console.log('Features in course object:', course.features);
			console.log('=== END BACKEND DEBUG ===');

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
			const { features, ...courseData } = req.body; // Extract features separately

			// Validate course data
			const { error } = validateCourse(courseData);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const store = new CourseStore(req.app.locals.pool);
			const newCourse = await store.create(courseData);

			// Add course features if provided
			if (features !== undefined && features.length > 0) {
				await store.updateCourseFeatures(newCourse.id, features);
			}

			// Return created course with features
			const fullCourse = await store.show(newCourse.id);
			return res.status(201).json(fullCourse);
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
			const store = new CourseStore(req.app.locals.pool);
			
			// Get the current course first to check for image changes
			const currentCourse = await store.show(parseInt(req.params.id));
			if (!currentCourse) {
				return res.status(404).json({ error: 'Course not found' });
			}

			// Validate course data
			const { error } = validateCourse(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			// Update the course
			const updatedCourse = await store.update(
				req.body,
				parseInt(req.params.id)
			);

			// Clean up old Cloudinary image if it changed
			if (currentCourse.image_url && req.body.image_url && 
				currentCourse.image_url !== req.body.image_url) {
				try {
					const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
					const publicId = extractPublicIdFromUrl(currentCourse.image_url);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log('Deleted old Cloudinary course image:', publicId);
					}
				} catch (imageError) {
					console.warn('Failed to delete old Cloudinary course image:', imageError.message);
					// Don't fail the operation if image cleanup fails
				}
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
			
			// Get the course first to check for images
			const courseToDelete = await store.show(parseInt(req.params.id));
			if (!courseToDelete) {
				return res.status(404).json({ error: 'Course not found' });
			}

			// Delete the course from database
			const deletedCourse = await store.delete(parseInt(req.params.id));

			// Clean up Cloudinary images if they exist
			if (courseToDelete.image_url) {
				try {
					const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
					const publicId = extractPublicIdFromUrl(courseToDelete.image_url);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log('Deleted Cloudinary course image:', publicId);
					}
				} catch (imageError) {
					console.warn('Failed to delete Cloudinary course image:', imageError.message);
					// Don't fail the operation if image cleanup fails
				}
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
	 * Get all lessons for a course
	 * GET /course/:courseId/lessons
	 */
	const getLessonsByCourse = async (req, res) => {
		const { courseId } = req.params;

		try {
			const store = new CourseStore(req.app.locals.pool);
			const lessons = await store.getLessonsByCourse(parseInt(courseId));
			return res.status(200).json(lessons);
		} catch (error) {
			console.error('Get lessons by course error:', error);
			return res.status(500).json({ error: 'Failed to get lessons' });
		}
	};

	/**
	 * Get lessons for a specific module
	 * GET /module/:moduleId/lessons
	 */
	const getLessonsByModule = async (req, res) => {
		const { moduleId } = req.params;

		try {
			const store = new CourseStore(req.app.locals.pool);
			const lessons = await store.getLessonsByModule(parseInt(moduleId));
			return res.status(200).json(lessons);
		} catch (error) {
			console.error('Get lessons by module error:', error);
			return res.status(500).json({ error: 'Failed to get lessons' });
		}
	};

	/**
	 * Create new lesson for a module
	 * POST /modules/:moduleId/lessons
	 */
	const createLesson = async (req, res) => {
		const { moduleId } = req.params;

		try {
			const store = new CourseStore(req.app.locals.pool);

			// Get the next order sequence automatically
			const nextOrder = await store.getNextLessonOrderSequence(
				parseInt(moduleId)
			);

			const lesson = {
				module_id: parseInt(moduleId),
				title: req.body.title,
				lesson_type: req.body.lesson_type,
				content_url: req.body.content_url,
				content_text: req.body.content_text,
				duration_minutes: req.body.duration_minutes,
				order_sequence: req.body.order_sequence || nextOrder, // Use provided or auto-generate
				is_required: req.body.is_required,
			};

			// Validate lesson data
			const { error } = validateLesson(lesson);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const newLesson = await store.createLesson(lesson);
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
			const store = new CourseStore(req.app.locals.pool);
			
			// Get the current lesson first to check for content_url changes
			const sql = 'SELECT * FROM lessons WHERE id = $1';
			const client = req.app.locals.pool;
			const lessonResult = await client.query(sql, [parseInt(req.params.id)]);
			const currentLesson = lessonResult.rows[0];
			
			if (!currentLesson) {
				return res.status(404).json({ error: 'Lesson not found' });
			}

			// Validate lesson data
			const { error } = validateLesson(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			// Update the lesson
			const updatedLesson = await store.updateLesson(
				req.body,
				parseInt(req.params.id)
			);

			// Clean up old Cloudinary content if it changed
			if (currentLesson.content_url && req.body.content_url && 
				currentLesson.content_url !== req.body.content_url) {
				try {
					const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
					const publicId = extractPublicIdFromUrl(currentLesson.content_url);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log('Deleted old Cloudinary lesson content:', publicId);
					}
				} catch (imageError) {
					console.warn('Failed to delete old Cloudinary lesson content:', imageError.message);
					// Don't fail the operation if image cleanup fails
				}
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
			
			// Get the lesson first to check for content
			const sql = 'SELECT * FROM lessons WHERE id = $1';
			const client = req.app.locals.pool;
			const lessonResult = await client.query(sql, [parseInt(req.params.id)]);
			const lessonToDelete = lessonResult.rows[0];
			
			if (!lessonToDelete) {
				return res.status(404).json({ error: 'Lesson not found' });
			}

			// Delete the lesson from database
			const deletedLesson = await store.deleteLesson(parseInt(req.params.id));

			// Clean up Cloudinary content if it exists
			if (lessonToDelete.content_url) {
				try {
					const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
					const publicId = extractPublicIdFromUrl(lessonToDelete.content_url);
					if (publicId) {
						await deleteImageDirect(publicId);
						console.log('Deleted Cloudinary lesson content:', publicId);
					}
				} catch (imageError) {
					console.warn('Failed to delete Cloudinary lesson content:', imageError.message);
					// Don't fail the operation if image cleanup fails
				}
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

	app.put(
		'/courses/:id',
		authenticationToken,
		requireAdmin,
		async (req, res) => {
			try {
				const courseId = parseInt(req.params.id);
				const { features, ...courseData } = req.body; // Extract features separately

				const { error } = validateCourse(courseData);
				if (error) {
					return res.status(400).json({ error: error.details[0].message });
				}

				const store = new CourseStore(req.app.locals.pool);

				// Get the current course first to check for image changes
				const currentCourse = await store.show(courseId);
				if (!currentCourse) {
					return res.status(404).json({ error: 'Course not found' });
				}

				// Update course basic info
				const updatedCourse = await store.update(courseData, courseId);

				// Clean up old Cloudinary image if it changed
				if (currentCourse.image_url && courseData.image_url && 
					currentCourse.image_url !== courseData.image_url) {
					try {
						const { deleteImageDirect, extractPublicIdFromUrl } = require('./cloudinary');
						const publicId = extractPublicIdFromUrl(currentCourse.image_url);
						if (publicId) {
							await deleteImageDirect(publicId);
							console.log('Deleted old Cloudinary course image:', publicId);
						}
					} catch (imageError) {
						console.warn('Failed to delete old Cloudinary course image:', imageError.message);
						// Don't fail the operation if image cleanup fails
					}
				}

				// Update course features if provided
				if (features !== undefined) {
					await store.updateCourseFeatures(courseId, features);
				}

				// Return updated course with features
				const fullCourse = await store.show(courseId);
				res.json(fullCourse);
			} catch (error) {
				console.error('Update course error:', error);
				res.status(500).json({ error: 'Failed to update course' });
			}
		}
	);

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

	/**
	 * Reorder lessons in a module
	 * PUT /modules/:moduleId/lessons/reorder
	 */
	const reorderLessons = async (req, res) => {
		const { moduleId } = req.params;
		const { lessonOrders } = req.body; // [{lessonId: 1, newOrder: 2}, {lessonId: 2, newOrder: 1}]

		try {
			const store = new CourseStore(req.app.locals.pool);
			await store.reorderLessons(parseInt(moduleId), lessonOrders);

			// Optionally normalize after reordering
			const normalizedLessons = await store.normalizeLessonOrder(
				parseInt(moduleId)
			);

			return res.status(200).json({
				message: 'Lessons reordered successfully',
				lessons: normalizedLessons,
			});
		} catch (error) {
			console.error('Reorder lessons error:', error);
			return res.status(500).json({ error: 'Failed to reorder lessons' });
		}
	};

	/**
	 * Normalize lesson order in a module
	 * POST /modules/:moduleId/lessons/normalize
	 */
	const normalizeLessonOrder = async (req, res) => {
		const { moduleId } = req.params;

		try {
			const store = new CourseStore(req.app.locals.pool);
			const lessons = await store.normalizeLessonOrder(parseInt(moduleId));
			return res.status(200).json(lessons);
		} catch (error) {
			console.error('Normalize lesson order error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to normalize lesson order' });
		}
	};

	// Public routes
	app.get('/courses', index);
	app.get('/courses/categories', getCategories);
	app.get('/courses/search', searchCourses);
	app.get('/courses/:id', show);

	// New lesson query routes (public or protected as needed)
	app.get(
		'/courses/:courseId/lessons',
		authenticationToken,
		getLessonsByCourse
	);
	app.get(
		'/modules/:moduleId/lessons',
		authenticationToken,
		getLessonsByModule
	);

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
	// reorder and normalize lesson order
	app.put(
		'/modules/:moduleId/lessons/reorder',
		authenticationToken,
		requireAdmin,
		reorderLessons
	);
	app.post(
		'/modules/:moduleId/lessons/normalize',
		authenticationToken,
		requireAdmin,
		normalizeLessonOrder
	);
};

module.exports = courses_route;
