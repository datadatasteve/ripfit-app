import { createContext, useContext } from 'react';

/**
 * Workout UI preferences from the users table, loaded once by App from the
 * existing /users/me fetch and shared here so each consumer (RoutineBuilder,
 * ProgramBuilder, MeditationTimer, ActiveWorkout, UserPreferencesPage) doesn't
 * fetch its own copy.
 */
export const DEFAULT_USER_PREFS = {
  reorder_mode: 'drag',            // 'drag' | 'arrows'
  previous_notes_scope: 'all',     // 'all' | 'program' | 'non_program'
  tempo_visual_enabled: false,
  tempo_audio_enabled: false,
  timezone: null,                  // IANA zone; null = not set yet (browser zone is used)
  workout_age_limit_hours: 24,     // auto-cancel and resume window (Phase 0A-2)
  pause_note_minutes: 15,          // shortest pause noted on the workout detail page
};

/** Allowed values; the server rejects anything else (migration 032). */
export const AGE_LIMIT_HOURS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 36, 48];
export const PAUSE_NOTE_MINUTES_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

export const UserPrefsContext = createContext({
  prefs: DEFAULT_USER_PREFS,
  prefsLoaded: false,
  updatePrefs: async () => {},
});

export function useUserPrefs() {
  return useContext(UserPrefsContext);
}

/** Picks just the preference fields out of a /users/me response. */
export function prefsFromProfile(profile) {
  const out = { ...DEFAULT_USER_PREFS };
  for (const key of Object.keys(DEFAULT_USER_PREFS)) {
    if (profile && profile[key] !== undefined && profile[key] !== null) out[key] = profile[key];
  }
  return out;
}
