/* Replace with your SQL commands */
-- Drop views first
DROP VIEW IF EXISTS successful_orders;

-- Drop triggers
DROP TRIGGER IF EXISTS trigger_order_completion ON orders;
DROP TRIGGER IF EXISTS trigger_set_order_number ON orders;
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;

-- Drop functions
DROP FUNCTION IF EXISTS handle_order_completion() CASCADE;
DROP FUNCTION IF EXISTS set_order_number() CASCADE;
DROP FUNCTION IF EXISTS generate_order_number() CASCADE;

-- Drop table
DROP TABLE IF EXISTS orders CASCADE;