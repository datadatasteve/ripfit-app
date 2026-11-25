import { createContext, useContext } from 'react';

/**
 * Lets pages deep in the tree (the workout detail page, wherever it is
 * rendered) hand App an active-workout payload to open, e.g. after resuming a
 * cancelled workout. Provided by App.
 */
export const ActiveWorkoutContext = createContext({
  activeWorkoutId: null,
  openWorkout: () => {},
});

export function useActiveWorkoutControls() {
  return useContext(ActiveWorkoutContext);
}

/**
 * Server copy of the active workout (GET /workouts/active) folded into the
 * local one when the page becomes visible again. The server wins for logged
 * sets, cardio segments and pause state (another device may have logged or
 * paused); local exercise order, notes and timers are kept. Exercises added
 * on another device are appended.
 */
export function mergeServerWorkout(local, server) {
  const byId = new Map((server.exercises || []).map(e => [e.id, e]));
  const exercises = local.exercises.map(ex => {
    const s = byId.get(ex.id);
    return s ? { ...ex, logged_sets: s.logged_sets, cardio_segments: s.cardio_segments } : ex;
  });
  const known = new Set(local.exercises.map(e => e.id));
  for (const s of server.exercises || []) {
    if (!known.has(s.id)) exercises.push(s);
  }
  return {
    ...local,
    exercises,
    workout: {
      ...local.workout,
      status: server.workout.status,
      paused_at: server.workout.paused_at,
      total_paused_seconds: server.workout.total_paused_seconds,
    },
    synced_at: Date.now(),
  };
}
