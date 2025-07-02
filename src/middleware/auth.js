require('dotenv').config();
const jwt = require('jsonwebtoken');

/**
 * Authentication middleware for JWT token verification
 */

/**
 * Middleware to authenticate JWT token and attach user to request
 * Usage: app.get('/protected-route', authenticationToken, handler)
 */
const authenticationToken = (req, res, next) => {
	try {
		const authHead = req.headers.authorization;

		if (!authHead) {
			return res.status(401).json({ error: 'Authorization header required' });
		}

		const token = authHead.split(' ')[1];

		if (!token) {
			return res.status(401).json({ error: 'Bearer token required' });
		}

		const decoded = jwt.verify(token, process.env.TOKEN_SECRET);

		// Attach user to request object for use in route handlers
		req.user = decoded.user;
		next();
	} catch (error) {
		res.status(401).json({ error: `Not authorized: ${error.message}` });
	}
};

/**
 * Middleware to authenticate user and verify they can only access their own data
 * Usage: app.get('/api/users/:id', authenticateUserId, handler)
 */
const authenticateUserId = (req, res, next) => {
	try {
		const authHead = req.headers.authorization;

		if (!authHead) {
			return res.status(401).json({ error: 'Authorization header required' });
		}

		const token = authHead.split(' ')[1];

		if (!token) {
			return res.status(401).json({ error: 'Bearer token required' });
		}

		const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
		const tokenUserId = decoded.user.id;
		const requestedUserId = parseInt(req.params.userId || req.params.id);

		if (decoded.user.is_admin) {
			req.user = decoded.user;
			return next();
		}

		if (tokenUserId !== requestedUserId) {
			return res.status(403).json({ error: 'Access denied: ID mismatch' });
		}

		// Attach user to request for use in route handlers
		req.user = decoded.user;
		next();
	} catch (error) {
		res.status(401).json({ error: `Authentication failed: ${error.message}` });
	}
};

/**
 * Middleware to check if user is an admin
 * Usage: app.get('/admin/dashboard', authenticationToken, requireAdmin, handler)
 */
const requireAdmin = (req, res, next) => {
	try {
		if (!req.user) {
			return res.status(401).json({ error: 'Authentication required' });
		}

		if (!req.user.is_admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		next();
	} catch (error) {
		res
			.status(500)
			.json({ error: `Authorization check failed: ${error.message}` });
	}
};

/**
 * Utility function to generate JWT token
 * Usage: const token = generateToken(user);
 */
const generateToken = (user) => {
	try {
		const payload = {
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				is_admin: user.is_admin,
			},
		};

		return jwt.sign(payload, process.env.TOKEN_SECRET, {
			expiresIn: process.env.JWT_EXPIRES_IN || '24h',
		});
	} catch (error) {
		throw new Error(`Token generation failed: ${error.message}`);
	}
};

/**
 * Utility function to verify and decode token (without middleware)
 * Usage: const decoded = verifyToken(token);
 */
const verifyToken = (token) => {
	try {
		return jwt.verify(token, process.env.TOKEN_SECRET);
	} catch (error) {
		throw new Error(`Token verification failed: ${error.message}`);
	}
};

/**
 * Optional middleware for routes that work with or without authentication
 * Sets req.user if token is present and valid, but doesn't block if not
 */
const optionalAuth = (req, res, next) => {
	try {
		const authHead = req.headers.authorization;

		if (authHead) {
			const token = authHead.split(' ')[1];
			if (token) {
				const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
				req.user = decoded.user;
			}
		}

		// Continue regardless of auth status
		next();
	} catch (error) {
		// Token was provided but invalid - continue without setting req.user
		next();
	}
};

module.exports = {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
	generateToken,
	verifyToken,
	optionalAuth,
};
