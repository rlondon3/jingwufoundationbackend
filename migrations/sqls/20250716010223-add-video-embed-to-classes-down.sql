-- Drop index first
DROP INDEX IF EXISTS idx_classes_video_embed;

-- Remove video_embed_url column from classes table
ALTER TABLE classes 
DROP COLUMN IF EXISTS video_embed_url;