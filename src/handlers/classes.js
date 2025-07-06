// handlers/classes.js
require('dotenv').config();
const { ClassesStore, validateClass } = require('../models/class');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * Classes Handlers - All business logic for in-person class operations
 */

// ========================
// PUBLIC CLASS HANDLERS
// ========================

/**
 * Get all published classes
 * GET /classes
 */
const getPublishedClasses = async (req, res) => {
	try {
		const store = new ClassesStore(req.app.locals.pool);
		const classes = await store.getPublishedClasses();
		return res.status(200).json(classes);
	} catch (error) {
		console.error('Get published classes error:', error);
		return res.status(500).json({ error: 'Failed to retrieve classes' });
	}
};

/**
 * Get single class details
 * GET /classes/:id
 */
const getClass = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const store = new ClassesStore(req.app.locals.pool);
		const classInfo = await store.getClass(classId);

		if (!classInfo) {
			return res.status(404).json({ error: 'Class not found' });
		}

		// Only show published classes to non-admin users
		if (!classInfo.is_published && !req.user?.is_admin) {
			return res.status(404).json({ error: 'Class not found' });
		}

		return res.status(200).json(classInfo);
	} catch (error) {
		console.error('Get class error:', error);
		return res.status(500).json({ error: 'Failed to retrieve class' });
	}
};

// ========================
// USER CLASS HANDLERS
// ========================

/**
 * Get user's enrolled classes
 * GET /users/:userId/classes
 */
const getUserClasses = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const store = new ClassesStore(req.app.locals.pool);
		const classes = await store.getUserClasses(userId);

		return res.status(200).json(classes);
	} catch (error) {
		console.error('Get user classes error:', error);
		return res.status(500).json({ error: 'Failed to retrieve user classes' });
	}
};

/**
 * Get user's waitlisted classes
 * GET /users/:userId/classes/waitlist
 */
const getUserWaitlist = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const store = new ClassesStore(req.app.locals.pool);
		const waitlist = await store.getUserWaitlist(userId);

		return res.status(200).json(waitlist);
	} catch (error) {
		console.error('Get user waitlist error:', error);
		return res.status(500).json({ error: 'Failed to retrieve waitlist' });
	}
};

/**
 * Enroll user in class
 * POST /classes/:id/enroll
 */
const enrollInClass = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new ClassesStore(req.app.locals.pool);
		const result = await store.enrollInClass(userId, classId);

		if (result.status === 'enrolled') {
			return res.status(201).json(result);
		} else if (result.status === 'waitlisted') {
			return res.status(202).json(result); // 202 Accepted
		}
	} catch (error) {
		console.error('Enroll in class error:', error);
		if (error.message.includes('already enrolled')) {
			return res.status(400).json({ error: error.message });
		}
		if (error.message.includes('Class is full')) {
			return res.status(409).json({ error: error.message }); // 409 Conflict
		}
		return res.status(500).json({ error: 'Failed to enroll in class' });
	}
};

/**
 * Remove user from class
 * DELETE /classes/:id/enroll
 */
const removeFromClass = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const userId = req.user.id;

		const store = new ClassesStore(req.app.locals.pool);
		const result = await store.removeFromClass(userId, classId);

		return res.status(200).json({
			message: 'Successfully removed from class',
			result: result,
		});
	} catch (error) {
		console.error('Remove from class error:', error);
		return res.status(500).json({ error: 'Failed to remove from class' });
	}
};

// ========================
// ADMIN CLASS HANDLERS
// ========================

/**
 * Get all classes (admin view)
 * GET /admin/classes
 */
const getAllClasses = async (req, res) => {
	try {
		const store = new ClassesStore(req.app.locals.pool);
		const classes = await store.getAllClasses();
		return res.status(200).json(classes);
	} catch (error) {
		console.error('Get all classes error:', error);
		return res.status(500).json({ error: 'Failed to retrieve all classes' });
	}
};

/**
 * Create new class (admin)
 * POST /admin/classes
 */
const createClass = async (req, res) => {
	try {
		// Validate class data
		const { error } = validateClass(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new ClassesStore(req.app.locals.pool);
		const newClass = await store.createClass(req.body);

		return res.status(201).json({
			message: 'Class created successfully',
			class: newClass,
		});
	} catch (error) {
		console.error('Create class error:', error);
		return res.status(500).json({ error: 'Failed to create class' });
	}
};

/**
 * Update existing class (admin)
 * PUT /admin/classes/:id
 */
const updateClass = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);

		// Validate class data
		const { error } = validateClass(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new ClassesStore(req.app.locals.pool);
		const updatedClass = await store.updateClass(req.body, classId);

		if (!updatedClass) {
			return res.status(404).json({ error: 'Class not found' });
		}

		return res.status(200).json({
			message: 'Class updated successfully',
			class: updatedClass,
		});
	} catch (error) {
		console.error('Update class error:', error);
		return res.status(500).json({ error: 'Failed to update class' });
	}
};

/**
 * Delete class (admin)
 * DELETE /admin/classes/:id
 */
const deleteClass = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const store = new ClassesStore(req.app.locals.pool);
		const deletedClass = await store.deleteClass(classId);

		if (!deletedClass) {
			return res.status(404).json({ error: 'Class not found' });
		}

		return res.status(200).json({
			message: 'Class deleted successfully',
			class: deletedClass,
		});
	} catch (error) {
		console.error('Delete class error:', error);
		return res.status(500).json({ error: 'Failed to delete class' });
	}
};

/**
 * Get class enrollments (admin)
 * GET /admin/classes/:id/enrollments
 */
const getClassEnrollments = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const store = new ClassesStore(req.app.locals.pool);
		const enrollments = await store.getClassEnrollments(classId);

		return res.status(200).json(enrollments);
	} catch (error) {
		console.error('Get class enrollments error:', error);
		return res.status(500).json({ error: 'Failed to get class enrollments' });
	}
};

