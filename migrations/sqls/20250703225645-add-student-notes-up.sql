-- ============================================
-- STUDENT NOTES MIGRATION - UP
-- Creates student_notes table for user notes on AI conversations
-- ============================================

-- Create student_notes table
CREATE TABLE student_notes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ai_conversation_id INTEGER REFERENCES ai_conversation_history(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(200),
    note_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_student_notes_user_id ON student_notes(user_id);
CREATE INDEX idx_student_notes_ai_conversation_id ON student_notes(ai_conversation_id);
CREATE INDEX idx_student_notes_course_id ON student_notes(course_id);
CREATE INDEX idx_student_notes_created_at ON student_notes(created_at);

-- Full-text search index for note content
CREATE INDEX idx_student_notes_search ON student_notes USING gin(to_tsvector('english', title || ' ' || note_text));

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_student_notes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_student_notes_timestamp
    BEFORE UPDATE ON student_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_student_notes_timestamp();