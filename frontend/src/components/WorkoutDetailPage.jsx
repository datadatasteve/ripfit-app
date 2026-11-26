// frontend/src/components/WorkoutDetailPage.jsx
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  Cell, ReferenceLine,
} from 'recharts';
import { formatRepRange, judgeReps } from '../utils/repRange';
import { useUserPrefs } from '../contexts/UserPrefsContext';
import { useActiveWorkoutControls } from '../contexts/ActiveWorkoutContext';
import './WorkoutDetailPage.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function fmtDuration(s) {
  if (!s && s !== 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}min`;
  return `${sec}s`;
}

/** A segment's time as m:ss, or h:mm:ss from an hour (Phase 0B-2). */
function fmtSegmentTime(seconds) {
  const t = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function fmtDate(d) {
  if (!d) return '—';
  let ds;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) ds = d;
  else if (/T00:00:00/.test(d)) ds = d.slice(0, 10);
  else {
    const l = new Date(d);
    ds = `${l.getFullYear()}-${String(l.getMonth()+1).padStart(2,'0')}-${String(l.getDate()).padStart(2,'0')}`;
  }
  const [y, mo, day] = ds.split('-').map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtTime(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function ratingColor(r) {
  if (r == null) return 'var(--text-secondary)';
  const v = parseFloat(r);
  if (v <= 2) return '#ef4444';
  if (v <= 3.5) return 'var(--color-warning)';
  return '#22c55e';
}

const TYPE_COLORS = { strength: 'var(--color-primary)', cardio: '#3498db', mixed: '#a855f7', open: '#14b8a6' };
const TYPE_LABELS = { strength: 'Strength', cardio: 'Cardio', mixed: 'Mixed', open: 'Open' };

const AXIS_STYLE  = { fontSize: 11, fill: 'var(--text-secondary)' };
const TOOLTIP_STYLE = { background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 12 };

function StatBox({ label, value, valueColor }) {
  return (
    <div className="wdp-stat-box">
      <span className="wdp-stat-value" style={valueColor ? { color: valueColor } : undefined}>{value ?? '—'}</span>
      <span className="wdp-stat-label">{label}</span>
    </div>
  );
}

// Shared chart type toggle
function ChartTypeToggle({ value, onChange }) {
  return (
    <div className="wdp-metric-toggle">
      {['Bar', 'Line', 'Area'].map(t => (
        <button key={t} className={`wdp-metric-btn ${value === t ? 'active' : ''}`} onClick={() => onChange(t)}>{t}</button>
      ))}
    </div>
  );
}

// Render the right chart wrapper
function ChartWrapper({ type, data, children, height = 240, margin }) {
  const m = margin || { top: 8, right: 8, left: 0, bottom: 64 };
  const props = { data, margin: m };
  if (type === 'Line') return <LineChart {...props}>{children}</LineChart>;
  if (type === 'Area') return <AreaChart {...props}>{children}</AreaChart>;
  return <BarChart {...props}>{children}</BarChart>;
}

// Render the right data series
function DataSeries({ type, dataKey, name, color, radius }) {
  if (type === 'Line') return <Line type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} dot={{ r: 3 }} />;
  if (type === 'Area') return <Area type="monotone" dataKey={dataKey} name={name} stroke={color} fill={color} fillOpacity={0.25} />;
  return <Bar dataKey={dataKey} name={name} fill={color} radius={radius || [3,3,0,0]} />;
}

// ── RPE chart: one bar per set, tooltip shows avg+max for that exercise ───────
function RPEChart({ exercises }) {
  const [chartType, setChartType] = useState('Bar');

  const exSummary = {};
  exercises.forEach(ex => {
    const rpes = (ex.sets || []).filter(s => s.rpe != null).map(s => parseFloat(s.rpe));
    if (!rpes.length) return;
    exSummary[ex.exercise_name] = {
      avg: Math.round((rpes.reduce((a,b)=>a+b,0)/rpes.length)*10)/10,
      max: Math.max(...rpes),
      min: Math.min(...rpes),
    };
  });

  const data = [];
  exercises.forEach(ex => {
    (ex.sets || []).forEach((s, i) => {
      if (s.rpe == null) return;
      const shortName = ex.exercise_name.length > 12 ? ex.exercise_name.slice(0,12)+'…' : ex.exercise_name;
      data.push({
        label: `${shortName} S${s.set_number ?? i+1}`,
        fullName: ex.exercise_name,
        setNum: s.set_number ?? i+1,
        rpe: parseFloat(s.rpe),
        avg: exSummary[ex.exercise_name]?.avg,
        max: exSummary[ex.exercise_name]?.max,
        min: exSummary[ex.exercise_name]?.min,
      });
    });
  });

  if (data.length === 0) return null;

  const rpeBarColor = (rpe) => {
    if (rpe >= 10) return '#ef4444';  // red — max effort
    if (rpe >= 9)  return '#f97316';  // orange — near max
    return '#3498db';                 // blue — normal range
  };

  return (
    <div className="wdp-section">
      <div className="wdp-section-header">
        <h3 className="wdp-section-title">RPE by Set</h3>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      <p className="wdp-chart-hint">Each point = one set. Orange = RPE 9, Red = RPE 10 or 11. Hover for exercise avg/min/max.</p>
      <ResponsiveContainer width="100%" height={260}>
        <ChartWrapper type={chartType} data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="label" tick={AXIS_STYLE} angle={-40} textAnchor="end" interval={0} />
          <YAxis domain={[0, 11]} tick={AXIS_STYLE} />
          <ReferenceLine y={9} stroke="#f97316" strokeDasharray="4 2" label={{ value: 'RPE 9', position: 'insideTopRight', fontSize: 10, fill: '#f97316' }} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div style={{ ...TOOLTIP_STYLE, padding: '8px 10px' }} className="wdp-tooltip">
                  <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{d.fullName} — Set {d.setNum}</p>
                  <p style={{ margin: '2px 0', color: rpeBarColor(d.rpe) }}>RPE: <strong>{d.rpe}</strong>{d.rpe >= 9 ? ' ⚠' : ''}</p>
                  <p style={{ margin: '2px 0', color: 'var(--text-secondary)', fontSize: 11 }}>
                    Avg: {d.avg} · Min: {d.min} · Max: {d.max}
                  </p>
                </div>
              );
            }}
          />
          {chartType === 'Bar' ? (
            <Bar dataKey="rpe" name="RPE" radius={[3,3,0,0]}>
              {data.map((entry, i) => <Cell key={i} fill={rpeBarColor(entry.rpe)} />)}
            </Bar>
          ) : (
            <DataSeries type={chartType} dataKey="rpe" name="RPE" color="#3498db" />
          )}
        </ChartWrapper>
      </ResponsiveContainer>
    </div>
  );
}

// ── Target vs Logged with y-axis metric toggle ────────────────────────────────
function TargetsChart({ exercises, typeColor }) {
  const [metric, setMetric] = useState('sets');
  const [chartType, setChartType] = useState('Bar');

  // Single-number targets: below = missed, equal = hit, above = exceeded.
  const judgeNumber = (logged, target) =>
    target == null ? null : logged < target ? 'missed' : logged === target ? 'hit' : 'exceeded';

  const METRICS = [
    {
      key: 'sets',
      label: 'Sets',
      targetFn: ex => (ex.target_sets != null ? parseFloat(ex.target_sets) : null),
      loggedFn: ex => Array.isArray(ex.sets) ? ex.sets.length : 0,
    },
    {
      // Reps: the LOWEST set against the rep range (bug #7 — plotting the best
      // set showed 12/12/9 against 12 as "hit"). Bar height is the range top;
      // the tooltip shows the full range.
      key: 'reps',
      label: 'Reps',
      targetFn: ex => (ex.target_reps_max ?? ex.target_reps_min) != null ? parseFloat(ex.target_reps_max ?? ex.target_reps_min) : null,
      targetLabelFn: ex => formatRepRange(ex.target_reps_min, ex.target_reps_max),
      judgeFn: (ex, logged) => judgeReps(logged, ex.target_reps_min, ex.target_reps_max),
      loggedFn: ex => {
        // Straight sets only — timer sets log intervals, often at 0 reps.
        const vals = (ex.sets || [])
          .filter(s => !s.set_type || s.set_type === 'normal')
          .map(s => s.reps).filter(v => v != null);
        return vals.length ? Math.min(...vals) : 0;
      },
    },
    {
      key: 'weight',
      label: 'Weight',
      targetFn: ex => (ex.target_weight != null ? parseFloat(ex.target_weight) : null),
      loggedFn: ex => {
        const vals = (ex.sets || []).map(s => s.weight ?? 0).filter(v => v > 0);
        return vals.length ? Math.max(...vals) : 0;
      },
    },
  ];

  const m = METRICS.find(x => x.key === metric);
  const data = exercises
    .filter(ex => ex.category !== 'Cardio')
    .map(ex => {
      const loggedVal = m.loggedFn(ex);
      const target = m.targetFn(ex);
      const logged = loggedVal != null && loggedVal !== undefined ? loggedVal : null;
      return {
        name: ex.exercise_name,
        shortName: ex.exercise_name.length > 14 ? ex.exercise_name.slice(0,14)+'…' : ex.exercise_name,
        target,
        targetLabel: m.targetLabelFn ? m.targetLabelFn(ex) : target,
        logged,
        status: target == null || logged == null ? null : (m.judgeFn ? m.judgeFn(ex, logged) : judgeNumber(logged, target)),
      };
    })
    .filter(d => d.target != null || (d.logged != null && d.logged > 0));

  if (data.length === 0) return null;
  const hasTargets = data.some(d => d.target != null);

  return (
    <div className="wdp-section">
      <div className="wdp-section-header">
        <h3 className="wdp-section-title">{hasTargets ? 'Target vs Logged' : 'Logged by Exercise'}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div className="wdp-metric-toggle">
            {METRICS.map(x => (
              <button key={x.key} className={`wdp-metric-btn ${metric === x.key ? 'active' : ''}`} onClick={() => setMetric(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
          <ChartTypeToggle value={chartType} onChange={setChartType} />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ChartWrapper type={chartType} data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="shortName" tick={AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
          <YAxis tick={AXIS_STYLE} allowDecimals={false} type="number" domain={[0, "auto"]} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={TOOLTIP_STYLE} className="wdp-tooltip">
                  <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{d?.name}</p>
                  {d?.target != null && <p style={{ margin: '2px 0', color: 'var(--text-secondary)' }}>Target: {d.targetLabel}</p>}
                  {d?.logged != null && (() => {
                    let loggedColor = 'var(--text-primary)';
                    let loggedSuffix = '';
                    if (hasTargets && d.status) {
                      if (d.status === 'missed') { loggedColor = '#ef4444'; loggedSuffix = ' ✗ missed'; }
                      else if (d.status === 'hit') { loggedColor = '#3498db'; loggedSuffix = ' ✓ hit'; }
                      else { loggedColor = '#22c55e'; loggedSuffix = ' ↑ exceeded'; }
                    }
                    return (
                      <p style={{ margin: '2px 0', color: loggedColor }}>
                        Logged: <strong>{d.logged}</strong>{loggedSuffix}
                      </p>
                    );
                  })()}
                </div>
              );
            }}
          />
          {/* Custom legend */}
          <Legend
            verticalAlign="top"
            height={28}
            content={() => (
              <div style={{ display: 'flex', gap: 16, fontSize: 12, paddingBottom: 4, flexWrap: 'wrap' }}>
                {hasTargets && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 2, background: '#94a3b8', display: 'inline-block' }} />
                    Target
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} />
                  {hasTargets ? 'Exceeded' : 'Logged'}
                </span>
                {hasTargets && (
                  <>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: '#3498db', display: 'inline-block' }} />
                      Hit target
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />
                      Missed
                    </span>
                  </>
                )}
              </div>
            )}
          />
          {hasTargets && <DataSeries type={chartType} dataKey="target" name="Target" color="#94a3b8" />}
          {chartType === 'Bar' ? (
            <Bar dataKey="logged" name="Logged" radius={[3,3,0,0]} fill="#22c55e">
              {data.map((entry, i) => {
                if (!hasTargets || !entry.status) return <Cell key={i} fill="#22c55e" />;
                if (entry.status === 'missed') return <Cell key={i} fill="#ef4444" />;
                if (entry.status === 'hit') return <Cell key={i} fill="#3498db" />;
                return <Cell key={i} fill="#22c55e" />;
              })}
            </Bar>
          ) : chartType === 'Line' ? (
            <Line
              type="monotone"
              dataKey="logged"
              name="Logged"
              stroke="#3498db"
              strokeWidth={2}
              dot={(props) => {
                const { cx, cy, payload } = props;
                let fill = '#22c55e';
                if (hasTargets && payload.status) {
                  if (payload.status === 'missed') fill = '#ef4444';
                  else if (payload.status === 'hit') fill = '#3498db';
                }
                return <circle key={props.index} cx={cx} cy={cy} r={5} fill={fill} stroke="none" />;
              }}
            />
          ) : (
            <Area type="monotone" dataKey="logged" name="Logged" stroke="#3498db" fill="#3498db" fillOpacity={0.2} />
          )}
        </ChartWrapper>
      </ResponsiveContainer>
    </div>
  );
}

// ── Volume by exercise ────────────────────────────────────────────────────────
function VolumeChart({ exercises, typeColor }) {
  const [chartType, setChartType] = useState('Bar');

  const data = exercises
    .filter(ex => ex.category !== 'Cardio')
    .map(ex => {
      const vol = (ex.sets || []).reduce((s, set) => s + ((set.reps ?? 0) * (set.weight ?? 0)), 0);
      return vol > 0 ? {
        name: ex.exercise_name,
        shortName: ex.exercise_name.length > 14 ? ex.exercise_name.slice(0,14)+'…' : ex.exercise_name,
        volume: vol,
      } : null;
    })
    .filter(Boolean);

  if (data.length === 0) return null;

  return (
    <div className="wdp-section">
      <div className="wdp-section-header">
        <h3 className="wdp-section-title">Volume by Exercise</h3>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
      </div>
      <p className="wdp-chart-hint">Sets × reps × weight logged.</p>
      <ResponsiveContainer width="100%" height={260}>
        <ChartWrapper type={chartType} data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="shortName" tick={AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
          <YAxis tick={AXIS_STYLE} type="number" domain={[0, "auto"]} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={TOOLTIP_STYLE} className="wdp-tooltip">
                  <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{d?.name}</p>
                  <p style={{ margin: '2px 0' }}>Volume: <strong>{d?.volume?.toLocaleString()}</strong></p>
                </div>
              );
            }}
          />
          <DataSeries type={chartType} dataKey="volume" name="Volume" color={typeColor} />
        </ChartWrapper>
      </ResponsiveContainer>
    </div>
  );
}

// ── Session history (Phase 0A-2) ─────────────────────────────────────────────
const EVENT_LABELS = {
  started: 'Started',
  paused: 'Paused',
  resumed: 'Resumed',
  cancelled: 'Cancelled',
  auto_cancelled: 'Auto-cancelled',
  reopened: 'Resumed after cancel',
  finished: 'Finished',
};

/** Clock time in the user's stored zone (browser zone if unset or invalid). */
function makeTimeFormatter(timeZone) {
  const opts = { hour: 'numeric', minute: '2-digit' };
  try {
    const f = new Intl.DateTimeFormat('en-US', timeZone ? { ...opts, timeZone } : opts);
    return ts => f.format(new Date(ts)).toLowerCase();
  } catch {
    const f = new Intl.DateTimeFormat('en-US', opts);
    return ts => f.format(new Date(ts)).toLowerCase();
  }
}

function makeDayFormatter(timeZone) {
  const opts = { month: 'short', day: 'numeric' };
  try {
    const f = new Intl.DateTimeFormat('en-US', timeZone ? { ...opts, timeZone } : opts);
    return ts => f.format(new Date(ts));
  } catch {
    return ts => new Date(ts).toLocaleDateString('en-US', opts);
  }
}

function fmtMinutes(seconds) {
  const m = Math.round(seconds / 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  return `${m} min`;
}

function eventDetail(ev) {
  const m = ev.metadata || {};
  if (ev.event_type === 'resumed') {
    const parts = [];
    if (Number.isInteger(m.paused_seconds)) parts.push(`after ${fmtMinutes(m.paused_seconds)}`);
    if (m.reason === 'finish') parts.push('on finish');
    if (m.reason === 'cancel') parts.push('on cancel');
    return parts.join(', ');
  }
  if (ev.event_type === 'reopened' && Number.isInteger(m.gap_seconds)) return `${fmtMinutes(m.gap_seconds)} after the cancel, not counted`;
  if (ev.event_type === 'cancelled' && m.empty) return 'nothing was logged';
  if (ev.event_type === 'auto_cancelled') return `no activity for ${m.age_limit_hours ?? '?'} h`;
  if (m.backfilled) return 'from the workout record';
  return '';
}

function SessionHistory({ events, longPauses, timeZone }) {
  const [open, setOpen] = useState(false);
  const fmtClock = makeTimeFormatter(timeZone);
  const fmtDay = makeDayFormatter(timeZone);
  if (!events?.length) return null;
  const firstDay = fmtDay(events[0].occurred_at);
  const clockWithDay = ts => (fmtDay(ts) === firstDay ? fmtClock(ts) : `${fmtDay(ts)}, ${fmtClock(ts)}`);
  return (
    <div className="wdp-section wdp-session-history">
      {/* Long pauses are noted even while the history is collapsed. */}
      {longPauses?.length > 0 && (
        <ul className="wdp-long-pauses">
          {longPauses.map((p, i) => (
            <li key={i}>Paused {fmtMinutes(p.seconds)} at {clockWithDay(p.started_at)}</li>
          ))}
        </ul>
      )}
      <button type="button" className="wdp-session-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="wdp-section-title">Session history</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <ol className="wdp-event-list">
            {events.map(ev => {
              const detail = eventDetail(ev);
              return (
                <li key={ev.id}>
                  <span className="wdp-event-time">{clockWithDay(ev.occurred_at)}</span>
                  <span className="wdp-event-label">{EVENT_LABELS[ev.event_type] || ev.event_type}</span>
                  {detail && <span className="wdp-event-detail">{detail}</span>}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WorkoutDetailPage({ workoutId, workoutType, source, onBack }) {
  // A quick-cardio session is a workouts row with workout_type 'cardio', and
  // the history lists tag it source 'workout'; only a cardio_sessions row
  // (source 'cardio_session') uses the cardio endpoint. Without a source
  // (older callers) the type decides, as before.
  const isCardioSession = source ? source === 'cardio_session' : workoutType === 'cardio';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState('');
  const token = localStorage.getItem('ripfit_token');
  const { prefs } = useUserPrefs();
  const { openWorkout } = useActiveWorkoutControls();

  // Resume a cancelled workout (Phase 0A-2): reopen on the server, then open
  // it as the active workout.
  const reopen = async () => {
    setReopening(true);
    setReopenError('');
    try {
      const res = await fetch(`${API_BASE}/workouts/${workoutId}/reopen`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not resume this workout.');
      openWorkout(body);
    } catch (err) {
      setReopenError(err.message && !err.message.startsWith('Failed to fetch')
        ? err.message
        : 'Could not resume this workout. Check your connection and try again.');
      setReopening(false);
    }
  };

  useEffect(() => {
    if (!workoutId) return;
    setLoading(true);
    setError(null);
    const url = isCardioSession
      ? `${API_BASE}/cardio/${workoutId}`
      : `${API_BASE}/workouts/history/${workoutId}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('Failed to load workout.'))
      .finally(() => setLoading(false));
  }, [workoutId, isCardioSession]);

  if (loading) return <div className="wdp-container"><button className="wdp-back" onClick={onBack}>← Back</button><p className="wdp-loading">Loading…</p></div>;
  if (error || !data) return <div className="wdp-container"><button className="wdp-back" onClick={onBack}>← Back</button><p className="wdp-error">{error || 'No data.'}</p></div>;

  const isCardio = isCardioSession;
  const type = workoutType || 'strength';
  const typeColor = TYPE_COLORS[type] || 'var(--color-primary)';
  const typeLabel = TYPE_LABELS[type] || type;
  const exercises = data.exercises || [];
  const strengthExercises = exercises.filter(ex => ex.category !== 'Cardio');

  const totalSets = strengthExercises.reduce((s, ex) => s + (ex.sets?.length || 0), 0);
  const totalReps = strengthExercises.reduce((s, ex) => s + (ex.sets || []).reduce((r, set) => r + (set.reps ?? 0), 0), 0);
  const totalVolume = strengthExercises.reduce((s, ex) => s + (ex.sets || []).reduce((r, set) => r + ((set.reps ?? 0) * (set.weight ?? 0)), 0), 0);

  const durationSeconds = data.duration_seconds ||
    (data.start_time && data.end_time ? Math.round((new Date(data.end_time) - new Date(data.start_time)) / 1000) : null);

  const startStr = fmtTime(data.start_time);
  const endStr = fmtTime(data.end_time);

  return (
    <div className="wdp-container">
      <button className="wdp-back" onClick={onBack}>← Back</button>

      {data.status === 'cancelled' && (
        <div className="wdp-status-banner cancelled" role="status">
          Cancelled. This workout isn't counted in stats or program progress.
        </div>
      )}
      {!isCardio && data.can_reopen && (
        <div className="wdp-reopen">
          <button type="button" className="wdp-reopen-btn" onClick={reopen} disabled={reopening}>
            {reopening ? 'Resuming…' : 'Resume'}
          </button>
          {reopenError && <p className="wdp-reopen-error" role="alert">{reopenError}</p>}
        </div>
      )}
      {data.status === 'in_progress' && (
        <div className="wdp-status-banner in-progress" role="status">
          In progress. This workout hasn't been finished yet.
        </div>
      )}

      <div className="wdp-header">
        <div className="wdp-title-row">
          <h2 className="wdp-title">{data.routine_name || data.workout_title || data.cardio_type || 'Workout'}</h2>
          <span className="wdp-type-badge" style={{ background: `${typeColor}22`, color: typeColor }}>{typeLabel}</span>
        </div>
        <p className="wdp-date">
          {fmtDate(data.workout_date || data.session_date)}
          {startStr && ` · ${startStr}`}{endStr && ` – ${endStr}`}
        </p>
      </div>

      <div className="wdp-stat-grid">
        <StatBox label="Duration" value={fmtDuration(durationSeconds)} />
        {!isCardio && exercises.length > 0 && <StatBox label="Exercises" value={exercises.length} />}
        {!isCardio && totalSets > 0 && <StatBox label="Sets" value={totalSets} />}
        {!isCardio && totalReps > 0 && <StatBox label="Reps" value={totalReps.toLocaleString()} />}
        {!isCardio && totalVolume > 0 && <StatBox label="Volume" value={`${totalVolume.toLocaleString()} lbs`} />}
        {isCardio && data.distance && <StatBox label="Distance" value={`${data.distance} ${data.distance_unit || ''}`} />}
        {isCardio && data.avg_heart_rate && <StatBox label="Avg HR" value={`${data.avg_heart_rate} bpm`} />}
        {isCardio && data.calories_burned && <StatBox label="Calories" value={data.calories_burned} />}
        {data.session_rating != null && (
          <StatBox label="Effort & Vibes" value={`${data.session_rating} / 5`} valueColor={ratingColor(data.session_rating)} />
        )}
      </div>

      {data.overall_notes && <div className="wdp-notes-block"><span className="wdp-notes-label">Workout Notes · {fmtDate(data.workout_date || data.session_date)}</span><p className="wdp-notes-text">{data.overall_notes}</p></div>}
      {data.pre_session_notes && <div className="wdp-notes-block"><span className="wdp-notes-label">Pre-session</span><p className="wdp-notes-text">{data.pre_session_notes}</p></div>}
      {data.mid_session_notes && <div className="wdp-notes-block"><span className="wdp-notes-label">Mid-session</span><p className="wdp-notes-text">{data.mid_session_notes}</p></div>}
      {data.post_session_notes && <div className="wdp-notes-block"><span className="wdp-notes-label">Post-session</span><p className="wdp-notes-text">{data.post_session_notes}</p></div>}

      {!isCardio && exercises.length > 0 && (
        <div className="wdp-section">
          <h3 className="wdp-section-title">Exercise Breakdown</h3>
          <div className="wdp-exercise-list">
            {exercises.map((ex, i) => (
              <div key={ex.id || i} className="wdp-exercise">
                <div className="wdp-ex-header">
                  <strong className="wdp-ex-name">{ex.exercise_name}</strong>
                  <span className="wdp-ex-cat">{ex.category}</span>
                </div>
                {ex.exercise_notes && <p className="wdp-ex-notes">{ex.exercise_notes}</p>}
                {ex.category !== 'Cardio' && ex.sets?.length > 0 && (
                  <table className="wdp-sets-table">
                    <thead><tr><th>Set</th><th>Reps</th><th>Weight</th><th>RPE</th></tr></thead>
                    <tbody>
                      {ex.sets.map((s, si) => (
                        <tr key={si}>
                          <td>{s.set_number ?? si+1}</td>
                          <td>{s.reps ?? '—'}</td>
                          <td>{s.weight === 0 ? 'BW' : s.weight != null ? `${s.weight}` : '—'}</td>
                          <td>{s.rpe ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {ex.category !== 'Cardio' && (!ex.sets || ex.sets.length === 0) && (
                  <p className="wdp-skipped">No sets logged</p>
                )}
                {/* Cardio segments (Phase 0B-2): Quick Cardio, or cardio inside
                    an Open / routine workout, from /workouts/history/:id. */}
                {ex.category === 'Cardio' && ex.segments?.length > 0 && (
                  <table className="wdp-sets-table wdp-segments-table">
                    <thead><tr><th>{ex.segments[0].segment_label || 'Segment'}</th><th>Time</th><th>Distance</th></tr></thead>
                    <tbody>
                      {ex.segments.map(sg => (
                        <tr key={sg.id}>
                          <td>{sg.segment_number}</td>
                          <td>{sg.duration_seconds != null ? fmtSegmentTime(sg.duration_seconds) : '—'}</td>
                          <td>{sg.distance != null ? `${sg.distance} ${sg.distance_unit || ''}`.trim() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {ex.category === 'Cardio' && Array.isArray(ex.segments) && ex.segments.length === 0 && (
                  <p className="wdp-skipped">No segments logged</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isCardio && (
        <div className="wdp-section">
          <h3 className="wdp-section-title">Session Details</h3>
          <div className="wdp-cardio-rows">
            {data.avg_speed != null && <div className="wdp-cardio-row"><span>Avg Speed</span><span>{data.avg_speed}</span></div>}
            {data.max_speed != null && <div className="wdp-cardio-row"><span>Max Speed</span><span>{data.max_speed}</span></div>}
            {data.elevation_gain != null && <div className="wdp-cardio-row"><span>Elevation Gain</span><span>{data.elevation_gain} ft</span></div>}
            {data.elevation_loss != null && <div className="wdp-cardio-row"><span>Elevation Loss</span><span>{data.elevation_loss} ft</span></div>}
            {data.max_heart_rate != null && <div className="wdp-cardio-row"><span>Max HR</span><span>{data.max_heart_rate} bpm</span></div>}
          </div>
        </div>
      )}

      {!isCardio && (
        <SessionHistory events={data.session_events} longPauses={data.long_pauses} timeZone={prefs.timezone} />
      )}

      {!isCardio && <RPEChart exercises={strengthExercises} />}
      {!isCardio && <TargetsChart exercises={exercises} typeColor={typeColor} />}
      {!isCardio && <VolumeChart exercises={strengthExercises} typeColor={typeColor} />}
    </div>
  );
}
