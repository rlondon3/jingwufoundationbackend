-- Remove indexes
DROP INDEX IF EXISTS idx_resources_is_add_on;
DROP INDEX IF EXISTS idx_orders_resource_id; 
DROP INDEX IF EXISTS idx_orders_is_add_on;
DROP INDEX IF EXISTS idx_orders_item_name;

-- Remove add-on columns from orders table
ALTER TABLE orders 
DROP COLUMN IF EXISTS is_add_on,
DROP COLUMN IF EXISTS resource_id,
DROP COLUMN IF EXISTS item_name,
DROP COLUMN IF EXISTS add_on_price;

-- Remove add-on columns from resources table
ALTER TABLE resources
DROP COLUMN IF EXISTS is_add_on,
DROP COLUMN IF EXISTS price,
DROP COLUMN IF EXISTS stripe_price_id;