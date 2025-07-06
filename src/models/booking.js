require('dotenv').config();
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

/**
 * BookingsStore handles all booking operations
 * Manages appointment scheduling, availability, and booking management
 */
class BookingsStore {
	constructor(pool) {
		this.pool = pool;
	}

	// ========================
	// BOOKING OPERATIONS
	// ========================

	/**
	 * Create new booking
	 */
	async createBooking(bookingData) {
		try {
			// Check for booking conflicts before creating
			const conflictingBookings = await this.checkBookingConflicts(
				bookingData.start_time,
				bookingData.end_time
			);
			
			if (conflictingBookings.length > 0) {
				throw new Error('Time slot is already booked. Please choose a different time.');
			}

			// Generate booking GUID if not provided (6 characters for user-friendliness)
			let bookingGuid = bookingData.booking_guid;
			if (!bookingGuid) {
				const fullGuid = uuidv4().replace(/-/g, '');
				const randomPositions = [3, 8, 12, 16, 22, 28];
				bookingGuid = randomPositions
					.map((pos) => fullGuid.charAt(pos % fullGuid.length))
					.join('')
					.toUpperCase();
			}

			const sql = `
        INSERT INTO bookings (
          booking_guid, appointment_type, full_name, email, phone_number, 
          start_time, end_time, notes, user_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [
				bookingGuid,
				bookingData.appointment_type,
				bookingData.full_name,
				bookingData.email,
				bookingData.phone_number || null,
				bookingData.start_time,
				bookingData.end_time,
				bookingData.notes || null,
				bookingData.user_id || null,
				bookingData.status || 'scheduled',
			]);

			client.release();
			return res.rows[0];
		} catch (error) {
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
			throw new Error(`Could not create booking: ${error}`);
		}
	}

	/**
	 * Get booking by ID
	 */
	async getBookingById(id) {
		try {
			const sql = `
        SELECT 
          b.*,
          u.name as user_name,
          u.email as user_email
        FROM bookings b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.id = $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get booking by ID: ${error}`);
		}
	}

	/**
	 * Get booking by GUID
	 */
	async getBookingByGuid(guid) {
		try {
			const sql = `
        SELECT 
          b.*,
          u.name as user_name,
          u.email as user_email
        FROM bookings b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.booking_guid = $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [guid]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get booking by GUID: ${error}`);
		}
	}

	/**
	 * Get bookings by email
	 */
	async getBookingsByEmail(email) {
		try {
			const sql = `
        SELECT 
          b.*,
          u.name as user_name
        FROM bookings b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.email = $1
        ORDER BY b.start_time
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [email]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get bookings by email: ${error}`);
		}
	}

	/**
	 * Get bookings by user ID
	 */
	async getBookingsByUserId(userId) {
		try {
			const sql = `
        SELECT b.*
        FROM bookings b
        WHERE b.user_id = $1
        ORDER BY b.start_time
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [userId]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get bookings by user ID: ${error}`);
		}
	}

	/**
	 * Get bookings by date range
	 */
	async getBookingsByDateRange(startDate, endDate) {
		let client;
		try {
			const sql = `
        SELECT 
          b.*,
          u.name as user_name,
          u.email as user_email
        FROM bookings b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.start_time >= $1 AND b.end_time <= $2
        ORDER BY b.start_time
      `;

			client = await this.pool.connect();
			const res = await client.query(sql, [startDate, endDate]);
			client.release();
			return res.rows;
		} catch (error) {
			// Ensure client is released even if an error occurs
			if (client) {
				client.release();
			}
			throw new Error(`Could not get bookings by date range: ${error}`);
		}
	}

	/**
	 * Get bookings by status
	 */
	async getBookingsByStatus(status) {
		try {
			const sql = `
        SELECT 
          b.*,
          u.name as user_name,
          u.email as user_email
        FROM bookings b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.status = $1
        ORDER BY b.start_time
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [status]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get bookings by status: ${error}`);
		}
	}

	/**
	 * Get all bookings
	 */
	async getAllBookings(limit = 100, offset = 0) {
		try {
			const sql = `
        SELECT 
          b.*,
          u.name as user_name,
          u.email as user_email
        FROM bookings b
        LEFT JOIN users u ON b.user_id = u.id
        ORDER BY b.start_time DESC
        LIMIT $1 OFFSET $2
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit, offset]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get all bookings: ${error}`);
		}
	}

	/**
	 * Update booking
	 */
	async updateBooking(id, updateData) {
		try {
			// Check for time conflicts if start_time or end_time is being updated
			if (updateData.start_time || updateData.end_time) {
				// Get current booking to check times
				const currentBooking = await this.getBookingById(id);
				if (!currentBooking) {
					throw new Error('Booking not found');
				}

				const newStartTime = updateData.start_time || currentBooking.start_time;
				const newEndTime = updateData.end_time || currentBooking.end_time;

				// Check for conflicts (excluding this booking)
				const conflictingBookings = await this.checkBookingConflicts(newStartTime, newEndTime);
				const filteredConflicts = conflictingBookings.filter(booking => booking.id !== id);
				
				if (filteredConflicts.length > 0) {
					throw new Error('Time slot is already booked. Please choose a different time.');
				}
			}

			const allowedFields = [
				'appointment_type',
				'full_name',
				'email',
				'phone_number',
				'start_time',
				'end_time',
				'notes',
				'user_id',
				'status',
			];

			// Filter allowed fields
			const updates = Object.keys(updateData).filter((key) =>
				allowedFields.includes(key)
			);

			if (updates.length === 0) {
				return null;
			}

			// Build SET clause
			const setClause = updates
				.map((key, index) => `${key} = $${index + 1}`)
				.join(', ');
			const values = updates.map((key) => updateData[key]);

			const sql = `
        UPDATE bookings SET 
          ${setClause}, 
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $${values.length + 1}
        RETURNING *
      `;

			values.push(id);

			const client = await this.pool.connect();
			const res = await client.query(sql, values);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update booking: ${error}`);
		}
	}

	/**
	 * Update booking status
	 */
	async updateBookingStatus(id, status) {
		try {
			const sql = `
        UPDATE bookings SET 
          status = $1, 
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [status, id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not update booking status: ${error}`);
		}
	}

	/**
	 * Delete booking
	 */
	async deleteBooking(id) {
		try {
			const sql = 'DELETE FROM bookings WHERE id = $1 RETURNING *';

			const client = await this.pool.connect();
			const res = await client.query(sql, [id]);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not delete booking: ${error}`);
		}
	}

	// ========================
	// CONFLICT CHECKING
	// ========================

	/**
	 * Check for booking conflicts with given time range
	 */
	async checkBookingConflicts(startTime, endTime) {
		try {
			const sql = `
				SELECT * FROM bookings 
				WHERE status != 'cancelled' 
				AND (
					(start_time < $2 AND end_time > $1) OR
					(start_time >= $1 AND start_time < $2) OR
					(end_time > $1 AND end_time <= $2)
				)
			`;
			
			const client = await this.pool.connect();
			const result = await client.query(sql, [startTime, endTime]);
			client.release();
			
			return result.rows;
		} catch (error) {
			throw new Error(`Could not check booking conflicts: ${error}`);
		}
	}

	// ========================
	// AVAILABILITY OPERATIONS
	// ========================

	/**
	 * Get available time slots for a specific date
	 */
	async getAvailableTimeSlots(date, duration = 60) {
		try {
			// Set operating hours (9 AM to 5 PM)
			const startOfDay = new Date(date);
			startOfDay.setHours(9, 0, 0, 0);
			const endOfDay = new Date(date);
			endOfDay.setHours(17, 0, 0, 0);

			// Get all bookings for the specified date
			const bookings = await this.getBookingsByDateRange(
				startOfDay.toISOString(),
				endOfDay.toISOString()
			);

			// Generate time slots
			const timeSlots = [];
			const slotInterval = 30; // minutes

			for (let minutes = 0; minutes < 8 * 60; minutes += slotInterval) {
				const startTime = new Date(startOfDay);
				startTime.setMinutes(startTime.getMinutes() + minutes);
				const endTime = new Date(startTime);
				endTime.setMinutes(endTime.getMinutes() + duration);

				// Ensure slot ends before end of day
				if (endTime <= endOfDay) {
					const isAvailable = !bookings.some((booking) => {
						const bookingStart = new Date(booking.start_time);
						const bookingEnd = new Date(booking.end_time);

						// Check for overlap
						return (
							(startTime >= bookingStart && startTime < bookingEnd) ||
							(endTime > bookingStart && endTime <= bookingEnd) ||
							(startTime <= bookingStart && endTime >= bookingEnd)
						);
					});

					if (isAvailable) {
						timeSlots.push({
							start_time: startTime.toISOString(),
							end_time: endTime.toISOString(),
						});
					}
				}
			}

			return timeSlots;
		} catch (error) {
			throw new Error(`Could not get available time slots: ${error}`);
		}
	}

	// ========================
	// ANALYTICS OPERATIONS
	// ========================

	/**
	 * Get booking statistics
	 */
	async getBookingStats() {
		try {
			const sql = `
        SELECT 
          COUNT(*) as total_bookings,
          COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled_bookings,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_bookings,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_bookings,
          COUNT(*) FILTER (WHERE start_time >= CURRENT_DATE - INTERVAL '30 days') as monthly_bookings,
          COUNT(*) FILTER (WHERE start_time >= CURRENT_DATE - INTERVAL '7 days') as weekly_bookings,
          COUNT(DISTINCT email) as unique_clients
        FROM bookings
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql);
			client.release();
			return res.rows[0];
		} catch (error) {
			throw new Error(`Could not get booking statistics: ${error}`);
		}
	}

	/**
	 * Get upcoming bookings
	 */
	async getUpcomingBookings(limit = 10) {
		try {
			const sql = `
        SELECT 
          b.*,
          u.name as user_name,
          u.email as user_email
        FROM bookings b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.start_time > CURRENT_TIMESTAMP
        AND b.status = 'scheduled'
        ORDER BY b.start_time ASC
        LIMIT $1
      `;

			const client = await this.pool.connect();
			const res = await client.query(sql, [limit]);
			client.release();
			return res.rows;
		} catch (error) {
			throw new Error(`Could not get upcoming bookings: ${error}`);
		}
	}
}

