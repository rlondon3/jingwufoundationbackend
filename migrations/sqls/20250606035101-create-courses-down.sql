/* Replace with your SQL commands */
-- Drop triggers first
DROP TRIGGER IF EXISTS update_user_lesson_progress_updated_at ON user_lesson_progress;
DROP TRIGGER IF EXISTS update_lessons_updated_at ON lessons;
DROP TRIGGER IF EXISTS update_modules_updated_at ON modules;
DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS user_lesson_progress CASCADE;
DROP TABLE IF EXISTS lessons CASCADE;
DROP TABLE IF EXISTS modules CASCADE;
DROP TABLE IF EXISTS course_course_features CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS course_features CASCADE;