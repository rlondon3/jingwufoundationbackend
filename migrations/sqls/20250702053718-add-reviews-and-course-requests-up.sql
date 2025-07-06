-- ============================================
-- REVIEWS MIGRATION - UP
-- Creates reviews and course_requests tables
-- ============================================

-- Create reviews table
CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    is_published BOOLEAN DEFAULT TRUE,
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, course_id)
);

-- Create course_requests table
CREATE TABLE course_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    requested_course_title VARCHAR(200) NOT NULL,
    request_description TEXT,
    request_priority INTEGER DEFAULT 3 CHECK (request_priority >= 1 AND request_priority <= 5),
    request_status VARCHAR(20) DEFAULT 'pending' CHECK (request_status IN ('pending', 'approved', 'rejected', 'completed')),
    admin_notes TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_reviews_course_id ON reviews(course_id);
CREATE INDEX idx_reviews_user_id ON reviews(user_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);
CREATE INDEX idx_reviews_is_published ON reviews(is_published);
CREATE INDEX idx_reviews_created_at ON reviews(created_at);

CREATE INDEX idx_course_requests_user_id ON course_requests(user_id);
CREATE INDEX idx_course_requests_status ON course_requests(request_status);
CREATE INDEX idx_course_requests_priority ON course_requests(request_priority);
CREATE INDEX idx_course_requests_title ON course_requests(requested_course_title);
CREATE INDEX idx_course_requests_created_at ON course_requests(created_at);

-- Add triggers to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_reviews_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_course_requests_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_reviews_timestamp
    BEFORE UPDATE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_reviews_timestamp();

CREATE TRIGGER trigger_update_course_requests_timestamp
    BEFORE UPDATE ON course_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_course_requests_timestamp();

-- Tables created successfully
-- Sample data can be added later when users and courses exist