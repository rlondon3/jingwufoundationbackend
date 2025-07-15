require('dotenv').config();
const {
	TermsOfServiceStore,
	handleTermsErrors,
} = require('../models/termsOfService');

/**
 * Terms of Service route handler - manages all ToS-related endpoints
 */
const terms_route = (app) => {
	const pool = app.locals.pool;
	const store = new TermsOfServiceStore(pool);

	/**
	 * Get all terms of service records (admin only)
	 * GET /admin/terms-of-service - requires admin authentication
	 */
	const index = async (req, res) => {
		try {
			const records = await store.index();
			return res.status(200).json(records);
		} catch (error) {
			return res.status(400).json({ error: error.message });
		}
	};

	/**
	 * Get terms of service status for a specific user
	 * GET /user/:id/terms-status - requires authentication
	 */
	const getUserTermsStatus = async (req, res) => {
		const userId = parseInt(req.params.id);
		const { version } = req.query;

		try {
			const currentVersion =
				version || process.env.CURRENT_TOS_VERSION || '1.0';
			const hasAccepted = await store.hasAcceptedCurrentTerms(
				userId,
				currentVersion
			);
			const termsRecord = await store.getByUserId(userId);

			return res.status(200).json({
				userId,
				currentVersion,
				hasAcceptedCurrent: hasAccepted,
				latestRecord: termsRecord,
				requiresAcceptance: !hasAccepted,
			});
		} catch (error) {
			console.error('Get terms status error:', error);
			return res.status(500).json({ error: 'Failed to get terms status' });
		}
	};

	/**
	 * Accept terms of service
	 * POST /user/:id/accept-terms - requires user ID authentication
	 */
	const acceptTerms = async (req, res) => {
		const userId = parseInt(req.params.id);
		const { version } = req.body;

		// Get IP address and user agent for audit trail
		const ipAddress = req.headers['x-forwarded-for'] || 
						  req.headers['x-real-ip'] || 
						  req.connection.remoteAddress || 
						  req.socket.remoteAddress || 
						  req.ip || 
						  null;
		
		// Clean up IPv6-mapped IPv4 addresses
		const cleanIpAddress = ipAddress && ipAddress.includes('::ffff:') 
			? ipAddress.replace('::ffff:', '') 
			: ipAddress;
			
		const userAgent = req.get('User-Agent') || null;

		try {
			const currentVersion =
				version || process.env.CURRENT_TOS_VERSION || '1.0';

			// Validate input
			const { error } = handleTermsErrors({
				user_id: userId,
				version: currentVersion,
				ip_address: ipAddress,
				user_agent: userAgent,
			});

			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			const acceptance = await store.acceptTerms(
				userId,
				currentVersion,
				cleanIpAddress,
				userAgent
			);

			return res.status(201).json({
				message: 'Terms of service accepted successfully',
				acceptance,
				timestamp: acceptance.accepted_at,
			});
		} catch (error) {
			console.error('Accept terms error:', error);
			if (error.message.includes('already accepted')) {
				return res.status(400).json({ error: error.message });
			}
			return res
				.status(500)
				.json({ error: 'Failed to accept terms of service' });
		}
	};

	/**
	 * Revoke terms of service acceptance (admin only)
	 * POST /admin/revoke-terms/:userId - requires admin authentication
	 */
	const revokeTerms = async (req, res) => {
		const userId = parseInt(req.params.userId);
		const { reason } = req.body;

		try {
			const revocation = await store.revokeTerms(userId, reason);

			if (!revocation) {
				return res.status(404).json({
					error: 'No accepted terms found for this user',
				});
			}

			return res.status(200).json({
				message: 'Terms of service revoked successfully',
				revocation,
			});
		} catch (error) {
			console.error('Revoke terms error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to revoke terms of service' });
		}
	};

	/**
	 * Get users who haven't accepted current terms (admin only)
	 * GET /admin/users-without-terms - requires admin authentication
	 */
	const getUsersWithoutTerms = async (req, res) => {
		const { version } = req.query;

		try {
			const currentVersion =
				version || process.env.CURRENT_TOS_VERSION || '1.0';
			const users = await store.getUsersWithoutCurrentTerms(currentVersion);

			return res.status(200).json({
				version: currentVersion,
				count: users.length,
				users,
			});
		} catch (error) {
			console.error('Get users without terms error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to get users without terms' });
		}
	};

	/**
	 * Get terms acceptance statistics (admin only)
	 * GET /admin/terms-stats - requires admin authentication
	 */
	const getAcceptanceStats = async (req, res) => {
		const { version } = req.query;

		try {
			const currentVersion =
				version || process.env.CURRENT_TOS_VERSION || '1.0';
			const stats = await store.getAcceptanceStats(currentVersion);

			return res.status(200).json({
				version: currentVersion,
				...stats,
			});
		} catch (error) {
			console.error('Get acceptance stats error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to get acceptance statistics' });
		}
	};

	/**
	 * Middleware to check if user has accepted current terms
	 * Can be used on protected routes that require terms acceptance
	 */
	const requireTermsAcceptance = async (req, res, next) => {
		const userId = req.user?.id;

		if (!userId) {
			return res.status(401).json({ error: 'Authentication required' });
		}

		try {
			const currentVersion = process.env.CURRENT_TOS_VERSION || '1.0';
			const hasAccepted = await store.hasAcceptedCurrentTerms(
				userId,
				currentVersion
			);

			if (!hasAccepted) {
				return res.status(403).json({
					error: 'Terms of service acceptance required',
					code: 'TERMS_REQUIRED',
					currentVersion,
				});
			}

			next();
		} catch (error) {
			console.error('Terms check error:', error);
			return res
				.status(500)
				.json({ error: 'Failed to verify terms acceptance' });
		}
	};

	/**
	 * Delete terms of service record (admin only)
	 * DELETE /admin/terms/:id - requires admin authentication
	 */
	const deleteTermsRecord = async (req, res) => {
		const recordId = parseInt(req.params.id);

		try {
			const deleted = await store.delete(recordId);

			if (!deleted) {
				return res.status(404).json({ error: 'Terms record not found' });
			}

			return res.status(200).json({
				message: 'Terms record deleted successfully',
				deleted,
			});
		} catch (error) {
			console.error('Delete terms record error:', error);
			return res.status(500).json({ error: 'Failed to delete terms record' });
		}
	};

	// Import authentication middleware
	const {
		authenticationToken,
		authenticateUserId,
		requireAdmin,
	} = require('../middleware/auth');

	// Define routes
	// Admin routes
	app.get('/admin/terms-of-service', authenticationToken, requireAdmin, index);
	app.get(
		'/admin/users-without-terms',
		authenticationToken,
		requireAdmin,
		getUsersWithoutTerms
	);
	app.get(
		'/admin/terms-stats',
		authenticationToken,
		requireAdmin,
		getAcceptanceStats
	);
	app.post(
		'/admin/revoke-terms/:userId',
		authenticationToken,
		requireAdmin,
		revokeTerms
	);
	app.delete(
		'/admin/terms/:id',
		authenticationToken,
		requireAdmin,
		deleteTermsRecord
	);

	// User routes
	app.get('/user/:id/terms-status', authenticateUserId, getUserTermsStatus);
	app.post('/user/:id/accept-terms', authenticateUserId, acceptTerms);

	// Export middleware for use in other routes
	app.locals.requireTermsAcceptance = requireTermsAcceptance;
};

module.exports = terms_route;
