-- ============================================
-- ADD MANUAL RESOURCE TYPE - UP
-- Adds 'manual' type support to resources table
-- ============================================

-- Update the CHECK constraint to include 'manual' type
ALTER TABLE resources 
DROP CONSTRAINT resources_type_check;

ALTER TABLE resources 
ADD CONSTRAINT resources_type_check 
CHECK (type IN ('blog', 'video', 'audio', 'manual'));

-- Add comment for documentation
COMMENT ON COLUMN resources.type IS 'Resource type: blog (article), video, audio, or manual (ebook)';