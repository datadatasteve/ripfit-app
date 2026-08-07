import { useState, useEffect } from 'react';
import RoutineBuilder from './RoutineBuilder';
import CardioWorkout from './CardioWorkout';
import './ActiveWorkout.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';


// ── Session Rating Widget ─────────────────────────────────────────────────
// Shown on the post-workout summary screen. Reads user's rating prefs
// (label, scale, display type) then submits to /stats/workouts/:id/rating.
function SessionRatingWidget({ workoutId }) {
  const [rating, setRating] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // Default prefs — will be overridden once fetched
  const [prefs, setPrefs] = useState({ label: 'Effort & Vibes', scale: 5, display: 'slider' });
  const token = localStorage.getItem('ripfit_token');

  useEffect(() => {
    // Fetch user rating prefs
    fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (data.workout_rating_prefs) setPrefs(data.workout_rating_prefs); })
      .catch(() => {});
  }, []);

  const save = async (val) => {
    if (!workoutId || saved) return;
    setRating(val);
    setSaving(true);
    try {
      await fetch(`${API_BASE}/stats/workouts/${workoutId}/rating`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_rating: val }),
      });
      setSaved(true);
    } catch (e) {
      console.error('Failed to save rating:', e);
    } finally {
      setSaving(false);
    }
  };

  const scale = prefs.scale || 5;
  const ticks = Array.from({ length: scale }, (_, i) => i + 1);

  return (
    <div className="session-rating-widget">
      <div className="session-rating-header">
        <span className="session-rating-label">{prefs.label}</span>
        {saved && <span className="session-rating-saved">Saved ✓</span>}
      </div>

      {/* Hidden element exposes current rating to the Done button handler */}
      <span data-session-rating={rating || ''} style={{ display: 'none' }} />
      {prefs.display === 'stars' ? (
        <div className="session-rating-stars">
          {ticks.map(v => (
            <button
              key={v}
              className={`star-btn ${rating >= v ? 'active' : ''}`}
              onClick={() => setRating(v)}
              disabled={saved}
              aria-label={`Rate ${v} out of ${scale}`}
            >★</button>
          ))}
        </div>
      ) : prefs.display === 'number' ? (
        <div className="session-rating-numbers">
          {ticks.map(v => (
            <button
              key={v}
              className={`number-btn ${rating === v ? 'active' : ''}`}
              onClick={() => setRating(v)}
              disabled={saved}
            >{v}</button>
          ))}
        </div>
      ) : (
        // Default: slider — value tracked locally, saved when user clicks Done
        <div className="session-rating-slider-wrap">
          <input
            type="range"
            min={1}
            max={scale}
            step={1}
            value={rating || Math.ceil(scale / 2)}
            className="session-rating-slider"
            onChange={e => setRating(parseInt(e.target.value))}
            disabled={saved}
          />
          <div className="session-rating-ticks">
            <span>1</span>
            <span>{Math.ceil(scale / 2)}</span>
            <span>{scale}</span>
          </div>
          {rating && <div className="session-rating-value">{rating} / {scale}</div>}
        </div>
      )}
    </div>
  );
}

