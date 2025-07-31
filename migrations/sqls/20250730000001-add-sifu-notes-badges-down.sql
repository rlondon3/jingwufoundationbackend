-- Remove notification tracking fields for Sifu's Notes badge system

-- Drop indexes
DROP INDEX IF EXISTS idx_ai_conversation_history_is_viewed;
DROP INDEX IF EXISTS idx_student_notes_is_read;

-- Remove columns
ALTER TABLE ai_conversation_history DROP COLUMN IF EXISTS is_viewed;
ALTER TABLE student_notes DROP COLUMN IF EXISTS is_read;