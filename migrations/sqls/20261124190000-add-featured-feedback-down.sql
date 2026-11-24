ALTER TABLE courses
  DROP COLUMN IF EXISTS featured_feedback_heading;

DROP INDEX IF EXISTS idx_feedback_responses_featured;

ALTER TABLE course_feedback_responses
  DROP COLUMN IF EXISTS is_featured;
