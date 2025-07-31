-- Remove the constraint with 'manual'
ALTER TABLE resources
DROP CONSTRAINT resources_type_check;

-- Add back the original constraint without 'manual'
ALTER TABLE resources
ADD CONSTRAINT resources_type_check
CHECK (type IN ('blog', 'video', 'audio'));