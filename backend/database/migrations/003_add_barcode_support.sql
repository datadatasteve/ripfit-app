-- Migration: Add barcode support to foods table
-- Purpose: Enable barcode scanning and track food sources

-- Add columns to foods table
ALTER TABLE foods ADD COLUMN IF NOT EXISTS gtin_upc VARCHAR(20);
ALTER TABLE foods ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'usda';
ALTER TABLE foods ADD COLUMN IF NOT EXISTS brand_owner VARCHAR(100);
ALTER TABLE foods ADD COLUMN IF NOT EXISTS brand_name VARCHAR(100);
ALTER TABLE foods ADD COLUMN IF NOT EXISTS ingredients TEXT;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT true;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS usda_fdc_id INTEGER;

-- Create index for fast barcode lookups
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(gtin_upc);
CREATE INDEX IF NOT EXISTS idx_foods_source ON foods(source);
CREATE INDEX IF NOT EXISTS idx_foods_fdc_id ON foods(usda_fdc_id);

-- Add comments
COMMENT ON COLUMN foods.gtin_upc IS 'Barcode number (UPC/EAN/GTIN-12/GTIN-13)';
COMMENT ON COLUMN foods.source IS 'Data source: usda, user, api, manual';
COMMENT ON COLUMN foods.brand_owner IS 'Brand owner/manufacturer name';
COMMENT ON COLUMN foods.brand_name IS 'Brand name of product';
COMMENT ON COLUMN foods.ingredients IS 'Ingredient list from product label';
COMMENT ON COLUMN foods.is_verified IS 'Whether nutrition data is verified/trusted';
COMMENT ON COLUMN foods.usda_fdc_id IS 'Original USDA FoodData Central ID for reference';