// ── Free Lift Title Modal ─────────────────────────────────────────────────
// Prompts for a custom title when starting a Free Lift. Title is optional —
// skipping defaults to "Free Lift — <date>". Can be updated during/after workout.
function FreeLiftTitleModal({ onStart, onClose }) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const defaultTitle = `Free Lift — ${dateStr}`;
  const [title, setTitle] = useState('');

  const handleStart = () => {
    // Pass the entered title or null (backend/caller handles default)
    onStart(title.trim() || null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Name Your Workout</h3>
        <p style={{ fontSize: '0.9em', color: '#888', marginBottom: '12px' }}>
          Optional — leave blank to use default.
        </p>
        <input
          type="text"
          placeholder={defaultTitle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleStart()}
          autoFocus
          maxLength={100}
          style={{ width: '100%', padding: '10px', marginBottom: '16px', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleStart} className="finish-btn" style={{ flex: 1, padding: '12px' }}>
            Start Workout
          </button>
          <button
            onClick={onClose}
            style={{ padding: '12px 16px', background: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ActiveWorkout({ activeWorkout, setActiveWorkout, workoutSummary, setWorkoutSummary, showNavClock, setShowNavClock }) {
  const [token, setToken] = useState(localStorage.getItem('ripfit_token'));
  const [routines, setRoutines] = useState([]);
  const [selectedRoutine, setSelectedRoutine] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showRoutineBuilder, setShowRoutineBuilder] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState(null);
  const [showCardio, setShowCardio] = useState(false);
  const [showFreeLiftModal, setShowFreeLiftModal] = useState(false);

  const openEditRoutine = async (routineId) => {
    try {
      const res = await fetch(`${API_BASE}/routines/${routineId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setEditingRoutine(data);
      setShowRoutineBuilder(true);
    } catch (err) {
      console.error('Failed to load routine for editing:', err);
    }
  };

  useEffect(() => {
    if (token) fetchRoutines();
  }, [token]);

  const fetchRoutines = async () => {
    try {
      const res = await fetch(`${API_BASE}/routines`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setRoutines(data.routines || []);
    } catch (err) {
      console.error('Failed to fetch routines:', err);
    }
  };

  const startWorkout = async (routineId, workout_title = null) => {
    try {
      let res;
      if (routineId === null) {
        const today = new Date();
        const dateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const finalTitle = workout_title || `Free Lift — ${dateStr}`;
        res = await fetch(`${API_BASE}/workouts/start-free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            workout_date: today.toISOString().split('T')[0],
            workout_title: finalTitle,
          }),
        });
      } else {
        res = await fetch(`${API_BASE}/routines/${routineId}/start-workout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ workout_date: new Date().toISOString().split('T')[0] }),
        });
      }
      const data = await res.json();
      setActiveWorkout(data);
    } catch (err) {
      console.error('Failed to start workout:', err);
      alert('Failed to start workout');
    }
  };

  const logSet = async (exerciseIdx, setData) => {
    const exercise = activeWorkout.exercises[exerciseIdx];
    
    try {
      const res = await fetch(`${API_BASE}/workouts/${activeWorkout.workout.id}/sets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workout_exercise_id: exercise.id,
          ...setData
        })
      });
      
      if (res.ok) {
        // Update activeWorkout exercises to keep parent state in sync
        const newExercises = [...activeWorkout.exercises];
        if (!newExercises[exerciseIdx].logged_sets) {
          newExercises[exerciseIdx].logged_sets = [];
        }
        newExercises[exerciseIdx].logged_sets.push(setData);
        setActiveWorkout({ ...activeWorkout, exercises: newExercises });
      }
    } catch (err) {
      console.error('Failed to log set:', err);
    }
  };

  const finishWorkout = async (workoutNotes, sessionRating = null, ratingPrefs = null) => {
    const token = localStorage.getItem('ripfit_token');
    
    // Save any exercise notes
    for (const ex of activeWorkout.exercises) {
      if (ex.exercise_notes) {
        try {
          await fetch(`${API_BASE}/workouts/${activeWorkout.workout.id}/exercises/${ex.id}/notes`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ notes: ex.exercise_notes })
          });
        } catch (err) {
          console.error('Failed to save notes:', err);
        }
      }
    }

    // Save workout-level notes
    if (workoutNotes) {
      try {
        await fetch(`${API_BASE}/workouts/${activeWorkout.workout.id}/notes`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ overall_notes: workoutNotes })
        });
      } catch (err) {
        console.error('Failed to save workout notes:', err);
      }
    }
    
    try {
      await fetch(`${API_BASE}/workouts/${activeWorkout.workout.id}/finish`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      // Save rating immediately if one was set in the finish modal
      if (sessionRating) {
        await fetch(`${API_BASE}/stats/workouts/${activeWorkout.workout.id}/rating`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ session_rating: sessionRating }),
        }).catch(e => console.error('Failed to save rating:', e));
      }

      // Build summary data before clearing workout (subtract any paused time)
      const pausedSeconds = activeWorkout.workout.total_paused_seconds || 0;
      const rawMs = Date.now() - new Date(activeWorkout.workout.start_time).getTime();
      const duration = Math.round((rawMs / 1000 - pausedSeconds) / 60);
      setWorkoutSummary({
        workout_id: activeWorkout.workout.id,
        routine_name: activeWorkout.routine_name,
        duration_minutes: duration,
        session_rating: sessionRating,
        rating_prefs: ratingPrefs,
        exercises: activeWorkout.exercises.map(ex => ({
          exercise_name: ex.exercise_name,
          category: ex.category,
          logged_sets: ex.logged_sets || [],
          target_sets: ex.template?.target_sets,
          target_reps: ex.template?.target_reps,
          target_weight: ex.template?.target_weight,
          exercise_notes: ex.exercise_notes
        })),
        workout_notes: workoutNotes || '',
        previous_workout_notes: activeWorkout.previous_overall_notes || null
      });
      setActiveWorkout(null);
    } catch (err) {
      console.error('Failed to finish workout:', err);
    }
  };

  const cancelWorkout = async () => {
    const token = localStorage.getItem('ripfit_token');
    try {
      await fetch(`${API_BASE}/workouts/${activeWorkout.workout.id}/cancel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (err) {
      console.error('Failed to cancel workout:', err);
    }
    setActiveWorkout(null); // discard locally regardless of network outcome
  };

  if (!token) {
    return (
      <div className="workout-container">
        <p>Please log in to track workouts</p>
      </div>
    );
  }

  if (workoutSummary) {
    const totalSets = workoutSummary.exercises.reduce((sum, ex) => sum + ex.logged_sets.length, 0);
    const totalReps = workoutSummary.exercises.reduce((sum, ex) => 
      sum + ex.logged_sets.reduce((s, set) => s + (set.reps_completed || 0), 0), 0);
    const totalWeight = workoutSummary.exercises.reduce((sum, ex) => 
      sum + ex.logged_sets.reduce((s, set) => s + ((set.weight_used || 0) * (set.reps_completed || 0)), 0), 0);
    const totalSeconds = workoutSummary.duration_minutes * 60;
    const dHours = Math.floor(totalSeconds / 3600);
    const dMins = Math.floor((totalSeconds % 3600) / 60);
    const dSecs = totalSeconds % 60;
    const durationStr = `${String(dHours).padStart(2,'0')}:${String(dMins).padStart(2,'0')}:${String(dSecs).padStart(2,'0')}`;

    return (
      <div className="workout-container">
        <div className="workout-summary">
          <h2>Workout Complete!</h2>
          <h3>{workoutSummary.routine_name}</h3>
          
          <div className="summary-stats">
            <div className="stat-box">
              <span className="stat-value">{durationStr}</span>
              <span className="stat-label">Duration</span>
            </div>
            <div className="stat-box">
              <span className="stat-value">{workoutSummary.exercises.length}</span>
              <span className="stat-label">Exercises</span>
            </div>
            <div className="stat-box">
              <span className="stat-value">{totalSets}</span>
              <span className="stat-label">Sets</span>
            </div>
            <div className="stat-box">
              <span className="stat-value">{totalReps}</span>
              <span className="stat-label">Total Reps</span>
            </div>
          </div>

          <div className="summary-exercises">
            <h4>Exercise Breakdown</h4>
            {workoutSummary.exercises.map((ex, idx) => (
              <div key={idx} className="summary-exercise-item">
                <strong>{ex.exercise_name}</strong>
                <span className="summary-category">{ex.category}</span>
                <div className="summary-sets">
                  {ex.logged_sets.length > 0 ? (
                    ex.logged_sets.map((set, sIdx) => (
                      <span key={sIdx} className="set-pill">
                        {set.reps_completed} × {set.weight_used} lbs
                        {set.rpe ? ` @ RPE ${set.rpe}` : ''}
                      </span>
                    ))
                  ) : (
                    <span className="skipped">Skipped</span>
                  )}
                </div>
                {ex.target_sets && ex.logged_sets.length < ex.target_sets && (
                  <p className="sets-caution">Completed {ex.logged_sets.length} of {ex.target_sets} target sets</p>
                )}
                {ex.exercise_notes && (
                  <p className="summary-notes">{ex.exercise_notes}</p>
                )}
              </div>
            ))}
          </div>

          {workoutSummary.workout_notes && (
            <div className="summary-workout-notes">
              <h4>Workout Notes</h4>
              <p style={{color: '#fff', whiteSpace: 'pre-wrap'}}>{workoutSummary.workout_notes}</p>
            </div>
          )}

          {workoutSummary.previous_workout_notes && (
            <div className="summary-workout-notes" style={{marginTop: '10px', borderLeft: '3px solid #888'}}>
              <h4>Previous Workout Notes</h4>
              <p style={{color: '#fff', whiteSpace: 'pre-wrap'}}>{workoutSummary.previous_workout_notes}</p>
            </div>
          )}

          {workoutSummary.session_rating && (
            <div className="summary-rating" style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                {workoutSummary.rating_prefs?.label || 'Effort & Vibes'}
              </span>
              <span style={{ fontSize: '1.4em', fontWeight: 700, color: 'var(--color-warning)' }}>
                {workoutSummary.session_rating} / {workoutSummary.rating_prefs?.scale || 5}
              </span>
            </div>
          )}

          <button
            onClick={() => setWorkoutSummary(null)}
            className="finish-btn"
            style={{ width: '100%', padding: '14px', fontSize: '1.1em', marginTop: '20px' }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (activeWorkout) {
    return <WorkoutInProgress 
      workout={activeWorkout}
      setActiveWorkout={setActiveWorkout}
      onLogSet={logSet}
      onFinish={finishWorkout}
      onCancel={cancelWorkout}
      showNavClock={showNavClock}
      setShowNavClock={setShowNavClock}
    />;
  }

  return (
    <div className="workout-container">

      {/* ── Log a Workout ── */}
      <div className="log-workout-section">
        <h2 className="log-workout-title">Log a Workout</h2>
        <button
          className="free-lift-btn"
          onClick={() => setShowFreeLiftModal(true)}
          disabled={loading}
        >
          Free Lift
        </button>
        <div className="workout-type-row">
          <button
            className="workout-type-btn"
            onClick={() => { /* scrolls to routines */ document.getElementById('routines-section')?.scrollIntoView({ behavior: 'smooth' }); }}
          >
            Strength
          </button>
          <button
            className="workout-type-btn"
            onClick={() => setShowCardio(true)}
          >
            Cardio
          </button>
        </div>
      </div>

      {/* ── Routines ── */}
      <div id="routines-section">
        <div className="routines-header">
          <h3>Your Routines</h3>
          <button className="create-routine-btn" onClick={() => { setEditingRoutine(null); setShowRoutineBuilder(true); }}>
            + New Routine
          </button>
        </div>

        <div className="routines-list">
          {routines.length === 0 ? (
            <p>No routines yet. Create one above.</p>
          ) : (
            routines.map(routine => (
              <div key={routine.id} className="routine-card">
                <h3>{routine.name}</h3>
                {routine.description && <p className="routine-card-description">{routine.description}</p>}
                <p>{routine.exercise_count} exercises</p>
                <div className="routine-card-actions">
                  <button
                    onClick={() => startWorkout(routine.id)}
                    disabled={loading}
                  >
                    Start Workout
                  </button>
                  <button
                    className="routine-card-edit-btn"
                    onClick={() => openEditRoutine(routine.id)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showFreeLiftModal && (
        <FreeLiftTitleModal
          onStart={(title) => {
            setShowFreeLiftModal(false);
            startWorkout(null, title);
          }}
          onClose={() => setShowFreeLiftModal(false)}
        />
      )}

      {showCardio && (
        <CardioWorkout onClose={(result) => {
          setShowCardio(false);
          // Could show a summary toast here in future
        }} />
      )}

      {showRoutineBuilder && (
        <RoutineBuilder
          existingRoutine={editingRoutine}
          onClose={() => {
            setShowRoutineBuilder(false);
            setEditingRoutine(null);
          }}
          onSaved={() => {
            setShowRoutineBuilder(false);
            setEditingRoutine(null);
            fetchRoutines();
          }}
          onDeleted={() => {
            setShowRoutineBuilder(false);
            setEditingRoutine(null);
            fetchRoutines();
          }}
        />
      )}
    </div>
  );
}

function WorkoutInProgress({ workout, setActiveWorkout, onLogSet, onFinish, onCancel, showNavClock, setShowNavClock }) {
  const [currentExerciseIdx, setCurrentExerciseIdx] = useState(0);
  const [setForm, setSetForm] = useState({ reps: '', weight: '', rpe: '' });
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [showChangeExercise, setShowChangeExercise] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [showAllExercises, setShowAllExercises] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [editNotesText, setEditNotesText] = useState('');
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [showHeaderClockSettings, setShowHeaderClockSettings] = useState(false);
  const [showHeaderClock, setShowHeaderClock] = useState(true); // toggle: elapsed clock in header

  // Tick once per second purely to force a re-render so the elapsed
  // clock display stays live. The actual elapsed time is always derived
  // from workout.workout.start_time / paused_at, never from this tick.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isPaused = !!workout.workout.paused_at;

  const getElapsedSeconds = () => {
    const pausedSeconds = workout.workout.total_paused_seconds || 0;
    const currentPauseSeconds = workout.workout.paused_at
      ? Math.floor((Date.now() - new Date(workout.workout.paused_at).getTime()) / 1000)
      : 0;
    const rawElapsed = Math.floor((Date.now() - new Date(workout.workout.start_time).getTime()) / 1000);
    return Math.max(0, rawElapsed - pausedSeconds - currentPauseSeconds);
  };

  const togglePause = () => {
    if (isPaused) {
      // Resume: fold the just-finished pause into total_paused_seconds
      const pauseDurationSeconds = Math.floor((Date.now() - new Date(workout.workout.paused_at).getTime()) / 1000);
      setActiveWorkout({
        ...workout,
        workout: {
          ...workout.workout,
          paused_at: null,
          total_paused_seconds: (workout.workout.total_paused_seconds || 0) + pauseDurationSeconds
        }
      });
    } else {
      // Pause: record the timestamp pause began
      setActiveWorkout({
        ...workout,
        workout: { ...workout.workout, paused_at: new Date().toISOString() }
      });
    }
  };

  const elapsedSeconds = getElapsedSeconds();
  const elapsedM = Math.floor(elapsedSeconds / 60);
  const elapsedS = elapsedSeconds % 60;
  const elapsedStr = `${elapsedM}:${String(elapsedS).padStart(2, '0')}`;

  const currentPauseSeconds = isPaused
    ? Math.floor((Date.now() - new Date(workout.workout.paused_at).getTime()) / 1000)
    : 0;
  const pauseM = Math.floor(currentPauseSeconds / 60);
  const pauseS = currentPauseSeconds % 60;
  const pausedStr = `${pauseM}:${String(pauseS).padStart(2, '0')}`;

  // TEMP DEBUG - remove once start_time field is confirmed
  window.__ripfitDebug = workout.workout;
  const [showWorkoutNotes, setShowWorkoutNotes] = useState(false);
  const [workoutNotesSaved, setWorkoutNotesSaved] = useState(true);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [showSaveToRoutinePrompt, setShowSaveToRoutinePrompt] = useState(false);
  const [adHocChoices, setAdHocChoices] = useState({}); // { [workout_exercise_id]: true/false }
  const [savingToRoutine, setSavingToRoutine] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Rating captured in finish modal so it saves with the workout, not after
  const [pendingRating, setPendingRating] = useState(null);
  const [ratingPrefs, setRatingPrefs] = useState({ label: 'Effort & Vibes', scale: 5, display: 'slider' });

  useEffect(() => {
    const tok = localStorage.getItem('ripfit_token');
    fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${tok}` } })
      .then(r => r.json())
      .then(data => { if (data.workout_rating_prefs) setRatingPrefs(data.workout_rating_prefs); })
      .catch(() => {});
  }, []);

  const exercises = workout.exercises;
  const currentExercise = exercises[currentExerciseIdx] || {};

  // Helper function to format notes based on user preference
  const formatNotesForDisplay = (notes, isPrevious = false) => {
    if (!notes) return '';
    // Previous notes always show set tags
    const showSetTags = isPrevious || localStorage.getItem('showSetTags') !== 'false';
    
    return notes.split('\n').map(line => {
      // Handle general notes (no set tag)
      const generalMatch = line.match(/^General: (.+)$/);
      if (generalMatch) {
        return generalMatch[1];
      }
      
      // Handle set-tagged notes
      const setMatch = line.match(/^Set (\d+): (.+)$/);
      if (setMatch) {
        if (showSetTags) {
          return `${setMatch[2]} [Set ${setMatch[1]}]`;
        } else {
          return setMatch[2];
        }
      }
      return line;
    }).join('\n');
  };

  // Set edit text when opening editor
  useEffect(() => {
    if (editingNotes && currentExercise.id) {
      setEditNotesText(currentExercise.exercise_notes || '');
    }
  }, [editingNotes]);

  const moveExercise = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= exercises.length) return;
    
    const reordered = [...exercises];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    
    setActiveWorkout({ ...workout, exercises: reordered });
    
    // Update current index if needed
    if (currentExerciseIdx === fromIdx) {
      setCurrentExerciseIdx(toIdx);
    } else if (fromIdx < currentExerciseIdx && toIdx >= currentExerciseIdx) {
      setCurrentExerciseIdx(currentExerciseIdx - 1);
    } else if (fromIdx > currentExerciseIdx && toIdx <= currentExerciseIdx) {
      setCurrentExerciseIdx(currentExerciseIdx + 1);
    }
  };
  const loggedSets = currentExercise.logged_sets || [];
  const targetSets = currentExercise.template?.target_sets || 3;

  useEffect(() => {
    // Don't run if there's no real exercise yet (Free Lift empty state)
    if (!currentExercise.id) return;

    // Pre-fill from last set, or from template if first set.
    // Weight is intentionally left blank when no target is set — forces user
    // to enter it rather than silently logging 0 lbs.
    const defaultWeight = loggedSets.length > 0
      ? loggedSets[loggedSets.length - 1].weight_used
      : (currentExercise.template?.target_weight ?? '');

    const defaultReps = loggedSets.length > 0
      ? loggedSets[loggedSets.length - 1].reps_completed
      : currentExercise.template?.target_reps || '';

    setSetForm({ reps: defaultReps, weight: defaultWeight, rpe: '' });
  }, [currentExerciseIdx, loggedSets.length, currentExercise.id]);

  const handleChangeExercise = async (newExercise, reason, targets) => {
    const token = localStorage.getItem('ripfit_token');
    const oldExercise = currentExercise;
    
    try {
      // Delete old exercise from workout
      await fetch(`${API_BASE}/workouts/${workout.workout.id}/exercises/${oldExercise.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      // Add new exercise at same position
      const res = await fetch(`${API_BASE}/workouts/${workout.workout.id}/exercises`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          exercise_id: newExercise.id,
          order_index: currentExerciseIdx + 1,
          exercise_notes: reason ? `Substituted for ${oldExercise.exercise_name}. Reason: ${reason}` : null
        })
      });
      const data = await res.json();
      
      // Update state with new targets if provided
      const oldNotes = oldExercise.exercise_notes ? `\nPrevious notes (${oldExercise.exercise_name}): ${oldExercise.exercise_notes}` : '';
      const substitutionNote = reason 
        ? `Substituted for ${oldExercise.exercise_name}. Reason: ${reason}${oldNotes}` 
        : `Substituted for ${oldExercise.exercise_name}${oldNotes}`;
      
      const updatedExercises = [...exercises];
      updatedExercises[currentExerciseIdx] = {
        ...data,
        exercise_name: newExercise.name,
        category: newExercise.category,
        equipment_type: newExercise.equipment_type,
        exercise_notes: substitutionNote,
        logged_sets: [],
        template: {
          target_sets: targets.sets ? parseInt(targets.sets) : null,
          target_reps: targets.reps ? parseInt(targets.reps) : null,
          target_weight: targets.weight && !['BW', '0', '-'].includes(targets.weight.toString().toUpperCase()) 
            ? parseFloat(targets.weight) 
            : null
        }
      };
      
      setActiveWorkout({ ...workout, exercises: updatedExercises });
      setShowChangeExercise(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (err) {
      console.error('Failed to change exercise:', err);
    }
  };

  const adHocExercises = exercises.filter(ex => ex.is_ad_hoc);

  // Called when user clicks Finish — if there were ad-hoc additions, show the
  // routine-save prompt first instead of finishing immediately.
  const handleFinishClick = () => {
    setShowFinishConfirm(false);
    if (adHocExercises.length > 0) {
      const defaults = {};
      adHocExercises.forEach(ex => { defaults[ex.id] = false; });
      setAdHocChoices(defaults);
      setShowSaveToRoutinePrompt(true);
    } else {
      onFinish(workoutNotes, pendingRating, ratingPrefs);
    }
  };

  const finalizeFinish = async () => {
    const toSave = adHocExercises.filter(ex => adHocChoices[ex.id]);

    if (toSave.length > 0 && workout.workout.routine_id) {
      setSavingToRoutine(true);
      try {
        const token = localStorage.getItem('ripfit_token');
        const detailRes = await fetch(`${API_BASE}/routines/${workout.workout.routine_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const detail = await detailRes.json();
        const existingExercises = (detail.exercises || []).map(ex => ({
          exercise_id: ex.exercise_id,
          order_index: ex.order_index,
          target_sets: ex.target_sets,
          target_reps: ex.target_reps,
          target_weight: ex.target_weight,
          superset_group: ex.superset_group,
          notes: ex.notes
        }));
        let nextIndex = existingExercises.length + 1;
        const newOnes = toSave.map(ex => ({
          exercise_id: ex.exercise_id,
          order_index: nextIndex++,
          target_sets: ex.template?.target_sets || null,
          target_reps: ex.template?.target_reps || null,
          target_weight: ex.template?.target_weight || null
        }));

        await fetch(`${API_BASE}/routines/${workout.workout.routine_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ exercises: [...existingExercises, ...newOnes] })
        });
      } catch (err) {
        console.error('Failed to save ad-hoc exercises to routine:', err);
      }
      setSavingToRoutine(false);
    }

    setShowSaveToRoutinePrompt(false);
    onFinish(workoutNotes, pendingRating, ratingPrefs);
  };

  const handleAddExercise = async (exercise, targets) => {
    const token = localStorage.getItem('ripfit_token');
    try {
      const res = await fetch(`${API_BASE}/workouts/${workout.workout.id}/exercises`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          exercise_id: exercise.id,
          order_index: exercises.length + 1
        })
      });
      const data = await res.json();
      
      // Update parent workout state
      setActiveWorkout({
        ...workout,
        exercises: [...exercises, {
          ...data,
          exercise_name: exercise.name,
          category: exercise.category,
          equipment_type: exercise.equipment_type,
          logged_sets: [],
          is_ad_hoc: true, // flags this for the end-of-workout "save to routine?" prompt
          template: {
            target_sets: targets.sets ? parseInt(targets.sets) : null,
            target_reps: targets.reps ? parseInt(targets.reps) : null,
            target_weight: targets.weight && !['BW', '0', '-'].includes(targets.weight.toString().toUpperCase()) 
              ? parseFloat(targets.weight) 
              : null
          }
        }]
      });
      
      setShowAddExercise(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (err) {
      console.error('Failed to add exercise:', err);
    }
  };

  const handleLogSet = async () => {
    if (!setForm.reps) {
      alert('Enter reps');
      return;
    }

    // Handle bodyweight indicators
    let weightValue = setForm.weight;
    if (!weightValue || ['BW', '0', '-'].includes(weightValue.toString().toUpperCase())) {
      weightValue = 0;
    }

    const setNumber = loggedSets.length + 1;
    const token = localStorage.getItem('ripfit_token');

    // Auto-save note if there's text in input (before logging set)
    let notesUpdated = false;
    let updatedNotesText = currentExercise.exercise_notes || '';
    if (noteInput.trim()) {
      try {
        const noteWithSet = `Set ${setNumber}: ${noteInput.trim()}`;
        updatedNotesText = updatedNotesText
          ? `${updatedNotesText}\n${noteWithSet}`
          : noteWithSet;

        await fetch(`${API_BASE}/workouts/${workout.workout.id}/exercises/${currentExercise.id}/notes`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ notes: updatedNotesText })
        });
        notesUpdated = true;
        setNoteInput('');
      } catch (err) {
        console.error('Failed to save note:', err);
      }
    }

    // Log set to backend
    try {
      const res = await fetch(`${API_BASE}/workouts/${workout.workout.id}/sets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workout_exercise_id: currentExercise.id,
          set_number: setNumber,
          reps_completed: parseInt(setForm.reps),
          weight_used: parseFloat(weightValue),
          rpe: setForm.rpe ? parseInt(setForm.rpe) : null
        })
      });

      if (res.ok) {
        // Single state update with both set and notes
        const updated = [...exercises];
        if (!updated[currentExerciseIdx].logged_sets) {
          updated[currentExerciseIdx].logged_sets = [];
        }
        updated[currentExerciseIdx].logged_sets.push({
          set_number: setNumber,
          reps_completed: parseInt(setForm.reps),
          weight_used: parseFloat(weightValue),
          rpe: setForm.rpe ? parseInt(setForm.rpe) : null
        });
        if (notesUpdated) {
          updated[currentExerciseIdx].exercise_notes = updatedNotesText;
        }
        setActiveWorkout({ ...workout, exercises: updated });
      } else {
        console.error('Failed to log set:', await res.text());
        alert('Failed to log set');
        return;
      }
    } catch (err) {
      console.error('Failed to log set:', err);
      alert('Failed to log set');
      return;
    }

    // Start rest timer - timestamp-based so it survives navigation/unmount.
    // Default 60s; respects per-exercise override and on/off toggle if set.
    const restEnabled = currentExercise.rest_timer_enabled !== false; // default true
    const restDuration = currentExercise.rest_timer_seconds || 60;

    if (restEnabled) {
      setActiveWorkout(prev => ({
        ...prev,
        workout: { ...prev.workout, rest_ends_at: new Date(Date.now() + restDuration * 1000).toISOString() }
      }));
    }

    // Auto-progress if target sets reached (with brief delay)
    // setNumber = loggedSets.length + 1 = the set we just logged
    const target = currentExercise.template?.target_sets;
    if (target && setNumber >= target && currentExerciseIdx < exercises.length - 1) {
      setTimeout(() => autoNextExercise(), 750);
    } else {
      setSetForm({ ...setForm, reps: '', rpe: '' });
    }
  };

  const skipRest = () => {
    setActiveWorkout(prev => ({
      ...prev,
      workout: { ...prev.workout, rest_ends_at: null }
    }));
  };

  // Derive remaining rest seconds from the persisted timestamp.
  // Recomputed every render tick - survives unmount/remount since the
  // timestamp lives in lifted App.jsx state, not local component state.
  const restEndsAt = workout.workout.rest_ends_at;
  const restSeconds = restEndsAt
    ? Math.max(0, Math.ceil((new Date(restEndsAt).getTime() - Date.now()) / 1000))
    : 0;
  const isResting = restEndsAt && restSeconds > 0;

  // Clear the timestamp once it naturally hits 0 (avoids stale "resting" class)
  useEffect(() => {
    if (restEndsAt && restSeconds === 0) {
      if (navigator.vibrate) navigator.vibrate(200);
      setActiveWorkout(prev => ({
        ...prev,
        workout: { ...prev.workout, rest_ends_at: null }
      }));
    }
  }, [restSeconds, restEndsAt]);

  // Auto-progress version - no unsaved warning prompts
  const autoNextExercise = () => {
    setNoteInput('');
    setEditingNotes(false);
    setCurrentExerciseIdx(prev => {
      if (prev < exercises.length - 1) {
        return prev + 1;
      }
      return prev;
    });
    setSetForm({ reps: '', weight: '', rpe: '' });
  };

  const nextExercise = () => {
    if (editingNotes) {
      if (!confirm('You have unsaved note edits. Discard changes?')) return;
      setEditingNotes(false);
    }
    if (noteInput.trim()) {
      if (!confirm('You have an unsaved note. Discard it?')) return;
      setNoteInput('');
    }
    if (currentExerciseIdx < exercises.length - 1) {
      setCurrentExerciseIdx(currentExerciseIdx + 1);
      setSetForm({ reps: '', weight: '', rpe: '' });
    }
  };

  const prevExercise = () => {
    if (editingNotes) {
      if (!confirm('You have unsaved note edits. Discard changes?')) return;
      setEditingNotes(false);
    }
    if (noteInput.trim()) {
      if (!confirm('You have an unsaved note. Discard it?')) return;
      setNoteInput('');
    }
    if (currentExerciseIdx > 0) {
      setCurrentExerciseIdx(currentExerciseIdx - 1);
    }
  };

  // Free Lift (or any workout) started with no exercises yet — render a
  // safe empty state instead of crashing on currentExercise.logged_sets.
  if (exercises.length === 0) {
    return (
      <div className="workout-container">
        <div className="workout-header">
          <h2>{workout.routine_name || 'Free Lift'}</h2>
          <div className="header-buttons">
            <button onClick={togglePause} className={`pause-resume-btn ${isPaused ? 'is-paused' : ''}`}>
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button onClick={() => setShowFinishConfirm(true)} className="finish-btn">Finish Workout</button>
          </div>
        </div>

        <div className="current-exercise" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: '1.1em', color: '#888', marginBottom: '20px' }}>
            No exercises yet — add one to get started.
          </p>
          <button onClick={() => setShowAddExercise(true)} className="add-exercise-btn" style={{ fontSize: '1em', padding: '12px 24px' }}>
            + Add Exercise
          </button>
        </div>

        {showAddExercise && (
          <AddExerciseModal
            onAdd={handleAddExercise}
            onClose={() => setShowAddExercise(false)}
          />
        )}

        {showFinishConfirm && (
          <div className="modal-overlay" onClick={() => setShowFinishConfirm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Finish Workout</h3>
              <p>No exercises were logged. Are you sure you want to finish?</p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
                <button onClick={() => onFinish(workoutNotes)} className="finish-btn" style={{ flex: 1, padding: '12px' }}>
                  Finish Anyway
                </button>
                <button onClick={() => setShowFinishConfirm(false)} style={{ padding: '12px 16px', background: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  Go Back
                </button>
              </div>
            </div>
          </div>
        )}

        {showCancelConfirm && (
          <div className="modal-overlay" onClick={() => setShowCancelConfirm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Cancel Workout?</h3>
              <p>This will cancel your current workout.</p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
                <button onClick={() => { onCancel(); setShowCancelConfirm(false); }} className="cancel-workout-btn" style={{ flex: 1, padding: '12px' }}>
                  Yes, Cancel
                </button>
                <button onClick={() => setShowCancelConfirm(false)} style={{ padding: '12px 16px', background: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  Keep Going
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="workout-container">
      <div className="workout-header">
        <h2>{workout.routine_name}</h2>
        <div className="header-buttons">
          {showHeaderClock && (
            <>
              <span className={`workout-elapsed-clock ${isPaused ? 'paused' : ''}`}>
                {isPaused ? '⏸' : '⏱'} {elapsedStr}
              </span>
              {isPaused && (
                <span className="workout-pause-duration">{pausedStr}</span>
              )}
            </>
          )}
          <button onClick={togglePause} className={`pause-resume-btn ${isPaused ? 'is-paused' : ''}`}>
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <div className="clock-settings-wrapper">
            <button onClick={() => setShowHeaderClockSettings(prev => !prev)} className="clock-settings-btn" title="Clock display settings">⚙</button>
            {showHeaderClockSettings && (
              <div className="clock-settings-dropdown">
                <label>
                  <input type="checkbox" checked={showHeaderClock} onChange={e => setShowHeaderClock(e.target.checked)} />
                  Show clock in header
                </label>
                <label>
                  <input type="checkbox" checked={showNavClock} onChange={e => setShowNavClock(e.target.checked)} />
                  Show clock in nav
                </label>
              </div>
            )}
          </div>
          <button onClick={() => setShowWorkoutNotes(true)} className="workout-notes-btn">
            Workout Notes {workoutNotes ? '📝' : ''}
          </button>
          <button onClick={() => setShowAllExercises(true)} className="view-all-btn">View All</button>
          <button onClick={() => setShowFinishConfirm(true)} className="finish-btn">Finish Workout</button>
        </div>
      </div>

      {isPaused && (
        <div className="workout-paused-banner">
          Workout paused — duration clock stopped. Rest timer (if active) keeps running.
        </div>
      )}

      <div className="exercise-progress">
        Exercise {currentExerciseIdx + 1} of {exercises.length}
      </div>

      <div className="current-exercise">
        <div className="exercise-header">
          <h3>{currentExercise.exercise_name}</h3>
          <button onClick={() => setShowChangeExercise(true)} className="change-exercise-btn">
            Change Exercise
          </button>
        </div>
        <p className="category">{currentExercise.category} • {currentExercise.equipment_type}</p>

        {currentExercise.template && (
          <div className="template-info">
            <strong>Target:</strong> {currentExercise.template.target_sets} sets × {currentExercise.template.target_reps} reps @ {currentExercise.template.target_weight} lbs
          </div>
        )}

        {currentExercise.last_performance && (
          <div className="last-performance">
            <strong>Last time ({new Date(workout.last_workout_date).toLocaleDateString()}):</strong>
            {currentExercise.last_performance.exercise_notes?.startsWith('Substituted for') && (
              <p style={{fontSize: '0.85em', color: '#ff9800', margin: '4px 0'}}>
                ↔️ {currentExercise.last_performance.exercise_notes.split('\n')[0]}
              </p>
            )}
            <div className="sets-history">
              {currentExercise.last_performance.sets_completed.map((set, idx) => {
                const template = currentExercise.template;
                const underperformed = template && (
                  parseInt(set.reps) < parseInt(template.target_reps || 0) || 
                  parseFloat(set.weight) < parseFloat(template.target_weight || 0)
                );
                const highRPE = set.rpe && parseInt(set.rpe) >= 10;
                const showCaution = underperformed || highRPE;
                
                return (
                  <span key={idx} className={`set-pill ${showCaution ? 'caution' : ''}`}>
                    {showCaution && '⚠️ '}
                    {set.reps} × {set.weight} lbs {set.rpe ? `@ RPE ${set.rpe}` : ''}
                  </span>
                );
              })}
            </div>
            {currentExercise.last_performance.sets_completed.length < (currentExercise.template?.target_sets || 0) && (
              <p className="sets-caution">⚠️ Completed {currentExercise.last_performance.sets_completed.length} of {currentExercise.template.target_sets} target sets</p>
            )}
          </div>
        )}

        <div className="logged-sets">
          <h4>Sets Logged:</h4>
          {loggedSets.length === 0 ? (
            <p>No sets yet</p>
          ) : (
            loggedSets.map((set, idx) => {
              const highRPE = set.rpe && parseInt(set.rpe) >= 10;
              const targetReps = currentExercise.template?.target_reps;
              const targetWeight = currentExercise.template?.target_weight;
              const underReps = targetReps && set.reps_completed < parseInt(targetReps);
              const underWeight = targetWeight && parseFloat(set.weight_used) < parseFloat(targetWeight);
              const underperformed = underReps || underWeight;
              return (
                <div key={idx} className={`set-entry ${highRPE ? 'rpe-warning' : underperformed ? 'under-target' : ''}`}>
                  Set {set.set_number}: {set.reps_completed} reps × {set.weight_used === 0 ? 'BW' : `${set.weight_used} lbs`}
                  {set.rpe && ` @ RPE ${set.rpe}`}
                  {highRPE && ' ⚠️'}
                </div>
              );
            })
          )}
        </div>

        <div className="exercise-notes-section">
          <h4>Exercise Notes</h4>
          {currentExercise.last_performance?.exercise_notes && (
            <div className="previous-notes">
              <strong>Previous workout notes:</strong>
              <pre>{formatNotesForDisplay(currentExercise.last_performance.exercise_notes, true)}</pre>
            </div>
          )}
          
          {currentExercise.exercise_notes && (
            <div className="current-notes-log">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                <strong>Today's notes:</strong>
                <button 
                  onClick={() => setEditingNotes(true)}
                  className="edit-notes-btn"
                  style={{fontSize: '0.85em', padding: '4px 8px'}}
                >
                  Edit
                </button>
              </div>
              {editingNotes ? (
                <>
                  <textarea
                    value={editNotesText}
                    onChange={(e) => setEditNotesText(e.target.value)}
                    rows="4"
                    style={{width: '100%', padding: '8px', marginBottom: '8px'}}
                  />
                  <div style={{display: 'flex', gap: '8px'}}>
                    <button 
                      onClick={async () => {
                        const token = localStorage.getItem('ripfit_token');
                        try {
                          const res = await fetch(`${API_BASE}/workouts/${workout.workout.id}/exercises/${currentExercise.id}/notes`, {
                            method: 'PUT',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ notes: editNotesText })
                          });
                          const data = await res.json();
                          const updated = [...exercises];
                          updated[currentExerciseIdx].exercise_notes = data.exercise_notes;
                          setActiveWorkout({ ...workout, exercises: updated });
                          setEditingNotes(false);
                        } catch (err) {
                          console.error('Failed to update notes:', err);
                        }
                      }}
                      className="save-note-btn"
                    >
                      Save
                    </button>
                    <button 
                      onClick={() => {
                        setEditingNotes(false);
                        setEditNotesText(currentExercise.exercise_notes);
                      }}
                      style={{padding: '6px 12px'}}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <pre>{formatNotesForDisplay(currentExercise.exercise_notes)}</pre>
              )}
            </div>
          )}
          
          <textarea
            className="exercise-notes-input"
            placeholder="Add a note..."
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            rows="2"
          />
          <div className="note-buttons">
            <button 
              onClick={async () => {
                if (!noteInput.trim()) return;
                const token = localStorage.getItem('ripfit_token');
                const setNumber = loggedSets.length > 0 ? loggedSets.length : 1;
                
                try {
                  const noteWithSet = `Set ${setNumber}: ${noteInput.trim()}`;
                  const currentNotes = currentExercise.exercise_notes || '';
                  const updatedNotes = currentNotes 
                    ? `${currentNotes}\n${noteWithSet}`
                    : noteWithSet;

                  const res = await fetch(`${API_BASE}/workouts/${workout.workout.id}/exercises/${currentExercise.id}/notes`, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ notes: updatedNotes })
                  });
                  const data = await res.json();
                  
                  const updated = [...exercises];
                  updated[currentExerciseIdx].exercise_notes = data.exercise_notes;
                  setActiveWorkout({ ...workout, exercises: updated });
                  setNoteInput('');
                } catch (err) {
                  console.error('Failed to save note:', err);
                }
              }}
              className="save-note-btn"
              disabled={!noteInput.trim()}
            >
              Add Note (Set {loggedSets.length > 0 ? loggedSets.length : 1})
            </button>
            <button 
              onClick={async () => {
                if (!noteInput.trim()) return;
                const token = localStorage.getItem('ripfit_token');
                
                try {
                  const generalNote = `General: ${noteInput.trim()}`;
                  const currentNotes = currentExercise.exercise_notes || '';
                  const updatedNotes = currentNotes 
                    ? `${currentNotes}\n${generalNote}`
                    : generalNote;

                  const res = await fetch(`${API_BASE}/workouts/${workout.workout.id}/exercises/${currentExercise.id}/notes`, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ notes: updatedNotes })
                  });
                  const data = await res.json();
                  
                  const updated = [...exercises];
                  updated[currentExerciseIdx].exercise_notes = data.exercise_notes;
                  setActiveWorkout({ ...workout, exercises: updated });
                  setNoteInput('');
                } catch (err) {
                  console.error('Failed to save note:', err);
                }
              }}
              className="save-note-btn general-note-btn"
              disabled={!noteInput.trim()}
            >
              Add General Note
            </button>
          </div>
        </div>

        {isResting && (
          <div className="rest-timer">
            <div className="timer-display">{restSeconds}s</div>
            <button onClick={skipRest} className="skip-rest-btn">Skip Rest</button>
          </div>
        )}

        <div className={`set-form ${isResting ? 'resting' : ''}`}>
          <h4>Log Set {loggedSets.length + 1}</h4>
          <div className="form-row">
            <input
              type="number"
              placeholder="Reps"
              value={setForm.reps}
              onChange={(e) => setSetForm({...setForm, reps: e.target.value})}
            />
            <input
              type="number"
              step="0.1"
              placeholder="Weight (lbs)"
              value={setForm.weight}
              onChange={(e) => setSetForm({...setForm, weight: e.target.value})}
            />
            <input
              type="number"
              placeholder="RPE (optional)"
              min="1"
              max="11"
              value={setForm.rpe}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || (parseInt(val) >= 1 && parseInt(val) <= 11)) {
                  setSetForm({...setForm, rpe: val});
                }
              }}
            />
          </div>
          <button onClick={handleLogSet} className="log-set-btn">Complete Set</button>
        </div>

        <div className="exercise-nav">
          <button onClick={prevExercise} disabled={currentExerciseIdx === 0}>
            ← Previous
          </button>
          <button onClick={() => {
            if (loggedSets.length === 0 || window.confirm('Skip this exercise without completing all sets?')) {
              if (currentExerciseIdx < exercises.length - 1) {
                nextExercise();
              }
            }
          }} className="skip-exercise-btn">
            Skip Exercise
          </button>
          <button onClick={() => setShowAddExercise(true)} className="add-exercise-btn">
            + Add Exercise
          </button>
          <button onClick={nextExercise} disabled={currentExerciseIdx === exercises.length - 1}>
            Next →
          </button>
        </div>
      </div>

      {showAddExercise && (
        <AddExerciseModal 
          onAdd={handleAddExercise} 
          onClose={() => setShowAddExercise(false)}
        />
      )}

      {showToast && (
        <div className="success-toast">
          Exercise added!
        </div>
      )}

      {showWorkoutNotes && (
        <div className="modal-overlay" onClick={() => setShowWorkoutNotes(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Workout Notes</h3>
            {workout.previous_overall_notes && (
              <div className="previous-notes" style={{marginBottom: '12px'}}>
                <strong>Previous workout notes:</strong>
                <pre style={{marginTop: '6px', whiteSpace: 'pre-wrap', fontSize: '0.9em'}}>{workout.previous_overall_notes}</pre>
              </div>
            )}
            <p style={{fontSize: '0.9em', color: '#888', marginBottom: '10px'}}>
              Overall notes for this entire workout session
            </p>
            <textarea
              value={workoutNotes}
              onChange={(e) => { setWorkoutNotes(e.target.value); setWorkoutNotesSaved(false); }}
              placeholder="How's the workout going? Energy level, overall feel, things to remember..."
              rows="6"
              style={{width: '100%', padding: '10px', marginBottom: '10px'}}
            />
            <div style={{display: 'flex', gap: '8px', alignItems: 'stretch'}}>
              <button 
                onClick={async () => {
                  const token = localStorage.getItem('ripfit_token');
                  try {
                    await fetch(`${API_BASE}/workouts/${workout.workout.id}/notes`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({ overall_notes: workoutNotes })
                    });
                    setWorkoutNotesSaved(true);
                    setShowWorkoutNotes(false);
                  } catch (err) {
                    console.error('Failed to save workout notes:', err);
                  }
                }}
                className="save-note-btn"
                style={{flex: 1, padding: '12px', fontSize: '1em'}}
              >
                Save Workout Notes
              </button>
              <button 
                onClick={() => {
                  if (workoutNotes && !workoutNotesSaved) {
                    if (!confirm('You have unsaved workout notes. Exit without saving?')) return;
                  }
                  setShowWorkoutNotes(false);
                }}
                style={{padding: '12px 16px', fontSize: '0.85em', background: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangeExercise && (
        <ChangeExerciseModal
          onChange={handleChangeExercise}
          onClose={() => setShowChangeExercise(false)}
          currentExercise={currentExercise}
        />
      )}

      {showFinishConfirm && (() => {
        const incompleteExercises = exercises.filter(ex =>
          ex.template?.target_sets && (ex.logged_sets?.length || 0) < ex.template.target_sets
        );
        const scale = ratingPrefs.scale || 5;
        const ticks = Array.from({ length: scale }, (_, i) => i + 1);

        return (
          <div className="modal-overlay" onClick={() => setShowFinishConfirm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Finish Workout</h3>

              {/* Warning only shown when sets/exercises were missed */}
              {incompleteExercises.length > 0 && (
                <div className="incomplete-warning">
                  <p><strong>⚠️ Incomplete exercises:</strong></p>
                  {incompleteExercises.map((ex, idx) => (
                    <div key={idx} className="incomplete-item">
                      <span>{ex.exercise_name}</span>
                      <span>{ex.logged_sets?.length || 0} / {ex.template.target_sets} sets</span>
                      <button
                        onClick={() => {
                          const exerciseIdx = exercises.findIndex(e => e.id === ex.id);
                          setCurrentExerciseIdx(exerciseIdx);
                          setShowFinishConfirm(false);
                        }}
                        style={{ padding: '4px 8px', fontSize: '0.85em' }}
                      >
                        Go to
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes + Rating on one screen */}
              <div style={{ marginTop: '15px' }}>
                <h4>Workout Notes (optional)</h4>
                <textarea
                  value={workoutNotes}
                  onChange={(e) => setWorkoutNotes(e.target.value)}
                  placeholder="How was the workout overall?"
                  rows="3"
                  style={{ width: '100%', padding: '10px', marginBottom: '16px', boxSizing: 'border-box' }}
                />
              </div>

              <div className="session-rating-widget">
                <div className="session-rating-header">
                  <span className="session-rating-label">{ratingPrefs.label}</span>
                </div>
                {ratingPrefs.display === 'stars' ? (
                  <div className="session-rating-stars">
                    {ticks.map(v => (
                      <button
                        key={v}
                        className={`star-btn ${pendingRating >= v ? 'active' : ''}`}
                        onClick={() => setPendingRating(v)}
                        aria-label={`Rate ${v} out of ${scale}`}
                      >★</button>
                    ))}
                  </div>
                ) : ratingPrefs.display === 'number' ? (
                  <div className="session-rating-numbers">
                    {ticks.map(v => (
                      <button
                        key={v}
                        className={`number-btn ${pendingRating === v ? 'active' : ''}`}
                        onClick={() => setPendingRating(v)}
                      >{v}</button>
                    ))}
                  </div>
                ) : (
                  <div className="session-rating-slider-wrap">
                    <input
                      type="range"
                      min={1}
                      max={scale}
                      step={1}
                      value={pendingRating || Math.ceil(scale / 2)}
                      className="session-rating-slider"
                      onChange={e => setPendingRating(parseInt(e.target.value))}
                    />
                    <div className="session-rating-ticks">
                      <span>1</span>
                      <span>{Math.ceil(scale / 2)}</span>
                      <span>{scale}</span>
                    </div>
                    {pendingRating && (
                      <div className="session-rating-value">{pendingRating} / {scale}</div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  onClick={handleFinishClick}
                  className="finish-btn"
                  style={{ flex: 1, padding: '12px' }}
                >
                  {incompleteExercises.length > 0 ? 'Finish Anyway' : 'Finish Workout'}
                </button>
                <button
                  onClick={() => setShowFinishConfirm(false)}
                  style={{ padding: '12px 16px', background: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Go Back
                </button>
              </div>
              <div style={{ textAlign: 'center', marginTop: '12px' }}>
                <button
                  onClick={() => { setShowFinishConfirm(false); setShowCancelConfirm(true); }}
                  style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '0.8em', cursor: 'pointer', textDecoration: 'underline', padding: '4px' }}
                >
                  Cancel Workout
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showCancelConfirm && (
        <div className="modal-overlay" onClick={() => setShowCancelConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Cancel Workout?</h3>
            <p>This action will log workout progress and cancel your current workout.</p>
            <div style={{display: 'flex', gap: '8px', marginTop: '15px'}}>
              <button
                onClick={() => {
                  onCancel();
                  setShowCancelConfirm(false);
                }}
                className="cancel-workout-btn"
                style={{flex: 1, padding: '12px'}}
              >
                Yes, Cancel Workout
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                style={{padding: '12px 16px', background: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
              >
                Keep Going
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveToRoutinePrompt && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Save additions to routine?</h3>
            <p style={{fontSize: '0.88em', color: '#888'}}>
              You added these exercises during this workout. Save any to the routine for next time, or leave unchecked to keep this workout-only.
            </p>
            <div className="ad-hoc-choice-list">
              {adHocExercises.map(ex => (
                <label key={ex.id} className="ad-hoc-choice-row">
                  <input
                    type="checkbox"
                    checked={!!adHocChoices[ex.id]}
                    onChange={e => setAdHocChoices(prev => ({ ...prev, [ex.id]: e.target.checked }))}
                  />
                  {ex.exercise_name}
                </label>
              ))}
            </div>
            <div style={{display: 'flex', gap: '8px', marginTop: '14px'}}>
              <button onClick={finalizeFinish} disabled={savingToRoutine} className="finish-btn" style={{flex: 1, padding: '12px'}}>
                {savingToRoutine ? 'Saving...' : 'Finish Workout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAllExercises && (
        <div className="modal-overlay" onClick={() => setShowAllExercises(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>All Exercises</h3>
            <div className="exercises-list">
              {exercises.map((ex, idx) => (
                <div 
                  key={ex.id} 
                  className={`exercise-list-item ${idx === currentExerciseIdx ? 'active' : ''}`}
                  onClick={() => { setCurrentExerciseIdx(idx); setShowAllExercises(false); }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="exercise-info">
                    <strong>
                      {ex.exercise_name}
                      {ex.exercise_notes && <span className="notes-indicator" title="Has notes">📝</span>}
                    </strong>
                    <span>{ex.logged_sets?.length || 0} / {ex.template?.target_sets || '?'} sets</span>
                  </div>
                  <div className="exercise-controls" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => moveExercise(idx, idx - 1)} disabled={idx === 0}>↑</button>
                    <button onClick={() => moveExercise(idx, idx + 1)} disabled={idx === exercises.length - 1}>↓</button>
                    <button onClick={() => { setCurrentExerciseIdx(idx); setShowAllExercises(false); }}>Go</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowAllExercises(false)} className="close-btn">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Maps a muscle-filter pill value to the category/subcategory pair the
// backend expects. Shared by AddExerciseModal and ChangeExerciseModal.
function mapMuscleFilterToCategory(value) {
  if (value === 'biceps') return { category: 'Arms', subcategory: 'Biceps' };
  if (value === 'triceps') return { category: 'Arms', subcategory: 'Triceps' };
  if (value === 'arms') return { category: 'Arms', subcategory: '' };
  return { category: value.charAt(0).toUpperCase() + value.slice(1), subcategory: '' };
}

// Shared page size for exercise results in both modals below.
const RESULTS_LIMIT = 100;

// Fetches one page of exercises. Uses the search endpoint when there's typed
// text (optionally combined with a category/subcategory), otherwise the
// browse endpoint. Shared by AddExerciseModal and ChangeExerciseModal so
// paging logic only needs to be correct in one place.
async function fetchExercisePage({ q, category, subcategory, equipment, offset = 0, token }) {
  const params = new URLSearchParams({ limit: RESULTS_LIMIT, offset });
  let url, headers = {};
  if (q) {
    params.set('q', q);
    if (category) params.set('category', category);
    if (subcategory) params.set('subcategory', subcategory);
    if (equipment) params.set('equipment', equipment);
    url = `${API_BASE}/workouts/exercises/search?${params}`;
  } else {
    if (category) params.set('category', category);
    if (subcategory) params.set('subcategory', subcategory);
    if (equipment) params.set('equipment', equipment);
    url = `${API_BASE}/workouts/exercises/browse?${params}`;
    headers = { Authorization: `Bearer ${token}` };
  }
  const res = await fetch(url, { headers });
  const data = await res.json();
  return { exercises: data.exercises || [], total: data.total ?? (data.exercises || []).length };
}

// Same equipment list used in ExerciseBrowser.jsx, kept in sync with it.
const EQUIPMENT_OPTIONS = ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Kettlebell', 'Bodyweight', 'Resistance Band', 'Pull-up bar', 'EZ Bar'];

function EquipmentFilterBar({ equipmentFilter, setEquipmentFilter }) {
  return (
    <div className="filter-box">
      <label>Filter by equipment:</label>
      <div className="muscle-filter-pills">
        {['', ...EQUIPMENT_OPTIONS].map(equip => (
          <button
            key={equip || 'all'}
            className={`filter-pill ${equipmentFilter === equip ? 'active' : ''}`}
            onClick={() => setEquipmentFilter(equip)}
          >
            {equip === '' ? 'All' : equip}
          </button>
        ))}
      </div>
    </div>
  );
}

function MuscleFilterBar({ muscleFilter, setMuscleFilter }) {
  const [armsExpanded, setArmsExpanded] = useState(false);

  const handleSelect = (value) => {
    setMuscleFilter(value);
    if (value !== 'arms' && value !== 'biceps' && value !== 'triceps') {
      setArmsExpanded(false);
    }
  };

  const isActive = (value) => muscleFilter === value;

  return (
    <div className="filter-box">
      <label>Filter by muscle:</label>
      <div className="muscle-filter-pills">
        {['', 'chest', 'back', 'shoulders', 'legs', 'abs', 'cardio'].map(cat => (
          <button
            key={cat || 'all'}
            className={`filter-pill ${isActive(cat) ? 'active' : ''}`}
            onClick={() => handleSelect(cat)}
          >
            {cat === '' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
        {/* Arms pill with expand toggle */}
        <button
          className={`filter-pill ${(isActive('arms') || isActive('biceps') || isActive('triceps')) ? 'active' : ''}`}
          onClick={() => {
            setArmsExpanded(prev => !prev);
            if (!armsExpanded) handleSelect('arms');
          }}
        >
          Arms {armsExpanded ? '▾' : '▸'}
        </button>
        {armsExpanded && (
          <>
            <button
              className={`filter-pill filter-pill-sub ${isActive('biceps') ? 'active' : ''}`}
              onClick={() => handleSelect('biceps')}
            >
              ↳ Biceps
            </button>
            <button
              className={`filter-pill filter-pill-sub ${isActive('triceps') ? 'active' : ''}`}
              onClick={() => handleSelect('triceps')}
            >
              ↳ Triceps
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddExerciseModal({ onAdd, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [targets, setTargets] = useState({ sets: '', reps: '', weight: '' });
  const [muscleFilter, setMuscleFilter] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState('');
  const [showMuscleFilters, setShowMuscleFilters] = useState(false);
  const [showEquipmentFilters, setShowEquipmentFilters] = useState(false);

  const token = localStorage.getItem('ripfit_token');

  // Fetches a page and either replaces or appends to the current results.
  const runSearch = async ({ category, subcategory, equipment, offset = 0, append = false } = {}) => {
    try {
      const { exercises, total } = await fetchExercisePage({
        q: searchQuery.trim(), category, subcategory, equipment, offset, token
      });
      setSearchOffset(offset);
      setSearchTotal(total);
      setSearchResults(prev => append ? [...prev, ...exercises] : exercises);
    } catch (err) {
      console.error('Exercise fetch failed:', err);
    }
  };

  const searchExercises = async () => {
    if (!searchQuery.trim()) return;
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    await runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: equipmentFilter });
  };

  const browseByMuscleFilter = async (value) => {
    setMuscleFilter(value);
    if (!value && !equipmentFilter) {
      if (searchQuery.trim()) await runSearch({});
      else { setSearchResults([]); setSearchTotal(0); }
      return;
    }
    const { category, subcategory } = value ? mapMuscleFilterToCategory(value) : {};
    await runSearch({ category, subcategory, equipment: equipmentFilter });
  };

  const browseByEquipmentFilter = async (value) => {
    setEquipmentFilter(value);
    if (!value && !muscleFilter) {
      if (searchQuery.trim()) await runSearch({});
      else { setSearchResults([]); setSearchTotal(0); }
      return;
    }
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    await runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: value });
  };

  const loadMoreResults = () => {
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: equipmentFilter, offset: searchOffset + RESULTS_LIMIT, append: true });
  };

  // Clears the typed text but keeps any active muscle/equipment filter —
  // falls back to a plain browse of whatever filter is still selected.
  const clearSearch = () => {
    setSearchQuery('');
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    if (filter.category || filter.subcategory || equipmentFilter) {
      runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: equipmentFilter });
    } else {
      setSearchResults([]);
      setSearchTotal(0);
    }
  };

  const handleSelectExercise = (exercise) => {
    setSelectedExercise(exercise);
  };

  const handleAddExercise = () => {
    onAdd(selectedExercise, targets);
    setSelectedExercise(null);
    setTargets({ sets: '', reps: '', weight: '' });
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {!selectedExercise ? (
          <>
            <h3>Add Exercise</h3>
            <div className="search-box">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  placeholder="Search exercises..."
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && searchExercises()}
                />
                {searchQuery && (
                  <button type="button" className="search-clear-x" onClick={clearSearch}>✕</button>
                )}
              </div>
              <button onClick={searchExercises}>Search</button>
            </div>
            
            <div className="filter-box">
              <div className="muscle-filter-pills">
                <button
                  className={`filter-pill ${showMuscleFilters ? 'active' : ''}`}
                  onClick={() => setShowMuscleFilters(v => !v)}
                >
                  Muscle {showMuscleFilters ? '▾' : '▸'}
                </button>
                <button
                  className={`filter-pill ${showEquipmentFilters ? 'active' : ''}`}
                  onClick={() => setShowEquipmentFilters(v => !v)}
                >
                  Equipment {showEquipmentFilters ? '▾' : '▸'}
                </button>
              </div>
            </div>
            {showMuscleFilters && (
              <MuscleFilterBar muscleFilter={muscleFilter} setMuscleFilter={browseByMuscleFilter} />
            )}
            {showEquipmentFilters && (
              <EquipmentFilterBar equipmentFilter={equipmentFilter} setEquipmentFilter={browseByEquipmentFilter} />
            )}

            <div className="search-results">
              {searchResults.map(ex => (
                <div key={ex.id} className="result-item" onClick={() => handleSelectExercise(ex)}>
                  <strong>{ex.name}</strong>
                  <span>{ex.category}{ex.subcategory ? ` › ${ex.subcategory}` : ''} • {ex.equipment_type}</span>
                </div>
              ))}
              {searchResults.length < searchTotal && (
                <button className="load-more-btn" onClick={loadMoreResults}>
                  Load more ({searchTotal - searchResults.length} remaining)
                </button>
              )}
            </div>
            <button onClick={onClose} className="close-btn">Close</button>
          </>
        ) : (
          <>
            <h3>Set Targets (Optional)</h3>
            <p><strong>{selectedExercise.name}</strong></p>
            <div className="target-form">
              {selectedExercise.category === 'Cardio' ? (
                <>
                  <input
                    type="number"
                    placeholder="Goal Duration (minutes, optional)"
                    value={targets.duration || ''}
                    onChange={(e) => setTargets({ ...targets, duration: e.target.value })}
                  />
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Goal Distance (optional)"
                    value={targets.distance || ''}
                    onChange={(e) => setTargets({ ...targets, distance: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={targets.notes || ''}
                    onChange={(e) => setTargets({ ...targets, notes: e.target.value })}
                  />
                </>
              ) : (
                <>
                  <input
                    type="number"
                    placeholder="Target Sets (optional)"
                    value={targets.sets}
                    onChange={(e) => setTargets({ ...targets, sets: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Target Reps (optional)"
                    value={targets.reps}
                    onChange={(e) => setTargets({ ...targets, reps: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Weight (BW, 0, - for bodyweight)"
                    value={targets.weight}
                    onChange={(e) => setTargets({ ...targets, weight: e.target.value })}
                  />
                </>
              )}
            </div>
            <button onClick={handleAddExercise} className="add-btn">Add Exercise</button>
            <button onClick={() => setSelectedExercise(null)} className="back-btn">Back</button>
          </>
        )}
      </div>
    </div>
  );
}

function ChangeExerciseModal({ onChange, onClose, currentExercise }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [reason, setReason] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('');
  const [equipmentFilter, setEquipmentFilter] = useState('');
  const [showMuscleFilters, setShowMuscleFilters] = useState(false);
  const [showEquipmentFilters, setShowEquipmentFilters] = useState(false);
  const [targets, setTargets] = useState({
    sets: currentExercise?.template?.target_sets || '',
    reps: currentExercise?.template?.target_reps || '',
    weight: ''
  });

  const token = localStorage.getItem('ripfit_token');

  const runSearch = async ({ category, subcategory, equipment, offset = 0, append = false } = {}) => {
    try {
      const { exercises, total } = await fetchExercisePage({
        q: searchQuery.trim(), category, subcategory, equipment, offset, token
      });
      setSearchOffset(offset);
      setSearchTotal(total);
      setSearchResults(prev => append ? [...prev, ...exercises] : exercises);
    } catch (err) {
      console.error('Exercise fetch failed:', err);
    }
  };

  const searchExercises = async () => {
    if (!searchQuery.trim()) return;
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    await runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: equipmentFilter });
  };

  const browseByMuscleFilter = async (value) => {
    setMuscleFilter(value);
    if (!value && !equipmentFilter) {
      if (searchQuery.trim()) await runSearch({});
      else { setSearchResults([]); setSearchTotal(0); }
      return;
    }
    const { category, subcategory } = value ? mapMuscleFilterToCategory(value) : {};
    await runSearch({ category, subcategory, equipment: equipmentFilter });
  };

  const browseByEquipmentFilter = async (value) => {
    setEquipmentFilter(value);
    if (!value && !muscleFilter) {
      if (searchQuery.trim()) await runSearch({});
      else { setSearchResults([]); setSearchTotal(0); }
      return;
    }
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    await runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: value });
  };

  const loadMoreResults = () => {
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: equipmentFilter, offset: searchOffset + RESULTS_LIMIT, append: true });
  };

  const clearSearch = () => {
    setSearchQuery('');
    const filter = muscleFilter ? mapMuscleFilterToCategory(muscleFilter) : {};
    if (filter.category || filter.subcategory || equipmentFilter) {
      runSearch({ category: filter.category, subcategory: filter.subcategory, equipment: equipmentFilter });
    } else {
      setSearchResults([]);
      setSearchTotal(0);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {!selectedExercise ? (
          <>
            <h3>Change Exercise</h3>
            <div className="search-box">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  placeholder="Search for replacement..."
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && searchExercises()}
                />
                {searchQuery && (
                  <button type="button" className="search-clear-x" onClick={clearSearch}>✕</button>
                )}
              </div>
              <button onClick={searchExercises}>Search</button>
            </div>
            
            <div className="filter-box">
              <div className="muscle-filter-pills">
                <button
                  className={`filter-pill ${showMuscleFilters ? 'active' : ''}`}
                  onClick={() => setShowMuscleFilters(v => !v)}
                >
                  Muscle {showMuscleFilters ? '▾' : '▸'}
                </button>
                <button
                  className={`filter-pill ${showEquipmentFilters ? 'active' : ''}`}
                  onClick={() => setShowEquipmentFilters(v => !v)}
                >
                  Equipment {showEquipmentFilters ? '▾' : '▸'}
                </button>
              </div>
            </div>
            {showMuscleFilters && (
              <MuscleFilterBar muscleFilter={muscleFilter} setMuscleFilter={browseByMuscleFilter} />
            )}
            {showEquipmentFilters && (
              <EquipmentFilterBar equipmentFilter={equipmentFilter} setEquipmentFilter={browseByEquipmentFilter} />
            )}
            
            <div className="search-results">
              {searchResults.map(ex => (
                <div key={ex.id} className="result-item" onClick={() => setSelectedExercise(ex)}>
                  <strong>{ex.name}</strong>
                  <span>{ex.category}{ex.subcategory ? ` › ${ex.subcategory}` : ''} • {ex.equipment_type}</span>
                </div>
              ))}
              {searchResults.length < searchTotal && (
                <button className="load-more-btn" onClick={loadMoreResults}>
                  Load more ({searchTotal - searchResults.length} remaining)
                </button>
              )}
            </div>
            <button onClick={onClose} className="close-btn">Cancel</button>
          </>
        ) : (
          <>
            <h3>Reason for Change (Optional)</h3>
            <p><strong>Replacing: {currentExercise?.exercise_name}</strong></p>
            {currentExercise?.template && (
              <div className="original-targets" style={{background: '#f5f5f5', padding: '8px 12px', borderRadius: '4px', marginBottom: '12px', fontSize: '0.9em', color: '#555'}}>
                <strong>Original targets:</strong> {currentExercise.template.target_sets || '?'} sets × {currentExercise.template.target_reps || '?'} reps @ {currentExercise.template.target_weight ? `${currentExercise.template.target_weight} lbs` : 'BW'}
              </div>
            )}
            <p><strong>Replacing with: {selectedExercise.name}</strong></p>
            
            <div className="targets-input">
              <h4>Target Sets/Reps/Weight</h4>
              <div className="target-fields">
                <input
                  type="number"
                  placeholder="Sets"
                  value={targets.sets}
                  onChange={(e) => setTargets({ ...targets, sets: e.target.value })}
                />
                <input
                  type="number"
                  placeholder="Reps"
                  value={targets.reps}
                  onChange={(e) => setTargets({ ...targets, reps: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Weight (or BW)"
                  value={targets.weight}
                  onChange={(e) => setTargets({ ...targets, weight: e.target.value })}
                />
              </div>
            </div>
            
            <textarea
              placeholder="E.g., shoulder pain, equipment unavailable..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows="4"
              className="reason-textarea"
            />
            <button onClick={() => onChange(selectedExercise, reason, targets)} className="add-btn">
              Confirm Change
            </button>
            <button onClick={() => setSelectedExercise(null)} className="back-btn">Back</button>
          </>
        )}
      </div>
    </div>
  );
}
