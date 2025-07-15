-- Add is_active column to users table
ALTER TABLE users 
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Add index for better performance on is_active queries
CREATE INDEX idx_users_is_active ON users(is_active);

-- Add comment to document the column purpose
COMMENT ON COLUMN users.is_active IS 'Indicates if the user account is active and can access the platform';