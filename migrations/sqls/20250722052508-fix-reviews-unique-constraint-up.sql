-- Remove any existing indexes that could conflict
DROP INDEX IF EXISTS reviews_user_id_course_id_key;
DROP INDEX IF EXISTS reviews_user_course_regular_unique;

-- Create the correct partial unique index
CREATE UNIQUE INDEX reviews_user_course_regular_unique 
ON reviews (user_id, course_id) 
WHERE is_guided_feedback = false;