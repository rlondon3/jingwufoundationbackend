-- AI usage tracking table (monthly limits per user)
CREATE TABLE ai_usage_tracking (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  course_purchases_usage JSONB DEFAULT '{}' NOT NULL, -- {"course_1": 5, "course_2": 3}
  subscription_usage INTEGER DEFAULT 0 NOT NULL,
  total_cost_cents INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, period_start)
);

-- AI response cache table (1 week TTL)
CREATE TABLE ai_response_cache (
  id SERIAL PRIMARY KEY,
  question_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 of normalized question
  question_text TEXT NOT NULL,
  response_data JSONB NOT NULL, -- Full AI response with terms, excerpts, etc.
  usage_count INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

-- AI question analytics table (for improvement and insights)
CREATE TABLE ai_question_analytics (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  response_cached BOOLEAN DEFAULT FALSE NOT NULL,
  cost_cents INTEGER DEFAULT 0 NOT NULL,
  response_time_ms INTEGER,
  course_context INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_ai_usage_user_period ON ai_usage_tracking(user_id, period_start);
CREATE INDEX idx_ai_usage_period ON ai_usage_tracking(period_start);

CREATE INDEX idx_ai_cache_hash ON ai_response_cache(question_hash);
CREATE INDEX idx_ai_cache_expires ON ai_response_cache(expires_at);
CREATE INDEX idx_ai_cache_usage_count ON ai_response_cache(usage_count DESC);

CREATE INDEX idx_ai_analytics_user ON ai_question_analytics(user_id);
CREATE INDEX idx_ai_analytics_created_at ON ai_question_analytics(created_at DESC);
CREATE INDEX idx_ai_analytics_course ON ai_question_analytics(course_context);
CREATE INDEX idx_ai_analytics_cached ON ai_question_analytics(response_cached);
CREATE INDEX idx_ai_analytics_cost ON ai_question_analytics(cost_cents);

-- Trigger for updated_at timestamp on usage tracking
CREATE TRIGGER update_ai_usage_tracking_updated_at 
    BEFORE UPDATE ON ai_usage_tracking 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();