-- ============================================
-- RESOURCES MIGRATION - UP
-- Creates resources and resource_courses tables
-- ============================================

-- Create resources table
CREATE TABLE resources (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('blog', 'video', 'audio')),
    content TEXT,
    video_url TEXT,
    audio_url TEXT,
    thumbnail TEXT,
    description TEXT,
    author VARCHAR(100) NOT NULL,
    duration VARCHAR(20),
    is_published BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create resource-course relationship table
CREATE TABLE resource_courses (
    id SERIAL PRIMARY KEY,
    resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resource_id, course_id)
);

-- Create indexes for performance
CREATE INDEX idx_resources_type ON resources(type);
CREATE INDEX idx_resources_author ON resources(author);
CREATE INDEX idx_resources_is_published ON resources(is_published);
CREATE INDEX idx_resources_created_at ON resources(created_at);
CREATE INDEX idx_resources_view_count ON resources(view_count);

CREATE INDEX idx_resource_courses_resource_id ON resource_courses(resource_id);
CREATE INDEX idx_resource_courses_course_id ON resource_courses(course_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_resources_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_resources_timestamp
    BEFORE UPDATE ON resources
    FOR EACH ROW
    EXECUTE FUNCTION update_resources_timestamp();

-- Insert sample data (optional)
INSERT INTO resources (title, type, content, author, thumbnail, is_published) VALUES 
('The Art of Chi Sao', 'blog', 'Chi Sao, or sticky hands, is a fundamental practice in Wing Chun...', 'Master Wong', 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=1000&q=80', true),
('Understanding Wing Chun Principles', 'video', '', 'Sifu Chen', 'https://images.unsplash.com/photo-1517438322307-e67111335449?auto=format&fit=crop&w=1000&q=80', true),
('Meditation for Martial Artists', 'audio', '', 'Master Lee', '', true);

-- Update video and audio URLs for sample data
UPDATE resources SET video_url = 'https://example.com/wing-chun-principles.mp4', description = 'A comprehensive guide to Wing Chun core principles' WHERE title = 'Understanding Wing Chun Principles';
UPDATE resources SET audio_url = 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav', duration = '15:30' WHERE title = 'Meditation for Martial Artists';