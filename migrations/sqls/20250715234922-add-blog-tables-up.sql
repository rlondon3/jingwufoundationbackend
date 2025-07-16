-- Blog Posts table
CREATE TABLE blog_posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    excerpt VARCHAR(500) NOT NULL,
    author VARCHAR(100) NOT NULL DEFAULT 'Jing Wu Foundation',
    banner_image TEXT,
    slug VARCHAR(250) UNIQUE NOT NULL,
    meta_description VARCHAR(160),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Blog Tags table (many-to-many relationship)
CREATE TABLE blog_tags (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    tag_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Blog Media table (for featured images and videos)
CREATE TABLE blog_media (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    media_type VARCHAR(20) NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
    caption VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_blog_posts_status ON blog_posts(status);
CREATE INDEX idx_blog_posts_published_at ON blog_posts(published_at);
CREATE INDEX idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX idx_blog_posts_status_published ON blog_posts(status, published_at) WHERE status = 'published';

CREATE INDEX idx_blog_tags_post_id ON blog_tags(post_id);
CREATE INDEX idx_blog_tags_tag_name ON blog_tags(tag_name);
CREATE INDEX idx_blog_tags_post_tag ON blog_tags(post_id, tag_name);

CREATE INDEX idx_blog_media_post_id ON blog_media(post_id);
CREATE INDEX idx_blog_media_type ON blog_media(media_type);

-- Full text search index for content
CREATE INDEX idx_blog_posts_search ON blog_posts USING gin(to_tsvector('english', title || ' ' || excerpt || ' ' || content));

-- Trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_blog_posts_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
CREATE TRIGGER update_blog_posts_updated_at 
    BEFORE UPDATE ON blog_posts 
    FOR EACH ROW 
    EXECUTE FUNCTION update_blog_posts_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE blog_posts IS 'Main blog posts table for Jing Wu Foundation website';
COMMENT ON COLUMN blog_posts.slug IS 'URL-friendly version of the title for SEO';
COMMENT ON COLUMN blog_posts.status IS 'Post status: draft or published';
COMMENT ON COLUMN blog_posts.meta_description IS 'SEO meta description for search engines';

COMMENT ON TABLE blog_tags IS 'Tags associated with blog posts for categorization';
COMMENT ON TABLE blog_media IS 'Media files (images/videos) associated with blog posts';