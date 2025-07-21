-- Create course feedback questions table
CREATE TABLE course_feedback_questions (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('text', 'yes_no')),
  is_required BOOLEAN DEFAULT false,
  display_order INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create course feedback triggers table
CREATE TABLE course_feedback_triggers (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  trigger_percentage INTEGER NOT NULL CHECK (trigger_percentage >= 0 AND trigger_percentage <= 100),
  is_blocking BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create course feedback responses table
CREATE TABLE course_feedback_responses (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES course_feedback_questions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response_text TEXT,
  response_boolean BOOLEAN,
  question_version INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add new columns to reviews table for guided feedback
ALTER TABLE reviews 
ADD COLUMN is_guided_feedback BOOLEAN DEFAULT false,
ADD COLUMN triggered_at_percentage INTEGER,
ADD COLUMN feedback_completed_at TIMESTAMP;

-- Create indexes for performance
CREATE INDEX idx_feedback_questions_course_version ON course_feedback_questions(course_id, version, is_active);
CREATE INDEX idx_feedback_triggers_course ON course_feedback_triggers(course_id, is_active);
CREATE INDEX idx_feedback_responses_review ON course_feedback_responses(review_id);
CREATE INDEX idx_feedback_responses_question ON course_feedback_responses(question_id);
CREATE INDEX idx_reviews_guided_feedback ON reviews(is_guided_feedback, triggered_at_percentage);

-- Add unique constraints
ALTER TABLE course_feedback_triggers 
ADD CONSTRAINT unique_course_trigger_percentage 
UNIQUE (course_id, trigger_percentage);

ALTER TABLE course_feedback_responses 
ADD CONSTRAINT unique_response_per_question 
UNIQUE (review_id, question_id);