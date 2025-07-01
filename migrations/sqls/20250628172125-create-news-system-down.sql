DROP INDEX IF EXISTS idx_news_images_order;
DROP INDEX IF EXISTS idx_news_images_news_id;
DROP INDEX IF EXISTS idx_news_tags_unique;
DROP INDEX IF EXISTS idx_news_tags_tag_name;
DROP INDEX IF EXISTS idx_news_tags_news_id;
DROP INDEX IF EXISTS idx_news_view_count;
DROP INDEX IF EXISTS idx_news_created_at;
DROP INDEX IF EXISTS idx_news_publish_at;
DROP INDEX IF EXISTS idx_news_important;
DROP INDEX IF EXISTS idx_news_status;

-- Drop trigger
DROP TRIGGER IF EXISTS update_news_updated_at ON news;

-- Drop tables (child tables first due to foreign keys)
DROP TABLE IF EXISTS news_images;
DROP TABLE IF EXISTS news_tags;
DROP TABLE IF EXISTS news;