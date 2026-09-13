-- Migration 004: Add multi-image support to reports and polls
ALTER TABLE reports ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}';
ALTER TABLE polls   ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}';

-- Backfill existing single images into the array
UPDATE reports
SET image_urls = ARRAY[image_url]
WHERE image_url IS NOT NULL
  AND image_url <> ''
  AND (image_urls IS NULL OR cardinality(image_urls) = 0);
