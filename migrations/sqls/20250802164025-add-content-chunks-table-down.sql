-- Drop content chunks table and indexes
  DROP INDEX IF EXISTS idx_content_chunks_unique;
  DROP INDEX IF EXISTS idx_content_chunks_text_search;
  DROP INDEX IF EXISTS idx_content_chunks_topic;
  DROP INDEX IF EXISTS idx_content_chunks_keywords;
  DROP INDEX IF EXISTS idx_content_chunks_resource_id;
  DROP TABLE IF EXISTS content_chunks;