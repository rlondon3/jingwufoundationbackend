require('dotenv').config();
const {
	PasswordResetStore,
	handlePasswordResetErrors,
	handleNewPasswordErrors,
} = require('../models/passwordReset');
const { generateToken } = require('../middleware/auth');

/**
 * Password Reset route handler - manages password reset flow
 */
const password_reset_route = (app) => {
	const pool = app.locals.pool;
	const store = new PasswordResetStore(pool);

	/**
	 * Request password reset with security verification
	 * POST /user/request-reset - public endpoint
	 */
	const requestReset = async (req, res) => {
		const { email, securityAnswers } = req.body;

		try {
			// Validate input
			const { error } = handlePasswordResetErrors({ email, securityAnswers });
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const result = await store.createResetRequest(email, securityAnswers);

			if (!result.success) {
				return res.status(400).json({ error: result.message });
			}

			return res.status(200).json({
				message:
					'Security verification successful. Use the temporary password to login.',
				tempPassword: result.tempPassword,
				expiresAt: result.expiresAt,
				user: {
					username: result.user.username,
					email: result.user.email,
				},
			});
		} catch (error) {
			console.error('Password reset request error:', error);
			return res.status(500).json({ error: 'Failed to process reset request' });
		}
	};

	/**
	 * Authenticate with temporary password
	 * POST /user/auth-temp - public endpoint
	 */
	const authenticateTemp = async (req, res) => {
		const { username, tempPassword } = req.body;

		if (!username || !tempPassword) {
			return res.status(400).json({
				error: 'Username and temporary password are required',
			});
		}

		try {
			const user = await store.authenticateWithTempPassword(
				username,
				tempPassword
			);

			if (!user) {
				return res.status(401).json({
					error:
						'Invalid username or temporary password, or temporary password has expired',
				});
			}

			// Generate JWT token with special flag
			const token = generateToken(user);

			return res.status(200).json({
				token,
				user: {
					id: user.id,
					name: user.name,
					email: user.email,
					username: user.username,
					is_admin: user.is_admin,
					requiresPasswordChange: true,
				},
				message:
					'Logged in with temporary password. You must change your password now.',
			});
		} catch (error) {
			console.error('Temporary authentication error:', error);
			return res.status(500).json({ error: 'Authentication failed' });
		}
	};

	/**
	 * Set new password after temp login
	 * PUT /user/set-new-password - requires authentication
	 */
	const setNewPassword = async (req, res) => {
		const { newPassword, confirmPassword } = req.body;

		try {
			// Validate input
			const { error } = handleNewPasswordErrors({
				newPassword,
				confirmPassword,
			});
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			// Check if user has an active reset request (extra security)
			const resetRequest = await store.getResetRequest(req.user.id);
			if (!resetRequest) {
				return res.status(400).json({
					error: 'No active password reset found. Please request a new reset.',
				});
			}

			// Set new password
			const updatedUser = await store.setNewPassword(req.user.id, newPassword);

			// Generate new token without the requiresPasswordChange flag
			const newToken = generateToken({
				...updatedUser,
				requiresPasswordChange: false,
			});

			return res.status(200).json({
				message: 'Password changed successfully',
				token: newToken,
				user: {
					id: updatedUser.id,
					name: updatedUser.name,
					email: updatedUser.email,
					username: updatedUser.username,
					is_admin: updatedUser.is_admin,
					requiresPasswordChange: false,
				},
			});
		} catch (error) {
			console.error('Set new password error:', error);
			return res.status(500).json({ error: 'Failed to set new password' });
		}
	};

	/**
	 * Check if user needs password change
	 * GET /user/password-status - requires authentication
	 */
	const getPasswordStatus = async (req, res) => {
		try {
			const resetRequest = await store.getResetRequest(req.user.id);

			return res.status(200).json({
				requiresPasswordChange: !!resetRequest,
				hasActiveReset: !!resetRequest,
			});
		} catch (error) {
			console.error('Get password status error:', error);
			return res.status(500).json({ error: 'Failed to get password status' });
		}
	};

	/**
	 * Get security questions for password reset
	 * GET /user/security-questions/:email - public endpoint
	 */
	const getSecurityQuestions = async (req, res) => {
		const { email } = req.params;

		try {
			const result = await store.getSecurityQuestions(email);

			return res.status(200).json({
				questions: result.questions,
				hints: result.hints || null,
			});
		} catch (error) {
			console.error('Get security questions error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to get security questions' });
		}
	};

	/**
	 * Cleanup expired reset requests
	 * DELETE /admin/cleanup-resets - requires admin authentication
	 */
	const cleanupExpiredRequests = async (req, res) => {
		try {
			const deletedCount = await store.cleanupExpiredRequests();

			return res.status(200).json({
				message: `Cleaned up ${deletedCount} expired reset requests`,
				deletedCount,
			});
		} catch (error) {
			console.error('Cleanup error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to cleanup expired requests' });
		}
	};

	// Import authentication middleware
	const { authenticationToken, requireAdmin } = require('../middleware/auth');

	// Define routes
	app.post('/user/request-reset', requestReset);
	app.post('/user/auth-temp', authenticateTemp);
	app.put('/user/set-new-password', authenticationToken, setNewPassword);
	app.get('/user/password-status', authenticationToken, getPasswordStatus);
	app.get('/user/security-questions/:email', getSecurityQuestions);
	app.delete(
		'/admin/cleanup-resets',
		authenticationToken,
		requireAdmin,
		cleanupExpiredRequests
	);

	// Optional: Auto-cleanup expired requests every hour
	setInterval(async () => {
		try {
			const deletedCount = await store.cleanupExpiredRequests();
			if (deletedCount > 0) {
				console.log(
					`Auto-cleanup: Removed ${deletedCount} expired reset requests`
				);
			}
		} catch (error) {
			console.error('Auto-cleanup error:', error);
		}
	}, 60 * 60 * 1000); // 1 hour
};

module.exports = password_reset_route;
