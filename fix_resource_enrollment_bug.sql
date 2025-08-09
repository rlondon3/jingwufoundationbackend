-- Fix Resource Purchase Enrollment Bug
-- This script will clean up incorrect enrollments and ensure proper logic

BEGIN;

-- 1. REMOVE INCORRECT COURSE ENROLLMENTS FROM RESOURCE PURCHASES
-- Remove from current_courses array for users who were incorrectly enrolled via resource purchases
UPDATE users 
SET current_courses = array_remove(current_courses, subq.course_id),
    updated_at = CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT o.user_id, o.course_id
    FROM orders o
    WHERE o.is_add_on = TRUE 
      AND o.resource_id IS NOT NULL
      AND o.order_status = 'completed'
      AND o.course_id = ANY(
          SELECT unnest(current_courses) 
          FROM users 
          WHERE id = o.user_id
      )
) subq
WHERE users.id = subq.user_id;

-- 2. REMOVE INCORRECT USER_COURSES ENTRIES FROM RESOURCE PURCHASES  
-- Remove user_courses entries that were created by resource purchases
DELETE FROM user_courses 
WHERE id IN (
    SELECT uc.id
    FROM user_courses uc
    JOIN orders o ON uc.user_id = o.user_id AND uc.course_id = o.course_id
    WHERE o.is_add_on = TRUE 
      AND o.resource_id IS NOT NULL
      AND o.order_status = 'completed'
      AND uc.start_date >= o.completed_at::date - INTERVAL '1 day'
      -- Only remove if there's no legitimate course purchase for this user/course
      AND NOT EXISTS (
          SELECT 1 FROM orders o2 
          WHERE o2.user_id = uc.user_id 
            AND o2.course_id = uc.course_id
            AND o2.is_add_on = FALSE 
            AND o2.resource_id IS NULL
            AND o2.order_status = 'completed'
      )
);

-- 3. VERIFY TRIGGER IS CORRECT (Re-apply the fix just to be sure)
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $func$
BEGIN
    -- Only process when status changes to 'completed'
    IF OLD.order_status != 'completed' AND NEW.order_status = 'completed' THEN
        -- Set completion timestamp
        NEW.completed_at := CURRENT_TIMESTAMP;
        
        -- CRITICAL FIX: Only enroll for DIRECT course purchases, not resource purchases
        -- Only process if this is NOT an add-on (is_add_on = false) AND no resource_id
        IF NEW.is_add_on = false AND NEW.resource_id IS NULL THEN
            -- Add course to user's current_courses array (if not already there)
            UPDATE users 
            SET current_courses = array_append(current_courses, NEW.course_id),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = NEW.user_id 
            AND NOT (NEW.course_id = ANY(current_courses));
            
            -- Create user_courses entry for progress tracking
            INSERT INTO user_courses (user_id, course_id, start_date, progress)
            VALUES (NEW.user_id, NEW.course_id, CURRENT_DATE, 0)
            ON CONFLICT (user_id, course_id) DO NOTHING;
        END IF;
        
    END IF;
    
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- 4. ADD LOGGING TO TRACK FUTURE ISSUES
CREATE OR REPLACE FUNCTION log_enrollment_attempts()
RETURNS TRIGGER AS $func$
BEGIN
    -- Log all enrollment attempts for debugging
    IF OLD.order_status != 'completed' AND NEW.order_status = 'completed' THEN
        INSERT INTO public.logs (log_level, message, created_at) VALUES (
            'INFO',
            format('Order %s completed: is_add_on=%s, resource_id=%s, course_id=%s, should_enroll=%s',
                NEW.id, NEW.is_add_on, NEW.resource_id, NEW.course_id, 
                (NEW.is_add_on = false AND NEW.resource_id IS NULL)::text
            ),
            CURRENT_TIMESTAMP
        );
    END IF;
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- Create logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    log_level VARCHAR(10),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add logging trigger
DROP TRIGGER IF EXISTS log_order_enrollments ON orders;
CREATE TRIGGER log_order_enrollments
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION log_enrollment_attempts();

-- 5. SHOW SUMMARY OF CHANGES
SELECT 'Cleanup Summary' as action;

COMMIT;

-- 6. VERIFY THE FIX
SELECT 
    'Verification - Should be 0' as check_type,
    COUNT(*) as incorrect_enrollments
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.is_add_on = TRUE 
  AND o.resource_id IS NOT NULL
  AND o.order_status = 'completed'
  AND o.course_id = ANY(u.current_courses);