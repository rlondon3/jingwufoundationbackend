-- Remove constraints
ALTER TABLE course_feedback_responses DROP CONSTRAINT IF EXISTS unique_response_per_question;
ALTER TABLE course_feedback_triggers DROP CONSTRAINT IF EXISTS unique_course_trigger_percentage;

-- Drop indexes
DROP INDEX IF EXISTS idx_reviews_guided_feedback;
DROP INDEX IF EXISTS idx_feedback_responses_question;
DROP INDEX IF EXISTS idx_feedback_responses_review;
DROP INDEX IF EXISTS idx_feedback_triggers_course;
DROP INDEX IF EXISTS idx_feedback_questions_course_version;

-- Remove columns from reviews table
ALTER TABLE reviews 
DROP COLUMN IF EXISTS feedback_completed_at,
DROP COLUMN IF EXISTS triggered_at_percentage,
DROP COLUMN IF EXISTS is_guided_feedback;

-- Drop tables in reverse order
DROP TABLE IF EXISTS course_feedback_responses;
DROP TABLE IF EXISTS course_feedback_triggers;
DROP TABLE IF EXISTS course_feedback_questions;