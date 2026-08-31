// frontend/src/components/ProgramDetail.jsx
import { useState, useEffect, useRef } from 'react';
import './ProgramDetail.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}`, 'Content-Type': 'application/json' }; }

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TABS = ['Overview', 'Schedule', 'Journal'];

function ProgressBar({ pct, height = 8 }) {
  return (
    <div className="pd-progress-track" style={{ height }}>
      <div className="pd-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div className="pd-stat-chip">
      <span className="pd-stat-value" style={color ? { color } : undefined}>{value ?? '—'}</span>
      <span className="pd-stat-label">{label}</span>
    </div>
  );
}

function JournalEntry({ entry, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.content);

  const save = async () => { await onEdit(entry.id, text); setEditing(false); };
  const ts = new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const edited = entry.updated_at !== entry.created_at;

  return (
    <div className="pd-journal-entry">
      <div className="pd-journal-meta">
        <span>{ts}{edited ? ' (edited)' : ''}</span>
        <div className="pd-journal-actions">
          <button onClick={() => setEditing(e => !e)}>{editing ? 'Cancel' : 'Edit'}</button>
          <button onClick={() => onDelete(entry.id)} className="pd-journal-delete">Delete</button>
        </div>
      </div>
      {editing ? (
        <>
          <textarea className="pd-journal-input" value={text} onChange={e => setText(e.target.value)} rows={3} />
          <button className="pd-journal-save-btn" onClick={save}>Save</button>
        </>
      ) : (
        <p className="pd-journal-content">{entry.content}</p>
      )}
    </div>
  );
}