/**
 * Validation schema for booking data
 */
function validateBooking(booking) {
	const bookingSchema = Joi.object({
		booking_guid: Joi.string().allow(null),
		appointment_type: Joi.string().min(1).max(100).required(),
		full_name: Joi.string().min(1).max(100).required(),
		email: Joi.string().email().required(),
		phone_number: Joi.string().max(20).allow('', null),
		start_time: Joi.date().iso().required(),
		end_time: Joi.date().iso().greater(Joi.ref('start_time')).required(),
		notes: Joi.string().max(1000).allow('', null),
		user_id: Joi.number().integer().positive().allow(null),
		status: Joi.string()
			.valid('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')
			.default('scheduled'),
	});

	return bookingSchema.validate(booking);
}

function validateBookingUpdate(booking) {
	const updateSchema = Joi.object({
		appointment_type: Joi.string().min(1).max(100),
		full_name: Joi.string().min(1).max(100),
		email: Joi.string().email(),
		phone_number: Joi.string().max(20).allow('', null),
		start_time: Joi.date().iso(),
		end_time: Joi.date().iso(),
		notes: Joi.string().max(1000).allow('', null),
		user_id: Joi.number().integer().positive().allow(null),
		status: Joi.string().valid(
			'scheduled',
			'confirmed',
			'completed',
			'cancelled',
			'no_show'
		),
	}).min(1); // At least one field must be provided

	return updateSchema.validate(booking);
}

module.exports = {
	BookingsStore,
	validateBooking,
	validateBookingUpdate,
};
