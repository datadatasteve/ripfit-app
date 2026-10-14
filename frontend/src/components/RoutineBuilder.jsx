import { useState, useEffect } from 'react';
import SortableList, { newRowKey } from './SortableList';
import { TempoEditor, OverloadEditor, weekTargetsToRows, rowsToWeekTargets } from './RoutineExerciseExtras';
import { useUserPrefs } from '../contexts/UserPrefsContext';
import { reindexSupersets, supersetLabel } from '../utils/repRange';
import './RoutineBuilder.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const numOrNull = v => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Normalises a routine exercise (from the API or a caller) into editor state:
 * a stable _key for drag reordering, plus overload/tempo fields with defaults.
 * Numeric columns arrive from Postgres as strings ("5", "140.00").
 */
function toEditorExercise(ex) {
  return {
    _key: newRowKey(),
    exercise_id: ex.exercise_id,
    name: ex.name ?? ex.exercise_name,
    category: ex.category,
    target_sets: ex.target_sets ?? '',
    target_reps_min: ex.target_reps_min ?? '',
    target_reps_max: ex.target_reps_max ?? '',
    target_weight: ex.target_weight ?? '',
    cooldown_seconds: ex.cooldown_seconds ?? '',
    superset_group: ex.superset_group ?? null,
    notes: ex.notes || '',
    overload_strategy: ex.overload_strategy || 'none',
    overload_increment: ex.overload_increment ?? '',
    overload_schedule: ex.overload_schedule || 'linear',
    overload_week_rows: weekTargetsToRows(ex.overload_week_targets),
    tempo_eccentric: numOrNull(ex.tempo_eccentric),
    tempo_pause: numOrNull(ex.tempo_pause),
    tempo_concentric: numOrNull(ex.tempo_concentric),
  };
}

/** "" when blank, else the integer the field holds (null when not a whole number ≥ 1). */
const wholeOrBlank = raw => {
  const t = String(raw ?? '').trim();
  if (t === '') return '';
  return /^\d+$/.test(t) && parseInt(t, 10) >= 1 ? parseInt(t, 10) : null;
};

/**
 * Full-page routine builder, used for both create and edit (Patch 001).
 * Rendered in place of the hub; `layer` wraps it in a full-screen layer for
 * callers that must stay mounted underneath (Exercise Browser).
 */
