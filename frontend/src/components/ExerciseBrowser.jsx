import { useState, useEffect, useCallback } from 'react';
import RoutineBuilder from './RoutineBuilder';
import './ExerciseBrowser.css';

const API_BASE = 'http://localhost:3000/api/v1';
const LIMIT = 50;
const CATEGORIES = ['All', 'Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Abs', 'Cardio', 'General'];

export default function ExerciseBrowser({ activeWorkout, setActiveWorkout }) {
  const [exercises, setExercises] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const [selectedExercise, setSelectedExercise] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showAddToWorkout, setShowAddToWorkout] = useState(false);
  const [addForm, setAddForm] = useState({ sets: '', reps: '', weight: '' });
  const [addStatus, setAddStatus] = useState(''); // '', 'adding', 'added', 'error'
  const [showRoutineBuilder, setShowRoutineBuilder] = useState(false);
  const [showRoutinePicker, setShowRoutinePicker] = useState(false);
  const [userRoutines, setUserRoutines] = useState([]);
  const [pickedRoutineId, setPickedRoutineId] = useState(null);
  const [routineAddForm, setRoutineAddForm] = useState({ sets: '', reps: '', weight: '' });
  const [routinePickerStatus, setRoutinePickerStatus] = useState('');

  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState('');
  const [armsExpanded, setArmsExpanded] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState(''); // committed search term

  const token = localStorage.getItem('ripfit_token');
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // ----------------------------------------------------------------
  // Core fetch — takes explicit args so no stale closure issues
  // ----------------------------------------------------------------
  const fetchBrowse = useCallback(async (cat, subcat, equip, newOffset, append) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: newOffset });
      if (cat) params.set('category', cat);
      if (subcat) params.set('subcategory', subcat);
      if (equip) params.set('equipment', equip);

      const res = await fetch(`${API_BASE}/workouts/exercises/browse?${params}`, { headers: authHeaders });
      const data = await res.json();
      setTotal(data.total ?? 0);
      setOffset(newOffset);
      setExercises(prev => append ? [...prev, ...(data.exercises || [])] : (data.exercises || []));
    } catch (err) {
      console.error('Browse failed:', err);
    }
    setLoading(false);
  }, []);

  const fetchSearch = useCallback(async (q, newOffset, append) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/workouts/exercises/search?q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${newOffset}`,
        { headers: authHeaders }
      );
      const data = await res.json();
      // search endpoint returns count not total — use length for now, flag if 50 exactly
      const results = data.exercises || [];
      setOffset(newOffset);
      // If we got exactly LIMIT back there may be more; show load-more
      setTotal(newOffset + results.length + (results.length === LIMIT ? 1 : 0));
      setExercises(prev => append ? [...prev, ...results] : results);
    } catch (err) {
      console.error('Search failed:', err);
    }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    fetchBrowse('', '', '', 0, false);
  }, []);

  // ----------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------
  const handleCategoryClick = (cat) => {
    setSelectedExercise(null);

    if (cat === '' || cat === 'All') {
      setCategoryFilter('');
      setSubcategoryFilter('');
      setArmsExpanded(false);
      fetchBrowse('', '', equipmentFilter, 0, false);
    } else if (cat === 'Arms') {
      const expanding = !armsExpanded;
      setArmsExpanded(expanding);
      setCategoryFilter('Arms');
      setSubcategoryFilter('');
      fetchBrowse('Arms', '', equipmentFilter, 0, false);
    } else {
      setCategoryFilter(cat);
      setSubcategoryFilter('');
      setArmsExpanded(false);
      fetchBrowse(cat, '', equipmentFilter, 0, false);
    }
  };

  const handleSubcategoryClick = (sub) => {
    setSubcategoryFilter(sub);
    setCategoryFilter('Arms');
    setSelectedExercise(null);
    fetchBrowse('Arms', sub, equipmentFilter, 0, false);
  };

  const handleSearch = () => {
    const q = searchInput.trim();
    if (!q) return;
    setActiveSearch(q);
    setSelectedExercise(null);
    setCategoryFilter('');
    setSubcategoryFilter('');
    setArmsExpanded(false);
    fetchSearch(q, 0, false);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setActiveSearch('');
    setSelectedExercise(null);
    fetchBrowse(categoryFilter, subcategoryFilter, equipmentFilter, 0, false);
  };

  const handleEquipmentClick = (equip) => {
    setSelectedExercise(null);
    const newEquip = equip === equipmentFilter ? '' : equip; // toggle off if already selected
    setEquipmentFilter(newEquip);
    fetchBrowse(categoryFilter, subcategoryFilter, newEquip, 0, false);
  };

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT;
    if (activeSearch) {
      fetchSearch(activeSearch, newOffset, true);
    } else {
      fetchBrowse(categoryFilter, subcategoryFilter, equipmentFilter, newOffset, true);
    }
  };

  const fetchDetail = async (id) => {
    setDetailLoading(true);
    setShowAddToWorkout(false);
    setAddStatus('');
    setAddForm({ sets: '', reps: '', weight: '' });
    try {
      const res = await fetch(`${API_BASE}/workouts/exercises/${id}`, { headers: authHeaders });
      const data = await res.json();
      setSelectedExercise(data);
    } catch (err) {
      console.error('Detail fetch failed:', err);
    }
    setDetailLoading(false);
  };

  const openRoutinePicker = async () => {
    setShowRoutinePicker(true);
    setRoutinePickerStatus('loading');
    try {
      const res = await fetch(`${API_BASE}/routines`, { headers: authHeaders });
      const data = await res.json();
      setUserRoutines(data.routines || []);
      setRoutinePickerStatus('');
    } catch (err) {
      console.error('Failed to fetch routines:', err);
      setRoutinePickerStatus('error');
    }
  };

  const addToExistingRoutine = async (routineId) => {
    setRoutinePickerStatus('adding');
    try {
      // Fetch current routine to know how many exercises it has (for order_index)
      const detailRes = await fetch(`${API_BASE}/routines/${routineId}`, { headers: authHeaders });
      const detail = await detailRes.json();
      const nextIndex = (detail.exercises?.length || 0) + 1;

      const existingExercises = (detail.exercises || []).map(ex => ({
        exercise_id: ex.exercise_id,
        order_index: ex.order_index,
        target_sets: ex.target_sets,
        target_reps: ex.target_reps,
        target_weight: ex.target_weight,
        superset_group: ex.superset_group,
        notes: ex.notes
      }));

      const res = await fetch(`${API_BASE}/routines/${routineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          exercises: [
            ...existingExercises,
            {
              exercise_id: selectedExercise.id,
              order_index: nextIndex,
              target_sets: routineAddForm.sets ? parseInt(routineAddForm.sets) : null,
              target_reps: routineAddForm.reps ? parseInt(routineAddForm.reps) : null,
              target_weight: routineAddForm.weight ? parseFloat(routineAddForm.weight) : null
            }
          ]
        })
      });
      if (!res.ok) throw new Error('Add failed');

      setRoutinePickerStatus('added');
      setTimeout(() => {
        setShowRoutinePicker(false);
        setPickedRoutineId(null);
        setRoutineAddForm({ sets: '', reps: '', weight: '' });
        setRoutinePickerStatus('');
      }, 1000);
    } catch (err) {
      console.error('Failed to add to routine:', err);
      setRoutinePickerStatus('error');
    }
  };

  const addToActiveWorkout = async () => {
    if (!activeWorkout || !selectedExercise) return;
    setAddStatus('adding');
    try {
      const res = await fetch(`${API_BASE}/workouts/${activeWorkout.workout.id}/exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          exercise_id: selectedExercise.id,
          order_index: (activeWorkout.exercises?.length || 0) + 1,
          target_sets: addForm.sets ? parseInt(addForm.sets) : null,
          target_reps: addForm.reps ? parseInt(addForm.reps) : null,
          target_weight: addForm.weight ? parseFloat(addForm.weight) : null
        })
      });
      const newWorkoutExercise = await res.json();

      // Mirror the workout-side shape (exercise_name, category, template, logged_sets)
      // so it renders correctly back on the Workouts page.
      setActiveWorkout(prev => ({
        ...prev,
        exercises: [
          ...prev.exercises,
          {
            ...newWorkoutExercise,
            exercise_name: selectedExercise.name,
            category: selectedExercise.category,
            equipment_type: selectedExercise.equipment_type,
            is_ad_hoc: true, // flags this for the end-of-workout "save to routine?" prompt
            template: {
              target_sets: newWorkoutExercise.target_sets,
              target_reps: newWorkoutExercise.target_reps,
              target_weight: newWorkoutExercise.target_weight
            },
            logged_sets: []
          }
        ]
      }));

      setAddStatus('added');
      setTimeout(() => {
        setShowAddToWorkout(false);
        setAddStatus('');
        setAddForm({ sets: '', reps: '', weight: '' });
      }, 1200);
    } catch (err) {
      console.error('Add to workout failed:', err);
      setAddStatus('error');
    }
  };

  const hasMore = exercises.length > 0 && exercises.length < total;

  const activeCatLabel = subcategoryFilter || (categoryFilter || 'All');

  return (
    <div className="browser-layout">

      {/* ---- LEFT SIDEBAR ---- */}
      <div className="browser-sidebar">

        {/* Search bar */}
        <div className="browser-search-bar">
          <div className="search-input-wrapper">
            <input
              type="text"
              placeholder="Search exercises..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            {searchInput && (
              <button className="search-clear-x" onClick={handleClearSearch}>✕</button>
            )}
          </div>
          <button className="search-btn" onClick={handleSearch}>Search</button>
        </div>

        {/* Category filter pills — always visible */}
        <div className="browser-category-filters">
          {CATEGORIES.map(cat => (
            <div key={cat} className="cat-pill-wrapper">
              <button
                className={`cat-pill ${
                  cat === 'All'
                    ? (!categoryFilter && !activeSearch) ? 'active' : ''
                    : cat === 'Arms'
                    ? (categoryFilter === 'Arms') ? 'active' : ''
                    : categoryFilter === cat && !subcategoryFilter ? 'active' : ''
                }`}
                onClick={() => handleCategoryClick(cat === 'All' ? '' : cat)}
              >
                {cat === 'Arms' ? `Arms ${armsExpanded ? '▾' : '▸'}` : cat}
              </button>
              {cat === 'Arms' && armsExpanded && (
                <div className="subcategory-pills">
                  <button
                    className={`cat-pill cat-pill-sub ${subcategoryFilter === 'Biceps' ? 'active' : ''}`}
                    onClick={() => handleSubcategoryClick('Biceps')}
                  >↳ Biceps</button>
                  <button
                    className={`cat-pill cat-pill-sub ${subcategoryFilter === 'Triceps' ? 'active' : ''}`}
                    onClick={() => handleSubcategoryClick('Triceps')}
                  >↳ Triceps</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Equipment filter pills */}
        <div className="browser-category-filters browser-equipment-filters">
          {['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Kettlebell', 'Bodyweight', 'Resistance Band', 'Pull-up bar', 'EZ Bar'].map(equip => (
            <button
              key={equip}
              className={`cat-pill ${equipmentFilter === equip ? 'active' : ''}`}
              onClick={() => handleEquipmentClick(equip)}
            >
              {equip}
            </button>
          ))}
        </div>
        <div className="browser-list-header">
          {activeSearch
            ? `Results for "${activeSearch}" — ${exercises.length}${hasMore ? '+' : ''}`
            : `${total} exercise${total !== 1 ? 's' : ''}${categoryFilter ? ` · ${activeCatLabel}` : ''}`
          }
        </div>

        {/* Exercise list */}
        <div className="browser-exercise-list">
          {loading && exercises.length === 0 && (
            <p className="browser-status">Loading...</p>
          )}
          {!loading && exercises.length === 0 && (
            <p className="browser-status">No exercises found.</p>
          )}

          {exercises.map(ex => (
            <div
              key={ex.id}
              className={`browser-exercise-row ${selectedExercise?.id === ex.id ? 'selected' : ''}`}
              onClick={() => fetchDetail(ex.id)}
            >
              <div className="browser-exercise-name">
                {ex.name}
                {ex.in_user_routine && <span className="routine-badge" title="In one of your routines">★</span>}
              </div>
              <div className="browser-exercise-meta">
                {ex.category}{ex.subcategory ? ` › ${ex.subcategory}` : ''} · {ex.equipment_type}
              </div>
            </div>
          ))}

          {hasMore && (
            <button className="load-more-btn" onClick={handleLoadMore} disabled={loading}>
              {loading ? 'Loading...' : `Load more (${total - exercises.length} remaining)`}
            </button>
          )}
        </div>
      </div>

      {/* ---- RIGHT DETAIL PANEL ---- */}
      <div className="browser-detail">
        {detailLoading && <p className="browser-status">Loading...</p>}

        {!selectedExercise && !detailLoading && (
          <div className="detail-empty">Select an exercise to view details</div>
        )}

        {selectedExercise && !detailLoading && (
          <div className="detail-card">
            <h2 className="detail-title">{selectedExercise.name}</h2>

            <div className="detail-tags">
              <span className="detail-tag">{selectedExercise.category}</span>
              {selectedExercise.subcategory && (
                <span className="detail-tag detail-tag-sub">{selectedExercise.subcategory}</span>
              )}
              {selectedExercise.equipment_type && (
                <span className="detail-tag">{selectedExercise.equipment_type}</span>
              )}
            </div>

            {parseInt(selectedExercise.routine_count) > 0 && (
              <div className="detail-routine-notice">
                ★ Used in {selectedExercise.routine_count} of your saved routine{selectedExercise.routine_count != 1 ? 's' : ''}
              </div>
            )}

            {activeWorkout && (
              <button className="add-to-workout-btn" onClick={() => setShowAddToWorkout(true)}>
                + Add to Current Workout
              </button>
            )}

            <button className="add-to-routine-btn" onClick={() => setShowRoutineBuilder(true)}>
              + Add to New Routine
            </button>

            <button className="add-to-routine-btn add-to-existing-btn" onClick={openRoutinePicker}>
              + Add to Existing Routine
            </button>

            {showRoutinePicker && (
              <div className="routine-picker-modal">
                <h4>Choose a Routine</h4>
                {routinePickerStatus === 'loading' && <p className="browser-status">Loading routines...</p>}
                {routinePickerStatus === 'error' && <p className="add-to-workout-error">Something went wrong — try again.</p>}
                {routinePickerStatus !== 'loading' && userRoutines.length === 0 && (
                  <p className="browser-status">No routines yet — create one first.</p>
                )}

                {!pickedRoutineId && (
                  <div className="routine-picker-list">
                    {userRoutines.map(r => (
                      <button
                        key={r.id}
                        className="routine-picker-row"
                        onClick={() => setPickedRoutineId(r.id)}
                      >
                        <span>{r.name}</span>
                        <span className="routine-picker-meta">{r.exercise_count} exercises</span>
                      </button>
                    ))}
                  </div>
                )}

                {pickedRoutineId && routinePickerStatus !== 'added' && (
                  <div className="routine-picker-targets">
                    <p className="routine-picker-targets-label">Target sets/reps/weight (optional)</p>
                    <div className="add-to-workout-fields">
                      <input
                        type="number"
                        placeholder="Sets"
                        value={routineAddForm.sets}
                        onChange={e => setRoutineAddForm({ ...routineAddForm, sets: e.target.value })}
                      />
                      <input
                        type="number"
                        placeholder="Reps"
                        value={routineAddForm.reps}
                        onChange={e => setRoutineAddForm({ ...routineAddForm, reps: e.target.value })}
                      />
                      <input
                        type="number"
                        step="0.5"
                        placeholder="Weight"
                        value={routineAddForm.weight}
                        onChange={e => setRoutineAddForm({ ...routineAddForm, weight: e.target.value })}
                      />
                    </div>
                    <div className="add-to-workout-actions">
                      <button
                        onClick={() => addToExistingRoutine(pickedRoutineId)}
                        disabled={routinePickerStatus === 'adding'}
                        className="add-to-workout-confirm"
                      >
                        {routinePickerStatus === 'adding' ? 'Adding...' : 'Add'}
                      </button>
                      <button onClick={() => setPickedRoutineId(null)} className="add-to-workout-cancel">Back</button>
                    </div>
                  </div>
                )}

                {routinePickerStatus === 'added' && <p className="add-to-workout-confirm-text">✓ Added</p>}
                <button className="routine-picker-cancel" onClick={() => { setShowRoutinePicker(false); setPickedRoutineId(null); setRoutineAddForm({ sets: '', reps: '', weight: '' }); }}>Cancel</button>
              </div>
            )}

            {showAddToWorkout && (
              <div className="add-to-workout-modal">
                <h4>Add to Workout (optional)</h4>
                <div className="add-to-workout-fields">
                  <input
                    type="number"
                    placeholder="Sets"
                    value={addForm.sets}
                    onChange={e => setAddForm({ ...addForm, sets: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Reps"
                    value={addForm.reps}
                    onChange={e => setAddForm({ ...addForm, reps: e.target.value })}
                  />
                  <input
                    type="number"
                    step="0.5"
                    placeholder="Weight"
                    value={addForm.weight}
                    onChange={e => setAddForm({ ...addForm, weight: e.target.value })}
                  />
                </div>
                <div className="add-to-workout-actions">
                  <button onClick={addToActiveWorkout} disabled={addStatus === 'adding'} className="add-to-workout-confirm">
                    {addStatus === 'adding' ? 'Adding...' : addStatus === 'added' ? '✓ Added' : 'Add'}
                  </button>
                  <button onClick={() => setShowAddToWorkout(false)} className="add-to-workout-cancel">Cancel</button>
                </div>
                {addStatus === 'error' && <p className="add-to-workout-error">Failed to add — try again.</p>}
              </div>
            )}

            <div className="detail-section">
              <h4>Description</h4>
              {selectedExercise.description
                ? <p>{selectedExercise.description}</p>
                : <p className="detail-missing">No description available yet.</p>
              }
            </div>

            {(selectedExercise.muscles_primary?.length > 0 || selectedExercise.muscles_secondary?.length > 0) && (
              <div className="detail-section">
                <h4>Muscles</h4>
                {selectedExercise.muscles_primary?.length > 0 && (
                  <div className="muscle-row">
                    <span className="muscle-label">Primary</span>
                    <div className="muscle-tags">
                      {selectedExercise.muscles_primary.map(m => (
                        <span key={m} className="muscle-tag primary">{m}</span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedExercise.muscles_secondary?.length > 0 && (
                  <div className="muscle-row">
                    <span className="muscle-label">Secondary</span>
                    <div className="muscle-tags">
                      {selectedExercise.muscles_secondary.map(m => (
                        <span key={m} className="muscle-tag secondary">{m}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(selectedExercise.level || selectedExercise.mechanic || selectedExercise.force) && (
              <div className="detail-section">
                <h4>Details</h4>
                <div className="detail-meta-row">
                  {selectedExercise.level && <span className="detail-meta-item">Level: <strong>{selectedExercise.level}</strong></span>}
                  {selectedExercise.mechanic && <span className="detail-meta-item">Mechanic: <strong>{selectedExercise.mechanic}</strong></span>}
                  {selectedExercise.force && <span className="detail-meta-item">Force: <strong>{selectedExercise.force}</strong></span>}
                </div>
              </div>
            )}

            <div className="detail-section detail-coming-soon">
              <h4>Coming Soon</h4>
              <ul>
                <li>🎥 Video demonstration</li>
                <li>💪 Muscles worked diagram</li>
                <li>📊 Your stats for this exercise (times logged, routines used in)</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {showRoutineBuilder && selectedExercise && (
        <RoutineBuilder
          initialExercises={[{
            exercise_id: selectedExercise.id,
            name: selectedExercise.name,
            category: selectedExercise.category,
            target_sets: '',
            target_reps: '',
            target_weight: '',
            notes: ''
          }]}
          onClose={() => setShowRoutineBuilder(false)}
          onSaved={() => setShowRoutineBuilder(false)}
        />
      )}
    </div>
  );
}
