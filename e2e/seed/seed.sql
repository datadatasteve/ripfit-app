-- RipFit e2e seed (Phase 0B-2). Run against the LOCAL throwaway database only.
-- Idempotent: safe to run before every suite run.
--
-- Test user for the suite (local test values, not a real account):
--   email    e2e@ripfit.test
--   password E2e-Local-Pass1!
-- The password_hash below is bcrypt (cost 12) of that password. The user is
-- marked verified so no verification email is needed (registering through the
-- API would try to send a real email, so the suite never registers).

INSERT INTO users (username, email, password_hash, email_verified)
VALUES ('e2e_tester', 'e2e@ripfit.test',
        '$2b$12$I3no74pVwSEjvNFY4qydQuG4VnlAVzDbi6ktMTWBmULb6gyWQb3eG', TRUE)
ON CONFLICT DO NOTHING;

-- Tempo settings the Start Set test expects (3 lead-in beeps, clicks on).
UPDATE users SET tempo_countdown_beeps = 3, tempo_click_track_enabled = TRUE,
                 tempo_track_with_timers = FALSE
 WHERE email = 'e2e@ripfit.test';

-- One food in the local foods table for the nutrition smoke test.
INSERT INTO foods (name, brand, serving_size, serving_unit, calories_per_100g,
                   protein_per_100g, carbs_per_100g, fat_per_100g, source, is_verified)
SELECT 'E2E Rolled Oats', 'RipFit Test', 40, 'g', 375, 13, 67, 7, 'custom', FALSE
WHERE NOT EXISTS (SELECT 1 FROM foods WHERE name = 'E2E Rolled Oats');
