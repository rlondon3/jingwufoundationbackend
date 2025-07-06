-- ============================================
-- IN-PERSON CLASSES MIGRATION - UP
-- Creates tables for recurring classes, enrollments, and waitlist
-- ============================================

-- Create classes table
CREATE TABLE classes (
    id SERIAL PRIMARY KEY,
    class_name VARCHAR(200) NOT NULL,
    description TEXT,
    instructor_name VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL,
    class_type VARCHAR(20) NOT NULL CHECK (class_type IN ('beginner', 'intermediate', 'advanced', 'open_level')),
    skill_focus VARCHAR(100) NOT NULL,
    day_of_week VARCHAR(10) CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
    start_time TIME,
    end_time TIME,
    class_duration INTEGER NOT NULL CHECK (class_duration >= 15 AND class_duration <= 300),
    max_capacity INTEGER NOT NULL CHECK (max_capacity >= 1 AND max_capacity <= 100),
    price DECIMAL(8,2) NOT NULL CHECK (price >= 0),
    age_restrictions VARCHAR(100) DEFAULT 'All ages',
    requires_membership BOOLEAN DEFAULT FALSE,
    waitlist_enabled BOOLEAN DEFAULT TRUE,
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_class_time CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

-- Create class enrollments table
CREATE TABLE class_enrollments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'transferred')),
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, class_id)
);

-- Create class waitlist table
CREATE TABLE class_waitlist (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'expired')),
    joined_waitlist_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, class_id)
);

-- Create class sessions table for multiple schedules per class
CREATE TABLE class_sessions (
    id SERIAL PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_session_time CHECK (end_time > start_time)
);

-- Create manual enrollments table for students without user accounts
CREATE TABLE class_manual_enrollments (
    id SERIAL PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    student_name VARCHAR(200) NOT NULL,
    student_email VARCHAR(255) NOT NULL,
    student_phone VARCHAR(20),
    notes TEXT,
    status VARCHAR(20) DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'transferred')),
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_classes_day_of_week ON classes(day_of_week);
CREATE INDEX idx_classes_start_time ON classes(start_time);
CREATE INDEX idx_classes_class_type ON classes(class_type);
CREATE INDEX idx_classes_instructor_name ON classes(instructor_name);
CREATE INDEX idx_classes_location ON classes(location);
CREATE INDEX idx_classes_is_published ON classes(is_published);
CREATE INDEX idx_classes_skill_focus ON classes(skill_focus);

CREATE INDEX idx_class_enrollments_user_id ON class_enrollments(user_id);
CREATE INDEX idx_class_enrollments_class_id ON class_enrollments(class_id);
CREATE INDEX idx_class_enrollments_status ON class_enrollments(status);

CREATE INDEX idx_class_waitlist_user_id ON class_waitlist(user_id);
CREATE INDEX idx_class_waitlist_class_id ON class_waitlist(class_id);
CREATE INDEX idx_class_waitlist_status ON class_waitlist(status);
CREATE INDEX idx_class_waitlist_created_at ON class_waitlist(created_at);

CREATE INDEX idx_class_sessions_class_id ON class_sessions(class_id);
CREATE INDEX idx_class_sessions_day_of_week ON class_sessions(day_of_week);
CREATE INDEX idx_class_sessions_start_time ON class_sessions(start_time);

CREATE INDEX idx_class_manual_enrollments_class_id ON class_manual_enrollments(class_id);
CREATE INDEX idx_class_manual_enrollments_status ON class_manual_enrollments(status);
CREATE INDEX idx_class_manual_enrollments_email ON class_manual_enrollments(student_email);

-- Composite indexes for common queries
CREATE INDEX idx_classes_published_day_time ON classes(is_published, day_of_week, start_time);
CREATE INDEX idx_class_enrollments_class_status ON class_enrollments(class_id, status);
CREATE INDEX idx_class_manual_enrollments_class_status ON class_manual_enrollments(class_id, status);

-- Add triggers to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_classes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_class_enrollments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_class_waitlist_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_class_sessions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_classes_timestamp
    BEFORE UPDATE ON classes
    FOR EACH ROW
    EXECUTE FUNCTION update_classes_timestamp();

CREATE TRIGGER trigger_update_class_enrollments_timestamp
    BEFORE UPDATE ON class_enrollments
    FOR EACH ROW
    EXECUTE FUNCTION update_class_enrollments_timestamp();

CREATE TRIGGER trigger_update_class_waitlist_timestamp
    BEFORE UPDATE ON class_waitlist
    FOR EACH ROW
    EXECUTE FUNCTION update_class_waitlist_timestamp();

CREATE TRIGGER trigger_update_class_sessions_timestamp
    BEFORE UPDATE ON class_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_class_sessions_timestamp();