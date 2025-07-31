  ALTER TABLE resources
  DROP CONSTRAINT resources_type_check;

  -- Add the new constraint with 'manual' type
  ALTER TABLE resources
  ADD CONSTRAINT resources_type_check
  CHECK (type IN ('blog', 'video', 'audio', 'manual'));
