// frontend/src/components/NutritionPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import './NutritionPage.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
function token() { return localStorage.getItem('ripfit_token'); }

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };

// ── Helpers ───────────────────────────────────────────────────────────────
function toLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}

function round1(n) { return Math.round((n || 0) * 10) / 10; }

// ── Macro progress ring (SVG) ─────────────────────────────────────────────
function MacroRing({ label, current, target, color, unit = 'g' }) {
  const pct = Math.min(1, target > 0 ? current / target : 0);
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const over = current > target && target > 0;

  return (
    <div className="macro-ring-item">
      <svg width="72" height="72" viewBox="0 0 72 72">
        {/* Track */}
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--bg-tertiary)" strokeWidth="6" />
        {/* Fill */}
        <circle
          cx="36" cy="36" r={r}
          fill="none"
          stroke={over ? 'var(--color-danger)' : color}
          strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
        />
        {/* Center text */}
        <text x="36" y="33" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text-primary)">{Math.round(current)}</text>
        <text x="36" y="44" textAnchor="middle" fontSize="8" fill="var(--text-secondary)">/{target}</text>
      </svg>
      <span className="macro-ring-label">{label}</span>
      <span className="macro-ring-unit">{unit}</span>
    </div>
  );
}

// ── Macro bar (linear) ────────────────────────────────────────────────────
function MacroBar({ label, current, target, color }) {
  const pct = Math.min(100, target > 0 ? (current / target) * 100 : 0);
  const over = current > target && target > 0;
  return (
    <div className="macro-bar-item">
      <div className="macro-bar-header">
        <span className="macro-bar-label">{label}</span>
        <span className="macro-bar-values" style={{ color: over ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
          {Math.round(current)} / {target}g
        </span>
      </div>
      <div className="macro-bar-track">
        <div className="macro-bar-fill" style={{ width: `${pct}%`, background: over ? 'var(--color-danger)' : color }} />
      </div>
    </div>
  );
}

// ── Macro ratio stacked bar (shows proportion of P/C/F in a meal) ─────────
function MacroRatioBar({ protein, carbs, fat }) {
  const total = (protein * 4) + (carbs * 4) + (fat * 9); // calories from each
  if (total === 0) return null;
  const pPct = (protein * 4 / total) * 100;
  const cPct = (carbs * 4 / total) * 100;
  const fPct = (fat * 9 / total) * 100;
  return (
    <div className="macro-ratio-bar-wrapper">
      <div className="macro-ratio-bar">
        <div style={{ width: `${pPct}%`, background: '#3b82f6', borderRadius: '3px 0 0 3px' }} title={`Protein ${Math.round(pPct)}%`} />
        <div style={{ width: `${cPct}%`, background: '#f59e0b' }} title={`Carbs ${Math.round(cPct)}%`} />
        <div style={{ width: `${fPct}%`, background: '#ef4444', borderRadius: '0 3px 3px 0' }} title={`Fat ${Math.round(fPct)}%`} />
      </div>
      <div className="macro-ratio-legend">
        <span style={{ color: '#3b82f6' }}>P {Math.round(pPct)}%</span>
        <span style={{ color: '#f59e0b' }}>C {Math.round(cPct)}%</span>
        <span style={{ color: '#ef4444' }}>F {Math.round(fPct)}%</span>
      </div>
    </div>
  );
}

// ── Meal-level compact macro bar ─────────────────────────────────────────
function MealMacroBar({ label, current, target, color }) {
  const pct = Math.min(100, target > 0 ? (current / target) * 100 : 0);
  const over = current > target && target > 0;
  return (
    <div className="meal-macro-bar">
      <span className="meal-macro-label" style={{ color }}>{label}</span>
      <div className="meal-macro-track">
        <div className="meal-macro-fill" style={{
          width: `${pct}%`,
          background: over ? 'var(--color-danger)' : color
        }} />
      </div>
      <span className="meal-macro-value" style={{ color: over ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
        {current}/{target}g
      </span>
    </div>
  );
}

// ── Water SVG components ──────────────────────────────────────────────────
function GlassSVG({ oz, fillPct }) {
  const fill = Math.min(1, fillPct);
  // Glass: wide at top (x=8..40), narrow at bottom (x=14..34), height 52
  const topY = 8, botY = 62;
  const glassH = botY - topY;
  const waterH = glassH * fill;
  const waterY = botY - waterH;
  const clipId = `glass-clip-${oz}`;
  return (
    <svg width="48" height="72" viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={clipId}>
          <polygon points={`8,${topY} 40,${topY} 34,${botY} 14,${botY}`} />
        </clipPath>
      </defs>
      {/* Glass outline */}
      <polygon points={`8,${topY} 40,${topY} 34,${botY} 14,${botY}`}
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      {/* Water fill */}
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

function BottleSVG({ oz, fillPct }) {
  const fill = Math.min(1, fillPct);
  const bodyH = 44;
  const waterH = bodyH * fill;
  const waterY = 20 + bodyH - waterH;
  return (
    <svg width="48" height="72" viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg">
      {/* Bottle cap */}
      <rect x="18" y="4" width="12" height="8" rx="2"
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      {/* Bottle neck */}
      <path d="M16 12 L14 20 L34 20 L32 12 Z"
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      {/* Bottle body */}
      <rect x="10" y="20" width="28" height={bodyH} rx="4"
        fill="none" stroke="var(--border-color)" strokeWidth="1.5" />
      {/* Water fill */}
      {fill > 0 && (
        <>
          <clipPath id="bottle-clip">
            <rect x="10" y="20" width="28" height={bodyH} rx="4" />
          </clipPath>
          <rect x="10" y={waterY} width="28" height={waterH + 4}
            fill="#3b82f6" opacity="0.35" clipPath="url(#bottle-clip)" />
        </>
      )}
      {/* Oz label */}
      <text x="24" y="46" textAnchor="middle" fontSize="11" fontWeight="700"
        fill="var(--text-primary)">{oz}</text>
      <text x="24" y="57" textAnchor="middle" fontSize="8"
        fill="var(--text-secondary)">oz</text>
    </svg>
  );
}

// ── Water tracker ─────────────────────────────────────────────────────────
const WATER_PRESETS_ALL = [4, 8, 12, 16, 24, 32, 48]; // oz

function WaterTracker({ date }) {
  const [consumed, setConsumed] = useState(0);
  const [history, setHistory] = useState([]); // undo stack
  const [goal, setGoal] = useState(64);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('64');
  const [selectedPreset, setSelectedPreset] = useState(8);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const storageKey = `ripfit_water_${date}`;
  const goalKey = 'ripfit_water_goal';
  const presetKey = 'ripfit_water_preset';

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    const savedGoal = localStorage.getItem(goalKey);
    const savedPreset = localStorage.getItem(presetKey);
    if (saved) setConsumed(parseFloat(saved) || 0);
    if (savedGoal) { setGoal(parseFloat(savedGoal) || 64); setGoalInput(savedGoal); }
    if (savedPreset) setSelectedPreset(parseFloat(savedPreset) || 8);
  }, [date]);

  function addWater(oz) {
    setHistory(h => [...h, consumed]);
    const newVal = consumed + oz;
    setConsumed(newVal);
    localStorage.setItem(storageKey, String(newVal));
  }

  function undo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setConsumed(prev);
    localStorage.setItem(storageKey, String(prev));
  }

  function selectPreset(oz) {
    setSelectedPreset(oz);
    setPresetsOpen(false);
    localStorage.setItem(presetKey, String(oz));
  }

  function saveGoal() {
    const val = parseFloat(goalInput) || 64;
    setGoal(val);
    localStorage.setItem(goalKey, String(val));
    setEditingGoal(false);
  }

  const pct = Math.min(1, goal > 0 ? consumed / goal : 0);
  const remaining = Math.max(0, goal - consumed);
  const isBottle = selectedPreset >= 16;

  return (
    <div className="nutri-water-card">
      <div className="nutri-water-header">
        <span className="nutri-water-title">Water Intake</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {history.length > 0 && (
            <button className="nutri-water-undo-btn" onClick={undo} title="Undo last entry">
              ↩ Undo
            </button>
          )}
          <button className="nutri-water-goal-btn" onClick={() => setEditingGoal(e => !e)}>
            Goal: {goal} oz
          </button>
        </div>
      </div>
      {editingGoal && (
        <div className="nutri-water-goal-edit">
          <input type="number" value={goalInput} onChange={e => setGoalInput(e.target.value)}
            className="nutri-water-goal-input" min={1} />
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>oz</span>
          <button className="nutri-add-btn" style={{ padding: '6px 12px', fontSize: 'var(--font-size-xs)' }} onClick={saveGoal}>Save</button>
        </div>
      )}

      {/* Progress bar */}
      <div className="nutri-water-progress">
        <div className="nutri-water-track">
          <div className="nutri-water-fill" style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="nutri-water-stats">
          <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>{consumed} oz</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
            {remaining > 0 ? `${remaining} oz remaining` : '🎉 Goal reached!'}
          </span>
        </div>
      </div>

      {/* SVG + add button + preset selector */}
      <div className="nutri-water-action-row">
        {/* Clickable vessel SVG — adds water */}
        <button className="nutri-water-vessel-btn" onClick={() => addWater(selectedPreset)} title={`Add ${selectedPreset} oz`}>
          {isBottle
            ? <BottleSVG oz={selectedPreset} fillPct={pct} />
            : <GlassSVG oz={selectedPreset} fillPct={pct} />}
          <span className="nutri-water-vessel-hint">tap to add</span>
        </button>

        {/* Preset selector — slides out */}
        <div className="nutri-water-preset-wrapper">
          <button
            className={`nutri-water-preset-toggle ${presetsOpen ? 'open' : ''}`}
            onClick={() => setPresetsOpen(o => !o)}
            title="Choose amount"
          >
            ◀
          </button>
          {presetsOpen && (
            <div className="nutri-water-preset-panel">
              {WATER_PRESETS_ALL.map(oz => (
                <button
                  key={oz}
                  className={`nutri-water-preset-option ${selectedPreset === oz ? 'active' : ''}`}
                  onClick={() => selectPreset(oz)}
                >
                  {oz} oz
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Food search modal ─────────────────────────────────────────────────────
function FoodSearchModal({ mealType, mealDate, onClose, onAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [serving, setServing] = useState('100');
  const [servingUnit, setServingUnit] = useState('g');
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState('search'); // 'search' | 'custom'
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // Custom food form state
  const [custom, setCustom] = useState({
    name: '', brand: '', serving_size: '100', serving_unit: 'g',
    calories_per_100g: '', protein_per_100g: '', carbs_per_100g: '',
    fat_per_100g: '', fiber_per_100g: ''
  });
  const [customSaving, setCustomSaving] = useState(false);
  const [customMsg, setCustomMsg] = useState('');

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `${API_BASE}/nutrition/foods/usda-search?q=${encodeURIComponent(query)}&limit=20`,
          { headers: { Authorization: `Bearer ${token()}` } }
        );
        const data = await res.json();
        setResults(data.foods || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  }, [query]);

  // Preview macros for selected food at current serving
  const UNIT_TO_G = { g: 1, ml: 1, oz: 28.3495 };
  const previewMacros = selected ? (() => {
    const servingG = parseFloat(serving || 0) * (UNIT_TO_G[servingUnit] || 1);
    const mult = servingG / 100;
    return {
      cal: round1(selected.calories_per_100g * mult),
      pro: round1(selected.protein_per_100g * mult),
      carb: round1(selected.carbs_per_100g * mult),
      fat: round1(selected.fat_per_100g * mult),
    };
  })() : null;

  async function addFood() {
    if (!selected || !serving || parseFloat(serving) <= 0) return;
    setAdding(true);
    try {
      // If USDA result (has fdc_id, no db id), save to foods table first
      let food_id = selected.id;
      if (!food_id && selected.fdc_id) {
        const saveRes = await fetch(`${API_BASE}/nutrition/foods/custom`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify({
            name: selected.name,
            brand: selected.brand,
            serving_size: selected.serving_size || 100,
            serving_unit: selected.serving_unit || 'g',
            calories_per_100g: selected.calories_per_100g,
            protein_per_100g: selected.protein_per_100g,
            carbs_per_100g: selected.carbs_per_100g,
            fat_per_100g: selected.fat_per_100g,
            fiber_per_100g: selected.fiber_per_100g || 0,
          }),
        });
        const savedFood = await saveRes.json();
        food_id = savedFood.id;
      }

      // Log meal with this food
      const res = await fetch(`${API_BASE}/nutrition/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          meal_date: mealDate,
          meal_type: mealType,
          foods: [{ food_id, serving_size: parseFloat(serving), serving_unit: servingUnit }],
        }),
      });
      if (!res.ok) throw new Error();
      onAdded();
      onClose();
    } catch (e) {
      console.error('Add food error:', e);
    } finally {
      setAdding(false);
    }
  }

  async function saveCustomFood() {
    if (!custom.name || !custom.calories_per_100g) {
      setCustomMsg('Name and calories are required.');
      return;
    }
    setCustomSaving(true);
    try {
      const res = await fetch(`${API_BASE}/nutrition/foods/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          ...custom,
          calories_per_100g: parseFloat(custom.calories_per_100g),
          protein_per_100g: parseFloat(custom.protein_per_100g) || 0,
          carbs_per_100g: parseFloat(custom.carbs_per_100g) || 0,
          fat_per_100g: parseFloat(custom.fat_per_100g) || 0,
          fiber_per_100g: parseFloat(custom.fiber_per_100g) || 0,
          serving_size: parseFloat(custom.serving_size) || 100,
        }),
      });
      const food = await res.json();
      // Now add it to the meal
      await fetch(`${API_BASE}/nutrition/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          meal_date: mealDate,
          meal_type: mealType,
          foods: [{ food_id: food.id, serving_size: parseFloat(custom.serving_size) || 100, serving_unit: custom.serving_unit || 'g' }],
        }),
      });
      onAdded();
      onClose();
    } catch {
      setCustomMsg('Failed to save. Try again.');
    } finally {
      setCustomSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="nutri-search-modal" onClick={e => e.stopPropagation()}>
        <div className="nutri-modal-header">
          <h3>Add to {MEAL_LABELS[mealType]}</h3>
          <button className="nutri-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="nutri-modal-tabs">
          <button className={`nutri-modal-tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>Search Foods</button>
          <button className={`nutri-modal-tab ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>Custom Food</button>
        </div>

        {tab === 'search' && (
          <>
            <input
              ref={searchRef}
              className="nutri-search-input"
              placeholder="Search foods (e.g. chicken breast, banana)…"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelected(null); }}
            />

            {searching && <p className="nutri-search-status">Searching…</p>}

            {!selected && results.length > 0 && (
              <div className="nutri-results-list">
                {results.map((f, i) => (
                  <div key={i} className="nutri-result-item" onClick={() => { setSelected(f); setServing(String(f.serving_size || 100)); }}>
                    <div className="nutri-result-name">{f.name}</div>
                    <div className="nutri-result-meta">
                      {f.brand && <span>{f.brand} · </span>}
                      <span>{Math.round(f.calories_per_100g)} cal/100g</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selected && (
              <div className="nutri-selected-food">
                <div className="nutri-selected-name">{selected.name}</div>
                {selected.brand && <div className="nutri-selected-brand">{selected.brand}</div>}

                <div className="nutri-serving-row">
                  <label>Serving size</label>
                  <input
                    type="number"
                    min="1"
                    value={serving}
                    onChange={e => setServing(e.target.value)}
                    className="nutri-serving-input"
                  />
                  <select
                    value={servingUnit}
                    onChange={e => setServingUnit(e.target.value)}
                    className="nutri-unit-select"
                  >
                    <option value="g">g</option>
                    <option value="ml">ml</option>
                    <option value="oz">oz</option>
                  </select>
                </div>

                {previewMacros && (
                  <div className="nutri-preview-macros">
                    <div className="nutri-preview-cal">{previewMacros.cal} <span>cal</span></div>
                    <div className="nutri-preview-item"><span>P</span> {previewMacros.pro}g</div>
                    <div className="nutri-preview-item"><span>C</span> {previewMacros.carb}g</div>
                    <div className="nutri-preview-item"><span>F</span> {previewMacros.fat}g</div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="nutri-add-btn" onClick={addFood} disabled={adding}>
                    {adding ? 'Adding…' : 'Add to Meal'}
                  </button>
                  <button className="nutri-cancel-btn" onClick={() => setSelected(null)}>Back</button>
                </div>
              </div>
            )}

            {!searching && query.length >= 2 && results.length === 0 && !selected && (
              <p className="nutri-search-status">No results. Try a different term or create a custom food.</p>
            )}
          </>
        )}

        {tab === 'custom' && (
          <div className="nutri-custom-form">
            <div className="nutri-custom-field">
              <label>Food Name *</label>
              <input type="text" value={custom.name} onChange={e => setCustom(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Homemade Protein Bar" />
            </div>
            <div className="nutri-custom-field">
              <label>Brand (optional)</label>
              <input type="text" value={custom.brand} onChange={e => setCustom(f => ({ ...f, brand: e.target.value }))} />
            </div>
            <div className="nutri-custom-row">
              <div className="nutri-custom-field">
                <label>Serving size</label>
                <input type="number" value={custom.serving_size} onChange={e => setCustom(f => ({ ...f, serving_size: e.target.value }))} />
              </div>
              <div className="nutri-custom-field">
                <label>Unit</label>
                <select value={custom.serving_unit} onChange={e => setCustom(f => ({ ...f, serving_unit: e.target.value }))}>
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                  <option value="oz">oz</option>
                </select>
              </div>
            </div>
            <p className="nutri-custom-hint">Enter values per 100g (or per 100ml for liquids)</p>
            <div className="nutri-custom-row">
              <div className="nutri-custom-field"><label>Calories *</label><input type="number" value={custom.calories_per_100g} onChange={e => setCustom(f => ({ ...f, calories_per_100g: e.target.value }))} /></div>
              <div className="nutri-custom-field"><label>Protein (g)</label><input type="number" value={custom.protein_per_100g} onChange={e => setCustom(f => ({ ...f, protein_per_100g: e.target.value }))} /></div>
            </div>
            <div className="nutri-custom-row">
              <div className="nutri-custom-field"><label>Carbs (g)</label><input type="number" value={custom.carbs_per_100g} onChange={e => setCustom(f => ({ ...f, carbs_per_100g: e.target.value }))} /></div>
              <div className="nutri-custom-field"><label>Fat (g)</label><input type="number" value={custom.fat_per_100g} onChange={e => setCustom(f => ({ ...f, fat_per_100g: e.target.value }))} /></div>
            </div>
            <div className="nutri-custom-field"><label>Fiber (g)</label><input type="number" value={custom.fiber_per_100g} onChange={e => setCustom(f => ({ ...f, fiber_per_100g: e.target.value }))} /></div>
            {customMsg && <p style={{ color: 'var(--color-danger)', fontSize: '0.85em' }}>{customMsg}</p>}
            <button className="nutri-add-btn" onClick={saveCustomFood} disabled={customSaving} style={{ marginTop: 12, width: '100%' }}>
              {customSaving ? 'Saving…' : 'Save & Add to Meal'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN NUTRITION PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function NutritionPage() {
  const [date, setDate] = useState(toLocalDateStr());
  const [meals, setMeals] = useState([]);
  const [totals, setTotals] = useState({ total_calories: 0, total_protein: 0, total_carbs: 0, total_fat: 0, total_fiber: 0 });
  const [goals, setGoals] = useState({ calories: 2000, protein: 150, carbs: 200, fat: 65, fiber: 25 });
  const [loading, setLoading] = useState(true);
  const [addingToMeal, setAddingToMeal] = useState(null); // meal_type string
  const [expandedMeals, setExpandedMeals] = useState(new Set(MEAL_TYPES));

  useEffect(() => {
    fetch(`${API_BASE}/nutrition/goals`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.json())
      .then(d => { if (d.targets) setGoals(d.targets); })
      .catch(() => {});
  }, []);

  const fetchDay = useCallback(async () => {
    setLoading(true);
    try {
      const [mealsRes, totalsRes] = await Promise.all([
        fetch(`${API_BASE}/nutrition/meals/${date}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`${API_BASE}/nutrition/daily/${date}`, { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const mealsData = await mealsRes.json();
      const totalsData = await totalsRes.json();
      setMeals(mealsData.meals || []);
      setTotals(totalsData);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { fetchDay(); }, [fetchDay]);

  function changeDate(days) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDate(toLocalDateStr(d));
  }

  async function removeMealFood(mealFoodId) {
    await fetch(`${API_BASE}/nutrition/meal-foods/${mealFoodId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` },
    });
    fetchDay();
  }

  async function removeMeal(mealId) {
    await fetch(`${API_BASE}/nutrition/meals/${mealId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` },
    });
    fetchDay();
  }

  function toggleMeal(type) {
    setExpandedMeals(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }

  // Calculate live totals from meal data (more accurate than DB summary)
  const liveTotals = meals.reduce((acc, meal) => {
    (meal.foods || []).forEach(f => {
      acc.cal += f.calories || 0;
      acc.pro += f.protein || 0;
      acc.carb += f.carbs || 0;
      acc.fat += f.fat || 0;
      acc.fib += f.fiber || 0;
    });
    return acc;
  }, { cal: 0, pro: 0, carb: 0, fat: 0, fib: 0 });

  const mealsByType = MEAL_TYPES.reduce((acc, type) => {
    acc[type] = meals.filter(m => m.meal_type === type);
    return acc;
  }, {});

  const [editingGoals, setEditingGoals] = useState(false);
  const [goalInput, setGoalInput] = useState({ calories: '', protein: '', carbs: '', fat: '', fiber: '' });
  const calRemaining = goals.calories - liveTotals.cal;

  function openGoalEdit() {
    setGoalInput({ calories: String(goals.calories), protein: String(goals.protein), carbs: String(goals.carbs), fat: String(goals.fat), fiber: String(goals.fiber) });
    setEditingGoals(true);
  }
  function saveGoals() {
    setGoals({
      calories: parseInt(goalInput.calories) || goals.calories,
      protein:  parseInt(goalInput.protein)  || goals.protein,
      carbs:    parseInt(goalInput.carbs)    || goals.carbs,
      fat:      parseInt(goalInput.fat)      || goals.fat,
      fiber:    parseInt(goalInput.fiber)    || goals.fiber,
    });
    setEditingGoals(false);
    // TODO: persist to user profile via PUT /users/me when nutrition_goals column exists
  }
  const isToday = date === toLocalDateStr();

  return (
    <div className="nutri-page">
      {/* Date navigation */}
      <div className="nutri-date-nav">
        <button className="nutri-date-btn" onClick={() => changeDate(-1)}>‹</button>
        <div className="nutri-date-center">
          <span className="nutri-date-label">{isToday ? 'Today' : fmtDate(date)}</span>
          {!isToday && (
            <button className="nutri-today-btn" onClick={() => setDate(toLocalDateStr())}>Today</button>
          )}
        </div>
        <button className="nutri-date-btn" onClick={() => changeDate(1)} disabled={isToday}>›</button>
      </div>

      {/* Macro summary */}
      <div className="nutri-summary-card">
        <div className="nutri-summary-header">
          <span className="nutri-summary-title">Daily Totals</span>
          <button className="nutri-edit-goals-btn" onClick={openGoalEdit}>Edit Goals</button>
        </div>

        {editingGoals && (
          <div className="nutri-goal-edit-grid">
            {[['calories','Calories','kcal'],['protein','Protein','g'],['carbs','Carbs','g'],['fat','Fat','g'],['fiber','Fiber','g']].map(([key, label, unit]) => (
              <div key={key} className="nutri-goal-edit-field">
                <label>{label}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="number" value={goalInput[key]} onChange={e => setGoalInput(g => ({ ...g, [key]: e.target.value }))} className="nutri-goal-input" />
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{unit}</span>
                </div>
              </div>
            ))}
            <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
              <button className="nutri-add-btn" style={{ padding: '8px 20px' }} onClick={saveGoals}>Save</button>
              <button className="nutri-cancel-btn" onClick={() => setEditingGoals(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="nutri-calorie-row">
          <div className="nutri-calorie-main">
            <span className="nutri-calorie-value">{Math.round(liveTotals.cal)}</span>
            <span className="nutri-calorie-label">cal eaten</span>
          </div>
          <div className="nutri-calorie-divider" />
          <div className="nutri-calorie-stat">
            <span className="nutri-calorie-value">{goals.calories}</span>
            <span className="nutri-calorie-label">goal</span>
          </div>
          <div className="nutri-calorie-divider" />
          <div className="nutri-calorie-stat">
            <span className="nutri-calorie-value" style={{ color: calRemaining < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
              {Math.abs(Math.round(calRemaining))}
            </span>
            <span className="nutri-calorie-label">{calRemaining < 0 ? 'over' : 'remaining'}</span>
          </div>
        </div>

        <div className="nutri-macro-bars">
          <MacroBar label="Protein" current={round1(liveTotals.pro)} target={goals.protein} color="#3b82f6" />
          <MacroBar label="Carbs" current={round1(liveTotals.carb)} target={goals.carbs} color="#f59e0b" />
          <MacroBar label="Fat" current={round1(liveTotals.fat)} target={goals.fat} color="#ef4444" />
          <MacroBar label="Fiber" current={round1(liveTotals.fib)} target={goals.fiber} color="#22c55e" />
        </div>
      </div>

      {/* Water tracker */}
      <WaterTracker date={date} />

      {/* Meal sections */}
      {loading ? (
        <p className="nutri-loading">Loading…</p>
      ) : (
        <div className="nutri-meals">
          {MEAL_TYPES.map(type => {
            const typeMeals = mealsByType[type];
            const expanded = expandedMeals.has(type);
            const typeTotals = typeMeals.reduce((acc, meal) => {
              (meal.foods || []).forEach(f => { acc.cal += f.calories || 0; acc.pro += f.protein || 0; acc.carb += f.carbs || 0; acc.fat += f.fat || 0; });
              return acc;
            }, { cal: 0, pro: 0, carb: 0, fat: 0 });

            return (
              <div key={type} className="nutri-meal-section">
                <div className="nutri-meal-header" onClick={() => toggleMeal(type)}>
                  <div className="nutri-meal-header-left">
                    <span className="nutri-meal-chevron">{expanded ? '▾' : '▸'}</span>
                    <span className="nutri-meal-title">{MEAL_LABELS[type]}</span>
                  </div>
                  <div className="nutri-meal-header-right">
                    {typeTotals.cal > 0 && (
                      <span className="nutri-meal-total-cal">{Math.round(typeTotals.cal)} cal</span>
                    )}
                    <button
                      className="nutri-add-food-btn"
                      onClick={e => { e.stopPropagation(); setAddingToMeal(type); }}
                    >+ Add</button>
                  </div>
                </div>

                {expanded && (() => {
                  const [macroExpanded, setMacroExpanded] = useState(false);
                  return (
                  <div className="nutri-meal-body">
                    {typeTotals.cal > 0 && (
                      <>
                        {/* Macro ratio bar — always visible */}
                        <div className="nutri-meal-ratio-row">
                          <MacroRatioBar protein={typeTotals.pro} carbs={typeTotals.carb} fat={typeTotals.fat} />
                          <button className="nutri-macro-toggle" onClick={() => setMacroExpanded(e => !e)}>
                            {macroExpanded ? '▴' : '▾'} macros
                          </button>
                        </div>
                        {/* Collapsible detailed macro bars */}
                        {macroExpanded && (
                          <div className="nutri-meal-macro-bars">
                            <MealMacroBar current={round1(typeTotals.pro)} target={Math.round(goals.protein / 4)} color="#3b82f6" label="P" />
                            <MealMacroBar current={round1(typeTotals.carb)} target={Math.round(goals.carbs / 4)} color="#f59e0b" label="C" />
                            <MealMacroBar current={round1(typeTotals.fat)} target={Math.round(goals.fat / 4)} color="#ef4444" label="F" />
                          </div>
                        )}
                      </>
                    )}
                    {typeMeals.length === 0 ? (
                      <p className="nutri-meal-empty">Nothing logged yet.</p>
                    ) : (
                      typeMeals.map(meal => (
                        <div key={meal.id} className="nutri-meal-group">
                          {(meal.foods || []).map(f => (
                            <div key={f.meal_food_id} className="nutri-food-row">
                              <div className="nutri-food-info">
                                <span className="nutri-food-name">{f.food_name}</span>
                                <span className="nutri-food-serving">{f.serving_size}{f.serving_unit || 'g'}</span>
                              </div>
                              <div className="nutri-food-macros">
                                <span className="nutri-food-cal">{Math.round(f.calories)} cal</span>
                                <span className="nutri-food-macro" style={{ color: '#3b82f6' }}>P {round1(f.protein)}g</span>
                                <span className="nutri-food-macro" style={{ color: '#f59e0b' }}>C {round1(f.carbs)}g</span>
                                <span className="nutri-food-macro" style={{ color: '#ef4444' }}>F {round1(f.fat)}g</span>
                              </div>
                              <button
                                className="nutri-remove-btn"
                                onClick={() => removeMealFood(f.meal_food_id)}
                                title="Remove"
                              >✕</button>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Food search modal */}
      {addingToMeal && (
        <FoodSearchModal
          mealType={addingToMeal}
          mealDate={date}
          onClose={() => setAddingToMeal(null)}
          onAdded={fetchDay}
        />
      )}
    </div>
  );
}
