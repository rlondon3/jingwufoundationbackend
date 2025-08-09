 -- Add PayPal capture ID to orders table
  ALTER TABLE orders ADD COLUMN paypal_capture_id VARCHAR(255);

  -- Create index for performance
  CREATE INDEX idx_orders_paypal_capture_id ON orders(paypal_capture_id);