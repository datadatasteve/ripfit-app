import { useState, useEffect, useRef } from 'react';
import './CardioWorkout.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const CARDIO_TYPES = [
  'Indoor Cycling', 'Outdoor Cycling', 'Treadmill', 'Outdoor Running',
  'Indoor Track', 'Walking', 'Hiking', 'Elliptical', 'Rowing Machine',
  'Swimming', 'Jump Rope', 'Stair Climber', 'HIIT', 'Sprints', 'Suicides',
];

// Types that support elevation gain
const ELEVATION_TYPES = ['Outdoor Cycling', 'Outdoor Running', 'Hiking'];

function pad(n) { return String(n).padStart(2, '0'); }
function formatTime(s) { return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; }

export default function CardioWorkout({ onClose }) {
  const [phase, setPhase] = useState('select'); // select | goals | active | finish
  const [cardioType, setCardioType] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const intervalRef = useRef(null);

  const token = localStorage.getItem('ripfit_token');

  const [goals, setGoals] = useState({
    goal_duration_seconds: '',
    goal_distance: '',
    goal_distance_unit: 'mi',
    goal_speed: '',
    pre_session_notes: '',
  });

  const [metrics, setMetrics] = useState({
    duration_seconds: '',
    distance: '',
    distance_unit: 'mi',
    avg_heart_rate: '',
    max_heart_rate: '',
    calories_burned: '',
    avg_speed: '',
    max_speed: '',
    elevation_gain: '',
    hr_zone_1_seconds: '',
    hr_zone_2_seconds: '',
    hr_zone_3_seconds: '',
    hr_zone_4_seconds: '',
    hr_zone_5_seconds: '',
    post_session_notes: '',
  });

  // Timer
  useEffect(() => {
    if (phase === 'active') {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [phase, startTime]);

  const startSession = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/cardio/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          cardio_type: cardioType,
          goal_duration_seconds: goals.goal_duration_seconds ? parseInt(goals.goal_duration_seconds) : undefined,
          goal_distance: goals.goal_distance ? parseFloat(goals.goal_distance) : undefined,
          goal_distance_unit: goals.goal_distance_unit,
          goal_speed: goals.goal_speed ? parseFloat(goals.goal_speed) : undefined,
          pre_session_notes: goals.pre_session_notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessionId(data.session.id);
      setStartTime(Date.now());
      setPhase('active');
    } catch (err) {
      setError(err.message || 'Failed to start session');
    } finally {
      setLoading(false);
    }
  };

  const saveNotes = async () => {
    if (!notes.trim()) return;
    try {
      await fetch(`${API_BASE}/cardio/${sessionId}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mid_session_notes: notes }),
      });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save notes:', err);
    }
  };

  const finishSession = async () => {
    setLoading(true);
    setError('');
    try {
      // Use timer value if duration not manually entered
      const finalDuration = metrics.duration_seconds
        ? parseInt(metrics.duration_seconds)
        : elapsed;

      const body = {
        duration_seconds: finalDuration,
        post_session_notes: metrics.post_session_notes || undefined,
      };

      const numericFields = [
        'distance', 'avg_heart_rate', 'max_heart_rate', 'calories_burned',
        'avg_speed', 'max_speed', 'elevation_gain',
        'hr_zone_1_seconds', 'hr_zone_2_seconds', 'hr_zone_3_seconds',
        'hr_zone_4_seconds', 'hr_zone_5_seconds',
      ];
      numericFields.forEach(f => {
        if (metrics[f]) body[f] = parseFloat(metrics[f]);
      });
      if (metrics.distance_unit) body.distance_unit = metrics.distance_unit;

      const res = await fetch(`${API_BASE}/cardio/${sessionId}/finish`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to finish session');
      clearInterval(intervalRef.current);
      onClose({ completed: true, type: cardioType, duration: finalDuration });
    } catch (err) {
      setError(err.message || 'Failed to finish session');
    } finally {
      setLoading(false);
    }
  };

  const cancelSession = async () => {
    if (!sessionId) { onClose(null); return; }
    try {
      await fetch(`${API_BASE}/cardio/${sessionId}/cancel`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) { console.error('Cancel error:', err); }
    clearInterval(intervalRef.current);
    onClose(null);
  };

  // ── PHASE: select ──────────────────────────────────────────────
  if (phase === 'select') return (
    <div className="cardio-overlay">
      <div className="cardio-card">
        <div className="cardio-header">
          <h2>Select Cardio Type</h2>
          <button className="cardio-close" onClick={() => onClose(null)}>✕</button>
        </div>
        <div className="cardio-type-grid">
          {CARDIO_TYPES.map(t => (
            <button
              key={t}
              className={`cardio-type-btn ${cardioType === t ? 'active' : ''}`}
              onClick={() => setCardioType(t)}
            >{t}</button>
          ))}
        </div>
        <button
          className="cardio-primary-btn"
          disabled={!cardioType}
          onClick={() => setPhase('goals')}
        >Next</button>
      </div>
    </div>
  );

  // ── PHASE: goals ──────────────────────────────────────────────
  if (phase === 'goals') return (
    <div className="cardio-overlay">
      <div className="cardio-card">
        <div className="cardio-header">
          <h2>{cardioType}</h2>
          <button className="cardio-close" onClick={() => onClose(null)}>✕</button>
        </div>
        <p className="cardio-subtitle">Set goals (all optional)</p>
        <div className="cardio-form">
          <label>Goal duration (minutes)</label>
          <input type="number" placeholder="e.g. 45" value={goals.goal_duration_seconds}
            onChange={e => setGoals(g => ({ ...g, goal_duration_seconds: e.target.value ? e.target.value * 60 : '' }))} />

          <label>Goal distance</label>
          <div className="cardio-row">
            <input type="number" step="0.1" placeholder="e.g. 5" value={goals.goal_distance}
              onChange={e => setGoals(g => ({ ...g, goal_distance: e.target.value }))} />
            <select value={goals.goal_distance_unit}
              onChange={e => setGoals(g => ({ ...g, goal_distance_unit: e.target.value }))}>
              <option value="mi">mi</option>
              <option value="km">km</option>
              <option value="m">m</option>
              <option value="yd">yd</option>
            </select>
          </div>

          <label>Goal speed (mph)</label>
          <input type="number" step="0.1" placeholder="e.g. 12" value={goals.goal_speed}
            onChange={e => setGoals(g => ({ ...g, goal_speed: e.target.value }))} />

          <label>Pre-session notes</label>
          <textarea placeholder="How are you feeling? Any plans for today?"
            value={goals.pre_session_notes}
            onChange={e => setGoals(g => ({ ...g, pre_session_notes: e.target.value }))} />
        </div>
        {error && <p className="cardio-error">{error}</p>}
        <div className="cardio-btn-row">
          <button className="cardio-secondary-btn" onClick={() => setPhase('select')}>Back</button>
          <button className="cardio-primary-btn" onClick={startSession} disabled={loading}>
            {loading ? 'Starting...' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );

  // ── PHASE: active ──────────────────────────────────────────────
  if (phase === 'active') return (
    <div className="cardio-overlay">
      <div className="cardio-card">
        <div className="cardio-header">
          <h2>{cardioType}</h2>
          <span className="cardio-timer">{formatTime(elapsed)}</span>
        </div>
        <div className="cardio-form">
          <label>Mid-session notes</label>
          <textarea placeholder="Add notes at any point during your session..."
            value={notes} onChange={e => setNotes(e.target.value)} />
          <button className="cardio-secondary-btn" onClick={saveNotes}>
            {notesSaved ? 'Saved ✓' : 'Save Note'}
          </button>
        </div>
        <div className="cardio-btn-row">
          <button className="cardio-cancel-btn" onClick={cancelSession}>Cancel</button>
          <button className="cardio-primary-btn" onClick={() => setPhase('finish')}>Finish</button>
        </div>
      </div>
    </div>
  );

  // ── PHASE: finish ──────────────────────────────────────────────
  return (
    <div className="cardio-overlay">
      <div className="cardio-card">
        <div className="cardio-header">
          <h2>Finish — {cardioType}</h2>
          <span className="cardio-timer">{formatTime(elapsed)}</span>
        </div>
        <p className="cardio-subtitle">All fields optional. Timer time used if duration left blank.</p>
        <div className="cardio-form">
          <label>Duration (minutes) — leave blank to use timer</label>
          <input type="number" placeholder={Math.round(elapsed / 60)} value={metrics.duration_seconds}
            onChange={e => setMetrics(m => ({ ...m, duration_seconds: e.target.value ? e.target.value * 60 : '' }))} />

          <label>Distance</label>
          <div className="cardio-row">
            <input type="number" step="0.01" placeholder="e.g. 8.5" value={metrics.distance}
              onChange={e => setMetrics(m => ({ ...m, distance: e.target.value }))} />
            <select value={metrics.distance_unit}
              onChange={e => setMetrics(m => ({ ...m, distance_unit: e.target.value }))}>
              <option value="mi">mi</option>
              <option value="km">km</option>
              <option value="m">m</option>
              <option value="yd">yd</option>
            </select>
          </div>

          <label>Avg heart rate (bpm)</label>
          <input type="number" placeholder="e.g. 145" value={metrics.avg_heart_rate}
            onChange={e => setMetrics(m => ({ ...m, avg_heart_rate: e.target.value }))} />

          <label>Max heart rate (bpm)</label>
          <input type="number" placeholder="e.g. 178" value={metrics.max_heart_rate}
            onChange={e => setMetrics(m => ({ ...m, max_heart_rate: e.target.value }))} />

          <label>Calories burned</label>
          <input type="number" placeholder="e.g. 420" value={metrics.calories_burned}
            onChange={e => setMetrics(m => ({ ...m, calories_burned: e.target.value }))} />

          <label>Avg speed (mph)</label>
          <input type="number" step="0.1" placeholder="e.g. 14.2" value={metrics.avg_speed}
            onChange={e => setMetrics(m => ({ ...m, avg_speed: e.target.value }))} />

          <label>Max speed (mph)</label>
          <input type="number" step="0.1" placeholder="e.g. 22.1" value={metrics.max_speed}
            onChange={e => setMetrics(m => ({ ...m, max_speed: e.target.value }))} />

          {ELEVATION_TYPES.includes(cardioType) && (
            <>
              <label>Elevation gain (ft)</label>
              <input type="number" placeholder="e.g. 850" value={metrics.elevation_gain}
                onChange={e => setMetrics(m => ({ ...m, elevation_gain: e.target.value }))} />
            </>
          )}

          <details className="cardio-hr-zones">
            <summary>Heart rate zones (seconds in each zone)</summary>
            <div className="cardio-zones-grid">
              {[1,2,3,4,5].map(z => (
                <div key={z}>
                  <label>Zone {z}</label>
                  <input type="number" placeholder="sec"
                    value={metrics[`hr_zone_${z}_seconds`]}
                    onChange={e => setMetrics(m => ({ ...m, [`hr_zone_${z}_seconds`]: e.target.value }))} />
                </div>
              ))}
            </div>
          </details>

          <label>Post-session notes</label>
          <textarea placeholder="How did it go? Any observations?"
            value={metrics.post_session_notes}
            onChange={e => setMetrics(m => ({ ...m, post_session_notes: e.target.value }))} />
        </div>
        {error && <p className="cardio-error">{error}</p>}
        <div className="cardio-btn-row">
          <button className="cardio-cancel-btn" onClick={cancelSession}>Cancel Session</button>
          <button className="cardio-primary-btn" onClick={finishSession} disabled={loading}>
            {loading ? 'Saving...' : 'Save & Finish'}
          </button>
        </div>
      </div>
    </div>
  );
}
