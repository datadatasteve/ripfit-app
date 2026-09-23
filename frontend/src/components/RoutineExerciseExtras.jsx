import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('ripfit_token')}`,
});

// ── Tempo ──────────────────────────────────────────────────────────────────

/** "3-1-2", with "?" for any unset phase; null when nothing is set. */
export function formatTempo(e, p, c) {
  if (e == null && p == null && c == null) return null;
  const f = v => (v == null || v === '' ? '?' : String(v));
  return `${f(e)}-${f(p)}-${f(c)}`;
}

const TEMPO_PHASES = [
  ['tempo_eccentric', 'Eccentric (s)'],
  ['tempo_pause', 'Pause (s)'],
  ['tempo_concentric', 'Concentric (s)'],
];

/** One 0–9 digit input. Typing freely, clamped to 0–9 on change. */
function TempoDigit({ label, value, onChange }) {
  return (
    <label className="rbx-tempo-digit">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        maxLength={1}
        value={value ?? ''}
        onChange={e => {
          const raw = e.target.value.replace(/\D/g, '').slice(-1);
          onChange(raw === '' ? null : Number(raw));
        }}
      />
    </label>
  );
}

/**
 * Tempo field + inline editor for one routine exercise row.
 * Templates are loaded once by the parent (loadTemplates) and shared by rows.
 */
export function TempoEditor({ exercise, onChange, templates, loadTemplates, onTemplateSaved }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [status, setStatus] = useState('');   // '' | 'saving' | 'saved' | error text

  const display = formatTempo(exercise.tempo_eccentric, exercise.tempo_pause, exercise.tempo_concentric);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadTemplates();
  };

  const applyTemplate = (id) => {
    const t = templates?.find(x => String(x.id) === String(id));
    if (!t) return;
    onChange({ tempo_eccentric: t.eccentric, tempo_pause: t.pause, tempo_concentric: t.concentric });
  };

  const allSet = TEMPO_PHASES.every(([k]) => exercise[k] !== null && exercise[k] !== undefined && exercise[k] !== '');

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) return;
    setStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/users/me/tempo-templates`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name,
          eccentric: exercise.tempo_eccentric,
          pause: exercise.tempo_pause,
          concentric: exercise.tempo_concentric,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save template');
      onTemplateSaved(data);
      setStatus('saved');
      setNaming(false);
      setTemplateName('');
    } catch (err) {
      setStatus(err.message);
    }
  };

  return (
    <div className="rbx-tempo">
      <button type="button" className="rbx-tempo-field" onClick={toggle} aria-expanded={open}
        title="Lifting tempo: eccentric-pause-concentric seconds">
        <span className="rbx-tempo-label">Tempo</span>
        <span className="rbx-tempo-value">{display || '—'}</span>
      </button>

      {open && (
        <div className="rbx-panel">
          <div className="rbx-tempo-digits">
            {TEMPO_PHASES.map(([key, label]) => (
              <TempoDigit key={key} label={label} value={exercise[key]}
                onChange={v => onChange({ [key]: v })} />
            ))}
          </div>

          <div className="rbx-row">
            <select
              value=""
              onChange={e => applyTemplate(e.target.value)}
              disabled={templates === null}
              aria-label="Load tempo template"
            >
              <option value="" disabled>
                {templates === null ? 'Loading templates…' : templates.length ? 'Load template…' : 'No saved templates'}
              </option>
              {(templates || []).map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.eccentric}-{t.pause}-{t.concentric})</option>
              ))}
            </select>
            <button type="button" className="rbx-btn"
              onClick={() => onChange({ tempo_eccentric: null, tempo_pause: null, tempo_concentric: null })}>
              Clear
            </button>
          </div>

          {naming ? (
            <div className="rbx-row">
              <input type="text" placeholder="Template name" value={templateName}
                onChange={e => setTemplateName(e.target.value)} autoFocus />
              <button type="button" className="rbx-btn rbx-btn-primary" onClick={saveTemplate}
                disabled={!templateName.trim() || status === 'saving'}>
                {status === 'saving' ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="rbx-btn" onClick={() => { setNaming(false); setStatus(''); }}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="rbx-btn" disabled={!allSet}
              title={allSet ? '' : 'Set all three phases first'}
              onClick={() => { setNaming(true); setStatus(''); }}>
              Save as template
            </button>
          )}
          {status && status !== 'saving' && (
            <p className={status === 'saved' ? 'rbx-ok' : 'rbx-error'}>
              {status === 'saved' ? 'Template saved.' : status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Progressive overload ───────────────────────────────────────────────────

const INCREMENT_LABELS = {
  weight: 'lbs per week',
  reps: 'reps per week',
  sets: 'sets per week',
};

/** Converts the stored { "1": 2.5 } map into editable rows, and back. */
export function weekTargetsToRows(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .map(([week, value]) => ({ week: Number(week), value: String(value) }))
    .filter(r => Number.isInteger(r.week) && r.week > 0)
    .sort((a, b) => a.week - b.week);
}

export function rowsToWeekTargets(rows) {
  const out = {};
  for (const r of rows || []) {
    if (r.value === '' || r.value === null || r.value === undefined) continue;
    out[String(r.week)] = Number(r.value);
  }
  return Object.keys(out).length ? out : null;
}

/** Collapsible per-exercise overload settings, collapsed by default. */
export function OverloadEditor({ exercise, onChange }) {
  const [open, setOpen] = useState(false);
  const strategy = exercise.overload_strategy || 'none';
  const rows = exercise.overload_week_rows || [];

  const setRow = (i, value) => onChange({
    overload_week_rows: rows.map((r, idx) => (idx === i ? { ...r, value } : r)),
  });
  const addWeek = () => onChange({
    overload_week_rows: [...rows, { week: rows.length ? Math.max(...rows.map(r => r.week)) + 1 : 1, value: '' }],
  });
  const removeWeek = i => onChange({ overload_week_rows: rows.filter((_, idx) => idx !== i) });

  const summary = strategy === 'none' ? '' : ` · ${strategy}`;

  return (
    <div className="rbx-overload">
      <button type="button" className="rbx-link" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        Overload {open ? '▾' : '▸'}<span className="rbx-summary">{summary}</span>
      </button>

      {open && (
        <div className="rbx-panel">
          <label className="rbx-field">
            <span>Strategy</span>
            <select value={strategy} onChange={e => onChange({ overload_strategy: e.target.value })}>
              <option value="none">None</option>
              <option value="weight">Weight</option>
              <option value="reps">Reps</option>
              <option value="sets">Sets</option>
            </select>
          </label>

          {strategy !== 'none' && (
            <>
              <label className="rbx-field">
                <span>Increment ({INCREMENT_LABELS[strategy]})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={strategy === 'weight' ? '0.5' : '1'}
                  min="0"
                  placeholder="Program default"
                  value={exercise.overload_increment ?? ''}
                  onChange={e => onChange({ overload_increment: e.target.value })}
                />
              </label>

              <label className="rbx-field">
                <span>Schedule</span>
                <select value={exercise.overload_schedule || 'linear'}
                  onChange={e => onChange({ overload_schedule: e.target.value })}>
                  <option value="linear">Linear</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              {(exercise.overload_schedule || 'linear') === 'custom' && (
                <div className="rbx-weeks">
                  <table>
                    <thead>
                      <tr><th>Week</th><th>Increment</th><th aria-label="Remove" /></tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.week}>
                          <td>{r.week}</td>
                          <td>
                            <input type="number" inputMode="decimal" min="0"
                              step={strategy === 'weight' ? '0.5' : '1'}
                              value={r.value} onChange={e => setRow(i, e.target.value)}
                              aria-label={`Week ${r.week} increment`} />
                          </td>
                          <td>
                            <button type="button" className="rbx-remove" onClick={() => removeWeek(i)}
                              aria-label={`Remove week ${r.week}`}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" className="rbx-btn" onClick={addWeek}>Add week</button>
                  <p className="rbx-hint">Weeks without a row use the increment above.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
