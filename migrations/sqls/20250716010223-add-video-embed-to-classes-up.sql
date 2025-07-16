-- Add video_embed_url column to classes table
ALTER TABLE classes 
ADD COLUMN video_embed_url TEXT;

-- Add index for video embed queries
CREATE INDEX idx_classes_video_embed ON classes(video_embed_url) WHERE video_embed_url IS NOT NULL;

-- Add comment to document the column purpose
COMMENT ON COLUMN classes.video_embed_url IS 'YouTube or other video platform embed URL for class preview/demo';