-- Remove AI-specific fields from resources table
  DROP INDEX IF EXISTS idx_resources_ai_category;
  DROP INDEX IF EXISTS idx_resources_difficulty_level;
  DROP INDEX IF EXISTS idx_resources_content_tags;

  ALTER TABLE resources
  DROP COLUMN IF EXISTS ai_category,
  DROP COLUMN IF EXISTS term_normalizers,
  DROP COLUMN IF EXISTS content_tags,
  DROP COLUMN IF EXISTS ai_summary,
  DROP COLUMN IF EXISTS difficulty_level;