/**
 * Get class waitlist (admin)
 * GET /admin/classes/:id/waitlist
 */
const getClassWaitlist = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const store = new ClassesStore(req.app.locals.pool);
		const waitlist = await store.getClassWaitlist(classId);

		return res.status(200).json(waitlist);
	} catch (error) {
		console.error('Get class waitlist error:', error);
		return res.status(500).json({ error: 'Failed to get class waitlist' });
	}
};

/**
 * Manually enroll user in class (admin)
 * POST /admin/classes/:id/enroll/:userId
 */
const adminEnrollUser = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const userId = parseInt(req.params.userId);

		const store = new ClassesStore(req.app.locals.pool);
		const result = await store.enrollInClass(userId, classId);

		return res.status(201).json({
			message: 'User enrolled successfully',
			result: result,
		});
	} catch (error) {
		console.error('Admin enroll user error:', error);
		return res.status(500).json({ error: 'Failed to enroll user' });
	}
};

/**
 * Manually remove user from class (admin)
 * DELETE /admin/classes/:id/enroll/:userId
 */
const adminRemoveUser = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const userId = parseInt(req.params.userId);

		const store = new ClassesStore(req.app.locals.pool);
		const result = await store.removeFromClass(userId, classId);

		return res.status(200).json({
			message: 'User removed successfully',
			result: result,
		});
	} catch (error) {
		console.error('Admin remove user error:', error);
		return res.status(500).json({ error: 'Failed to remove user' });
	}
};

/**
 * Get class statistics (admin)
 * GET /admin/classes/stats
 */
const getClassStats = async (req, res) => {
	try {
		const store = new ClassesStore(req.app.locals.pool);
		const stats = await store.getClassStats();

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get class stats error:', error);
		return res.status(500).json({ error: 'Failed to get class statistics' });
	}
};

/**
 * Get upcoming classes (admin)
 * GET /admin/classes/upcoming?limit=10
 */
const getUpcomingClasses = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 10;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new ClassesStore(req.app.locals.pool);
		const classes = await store.getUpcomingClasses(limit);

		return res.status(200).json(classes);
	} catch (error) {
		console.error('Get upcoming classes error:', error);
		return res.status(500).json({ error: 'Failed to get upcoming classes' });
	}
};

/**
 * Update class status (admin)
 * PUT /admin/classes/:id/status
 */
const updateClassStatus = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const { status } = req.body;

		if (
			!status ||
			!['draft', 'published', 'cancelled', 'completed'].includes(status)
		) {
			return res.status(400).json({ error: 'Valid status is required' });
		}

		const store = new ClassesStore(req.app.locals.pool);
		const classData = await store.updateClassStatus(classId, status);

		if (!classData) {
			return res.status(404).json({ error: 'Class not found' });
		}

		return res.status(200).json({
			message: 'Class status updated successfully',
			class: classData,
		});
	} catch (error) {
		console.error('Update class status error:', error);
		return res.status(500).json({ error: 'Failed to update class status' });
	}
};

/**
 * Admin enroll student manually (admin)
 * POST /admin/classes/:id/enroll/manual
 */
const adminEnrollStudent = async (req, res) => {
	try {
		const classId = parseInt(req.params.id);
		const { name, email, phone, notes } = req.body;

		if (!name || !email) {
			return res.status(400).json({ error: 'Name and email are required' });
		}

		const store = new ClassesStore(req.app.locals.pool);
		const result = await store.adminEnrollStudent(classId, {
			name,
			email,
			phone: phone || null,
			notes: notes || null,
		});

		return res.status(200).json({
			message: 'Student enrolled successfully',
			enrollment: result,
		});
	} catch (error) {
		console.error('Admin enroll student error:', error);
		return res.status(500).json({ error: 'Failed to enroll student' });
	}
};

/**
 * Classes route handler - manages all in-person class endpoints
 */
const classes_route = (app) => {
	// Public routes (no authentication required)
	app.get('/classes', getPublishedClasses);

	// Public route with optional authentication (for view access control)
	app.get(
		'/classes/:id',
		(req, res, next) => {
			// Try to authenticate but don't require it
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		getClass
	);

	// User class routes (authentication required)
	app.get('/users/:userId/classes', authenticateUserId, getUserClasses);
	app.get(
		'/users/:userId/classes/waitlist',
		authenticateUserId,
		getUserWaitlist
	);
	app.post('/classes/:id/enroll', authenticationToken, enrollInClass);
	app.delete('/classes/:id/enroll', authenticationToken, removeFromClass);

	// Admin routes (admin authentication required)
	app.get('/admin/classes', authenticationToken, requireAdmin, getAllClasses);
	app.post('/admin/classes', authenticationToken, requireAdmin, createClass);
	app.put('/admin/classes/:id', authenticationToken, requireAdmin, updateClass);
	app.delete(
		'/admin/classes/:id',
		authenticationToken,
		requireAdmin,
		deleteClass
	);
	app.get(
		'/admin/classes/stats',
		authenticationToken,
		requireAdmin,
		getClassStats
	);
	app.get(
		'/admin/classes/upcoming',
		authenticationToken,
		requireAdmin,
		getUpcomingClasses
	);
	app.get(
		'/admin/classes/:id/enrollments',
		authenticationToken,
		requireAdmin,
		getClassEnrollments
	);
	app.put(
		'/admin/classes/:id/status',
		authenticationToken,
		requireAdmin,
		updateClassStatus
	);
	app.post(
		'/admin/classes/:id/enroll/manual',
		authenticationToken,
		requireAdmin,
		adminEnrollStudent
	);
};

module.exports = classes_route;
