// frontend/src/components/ProgramBuilder.jsx
import { useState, useEffect } from 'react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin,
} from '@dnd-kit/core';
import RoutineBuilder from './RoutineBuilder';
import { useUserPrefs } from '../contexts/UserPrefsContext';
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

// ── Schedule drag & drop ───────────────────────────────────────────────────
// @dnd-kit replaces the old HTML5 drag events, which never fire on touch
// screens (and right-click, the only other control, doesn't exist there).

/** Routine / Rest Day chip in the palette. Draggable in both reorder modes —
 *  assigning a routine to a day is not reordering. */
function PaletteChip({ id, label, payload, rest }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id, data: { kind: 'palette', ...payload } });
  return (
    <div
      ref={setNodeRef}
      className={`pb-routine-chip ${rest ? 'pb-rest-chip' : ''} ${isDragging ? 'pb-dragging-source' : ''}`}
      {...listeners}
      {...attributes}
    >
      {label}
    </div>
  );
}

/** Drop target for one day of one week. */
function CalendarCell({ wi, dow, slot, children, onContextMenu }) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${wi}:${dow}`, data: { wi, dow } });
  return (
    <div
      ref={setNodeRef}
      className={`pb-cal-cell ${slot ? (slot.is_rest_day ? 'pb-slot-rest' : 'pb-slot-filled') : 'pb-slot-empty'} ${isOver ? 'pb-drop-target' : ''}`}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}

/** ⠿ handle that picks up a filled day (drag mode only). */
function SlotHandle({ wi, dow, slot }) {
  const { setNodeRef, listeners, attributes } = useDraggable({
    id: `slot:${wi}:${dow}`,
    data: { kind: 'slot', from: [wi, dow], ...slot },
  });
  return (
    <button ref={setNodeRef} type="button" className="pb-slot-handle" title="Drag to another day"
      aria-label={`Move ${slot.is_rest_day ? 'rest day' : slot.routine_name}`} {...listeners} {...attributes}>
      ⠿
    </button>
  );
}

export default function ProgramBuilder({ existingProgram, onSaved, onClose, onDeleted }) {
  const isEditing = !!existingProgram;

  const [name, setName] = useState(existingProgram?.name || '');
  const [description, setDescription] = useState(existingProgram?.description || '');
  const [synopsis, setSynopsis] = useState(existingProgram?.synopsis || '');
  const [durationWeeks, setDurationWeeks] = useState(existingProgram?.duration_weeks || 8);
  const [customDuration, setCustomDuration] = useState('');
  const [scheduleShift, setScheduleShift] = useState(existingProgram?.schedule_shift_pref || 'none');
  const [overloadStrategy, setOverloadStrategy] = useState(existingProgram?.overload_strategy || 'none');
  const [overloadIncrement, setOverloadIncrement] = useState(
    existingProgram?.overload_increment != null ? String(existingProgram.overload_increment) : ''
  );
  const [weeks, setWeeks] = useState(buildEmptyWeeks(existingProgram?.duration_weeks || 8));
  const [routines, setRoutines] = useState([]);
  const [activeDrag, setActiveDrag] = useState(null);   // data of the item being dragged, for the overlay
  const { prefs } = useUserPrefs();
  const reorderMode = prefs.reorder_mode;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showRoutineBuilder, setShowRoutineBuilder] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const slotFrom = (d) => (d.is_rest_day
    ? { routine_id: null, routine_name: null, is_rest_day: true }
    : { routine_id: d.routine_id, routine_name: d.routine_name, is_rest_day: false });

  // Palette → day assigns (overwriting). Day → day moves, swapping with the
  // target if it's already filled so nothing is silently lost.
  const handleDragEnd = ({ active, over }) => {
    setActiveDrag(null);
    const d = active?.data?.current;
    const target = over?.data?.current;
    if (!d || !target) return;
    const { wi, dow } = target;

    setWeeks(prev => {
      const next = prev.map(w => ({ ...w, slots: [...w.slots] }));
      if (d.kind === 'slot') {
        const [fwi, fdow] = d.from;
        if (fwi === wi && fdow === dow) return prev;
        const displaced = next[wi].slots[dow];
        next[wi].slots[dow] = next[fwi].slots[fdow];
        next[fwi].slots[fdow] = displaced;
      } else {
        next[wi].slots[dow] = slotFrom(d);
      }
      return next;
    });
  };

  // Arrow mode: swap a day with the previous / next day in program order.
  const moveSlot = (wi, dow, delta) => {
    const flat = wi * 7 + dow;
    const to = flat + delta;
    if (to < 0 || to >= weeks.length * 7) return;
    const twi = Math.floor(to / 7);
    const tdow = to % 7;
    setWeeks(prev => {
      const next = prev.map(w => ({ ...w, slots: [...w.slots] }));
      const displaced = next[twi].slots[tdow];
      next[twi].slots[tdow] = next[wi].slots[dow];
      next[wi].slots[dow] = displaced;
      return next;
    });
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

  // Copy a specific week to the immediately following week only
  const repeatWeekToNext = (sourceWi) => {
    if (sourceWi >= weeks.length - 1) return;
    const template = weeks[sourceWi].slots;
    setWeeks(prev => prev.map((w, i) =>
      i === sourceWi + 1 ? { ...w, slots: template.map(s => s ? { ...s } : null) } : w
    ));
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
      overload_strategy: overloadStrategy,
      overload_increment: overloadStrategy === 'none' || overloadIncrement === ''
        ? null
        : parseFloat(overloadIncrement),
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

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`${API}/programs/${existingProgram.id}`, { method: 'DELETE', headers: authHeaders() });
      onDeleted?.();
    } catch (err) {
      console.error('Delete program error:', err);
      setError('Failed to delete. Try again.');
      setDeleting(false);
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
        <h3>Progressive Overload</h3>
        <p className="pb-hint">
          When every set of a program workout hits its targets, suggest a bump for next time.
          Suggestions are always confirmed by you before anything changes.
        </p>
        <div className="pb-overload-row">
          <label className="pb-overload-field">
            <span>Strategy</span>
            <select value={overloadStrategy} onChange={e => setOverloadStrategy(e.target.value)}>
              <option value="none">None</option>
              <option value="weight">Weight</option>
              <option value="reps">Reps</option>
            </select>
          </label>
          {overloadStrategy !== 'none' && (
            <label className="pb-overload-field">
              <span>Increment {overloadStrategy === 'weight' ? '(lbs)' : '(reps)'}</span>
              <input
                type="number"
                step={overloadStrategy === 'weight' ? '0.5' : '1'}
                min="0"
                placeholder={overloadStrategy === 'weight' ? '2.5' : '1'}
                value={overloadIncrement}
                onChange={e => setOverloadIncrement(e.target.value)}
              />
            </label>
          )}
        </div>
        <p className="pb-hint pb-overload-note">
          These are program-wide defaults. Individual exercises in each routine can override them.
        </p>
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
        <p className="pb-hint">
          Drag routines onto calendar days (on touch screens, press and hold, then drag).{' '}
          {reorderMode === 'arrows'
            ? 'Use ↑ ↓ on a day to move it earlier or later.'
            : 'Drag a day by its ⠿ handle to move it; dropping on a filled day swaps them.'}{' '}
          Right-click a day to mark it as rest or clear it.
        </p>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={({ active }) => setActiveDrag(active.data.current)}
          onDragCancel={() => setActiveDrag(null)}
          onDragEnd={handleDragEnd}
        >
        <div className="pb-builder-layout">
          {/* Routine palette */}
          <div className="pb-routine-palette">
            <div className="pb-palette-header">
              <h4>Routines</h4>
              <button className="pb-new-routine-btn" onClick={() => setShowRoutineBuilder(true)}>+ New</button>
            </div>
            {routines.length === 0 && <p className="pb-empty">No routines yet.</p>}
            {routines.map(r => (
              <PaletteChip key={r.id} id={`palette:${r.id}`} label={r.name}
                payload={{ routine_id: r.id, routine_name: r.name, is_rest_day: false }} />
            ))}
            <PaletteChip id="palette:rest" label="Rest Day" rest
              payload={{ routine_id: null, routine_name: null, is_rest_day: true }} />
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
                {wk.slots.map((slot, dow) => {
                  const flat = wi * 7 + dow;
                  return (
                    <CalendarCell
                      key={dow}
                      wi={wi}
                      dow={dow}
                      slot={slot}
                      onContextMenu={e => { e.preventDefault(); slot ? clearSlot(wi, dow) : setRestDay(wi, dow); }}
                    >
                      {slot && (
                        <div className={`pb-slot-content ${slot.is_rest_day ? 'pb-slot-rest-content' : ''}`}>
                          {reorderMode === 'drag' && <SlotHandle wi={wi} dow={dow} slot={slot} />}
                          {slot.is_rest_day
                            ? <span className="pb-rest-label">Rest</span>
                            : <span className="pb-slot-name">{slot.routine_name}</span>}
                          {reorderMode === 'arrows' && (
                            <span className="pb-slot-arrows">
                              <button type="button" onClick={() => moveSlot(wi, dow, -1)} disabled={flat === 0}
                                aria-label="Move to previous day" title="Move to previous day">↑</button>
                              <button type="button" onClick={() => moveSlot(wi, dow, 1)} disabled={flat === weeks.length * 7 - 1}
                                aria-label="Move to next day" title="Move to next day">↓</button>
                            </span>
                          )}
                          <button className="pb-slot-clear" onClick={() => clearSlot(wi, dow)} aria-label="Clear day">✕</button>
                        </div>
                      )}
                    </CalendarCell>
                  );
                })}
                <div className="pb-row-actions">
                  {wi < weeks.length - 1 && (
                    <button
                      className="pb-repeat-btn"
                      title="Copy this week to next week"
                      onClick={() => repeatWeekToNext(wi)}
                    >↓ Next</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <div className={`pb-routine-chip pb-drag-overlay ${activeDrag.is_rest_day ? 'pb-rest-chip' : ''}`}>
              {activeDrag.is_rest_day ? 'Rest Day' : activeDrag.routine_name}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>

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

      {isEditing && (
        <div className="pb-danger-zone">
          {!showDeleteConfirm ? (
            <button className="pb-delete-btn" onClick={() => setShowDeleteConfirm(true)}>Delete Program</button>
          ) : (
            <div className="pb-delete-confirm">
              <p>Delete "{existingProgram.name}"? This cannot be undone.</p>
              <button className="pb-delete-confirm-btn" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
              <button className="pb-cancel-btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
