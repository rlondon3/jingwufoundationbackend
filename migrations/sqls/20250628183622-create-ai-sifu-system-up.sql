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

-- Sample data for testing
INSERT INTO ai_usage_tracking (user_id, period_start, course_purchases_usage, subscription_usage, total_cost_cents) VALUES
(10, '2025-06-01', '{"2": 3, "3": 1}', 15, 47), -- Admin user with some test usage
(2, '2025-06-01', '{"1": 8}', 0, 24); -- Regular user near course limit

-- Sample cached responses
INSERT INTO ai_response_cache (question_hash, question_text, response_data, usage_count, expires_at) VALUES
(
  'a1b2c3d4e5f6',
  'what is neigong',
  '{"response": "Neigong refers to internal skill acquired through systematic practice of principles...", "terms_used": [{"term": "neigong", "definition": "Internal skill acquired through systematic practice"}], "manual_sections": ["Introduction: Understanding Neigong and Poles"]}',
  5,
  CURRENT_TIMESTAMP + INTERVAL '7 days'
),
(
  'f6e5d4c3b2a1',
  'how to separate empty and full',
  '{"response": "Separating partiality or separating empty and full is a fundamental requirement...", "terms_used": [{"term": "separating partiality", "definition": "Fundamental requirement of separating empty from full states"}], "manual_sections": ["Internal Body: Shape Requirements"]}',
  3,
  CURRENT_TIMESTAMP + INTERVAL '7 days'
);

-- Sample analytics data
INSERT INTO ai_question_analytics (user_id, question_text, response_cached, cost_cents, response_time_ms, course_context) VALUES
(10, 'what is neigong', true, 0, 150, 2),
(10, 'how to practice seated meditation', false, 2, 1200, 2),
(2, 'what is jin force', false, 2, 980, 1),
(10, 'how to separate empty and full', true, 0, 100, 2),
(2, 'explain heavy shoulders', false, 3, 1450, 1);
