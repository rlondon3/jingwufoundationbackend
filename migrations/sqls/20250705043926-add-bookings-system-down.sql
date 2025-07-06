-- ============================================
-- BOOKINGS MIGRATION - DOWN
-- Removes bookings table and related objects
-- ============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_update_bookings_timestamp ON bookings;
DROP TRIGGER IF EXISTS trigger_set_booking_guid ON bookings;

-- Drop functions
DROP FUNCTION IF EXISTS update_bookings_timestamp();
DROP FUNCTION IF EXISTS set_booking_guid();
DROP FUNCTION IF EXISTS generate_booking_guid();

-- Drop indexes
DROP INDEX IF EXISTS idx_bookings_booking_guid;
DROP INDEX IF EXISTS idx_bookings_email;
DROP INDEX IF EXISTS idx_bookings_user_id;
DROP INDEX IF EXISTS idx_bookings_start_time;
DROP INDEX IF EXISTS idx_bookings_end_time;
DROP INDEX IF EXISTS idx_bookings_status;
DROP INDEX IF EXISTS idx_bookings_appointment_type;
DROP INDEX IF EXISTS idx_bookings_created_at;

-- Drop composite indexes
DROP INDEX IF EXISTS idx_bookings_status_start_time;
DROP INDEX IF EXISTS idx_bookings_email_start_time;
DROP INDEX IF EXISTS idx_bookings_date_range;

-- Drop table
DROP TABLE IF EXISTS bookings CASCADE;