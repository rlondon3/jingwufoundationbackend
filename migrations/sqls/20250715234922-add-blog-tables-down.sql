-- Drop trigger first
DROP TRIGGER IF EXISTS update_blog_posts_updated_at ON blog_posts;

-- Drop trigger function
DROP FUNCTION IF EXISTS update_blog_posts_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS idx_blog_posts_search;
DROP INDEX IF EXISTS idx_blog_media_type;
DROP INDEX IF EXISTS idx_blog_media_post_id;
DROP INDEX IF EXISTS idx_blog_tags_post_tag;
DROP INDEX IF EXISTS idx_blog_tags_tag_name;
DROP INDEX IF EXISTS idx_blog_tags_post_id;
DROP INDEX IF EXISTS idx_blog_posts_status_published;
DROP INDEX IF EXISTS idx_blog_posts_slug;
DROP INDEX IF EXISTS idx_blog_posts_published_at;
DROP INDEX IF EXISTS idx_blog_posts_status;

-- Drop tables (in reverse order due to foreign keys)
DROP TABLE IF EXISTS blog_media CASCADE;
DROP TABLE IF EXISTS blog_tags CASCADE;
DROP TABLE IF EXISTS blog_posts CASCADE;