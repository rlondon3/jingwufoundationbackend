 CREATE TABLE course_previews (
      id SERIAL PRIMARY KEY,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      cta VARCHAR(255) NOT NULL,
      coupon VARCHAR(100),
      url VARCHAR(500) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX idx_course_previews_course_id ON course_previews(course_id);
  CREATE INDEX idx_course_previews_active ON course_previews(is_active);