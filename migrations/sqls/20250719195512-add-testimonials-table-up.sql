CREATE TABLE testimonials (
  id SERIAL PRIMARY KEY,
  student_name VARCHAR(100) NOT NULL,
  student_email VARCHAR(255),
  student_location VARCHAR(100),
  instructor_context VARCHAR(200) NOT NULL,
  testimonial_text TEXT NOT NULL,
  photo_url VARCHAR(255),
  video_url VARCHAR(255),
  is_featured BOOLEAN DEFAULT false,
  is_approved BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT true,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX idx_testimonials_approved_public ON testimonials(is_approved, is_public);
CREATE INDEX idx_testimonials_featured ON testimonials(is_featured);
CREATE INDEX idx_testimonials_submitted_at ON testimonials(submitted_at);

-- Add constraint for email validation
ALTER TABLE testimonials
ADD CONSTRAINT check_email_format
CHECK (student_email IS NULL OR student_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Add constraint for URL validation
ALTER TABLE testimonials
ADD CONSTRAINT check_photo_url
CHECK (photo_url IS NULL OR photo_url ~* '^https?://');

ALTER TABLE testimonials
ADD CONSTRAINT check_video_url
CHECK (video_url IS NULL OR video_url ~* '^https?://');