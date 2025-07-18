-- Add user_quiz_responses table
CREATE TABLE user_quiz_responses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    question_id VARCHAR(50) NOT NULL,
    question_text TEXT NOT NULL,
    user_answer TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    answered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique response per user/lesson/question/attempt
    UNIQUE(user_id, lesson_id, question_id, attempt_number)
);

-- Indexes for performance
CREATE INDEX idx_quiz_responses_user_lesson ON user_quiz_responses(user_id, lesson_id);
CREATE INDEX idx_quiz_responses_lesson ON user_quiz_responses(lesson_id);
CREATE INDEX idx_quiz_responses_correct ON user_quiz_responses(is_correct);
CREATE INDEX idx_quiz_responses_attempt ON user_quiz_responses(user_id, lesson_id, attempt_number);

-- Add comment to document the table purpose
COMMENT ON TABLE user_quiz_responses IS 'Stores individual user responses to quiz questions for detailed analytics and review';