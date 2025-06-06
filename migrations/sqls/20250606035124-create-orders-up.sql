-- Order Database Schema for JingWu Foundation
-- Handles course purchases with unique order numbers and status tracking

-- Orders table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL, -- Format: JW-YYYYMMDD-HHMMSS-####
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    course_price DECIMAL(10,2) NOT NULL, -- Price at time of purchase
    order_status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (order_status IN ('pending', 'completed', 'failed', 'cancelled', 'refunded')),
    stripe_payment_intent_id VARCHAR(255), -- For Stripe integration later
    payment_method VARCHAR(50), -- 'stripe', 'paypal', etc.
    notes TEXT, -- Admin notes or failure reasons
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP -- When order was successfully completed
);

-- Indexes for performance
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_course_id ON orders(course_id);
CREATE INDEX idx_orders_status ON orders(order_status);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_completed_at ON orders(completed_at);

-- Function to generate unique order numbers
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $func$
DECLARE
    date_part TEXT;
    time_part TEXT;
    counter_part TEXT;
    new_order_number TEXT;
    max_counter INTEGER;
BEGIN
    -- Get current date and time parts
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');
    time_part := TO_CHAR(NOW(), 'HH24MISS');
    
    -- Get the highest counter for today
    SELECT COALESCE(
        MAX(
            CAST(
                SUBSTRING(o.order_number FROM '[0-9]+$') AS INTEGER
            )
        ), 0
    ) INTO max_counter
    FROM orders o 
    WHERE o.order_number LIKE 'JW-' || date_part || '%';
    
    -- Increment counter and format with leading zeros
    counter_part := LPAD((max_counter + 1)::TEXT, 4, '0');
    
    -- Combine parts
    new_order_number := 'JW-' || date_part || '-' || time_part || '-' || counter_part;
    
    RETURN new_order_number;
END;
$func$ LANGUAGE plpgsql;

-- Trigger to auto-generate order numbers
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS TRIGGER AS $func$
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        NEW.order_number := generate_order_number();
    END IF;
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_order_number
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION set_order_number();

-- Trigger for updated_at timestamp
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to handle successful order completion
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $func$
BEGIN
    -- Only process when status changes to 'completed'
    IF OLD.order_status != 'completed' AND NEW.order_status = 'completed' THEN
        -- Set completion timestamp
        NEW.completed_at := CURRENT_TIMESTAMP;
        
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
    
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_order_completion
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION handle_order_completion();

-- View for order analytics (successful purchases only)
CREATE VIEW successful_orders AS
SELECT 
    o.*,
    u.name as user_name,
    u.email as user_email,
    c.title as course_title,
    c.category as course_category,
    c.instructor_name
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN courses c ON o.course_id = c.id
WHERE o.order_status = 'completed';

-- Sample orders data
INSERT INTO orders (user_id, course_id, course_price, order_status, payment_method, completed_at) VALUES
(2, 1, 199.99, 'completed', 'stripe', '2024-01-15 10:30:00'),
(3, 2, 149.99, 'completed', 'stripe', '2024-02-01 14:15:00'),
(4, 3, 299.99, 'completed', 'stripe', '2024-02-15 09:45:00'),
(5, 1, 199.99, 'completed', 'stripe', '2024-03-01 16:20:00'),
(6, 2, 149.99, 'completed', 'stripe', '2024-02-10 11:30:00'),
-- Some pending/failed orders
(2, 3, 299.99, 'pending', 'stripe', NULL),
(4, 2, 149.99, 'failed', 'stripe', NULL);