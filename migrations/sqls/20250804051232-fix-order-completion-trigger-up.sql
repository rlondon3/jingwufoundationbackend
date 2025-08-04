-- Fix the trigger to only enroll for direct course purchases, not resource purchases
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