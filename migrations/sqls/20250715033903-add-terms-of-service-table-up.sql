-- Terms of Service table schema
-- This table tracks user acceptance of terms of service versions

CREATE TABLE terms_of_service (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted BOOLEAN NOT NULL DEFAULT false,
    version VARCHAR(20) NOT NULL DEFAULT '1.0',
    ip_address INET,
    user_agent TEXT,
    accepted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revocation_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_terms_user_id ON terms_of_service(user_id);
CREATE INDEX idx_terms_version ON terms_of_service(version);
CREATE INDEX idx_terms_accepted ON terms_of_service(accepted);
CREATE INDEX idx_terms_user_version ON terms_of_service(user_id, version);
CREATE INDEX idx_terms_accepted_version ON terms_of_service(accepted, version);

-- Composite index for the most common query (check if user accepted current version)
CREATE INDEX idx_terms_user_accepted_version ON terms_of_service(user_id, accepted, version);

-- Add trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_terms_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
CREATE TRIGGER update_terms_updated_at 
    BEFORE UPDATE ON terms_of_service 
    FOR EACH ROW 
    EXECUTE FUNCTION update_terms_updated_at_column();