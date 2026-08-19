// frontend/src/components/ProgramDetail.jsx
import { useState, useEffect, useRef } from 'react';
import './ProgramDetail.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}`, 'Content-Type': 'application/json' }; }

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

  const save = async () => {
    await onEdit(entry.id, text);
    setEditing(false);
  };

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

export default function ProgramDetail({ programId, onBack, onEdit, onDeleted, onStartWorkout, onViewStats }) {
  const [data, setData] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [journalText, setJournalText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [calView, setCalView] = useState('week'); // week | full
  const journalRef = useRef(null);

  useEffect(() => { fetchAll(); }, [programId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [progRes, progRes2] = await Promise.all([
        fetch(`${API}/programs/${programId}`, { headers: authHeaders() }),
        fetch(`${API}/programs/${programId}/progress`, { headers: authHeaders() }),
      ]);
      const [progData, progressData] = await Promise.all([progRes.json(), progRes2.json()]);
      setData(progData);
      setProgress(progressData);
    } catch (err) {
      console.error('Failed to fetch program:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    await fetch(`${API}/programs/${programId}/activate`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ start_date: new Date().toISOString().slice(0, 10) }),
    });
    fetchAll();
  };

  const handleDelete = async () => {
    await fetch(`${API}/programs/${programId}`, { method: 'DELETE', headers: authHeaders() });
    onDeleted?.();
  };

  const addJournal = async () => {
    if (!journalText.trim()) return;
    await fetch(`${API}/programs/${programId}/journal`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ content: journalText.trim() }),
    });
    setJournalText('');
    fetchAll();
  };

  const editJournal = async (entryId, content) => {
    await fetch(`${API}/programs/journal/${entryId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    });
    fetchAll();
  };

  const deleteJournal = async (entryId) => {
    await fetch(`${API}/programs/journal/${entryId}`, { method: 'DELETE', headers: authHeaders() });
    fetchAll();
  };

  if (loading) return <div className="pd-container"><button className="pd-back" onClick={onBack}>← Back</button><p className="pd-loading">Loading…</p></div>;
  if (!data) return <div className="pd-container"><button className="pd-back" onClick={onBack}>← Back</button><p>Program not found.</p></div>;

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

  return (
    <div className="pd-container">
      <div className="pd-topbar">
        <button className="pd-back" onClick={onBack}>← Programs</button>
        <div className="pd-topbar-actions">
          {onViewStats && (
            <button className="pd-stats-btn" onClick={() => onViewStats(programId)}>Program Stats →</button>
          )}
          <button className="pd-edit-btn" onClick={onEdit}>Edit</button>
        </div>
      </div>

      {/* Header */}
      <div className="pd-header">
        <div className="pd-title-row">
          <h2 className="pd-title">{data.name}</h2>
          <span className={`pd-status-badge pd-status-${data.status}`}>{data.status}</span>
        </div>
        {data.description && <p className="pd-desc">{data.description}</p>}
        {data.synopsis && (
          <div className="pd-synopsis">
            <strong>About this program</strong>
            <p>{data.synopsis}</p>
          </div>
        )}
      </div>

      {/* Glance stats */}
      <div className="pd-stat-row">
        <StatChip label="Duration" value={data.duration_weeks ? `${data.duration_weeks}w` : '—'} />
        <StatChip label="Workouts" value={progress?.total_workout_days} />
        <StatChip label="Completed" value={progress?.completed_workouts} />
        <StatChip label="Complete" value={`${pct}%`} color={pct >= 100 ? '#22c55e' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-primary)'} />
        {progress?.avg_target_achievement_pct != null && (
          <StatChip label="Avg Target Hit" value={`${progress.avg_target_achievement_pct}%`} />
        )}
      </div>

      {/* Progress bar */}
      <div className="pd-progress-section">
        <div className="pd-progress-labels">
          <span>Progress</span><span>{pct}%</span>
        </div>
        <ProgressBar pct={pct} height={10} />
      </div>

      {/* Activate button */}
      {data.status === 'draft' && (
        <button className="pd-activate-btn" onClick={handleActivate}>Activate Program</button>
      )}

      {/* Calendar view */}
      <div className="pd-section">
        <div className="pd-section-header">
          <h3>Schedule</h3>
          <div className="pd-cal-toggle">
            <button className={calView === 'week' ? 'active' : ''} onClick={() => setCalView('week')}>Week 1</button>
            <button className={calView === 'full' ? 'active' : ''} onClick={() => setCalView('full')}>Full Program</button>
          </div>
        </div>

        <div className="pd-calendar">
          {/* Day headers */}
          <div className="pd-cal-row pd-cal-header">
            <div className="pd-cal-week-label" />
            {DAY_NAMES.map(d => <div key={d} className="pd-cal-cell pd-cal-day-header">{d}</div>)}
          </div>

          {weeksToShow.map(week => (
            <div key={week} className="pd-cal-row">
              <div className="pd-cal-week-label">W{week}</div>
              {[0,1,2,3,4,5,6].map(dow => {
                const slot = byWeek[week]?.[dow];
                const completed = slot?.completed_date;
                return (
                  <div
                    key={dow}
                    className={`pd-cal-cell ${slot ? (slot.is_rest_day ? 'pd-cal-rest' : 'pd-cal-workout') : 'pd-cal-empty'} ${completed ? 'pd-cal-done' : ''}`}
                    onClick={() => slot && !slot.is_rest_day && onStartWorkout && onStartWorkout(programId, slot)}
                    title={slot?.routine_name || (slot?.is_rest_day ? 'Rest' : '')}
                  >
                    {slot && !slot.is_rest_day && (
                      <>
                        <span className="pd-cal-routine-name">{slot.routine_name || 'Workout'}</span>
                        {completed && <span className="pd-cal-check">✓</span>}
                      </>
                    )}
                    {slot?.is_rest_day && <span className="pd-cal-rest-label">Rest</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Day list */}
      <div className="pd-section">
        <h3>Workouts</h3>
        <div className="pd-day-list">
          {days.filter(d => !d.is_rest_day).map((day, i) => (
            <div key={day.id} className={`pd-day-row ${day.completed_date ? 'pd-day-done' : ''}`}>
              <div className="pd-day-info">
                <span className="pd-day-label">Week {day.week_number} · {DAY_NAMES[day.day_of_week] || `Day ${day.order_index}`}</span>
                <span className="pd-day-name">{day.routine_name || 'Unnamed workout'}</span>
                {day.exercise_count > 0 && <span className="pd-day-meta">{day.exercise_count} exercises</span>}
              </div>
              <div className="pd-day-actions">
                {day.completed_date ? (
                  <span className="pd-day-completed">Done ✓</span>
                ) : (
                  data.status === 'active' && onStartWorkout && (
                    <button className="pd-start-day-btn" onClick={() => onStartWorkout(programId, day)}>
                      Start
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Journal */}
      <div className="pd-section">
        <h3>Program Journal</h3>
        <div className="pd-journal-compose">
          <textarea
            ref={journalRef}
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

      {/* Delete */}
      <div className="pd-section pd-danger-zone">
        {!showDeleteConfirm ? (
          <button className="pd-delete-btn" onClick={() => setShowDeleteConfirm(true)}>Delete Program</button>
        ) : (
          <div className="pd-delete-confirm">
            <p>Delete "{data.name}"? This cannot be undone.</p>
            <button className="pd-delete-confirm-btn" onClick={handleDelete}>Yes, Delete</button>
            <button className="pd-cancel-btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
