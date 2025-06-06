require('dotenv').config();
const { UserStore, handleUserErrors } = require('../models/user');
const { generateToken } = require('../middleware/auth');

/**
 * User route handler - manages all user-related endpoints
 */
const users_route = (app) => {
	const pool = app.locals.pool;
	const store = new UserStore(pool);

	/**
	 * Get all users (admin endpoint)
	 * POST /verify/users - requires authentication
	 */

	app.get('/test-token', (req, res) => {
		try {
			const testUser = { id: 1, name: 'Test', is_admin: true };
			const token = generateToken(testUser);

			// Try to verify it immediately
			const jwt = require('jsonwebtoken');
			const decoded = jwt.verify(token, process.env.TOKEN_SECRET);

			res.json({
				generated: token,
				decoded: decoded,
				secret_exists: !!process.env.TOKEN_SECRET,
			});
		} catch (error) {
			res.json({ error: error.message });
		}
	});

	const index = async (req, res) => {
		try {
			const users = await store.index();
			return res.status(200).json(users);
		} catch (error) {
			return res.status(400).json({ error: error.message });
		}
	};

	/**
	 * Get single user by ID
	 * POST /verify/user/:id - requires authentication
	 */
	const show = async (req, res) => {
		try {
			const user = await store.show(parseInt(req.params.id));
			if (!user) {
				return res.status(404).json({ error: 'User not found' });
			}
			return res.status(200).json(user);
		} catch (error) {
			return res.status(400).json({ error: error.message });
		}
	};

	/**
	 * Create new user (registration)
	 * POST /create/user - public endpoint
	 */
	const create = async (req, res) => {
		// Map request body to our new schema structure
		const user = {
			name: req.body.name,
			email: req.body.email,
			avatar: req.body.avatar || '',
			username: req.body.username,
			password: req.body.password,
			is_admin: req.body.is_admin || false,
			city: req.body.city,
			country: req.body.country,
			martial_art: req.body.martial_art,
			experience: req.body.experience || 0,
			current_courses: req.body.current_courses || [],
			privacy: {
				profile: req.body.privacy?.profile || 'public',
				progress: req.body.privacy?.progress || 'public',
				courses: req.body.privacy?.courses || 'public',
			},
		};

		try {
			// Validate user data
			const { error } = handleUserErrors(user);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			// Check if email already exists
			const emailExists = await store.emailExists(user.email);
			if (emailExists) {
				return res.status(400).json({ error: 'Email already exists!' });
			}

			// Check if username already exists
			const usernameExists = await store.usernameExists(user.username);
			if (usernameExists) {
				return res.status(400).json({ error: 'Username already exists!' });
			}

			// Create new user
			const newUser = await store.create(user);

			// Generate JWT token
			const token = generateToken(newUser);

			return res.status(201).json({
				token,
				user: {
					id: newUser.id,
					name: newUser.name,
					email: newUser.email,
					username: newUser.username,
					is_admin: newUser.is_admin,
				},
			});
		} catch (error) {
			console.error('User creation error:', error);
			return res.status(500).json({ error: 'Failed to create user' });
		}
	};

	/**
	 * Update existing user
	 * PUT /user/:id - requires user ID authentication
	 */
	const update = async (req, res) => {
		const userId = parseInt(req.params.id);

		// Map request body to our new schema structure
		const user = {
			name: req.body.name,
			email: req.body.email,
			avatar: req.body.avatar,
			username: req.body.username,
			password: req.body.password,
			is_admin: req.body.is_admin,
			city: req.body.city,
			country: req.body.country,
			martial_art: req.body.martial_art,
			experience: req.body.experience,
			current_courses: req.body.current_courses,
			privacy: req.body.privacy,
		};

		try {
			// Validate user data
			const { error } = handleUserErrors(user);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			// Update user
			const updatedUser = await store.update(user, userId);
			if (!updatedUser) {
				return res.status(404).json({ error: 'User not found' });
			}

			// Generate new token with updated info
			const token = generateToken(updatedUser);

			return res.status(200).json({
				token,
				user: {
					id: updatedUser.id,
					name: updatedUser.name,
					email: updatedUser.email,
					username: updatedUser.username,
					is_admin: updatedUser.is_admin,
				},
			});
		} catch (error) {
			console.error('User update error:', error);
			return res.status(500).json({ error: 'Failed to update user' });
		}
	};

	/**
	 * Delete user
	 * DELETE /user/:id - requires user ID authentication
	 */
	const deleteUser = async (req, res) => {
		try {
			const deletedUser = await store.delete(parseInt(req.params.id));
			if (!deletedUser) {
				return res.status(404).json({ error: 'User not found' });
			}
			return res.status(200).json({
				message: 'User deleted successfully',
				user: deletedUser,
			});
		} catch (error) {
			console.error('User deletion error:', error);
			return res.status(500).json({ error: 'Failed to delete user' });
		}
	};

	/**
	 * Authenticate user (login)
	 * POST /user/authenticate - public endpoint
	 */
	const authenticate = async (req, res) => {
		const { username, password } = req.body;

		if (!username || !password) {
			return res
				.status(400)
				.json({ error: 'Username and password are required' });
		}

		try {
			const authUser = await store.authenticate(username, password);

			if (!authUser) {
				return res.status(401).json({ error: 'Invalid username or password' });
			}

			// Generate JWT token
			const token = generateToken(authUser);

			return res.status(200).json({
				token,
				user: {
					id: authUser.id,
					name: authUser.name,
					email: authUser.email,
					username: authUser.username,
					is_admin: authUser.is_admin,
				},
			});
		} catch (error) {
			console.error('Authentication error:', error);
			return res.status(500).json({ error: 'Authentication failed' });
		}
	};

	/**
	 * Get user with privacy settings
	 * GET /user/:id/profile - requires authentication
	 */
	const getUserProfile = async (req, res) => {
		try {
			const user = await store.getUserWithPrivacy(parseInt(req.params.id));
			if (!user) {
				return res.status(404).json({ error: 'User not found' });
			}

			// Remove sensitive data
			delete user.password;

			return res.status(200).json(user);
		} catch (error) {
			console.error('Get user profile error:', error);
			return res.status(500).json({ error: 'Failed to get user profile' });
		}
	};

	/**
	 * Get user's enrolled courses
	 * GET /user/:id/courses - requires authentication
	 */
	const getUserCourses = async (req, res) => {
		try {
			const courses = await store.getUserCourses(parseInt(req.params.id));
			return res.status(200).json(courses);
		} catch (error) {
			console.error('Get user courses error:', error);
			return res.status(500).json({ error: 'Failed to get user courses' });
		}
	};

	/**
	 * Update course progress
	 * PUT /user/:id/course/:courseId/progress - requires authentication
	 */
	const updateCourseProgress = async (req, res) => {
		const { id: userId, courseId } = req.params;
		const { progress } = req.body;

		if (progress < 0 || progress > 100) {
			return res
				.status(400)
				.json({ error: 'Progress must be between 0 and 100' });
		}

		try {
			const updatedProgress = await store.updateCourseProgress(
				parseInt(userId),
				parseInt(courseId),
				progress
			);

			if (!updatedProgress) {
				return res.status(404).json({ error: 'Course enrollment not found' });
			}

			return res.status(200).json(updatedProgress);
		} catch (error) {
			console.error('Update course progress error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to update course progress' });
		}
	};

	// Import authentication middleware
	const {
		authenticationToken,
		authenticateUserId,
		requireAdmin,
	} = require('../middleware/auth');

	// Define routes
	app.post('/verify/users', authenticationToken, requireAdmin, index);
	app.post('/verify/user/:id', authenticationToken, show);
	app.post('/create/user', create);
	app.put('/user/:id', authenticateUserId, update);
	app.delete('/user/:id', authenticateUserId, deleteUser);
	app.post('/user/authenticate', authenticate);

	// Additional routes for new functionality
	app.get('/user/:id/profile', authenticationToken, getUserProfile);
	app.get('/user/:id/courses', authenticateUserId, getUserCourses);
	app.put(
		'/user/:id/course/:courseId/progress',
		authenticateUserId,
		updateCourseProgress
	);
};

module.exports = users_route;
