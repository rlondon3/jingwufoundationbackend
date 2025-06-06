-- Course Database Schema for JingWu Foundation
-- Creates tables for courses, modules, lessons, and course features

-- Course Features table (reusable across courses)
CREATE TABLE course_features (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Main Courses table
CREATE TABLE courses (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    thumbnail_url VARCHAR(500),
    instructor_name VARCHAR(255) NOT NULL,
    skill_level VARCHAR(50) NOT NULL CHECK (skill_level IN ('Beginner', 'Intermediate', 'Advanced')),
    language VARCHAR(50) DEFAULT 'English',
    estimated_hours DECIMAL(5,2) NOT NULL,
    regular_price DECIMAL(10,2) NOT NULL,
    prerequisites TEXT,
    learning_objectives TEXT,
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Junction table for course features (many-to-many)
CREATE TABLE course_course_features (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    feature_id INTEGER NOT NULL REFERENCES course_features(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, feature_id)
);

-- Course Modules table
CREATE TABLE modules (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    order_sequence INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, order_sequence)
);

-- Course Lessons table
CREATE TABLE lessons (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    lesson_type VARCHAR(20) NOT NULL CHECK (lesson_type IN ('video', 'article', 'quiz')),
    content_url VARCHAR(500), -- Video URL or article content URL
    content_text TEXT, -- For article content or quiz questions
    duration_minutes INTEGER DEFAULT 0, -- For videos
    order_sequence INTEGER NOT NULL,
    is_required BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(module_id, order_sequence)
);

-- User lesson progress tracking (detailed progress)
CREATE TABLE user_lesson_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    time_spent_minutes INTEGER DEFAULT 0,
    quiz_score INTEGER, -- For quiz lessons (0-100)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, lesson_id)
);

-- Indexes for performance
CREATE INDEX idx_courses_category ON courses(category);
CREATE INDEX idx_courses_skill_level ON courses(skill_level);
CREATE INDEX idx_courses_is_published ON courses(is_published);
CREATE INDEX idx_courses_instructor ON courses(instructor_name);
CREATE INDEX idx_modules_course_id ON modules(course_id);
CREATE INDEX idx_modules_order ON modules(course_id, order_sequence);
CREATE INDEX idx_lessons_module_id ON lessons(module_id);
CREATE INDEX idx_lessons_order ON lessons(module_id, order_sequence);
CREATE INDEX idx_lessons_type ON lessons(lesson_type);
CREATE INDEX idx_user_lesson_progress_user_id ON user_lesson_progress(user_id);
CREATE INDEX idx_user_lesson_progress_lesson_id ON user_lesson_progress(lesson_id);
CREATE INDEX idx_user_lesson_progress_completed ON user_lesson_progress(completed);

-- Triggers for updated_at timestamps
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_modules_updated_at BEFORE UPDATE ON modules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lessons_updated_at BEFORE UPDATE ON lessons 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_lesson_progress_updated_at BEFORE UPDATE ON user_lesson_progress 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample course features
INSERT INTO course_features (name, description) VALUES
('Video Content', 'High-quality video lessons'),
('Downloadable Resources', 'PDF guides and practice sheets'),
('Community Access', 'Access to student community forums'),
('Certificate of Completion', 'Official certificate upon course completion'),
('Lifetime Access', 'Unlimited access to course materials'),
('Mobile Compatible', 'Access course on mobile devices'),
('Subtitles Available', 'Video subtitles in multiple languages'),
('Interactive Quizzes', 'Test your knowledge with quizzes');

-- Sample course data
INSERT INTO courses (title, category, description, thumbnail_url, instructor_name, skill_level, language, estimated_hours, regular_price, prerequisites, learning_objectives, is_published) VALUES
('Wing Chun Fundamentals', 'Martial Arts', 'Learn the foundational techniques of Wing Chun Kung Fu', 'https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=300&h=200', 'Sifu Wong', 'Beginner', 'English', 12.5, 199.99, 'No prior martial arts experience required', 'Master basic Wing Chun stances, hand techniques, and footwork', true),
('Tai Chi for Wellness', 'Health & Wellness', 'Gentle Tai Chi movements for health and relaxation', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=300&h=200', 'Master Chen', 'Beginner', 'English', 8.0, 149.99, 'Suitable for all fitness levels', 'Learn 24-form Tai Chi sequence and breathing techniques', true),
('Advanced Wing Chun Applications', 'Martial Arts', 'Advanced techniques and practical applications', 'https://images.unsplash.com/photo-1555597673-b21d5c935865?auto=format&fit=crop&w=300&h=200', 'Sifu Wong', 'Advanced', 'English', 20.0, 299.99, 'Completion of Wing Chun Fundamentals or equivalent experience', 'Master advanced forms, sparring techniques, and self-defense applications', true);

-- Sample course-feature associations
INSERT INTO course_course_features (course_id, feature_id) VALUES
(1, 1), (1, 2), (1, 4), (1, 5), (1, 8),
(2, 1), (2, 4), (2, 5), (2, 6),
(3, 1), (3, 2), (3, 3), (3, 4), (3, 5), (3, 8);

-- Sample modules
INSERT INTO modules (course_id, title, description, order_sequence) VALUES
(1, 'Introduction to Wing Chun', 'History and basic principles', 1),
(1, 'Basic Stances and Footwork', 'Fundamental positioning', 2),
(1, 'Hand Techniques', 'Basic punches and blocks', 3),
(2, 'Tai Chi Principles', 'Understanding the philosophy', 1),
(2, 'Basic Forms', 'Learning the 24-form sequence', 2),
(3, 'Advanced Forms', 'Complex movement patterns', 1),
(3, 'Sparring Applications', 'Practical fighting techniques', 2);

-- Sample lessons
INSERT INTO lessons (module_id, title, lesson_type, content_url, duration_minutes, order_sequence) VALUES
-- Wing Chun Module 1
(1, 'History of Wing Chun', 'video', 'https://example.com/videos/wingchun-history', 15, 1),
(1, 'Core Principles', 'article', 'https://example.com/articles/wingchun-principles', 0, 2),
(1, 'Knowledge Check', 'quiz', null, 0, 3),
-- Wing Chun Module 2
(2, 'Basic Stance Demonstration', 'video', 'https://example.com/videos/basic-stance', 20, 1),
(2, 'Footwork Patterns', 'video', 'https://example.com/videos/footwork', 25, 2),
(2, 'Practice Guide', 'article', 'https://example.com/articles/stance-practice', 0, 3),
-- Tai Chi Module 1
(4, 'Philosophy of Tai Chi', 'video', 'https://example.com/videos/taichi-philosophy', 18, 1),
(4, 'Breathing Techniques', 'video', 'https://example.com/videos/breathing', 12, 2);