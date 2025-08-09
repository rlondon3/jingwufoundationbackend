-- Fix Re-enrollment Bug - Prevent existing students from being re-enrolled
-- This addresses the issue where users purchasing resources get re-enrolled in courses they're already taking

BEGIN;

-- 1. IMPROVED TRIGGER - Prevent re-enrollment of existing students
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $func$
BEGIN
    -- Only process when status changes to 'completed'
    IF OLD.order_status != 'completed' AND NEW.order_status = 'completed' THEN
        -- Set completion timestamp
        NEW.completed_at := CURRENT_TIMESTAMP;
        
        -- CRITICAL FIX: Only enroll for DIRECT course purchases, not resource purchases
        -- AND only if user is not already enrolled
        IF NEW.is_add_on = false AND NEW.resource_id IS NULL THEN
            
            -- Check if user is already enrolled in this course
            IF NOT EXISTS (
                SELECT 1 FROM user_courses 
                WHERE user_id = NEW.user_id AND course_id = NEW.course_id
            ) THEN
                -- Add course to user's current_courses array (if not already there)
                UPDATE users 
                SET current_courses = array_append(current_courses, NEW.course_id),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = NEW.user_id 
                AND NOT (NEW.course_id = ANY(current_courses));
                
                -- Create user_courses entry for progress tracking
                INSERT INTO user_courses (user_id, course_id, start_date, progress)
                VALUES (NEW.user_id, NEW.course_id, CURRENT_DATE, 0);
                
                -- Log the enrollment
                INSERT INTO logs (log_level, message, created_at) VALUES (
                    'INFO',
                    format('NEW ENROLLMENT: User %s enrolled in course %s via order %s', 
                        NEW.user_id, NEW.course_id, NEW.id),
                    CURRENT_TIMESTAMP
                );
            ELSE
                -- Log that we prevented re-enrollment
                INSERT INTO logs (log_level, message, created_at) VALUES (
                    'INFO', 
                    format('PREVENTED RE-ENROLLMENT: User %s already enrolled in course %s (order %s)', 
                        NEW.user_id, NEW.course_id, NEW.id),
                    CURRENT_TIMESTAMP
                );
            END IF;
        ELSE
            -- Log resource purchases (should not trigger enrollment)
            IF NEW.is_add_on = true AND NEW.resource_id IS NOT NULL THEN
                INSERT INTO logs (log_level, message, created_at) VALUES (
                    'INFO',
                    format('RESOURCE PURCHASE: User %s bought resource %s (no enrollment)', 
                        NEW.user_id, NEW.resource_id),
                    CURRENT_TIMESTAMP
                );
            END IF;
        END IF;
        
    END IF;
    
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

-- 2. Create logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    log_level VARCHAR(10),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Test the fix by checking recent enrollments that might be incorrect
SELECT 
    'Recent Suspicious Enrollments' as check_type,
    uc.user_id,
    uc.course_id,
    uc.start_date,
    u.email,
    c.title as course_title,
    -- Look for orders that might have caused re-enrollment
    (SELECT COUNT(*) FROM orders o 
     WHERE o.user_id = uc.user_id 
       AND o.course_id = uc.course_id 
       AND o.is_add_on = true 
       AND o.resource_id IS NOT NULL
       AND o.completed_at::date = uc.start_date
    ) as matching_resource_orders
FROM user_courses uc
JOIN users u ON uc.user_id = u.id
JOIN courses c ON uc.course_id = c.id
WHERE uc.start_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY uc.start_date DESC;

COMMIT;

-- 4. Show what the fix will prevent
SELECT 'Fix Applied - Future resource purchases will not trigger re-enrollment' as status;