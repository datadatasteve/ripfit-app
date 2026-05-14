import { useState, useEffect } from 'react';
import './ActiveWorkout.css';
 
const API_BASE = 'http://localhost:3000/api/v1';
 
export default function ActiveWorkout() {
  const [token, setToken] = useState(localStorage.getItem('ripfit_token'));
  const [routines, setRoutines] = useState([]);
  const [selectedRoutine, setSelectedRoutine] = useState(null);
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [loading, setLoading] = useState(false);
 
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
 
  const finishWorkout = async () => {
    try {
      await fetch(`${API_BASE}/workouts/${activeWorkout.workout.id}/finish`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      alert('Workout completed!');
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
  const [showToast, setShowToast] = useState(false);
  const [restTimer, setRestTimer] = useState(null);
  const [restSeconds, setRestSeconds] = useState(0);
 
  const exercises = workout.exercises;
  const currentExercise = exercises[currentExerciseIdx];
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
  }, [currentExerciseIdx, loggedSets.length]);
 
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
 
  const handleLogSet = () => {
    if (!setForm.reps) {
      alert('Enter reps');
      return;
    }
 
    // Handle bodyweight indicators
    let weightValue = setForm.weight;
    if (!weightValue || ['BW', '0', '-'].includes(weightValue.toString().toUpperCase())) {
      weightValue = 0;
    }
 
    onLogSet(currentExerciseIdx, {
      set_number: loggedSets.length + 1,
      reps_completed: parseInt(setForm.reps),
      weight_used: parseFloat(weightValue),
      rpe: setForm.rpe ? parseInt(setForm.rpe) : null
    });
 
    // Start rest timer (60 seconds default)
    const restDuration = 60;
    setRestSeconds(restDuration);
    
    const timer = setInterval(() => {
      setRestSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setRestTimer(null);
          // Play sound/vibrate
          if (navigator.vibrate) navigator.vibrate(200);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    setRestTimer(timer);
 
    // Auto-progress if target sets reached
    if (loggedSets.length + 1 >= targetSets && currentExerciseIdx < exercises.length - 1) {
      setTimeout(() => nextExercise(), 500);
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
 
  const nextExercise = () => {
    if (currentExerciseIdx < exercises.length - 1) {
      setCurrentExerciseIdx(currentExerciseIdx + 1);
      setSetForm({ reps: '', weight: '', rpe: '' });
    }
  };
 
  const prevExercise = () => {
    if (currentExerciseIdx > 0) {
      setCurrentExerciseIdx(currentExerciseIdx - 1);
    }
  };
 
  return (
    <div className="workout-container">
      <div className="workout-header">
        <h2>{workout.routine_name}</h2>
        <button onClick={onFinish} className="finish-btn">Finish Workout</button>
      </div>
 
      <div className="exercise-progress">
        Exercise {currentExerciseIdx + 1} of {exercises.length}
      </div>
 
      <div className="current-exercise">
        <h3>{currentExercise.exercise_name}</h3>
        <p className="category">{currentExercise.category} • {currentExercise.equipment_type}</p>
 
        {currentExercise.template && (
          <div className="template-info">
            <strong>Target:</strong> {currentExercise.template.target_sets} sets × {currentExercise.template.target_reps} reps @ {currentExercise.template.target_weight} lbs
          </div>
        )}
 
        {currentExercise.last_performance && (
          <div className="last-performance">
            <strong>Last time ({new Date(workout.last_workout_date).toLocaleDateString()}):</strong>
            <div className="sets-history">
              {currentExercise.last_performance.sets_completed.map((set, idx) => (
                <span key={idx} className="set-pill">
                  {set.reps} × {set.weight} lbs {set.rpe ? `@ ${set.rpe}` : ''}
                </span>
              ))}
            </div>
            {currentExercise.last_performance.exercise_notes && (
              <p className="notes-warning">⚠️ {currentExercise.last_performance.exercise_notes}</p>
            )}
          </div>
        )}
 
        <div className="logged-sets">
          <h4>Sets Logged:</h4>
          {loggedSets.length === 0 ? (
            <p>No sets yet</p>
          ) : (
            loggedSets.map((set, idx) => (
              <div key={idx} className="set-entry">
                Set {set.set_number}: {set.reps_completed} reps × {set.weight_used === 0 ? 'BW' : `${set.weight_used} lbs`}
                {set.rpe && ` @ RPE ${set.rpe}`}
              </div>
            ))
          )}
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
              max="10"
              value={setForm.rpe}
              onChange={(e) => setSetForm({...setForm, rpe: e.target.value})}
            />
          </div>
          <button onClick={handleLogSet} className="log-set-btn">Complete Set</button>
        </div>
 
        <div className="exercise-nav">
          <button onClick={prevExercise} disabled={currentExerciseIdx === 0}>
            ← Previous
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
    setSearchResults([]);
  };
 
  const handleAddExercise = () => {
    onAdd(selectedExercise, targets);
    setSelectedExercise(null);
    setTargets({ sets: '', reps: '', weight: '' });
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