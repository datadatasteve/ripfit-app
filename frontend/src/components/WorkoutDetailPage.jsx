// frontend/src/components/WorkoutDetailPage.jsx
// Full workout detail view — header stats, notes, exercise breakdown, RPE/volume graphs
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import './WorkoutDetailPage.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function pad(n) { return String(n).padStart(2, '0'); }

function fmtDuration(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

function fmtDate(d) {
  if (!d) return '—';
  let dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    dateStr = d;
  } else if (/T00:00:00/.test(d)) {
    dateStr = d.slice(0, 10);
  } else {
    const local = new Date(d);
    dateStr = `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const TYPE_COLORS = {
  strength: 'var(--color-primary)',
  cardio: '#3498db',
  mixed: '#a855f7',
  open: '#14b8a6',
};

const TYPE_LABELS = {
  strength: 'Strength',
  cardio: 'Cardio',
  mixed: 'Mixed',
  open: 'Open',
};

// ── Stat box ─────────────────────────────────────────────────────────────────
function StatBox({ label, value }) {
  return (
    <div className="wdp-stat-box">
      <span className="wdp-stat-value">{value ?? '—'}</span>
      <span className="wdp-stat-label">{label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WorkoutDetailPage({ workoutId, workoutType, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const token = localStorage.getItem('ripfit_token');

  useEffect(() => {
    if (!workoutId) return;
    setLoading(true);
    setError(null);
    const url = workoutType === 'cardio'
      ? `${API_BASE}/cardio/${workoutId}`
      : `${API_BASE}/workouts/history/${workoutId}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('Failed to load workout.'))
      .finally(() => setLoading(false));
  }, [workoutId, workoutType]);

  if (loading) return (
    <div className="wdp-container">
      <button className="wdp-back" onClick={onBack}>← Back</button>
      <p className="wdp-loading">Loading…</p>
    </div>
  );

  if (error || !data) return (
    <div className="wdp-container">
      <button className="wdp-back" onClick={onBack}>← Back</button>
      <p className="wdp-error">{error || 'No data.'}</p>
    </div>
  );

  const isCardio = workoutType === 'cardio';
  const type = workoutType || 'strength';
  const typeColor = TYPE_COLORS[type] || 'var(--color-primary)';
  const typeLabel = TYPE_LABELS[type] || type;

  // ── Strength/mixed/open detail ──────────────────────────────────────────────
  const exercises = data.exercises || [];
  const strengthExercises = exercises.filter(ex => ex.category !== 'Cardio');
  const cardioExercises = exercises.filter(ex => ex.category === 'Cardio');

  const totalSets = strengthExercises.reduce((sum, ex) => sum + (ex.sets?.length || 0), 0);
  const totalReps = strengthExercises.reduce((sum, ex) =>
    sum + (ex.sets || []).reduce((s, set) => s + (set.reps || 0), 0), 0);
  const totalVolume = strengthExercises.reduce((sum, ex) =>
    sum + (ex.sets || []).reduce((s, set) => s + ((set.reps || 0) * (set.weight || 0)), 0), 0);

  const durationSeconds = data.duration_seconds ||
    (data.start_time && data.end_time
      ? Math.round((new Date(data.end_time) - new Date(data.start_time)) / 1000)
      : null);

  // Build RPE chart data — one bar per exercise, avg RPE
  const rpeChartData = strengthExercises
    .map(ex => {
      const sets = ex.sets || [];
      const rpes = sets.filter(s => s.rpe != null).map(s => parseFloat(s.rpe));
      if (rpes.length === 0) return null;
      const avg = Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10;
      return { name: ex.exercise_name, avgRPE: avg, sets: sets.length };
    })
    .filter(Boolean);

  // Build volume chart data — one bar per exercise
  const volumeChartData = strengthExercises
    .map(ex => {
      const vol = (ex.sets || []).reduce((s, set) => s + ((set.reps || 0) * (set.weight || 0)), 0);
      return vol > 0 ? { name: ex.exercise_name, volume: vol } : null;
    })
    .filter(Boolean);

  // Build targets hit/missed data
  const targetData = strengthExercises
    .filter(ex => ex.target_sets != null)
    .map(ex => ({
      name: ex.exercise_name,
      logged: ex.sets?.length || 0,
      target: ex.target_sets,
      hit: (ex.sets?.length || 0) >= ex.target_sets,
    }));

  const axisStyle = { fontSize: 11, fill: 'var(--text-secondary)' };
  const tooltipStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 12 };
  const tickFormatter = (val) => val.length > 10 ? val.slice(0, 10) + '…' : val;

  return (
    <div className="wdp-container">
      <button className="wdp-back" onClick={onBack}>← Back</button>

      {/* Header */}
      <div className="wdp-header">
        <div className="wdp-title-row">
          <h2 className="wdp-title">
            {data.routine_name || data.workout_title || data.cardio_type || 'Workout'}
          </h2>
          <span className="wdp-type-badge" style={{ background: `${typeColor}22`, color: typeColor }}>
            {typeLabel}
          </span>
        </div>
        <p className="wdp-date">
          {fmtDate(data.workout_date || data.session_date || data.date)}
          {data.start_time && ` · ${fmtTime(data.start_time)}`}
          {data.end_time && ` – ${fmtTime(data.end_time)}`}
        </p>
      </div>

      {/* Stat grid */}
      <div className="wdp-stat-grid">
        <StatBox label="Duration" value={fmtDuration(durationSeconds)} />
        {!isCardio && <StatBox label="Exercises" value={exercises.length || '—'} />}
        {!isCardio && totalSets > 0 && <StatBox label="Sets" value={totalSets} />}
        {!isCardio && totalReps > 0 && <StatBox label="Reps" value={totalReps.toLocaleString()} />}
        {!isCardio && totalVolume > 0 && <StatBox label="Volume" value={`${totalVolume.toLocaleString()} lbs`} />}
        {isCardio && data.distance && <StatBox label="Distance" value={`${data.distance} ${data.distance_unit || ''}`} />}
        {isCardio && data.avg_heart_rate && <StatBox label="Avg HR" value={`${data.avg_heart_rate} bpm`} />}
        {isCardio && data.calories_burned && <StatBox label="Calories" value={data.calories_burned} />}
        {data.session_rating != null && (
          <StatBox label="Effort & Vibes" value={`${data.session_rating} / 5`} />
        )}
      </div>

      {/* Notes */}
      {data.overall_notes && (
        <div className="wdp-notes-block">
          <span className="wdp-notes-label">Workout Notes</span>
          <p className="wdp-notes-text">{data.overall_notes}</p>
        </div>
      )}
      {data.pre_session_notes && (
        <div className="wdp-notes-block">
          <span className="wdp-notes-label">Pre-session</span>
          <p className="wdp-notes-text">{data.pre_session_notes}</p>
        </div>
      )}
      {data.mid_session_notes && (
        <div className="wdp-notes-block">
          <span className="wdp-notes-label">Mid-session</span>
          <p className="wdp-notes-text">{data.mid_session_notes}</p>
        </div>
      )}
      {data.post_session_notes && (
        <div className="wdp-notes-block">
          <span className="wdp-notes-label">Post-session</span>
          <p className="wdp-notes-text">{data.post_session_notes}</p>
        </div>
      )}

      {/* Exercise breakdown */}
      {!isCardio && exercises.length > 0 && (
        <div className="wdp-section">
          <h3 className="wdp-section-title">Exercise Breakdown</h3>
          <div className="wdp-exercise-list">
            {exercises.map((ex, i) => (
              <div key={ex.id || i} className="wdp-exercise">
                <div className="wdp-ex-header">
                  <strong className="wdp-ex-name">{ex.exercise_name}</strong>
                  <span className="wdp-ex-cat">{ex.category}</span>
                </div>
                {ex.exercise_notes && (
                  <p className="wdp-ex-notes">{ex.exercise_notes}</p>
                )}
                {ex.category !== 'Cardio' && ex.sets && ex.sets.length > 0 && (
                  <table className="wdp-sets-table">
                    <thead>
                      <tr><th>Set</th><th>Reps</th><th>Weight</th><th>RPE</th></tr>
                    </thead>
                    <tbody>
                      {ex.sets.map((s, si) => (
                        <tr key={si}>
                          <td>{s.set_number ?? si + 1}</td>
                          <td>{s.reps ?? '—'}</td>
                          <td>{s.weight === 0 ? 'BW' : s.weight != null ? `${s.weight} lbs` : '—'}</td>
                          <td>{s.rpe ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {ex.category !== 'Cardio' && (!ex.sets || ex.sets.length === 0) && (
                  <p className="wdp-skipped">No sets logged</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cardio detail */}
      {isCardio && (
        <div className="wdp-section">
          <h3 className="wdp-section-title">Session Details</h3>
          <div className="wdp-cardio-rows">
            {data.avg_speed != null && <div className="wdp-cardio-row"><span>Avg Speed</span><span>{data.avg_speed} mph</span></div>}
            {data.max_speed != null && <div className="wdp-cardio-row"><span>Max Speed</span><span>{data.max_speed} mph</span></div>}
            {data.elevation_gain != null && <div className="wdp-cardio-row"><span>Elevation Gain</span><span>{data.elevation_gain} ft</span></div>}
            {data.elevation_loss != null && <div className="wdp-cardio-row"><span>Elevation Loss</span><span>{data.elevation_loss} ft</span></div>}
            {data.max_heart_rate != null && <div className="wdp-cardio-row"><span>Max HR</span><span>{data.max_heart_rate} bpm</span></div>}
          </div>
        </div>
      )}

      {/* RPE chart */}
      {rpeChartData.length > 0 && (
        <div className="wdp-section">
          <h3 className="wdp-section-title">Avg RPE by Exercise</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rpeChartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="name" tick={axisStyle} angle={-35} textAnchor="end" interval={0} tickFormatter={tickFormatter} />
              <YAxis domain={[0, 10]} tick={axisStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="avgRPE" name="Avg RPE" fill="var(--color-warning)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Volume chart */}
      {volumeChartData.length > 0 && (
        <div className="wdp-section">
          <h3 className="wdp-section-title">Volume by Exercise (lbs)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={volumeChartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="name" tick={axisStyle} angle={-35} textAnchor="end" interval={0} tickFormatter={tickFormatter} />
              <YAxis tick={axisStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v.toLocaleString() + ' lbs', 'Volume']} />
              <Bar dataKey="volume" name="Volume" fill={typeColor} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Targets hit/missed */}
      {targetData.length > 0 && (
        <div className="wdp-section">
          <h3 className="wdp-section-title">Sets: Logged vs Target</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={targetData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="name" tick={axisStyle} angle={-35} textAnchor="end" interval={0} tickFormatter={tickFormatter} />
              <YAxis allowDecimals={false} tick={axisStyle} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Bar dataKey="target" name="Target" fill="var(--border-color)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="logged" name="Logged" fill={typeColor} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
