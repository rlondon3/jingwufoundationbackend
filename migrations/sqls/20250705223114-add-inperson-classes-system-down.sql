-- ============================================
-- IN-PERSON CLASSES MIGRATION - DOWN
-- Removes classes tables and related objects
-- ============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_update_classes_timestamp ON classes;
DROP TRIGGER IF EXISTS trigger_update_class_enrollments_timestamp ON class_enrollments;
DROP TRIGGER IF EXISTS trigger_update_class_waitlist_timestamp ON class_waitlist;
DROP TRIGGER IF EXISTS trigger_update_class_sessions_timestamp ON class_sessions;

-- Drop functions
DROP FUNCTION IF EXISTS update_classes_timestamp();
DROP FUNCTION IF EXISTS update_class_enrollments_timestamp();
DROP FUNCTION IF EXISTS update_class_waitlist_timestamp();
DROP FUNCTION IF EXISTS update_class_sessions_timestamp();

-- Drop indexes
DROP INDEX IF EXISTS idx_classes_day_of_week;
DROP INDEX IF EXISTS idx_classes_start_time;
DROP INDEX IF EXISTS idx_classes_class_type;
DROP INDEX IF EXISTS idx_classes_instructor_name;
DROP INDEX IF EXISTS idx_classes_location;
DROP INDEX IF EXISTS idx_classes_is_published;
DROP INDEX IF EXISTS idx_classes_skill_focus;

DROP INDEX IF EXISTS idx_class_enrollments_user_id;
DROP INDEX IF EXISTS idx_class_enrollments_class_id;
DROP INDEX IF EXISTS idx_class_enrollments_status;

DROP INDEX IF EXISTS idx_class_waitlist_user_id;
DROP INDEX IF EXISTS idx_class_waitlist_class_id;
DROP INDEX IF EXISTS idx_class_waitlist_status;
DROP INDEX IF EXISTS idx_class_waitlist_created_at;

DROP INDEX IF EXISTS idx_class_sessions_class_id;
DROP INDEX IF EXISTS idx_class_sessions_day_of_week;
DROP INDEX IF EXISTS idx_class_sessions_start_time;

DROP INDEX IF EXISTS idx_class_manual_enrollments_class_id;
DROP INDEX IF EXISTS idx_class_manual_enrollments_status;
DROP INDEX IF EXISTS idx_class_manual_enrollments_email;

-- Drop composite indexes
DROP INDEX IF EXISTS idx_classes_published_day_time;
DROP INDEX IF EXISTS idx_class_enrollments_class_status;
DROP INDEX IF EXISTS idx_class_manual_enrollments_class_status;

-- Drop tables (order matters due to foreign key constraints)
DROP TABLE IF EXISTS class_manual_enrollments CASCADE;
DROP TABLE IF EXISTS class_waitlist CASCADE;
DROP TABLE IF EXISTS class_enrollments CASCADE;
DROP TABLE IF EXISTS class_sessions CASCADE;
DROP TABLE IF EXISTS classes CASCADE;