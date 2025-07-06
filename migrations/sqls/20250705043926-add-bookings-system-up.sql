-- ============================================
-- BOOKINGS MIGRATION - UP
-- Creates bookings table for appointment scheduling
-- ============================================

-- Create bookings table
CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    booking_guid VARCHAR(6) NOT NULL UNIQUE,
    appointment_type VARCHAR(100) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    notes TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Create indexes for performance
CREATE INDEX idx_bookings_booking_guid ON bookings(booking_guid);
CREATE INDEX idx_bookings_email ON bookings(email);
CREATE INDEX idx_bookings_user_id ON bookings(user_id);
CREATE INDEX idx_bookings_start_time ON bookings(start_time);
CREATE INDEX idx_bookings_end_time ON bookings(end_time);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_appointment_type ON bookings(appointment_type);
CREATE INDEX idx_bookings_created_at ON bookings(created_at);

-- Composite indexes for common queries
CREATE INDEX idx_bookings_status_start_time ON bookings(status, start_time);
CREATE INDEX idx_bookings_email_start_time ON bookings(email, start_time);
CREATE INDEX idx_bookings_date_range ON bookings(start_time, end_time);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_bookings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_bookings_timestamp
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_bookings_timestamp();

-- Function to generate booking GUID
CREATE OR REPLACE FUNCTION generate_booking_guid()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate booking GUID if not provided
CREATE OR REPLACE FUNCTION set_booking_guid()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.booking_guid IS NULL OR NEW.booking_guid = '' THEN
        LOOP
            NEW.booking_guid := generate_booking_guid();
            -- Check if GUID is unique
            PERFORM 1 FROM bookings WHERE booking_guid = NEW.booking_guid;
            IF NOT FOUND THEN
                EXIT;
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_booking_guid
    BEFORE INSERT ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION set_booking_guid();