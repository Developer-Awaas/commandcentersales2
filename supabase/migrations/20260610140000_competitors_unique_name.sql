-- Remove duplicate competitors keeping the earliest created row per (org_id, name)
DELETE FROM competitors
WHERE id NOT IN (
  SELECT DISTINCT ON (org_id, name) id
  FROM competitors
  ORDER BY org_id, name, created_at ASC
);

-- Prevent future duplicates
ALTER TABLE competitors
  ADD CONSTRAINT competitors_org_id_name_key UNIQUE (org_id, name);