export default function ProgramDetail({ programId, onBack, onEdit, onStartWorkout, onViewStats, onViewWorkout }) {
  const [data, setData] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Overview');
  const [journalText, setJournalText] = useState('');
  const [calView, setCalView] = useState('week');

  useEffect(() => { fetchAll(); }, [programId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${API}/programs/${programId}`, { headers: authHeaders() }),
        fetch(`${API}/programs/${programId}/progress`, { headers: authHeaders() }),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      setData(d1);
      setProgress(d2);
    } catch (err) {
      console.error('Failed to fetch program:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    await fetch(`${API}/programs/${programId}/activate`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ start_date: new Date().toISOString().slice(0, 10) }),
    });
    fetchAll();
  };

  const addJournal = async () => {
    if (!journalText.trim()) return;
    await fetch(`${API}/programs/${programId}/journal`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ content: journalText.trim() }),
    });
    setJournalText('');
    fetchAll();
  };

  const editJournal = async (id, content) => {
    await fetch(`${API}/programs/journal/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ content }),
    });
    fetchAll();
  };

  const deleteJournal = async (id) => {
    await fetch(`${API}/programs/journal/${id}`, { method: 'DELETE', headers: authHeaders() });
    fetchAll();
  };

  if (loading) return (
    <div className="pd-container">
      <button className="pd-back" onClick={onBack}>← Programs</button>
      <p className="pd-loading">Loading…</p>
    </div>
  );
  if (!data) return (
    <div className="pd-container">
      <button className="pd-back" onClick={onBack}>← Programs</button>
      <p>Program not found.</p>
    </div>
  );

  const pct = progress?.pct_complete || 0;
  const totalWeeks = data.duration_weeks || 1;
  const days = data.days || [];
  const journal = data.journal || [];

  // Group days by week for calendar
  const byWeek = {};
  days.forEach(d => {
    const w = d.week_number || 1;
    if (!byWeek[w]) byWeek[w] = {};
    const dow = d.day_of_week ?? d.order_index - 1;
    byWeek[w][dow] = d;
  });
  const weeksToShow = calView === 'week' ? [1] : Array.from({ length: totalWeeks }, (_, i) => i + 1);

  const workoutDays = days.filter(d => !d.is_rest_day);

  return (
    <div className="pd-container">
      {/* Top bar */}
      <div className="pd-topbar">
        <button className="pd-back" onClick={onBack}>← Programs</button>
        <div className="pd-topbar-actions">
          {onViewStats && (
            <button className="pd-stats-btn" onClick={() => onViewStats(programId)}>Stats →</button>
          )}
          <button className="pd-edit-btn" onClick={onEdit}>Edit</button>
        </div>
      </div>

      {/* Header */}
      <div className="pd-header">
        <div className="pd-title-row">
          <h2 className="pd-title">{data.name}</h2>
          {data.status === 'draft' ? (
            <button className="pd-activate-pill" onClick={handleActivate}>Activate</button>
          ) : (
            <span className={`pd-status-badge pd-status-${data.status}`}>{data.status}</span>
          )}
        </div>
        {data.description && <p className="pd-desc">{data.description}</p>}
      </div>

      {/* Progress bar + quick stats — always visible */}
      <div className="pd-progress-section">
        <div className="pd-progress-labels">
          <span>{progress?.completed_workouts || 0} of {progress?.total_workout_days || 0} workouts done</span>
          <span>{pct}%</span>
        </div>
        <ProgressBar pct={pct} height={10} />
      </div>

      {/* Tabs */}
      <div className="pd-tab-bar">
        {TABS.map(t => (
          <button key={t} className={`pd-tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === 'Overview' && (
        <div className="pd-tab-content">
          <div className="pd-stat-row">
            <StatChip label="Duration" value={data.duration_weeks ? `${data.duration_weeks}w` : '—'} />
            <StatChip label="Workouts" value={progress?.total_workout_days} />
            <StatChip label="Done" value={progress?.completed_workouts} />
            <StatChip label="Complete" value={`${pct}%`}
              color={pct >= 100 ? '#22c55e' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-primary)'} />
            {progress?.avg_target_achievement_pct != null && (
              <StatChip label="Target Hit" value={`${progress.avg_target_achievement_pct}%`} />
            )}
          </div>

          {data.synopsis && (
            <div className="pd-synopsis">
              <strong>About</strong>
              <p>{data.synopsis}</p>
            </div>
          )}

          {/* Next up */}
          {data.status === 'active' && (() => {
            const nextDay = workoutDays.find(d => !d.completed_date);
            if (!nextDay) return <p className="pd-all-done">All workouts complete ✓</p>;
            return (
              <div className="pd-next-up">
                <span className="pd-next-label">Next up</span>
                <div className="pd-next-card">
                  <div className="pd-next-info">
                    <span className="pd-next-name">{nextDay.routine_name || 'Workout'}</span>
                    <span className="pd-next-meta">
                      Week {nextDay.week_number} · {DAY_NAMES[nextDay.day_of_week] || `Day ${nextDay.order_index}`}
                      {nextDay.exercise_count > 0 && ` · ${nextDay.exercise_count} exercises`}
                    </span>
                  </div>
                  {onStartWorkout && (
                    <button className="pd-start-day-btn" onClick={() => onStartWorkout(programId, nextDay)}>
                      Start
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Recent workouts — last 5 */}
          {workoutDays.filter(d => d.completed_date).length > 0 && (
            <div className="pd-recent">
              <h3>Recent</h3>
              {workoutDays.filter(d => d.completed_date).slice(-5).reverse().map((d, i) => (
                <div
                  key={i}
                  className="pd-recent-row"
                  onClick={() => d.completed_workout_id && onViewWorkout?.(d.completed_workout_id)}
                  style={{ cursor: d.completed_workout_id ? 'pointer' : 'default' }}
                >
                  <span className="pd-recent-name">{d.routine_name}</span>
                  <span className="pd-recent-date">{new Date(d.completed_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ✓</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Schedule tab ── */}
      {tab === 'Schedule' && (
        <div className="pd-tab-content">
          {/* Calendar view toggle */}
          <div className="pd-cal-toggle">
            <button className={calView === 'week' ? 'active' : ''} onClick={() => setCalView('week')}>Week 1</button>
            <button className={calView === 'full' ? 'active' : ''} onClick={() => setCalView('full')}>Full Program</button>
          </div>

          <div className="pd-calendar">
            <div className="pd-cal-row pd-cal-header">
              <div className="pd-cal-week-label" />
              {DAY_NAMES.map(d => <div key={d} className="pd-cal-header-cell">{d}</div>)}
            </div>
            {weeksToShow.map(week => (
              <div key={week} className="pd-cal-row">
                <div className="pd-cal-week-label">W{week}</div>
                {[0,1,2,3,4,5,6].map(dow => {
                  const slot = byWeek[week]?.[dow];
                  const done = slot?.completed_date;
                  return (
                    <div
                      key={dow}
                      className={`pd-cal-cell ${slot ? (slot.is_rest_day ? 'pd-cal-rest' : done ? 'pd-cal-done' : 'pd-cal-workout') : 'pd-cal-empty'}`}
                      onClick={() => slot && !slot.is_rest_day && onStartWorkout && onStartWorkout(programId, slot)}
                      title={slot?.routine_name || (slot?.is_rest_day ? 'Rest' : '')}
                    >
                      {slot && !slot.is_rest_day && (
                        <>
                          <span className="pd-cal-name">{slot.routine_name || 'Workout'}</span>
                          {done && <span className="pd-cal-check">✓</span>}
                        </>
                      )}
                      {slot?.is_rest_day && <span className="pd-cal-rest-label">Rest</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Full day list */}
          <div className="pd-day-list">
            {workoutDays.map((day, i) => (
              <div key={i} className={`pd-day-row ${day.completed_date ? 'pd-day-done' : ''}`}>
                <div className="pd-day-info">
                  <span className="pd-day-label">Week {day.week_number} · {DAY_NAMES[day.day_of_week] || `Day ${day.order_index}`}</span>
                  <span className="pd-day-name">{day.routine_name || 'Unnamed workout'}</span>
                  {day.exercise_count > 0 && <span className="pd-day-meta">{day.exercise_count} exercises</span>}
                </div>
                <div className="pd-day-actions">
                  {day.completed_date ? (
                    <span className="pd-day-completed">✓ Done</span>
                  ) : (
                    data.status === 'active' && onStartWorkout && (
                      <button className="pd-start-day-btn" onClick={() => onStartWorkout(programId, day)}>Start</button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Journal tab ── */}
      {tab === 'Journal' && (
        <div className="pd-tab-content">
          <div className="pd-journal-compose">
            <textarea
              className="pd-journal-input"
              placeholder="Add a note to this program…"
              value={journalText}
              onChange={e => setJournalText(e.target.value)}
              rows={3}
            />
            <button className="pd-journal-save-btn" onClick={addJournal} disabled={!journalText.trim()}>
              Add Entry
            </button>
          </div>
          <div className="pd-journal-list">
            {journal.length === 0 && <p className="pd-empty-text">No journal entries yet.</p>}
            {journal.map(entry => (
              <JournalEntry key={entry.id} entry={entry} onEdit={editJournal} onDelete={deleteJournal} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
