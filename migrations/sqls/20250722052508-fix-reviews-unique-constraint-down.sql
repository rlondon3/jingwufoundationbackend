-- Rollback: remove the new partial index
DROP INDEX IF EXISTS reviews_user_course_regular_unique;

-- Restore the original unique constraint (this might fail if guided feedback data exists)
CREATE UNIQUE INDEX reviews_user_id_course_id_key 
ON reviews (user_id, course_id);