CREATE TABLE news (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  thumbnail_url VARCHAR(500) NULL,
  author_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_important BOOLEAN DEFAULT FALSE,
  publish_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- News tags (many-to-many relationship)
CREATE TABLE news_tags (
  id SERIAL PRIMARY KEY,
  news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  tag_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- News body images (for multiple images in article content)
CREATE TABLE news_images (
  id SERIAL PRIMARY KEY,
  news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  image_url VARCHAR(500) NOT NULL,
  order_sequence INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_news_status ON news(status);
CREATE INDEX idx_news_important ON news(is_important);
CREATE INDEX idx_news_publish_at ON news(publish_at);
CREATE INDEX idx_news_created_at ON news(created_at DESC);
CREATE INDEX idx_news_view_count ON news(view_count DESC);

CREATE INDEX idx_news_tags_news_id ON news_tags(news_id);
CREATE INDEX idx_news_tags_tag_name ON news_tags(tag_name);
CREATE UNIQUE INDEX idx_news_tags_unique ON news_tags(news_id, tag_name);

CREATE INDEX idx_news_images_news_id ON news_images(news_id);
CREATE INDEX idx_news_images_order ON news_images(news_id, order_sequence);

-- Trigger for updated_at timestamp
CREATE TRIGGER update_news_updated_at 
    BEFORE UPDATE ON news 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Sample data
INSERT INTO news (title, description, body, thumbnail_url, author_name, status, is_important, publish_at) VALUES
(
  'New Wing Chun Course Coming Soon', 
  'Get ready for an advanced Wing Chun course launching next month!',
  'We are excited to announce that our new advanced Wing Chun course will be launching next month. This comprehensive course will cover advanced techniques, applications, and theory that builds upon our foundational Wing Chun program.

The course will include:
- Advanced sticky hands (Chi Sau) techniques
- Weapon forms including butterfly swords and long pole
- Combat applications and sparring drills
- Internal energy development
- Traditional forms and their applications

Registration will open on April 1st, 2024. Early bird pricing will be available for the first 50 students who enroll.',
  'https://res.cloudinary.com/demo/image/upload/w_300,h_200,c_fill/wing_chun_course.jpg',
  'Sifu Wong',
  'published',
  true,
  '2024-03-20 10:00:00'
),
(
  'Community Features Enhanced', 
  'We''ve added new ways to connect with fellow martial artists.',
  'Our platform now includes several new community features to help you connect with fellow martial artists and enhance your learning experience:

1. Direct Messaging: Send private messages to other students and instructors
2. Study Groups: Join or create study groups for specific techniques or forms  
3. Progress Sharing: Share your training milestones with the community
4. Discussion Forums: Participate in technique discussions and Q&A sessions
5. Event Calendar: Stay updated on workshops, seminars, and training events

These features are designed to build a stronger, more connected martial arts community. We encourage all students to explore these new tools and engage with their fellow practitioners.',
  'https://res.cloudinary.com/demo/image/upload/w_300,h_200,c_fill/community_features.jpg',
  'Admin Team',
  'published',
  false,
  '2024-03-18 09:00:00'
),
(
  'Mobile App Launch', 
  'Practice on the go with our new mobile app, available now.',
  'We''re thrilled to announce the launch of our official mobile app! Now you can access your martial arts training anywhere, anytime.

Key features of our mobile app:
- Offline video downloads for practicing without internet
- Progress tracking that syncs with your web account
- Push notifications for new course content and messages
- Practice reminders and goal setting
- Quick access to forms and technique references

Download now:
- iOS: Available on the App Store
- Android: Available on Google Play Store

The app is free for all enrolled students. Simply log in with your existing account credentials to get started.',
  'https://res.cloudinary.com/demo/image/upload/w_300,h_200,c_fill/mobile_app.jpg',
  'Admin Team',
  'published',
  true,
  '2024-03-15 08:00:00'
);

-- Add sample tags
INSERT INTO news_tags (news_id, tag_name) VALUES
(1, 'course-announcement'),
(1, 'wing-chun'),
(1, 'advanced'),
(2, 'community'),
(2, 'features'),
(2, 'messaging'),
(3, 'mobile-app'),
(3, 'announcement'),
(3, 'technology');

-- Add sample body images
INSERT INTO news_images (news_id, image_url, order_sequence) VALUES
(1, 'https://res.cloudinary.com/demo/image/upload/wing_chun_techniques.jpg', 1),
(1, 'https://res.cloudinary.com/demo/image/upload/wing_chun_weapons.jpg', 2),
(2, 'https://res.cloudinary.com/demo/image/upload/community_discussion.jpg', 1),
(3, 'https://res.cloudinary.com/demo/image/upload/app_screenshots.jpg', 1);