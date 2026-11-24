-- Optional call-to-action button shown in the newsletter and on the article
ALTER TABLE news
  ADD COLUMN button_text VARCHAR(60) DEFAULT NULL,
  ADD COLUMN button_url VARCHAR(500) DEFAULT NULL;
