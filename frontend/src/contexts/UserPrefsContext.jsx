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
  log_set_button_position: 'inline', // 'inline' | 'pinned' (bar above Previous / Next on phones)
  tempo_countdown_beeps: 3,        // tempo lead-in beeps before the first rep; 0 = off (max 5)
  tempo_click_track_enabled: true, // Tempo track button on exercises with a tempo (migration 034)
  tempo_track_with_timers: false,  // start the tempo track with the Timers panel's Start (migration 034)
};

/** Allowed values; the server rejects anything else (migration 033). */
export const TEMPO_COUNTDOWN_BEEPS_OPTIONS = [0, 1, 2, 3, 4, 5];

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
