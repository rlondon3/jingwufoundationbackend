-- User Database Schema for JingWu Foundation
-- Creates tables for users, privacy settings, and user course progress

-- Users table with auto-incrementing IDs but keeping frontend field names
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    avatar VARCHAR(500),
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    city VARCHAR(100),
    country VARCHAR(100),
    martial_art VARCHAR(100),
    experience INTEGER DEFAULT 0,
    current_courses INTEGER[] DEFAULT '{}', -- Array of course IDs (will reference courses table later)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Privacy settings table (separate from users)
CREATE TABLE privacy_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile VARCHAR(20) DEFAULT 'public' CHECK (profile IN ('public', 'private')),
    progress VARCHAR(20) DEFAULT 'public' CHECK (progress IN ('public', 'private')),
    courses VARCHAR(20) DEFAULT 'public' CHECK (courses IN ('public', 'private')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-Course enrollment junction table (tracks progress and enrollment)
CREATE TABLE user_courses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL, -- Will reference courses table when created
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    start_date DATE NOT NULL,
    completed_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, course_id) -- Prevent duplicate enrollments
);

-- Indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_is_admin ON users(is_admin);
CREATE INDEX idx_privacy_user_id ON privacy_settings(user_id);
CREATE INDEX idx_user_courses_user_id ON user_courses(user_id);
CREATE INDEX idx_user_courses_course_id ON user_courses(course_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $func$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$func$ language 'plpgsql';

-- Triggers for updated_at timestamps
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_privacy_updated_at BEFORE UPDATE ON privacy_settings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_courses_updated_at BEFORE UPDATE ON user_courses 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample data insertion (based on your JSON)
INSERT INTO users (name, email, avatar, username, password, is_admin, city, country, martial_art, experience, current_courses) VALUES
('Sifu Wong', 'sifuwong@kungfu.academy', 'https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=100&h=100', 'sifuwong', '$2b$10$placeholder_hash_for_password', TRUE, 'Beijing', 'China', 'Wing Chun', 30, '{}'),
('John Doe', 'student@kungfu.academy', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&h=100', 'johndoe', '$2b$10$placeholder_hash_for_password', FALSE, 'San Francisco', 'United States', 'Wing Chun', 2, '{1}'),
('Sarah Chen', 'sarah@example.com', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&h=100', 'sarahchen', '$2b$10$placeholder_hash_for_password', FALSE, 'Shanghai', 'China', 'Tai Chi', 5, '{2}'),
('Mike Johnson', 'mike@example.com', 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=100&h=100', 'mikejohnson', '$2b$10$placeholder_hash_for_password', FALSE, 'London', 'United Kingdom', 'Wing Chun', 1, '{3}'),
('Emily Rodriguez', 'emily@example.com', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=100&h=100', 'emilyrodriguez', '$2b$10$placeholder_hash_for_password', FALSE, 'Madrid', 'Spain', 'Xing Yi Quan', 3, '{1}'),
('David Kim', 'david@example.com', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&h=100', 'davidkim', '$2b$10$placeholder_hash_for_password', FALSE, 'Seoul', 'South Korea', 'Bagua Zhang', 4, '{2}');

-- Insert privacy settings for each user
INSERT INTO privacy_settings (user_id, profile, progress, courses) VALUES
(1, 'public', 'public', 'public'),
(2, 'public', 'public', 'public'),
(3, 'private', 'private', 'private'),
(4, 'public', 'public', 'public'),
(5, 'private', 'private', 'private'),
(6, 'public', 'public', 'public');

-- Insert course enrollments (using placeholder course IDs)
INSERT INTO user_courses (user_id, course_id, progress, start_date) VALUES
(2, 1, 78, '2024-01-15'),
(3, 2, 92, '2024-02-01'),
(4, 3, 65, '2024-02-15'),
(5, 1, 45, '2024-03-01'),
(6, 2, 88, '2024-02-10');