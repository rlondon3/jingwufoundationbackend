-- Remove indexes
DROP INDEX IF EXISTS idx_user_courses_user_active;
DROP INDEX IF EXISTS idx_user_courses_active;

-- Remove is_active column
ALTER TABLE user_courses 
DROP COLUMN IF EXISTS is_active;