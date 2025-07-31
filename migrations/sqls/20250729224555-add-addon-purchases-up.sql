ALTER TABLE resources 
ADD COLUMN is_add_on BOOLEAN DEFAULT FALSE,
ADD COLUMN price DECIMAL(10,2) DEFAULT NULL,
ADD COLUMN stripe_price_id VARCHAR(255) DEFAULT NULL;

-- Add add-on fields to orders table  
ALTER TABLE orders
ADD COLUMN is_add_on BOOLEAN DEFAULT FALSE,
ADD COLUMN resource_id INTEGER REFERENCES resources(id),
ADD COLUMN item_name VARCHAR(255),
ADD COLUMN add_on_price DECIMAL(10,2);

-- Update existing orders to set is_add_on = FALSE and populate item_name from course titles
UPDATE orders SET 
  is_add_on = FALSE,
  item_name = (SELECT title FROM courses WHERE courses.id = orders.course_id)
WHERE course_id IS NOT NULL;

-- Create index for faster add-on queries
CREATE INDEX idx_resources_is_add_on ON resources(is_add_on) WHERE is_add_on = TRUE;
CREATE INDEX idx_orders_resource_id ON orders(resource_id);
CREATE INDEX idx_orders_is_add_on ON orders(is_add_on);
CREATE INDEX idx_orders_item_name ON orders(item_name);