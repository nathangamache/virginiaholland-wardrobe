-- Wardrobe single-closet schema (idempotent version).
--
-- Safe to run against:
--   (a) an empty database — creates everything fresh
--   (b) a database already at this schema — no-ops
--   (c) a database from an older schema — the migration runner's
--       schema_migrations table prevents re-runs, so we don't need
--       defensive drops here
--
-- This migration relies on the runner (scripts/migrate.js) to only
-- apply it once per database. For databases that already have this
-- schema from a different source (e.g. pg_restore), run:
--     npm run migrate:baseline
-- FIRST to mark migrations as applied without running them.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- Auth codes (login gate only, no user record)
-- =============================================================
CREATE TABLE IF NOT EXISTS auth_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  email         TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  attempts      INT NOT NULL DEFAULT 1,
  PRIMARY KEY (email, window_start)
);

-- =============================================================
-- Wardrobe items
-- =============================================================
CREATE TABLE IF NOT EXISTS items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  category          TEXT NOT NULL CHECK (category IN (
                      'shirt', 'pants', 'shoes', 'purse',
                      'dress', 'outerwear', 'accessory'
                    )),
  sub_category      TEXT,
  occupies_slots    TEXT[] NOT NULL DEFAULT '{}',

  image_path        TEXT NOT NULL,
  image_nobg_path   TEXT,
  thumb_path        TEXT,

  name              TEXT,
  brand             TEXT,
  colors            TEXT[] NOT NULL DEFAULT '{}',
  material          TEXT,
  pattern           TEXT,

  style_tags        TEXT[] NOT NULL DEFAULT '{}',
  season_tags       TEXT[] NOT NULL DEFAULT '{}',

  warmth_score      INT CHECK (warmth_score BETWEEN 1 AND 5),
  formality_score   INT CHECK (formality_score BETWEEN 1 AND 5),

  favorite          BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,

  last_worn_at      TIMESTAMPTZ,
  times_worn        INT NOT NULL DEFAULT 0,

  acquired_from     TEXT,
  purchase_price    NUMERIC(10,2),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(favorite) WHERE favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_items_last_worn ON items(last_worn_at);

-- =============================================================
-- Outfits
-- =============================================================
CREATE TABLE IF NOT EXISTS outfits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT,
  occasion      TEXT,
  item_ids      UUID[] NOT NULL DEFAULT '{}',
  ai_reasoning  TEXT,
  source        TEXT NOT NULL DEFAULT 'manual',
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- Outfit wears (history)
-- =============================================================
CREATE TABLE IF NOT EXISTS outfit_wears (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id         UUID REFERENCES outfits(id) ON DELETE SET NULL,
  item_ids          UUID[] NOT NULL DEFAULT '{}',
  worn_on           DATE NOT NULL,
  weather_snapshot  JSONB,
  photo_path        TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wears_worn_on ON outfit_wears(worn_on DESC);

-- =============================================================
-- Wishlist
-- =============================================================
CREATE TABLE IF NOT EXISTS wishlist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description       TEXT NOT NULL,
  category          TEXT,
  reason            TEXT,
  suggested_by_ai   BOOLEAN NOT NULL DEFAULT FALSE,
  link              TEXT,
  brand_suggestions TEXT[] NOT NULL DEFAULT '{}',
  price_range       TEXT,
  priority          INT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  acquired_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- Trips (packing mode)
-- =============================================================
CREATE TABLE IF NOT EXISTS trips (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  destination           TEXT,
  destination_lat       NUMERIC,
  destination_lon       NUMERIC,
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  occasions             TEXT[] NOT NULL DEFAULT '{}',
  selected_item_ids     UUID[] NOT NULL DEFAULT '{}',
  generated_outfits     JSONB,
  weather_forecast      JSONB,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- Weather cache
-- =============================================================
CREATE TABLE IF NOT EXISTS weather_cache (
  cache_key     TEXT PRIMARY KEY,
  data          JSONB NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- updated_at triggers
-- =============================================================
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_touch ON items;
CREATE TRIGGER items_touch BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trips_touch ON trips;
CREATE TRIGGER trips_touch BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
