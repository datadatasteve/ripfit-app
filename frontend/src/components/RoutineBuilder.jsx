import { useState, useEffect } from 'react';
import './RoutineBuilder.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default function RoutineBuilder({ initialExercises, existingRoutine, onClose, onSaved, onDeleted }) {
  const isEditing = !!existingRoutine;

  const [name, setName] = useState(existingRoutine?.name || '');
  const [description, setDescription] = useState(existingRoutine?.description || '');
  const [exercises, setExercises] = useState(
    existingRoutine?.exercises?.map(ex => ({
      exercise_id: ex.exercise_id,
      name: ex.exercise_name,
      category: ex.category,
      target_sets: ex.target_sets ?? '',
      target_reps: ex.target_reps ?? '',
      target_weight: ex.target_weight ?? '',
      notes: ex.notes || ''
    })) || initialExercises || []
  );

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

  const addExercise = (ex) => {
    setExercises(prev => [
      ...prev,
      {
        exercise_id: ex.id,
        name: ex.name,
        category: ex.category,
        target_sets: '',
        target_reps: '',
        target_weight: '',
        notes: ''
      }
    ]);
    setSearchResults([]);
    setSearchQuery('');
  };

  const removeExercise = (idx) => {
    setExercises(prev => prev.filter((_, i) => i !== idx));
  };

  const moveExercise = (idx, direction) => {
    setExercises(prev => {
      const next = [...prev];
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  const updateExerciseField = (idx, field, value) => {
    setExercises(prev => prev.map((ex, i) => i === idx ? { ...ex, [field]: value } : ex));
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
          exercises: exercises.map((ex, idx) => ({
            exercise_id: ex.exercise_id,
            order_index: idx + 1,
            target_sets: ex.target_sets ? parseInt(ex.target_sets) : null,
            target_reps: ex.target_reps ? parseInt(ex.target_reps) : null,
            target_weight: ex.target_weight ? parseFloat(ex.target_weight) : null,
            notes: ex.notes || null
          }))
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

  return (
    <div className="routine-builder-overlay" onClick={onClose}>
      <div className="routine-builder" onClick={e => e.stopPropagation()}>
        <div className="routine-builder-header">
          <h2>{isEditing ? 'Edit Routine' : 'Create New Routine'}</h2>
          <button className="routine-builder-close" onClick={onClose}>✕</button>
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

        <div className="routine-builder-exercise-list">
          {exercises.length === 0 && (
            <p className="routine-builder-empty">No exercises added yet. Search above to add some.</p>
          )}
          {exercises.map((ex, idx) => (
            <div key={idx} className="routine-builder-exercise-row">
              <div className="routine-builder-reorder">
                <button onClick={() => moveExercise(idx, -1)} disabled={idx === 0}>▲</button>
                <button onClick={() => moveExercise(idx, 1)} disabled={idx === exercises.length - 1}>▼</button>
              </div>
              <div className="routine-builder-exercise-info">
                <strong>{ex.name}</strong>
                <span className="routine-builder-exercise-cat">{ex.category}</span>
              </div>
              <div className="routine-builder-exercise-targets">
                <input
                  type="number"
                  placeholder="Sets"
                  value={ex.target_sets}
                  onChange={e => updateExerciseField(idx, 'target_sets', e.target.value)}
                />
                <input
                  type="number"
                  placeholder="Reps"
                  value={ex.target_reps}
                  onChange={e => updateExerciseField(idx, 'target_reps', e.target.value)}
                />
                <input
                  type="number"
                  step="0.5"
                  placeholder="Weight"
                  value={ex.target_weight}
                  onChange={e => updateExerciseField(idx, 'target_weight', e.target.value)}
                />
              </div>
              <button className="routine-builder-remove" onClick={() => removeExercise(idx)}>✕</button>
            </div>
          ))}
        </div>

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
      </div>
    </div>
  );
}
