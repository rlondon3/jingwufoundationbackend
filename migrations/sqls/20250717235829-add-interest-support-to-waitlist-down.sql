-- Remove constraints
ALTER TABLE class_waitlist
DROP CONSTRAINT IF EXISTS check_user_or_contact;

DROP INDEX IF EXISTS idx_class_waitlist_contact_email;

-- Restore user_id NOT NULL (this will fail if there are null values)
DELETE FROM class_waitlist WHERE user_id IS NULL;
ALTER TABLE class_waitlist 
ALTER COLUMN user_id SET NOT NULL;

-- Restore original status constraint
ALTER TABLE class_waitlist 
DROP CONSTRAINT IF EXISTS class_waitlist_status_check;

ALTER TABLE class_waitlist
ADD CONSTRAINT class_waitlist_status_check 
CHECK (status IN ('waiting', 'enrolled'));

-- Remove new columns
ALTER TABLE class_waitlist 
DROP COLUMN contact_phone,
DROP COLUMN contact_email,
DROP COLUMN contact_name;