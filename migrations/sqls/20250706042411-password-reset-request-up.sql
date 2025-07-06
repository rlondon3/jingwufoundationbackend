CREATE TABLE password_reset_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    temp_password_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure only one active reset per user
    CONSTRAINT unique_active_reset UNIQUE(user_id)
);

-- Create indexes for performance
CREATE INDEX idx_password_reset_user_id ON password_reset_requests(user_id);
CREATE INDEX idx_password_reset_expires ON password_reset_requests(expires_at);
CREATE INDEX idx_password_reset_active ON password_reset_requests(user_id, is_used, expires_at);

-- Add comments for documentation
COMMENT ON TABLE password_reset_requests IS 'Stores temporary password reset requests with expiration';
COMMENT ON COLUMN password_reset_requests.temp_password_hash IS 'Bcrypt hash of temporary password';
COMMENT ON COLUMN password_reset_requests.expires_at IS 'When the temporary password expires (typically 30 minutes)';
COMMENT ON COLUMN password_reset_requests.is_used IS 'Whether the temporary password has been used for login';
