-- Drop indexes first
DROP INDEX IF EXISTS idx_quiz_responses_attempt;
DROP INDEX IF EXISTS idx_quiz_responses_correct;
DROP INDEX IF EXISTS idx_quiz_responses_lesson;
DROP INDEX IF EXISTS idx_quiz_responses_user_lesson;

-- Drop table
DROP TABLE IF EXISTS user_quiz_responses CASCADE;