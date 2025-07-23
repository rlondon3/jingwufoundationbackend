-- Remove the unique constraint (not index) that prevents multiple reviews per user/course
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_user_id_course_id_key;

-- Also drop any existing partial index from previous attempts
DROP INDEX IF EXISTS reviews_user_course_regular_unique;

-- Create the correct partial unique index
CREATE UNIQUE INDEX reviews_user_course_regular_unique 
ON reviews (user_id, course_id) 
WHERE is_guided_feedback = false;