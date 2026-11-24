-- Admin-picked guided feedback answers shown as quotes on the course page
ALTER TABLE course_feedback_responses
  ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_feedback_responses_featured
  ON course_feedback_responses(question_id) WHERE is_featured;

-- Heading for that section; NULL means the default heading
ALTER TABLE courses
  ADD COLUMN featured_feedback_heading VARCHAR(150) DEFAULT NULL;
