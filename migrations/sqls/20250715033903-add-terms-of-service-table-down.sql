-- Drop trigger first
DROP TRIGGER IF EXISTS update_terms_updated_at ON terms_of_service;

-- Drop trigger function
DROP FUNCTION IF EXISTS update_terms_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS idx_terms_user_accepted_version;
DROP INDEX IF EXISTS idx_terms_accepted_version;
DROP INDEX IF EXISTS idx_terms_user_version;
DROP INDEX IF EXISTS idx_terms_accepted;
DROP INDEX IF EXISTS idx_terms_version;
DROP INDEX IF EXISTS idx_terms_user_id;

-- Drop table (CASCADE will handle foreign key constraints)
DROP TABLE IF EXISTS terms_of_service CASCADE;