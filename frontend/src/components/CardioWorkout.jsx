import { useState } from 'react';
import './CardioWorkout.css';

// Cardio type definitions with subcategory and field config
export const CARDIO_TYPES = [
  { name: 'Indoor Cycling',   subcategory: 'Cycling',   fields: ['duration','distance','pace'] },
  { name: 'Outdoor Cycling',  subcategory: 'Cycling',   fields: ['duration','distance','pace','elevation'] },
  { name: 'Treadmill',        subcategory: 'Machine',   fields: ['duration','distance','pace'] },
  { name: 'Outdoor Running',  subcategory: 'Running',   fields: ['duration','distance','pace','elevation'] },
  { name: 'Indoor Running',   subcategory: 'Running',   fields: ['duration','distance','pace'] },
  { name: 'Walking',          subcategory: 'Walking',   fields: ['duration','distance','pace'] },
  { name: 'Hiking',           subcategory: 'Walking',   fields: ['duration','distance','pace','elevation'] },
  { name: 'Elliptical',       subcategory: 'Machine',   fields: ['duration','distance','pace'] },
  { name: 'Rowing Machine',   subcategory: 'Machine',   fields: ['duration','distance','pace'] },
  { name: 'Swimming',         subcategory: 'Swimming',  fields: ['duration','laps','lap_distance'] },
  { name: 'Jump Rope',        subcategory: 'Interval',  fields: ['duration','reps'] },
  { name: 'Stair Climber',    subcategory: 'Machine',   fields: ['duration','floors','pace'] },
  { name: 'HIIT',             subcategory: 'Interval',  fields: ['duration','reps'] },
  { name: 'Sprints',          subcategory: 'Interval',  fields: ['duration','distance','reps'] },
  { name: 'Suicides / Shuttles', subcategory: 'Interval', fields: ['duration','reps'] },
];

// Quick Cardio launcher — select type + goals, then hands off to WorkoutInProgress
// onStart(cardioTypeDef, goals) is called when user hits Start
export default function CardioWorkout({ onStart, onClose }) {
  const [phase, setPhase] = useState('select'); // select | goals
  const [selected, setSelected] = useState(null);
  const [goals, setGoals] = useState({
    duration: '',       // minutes
    distance: '',
    distance_unit: 'mi',
    pace: '',           // MM:SS per unit
    pre_session_notes: '',
    laps: '',
    lap_distance: '',   // metres
    floors: '',
  });

  const handleStart = () => {
    onStart(selected, goals);
  };

  if (phase === 'select') return (
    <div className="cardio-overlay">
      <div className="cardio-card">
        <div className="cardio-header">
          <h2>Quick Cardio</h2>
          <button className="cardio-close" onClick={onClose}>✕</button>
        </div>
        <div className="cardio-type-grid">
          {CARDIO_TYPES.map(t => (
            <button
              key={t.name}
              className={`cardio-type-btn ${selected?.name === t.name ? 'active' : ''}`}
              onClick={() => setSelected(t)}
            >{t.name}</button>
          ))}
        </div>
        <button
          className="cardio-primary-btn"
          disabled={!selected}
          onClick={() => setPhase('goals')}
        >Next</button>
      </div>
    </div>
  );

  // Goals phase
  const hasField = (f) => selected?.fields?.includes(f);

  return (
    <div className="cardio-overlay">
      <div className="cardio-card">
        <div className="cardio-header">
          <h2>{selected.name}</h2>
          <button className="cardio-close" onClick={onClose}>✕</button>
        </div>
        <p className="cardio-subtitle">Set goals — all optional</p>
        <div className="cardio-form">

          {hasField('duration') && (
            <>
              <label>Goal duration (minutes)</label>
              <input type="number" placeholder="e.g. 45" value={goals.duration}
                onChange={e => setGoals(g => ({ ...g, duration: e.target.value }))} />
            </>
          )}

          {hasField('distance') && (
            <>
              <label>Goal distance</label>
              <div className="cardio-row">
                <input type="number" step="0.1" placeholder="e.g. 5" value={goals.distance}
                  onChange={e => setGoals(g => ({ ...g, distance: e.target.value }))} />
                <select value={goals.distance_unit}
                  onChange={e => setGoals(g => ({ ...g, distance_unit: e.target.value }))}>
                  <option value="mi">mi</option>
                  <option value="km">km</option>
                  <option value="m">m</option>
                </select>
              </div>
            </>
          )}

          {hasField('pace') && (
            <>
              <label>Goal pace (MM:SS per {goals.distance_unit || 'mi'})</label>
              <input type="text" placeholder="e.g. 8:30" value={goals.pace}
                onChange={e => setGoals(g => ({ ...g, pace: e.target.value }))} />
            </>
          )}

          {hasField('laps') && (
            <>
              <label>Goal laps</label>
              <input type="number" placeholder="e.g. 20" value={goals.laps}
                onChange={e => setGoals(g => ({ ...g, laps: e.target.value }))} />
              <label>Lap distance (metres)</label>
              <input type="number" placeholder="e.g. 25 or 50" value={goals.lap_distance}
                onChange={e => setGoals(g => ({ ...g, lap_distance: e.target.value }))} />
            </>
          )}

          {hasField('floors') && (
            <>
              <label>Goal floors</label>
              <input type="number" placeholder="e.g. 30" value={goals.floors}
                onChange={e => setGoals(g => ({ ...g, floors: e.target.value }))} />
            </>
          )}

          <label>Pre-session notes</label>
          <textarea placeholder="How are you feeling? Any plans?"
            value={goals.pre_session_notes}
            onChange={e => setGoals(g => ({ ...g, pre_session_notes: e.target.value }))} />
        </div>

        <div className="cardio-btn-row">
          <button className="cardio-secondary-btn" onClick={() => setPhase('select')}>Back</button>
          <button className="cardio-primary-btn" onClick={handleStart}>Start Workout</button>
        </div>
      </div>
    </div>
  );
}
