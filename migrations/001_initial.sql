-- Wardrobe initial schema
-- Run: psql $DATABASE_URL -f migrations/001_initial.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- Users
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- =============================================================
-- Auth codes (2FA)
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

-- Rate limiting table for code requests
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  email       TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempts    INT NOT NULL DEFAULT 1,
  PRIMARY KEY (email, window_start)
);

-- =============================================================
-- Wardrobe items
-- =============================================================
CREATE TABLE IF NOT EXISTS items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Classification
  category          TEXT NOT NULL CHECK (category IN (
                      'shirt', 'pants', 'shoes', 'purse',
                      'dress', 'outerwear', 'accessory'
                    )),
  sub_category      TEXT,                          -- e.g. 'blouse', 'jeans', 'heels', 'tote'
  occupies_slots    TEXT[] NOT NULL DEFAULT '{}',  -- dresses = ['shirt','pants']

  -- Images
  image_path        TEXT NOT NULL,                 -- original
  image_nobg_path   TEXT,                          -- background removed
  thumb_path        TEXT,                          -- small preview

  -- Descriptive metadata
  name              TEXT,                          -- free-form, optional
  brand             TEXT,
  colors            TEXT[] NOT NULL DEFAULT '{}',  -- hex codes, primary first
  material          TEXT,
  pattern           TEXT,                          -- 'solid', 'striped', etc.

  -- Tags (arrays for flexibility)
  style_tags        TEXT[] NOT NULL DEFAULT '{}',  -- 'casual', 'formal', 'preppy', etc.
  season_tags       TEXT[] NOT NULL DEFAULT '{}',  -- 'spring', 'summer', 'fall', 'winter'

  -- Scores (1-5)
  warmth_score      INT CHECK (warmth_score BETWEEN 1 AND 5),
  formality_score   INT CHECK (formality_score BETWEEN 1 AND 5),

  -- Status
  favorite          BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT,

  -- Wear tracking
  last_worn_at      TIMESTAMPTZ,
  times_worn        INT NOT NULL DEFAULT 0,

  -- Provenance
  acquired_from     TEXT,   -- 'thrifted', 'retail', 'gift', 'vintage', etc.
  purchase_price    NUMERIC(10,2),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_user_category ON items(user_id, category);
CREATE INDEX IF NOT EXISTS idx_items_user_favorite ON items(user_id) WHERE favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_items_last_worn ON items(user_id, last_worn_at);

-- =============================================================
-- Outfits (named / saved combinations)
-- =============================================================
CREATE TABLE IF NOT EXISTS outfits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT,
  occasion      TEXT,                           -- free-form user label
  item_ids      UUID[] NOT NULL DEFAULT '{}',
  ai_reasoning  TEXT,                           -- reason given by AI if AI-suggested
  source        TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'ai' | 'packing'
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outfits_user ON outfits(user_id);

-- =============================================================
-- Outfit wears (history of actually wearing an outfit)
-- =============================================================
CREATE TABLE IF NOT EXISTS outfit_wears (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outfit_id         UUID REFERENCES outfits(id) ON DELETE SET NULL,
  item_ids          UUID[] NOT NULL DEFAULT '{}', -- snapshot, survives outfit deletion
  worn_on           DATE NOT NULL,
  weather_snapshot  JSONB,
  photo_path        TEXT,                         -- mirror selfie / wear photo
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wears_user_date ON outfit_wears(user_id, worn_on DESC);

-- =============================================================
-- Wishlist
-- =============================================================
CREATE TABLE IF NOT EXISTS wishlist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description       TEXT NOT NULL,
  category          TEXT,
  reason            TEXT,                          -- AI reasoning or user note
  suggested_by_ai   BOOLEAN NOT NULL DEFAULT FALSE,
  image_path        TEXT,
  link              TEXT,
  brand_suggestions TEXT[] NOT NULL DEFAULT '{}',
  price_range       TEXT,                          -- free-form, e.g. '$100-$200'
  priority          INT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  acquired_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);

-- =============================================================
-- Trips (packing mode)
-- =============================================================
CREATE TABLE IF NOT EXISTS trips (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  destination           TEXT,
  destination_lat       NUMERIC,
  destination_lon       NUMERIC,
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  occasions             TEXT[] NOT NULL DEFAULT '{}', -- 'dinner', 'hiking', etc.
  selected_item_ids     UUID[] NOT NULL DEFAULT '{}',
  generated_outfits     JSONB,                        -- day-by-day plan
  weather_forecast      JSONB,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);

-- =============================================================
-- Weather cache (avoids hammering Open-Meteo)
-- =============================================================
CREATE TABLE IF NOT EXISTS weather_cache (
  cache_key     TEXT PRIMARY KEY,     -- e.g. 'lat,lon,YYYY-MM-DD'
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