export default function RoutineBuilder({ initialExercises, existingRoutine, onClose, onSaved, onDeleted, layer = false }) {
  const isEditing = !!existingRoutine;

  const [name, setName] = useState(existingRoutine?.name || '');
  const [description, setDescription] = useState(existingRoutine?.description || '');
  const [exercises, setExercises] = useState(
    () => (existingRoutine?.exercises || initialExercises || []).map(toEditorExercise)
  );
  const { prefs } = useUserPrefs();
  // Tempo templates: null until first needed, then shared by every row.
  const [tempoTemplates, setTempoTemplates] = useState(null);
  const [templatesRequested, setTemplatesRequested] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [armsExpanded, setArmsExpanded] = useState(false);
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');
  // Superset multi-select: keys of the rows currently selected.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());

  const token = localStorage.getItem('ripfit_token');

  const RESULTS_LIMIT = 100;

  const searchExercises = async (cat = categoryFilter, subcat = subcategoryFilter, newOffset = 0, append = false) => {
    const q = searchQuery.trim();
    if (!q && !cat) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }
    try {
      let url;
      if (q) {
        url = `${API_BASE}/workouts/exercises/search?q=${encodeURIComponent(q)}&limit=${RESULTS_LIMIT}&offset=${newOffset}`;
      } else {
        const params = new URLSearchParams({ limit: RESULTS_LIMIT, offset: newOffset });
        if (cat) params.set('category', cat);
        if (subcat) params.set('subcategory', subcat);
        url = `${API_BASE}/workouts/exercises/browse?${params}`;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      let results = data.exercises || [];
      // If both a text query and a category pill are active, narrow client-side
      if (q && cat) {
        results = results.filter(ex => ex.category === cat && (!subcat || ex.subcategory === subcat));
      }
      setSearchOffset(newOffset);
      setSearchTotal(data.total ?? results.length);
      setSearchResults(prev => append ? [...prev, ...results] : results);
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const loadMoreResults = () => {
    searchExercises(categoryFilter, subcategoryFilter, searchOffset + RESULTS_LIMIT, true);
  };

  const handleCategoryClick = (cat) => {
    if (cat === 'Arms') {
      const expanding = !armsExpanded;
      setArmsExpanded(expanding);
      setCategoryFilter('Arms');
      setSubcategoryFilter('');
      searchExercises('Arms', '');
    } else {
      const newCat = cat === categoryFilter ? '' : cat;
      setCategoryFilter(newCat);
      setSubcategoryFilter('');
      setArmsExpanded(false);
      searchExercises(newCat, '');
    }
  };

  const handleSubcategoryClick = (sub) => {
    setSubcategoryFilter(sub);
    setCategoryFilter('Arms');
    searchExercises('Arms', sub);
  };

  const loadTemplates = async () => {
    if (templatesRequested) return;
    setTemplatesRequested(true);
    try {
      const res = await fetch(`${API_BASE}/users/me/tempo-templates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setTempoTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to load tempo templates:', err);
      setTempoTemplates([]);
    }
  };

  const addExercise = (ex) => {
    setExercises(prev => [
      ...prev,
      toEditorExercise({ exercise_id: ex.id, name: ex.name, category: ex.category }),
    ]);
    setSearchResults([]);
    setSearchQuery('');
  };

  const removeExercise = (idx) => {
    const key = exercises[idx]?._key;
    setExercises(prev => reindexSupersets(prev.filter((_, i) => i !== idx)));
    setSelectedKeys(prev => { const next = new Set(prev); next.delete(key); return next; });
  };

  // ── Supersets ──
  const toggleSelected = (key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedKeys(new Set()); };

  // Selected rows become one group and are pulled together at the first
  // selected row's position, so a superset is always contiguous in order.
  const linkSelected = () => {
    setExercises(prev => {
      const picked = prev.filter(ex => selectedKeys.has(ex._key));
      if (picked.length < 2) return prev;
      const firstIdx = prev.findIndex(ex => selectedKeys.has(ex._key));
      const used = prev.filter(ex => !selectedKeys.has(ex._key)).map(ex => ex.superset_group || 0);
      const group = Math.max(0, ...used) + 1;
      const rest = prev.filter(ex => !selectedKeys.has(ex._key));
      const insertAt = prev.slice(0, firstIdx).filter(ex => !selectedKeys.has(ex._key)).length;
      rest.splice(insertAt, 0, ...picked.map(ex => ({ ...ex, superset_group: group })));
      return reindexSupersets(rest);
    });
    exitSelectMode();
  };

  const unlinkSelected = () => {
    setExercises(prev => reindexSupersets(
      prev.map(ex => (selectedKeys.has(ex._key) ? { ...ex, superset_group: null } : ex))
    ));
    exitSelectMode();
  };

  const selectedCount = selectedKeys.size;
  const selectedHasGroup = exercises.some(ex => selectedKeys.has(ex._key) && ex.superset_group != null);

  const moveExercise = (idx, direction) => {
    setExercises(prev => {
      const next = [...prev];
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return reindexSupersets(next);
    });
  };

  const updateExerciseField = (idx, field, value) => {
    setExercises(prev => prev.map((ex, i) => i === idx ? { ...ex, [field]: value } : ex));
  };

  const updateExercise = (idx, patch) => {
    setExercises(prev => prev.map((ex, i) => i === idx ? { ...ex, ...patch } : ex));
  };

  // Drag reorder: move one row from `from` to `to`.
  const moveExerciseTo = (from, to) => {
    setExercises(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return reindexSupersets(next);
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Routine name is required.');
      return;
    }
    if (exercises.length === 0) {
      setError('Add at least one exercise.');
      return;
    }

    // Targets are optional, but anything entered must be sane. Sets/reps are
    // positive integers; weight is a positive number or blank.
    for (const [i, ex] of exercises.entries()) {
      const label = ex.name || `Exercise ${i + 1}`;

      if (wholeOrBlank(ex.target_sets) === null) {
        setError(`${label}: sets must be a whole number of 1 or more.`);
        return;
      }
      const repsMin = wholeOrBlank(ex.target_reps_min);
      const repsMax = wholeOrBlank(ex.target_reps_max);
      if (repsMin === null || repsMax === null) {
        setError(`${label}: reps must be whole numbers of 1 or more.`);
        return;
      }
      if (repsMin !== '' && repsMax !== '' && repsMax < repsMin) {
        setError(`${label}: max reps must be at least min reps.`);
        return;
      }
      const restRaw = String(ex.cooldown_seconds ?? '').trim();
      if (restRaw !== '' && (!/^\d+$/.test(restRaw))) {
        setError(`${label}: rest must be a whole number of seconds.`);
        return;
      }

      const weightRaw = String(ex.target_weight ?? '').trim();
      if (weightRaw !== '') {
        const weight = Number(weightRaw);
        if (!Number.isFinite(weight) || weight <= 0) {
          setError(`${label}: weight must be a positive number, or left blank.`);
          return;
        }
      }

      if (ex.overload_strategy && ex.overload_strategy !== 'none') {
        const wholeOnly = ex.overload_strategy !== 'weight';
        const unit = ex.overload_strategy;
        const incRaw = String(ex.overload_increment ?? '').trim();
        if (incRaw !== '') {
          const inc = Number(incRaw);
          if (!Number.isFinite(inc) || inc <= 0 || (wholeOnly && !Number.isInteger(inc))) {
            setError(`${label}: overload increment must be a positive ${wholeOnly ? 'whole number' : 'number'} of ${unit}, or blank to use the program default.`);
            return;
          }
        }
        if (ex.overload_schedule === 'custom') {
          for (const r of ex.overload_week_rows || []) {
            if (r.value === '' || r.value === null) continue;
            const v = Number(r.value);
            if (!Number.isFinite(v) || v < 0 || (wholeOnly && !Number.isInteger(v))) {
              setError(`${label}: week ${r.week} increment must be ${wholeOnly ? 'a whole number' : 'a number'} of 0 or more.`);
              return;
            }
          }
        }
      }
    }

    setError('');
    setSaving(true);

    try {
      const url = isEditing ? `${API_BASE}/routines/${existingRoutine.id}` : `${API_BASE}/routines`;
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          exercises: reindexSupersets(exercises).map((ex, idx) => {
            const overloadOn = ex.overload_strategy && ex.overload_strategy !== 'none';
            // Only Min filled → single target (max = min); likewise only Max.
            const repsMin = ex.target_reps_min !== '' ? parseInt(ex.target_reps_min) : null;
            const repsMax = ex.target_reps_max !== '' ? parseInt(ex.target_reps_max) : null;
            return {
              exercise_id: ex.exercise_id,
              order_index: idx + 1,
              target_sets: ex.target_sets ? parseInt(ex.target_sets) : null,
              target_reps_min: repsMin ?? repsMax,
              target_reps_max: repsMax ?? repsMin,
              target_weight: ex.target_weight ? parseFloat(ex.target_weight) : null,
              cooldown_seconds: String(ex.cooldown_seconds ?? '').trim() !== '' ? parseInt(ex.cooldown_seconds) : null,
              superset_group: ex.superset_group ?? null,
              notes: ex.notes || null,
              // Sent explicitly (including nulls) so clearing a value in the
              // editor actually clears it; the server preserves omitted keys.
              overload_strategy: overloadOn ? ex.overload_strategy : 'none',
              overload_increment: overloadOn && ex.overload_increment !== '' ? Number(ex.overload_increment) : null,
              overload_schedule: overloadOn ? (ex.overload_schedule || 'linear') : 'linear',
              overload_week_targets: overloadOn && ex.overload_schedule === 'custom'
                ? rowsToWeekTargets(ex.overload_week_rows)
                : null,
              tempo_eccentric: ex.tempo_eccentric,
              tempo_pause: ex.tempo_pause,
              tempo_concentric: ex.tempo_concentric,
            };
          })
        })
      });

      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      onSaved?.(isEditing ? data : data.routine);
    } catch (err) {
      console.error('Failed to save routine:', err);
      setError('Failed to save routine. Try again.');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/routines/${existingRoutine.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Delete failed');
      onDeleted?.(existingRoutine.id);
    } catch (err) {
      console.error('Failed to delete routine:', err);
      setError('Failed to delete routine. Try again.');
      setDeleting(false);
    }
  };

  const picker = (
    <section className="rb-panel rb-picker" aria-label="Add exercises">
      <h3 className="rb-panel-title">Add exercises</h3>
      <div className="routine-builder-search">
        <input
          type="text"
          placeholder="Search exercises to add..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && searchExercises()}
        />
        <button onClick={() => searchExercises()}>Search</button>
      </div>

      <div className="routine-builder-category-pills">
        {['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Abs', 'Cardio'].map(cat => (
          <div key={cat} className="rb-pill-wrapper">
            <button
              className={`rb-cat-pill ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => handleCategoryClick(cat)}
            >
              {cat === 'Arms' ? `Arms ${armsExpanded ? '▾' : '▸'}` : cat}
            </button>
            {cat === 'Arms' && armsExpanded && (
              <div className="rb-subcat-pills">
                <button
                  className={`rb-cat-pill rb-cat-pill-sub ${subcategoryFilter === 'Biceps' ? 'active' : ''}`}
                  onClick={() => handleSubcategoryClick('Biceps')}
                >↳ Biceps</button>
                <button
                  className={`rb-cat-pill rb-cat-pill-sub ${subcategoryFilter === 'Triceps' ? 'active' : ''}`}
                  onClick={() => handleSubcategoryClick('Triceps')}
                >↳ Triceps</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {searchResults.length > 0 && (
        <div className="routine-builder-search-results">
          {searchResults.map(ex => (
            <div key={ex.id} className="search-result-row" onClick={() => addExercise(ex)}>
              <span>{ex.name}</span>
              <span className="search-result-meta">{ex.category}{ex.subcategory ? ` › ${ex.subcategory}` : ''}</span>
            </div>
          ))}
          {searchResults.length < searchTotal && (
            <button className="rb-load-more-btn" onClick={loadMoreResults}>
              Load more ({searchTotal - searchResults.length} remaining)
            </button>
          )}
        </div>
      )}
    </section>
  );

  const list = (
    <section className="rb-panel rb-list" aria-label="Routine exercises">
      <div className="rb-list-head">
        <h3 className="rb-panel-title">Exercises ({exercises.length})</h3>
        {exercises.length >= 2 && (
          selectMode
            ? <button type="button" className="rb-select-toggle" onClick={exitSelectMode}>Done</button>
            : <button type="button" className="rb-select-toggle" onClick={() => setSelectMode(true)}>Select for superset</button>
        )}
      </div>

      {selectMode && (
        <div className="rb-select-bar" role="toolbar" aria-label="Superset actions">
          <span className="rb-select-count">{selectedCount} selected</span>
          <button type="button" className="rb-ss-btn" onClick={linkSelected} disabled={selectedCount < 2}>
            Link as Superset
          </button>
          {selectedHasGroup && (
            <button type="button" className="rb-ss-btn rb-ss-btn-secondary" onClick={unlinkSelected}>
              Unlink
            </button>
          )}
        </div>
      )}

      <div className="routine-builder-exercise-list">
        {exercises.length === 0 && (
          <p className="routine-builder-empty">No exercises added yet. Search to add some.</p>
        )}
        <SortableList
          items={exercises}
          getKey={ex => ex._key}
          onMove={moveExerciseTo}
          mode={prefs.reorder_mode}
          handleLabel={ex => `Reorder ${ex.name}`}
          renderItem={(ex, idx, { handle, overlay }) => {
            const selected = selectedKeys.has(ex._key);
            return (
              <div className={`routine-builder-exercise-row ${ex.superset_group != null ? 'in-superset' : ''} ${selected ? 'is-selected' : ''}`}>
                <div className="routine-builder-exercise-main">
                  {selectMode ? (
                    <input
                      type="checkbox"
                      className="rb-select-check"
                      checked={selected}
                      onChange={() => toggleSelected(ex._key)}
                      aria-label={`Select ${ex.name}`}
                    />
                  ) : (handle || (
                    <div className="routine-builder-reorder">
                      <button onClick={() => moveExercise(idx, -1)} disabled={idx === 0} aria-label={`Move ${ex.name} up`}>▲</button>
                      <button onClick={() => moveExercise(idx, 1)} disabled={idx === exercises.length - 1} aria-label={`Move ${ex.name} down`}>▼</button>
                    </div>
                  ))}
                  <div
                    className="routine-builder-exercise-info"
                    onClick={selectMode ? () => toggleSelected(ex._key) : undefined}
                  >
                    <strong>
                      {ex.superset_group != null && <span className="ss-badge">{supersetLabel(ex.superset_group)}</span>}
                      {ex.name}
                    </strong>
                    <span className="routine-builder-exercise-cat">{ex.category}</span>
                  </div>
                  <button className="routine-builder-remove" onClick={() => removeExercise(idx)} aria-label={`Remove ${ex.name}`}>✕</button>
                </div>

                <div className="routine-builder-exercise-targets">
                  <label className="rb-target">
                    <span>Sets</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={ex.target_sets}
                      onChange={e => updateExerciseField(idx, 'target_sets', e.target.value)}
                    />
                  </label>
                  <div className="rb-target rb-target-reps">
                    <span>Reps</span>
                    <div className="rb-reps-range">
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="Min"
                        aria-label={`${ex.name} min reps`}
                        value={ex.target_reps_min}
                        onChange={e => updateExerciseField(idx, 'target_reps_min', e.target.value)}
                      />
                      <span aria-hidden="true">–</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="Max"
                        aria-label={`${ex.name} max reps`}
                        value={ex.target_reps_max}
                        onChange={e => updateExerciseField(idx, 'target_reps_max', e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="rb-target">
                    <span>Weight</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      value={ex.target_weight}
                      onChange={e => updateExerciseField(idx, 'target_weight', e.target.value)}
                    />
                  </label>
                  <label className="rb-target">
                    <span>Rest (s)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="60"
                      value={ex.cooldown_seconds}
                      onChange={e => updateExerciseField(idx, 'cooldown_seconds', e.target.value)}
                    />
                  </label>
                </div>

                {!overlay && (
                  <div className="routine-builder-exercise-extras">
                    <TempoEditor
                      exercise={ex}
                      onChange={patch => updateExercise(idx, patch)}
                      templates={tempoTemplates}
                      loadTemplates={loadTemplates}
                      onTemplateSaved={t => setTempoTemplates(list => [...(list || []), t].sort((a, b) => a.name.localeCompare(b.name)))}
                    />
                    <OverloadEditor exercise={ex} onChange={patch => updateExercise(idx, patch)} />
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </section>
  );

  const page = (
    <div className="routine-builder-page">
      <div className="routine-builder-header">
        <button type="button" className="rb-back" onClick={onClose}>← Back</button>
        <h2>{isEditing ? 'Edit Routine' : 'Create New Routine'}</h2>
      </div>

      <div className="routine-builder-form-top">
        <input
          type="text"
          placeholder="Routine name (e.g. Push Day A)"
          value={name}
          onChange={e => setName(e.target.value)}
          className="routine-name-input"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="routine-description-input"
        />
      </div>

      <div className="rb-columns">
        {list}
        {picker}
      </div>

      {showDeleteConfirm && (
        <div className="routine-delete-confirm">
          <p>Delete "{existingRoutine.name}"? This cannot be undone.</p>
          <div className="routine-builder-actions">
            <button onClick={handleDelete} disabled={deleting} className="routine-builder-delete-confirm-btn">
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
            <button onClick={() => setShowDeleteConfirm(false)} className="routine-builder-cancel">
              Keep Routine
            </button>
          </div>
        </div>
      )}

      <div className="rb-sticky-actions">
        {error && <p className="routine-builder-error">{error}</p>}
        <div className="routine-builder-actions">
          <button onClick={handleSave} disabled={saving} className="routine-builder-save">
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Save Routine'}
          </button>
          <button onClick={onClose} className="routine-builder-cancel">Cancel</button>
          {isEditing && (
            <button onClick={() => setShowDeleteConfirm(true)} className="routine-builder-delete">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return layer ? <div className="routine-builder-layer">{page}</div> : page;
}
