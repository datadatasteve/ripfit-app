import { useState, useEffect } from 'react';
import { formatTempo } from './RoutineExerciseExtras';
import { repRangeOf, supersetLabel } from '../utils/repRange';
import './RoutineDetail.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

/**
 * Read-only routine page (Patch 001): every exercise with its targets, rep
 * range, rest, tempo and superset badge, plus Start and Edit. Edit is blocked
 * while a workout from this routine is in progress.
 */
export default function RoutineDetail({ routineId, activeWorkout, onBack, onEdit, onStart, starting }) {
  const [routine, setRoutine] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setRoutine(null);
    setError('');
    fetch(`${API_BASE}/routines/${routineId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}` },
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Failed to load routine'))))
      .then(setRoutine)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [routineId]);

  const workoutInProgress = !!activeWorkout && String(activeWorkout.workout?.routine_id) === String(routineId);

  return (
    <div className="routine-detail">
      <div className="aw-hub-back-bar">
        <button className="aw-hub-back-btn" onClick={onBack}>← Workouts</button>
      </div>

      {error && <p className="routine-detail-error">{error}</p>}
      {!routine && !error && <p className="routine-detail-muted">Loading…</p>}

      {routine && (
        <>
          <div className="routine-detail-head">
            <div>
              <h2>{routine.name}</h2>
              {routine.description && <p className="routine-detail-muted">{routine.description}</p>}
            </div>
            <div className="routine-detail-actions">
              <button className="routine-detail-start" onClick={() => onStart(routine.id)} disabled={starting}>
                Start Workout
              </button>
              <button
                className="routine-detail-edit"
                onClick={() => onEdit(routine)}
                disabled={workoutInProgress}
                title={workoutInProgress ? 'Finish or cancel the workout in progress to edit this routine' : 'Edit routine'}
              >
                Edit
              </button>
            </div>
          </div>
          {workoutInProgress && (
            <p className="routine-detail-warning">A workout from this routine is in progress — finish or cancel it to edit.</p>
          )}

          <ol className="routine-detail-list">
            {routine.exercises.map(ex => {
              const reps = repRangeOf(ex);
              const tempo = formatTempo(ex.tempo_eccentric, ex.tempo_pause, ex.tempo_concentric);
              // "3 sets × 10–12 reps @ 135"
              const volume = [
                ex.target_sets ? `${ex.target_sets} sets` : null,
                reps ? `${reps} reps` : null,
              ].filter(Boolean).join(' × ');
              const weight = ex.target_weight ? `@ ${parseFloat(ex.target_weight)}` : '';
              const targets = [volume, weight].filter(Boolean).join(' ');
              return (
                <li key={ex.id} className={`routine-detail-row ${ex.superset_group != null ? 'in-superset' : ''}`}>
                  <div className="routine-detail-name">
                    {ex.superset_group != null && <span className="ss-badge">{supersetLabel(ex.superset_group)}</span>}
                    <strong>{ex.exercise_name}</strong>
                    <span className="routine-detail-muted"> · {ex.category}</span>
                  </div>
                  <div className="routine-detail-targets">
                    {targets || <span className="routine-detail-muted">No targets</span>}
                    {ex.cooldown_seconds != null && <span className="routine-detail-chip">Rest {ex.cooldown_seconds}s</span>}
                    {tempo && <span className="routine-detail-chip">Tempo {tempo}</span>}
                  </div>
                  {ex.notes && <p className="routine-detail-notes">{ex.notes}</p>}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
