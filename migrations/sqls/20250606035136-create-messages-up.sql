-- Message Database Schema for JingWu Foundation
-- Handles threaded conversations between users with read status tracking

-- Conversations table (represents chat threads between two users)
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Ensure user1_id is always smaller than user2_id for consistency
    CHECK (user1_id < user2_id),
    UNIQUE(user1_id, user2_id)
);

-- Messages table with conversation threading
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    message_status VARCHAR(20) DEFAULT 'sent' CHECK (message_status IN ('sent', 'read')),
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_conversations_user1 ON conversations(user1_id);
CREATE INDEX idx_conversations_user2 ON conversations(user2_id);
CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at DESC);
CREATE INDEX idx_messages_status ON messages(message_status);

-- Function to get or create conversation between two users
CREATE OR REPLACE FUNCTION get_or_create_conversation(user_a_id INTEGER, user_b_id INTEGER)
RETURNS INTEGER AS $func$
DECLARE
    conv_id INTEGER;
    smaller_id INTEGER;
    larger_id INTEGER;
BEGIN
    -- Ensure consistent ordering (smaller ID first)
    IF user_a_id < user_b_id THEN
        smaller_id := user_a_id;
        larger_id := user_b_id;
    ELSE
        smaller_id := user_b_id;
        larger_id := user_a_id;
    END IF;
    
    -- Try to find existing conversation
    SELECT id INTO conv_id
    FROM conversations
    WHERE user1_id = smaller_id AND user2_id = larger_id;
    
    -- Create new conversation if doesn't exist
    IF conv_id IS NULL THEN
        INSERT INTO conversations (user1_id, user2_id)
        VALUES (smaller_id, larger_id)
        RETURNING id INTO conv_id;
    END IF;
    
    RETURN conv_id;
END;
$func$ LANGUAGE plpgsql;

-- Function to update conversation last_message_at when new message is sent
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $func$
BEGIN
    UPDATE conversations 
    SET last_message_at = NEW.sent_at,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.conversation_id;
    
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_timestamp
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_timestamp();

-- Function to update read_at timestamp when message status changes to 'read'
CREATE OR REPLACE FUNCTION update_message_read_timestamp()
RETURNS TRIGGER AS $func$
BEGIN
    IF OLD.message_status != 'read' AND NEW.message_status = 'read' THEN
        NEW.read_at := CURRENT_TIMESTAMP;
    END IF;
    
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_message_read_timestamp
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_message_read_timestamp();

-- Triggers for updated_at timestamps
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for conversation list with latest message preview
CREATE VIEW conversation_list AS
SELECT 
    c.id as conversation_id,
    c.user1_id,
    c.user2_id,
    c.last_message_at,
    u1.name as user1_name,
    u1.avatar as user1_avatar,
    u2.name as user2_name,
    u2.avatar as user2_avatar,
    latest_msg.text as latest_message,
    latest_msg.sender_id as latest_sender_id,
    latest_msg.message_status as latest_message_status,
    -- Count unread messages for each user
    (SELECT COUNT(*) FROM messages m 
     WHERE m.conversation_id = c.id 
     AND m.sender_id != c.user1_id 
     AND m.message_status = 'sent') as user1_unread_count,
    (SELECT COUNT(*) FROM messages m 
     WHERE m.conversation_id = c.id 
     AND m.sender_id != c.user2_id 
     AND m.message_status = 'sent') as user2_unread_count
FROM conversations c
JOIN users u1 ON c.user1_id = u1.id
JOIN users u2 ON c.user2_id = u2.id
LEFT JOIN LATERAL (
    SELECT text, sender_id, message_status
    FROM messages 
    WHERE conversation_id = c.id 
    ORDER BY sent_at DESC 
    LIMIT 1
) latest_msg ON true;

-- Sample data
-- Create sample conversations
INSERT INTO conversations (user1_id, user2_id, last_message_at) VALUES
(1, 2, '2024-03-20 10:30:00'), -- Sifu Wong & John Doe
(1, 3, '2024-03-19 15:45:00'), -- Sifu Wong & Sarah Chen
(2, 4, '2024-03-18 09:20:00'); -- John Doe & Mike Johnson

-- Sample messages
INSERT INTO messages (conversation_id, sender_id, text, message_status, sent_at, read_at) VALUES
-- Conversation 1: Sifu Wong & John Doe
(1, 2, 'Hello Sifu, I have a question about the Wing Chun stance.', 'read', '2024-03-20 10:30:00', '2024-03-20 10:32:00'),
(1, 1, 'Hello John! I''d be happy to help. What specifically would you like to know about the stance?', 'read', '2024-03-20 10:35:00', '2024-03-20 10:36:00'),
(1, 2, 'I''m having trouble maintaining balance during the basic stance. Any tips?', 'read', '2024-03-20 10:40:00', '2024-03-20 10:41:00'),
(1, 1, 'Focus on keeping your weight evenly distributed and your spine straight. Practice against a wall initially.', 'sent', '2024-03-20 10:45:00', NULL),

-- Conversation 2: Sifu Wong & Sarah Chen
(2, 3, 'Thank you for the excellent Tai Chi course!', 'read', '2024-03-19 15:45:00', '2024-03-19 15:50:00'),
(2, 1, 'You''re very welcome, Sarah! I''m glad you''re enjoying it. Keep practicing!', 'sent', '2024-03-19 16:00:00', NULL),

-- Conversation 3: John Doe & Mike Johnson
(3, 2, 'Hey Mike, how are you finding the Wing Chun course?', 'read', '2024-03-18 09:20:00', '2024-03-18 09:25:00'),
(3, 4, 'It''s challenging but really interesting! Are you taking it too?', 'sent', '2024-03-18 09:30:00', NULL);