import { useState, useEffect } from 'react';
import './ActiveWorkout.css';

const API_BASE = 'http://localhost:3000/api/v1';

export default function ActiveWorkout() {
  const [token, setToken] = useState(localStorage.getItem('ripfit_token'));
  const [routines, setRoutines] = useState([]);
  const [selectedRoutine, setSelectedRoutine] = useState(null);
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [loading, setLoading] = useState(false);
  const [workoutSummary, setWorkoutSummary] = useState(null);

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

  const startWorkout = async (routineId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/routines/${routineId}/start-workout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workout_date: new Date().toISOString().split('T')[0]
        })
      });
      const data = await res.json();
      setActiveWorkout(data);
      setSelectedRoutine(null);
    } catch (err) {
      console.error('Failed to start workout:', err);
      alert('Failed to start workout');
    }
    setLoading(false);
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

  const finishWorkout = async (workoutNotes) => {
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

      // Build summary data before clearing workout
      const duration = Math.round((Date.now() - new Date(activeWorkout.workout.start_time).getTime()) / 60000);
      setWorkoutSummary({
        routine_name: activeWorkout.routine_name,
        duration_minutes: Math.round((Date.now() - new Date(activeWorkout.workout.start_time).getTime()) / 60000),
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

          <button 
            onClick={() => setWorkoutSummary(null)} 
            className="finish-btn"
            style={{width: '100%', padding: '14px', fontSize: '1.1em', marginTop: '20px'}}
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
    />;
  }

  return (
    <div className="workout-container">
      <h2>Start Workout</h2>
      
      <div className="routines-list">
        {routines.length === 0 ? (
          <p>No routines yet. Create one first!</p>
        ) : (
          routines.map(routine => (
            <div key={routine.id} className="routine-card">
              <h3>{routine.name}</h3>
              <p>{routine.exercise_count} exercises</p>
              <button 
                onClick={() => startWorkout(routine.id)}
                disabled={loading}
              >
                Start Workout
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WorkoutInProgress({ workout, setActiveWorkout, onLogSet, onFinish }) {
  const [currentExerciseIdx, setCurrentExerciseIdx] = useState(0);
  const [setForm, setSetForm] = useState({ reps: '', weight: '', rpe: '' });
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [showChangeExercise, setShowChangeExercise] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [restTimer, setRestTimer] = useState(null);
  const [restSeconds, setRestSeconds] = useState(0);
  const [showAllExercises, setShowAllExercises] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [editNotesText, setEditNotesText] = useState('');
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [showWorkoutNotes, setShowWorkoutNotes] = useState(false);
  const [workoutNotesSaved, setWorkoutNotesSaved] = useState(true);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);

  const exercises = workout.exercises;
  const currentExercise = exercises[currentExerciseIdx];

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
    if (editingNotes) {
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
    // Pre-fill from last set, or from template if first set
    const defaultWeight = loggedSets.length > 0 
      ? loggedSets[loggedSets.length - 1].weight_used 
      : currentExercise.template?.target_weight || '';
    
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

    // Clear any existing timer before starting new one
    if (restTimer) {
      clearInterval(restTimer);
    }

    // Start rest timer (60 seconds default)
    const restDuration = 60;
    setRestSeconds(restDuration);
    
    const timer = setInterval(() => {
      setRestSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setRestTimer(null);
          if (navigator.vibrate) navigator.vibrate(200);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    setRestTimer(timer);

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
    if (restTimer) {
      clearInterval(restTimer);
      setRestTimer(null);
      setRestSeconds(0);
    }
  };

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

  return (
    <div className="workout-container">
      <div className="workout-header">
        <h2>{workout.routine_name}</h2>
        <div className="header-buttons">
          <button onClick={() => setShowWorkoutNotes(true)} className="workout-notes-btn">
            Workout Notes {workoutNotes ? '📝' : ''}
          </button>
          <button onClick={() => setShowAllExercises(true)} className="view-all-btn">View All</button>
          <button onClick={() => setShowFinishConfirm(true)} className="finish-btn">Finish Workout</button>
        </div>
      </div>

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

        {restTimer && restSeconds > 0 && (
          <div className="rest-timer">
            <div className="timer-display">{restSeconds}s</div>
            <button onClick={skipRest} className="skip-rest-btn">Skip Rest</button>
          </div>
        )}

        <div className={`set-form ${restTimer ? 'resting' : ''}`}>
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
        
        return (
          <div className="modal-overlay" onClick={() => setShowFinishConfirm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Finish Workout</h3>
              
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
                        style={{padding: '4px 8px', fontSize: '0.85em'}}
                      >
                        Go to
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{marginTop: '15px'}}>
                <h4>Workout Notes (optional)</h4>
                <textarea
                  value={workoutNotes}
                  onChange={(e) => setWorkoutNotes(e.target.value)}
                  placeholder="How was the workout overall?"
                  rows="4"
                  style={{width: '100%', padding: '10px', marginBottom: '10px'}}
                />
              </div>

              <div style={{display: 'flex', gap: '8px'}}>
                <button 
                  onClick={() => {
                    onFinish(workoutNotes);
                    setShowFinishConfirm(false);
                  }}
                  className="finish-btn"
                  style={{flex: 1, padding: '12px'}}
                >
                  {incompleteExercises.length > 0 ? 'Finish Anyway' : 'Finish Workout'}
                </button>
                <button 
                  onClick={() => setShowFinishConfirm(false)}
                  style={{padding: '12px 16px', background: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

function AddExerciseModal({ onAdd, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [targets, setTargets] = useState({ sets: '', reps: '', weight: '' });
  const [muscleFilter, setMuscleFilter] = useState('');

  const searchExercises = async () => {
    if (!searchQuery) return;
    try {
      const res = await fetch(`${API_BASE}/workouts/exercises/search?q=${searchQuery}`);
      const data = await res.json();
      setSearchResults(data.exercises || []);
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const filteredResults = muscleFilter 
    ? searchResults.filter(ex => ex.category?.toLowerCase().includes(muscleFilter.toLowerCase()))
    : searchResults;

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
              <input
                type="text"
                placeholder="Search exercises..."
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchExercises()}
              />
              <button onClick={searchExercises}>Search</button>
            </div>
            
            {searchResults.length > 0 && (
              <div className="filter-box">
                <label>Filter by muscle:</label>
                <select value={muscleFilter} onChange={(e) => setMuscleFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="chest">Chest</option>
                  <option value="back">Back</option>
                  <option value="shoulders">Shoulders</option>
                  <option value="arms">Arms</option>
                  <option value="legs">Legs</option>
                  <option value="abs">Abs</option>
                  <option value="cardio">Cardio</option>
                </select>
              </div>
            )}

            <div className="search-results">
              {filteredResults.map(ex => (
                <div key={ex.id} className="result-item" onClick={() => handleSelectExercise(ex)}>
                  <strong>{ex.name}</strong>
                  <span>{ex.category} • {ex.equipment_type}</span>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="close-btn">Close</button>
          </>
        ) : (
          <>
            <h3>Set Targets (Optional)</h3>
            <p><strong>{selectedExercise.name}</strong></p>
            <div className="target-form">
              <input
                type="number"
                placeholder="Target Sets (optional)"
                value={targets.sets}
                onChange={(e) => setTargets({...targets, sets: e.target.value})}
              />
              <input
                type="number"
                placeholder="Target Reps (optional)"
                value={targets.reps}
                onChange={(e) => setTargets({...targets, reps: e.target.value})}
              />
              <input
                type="text"
                placeholder="Weight (BW, 0, - for bodyweight)"
                value={targets.weight}
                onChange={(e) => setTargets({...targets, weight: e.target.value})}
              />
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
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [reason, setReason] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('');
  const [targets, setTargets] = useState({
    sets: currentExercise?.template?.target_sets || '',
    reps: currentExercise?.template?.target_reps || '',
    weight: ''
  });

  const searchExercises = async () => {
    if (!searchQuery) return;
    try {
      const res = await fetch(`${API_BASE}/workouts/exercises/search?q=${searchQuery}`);
      const data = await res.json();
      setSearchResults(data.exercises || []);
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const filteredResults = muscleFilter 
    ? searchResults.filter(ex => ex.category?.toLowerCase().includes(muscleFilter.toLowerCase()))
    : searchResults;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {!selectedExercise ? (
          <>
            <h3>Change Exercise</h3>
            <div className="search-box">
              <input
                type="text"
                placeholder="Search for replacement..."
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchExercises()}
              />
              <button onClick={searchExercises}>Search</button>
            </div>
            
            {searchResults.length > 0 && (
              <div className="filter-box">
                <label>Filter by muscle:</label>
                <select value={muscleFilter} onChange={(e) => setMuscleFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="chest">Chest</option>
                  <option value="back">Back</option>
                  <option value="shoulders">Shoulders</option>
                  <option value="arms">Arms</option>
                  <option value="legs">Legs</option>
                  <option value="abs">Abs</option>
                  <option value="cardio">Cardio</option>
                </select>
              </div>
            )}
            
            <div className="search-results">
              {filteredResults.map(ex => (
                <div key={ex.id} className="result-item" onClick={() => setSelectedExercise(ex)}>
                  <strong>{ex.name}</strong>
                  <span>{ex.category} • {ex.equipment_type}</span>
                </div>
              ))}
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