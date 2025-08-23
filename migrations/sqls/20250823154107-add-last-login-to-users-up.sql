 -- Add last_login timestamp to users table
  ALTER TABLE users
  ADD COLUMN last_login TIMESTAMP DEFAULT NULL;

  -- Add index for performance when querying by last_login
  CREATE INDEX idx_users_last_login ON users(last_login);

  -- Update existing users to have a reasonable default (their created_at date)
  -- This prevents showing "Never" for existing users
  UPDATE users
  SET last_login = created_at
  WHERE last_login IS NULL;