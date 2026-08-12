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

export default function WorkoutHistory({ initialWorkoutId, onClearSelected }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [detailEntry, setDetailEntry] = useState(null);

  const token = localStorage.getItem('ripfit_token');

  useEffect(() => { fetchHistory(); }, []);

  useEffect(() => {
    if (initialWorkoutId && entries.length > 0) {
      const entry = entries.find(e => String(e.id) === String(initialWorkoutId));
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

  const filtered = filter === 'all'
    ? entries
    : filter === 'cardio'
      ? entries.filter(e => e.type === 'cardio')
      : entries.filter(e => e.type !== 'cardio');

  if (detailEntry) {
    return (
      <WorkoutDetailPage
        workoutId={detailEntry.id}
        workoutType={detailEntry.type}
        onBack={() => setDetailEntry(null)}
      />
    );
  }

  return (
    <div className="history-container">
      <div className="history-filters">
        {[
          { key: 'all', label: 'All' },
          { key: 'strength', label: 'Strength / Mixed / Open' },
          { key: 'cardio', label: 'Cardio' },
        ].map(f => (
          <button
            key={f.key}
            className={`history-filter-btn ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
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
          return (
            <div
              key={key}
              className="history-entry"
              onClick={() => setDetailEntry(entry)}
            >
              <div className="history-entry-main">
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
                <span className="history-entry-arrow">›</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
