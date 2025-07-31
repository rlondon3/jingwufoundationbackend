-- Drop user preferences table
  DROP TABLE IF EXISTS user_preferences;

  -- Drop system settings table
  DROP TABLE IF EXISTS system_settings;

  -- Remove global free questions column from ai_usage_tracking
  ALTER TABLE ai_usage_tracking
  DROP COLUMN IF EXISTS global_free_usage;
