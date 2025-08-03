  -- Remove visibility control from resources table
  DROP INDEX IF EXISTS idx_resources_is_public;

  -- Remove the is_public column
  ALTER TABLE resources
  DROP COLUMN IF EXISTS is_public;