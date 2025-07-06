-- ============================================
-- RESOURCES MIGRATION - DOWN
-- Removes resources and resource_courses tables
-- ============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_update_resources_timestamp ON resources;
DROP FUNCTION IF EXISTS update_resources_timestamp();

-- Drop indexes
DROP INDEX IF EXISTS idx_resources_type;
DROP INDEX IF EXISTS idx_resources_author;
DROP INDEX IF EXISTS idx_resources_is_published;
DROP INDEX IF EXISTS idx_resources_created_at;
DROP INDEX IF EXISTS idx_resources_view_count;

DROP INDEX IF EXISTS idx_resource_courses_resource_id;
DROP INDEX IF EXISTS idx_resource_courses_course_id;

-- Drop tables (order matters due to foreign key constraints)
DROP TABLE IF EXISTS resource_courses CASCADE;
DROP TABLE IF EXISTS resources CASCADE;