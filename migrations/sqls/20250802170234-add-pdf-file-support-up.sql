-- Add PDF file support to resources table
  ALTER TABLE resources
  ADD COLUMN file_path TEXT,
  ADD COLUMN file_size INTEGER,
  ADD COLUMN mime_type VARCHAR(100);

  -- Update the CHECK constraint to include 'pdf' type
  ALTER TABLE resources
  DROP CONSTRAINT resources_type_check;

  ALTER TABLE resources
  ADD CONSTRAINT resources_type_check
  CHECK (type IN ('blog', 'video', 'audio', 'manual', 'pdf'));

  -- Create index for file path queries
  CREATE INDEX idx_resources_file_path ON resources(file_path);
  CREATE INDEX idx_resources_type_pdf ON resources(type) WHERE type = 'pdf';

  -- Add comment for documentation
  COMMENT ON COLUMN resources.file_path IS 'File path for PDF and other file resources';
  COMMENT ON COLUMN resources.type IS 'Resource type: blog, video, audio, manual, or pdf';