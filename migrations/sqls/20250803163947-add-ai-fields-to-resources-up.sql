-- Add AI-specific fields to resources table for AI Sifu management
  ALTER TABLE resources
  ADD COLUMN ai_category VARCHAR(50),
  ADD COLUMN term_normalizers TEXT,
  ADD COLUMN content_tags TEXT[],
  ADD COLUMN ai_summary TEXT,
  ADD COLUMN difficulty_level VARCHAR(20) CHECK (difficulty_level IN ('beginner', 'intermediate',
  'advanced'));

  -- Create indexes for AI fields
  CREATE INDEX idx_resources_ai_category ON resources(ai_category);
  CREATE INDEX idx_resources_difficulty_level ON resources(difficulty_level);
  CREATE INDEX idx_resources_content_tags ON resources USING gin(content_tags);

  -- Add comments for documentation
  COMMENT ON COLUMN resources.ai_category IS 'AI categorization: martial-arts, philosophy, meditation, etc.';
  COMMENT ON COLUMN resources.term_normalizers IS 'JSON mapping of terms for AI processing';
  COMMENT ON COLUMN resources.content_tags IS 'Array of tags for AI content categorization';
  COMMENT ON COLUMN resources.ai_summary IS 'Summary for AI context and referencing';
  COMMENT ON COLUMN resources.difficulty_level IS 'Content difficulty: beginner, intermediate, advanced';