-- Diagnostic query to find incorrect enrollments from resource purchases
-- This will help us identify the scope of the problem

-- 1. Check for users enrolled in courses via resource purchases
SELECT 
    'Incorrect Enrollments' as issue_type,
    o.id as order_id,
    o.user_id,
    o.course_id,
    o.resource_id,
    o.is_add_on,
    o.order_status,
    o.completed_at,
    u.email as user_email,
    c.title as course_title,
    r.title as resource_title
FROM orders o
JOIN users u ON o.user_id = u.id  
JOIN courses c ON o.course_id = c.id
LEFT JOIN resources r ON o.resource_id = r.id
WHERE o.is_add_on = TRUE 
  AND o.resource_id IS NOT NULL
  AND o.order_status = 'completed'
  AND o.course_id = ANY(
      SELECT unnest(current_courses) 
      FROM users 
      WHERE id = o.user_id
  );

-- 2. Check for user_courses entries created by resource purchases
SELECT 
    'User Courses Issue' as issue_type,
    uc.id as user_course_id,
    uc.user_id,
    uc.course_id,
    uc.start_date,
    o.id as order_id,
    o.resource_id,
    o.is_add_on,
    u.email as user_email,
    c.title as course_title,
    r.title as resource_title
FROM user_courses uc
JOIN orders o ON uc.user_id = o.user_id AND uc.course_id = o.course_id
JOIN users u ON uc.user_id = u.id
JOIN courses c ON uc.course_id = c.id
LEFT JOIN resources r ON o.resource_id = r.id
WHERE o.is_add_on = TRUE 
  AND o.resource_id IS NOT NULL
  AND o.order_status = 'completed'
  AND uc.start_date >= o.completed_at::date - INTERVAL '1 day'
ORDER BY uc.start_date DESC;

-- 3. Recent resource purchases for testing
SELECT 
    'Recent Resource Orders' as info_type,
    o.id,
    o.user_id, 
    o.course_id,
    o.resource_id,
    o.is_add_on,
    o.order_status,
    o.completed_at,
    r.title as resource_title,
    c.title as course_title
FROM orders o
LEFT JOIN resources r ON o.resource_id = r.id  
LEFT JOIN courses c ON o.course_id = c.id
WHERE o.is_add_on = TRUE 
  AND o.resource_id IS NOT NULL
ORDER BY o.created_at DESC 
LIMIT 10;