CREATE TABLE message_deletions (
    id SERIAL PRIMARY KEY,
    message_id INTEGER REFERENCES messages(id),
    user_id INTEGER REFERENCES users(id),
    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id)
);

CREATE INDEX idx_message_deletions_message_id ON message_deletions(message_id);
CREATE INDEX idx_message_deletions_user_id ON message_deletions(user_id);