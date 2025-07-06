-- ============================================
-- AI CONVERSATION HISTORY MIGRATION - UP
-- Creates ai_conversation_history table for permanent Q&A storage
-- ============================================

-- Create ai_conversation_history table
CREATE TABLE ai_conversation_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    response_text TEXT NOT NULL,
    course_context INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    cost_cents INTEGER DEFAULT 0,
    response_time_ms INTEGER DEFAULT 0,
    cached_response BOOLEAN DEFAULT FALSE,
    session_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_ai_conversation_user_id ON ai_conversation_history(user_id);
CREATE INDEX idx_ai_conversation_course_context ON ai_conversation_history(course_context);
CREATE INDEX idx_ai_conversation_created_at ON ai_conversation_history(created_at);
CREATE INDEX idx_ai_conversation_cached_response ON ai_conversation_history(cached_response);
CREATE INDEX idx_ai_conversation_session_id ON ai_conversation_history(session_id);

-- Full-text search indexes for searching questions and responses
CREATE INDEX idx_ai_conversation_question_text ON ai_conversation_history USING gin(to_tsvector('english', question_text));
CREATE INDEX idx_ai_conversation_response_text ON ai_conversation_history USING gin(to_tsvector('english', response_text));

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_conversation_timestamp
    BEFORE UPDATE ON ai_conversation_history
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_conversation_timestamp();