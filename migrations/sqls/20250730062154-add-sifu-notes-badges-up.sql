 -- Add is_viewed field to ai_conversation_history table
  ALTER TABLE ai_conversation_history
  ADD COLUMN is_viewed BOOLEAN DEFAULT FALSE;

  -- Add is_read field to student_notes table  
  ALTER TABLE student_notes
  ADD COLUMN is_read BOOLEAN DEFAULT FALSE;

  -- Create index for efficient badge count queries
  CREATE INDEX idx_ai_conversation_history_is_viewed ON ai_conversation_history(user_id, is_viewed);
  CREATE INDEX idx_student_notes_is_read ON student_notes(user_id, is_read);

  -- Set existing records as viewed/read to avoid showing old items as new
  UPDATE ai_conversation_history SET is_viewed = TRUE WHERE created_at < CURRENT_TIMESTAMP;
  UPDATE student_notes SET is_read = TRUE WHERE created_at < CURRENT_TIMESTAMP;