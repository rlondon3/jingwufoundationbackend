 -- Remove PDF file support from resources table
  DROP INDEX IF EXISTS idx_resources_type_pdf;
  DROP INDEX IF EXISTS idx_resources_file_path;

  -- Remove PDF file columns
  ALTER TABLE resources
  DROP COLUMN IF EXISTS mime_type,
  DROP COLUMN IF EXISTS file_size,
  DROP COLUMN IF EXISTS file_path;

  -- Restore original CHECK constraint (without pdf)
  ALTER TABLE resources
  DROP CONSTRAINT resources_type_check;

  ALTER TABLE resources
  ADD CONSTRAINT resources_type_check
  CHECK (type IN ('blog', 'video', 'audio', 'manual'));