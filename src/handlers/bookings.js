// handlers/bookings.js
require('dotenv').config();
const {
	BookingsStore,
	validateBooking,
	validateBookingUpdate,
} = require('../models/booking');
const {
	authenticationToken,
	authenticateUserId,
	requireAdmin,
} = require('../middleware/auth');

/**
 * Bookings Handlers - All business logic for booking operations
 */

// ========================
// PUBLIC BOOKING HANDLERS
// ========================

/**
 * Create new booking (public - anyone can book)
 * POST /bookings
 */
const createBooking = async (req, res) => {
	try {
		// Validate booking data
		const { error } = validateBooking(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const booking = await store.createBooking(req.body);

		return res.status(201).json({
			message: 'Booking created successfully',
			booking: booking,
		});
	} catch (error) {
		console.error('Create booking error:', error);
		return res.status(500).json({ error: 'Failed to create booking' });
	}
};

/**
 * Get booking by GUID (public - for confirmation pages)
 * GET /bookings/:guid
 */
const getBookingByGuid = async (req, res) => {
	try {
		const guid = req.params.guid;
		const store = new BookingsStore(req.app.locals.pool);
		const booking = await store.getBookingByGuid(guid);

		if (!booking) {
			return res.status(404).json({ error: 'Booking not found' });
		}

		return res.status(200).json(booking);
	} catch (error) {
		console.error('Get booking by GUID error:', error);
		return res.status(500).json({ error: 'Failed to retrieve booking' });
	}
};

/**
 * Check if user has existing free class booking (public)
 * POST /bookings/check-free-class
 */
const checkFreeClassExists = async (req, res) => {
	try {
		const { email } = req.body;
		
		if (!email) {
			return res.status(400).json({ error: 'Email is required' });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const bookings = await store.getBookingsByEmail(email);
		
		const hasFreeClass = bookings.some(booking => 
			booking.appointment_type === 'free_class' && 
			booking.status !== 'cancelled'
		);

		return res.status(200).json({ hasFreeClass });
	} catch (error) {
		console.error('Check free class exists error:', error);
		return res.status(500).json({ error: 'Failed to check free class' });
	}
};

/**
 * Get available time slots for a date (public)
 * GET /bookings/availability/:date?duration=60
 */
const getAvailableTimeSlots = async (req, res) => {
	try {
		const date = req.params.date;
		const duration = parseInt(req.query.duration) || 60;

		// Validate date format
		if (!date || isNaN(Date.parse(date))) {
			return res
				.status(400)
				.json({ error: 'Valid date is required (YYYY-MM-DD)' });
		}

		// Validate duration
		if (duration < 15 || duration > 480) {
			return res
				.status(400)
				.json({ error: 'Duration must be between 15 and 480 minutes' });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const timeSlots = await store.getAvailableTimeSlots(date, duration);

		return res.status(200).json({
			date: date,
			duration: duration,
			available_slots: timeSlots,
		});
	} catch (error) {
		console.error('Get available time slots error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to get available time slots' });
	}
};

/**
 * Get bookings by email (public - for users to view their bookings)
 * GET /bookings/email/:email
 */
const getBookingsByEmail = async (req, res) => {
	try {
		const email = req.params.email;

		// Basic email validation
		if (!email || !email.includes('@')) {
			return res.status(400).json({ error: 'Valid email is required' });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const bookings = await store.getBookingsByEmail(email);

		return res.status(200).json(bookings);
	} catch (error) {
		console.error('Get bookings by email error:', error);
		return res.status(500).json({ error: 'Failed to retrieve bookings' });
	}
};

/**
 * Get bookings by date range (public - for calendar view)
 * GET /bookings/calendar?start=2025-07-01&end=2025-07-31
 */
const getBookingsForCalendar = async (req, res) => {
	try {
		const { start, end } = req.query;

		if (!start || !end) {
			return res
				.status(400)
				.json({ error: 'Start and end dates are required' });
		}

		// Validate date formats
		if (isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
			return res
				.status(400)
				.json({ error: 'Valid dates are required (YYYY-MM-DD)' });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const bookings = await store.getBookingsByDateRange(start, end);

		return res.status(200).json({
			start_date: start,
			end_date: end,
			bookings: bookings,
		});
	} catch (error) {
		console.error('Get bookings for calendar error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve bookings for calendar' });
	}
};

// ========================
// USER BOOKING HANDLERS
// ========================

/**
 * Get user's bookings
 * GET /users/:userId/bookings
 */
const getUserBookings = async (req, res) => {
	try {
		const userId = parseInt(req.params.userId);
		const store = new BookingsStore(req.app.locals.pool);
		const bookings = await store.getBookingsByUserId(userId);

		return res.status(200).json(bookings);
	} catch (error) {
		console.error('Get user bookings error:', error);
		return res.status(500).json({ error: 'Failed to retrieve user bookings' });
	}
};

/**
 * Update booking (user can update their own bookings)
 * PUT /bookings/:id
 */
const updateBooking = async (req, res) => {
	try {
		const bookingId = parseInt(req.params.id);

		// Validate update data
		const { error } = validateBookingUpdate(req.body);
		if (error) {
			return res.status(400).json({ error: error.details[0].message });
		}

		const store = new BookingsStore(req.app.locals.pool);

		// If user is authenticated, verify they own the booking or are admin
		if (req.user) {
			const existingBooking = await store.getBookingById(bookingId);
			if (!existingBooking) {
				return res.status(404).json({ error: 'Booking not found' });
			}

			// Allow update if user owns the booking or is admin
			if (existingBooking.user_id !== req.user.id && !req.user.is_admin) {
				return res.status(403).json({ error: 'Access denied' });
			}
		}

		const booking = await store.updateBooking(bookingId, req.body);

		if (!booking) {
			return res
				.status(404)
				.json({ error: 'Booking not found or no changes made' });
		}

		return res.status(200).json({
			message: 'Booking updated successfully',
			booking: booking,
		});
	} catch (error) {
		console.error('Update booking error:', error);
		return res.status(500).json({ error: 'Failed to update booking' });
	}
};

/**
 * Cancel booking (update status to cancelled)
 * PUT /bookings/:id/cancel
 */
const cancelBooking = async (req, res) => {
	try {
		const bookingId = parseInt(req.params.id);
		const store = new BookingsStore(req.app.locals.pool);

		// If user is authenticated, verify they own the booking or are admin
		if (req.user) {
			const existingBooking = await store.getBookingById(bookingId);
			if (!existingBooking) {
				return res.status(404).json({ error: 'Booking not found' });
			}

			// Allow cancellation if user owns the booking or is admin
			if (existingBooking.user_id !== req.user.id && !req.user.is_admin) {
				return res.status(403).json({ error: 'Access denied' });
			}
		}

		const booking = await store.updateBookingStatus(bookingId, 'cancelled');

		if (!booking) {
			return res.status(404).json({ error: 'Booking not found' });
		}

		return res.status(200).json({
			message: 'Booking cancelled successfully',
			booking: booking,
		});
	} catch (error) {
		console.error('Cancel booking error:', error);
		return res.status(500).json({ error: 'Failed to cancel booking' });
	}
};

// ========================
// ADMIN HANDLERS
// ========================

/**
 * Get all bookings (admin view)
 * GET /admin/bookings?limit=100&offset=0&status=scheduled
 */
const getAllBookings = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 100;
		const offset = parseInt(req.query.offset) || 0;
		const status = req.query.status;

		if (limit > 500) {
			return res.status(400).json({ error: 'Limit cannot exceed 500' });
		}

		const store = new BookingsStore(req.app.locals.pool);

		let bookings;
		if (status) {
			bookings = await store.getBookingsByStatus(status);
		} else {
			bookings = await store.getAllBookings(limit, offset);
		}

		return res.status(200).json(bookings);
	} catch (error) {
		console.error('Get all bookings error:', error);
		return res.status(500).json({ error: 'Failed to retrieve bookings' });
	}
};

/**
 * Get booking by ID (admin)
 * GET /admin/bookings/:id
 */
const getBookingById = async (req, res) => {
	try {
		const bookingId = parseInt(req.params.id);
		const store = new BookingsStore(req.app.locals.pool);
		const booking = await store.getBookingById(bookingId);

		if (!booking) {
			return res.status(404).json({ error: 'Booking not found' });
		}

		return res.status(200).json(booking);
	} catch (error) {
		console.error('Get booking by ID error:', error);
		return res.status(500).json({ error: 'Failed to retrieve booking' });
	}
};

/**
 * Update booking status (admin)
 * PUT /admin/bookings/:id/status
 */
const updateBookingStatus = async (req, res) => {
	try {
		const bookingId = parseInt(req.params.id);
		const { status } = req.body;

		if (
			!status ||
			!['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(
				status
			)
		) {
			return res.status(400).json({ error: 'Valid status is required' });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const booking = await store.updateBookingStatus(bookingId, status);

		if (!booking) {
			return res.status(404).json({ error: 'Booking not found' });
		}

		return res.status(200).json({
			message: 'Booking status updated successfully',
			booking: booking,
		});
	} catch (error) {
		console.error('Update booking status error:', error);
		return res.status(500).json({ error: 'Failed to update booking status' });
	}
};

/**
 * Delete completed written guidance booking (user)
 * DELETE /bookings/:id/completed
 */
const deleteCompletedBooking = async (req, res) => {
	try {
		const bookingId = parseInt(req.params.id);
		const userId = req.user.id;
		
		const store = new BookingsStore(req.app.locals.pool);
		
		// First check if the booking exists, belongs to the user, and is completed written guidance
		const booking = await store.getBookingById(bookingId);
		
		if (!booking) {
			return res.status(404).json({ error: 'Booking not found' });
		}
		
		if (booking.user_id !== userId) {
			return res.status(403).json({ error: 'Access denied - not your booking' });
		}
		
		if (booking.appointment_type !== 'written_guidance') {
			return res.status(400).json({ error: 'Only written guidance bookings can be deleted' });
		}
		
		if (booking.status !== 'completed') {
			return res.status(400).json({ error: 'Only completed bookings can be deleted' });
		}
		
		// Delete the booking
		const deletedBooking = await store.deleteBooking(bookingId);
		
		return res.status(200).json({
			message: 'Completed written guidance booking deleted successfully',
			booking: deletedBooking,
		});
	} catch (error) {
		console.error('Delete completed booking error:', error);
		return res.status(500).json({ error: 'Failed to delete completed booking' });
	}
};

/**
 * Delete booking (admin)
 * DELETE /admin/bookings/:id
 */
const deleteBooking = async (req, res) => {
	try {
		const bookingId = parseInt(req.params.id);
		const store = new BookingsStore(req.app.locals.pool);
		const booking = await store.deleteBooking(bookingId);

		if (!booking) {
			return res.status(404).json({ error: 'Booking not found' });
		}

		return res.status(200).json({
			message: 'Booking deleted successfully',
			booking: booking,
		});
	} catch (error) {
		console.error('Delete booking error:', error);
		return res.status(500).json({ error: 'Failed to delete booking' });
	}
};

/**
 * Get bookings by date range (admin)
 * GET /admin/bookings/date-range?start=2025-07-01&end=2025-07-31
 */
const getBookingsByDateRange = async (req, res) => {
	try {
		const { start, end } = req.query;

		if (!start || !end) {
			return res
				.status(400)
				.json({ error: 'Start and end dates are required' });
		}

		// Validate date formats
		if (isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
			return res
				.status(400)
				.json({ error: 'Valid dates are required (YYYY-MM-DD)' });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const bookings = await store.getBookingsByDateRange(start, end);

		return res.status(200).json({
			start_date: start,
			end_date: end,
			bookings: bookings,
		});
	} catch (error) {
		console.error('Get bookings by date range error:', error);
		return res
			.status(500)
			.json({ error: 'Failed to retrieve bookings by date range' });
	}
};

/**
 * Get booking statistics (admin)
 * GET /admin/bookings/stats
 */
const getBookingStats = async (req, res) => {
	try {
		const store = new BookingsStore(req.app.locals.pool);
		const stats = await store.getBookingStats();

		return res.status(200).json(stats);
	} catch (error) {
		console.error('Get booking stats error:', error);
		return res.status(500).json({ error: 'Failed to get booking statistics' });
	}
};

/**
 * Get upcoming bookings (admin)
 * GET /admin/bookings/upcoming?limit=10
 */
const getUpcomingBookings = async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 10;

		if (limit > 100) {
			return res.status(400).json({ error: 'Limit cannot exceed 100' });
		}

		const store = new BookingsStore(req.app.locals.pool);
		const bookings = await store.getUpcomingBookings(limit);

		return res.status(200).json(bookings);
	} catch (error) {
		console.error('Get upcoming bookings error:', error);
		return res.status(500).json({ error: 'Failed to get upcoming bookings' });
	}
};

/**
 * Bookings route handler - manages all booking endpoints
 */
const bookings_route = (app) => {
	// Public routes (no authentication required)
	app.post('/bookings', createBooking);
	app.post('/bookings/check-free-class', checkFreeClassExists);
	app.get('/bookings/calendar', getBookingsForCalendar);
	app.get('/bookings/availability/:date', getAvailableTimeSlots);
	app.get('/bookings/email/:email', getBookingsByEmail);
	app.get('/bookings/:guid', getBookingByGuid);

	// User routes (authentication required)
	app.get('/users/:userId/bookings', authenticateUserId, getUserBookings);
	app.delete('/bookings/:id/completed', authenticationToken, deleteCompletedBooking);

	// Booking management routes (optional authentication - public or user-owned)
	app.put(
		'/bookings/:id',
		(req, res, next) => {
			// Try to authenticate but don't require it
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		updateBooking
	);

	app.put(
		'/bookings/:id/cancel',
		(req, res, next) => {
			// Try to authenticate but don't require it
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				authenticationToken(req, res, next);
			} else {
				next();
			}
		},
		cancelBooking
	);

	// Admin routes (admin authentication required)
	app.get('/admin/bookings', authenticationToken, requireAdmin, getAllBookings);
	app.get(
		'/admin/bookings/stats',
		authenticationToken,
		requireAdmin,
		getBookingStats
	);
	app.get(
		'/admin/bookings/upcoming',
		authenticationToken,
		requireAdmin,
		getUpcomingBookings
	);
	app.get(
		'/admin/bookings/date-range',
		authenticationToken,
		requireAdmin,
		getBookingsByDateRange
	);
	app.get(
		'/admin/bookings/:id',
		authenticationToken,
		requireAdmin,
		getBookingById
	);
	app.put(
		'/admin/bookings/:id/status',
		authenticationToken,
		requireAdmin,
		updateBookingStatus
	);
	app.delete(
		'/admin/bookings/:id',
		authenticationToken,
		requireAdmin,
		deleteBooking
	);
};

module.exports = bookings_route;
