-- Members can opt out of news emails; NULL means subscribed
ALTER TABLE users
  ADD COLUMN newsletter_unsubscribed_at TIMESTAMP DEFAULT NULL;

-- Record when an article went out as a newsletter, so it is never sent twice
ALTER TABLE news
  ADD COLUMN newsletter_sent_at TIMESTAMP DEFAULT NULL,
  ADD COLUMN newsletter_recipient_count INTEGER DEFAULT NULL;
