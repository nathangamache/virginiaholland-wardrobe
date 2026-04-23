-- Wishlist no longer stores images. Drop the column and clean up any
-- existing orphan image files on disk (handled by app code; this only
-- changes the schema).
ALTER TABLE wishlist DROP COLUMN IF EXISTS image_path;
