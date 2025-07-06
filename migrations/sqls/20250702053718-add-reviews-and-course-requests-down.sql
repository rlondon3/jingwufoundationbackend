-- ============================================
-- REVIEWS MIGRATION - DOWN
-- Removes reviews and course_requests tables
-- ============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_update_reviews_timestamp ON reviews;
DROP TRIGGER IF EXISTS trigger_update_course_requests_timestamp ON course_requests;

-- Drop functions
DROP FUNCTION IF EXISTS update_reviews_timestamp();
DROP FUNCTION IF EXISTS update_course_requests_timestamp();

-- Drop indexes
DROP INDEX IF EXISTS idx_reviews_course_id;
DROP INDEX IF EXISTS idx_reviews_user_id;
DROP INDEX IF EXISTS idx_reviews_rating;
DROP INDEX IF EXISTS idx_reviews_is_published;
DROP INDEX IF EXISTS idx_reviews_created_at;

DROP INDEX IF EXISTS idx_course_requests_user_id;
DROP INDEX IF EXISTS idx_course_requests_status;
DROP INDEX IF EXISTS idx_course_requests_priority;
DROP INDEX IF EXISTS idx_course_requests_title;
DROP INDEX IF EXISTS idx_course_requests_created_at;

-- Drop tables (order matters due to foreign key constraints)
DROP TABLE IF EXISTS course_requests CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;