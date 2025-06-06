/* Replace with your SQL commands */
-- Drop triggers first
DROP TRIGGER IF EXISTS update_user_courses_updated_at ON user_courses;
DROP TRIGGER IF EXISTS update_privacy_updated_at ON privacy_settings;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS user_courses CASCADE;
DROP TABLE IF EXISTS privacy_settings CASCADE;
DROP TABLE IF EXISTS users CASCADE;