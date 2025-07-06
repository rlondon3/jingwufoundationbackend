-- ============================================
-- AI CONVERSATION HISTORY MIGRATION - DOWN
-- Removes ai_conversation_history table and related objects
-- ============================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_update_ai_conversation_timestamp ON ai_conversation_history;

-- Drop functions
DROP FUNCTION IF EXISTS update_ai_conversation_timestamp();

-- Drop indexes
DROP INDEX IF EXISTS idx_ai_conversation_user_id;
DROP INDEX IF EXISTS idx_ai_conversation_course_context;
DROP INDEX IF EXISTS idx_ai_conversation_created_at;
DROP INDEX IF EXISTS idx_ai_conversation_cached_response;
DROP INDEX IF EXISTS idx_ai_conversation_session_id;
DROP INDEX IF EXISTS idx_ai_conversation_question_text;
DROP INDEX IF EXISTS idx_ai_conversation_response_text;

-- Drop table
DROP TABLE IF EXISTS ai_conversation_history CASCADE;