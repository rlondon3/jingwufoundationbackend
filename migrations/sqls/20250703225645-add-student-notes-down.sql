-- ============================================
-- STUDENT NOTES MIGRATION - DOWN
-- Removes student_notes table and related objects
-- ============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_update_student_notes_timestamp ON student_notes;

-- Drop functions
DROP FUNCTION IF EXISTS update_student_notes_timestamp();

-- Drop indexes
DROP INDEX IF EXISTS idx_student_notes_user_id;
DROP INDEX IF EXISTS idx_student_notes_ai_conversation_id;
DROP INDEX IF EXISTS idx_student_notes_course_id;
DROP INDEX IF EXISTS idx_student_notes_created_at;
DROP INDEX IF EXISTS idx_student_notes_search;

-- Drop table
DROP TABLE IF EXISTS student_notes CASCADE;