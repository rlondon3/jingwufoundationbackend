/* Replace with your SQL commands */
-- Drop views first
DROP VIEW IF EXISTS conversation_list;

-- Drop triggers
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
DROP TRIGGER IF EXISTS trigger_update_message_read_timestamp ON messages;
DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON messages;

-- Drop functions
DROP FUNCTION IF EXISTS update_message_read_timestamp() CASCADE;
DROP FUNCTION IF EXISTS update_conversation_timestamp() CASCADE;
DROP FUNCTION IF EXISTS get_or_create_conversation(INTEGER, INTEGER) CASCADE;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;