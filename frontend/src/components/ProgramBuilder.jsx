// frontend/src/components/ProgramBuilder.jsx
import { useState, useEffect } from 'react';
import RoutineBuilder from './RoutineBuilder';
import './ProgramBuilder.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
function authHeaders() { return { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}`, 'Content-Type': 'application/json' }; }

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DURATION_PRESETS = [4, 8, 12];

function buildEmptyWeeks(count) {
  return Array.from({ length: count }, (_, i) => ({ week: i + 1, slots: Array(7).fill(null) }));
}

function slotsFromDays(days, weekCount) {
  const weeks = buildEmptyWeeks(weekCount);
  days.forEach(d => {
    const wi = (d.week_number || 1) - 1;
    const dow = d.day_of_week ?? (d.order_index - 1);
    if (weeks[wi] && dow >= 0 && dow < 7) {
      weeks[wi].slots[dow] = {
        routine_id: d.routine_id || null,
        routine_name: d.routine_name || null,
        is_rest_day: d.is_rest_day || false,
      };
    }
  });
  return weeks;
}

function daysFromSlots(weeks) {
  const days = [];
  weeks.forEach((w, wi) => {
    w.slots.forEach((slot, dow) => {
      if (!slot) return;
      days.push({
        week_number: wi + 1,
        day_of_week: dow,
        order_index: wi * 7 + dow + 1,
        routine_id: slot.routine_id || null,
        is_rest_day: slot.is_rest_day || false,
        notes: null,
      });
    });
  });
  return days;
}

export default function ProgramBuilder({ existingProgram, onSaved, onClose }) {
  const isEditing = !!existingProgram;

  const [name, setName] = useState(existingProgram?.name || '');
  const [description, setDescription] = useState(existingProgram?.description || '');
  const [synopsis, setSynopsis] = useState(existingProgram?.synopsis || '');
  const [durationWeeks, setDurationWeeks] = useState(existingProgram?.duration_weeks || 8);
  const [customDuration, setCustomDuration] = useState('');
  const [scheduleShift, setScheduleShift] = useState(existingProgram?.schedule_shift_pref || 'none');
  const [weeks, setWeeks] = useState(buildEmptyWeeks(existingProgram?.duration_weeks || 8));
  const [routines, setRoutines] = useState([]);
  const [dragging, setDragging] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showRoutineBuilder, setShowRoutineBuilder] = useState(false);

  useEffect(() => {
    fetchRoutines();
    if (existingProgram?.days) {
      setWeeks(slotsFromDays(existingProgram.days, existingProgram.duration_weeks || 8));
    }
  }, []);

  useEffect(() => {
    setWeeks(prev => {
      if (prev.length === durationWeeks) return prev;
      if (durationWeeks > prev.length) {
        const extra = Array.from({ length: durationWeeks - prev.length }, (_, i) => ({
          week: prev.length + i + 1,
          slots: Array(7).fill(null),
        }));
        return [...prev, ...extra];
      }
      return prev.slice(0, durationWeeks);
    });
  }, [durationWeeks]);

  const fetchRoutines = async () => {
    try {
      const res = await fetch(`${API}/routines`, { headers: authHeaders() });
      const data = await res.json();
      setRoutines(data.routines || []);
    } catch (err) {
      console.error('Failed to fetch routines:', err);
    }
  };

  const handleDurationChange = (val) => {
    const n = parseInt(val);
    if (n > 0) setDurationWeeks(n);
  };

  const onDragStartRoutine = (routine) => setDragging({ routine_id: routine.id, routine_name: routine.name });
  const onDragStartSlot = (wi, dow) => setDragging({ from: [wi, dow], ...weeks[wi].slots[dow] });

  const onDropSlot = (wi, dow) => {
    if (!dragging) return;
    setWeeks(prev => {
      const next = prev.map(w => ({ ...w, slots: [...w.slots] }));
      if (dragging.from) {
        const [fwi, fdow] = dragging.from;
        next[fwi].slots[fdow] = null;
      }
      next[wi].slots[dow] = dragging.is_rest_day
        ? { routine_id: null, routine_name: null, is_rest_day: true }
        : { routine_id: dragging.routine_id, routine_name: dragging.routine_name, is_rest_day: false };
      return next;
    });
    setDragging(null);
  };

  const clearSlot = (wi, dow) => {
    setWeeks(prev => {
      const next = prev.map(w => ({ ...w, slots: [...w.slots] }));
      next[wi].slots[dow] = null;
      return next;
    });
  };

  const setRestDay = (wi, dow) => {
    setWeeks(prev => {
      const next = prev.map(w => ({ ...w, slots: [...w.slots] }));
      next[wi].slots[dow] = { routine_id: null, routine_name: null, is_rest_day: true };
      return next;
    });
  };

  // Copy week 1 pattern to all other weeks
  const repeatWeek1 = () => {
    if (weeks.length === 0) return;
    const template = weeks[0].slots;
    setWeeks(prev => prev.map((w, i) => i === 0 ? w : { ...w, slots: template.map(s => s ? { ...s } : null) }));
  };

  // Copy a specific week to all subsequent weeks
  const repeatWeekToAll = (sourceWi) => {
    const template = weeks[sourceWi].slots;
    setWeeks(prev => prev.map((w, i) => i <= sourceWi ? w : { ...w, slots: template.map(s => s ? { ...s } : null) }));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Program name is required.'); return; }
    setError('');
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      synopsis: synopsis.trim() || null,
      duration_weeks: durationWeeks,
      schedule_shift_pref: scheduleShift,
      days: daysFromSlots(weeks),
    };
    try {
      const url = isEditing ? `${API}/programs/${existingProgram.id}` : `${API}/programs`;
      const method = isEditing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      onSaved(data.program);
    } catch (err) {
      console.error('Save program error:', err);
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  // Inline routine builder
  if (showRoutineBuilder) {
    return (
      <RoutineBuilder
        onClose={() => setShowRoutineBuilder(false)}
        onSaved={(newRoutine) => {
          setRoutines(prev => [...prev, { ...newRoutine, exercise_count: newRoutine.exercises?.length || 0 }]);
          setShowRoutineBuilder(false);
        }}
        onDeleted={() => { fetchRoutines(); setShowRoutineBuilder(false); }}
      />
    );
  }

  return (
    <div className="pb-container">
      <div className="pb-topbar">
        <button className="pb-back" onClick={onClose}>← Back</button>
        <h2 className="pb-title">{isEditing ? 'Edit Program' : 'New Program'}</h2>
      </div>

      <div className="pb-section">
        <h3>Details</h3>
        <input className="pb-input" placeholder="Program name" value={name} onChange={e => setName(e.target.value)} />
        <input className="pb-input" placeholder="Short description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
        <textarea className="pb-textarea" placeholder="Program synopsis / about (optional)" value={synopsis} onChange={e => setSynopsis(e.target.value)} rows={3} />
      </div>

      <div className="pb-section">
        <h3>Duration</h3>
        <div className="pb-duration-row">
          {DURATION_PRESETS.map(n => (
            <button key={n} className={`pb-duration-btn ${durationWeeks === n && !customDuration ? 'active' : ''}`}
              onClick={() => { setDurationWeeks(n); setCustomDuration(''); }}>
              {n} weeks
            </button>
          ))}
          <input className="pb-duration-custom" type="number" min={1} placeholder="Custom"
            value={customDuration}
            onChange={e => { setCustomDuration(e.target.value); handleDurationChange(e.target.value); }} />
        </div>
      </div>

      <div className="pb-section">
        <h3>Schedule Flexibility</h3>
        <p className="pb-hint">When a workout is completed late, how should the rest of the program adjust? (Can be changed anytime)</p>
        <div className="pb-shift-row">
          {[
            { value: 'none', label: 'No adjustment' },
            { value: 'shift_week', label: 'Shift rest of week' },
            { value: 'shift_program', label: 'Shift entire program' },
          ].map(opt => (
            <button key={opt.value} className={`pb-shift-btn ${scheduleShift === opt.value ? 'active' : ''}`}
              onClick={() => setScheduleShift(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pb-section">
        <h3>Weekly Schedule</h3>
        <p className="pb-hint">Drag routines onto calendar days. Right-click a slot to mark as rest or clear it.</p>

        <div className="pb-builder-layout">
          {/* Routine palette */}
          <div className="pb-routine-palette">
            <div className="pb-palette-header">
              <h4>Routines</h4>
              <button className="pb-new-routine-btn" onClick={() => setShowRoutineBuilder(true)}>+ New</button>
            </div>
            {routines.length === 0 && <p className="pb-empty">No routines yet.</p>}
            {routines.map(r => (
              <div key={r.id} className="pb-routine-chip" draggable onDragStart={() => onDragStartRoutine(r)}>
                {r.name}
              </div>
            ))}
            <div className="pb-routine-chip pb-rest-chip" draggable
              onDragStart={() => setDragging({ routine_id: null, routine_name: null, is_rest_day: true })}>
              Rest Day
            </div>
          </div>

          {/* Calendar grid */}
          <div className="pb-calendar">
            <div className="pb-cal-row pb-cal-header-row">
              <div className="pb-week-label" />
              {DAY_NAMES.map(d => <div key={d} className="pb-cal-cell pb-cal-header">{d}</div>)}
              <div className="pb-cal-actions-header" />
            </div>

            {weeks.map((wk, wi) => (
              <div key={wi} className="pb-cal-row">
                <div className="pb-week-label">W{wk.week}</div>
                {wk.slots.map((slot, dow) => (
                  <div
                    key={dow}
                    className={`pb-cal-cell ${slot ? (slot.is_rest_day ? 'pb-slot-rest' : 'pb-slot-filled') : 'pb-slot-empty'}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => onDropSlot(wi, dow)}
                    onContextMenu={e => { e.preventDefault(); slot ? clearSlot(wi, dow) : setRestDay(wi, dow); }}
                  >
                    {slot && !slot.is_rest_day && (
                      <div className="pb-slot-content" draggable onDragStart={() => onDragStartSlot(wi, dow)}>
                        <span className="pb-slot-name">{slot.routine_name}</span>
                        <button className="pb-slot-clear" onClick={() => clearSlot(wi, dow)}>✕</button>
                      </div>
                    )}
                    {slot?.is_rest_day && (
                      <div className="pb-slot-content pb-slot-rest-content">
                        <span className="pb-rest-label">Rest</span>
                        <button className="pb-slot-clear" onClick={() => clearSlot(wi, dow)}>✕</button>
                      </div>
                    )}
                  </div>
                ))}
                {/* Per-row repeat action */}
                <div className="pb-row-actions">
                  <button
                    className="pb-repeat-btn"
                    title="Copy this week to all following weeks"
                    onClick={() => repeatWeekToAll(wi)}
                  >↓ Repeat</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {durationWeeks > 1 && (
          <button className="pb-repeat-all-btn" onClick={repeatWeek1}>
            Copy Week 1 to all {durationWeeks - 1} remaining weeks
          </button>
        )}
      </div>

      {error && <p className="pb-error">{error}</p>}

      <div className="pb-actions">
        <button className="pb-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Program'}
        </button>
        <button className="pb-cancel-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
