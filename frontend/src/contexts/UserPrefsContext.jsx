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
};

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
