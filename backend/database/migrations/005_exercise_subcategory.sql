-- Migration 005: Add subcategory column to exercises
-- Splits "Arms" into Biceps / Triceps subcategories
-- Other categories gain subcategory support for future use (Legs, Shoulders)

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS subcategory VARCHAR(50);

-- ============================================================
-- AUTO-ASSIGN: Arms → Biceps or Triceps by name keywords
-- ============================================================

-- Biceps: curl movements
UPDATE exercises
SET subcategory = 'Biceps'
WHERE category = 'Arms'
  AND (
    LOWER(name) LIKE '%curl%'
    OR LOWER(name) LIKE '%bicep%'
    OR LOWER(name) LIKE '%hammer%'
    OR LOWER(name) LIKE '%preacher%'
    OR LOWER(name) LIKE '%concentration%'
    OR LOWER(name) LIKE '%zottman%'
    OR LOWER(name) LIKE '%spider%curl%'
  );

-- Triceps: extension / pushdown / dip / skull movements
UPDATE exercises
SET subcategory = 'Triceps'
WHERE category = 'Arms'
  AND subcategory IS NULL
  AND (
    LOWER(name) LIKE '%tricep%'
    OR LOWER(name) LIKE '%pushdown%'
    OR LOWER(name) LIKE '%push-down%'
    OR LOWER(name) LIKE '%extension%'
    OR LOWER(name) LIKE '%skull%'
    OR LOWER(name) LIKE '%overhead tricep%'
    OR LOWER(name) LIKE '%kickback%'
    OR LOWER(name) LIKE '%nose breaker%'
    OR LOWER(name) LIKE '%nosebreaker%'
    OR LOWER(name) LIKE '%lying tricep%'
    OR LOWER(name) LIKE '%close.grip%'
    OR LOWER(name) LIKE '%close grip%'
  );

-- Dips: ambiguous (could be chest or triceps), only tag if already Arms
UPDATE exercises
SET subcategory = 'Triceps'
WHERE category = 'Arms'
  AND subcategory IS NULL
  AND LOWER(name) LIKE '%dip%';

-- Anything in Arms with no subcategory match stays NULL
-- (means "Arms - general", will show under Arms filter)

-- ============================================================
-- VERIFY: Check results after migration
-- Run this to confirm counts look right:
--
-- SELECT subcategory, COUNT(*) FROM exercises WHERE category = 'Arms' GROUP BY subcategory;
-- ============================================================
