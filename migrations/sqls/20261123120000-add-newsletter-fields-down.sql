ALTER TABLE news
  DROP COLUMN IF EXISTS newsletter_recipient_count,
  DROP COLUMN IF EXISTS newsletter_sent_at;

ALTER TABLE users
  DROP COLUMN IF EXISTS newsletter_unsubscribed_at;
