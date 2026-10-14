// Rep range targets (migration 029: target_reps_min / target_reps_max) and
// superset grouping helpers shared by the routine builder, routine detail,
// active workout and stats.

const toInt = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/** "10–12" (en-dash) for a range, "12" when min === max or one side is missing, '' when unset. */
export function formatRepRange(min, max) {
  const lo = toInt(min);
  const hi = toInt(max);
  if (lo === null && hi === null) return '';
  if (lo === null || hi === null || lo === hi) return String(lo ?? hi);
  return `${lo}–${hi}`;
}

/** The rep range on an object carrying target_reps_min / target_reps_max. */
export const repRangeOf = obj => formatRepRange(obj?.target_reps_min, obj?.target_reps_max);

/**
 * How a set's reps compare with a rep range: 'missed' below min, 'hit' within
 * min–max, 'exceeded' above max. null when there is no target.
 */
export function judgeReps(reps, min, max) {
  const lo = toInt(min) ?? toInt(max);
  const hi = toInt(max) ?? lo;
  if (lo === null) return null;
  const r = Number(reps);
  if (r < lo) return 'missed';
  if (r > hi) return 'exceeded';
  return 'hit';
}

/**
 * Renumbers superset groups so they run 1, 2, 3… in order of first appearance
 * (list order = order_index). A group left with a single exercise is no longer
 * a superset and is cleared.
 */
export function reindexSupersets(list) {
  const counts = new Map();
  for (const ex of list) {
    if (ex.superset_group != null) counts.set(ex.superset_group, (counts.get(ex.superset_group) || 0) + 1);
  }
  const mapping = new Map();
  let next = 1;
  return list.map(ex => {
    const g = ex.superset_group;
    if (g == null || counts.get(g) < 2) return g == null ? ex : { ...ex, superset_group: null };
    if (!mapping.has(g)) mapping.set(g, next++);
    const ng = mapping.get(g);
    return ng === g ? ex : { ...ex, superset_group: ng };
  });
}

/** "SS1" for group 1. */
export const supersetLabel = group => (group == null ? '' : `SS${group}`);
