-- Add new columns for non-registered users
ALTER TABLE class_waitlist 
ADD COLUMN contact_name VARCHAR(100),
ADD COLUMN contact_email VARCHAR(255),
ADD COLUMN contact_phone VARCHAR(20);

-- Update status enum to include 'interested'
ALTER TABLE class_waitlist 
DROP CONSTRAINT IF EXISTS class_waitlist_status_check;

ALTER TABLE class_waitlist
ADD CONSTRAINT class_waitlist_status_check 
CHECK (status IN ('interested', 'waiting', 'enrolled'));

-- Make user_id nullable for non-registered users
ALTER TABLE class_waitlist 
ALTER COLUMN user_id DROP NOT NULL;

-- Add index for better performance on email lookups
CREATE INDEX IF NOT EXISTS idx_class_waitlist_contact_email 
ON class_waitlist(contact_email);

-- Add constraint to ensure either user_id OR contact info is provided
ALTER TABLE class_waitlist
ADD CONSTRAINT check_user_or_contact
CHECK (
  (user_id IS NOT NULL) OR 
  (contact_name IS NOT NULL AND contact_email IS NOT NULL)
);