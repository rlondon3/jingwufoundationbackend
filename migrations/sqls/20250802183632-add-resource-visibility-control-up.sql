-- Add visibility control to resources table
  ALTER TABLE resources
  ADD COLUMN is_public BOOLEAN DEFAULT true;

  -- Mark all existing PDF resources as AI-only (not public)
  UPDATE resources
  SET is_public = false
  WHERE type = 'pdf';

  -- Create index for fast public resource queries
  CREATE INDEX idx_resources_is_public ON resources(is_public);

  -- Add comment for documentation
  COMMENT ON COLUMN resources.is_public IS 'Whether resource is visible to public users (false = AI-only)';