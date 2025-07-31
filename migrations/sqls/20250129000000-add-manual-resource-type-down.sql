-- ============================================
-- ADD MANUAL RESOURCE TYPE - DOWN
-- Removes 'manual' type support from resources table
-- ============================================

-- First, update any existing 'manual' resources to 'blog'
UPDATE resources SET type = 'blog' WHERE type = 'manual';

-- Revert the CHECK constraint to original state
ALTER TABLE resources 
DROP CONSTRAINT resources_type_check;

ALTER TABLE resources 
ADD CONSTRAINT resources_type_check 
CHECK (type IN ('blog', 'video', 'audio'));

-- Remove comment
COMMENT ON COLUMN resources.type IS NULL;