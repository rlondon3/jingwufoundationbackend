 -- Add global free questions tracking to existing ai_usage_tracking table
  ALTER TABLE ai_usage_tracking
  ADD COLUMN global_free_usage INTEGER DEFAULT 0 NOT NULL;

  -- Create system settings table for configurable limits and admin toggles
  CREATE TABLE system_settings (
      id SERIAL PRIMARY KEY,
      setting_key VARCHAR(100) UNIQUE NOT NULL,
      setting_value TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Create index for fast setting lookups
  CREATE INDEX idx_system_settings_key ON system_settings(setting_key);

  -- Insert default AI Sifu settings
  INSERT INTO system_settings (setting_key, setting_value, description) VALUES
  ('ai_sifu_enabled', 'true', 'Global toggle for AI Sifu availability'),
  ('global_free_questions_limit', '3', 'Free AI Sifu questions per month for all users'),
  ('course_questions_limit', '10', 'AI Sifu questions per purchased/enrolled course per month'),
  ('subscriber_questions_limit', '12', 'AI Sifu questions per month for subscribers'),
  ('ai_sifu_price_cents', '1000', 'AI Sifu subscription price in cents ($10.00)');

  -- Create user preferences table for individual user settings
  CREATE TABLE user_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      ai_sifu_enabled BOOLEAN DEFAULT TRUE,
      email_notifications BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
  );

  -- Create index for fast user preference lookups
  CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);

  -- Update existing ai_usage_tracking records to have global_free_usage = 0
  UPDATE ai_usage_tracking SET global_free_usage = 0 WHERE global_free_usage IS NULL;