  -- Remove index first
  DROP INDEX IF EXISTS idx_users_last_login;

  -- Remove last_login column from users table  
  ALTER TABLE users
  DROP COLUMN IF EXISTS last_login;
