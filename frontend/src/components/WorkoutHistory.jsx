import { useState, useEffect } from 'react';
import WorkoutDetailPage from './WorkoutDetailPage';
import './WorkoutHistory.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function formatDuration(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

function formatDate(d) {
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
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TYPE_LABELS = { strength: 'Strength', cardio: 'Cardio', mixed: 'Mixed', open: 'Open' };

// ── Inline dropdown summary ───────────────────────────────────────────────────
function InlineDropdown({ entry, onViewFull }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('ripfit_token');

  useEffect(() => {
    const url = entry.type === 'cardio'
      ? `${API_BASE}/cardio/${entry.id}`
      : `${API_BASE}/workouts/history/${entry.id}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [entry.id]);

  if (loading) return <div className="wh-dropdown-loading">Loading…</div>;
  if (!data) return <div className="wh-dropdown-loading">Failed to load.</div>;

  const isCardio = entry.type === 'cardio';
  const exercises = data.exercises || [];
  const strengthExes = exercises.filter(e => e.category !== 'Cardio');
  const totalSets = strengthExes.reduce((s, ex) => s + (ex.sets?.length || 0), 0);
  const totalReps = strengthExes.reduce((s, ex) =>
    s + (ex.sets || []).reduce((r, set) => r + (set.reps || 0), 0), 0);

  return (
    <div className="wh-dropdown">
      {/* Quick stats row */}
      <div className="wh-dropdown-stats">
        <span><strong>{formatDuration(entry.duration_seconds)}</strong> duration</span>
        {!isCardio && totalSets > 0 && <span><strong>{totalSets}</strong> sets</span>}
        {!isCardio && totalReps > 0 && <span><strong>{totalReps}</strong> reps</span>}
        {isCardio && data.distance && <span><strong>{data.distance}</strong> {data.distance_unit}</span>}
        {data.session_rating != null && (
          <span style={{ color: 'var(--color-warning)' }}>
            <strong>{data.session_rating}</strong> / 5
          </span>
        )}
      </div>

      {/* Notes */}
      {(data.overall_notes || data.pre_session_notes) && (
        <div className="wh-dropdown-notes">
          {data.overall_notes && <p>{data.overall_notes}</p>}
          {data.pre_session_notes && <p><em>Pre:</em> {data.pre_session_notes}</p>}
          {data.mid_session_notes && <p><em>Mid:</em> {data.mid_session_notes}</p>}
          {data.post_session_notes && <p><em>Post:</em> {data.post_session_notes}</p>}
        </div>
      )}

      {/* Exercise list */}
      {!isCardio && exercises.length > 0 && (
        <div className="wh-dropdown-exercises">
          {exercises.map((ex, i) => (
            <div key={ex.id || i} className="wh-dropdown-ex">
              <span className="wh-dropdown-ex-name">{ex.exercise_name}</span>
              <span className="wh-dropdown-ex-detail">
                {ex.category === 'Cardio'
                  ? 'Cardio'
                  : ex.sets?.length
                    ? ex.sets.map(s =>
                        `${s.reps ?? '—'}×${s.weight === 0 ? 'BW' : `${s.weight}lbs`}`
                      ).join('  ')
                    : 'No sets'
                }
              </span>
            </div>
          ))}
        </div>
      )}

      <button className="wh-view-full-btn" onClick={() => onViewFull(entry)}>
        Full breakdown →
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WorkoutHistory({ initialWorkoutId, onClearSelected }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null); // inline dropdown
  const [detailEntry, setDetailEntry] = useState(null); // full page

  const token = localStorage.getItem('ripfit_token');

  useEffect(() => {
    fetchHistory();
  }, []);

  // Auto-open from calendar click
  useEffect(() => {
    if (initialWorkoutId && entries.length > 0) {
      const entry = entries.find(e => e.id === initialWorkoutId || e.id === String(initialWorkoutId));
      if (entry) {
        setDetailEntry(entry);
        onClearSelected?.();
      }
    }
  }, [initialWorkoutId, entries]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/workouts/history?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (key) => {
    setExpandedId(prev => prev === key ? null : key);
  };

  // 'strength' filter catches strength + mixed + open; 'cardio' catches cardio only
  const filtered = filter === 'all'
    ? entries
    : filter === 'cardio'
      ? entries.filter(e => e.type === 'cardio')
      : entries.filter(e => e.type !== 'cardio');

  // ── Full detail page ────────────────────────────────────────────────────────
  if (detailEntry) {
    return (
      <WorkoutDetailPage
        workoutId={detailEntry.id}
        workoutType={detailEntry.type}
        onBack={() => setDetailEntry(null)}
      />
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="history-container">
      <div className="history-filters">
        {['all', 'strength', 'cardio'].map(f => (
          <button
            key={f}
            className={`history-filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'strength' ? 'Strength / Mixed / Open' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p className="history-loading">Loading…</p>}

      {!loading && filtered.length === 0 && (
        <p className="history-empty">No workouts logged yet.</p>
      )}

      <div className="history-list">
        {filtered.map(entry => {
          const key = `${entry.type}-${entry.id}`;
          const isExpanded = expandedId === key;
          return (
            <div key={key} className={`history-entry ${isExpanded ? 'expanded' : ''}`}>
              {/* Row */}
              <div className="history-entry-main" onClick={() => toggleExpand(key)}>
                <div className="history-entry-left">
                  <span className={`history-type-badge ${entry.type}`}>
                    {TYPE_LABELS[entry.type] || entry.type}
                  </span>
                  <span className="history-entry-title">{entry.title}</span>
                </div>
                <div className="history-entry-right">
                  <span className="history-entry-date">{formatDate(entry.date)}</span>
                  <span className="history-entry-duration">{formatDuration(entry.duration_seconds)}</span>
                  {entry.type !== 'cardio' && entry.exercise_count > 0 && (
                    <span className="history-entry-meta">{entry.exercise_count} exercises</span>
                  )}
                  {entry.type === 'cardio' && entry.distance && (
                    <span className="history-entry-meta">{entry.distance} {entry.distance_unit}</span>
                  )}
                </div>
                <span className="history-expand-chevron">{isExpanded ? '▴' : '▾'}</span>
              </div>

              {/* Inline dropdown */}
              {isExpanded && (
                <InlineDropdown
                  entry={entry}
                  onViewFull={(e) => {
                    setExpandedId(null);
                    setDetailEntry(e);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
