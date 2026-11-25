import { useState, useEffect } from 'react';

/**
 * Which tab and sub-tab the user is on, kept across a reload (Phase 0B-1).
 *
 * Stored in sessionStorage, so a refresh (or the phone reloading a tab it put
 * to sleep) comes back to the same place, while a new tab or a fresh login
 * starts on Workouts. Only small JSON values belong here: view names, ids.
 */
const PREFIX = 'ripfit_view:';

function read(key, fallback) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function usePersistentState(key, initial, isValid = () => true) {
  const [value, setValue] = useState(() => {
    const fallback = typeof initial === 'function' ? initial() : initial;
    const stored = read(key, fallback);
    return isValid(stored) ? stored : fallback;
  });
  useEffect(() => {
    try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* not persisted */ }
  }, [key, value]);
  return [value, setValue];
}

/** Forget every stored view (login and logout start on Workouts). */
export function clearViewState() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}
