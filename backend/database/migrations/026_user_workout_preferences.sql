-- Migration 026: Workout UI preferences on users.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reorder_mode varchar DEFAULT 'drag'
    CHECK (reorder_mode IN ('drag', 'arrows')),
  ADD COLUMN IF NOT EXISTS previous_notes_scope varchar DEFAULT 'all'
    CHECK (previous_notes_scope IN ('all', 'program', 'non_program')),
  ADD COLUMN IF NOT EXISTS tempo_visual_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tempo_audio_enabled boolean DEFAULT false;
