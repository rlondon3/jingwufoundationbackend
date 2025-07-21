-- Add is_active column to user_courses table
ALTER TABLE user_courses 
ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Add index for performance on queries filtering by active status
CREATE INDEX idx_user_courses_active ON user_courses(is_active);

-- Add index for combined user_id and is_active queries
CREATE INDEX idx_user_courses_user_active ON user_courses(user_id, is_active);