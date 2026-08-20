// frontend/src/components/WaterWidget.jsx
// Shared water tracking widget — reads/writes same localStorage as NutritionPage
// Resets at midnight in the user's local timezone
import { useState, useEffect } from 'react';
import './WaterWidget.css';

export const WATER_PRESETS_ALL = [4, 8, 12, 16, 24, 32, 48];

// ── Shared storage helpers ───────────────────────────────────────────────────
export function getLocalDateStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

export function waterStorageKey(date) { return `ripfit_water_${date}`; }
export const WATER_GOAL_KEY   = 'ripfit_water_goal';
export const WATER_PRESET_KEY = 'ripfit_water_preset';

export function readWater(date) {
  return parseFloat(localStorage.getItem(waterStorageKey(date)) || '0') || 0;
}
export function writeWater(date, val) {
  localStorage.setItem(waterStorageKey(date), String(Math.max(0, val)));
  // Notify other components via storage event
  window.dispatchEvent(new StorageEvent('storage', { key: waterStorageKey(date), newValue: String(val) }));
}
export function readGoal()   { return parseFloat(localStorage.getItem(WATER_GOAL_KEY) || '64') || 64; }
export function writeGoal(v) { localStorage.setItem(WATER_GOAL_KEY, String(v)); }
export function readPreset() { return parseFloat(localStorage.getItem(WATER_PRESET_KEY) || '8') || 8; }

// ── SVG vessel components (shared with NutritionPage) ────────────────────────
export function GlassSVG({ oz, fillPct, size = 48 }) {
  const scale = size / 48;
  const fill = Math.min(1, fillPct);
  const topY = 8, botY = 62;
  const glassH = botY - topY;
  const waterH = glassH * fill;
  const waterY = botY - waterH;
  const clipId = `glass-clip-${oz}-${size}`;
  return (
    <svg width={size} height={size * 1.5} viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={clipId}>
          <polygon points={`8,${topY} 40,${topY} 34,${botY} 14,${botY}`} />
        </clipPath>
      </defs>
      <polygon points={`8,${topY} 40,${topY} 34,${botY} 14,${botY}`}
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      {fill > 0 && (
        <rect x="0" y={waterY} width="48" height={waterH + 2}
          fill="#3b82f6" opacity="0.35" clipPath={`url(#${clipId})`} />
      )}
      <text x="24" y="38" textAnchor="middle" fontSize="11" fontWeight="700"
        fill="var(--text-primary)">{oz}</text>
      <text x="24" y="50" textAnchor="middle" fontSize="8"
        fill="var(--text-secondary)">oz</text>
    </svg>
  );
}

export function BottleSVG({ oz, fillPct, size = 48 }) {
  const fill = Math.min(1, fillPct);
  const bodyH = 44;
  const waterH = bodyH * fill;
  const waterY = 20 + bodyH - waterH;
  return (
    <svg width={size} height={size * 1.5} viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="4" width="12" height="8" rx="2"
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      <path d="M16 12 L14 20 L34 20 L32 12 Z"
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      <rect x="10" y="20" width="28" height={bodyH} rx="4"
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      {fill > 0 && (
        <>
          <clipPath id={`bottle-clip-${oz}-${size}`}>
            <rect x="10" y="20" width="28" height={bodyH} rx="4" />
          </clipPath>
          <rect x="10" y={waterY} width="28" height={waterH + 4}
            fill="#3b82f6" opacity="0.35" clipPath={`url(#bottle-clip-${oz}-${size})`} />
        </>
      )}
      <text x="24" y="46" textAnchor="middle" fontSize="11" fontWeight="700"
        fill="var(--text-primary)">{oz}</text>
      <text x="24" y="57" textAnchor="middle" fontSize="8"
        fill="var(--text-secondary)">oz</text>
    </svg>
  );
}

// ── Compact water widget ──────────────────────────────────────────────────────
// Shows vessel SVG + x/goal oz + gear button for settings
export default function WaterWidget() {
  const date = getLocalDateStr();
  const [consumed, setConsumed] = useState(() => readWater(date));
  const [goal, setGoal]         = useState(() => readGoal());
  const [preset, setPreset]     = useState(() => readPreset());
  const [showSettings, setShowSettings] = useState(false);
  const [goalInput, setGoalInput]       = useState(String(readGoal()));
  const [history, setHistory]           = useState([]);

  // Sync with NutritionPage via storage events
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === waterStorageKey(date)) {
        setConsumed(parseFloat(e.newValue || '0') || 0);
      }
      if (e.key === WATER_GOAL_KEY) {
        const g = parseFloat(e.newValue || '64') || 64;
        setGoal(g);
        setGoalInput(String(g));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [date]);

  // Midnight reset — re-read on date change
  useEffect(() => {
    setConsumed(readWater(date));
  }, [date]);

  const pct = Math.min(1, goal > 0 ? consumed / goal : 0);
  const isBottle = preset >= 16;

  const add = () => {
    setHistory(h => [...h, consumed]);
    const next = consumed + preset;
    setConsumed(next);
    writeWater(date, next);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setConsumed(prev);
    writeWater(date, prev);
  };

  const saveGoal = () => {
    const v = parseFloat(goalInput) || 64;
    setGoal(v);
    writeGoal(v);
    setShowSettings(false);
  };

  const selectPreset = (oz) => {
    setPreset(oz);
    localStorage.setItem(WATER_PRESET_KEY, String(oz));
  };

  return (
    <div className="ww-widget">
      {/* Vessel — tap to add */}
      <button className="ww-vessel-btn" onClick={add} title={`Add ${preset} oz`}>
        {isBottle
          ? <BottleSVG oz={preset} fillPct={pct} size={36} />
          : <GlassSVG oz={preset} fillPct={pct} size={36} />}
      </button>

      {/* Label */}
      <div className="ww-label">
        <span className="ww-consumed">{Math.round(consumed)}</span>
        <span className="ww-goal">/{goal}oz</span>
      </div>

      {/* Gear */}
      <button className="ww-gear-btn" onClick={() => setShowSettings(s => !s)} title="Water settings">⚙</button>

      {/* Settings panel */}
      {showSettings && (
        <div className="ww-settings-panel">
          <div className="ww-settings-row">
            <span>Daily goal</span>
            <input
              type="number"
              value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              className="ww-settings-input"
              min={1}
            />
            <span>oz</span>
            <button className="ww-settings-save" onClick={saveGoal}>Save</button>
          </div>
          <div className="ww-settings-row">
            <span>Tap adds</span>
            <div className="ww-preset-row">
              {WATER_PRESETS_ALL.map(oz => (
                <button
                  key={oz}
                  className={`ww-preset-btn ${preset === oz ? 'active' : ''}`}
                  onClick={() => selectPreset(oz)}
                >
                  {oz}oz
                </button>
              ))}
            </div>
          </div>
          {history.length > 0 && (
            <button className="ww-undo-btn" onClick={undo}>↩ Undo last</button>
          )}
          <button className="ww-settings-close" onClick={() => setShowSettings(false)}>Close</button>
        </div>
      )}
    </div>
  );
}