-- Migration 011: Add initials field to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS initials TEXT;

