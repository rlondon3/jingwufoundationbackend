-- Drop index first
DROP INDEX IF EXISTS idx_users_is_active;

-- Remove is_active column from users table
ALTER TABLE users 
DROP COLUMN IF EXISTS is_active;