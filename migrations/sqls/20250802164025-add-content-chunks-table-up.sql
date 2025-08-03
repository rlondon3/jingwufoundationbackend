-- Create content chunks table for pre-processed AI content
  CREATE TABLE content_chunks (
      id SERIAL PRIMARY KEY,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      chunk_text TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      keywords TEXT[] DEFAULT '{}',
      topic_category VARCHAR(100),
      word_count INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Create indexes for fast AI queries
  CREATE INDEX idx_content_chunks_resource_id ON content_chunks(resource_id);
  CREATE INDEX idx_content_chunks_keywords ON content_chunks USING GIN(keywords);
  CREATE INDEX idx_content_chunks_topic ON content_chunks(topic_category);
  CREATE INDEX idx_content_chunks_text_search ON content_chunks USING GIN(to_tsvector('english', chunk_text));

  -- Add unique constraint to prevent duplicate chunks
  CREATE UNIQUE INDEX idx_content_chunks_unique ON content_chunks(resource_id, chunk_index);