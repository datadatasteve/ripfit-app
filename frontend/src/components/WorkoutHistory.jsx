import { useState, useEffect } from 'react';
import './WorkoutHistory.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function pad(n) { return String(n).padStart(2, '0'); }
function formatDuration(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m`;
}
function formatDate(d) {
  if (!d) return '—';
  // Treat bare dates and midnight-UTC timestamps as local dates to avoid UTC offset shifting the day
  let dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    dateStr = d;
  } else if (/T00:00:00/.test(d)) {
    dateStr = d.slice(0, 10);
  } else {
    const local = new Date(d);
    const y = local.getFullYear();
    const mo = String(local.getMonth() + 1).padStart(2, '0');
    const day = String(local.getDate()).padStart(2, '0');
    dateStr = `${y}-${mo}-${day}`;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WorkoutHistory() {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedNotes, setExpandedNotes] = useState(new Set());
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const token = localStorage.getItem('ripfit_token');

  useEffect(() => {
    fetchHistory();
  }, []);

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

  const openDetail = async (entry) => {
    setSelectedEntry(entry);
    setDetailLoading(true);
    try {
      const url = entry.type === 'strength'
        ? `${API_BASE}/workouts/history/${entry.id}`
        : `${API_BASE}/cardio/${entry.id}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setDetailData(data);
    } catch (err) {
      console.error('Failed to fetch detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleNotes = (id) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const hasNotes = (entry) => {
    if (entry.type === 'strength') return !!entry.overall_notes;
    return !!(entry.pre_session_notes || entry.mid_session_notes || entry.post_session_notes);
  };

  const filtered = filter === 'all' ? entries : entries.filter(e => e.type === filter);

  // ── Detail View ──
  if (selectedEntry) {
    const isStrength = selectedEntry.type === 'strength';
    return (
      <div className="history-container">
        <button className="history-back-btn" onClick={() => { setSelectedEntry(null); setDetailData(null); }}>
          ← Back to History
        </button>

        <div className="history-detail">
          <h2>{selectedEntry.title}</h2>
          <p className="history-detail-meta">
            {formatDate(selectedEntry.date)} &bull; {formatDuration(selectedEntry.duration_seconds)}
          </p>

          {detailLoading && <p>Loading...</p>}

          {isStrength && detailData && (
            <>
              {detailData.overall_notes && (
                <div className="history-notes-block">
                  <strong>Workout notes</strong>
                  <p>{detailData.overall_notes}</p>
                </div>
              )}
              <div className="history-exercises">
                {(detailData.exercises || []).map((ex, i) => (
                  <div key={ex.id} className="history-exercise">
                    <h4>{ex.exercise_name} <span className="history-cat">{ex.category}</span></h4>
                    {ex.exercise_notes && <p className="history-ex-notes">{ex.exercise_notes}</p>}
                    <table className="history-sets-table">
                      <thead>
                        <tr><th>Set</th><th>Reps</th><th>Weight</th><th>RPE</th></tr>
                      </thead>
                      <tbody>
                        {(ex.sets || []).map(s => (
                          <tr key={s.set_number}>
                            <td>{s.set_number}</td>
                            <td>{s.reps}</td>
                            <td>{s.weight} lbs</td>
                            <td>{s.rpe || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </>
          )}

          {!isStrength && detailData && (
            <div className="history-cardio-detail">
              {detailData.distance && (
                <div className="history-stat-row">
                  <span>Distance</span>
                  <span>{detailData.distance} {detailData.distance_unit}</span>
                </div>
              )}
              {detailData.avg_heart_rate && (
                <div className="history-stat-row">
                  <span>Avg HR</span><span>{detailData.avg_heart_rate} bpm</span>
                </div>
              )}
              {detailData.max_heart_rate && (
                <div className="history-stat-row">
                  <span>Max HR</span><span>{detailData.max_heart_rate} bpm</span>
                </div>
              )}
              {detailData.calories_burned && (
                <div className="history-stat-row">
                  <span>Calories</span><span>{detailData.calories_burned}</span>
                </div>
              )}
              {detailData.avg_speed && (
                <div className="history-stat-row">
                  <span>Avg Speed</span><span>{detailData.avg_speed} mph</span>
                </div>
              )}
              {detailData.max_speed && (
                <div className="history-stat-row">
                  <span>Max Speed</span><span>{detailData.max_speed} mph</span>
                </div>
              )}
              {detailData.elevation_gain && (
                <div className="history-stat-row">
                  <span>Elevation Gain</span><span>{detailData.elevation_gain} ft</span>
                </div>
              )}
              {[1,2,3,4,5].some(z => detailData[`hr_zone_${z}_seconds`]) && (
                <div className="history-hr-zones">
                  <strong>HR Zones</strong>
                  <div className="history-zones-row">
                    {[1,2,3,4,5].map(z => detailData[`hr_zone_${z}_seconds`] ? (
                      <div key={z} className="history-zone-chip">
                        Z{z}: {formatDuration(detailData[`hr_zone_${z}_seconds`])}
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}
              {detailData.pre_session_notes && (
                <div className="history-notes-block">
                  <strong>Pre-session</strong><p>{detailData.pre_session_notes}</p>
                </div>
              )}
              {detailData.mid_session_notes && (
                <div className="history-notes-block">
                  <strong>Mid-session</strong><p>{detailData.mid_session_notes}</p>
                </div>
              )}
              {detailData.post_session_notes && (
                <div className="history-notes-block">
                  <strong>Post-session</strong><p>{detailData.post_session_notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="history-container">
      <h2>Workout History</h2>

      <div className="history-filters">
        {['all', 'strength', 'cardio'].map(f => (
          <button
            key={f}
            className={`history-filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p className="history-loading">Loading...</p>}

      {!loading && filtered.length === 0 && (
        <p className="history-empty">No {filter === 'all' ? '' : filter} workouts logged yet.</p>
      )}

      <div className="history-list">
        {filtered.map(entry => (
          <div key={`${entry.type}-${entry.id}`} className="history-entry">
            <div className="history-entry-main" onClick={() => openDetail(entry)}>
              <div className="history-entry-left">
                <span className={`history-type-badge ${entry.type}`}>
                  {entry.type === 'strength' ? 'Strength' : 'Cardio'}
                </span>
                <span className="history-entry-title">{entry.title}</span>
              </div>
              <div className="history-entry-right">
                <span className="history-entry-date">{formatDate(entry.date)}</span>
                <span className="history-entry-duration">{formatDuration(entry.duration_seconds)}</span>
                {entry.type === 'strength' && entry.exercise_count > 0 && (
                  <span className="history-entry-meta">{entry.exercise_count} exercises</span>
                )}
                {entry.type === 'cardio' && entry.distance && (
                  <span className="history-entry-meta">{entry.distance} {entry.distance_unit}</span>
                )}
              </div>
            </div>
            {hasNotes(entry) && (
              <div className="history-notes-toggle">
                <button onClick={() => toggleNotes(`${entry.type}-${entry.id}`)}>
                  {expandedNotes.has(`${entry.type}-${entry.id}`) ? 'Hide notes ▴' : 'Show notes ▾'}
                </button>
                {expandedNotes.has(`${entry.type}-${entry.id}`) && (
                  <div className="history-notes-preview">
                    {entry.type === 'strength' && entry.overall_notes && <p>{entry.overall_notes}</p>}
                    {entry.type === 'cardio' && (
                      <>
                        {entry.pre_session_notes && <p><em>Pre:</em> {entry.pre_session_notes}</p>}
                        {entry.mid_session_notes && <p><em>Mid:</em> {entry.mid_session_notes}</p>}
                        {entry.post_session_notes && <p><em>Post:</em> {entry.post_session_notes}</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
