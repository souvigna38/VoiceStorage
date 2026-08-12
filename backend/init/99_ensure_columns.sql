-- =============================================================================
-- ENSURE ALL COLUMNS EXIST (idempotent)
-- =============================================================================
-- This script runs after all other init scripts and ensures the database
-- has all columns the current app version expects. Safe to run multiple times.
-- =============================================================================

-- Items table: Medusa integration
ALTER TABLE items ADD COLUMN IF NOT EXISTS medusa_product_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_items_medusa_product ON items(medusa_product_id) WHERE medusa_product_id IS NOT NULL;

-- Items table: pricing columns
ALTER TABLE items ADD COLUMN IF NOT EXISTS estimated_value DECIMAL(12,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS msrp_price DECIMAL(12,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS msrp_source TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS msrp_lookup_query TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS msrp_last_checked TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS list_price DECIMAL(12,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS sold_price DECIMAL(12,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS sold_date DATE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS listing_url TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS search_text TEXT;

-- Items table: hardware spec columns
ALTER TABLE items ADD COLUMN IF NOT EXISTS cpu_type VARCHAR(255);
ALTER TABLE items ADD COLUMN IF NOT EXISTS ram_amount VARCHAR(100);
ALTER TABLE items ADD COLUMN IF NOT EXISTS hard_drive_info VARCHAR(255);
ALTER TABLE items ADD COLUMN IF NOT EXISTS gpu VARCHAR(255);
ALTER TABLE items ADD COLUMN IF NOT EXISTS network_info VARCHAR(500);
ALTER TABLE items ADD COLUMN IF NOT EXISTS role VARCHAR(255);
ALTER TABLE items ADD COLUMN IF NOT EXISTS storage_detail TEXT;

-- Item images: AI columns
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE;
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_description TEXT;
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_main_color VARCHAR(100);
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_object_type VARCHAR(255);
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_detected_text TEXT;
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_tags JSONB DEFAULT '[]';
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;
ALTER TABLE item_images ADD COLUMN IF NOT EXISTS ai_corrected BOOLEAN DEFAULT FALSE;

-- Items table: AI research enrichment columns
ALTER TABLE items ADD COLUMN IF NOT EXISTS ai_research_summary TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS ai_research_price_low DECIMAL(12,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS ai_research_price_high DECIMAL(12,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS ai_research_price_currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE items ADD COLUMN IF NOT EXISTS ai_research_sources JSONB DEFAULT '[]';
ALTER TABLE items ADD COLUMN IF NOT EXISTS ai_research_key_specs JSONB DEFAULT '{}';
ALTER TABLE items ADD COLUMN IF NOT EXISTS ai_research_last_checked TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_item_images_ai_unprocessed ON item_images(ai_processed);
CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_items_research_unchecked ON items(ai_research_last_checked) WHERE deleted_at IS NULL AND ai_research_last_checked IS NULL;
