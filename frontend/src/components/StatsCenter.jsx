// frontend/src/components/StatsCenter.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area, PieChart, Pie, Cell,
  ComposedChart,
} from 'recharts';
import WorkoutHistory from './WorkoutHistory';
import WorkoutDetailPage from './WorkoutDetailPage';
import './StatsCenter.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) =>
  i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`
);

const TABS = ['Overview', 'Strength', 'Cardio', 'Records', 'Combined', 'History', 'Programs'];
const PROGRAM_SUB_TABS = ['Overview', 'Strength', 'Cardio', 'Records', 'Combined', 'History'];

function token() { return localStorage.getItem('ripfit_token'); }

async function apiFetch(path) {
  const res = await fetch(`${API_BASE}/stats${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Chart type toggle ─────────────────────────────────────────────────────
function ChartTypeToggle({ options, value, onChange, label = 'Chart type' }) {
  return (
    <select
      className="sc-chart-select"
      value={value}
      onChange={e => onChange(e.target.value)}
      title={label}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, onClick, clickable }) {
  return (
    <div
      className={`sc-stat-card${clickable ? ' sc-stat-card-clickable' : ''}`}
      onClick={onClick}
      title={clickable ? `View ${label} details` : undefined}
    >
      <span className="sc-stat-value">{value ?? '—'}</span>
      <span className="sc-stat-label">{label}</span>
      {sub && <span className="sc-stat-sub">{sub}</span>}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────
function Section({ title, children, controls }) {
  return (
    <div className="sc-section">
      <div className="sc-section-header">
        <h3 className="sc-section-title">{title}</h3>
        {controls && <div className="sc-section-controls">{controls}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────
function Empty({ message = 'No data yet. Log some workouts to see stats here.' }) {
  return <p className="sc-empty">{message}</p>;
}

// ── Loading ───────────────────────────────────────────────────────────────
function Loading() {
  return <p className="sc-loading">Loading…</p>;
}

// ── formatters ────────────────────────────────────────────────────────────
function fmtDuration(s) {
  if (!s && s !== 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}min`;
  return `${sec}s`;
}

function fmtDate(d, includeYear = false) {
  if (!d) return '';
  // Dates from the DB arrive as either:
  //   '2026-07-31'                  — bare date string (workout_date column)
  //   '2026-07-31T00:00:00.000Z'    — DATE_TRUNC result stored as UTC midnight
  //   '2026-07-31T21:09:22.526Z'    — real timestamp (start_time)
  // For the first two cases, extract the date portion and parse as local midnight
  // to avoid UTC-to-local offset shifting the displayed day.
  // For real timestamps, use the date portion of the LOCAL time representation.
  let dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    // bare date — already local
    dateStr = d;
  } else if (/T00:00:00/.test(d)) {
    // midnight UTC — almost certainly a date-only value stored as UTC midnight
    dateStr = d.slice(0, 10);
  } else {
    // real timestamp — convert to local date string first
    const localDate = new Date(d);
    const y = localDate.getFullYear();
    const mo = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    dateStr = `${y}-${mo}-${day}`;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day); // local midnight, no UTC shift
  const opts = { month: 'short', day: 'numeric' };
  if (includeYear) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

// Rating color: red (0-2) → amber (2.5-3.5) → green (4-5)
function ratingColor(r) {
  if (r == null) return 'var(--text-secondary)';
  const v = parseFloat(r);
  if (v <= 2) return '#ef4444';
  if (v <= 3.5) return 'var(--color-warning)';
  return '#22c55e';
}
function boxWhisker(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const median = sorted[Math.floor(n * 0.5)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const min = Math.max(sorted[0], q1 - 1.5 * iqr);
  const max = Math.min(sorted[n - 1], q3 + 1.5 * iqr);
  return { min, q1, median, q3, max, mean: Math.round(values.reduce((a, b) => a + b, 0) / n) };
}

// ── Custom box-whisker chart (recharts doesn't have one natively) ─────────
function BoxWhiskerBar({ data, label, unit = '' }) {
  if (!data) return null;
  const { min, q1, median, q3, max, mean } = data;
  const range = max - min || 1;
  const pct = v => `${((v - min) / range) * 100}%`;

  return (
    <div className="sc-box-whisker">
      <div className="sc-bw-label">{label}</div>
      <div className="sc-bw-track">
        {/* Whiskers */}
        <div className="sc-bw-line" style={{ left: pct(min), right: `${100 - parseFloat(pct(max))}%` }} />
        {/* Box */}
        <div className="sc-bw-box" style={{ left: pct(q1), width: `${((q3 - q1) / range) * 100}%` }} />
        {/* Median */}
        <div className="sc-bw-median" style={{ left: pct(median) }} />
        {/* Mean dot */}
        <div className="sc-bw-mean" style={{ left: pct(mean) }} title={`Mean: ${mean}${unit}`} />
      </div>
      <div className="sc-bw-stats">
        <span>Min {min}{unit}</span>
        <span>Q1 {q1}{unit}</span>
        <span>Median {median}{unit}</span>
        <span>Q3 {q3}{unit}</span>
        <span>Max {max}{unit}</span>
      </div>
    </div>
  );
}

// ── Heatmap (day × hour) ─────────────────────────────────────────────────
function WorkoutHeatmap({ timeOfDay, dayOfWeek }) {
  // Build a 7×24 grid of counts
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  // We only have marginals, so show them side-by-side
  const maxDay = Math.max(...dayOfWeek.map(d => parseInt(d.count)), 1);
  const maxHour = Math.max(...timeOfDay.map(d => parseInt(d.count)), 1);

  return (
    <div className="sc-heatmap-wrapper">
      <div className="sc-heatmap-section">
        <div className="sc-heatmap-label">By Day of Week</div>
        <div className="sc-heatmap-bars">
          {DAYS.map((day, i) => {
            const entry = dayOfWeek.find(d => parseInt(d.dow) === i);
            const count = entry ? parseInt(entry.count) : 0;
            return (
              <div key={day} className="sc-hm-bar-row">
                <span className="sc-hm-day">{day}</span>
                <div className="sc-hm-bar-track">
                  <div
                    className="sc-hm-bar-fill"
                    style={{ width: `${(count / maxDay) * 100}%` }}
                  />
                </div>
                <span className="sc-hm-count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sc-heatmap-section">
        <div className="sc-heatmap-label">By Time of Day</div>
        <div className="sc-heatmap-bars">
          {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5].map(h => {
            const entry = timeOfDay.find(d => parseInt(d.hour) === h);
            const count = entry ? parseInt(entry.count) : 0;
            if (count === 0 && h < 5) return null; // skip dead hours
            return (
              <div key={h} className="sc-hm-bar-row">
                <span className="sc-hm-day">{HOURS[h]}</span>
                <div className="sc-hm-bar-track">
                  <div
                    className="sc-hm-bar-fill"
                    style={{ width: `${(count / maxHour) * 100}%` }}
                  />
                </div>
                <span className="sc-hm-count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ── Time window selector ──────────────────────────────────────────────────
const TIME_WINDOWS = [
  { label: '1W',  weeks: 1 },
  { label: '2W',  weeks: 2 },
  { label: '1M',  weeks: 4 },
  { label: '2M',  weeks: 8 },
  { label: '3M',  weeks: 13 },
  { label: '6M',  weeks: 26 },
  { label: '9M',  weeks: 39 },
  { label: '1Y',  weeks: 52 },
  { label: 'All', weeks: 520 },
];

function TimeWindowSelector({ weeks, setWeeks, customWeeks, setCustomWeeks }) {
  const [showCustom, setShowCustom] = useState(false);
  const isCustom = !TIME_WINDOWS.find(w => w.weeks === weeks);

  const applyCustom = () => {
    const val = parseInt(customWeeks);
    if (val > 0) { setWeeks(val); setShowCustom(false); }
  };

  return (
    <div className="sc-window-selector">
      {TIME_WINDOWS.map(w => (
        <button
          key={w.weeks}
          className={`sc-window-btn ${weeks === w.weeks && !isCustom ? 'active' : ''}`}
          onClick={() => { setWeeks(w.weeks); setShowCustom(false); }}
        >
          {w.label}
        </button>
      ))}
      <button
        className={`sc-window-btn ${isCustom || showCustom ? 'active' : ''}`}
        onClick={() => setShowCustom(s => !s)}
      >
        Custom
      </button>
      {showCustom && (
        <div className="sc-custom-window">
          <input
            type="number"
            min={1}
            max={520}
            placeholder="Weeks"
            value={customWeeks}
            onChange={e => setCustomWeeks(e.target.value)}
            className="sc-custom-weeks-input"
            onKeyDown={e => e.key === 'Enter' && applyCustom()}
          />
          <button className="sc-window-btn active" onClick={applyCustom}>Apply</button>
        </div>
      )}
    </div>
  );
}

// ── WorkoutCalendar ───────────────────────────────────────────────────────
function WorkoutCalendar({ onSelectWorkout }) {
  const [sessions, setSessions] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    apiFetch('/combined?weeks=52')
      .then(d => setSessions(d.sessions || []))
      .catch(console.error);
  }, []);

  const byDate = {};
  sessions.forEach(s => {
    // Normalize date: bare dates are already YYYY-MM-DD; timestamps extract local date
    let d = s.date?.slice(0, 10);
    if (!d) return;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s);
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  // Use local date to avoid UTC offset pushing "today" to yesterday
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => {
    const next = new Date(year, month + 1, 1);
    if (next <= new Date()) setCurrentMonth(next);
  };
  const isNextDisabled = new Date(year, month + 1, 1) > new Date();

  return (
    <div className="sc-calendar">
      <div className="sc-calendar-nav">
        <button className="sc-cal-nav-btn" onClick={prevMonth}>‹</button>
        <span className="sc-calendar-month-label">{monthLabel}</span>
        <button className="sc-cal-nav-btn" onClick={nextMonth} disabled={isNextDisabled}
          style={{ opacity: isNextDisabled ? 0.3 : 1 }}>›</button>
      </div>

      <div className="sc-calendar-grid">
        {DAY_LABELS.map(dl => <div key={dl} className="sc-cal-dow">{dl}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="sc-cal-cell empty" />;
          const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const daySessions = byDate[dateStr];
          const isToday = dateStr === todayStr;
          const isSelected = selected === dateStr;
          return (
            <div
              key={dateStr}
              className={`sc-cal-cell ${daySessions ? 'has-workout' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => daySessions && setSelected(isSelected ? null : dateStr)}
            >
              <span className="sc-cal-day">{day}</span>
              {daySessions && (
                <div className="sc-cal-dots">
                  {daySessions.slice(0, 3).map((s, si) => (
                    <span key={si} className={`sc-cal-dot ${s.type}`} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && byDate[selected] && (
        <div className="sc-calendar-popup">
          <div className="sc-cal-popup-header">
            <strong>{new Date(selected + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
            <button onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
          </div>
          {byDate[selected].map((s, i) => (
            <div
              key={i}
              className="sc-cal-popup-session"
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectWorkout && onSelectWorkout(s)}
            >
              <span className={`history-type-badge ${s.type}`}>{s.type}</span>
              <strong>{s.title}</strong>
              {s.duration_seconds && <span> · {fmtDuration(s.duration_seconds)}</span>}
              {s.session_rating && <span style={{ color: ratingColor(s.session_rating) }}> · {s.session_rating}/5</span>}
              <span style={{ marginLeft: 'auto', color: 'var(--color-primary)', fontSize: '0.8em' }}>View →</span>
            </div>
          ))}
        </div>
      )}

      <div className="sc-calendar-legend">
        <span><span className="sc-cal-dot strength" /> Strength</span>
        <span><span className="sc-cal-dot cardio" /> Cardio</span>
        <span><span className="sc-cal-dot mixed" /> Mixed</span>
        <span><span className="sc-cal-dot open" /> Open</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════
function OverviewTab({ onSelectWorkout, programId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [combinedChartMetric, setCombinedChartMetric] = useState('workouts'); // 'workouts' | 'duration' | 'both'
  const [combinedChartType, setCombinedChartType] = useState('bar');
  const [ratingChart, setRatingChart] = useState('line');
  const [durationPieData, setDurationPieData] = useState([]);
  const [dayPieData, setDayPieData] = useState([]);
  const [typePieData, setTypePieData] = useState([]);
  const [weeks, setWeeks] = useState(4);
  const [customWeeks, setCustomWeeks] = useState('');
  const pidQ = programId ? `&programId=${programId}` : '';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/overview?weeks=${weeks}${pidQ}`),
      apiFetch(`/combined?weeks=${weeks}${pidQ}`),
    ]).then(([overview, combined]) => {
      setData({ ...overview, sessions: combined.sessions || [] });

      // Build pie chart data from combined sessions
      const sessions = combined.sessions || [];

      // Duration buckets — dynamic 30-minute intervals up to longest session
      const maxMinutes = sessions.reduce((max, s) => Math.max(max, (s.duration_seconds || 0) / 60), 0);
      const bucketCount = Math.max(4, Math.ceil(maxMinutes / 30));
      const dBuckets = {};
      const fmtMin = (mins) => {
        if (mins < 60) return `${mins}min`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}min` : `${h}h`;
      };
      for (let i = 0; i < bucketCount; i++) {
        const lo = i * 30;
        const hi = (i + 1) * 30;
        const label = i === bucketCount - 1
          ? `> ${fmtMin(lo)}`
          : lo === 0 ? `< ${fmtMin(hi)}` : `${fmtMin(lo)}–${fmtMin(hi)}`;
        dBuckets[label] = 0;
      }
      sessions.forEach(s => {
        const m = (s.duration_seconds || 0) / 60;
        const bucketIdx = Math.min(Math.floor(m / 30), bucketCount - 1);
        const label = Object.keys(dBuckets)[bucketIdx];
        if (label !== undefined) dBuckets[label]++;
      });
      setDurationPieData(Object.entries(dBuckets).filter(([,v]) => v > 0).map(([name, value]) => ({ name, value })));

      // Day of week
      const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const dCounts = Array(7).fill(0);
      sessions.forEach(s => {
        const d = new Date(s.date + 'T12:00:00').getDay();
        dCounts[d]++;
      });
      setDayPieData(DAYS.map((name, i) => ({ name, value: dCounts[i] })).filter(d => d.value > 0));

      // Workout type
      const tCounts = {};
      sessions.forEach(s => { tCounts[s.type] = (tCounts[s.type] || 0) + 1; });
      setTypePieData(Object.entries(tCounts).map(([name, value]) => ({ name, value })));
    }).catch(console.error).finally(() => setLoading(false));
  }, [weeks, programId]);

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const { weekly_frequency, time_of_day, day_of_week, durations, ratings, totals, sessions } = data;
  const durationValues = durations.map(d => Math.round(d.duration_seconds / 60));
  const durationBW = boxWhisker(durationValues);

  // Combined freq + duration data
  const combinedData = weekly_frequency.map(w => {
    const weekSessions = sessions.filter(s => {
      const sd = new Date(s.date + 'T12:00:00');
      const wd = new Date(w.week_start);
      const diff = (sd - wd) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff < 7;
    });
    const avgDur = weekSessions.length
      ? Math.round(weekSessions.reduce((s, x) => s + (x.duration_seconds || 0), 0) / weekSessions.length / 60)
      : 0;
    return { week: fmtDate(w.week_start), workouts: parseInt(w.count), avg_duration: avgDur };
  });

  const ratingData = ratings.map(r => ({ date: fmtDate(r.date), rating: parseFloat(r.rating), type: r.type }));

  const COMBINED_METRIC_OPTIONS = [
    { value: 'workouts',  label: 'Workout Frequency' },
    { value: 'duration',  label: 'Avg Session Duration' },
    { value: 'both',      label: 'Frequency + Duration' },
  ];
  const COMBINED_TYPE_OPTIONS = [
    { value: 'bar',   label: 'Bar chart' },
    { value: 'line',  label: 'Line chart' },
    { value: 'area',  label: 'Area chart (shaded)' },
  ];
  const RATING_OPTIONS = [
    { value: 'line',    label: 'Line chart' },
    { value: 'bar',     label: 'Bar chart' },
    { value: 'scatter', label: 'Scatter plot' },
  ];

  const PIE_COLORS = ['var(--color-primary)', 'var(--color-warning)', 'var(--color-info)', 'var(--color-success)', '#a855f7', '#ec4899'];
  const axisStyle = { fontSize: 11, fill: 'var(--text-secondary)' };
  const tooltipStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' };

  const renderCombinedChart = () => {
    const ChartComp = combinedChartType === 'area' ? AreaChart : combinedChartType === 'line' ? LineChart : BarChart;
    const DataComp = combinedChartType === 'area' ? Area : combinedChartType === 'line' ? Line : Bar;
    const commonProps = { data: combinedData, margin: { top: 4, right: 8, left: 0, bottom: 0 } };

    if (combinedChartMetric === 'both') return (
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="week" tick={axisStyle} />
          <YAxis yAxisId="left" tick={axisStyle} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" tick={axisStyle} unit="m" />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          {combinedChartType === 'area'
            ? <Area yAxisId="left" type="monotone" dataKey="workouts" fill="var(--color-primary)" stroke="var(--color-primary)" fillOpacity={0.3} name="Workouts" />
            : combinedChartType === 'line'
            ? <Line yAxisId="left" type="monotone" dataKey="workouts" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} name="Workouts" />
            : <Bar yAxisId="left" dataKey="workouts" fill="var(--color-primary)" radius={[2,2,0,0]} name="Workouts" />
          }
          <Line yAxisId="right" type="monotone" dataKey="avg_duration" stroke="var(--color-warning)" strokeWidth={2} dot={false} name="Avg Duration (m)" />
        </ComposedChart>
      </ResponsiveContainer>
    );

    const dataKey = combinedChartMetric === 'duration' ? 'avg_duration' : 'workouts';
    const color = combinedChartMetric === 'duration' ? 'var(--color-warning)' : 'var(--color-primary)';
    const unit = combinedChartMetric === 'duration' ? 'm' : '';

    return (
      <ResponsiveContainer width="100%" height={220}>
        <ChartComp {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="week" tick={axisStyle} />
          <YAxis tick={axisStyle} allowDecimals={false} unit={unit} />
          <Tooltip contentStyle={tooltipStyle} />
          {combinedChartType === 'area'
            ? <Area type="monotone" dataKey={dataKey} stroke={color} fill={color} fillOpacity={0.15} />
            : combinedChartType === 'line'
            ? <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
            : <Bar dataKey={dataKey} fill={color} radius={[3,3,0,0]} />
          }
        </ChartComp>
      </ResponsiveContainer>
    );
  };

  return (
    <div>
      {/* Totals */}
      <div className="sc-stat-grid">
        <StatCard label="Total Workouts" value={totals.total_workouts} />
        <StatCard label="Total Time" value={fmtDuration(totals.total_seconds)} />
        <StatCard label="Avg Rating" value={totals.avg_rating ?? '—'} sub="/ 5" />
      </div>

      {/* Calendar */}
      <Section title="Activity Calendar">
        <WorkoutCalendar onSelectWorkout={onSelectWorkout} />
      </Section>

      {/* Time window selector */}
      <TimeWindowSelector weeks={weeks} setWeeks={setWeeks} customWeeks={customWeeks} setCustomWeeks={setCustomWeeks} />

      {/* Combined frequency + duration chart */}
      <Section
        title="Workout Frequency & Duration"
        controls={
          <div style={{ display: 'flex', gap: '6px' }}>
            <ChartTypeToggle options={COMBINED_METRIC_OPTIONS} value={combinedChartMetric} onChange={setCombinedChartMetric} label="What to show" />
            <ChartTypeToggle options={COMBINED_TYPE_OPTIONS} value={combinedChartType} onChange={setCombinedChartType} label="Chart type" />
          </div>
        }
      >
        {combinedData.length === 0 ? <Empty /> : renderCombinedChart()}
      </Section>

      {/* When you train heatmap */}
      <Section title="When You Train">
        {day_of_week.length === 0 && time_of_day.length === 0 ? <Empty /> : (
          <WorkoutHeatmap timeOfDay={time_of_day} dayOfWeek={day_of_week} />
        )}
      </Section>

      {/* Pie chart distributions */}
      <Section title="Workout Distributions">
        <div className="sc-pie-row">
          {durationPieData.length > 0 && (
            <div className="sc-pie-card">
              <div className="sc-pie-title">Session Length</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={durationPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                    {durationPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {dayPieData.length > 0 && (
            <div className="sc-pie-card">
              <div className="sc-pie-title">Day of Week</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={dayPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                    {dayPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {typePieData.length > 0 && (
            <div className="sc-pie-card">
              <div className="sc-pie-title">Workout Type</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={typePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                    {typePieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Section>

      {/* Session duration box & whisker */}
      <Section title="Session Duration Spread">
        {durationValues.length === 0 ? <Empty /> : <BoxWhiskerBar data={durationBW} unit="m" />}
      </Section>

      {/* Effort & Vibes */}
      <Section
        title="Effort & Vibes Over Time"
        controls={<ChartTypeToggle options={RATING_OPTIONS} value={ratingChart} onChange={setRatingChart} />}
      >
        {ratingData.length === 0 ? <Empty message="No sessions rated yet." /> : (
          <ResponsiveContainer width="100%" height={200}>
            {ratingChart === 'scatter' ? (
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={axisStyle} />
                <YAxis domain={[0, 5]} tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Scatter data={ratingData} fill="var(--color-warning)" />
              </ScatterChart>
            ) : ratingChart === 'bar' ? (
              <BarChart data={ratingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={axisStyle} />
                <YAxis domain={[0, 5]} tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="rating" fill="var(--color-warning)" radius={[2,2,0,0]} />
              </BarChart>
            ) : (
              <LineChart data={ratingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={axisStyle} />
                <YAxis domain={[0, 5]} tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="rating" stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </Section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STRENGTH TAB
// ═══════════════════════════════════════════════════════════════════════════
function StrengthTab({ programId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedEx, setSelectedEx] = useState(null);
  const [exData, setExData] = useState(null);
  const [exLoading, setExLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState('max_weight');
  const [chartType, setChartType] = useState('line');
  const [muscleFilter, setMuscleFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  useEffect(() => {
    const qs = [];
    if (muscleFilter) qs.push(`muscleGroup=${encodeURIComponent(muscleFilter)}`);
    if (programId) qs.push(`programId=${programId}`);
    const params = qs.length ? `?${qs.join('&')}` : '';
    setLoading(true);
    apiFetch(`/strength${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [muscleFilter, programId]);

  const openExercise = useCallback(async (ex) => {
    setSelectedEx(ex);
    setExLoading(true);
    try {
      const d = await apiFetch(`/exercise/${ex.exercise_id}`);
      setExData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setExLoading(false);
    }
  }, []);

  const CHART_OPTIONS = [
    { value: 'line', label: 'Line chart' },
    { value: 'bar', label: 'Bar chart' },
    { value: 'area', label: 'Area chart' },
    { value: 'scatter', label: 'Scatter plot' },
  ];

  const METRIC_OPTIONS = [
    { value: 'max_weight', label: 'Max Weight' },
    { value: 'avg_weight', label: 'Avg Weight' },
    { value: 'volume', label: 'Volume' },
    { value: 'est_1rm', label: 'Est. 1RM' },
    { value: 'avg_rpe', label: 'Avg RPE' },
  ];

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const { exercises, time_series, flagged_workouts } = data;

  const filtered = exercises.filter(e =>
    !searchFilter || e.exercise_name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  // Exercise detail drill-down
  if (selectedEx && exData) {
    const seriesData = exData.per_session.map(s => ({
      date: fmtDate(s.workout_date),
      max_weight: parseFloat(s.max_weight),
      avg_weight: parseFloat(s.avg_weight),
      volume: s.volume,
      est_1rm: parseFloat(s.est_1rm),
      avg_rpe: parseFloat(s.avg_rpe),
      sets: s.sets,
    }));

    const metricLabel = METRIC_OPTIONS.find(m => m.value === chartMetric)?.label;
    const strokeColor = 'var(--color-primary)';

    return (
      <div>
        <button className="sc-back-btn" onClick={() => { setSelectedEx(null); setExData(null); }}>
          ← All Exercises
        </button>
        <h3 className="sc-ex-title">{exData.exercise.name}</h3>
        <p className="sc-ex-meta">{exData.exercise.category} · {exData.exercise.equipment_type}</p>
        {exData.exercise.muscles_primary && (
          <p className="sc-ex-muscles">Primary: {exData.exercise.muscles_primary}</p>
        )}

        <div className="sc-stat-grid">
          <StatCard label="Best Est. 1RM" value={exData.bests.best_est_1rm ? `${exData.bests.best_est_1rm} lbs` : '—'} />
          <StatCard label="Max Weight" value={exData.bests.max_weight ? `${exData.bests.max_weight} lbs` : '—'} />
          <StatCard label="Max Reps" value={exData.bests.max_reps ?? '—'} />
          <StatCard label="Sessions" value={exData.bests.total_sessions ?? '—'} />
          <StatCard label="Total Sets" value={exData.bests.total_sets ?? '—'} />
        </div>

        <Section
          title={`${metricLabel} Over Time`}
          controls={
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                className="sc-select"
                value={chartMetric}
                onChange={e => setChartMetric(e.target.value)}
              >
                {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <ChartTypeToggle options={CHART_OPTIONS} value={chartType} onChange={setChartType} />
            </div>
          }
        >
          {seriesData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              {chartType === 'bar' ? (
                <BarChart data={seriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Bar dataKey={chartMetric} fill={strokeColor} radius={[3, 3, 0, 0]} name={metricLabel} />
                </BarChart>
              ) : chartType === 'area' ? (
                <AreaChart data={seriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Area type="monotone" dataKey={chartMetric} stroke={strokeColor} fill={strokeColor} fillOpacity={0.15} name={metricLabel} />
                </AreaChart>
              ) : chartType === 'scatter' ? (
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis dataKey={chartMetric} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Scatter data={seriesData} fill={strokeColor} name={metricLabel} />
                </ScatterChart>
              ) : (
                <LineChart data={seriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Line type="monotone" dataKey={chartMetric} stroke={strokeColor} strokeWidth={2} dot={{ r: 3 }} name={metricLabel} />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </Section>

        {/* Per-session table */}
        <Section title="Session Log">
          <div className="sc-table-wrapper">
            <table className="sc-table">
              <thead>
                <tr><th>Date</th><th>Sets</th><th>Avg Reps</th><th>Max Weight</th><th>Volume</th><th>Est. 1RM</th></tr>
              </thead>
              <tbody>
                {exData.per_session.map((s, i) => (
                  <tr key={i}>
                    <td>{fmtDate(s.workout_date)}</td>
                    <td>{s.sets}</td>
                    <td>{s.avg_reps}</td>
                    <td>{s.max_weight} lbs</td>
                    <td>{s.volume?.toLocaleString()}</td>
                    <td>{s.est_1rm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    );
  }

  if (exLoading) return <Loading />;

  return (
    <div>
      {/* Filters */}
      <div className="sc-filters">
        <input
          className="sc-search"
          placeholder="Search exercises…"
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
        />
      </div>
      {/* Muscle group filter pills derived from logged exercise data */}
      {exercises.length > 0 && (() => {
        const muscles = [...new Set(
          exercises
            .filter(e => e.muscles_primary)
            .flatMap(e => e.muscles_primary.split(',').map(m => m.trim()))
            .filter(Boolean)
        )].sort();
        if (muscles.length === 0) return null;
        return (
          <div className="sc-filter-row" style={{ marginBottom: 16 }}>
            <button
              className={`sc-window-btn ${!muscleFilter ? 'active' : ''}`}
              onClick={() => setMuscleFilter('')}
            >All</button>
            {muscles.map(m => (
              <button
                key={m}
                className={`sc-window-btn ${muscleFilter === m ? 'active' : ''}`}
                onClick={() => setMuscleFilter(prev => prev === m ? '' : m)}
              >{m}</button>
            ))}
          </div>
        );
      })()}

      {/* Flagged workouts */}
      {flagged_workouts.length > 0 && (
        <Section title="Flagged Workouts">
          <div className="sc-flagged-list">
            {flagged_workouts.map(f => (
              <div key={f.workout_id} className={`sc-flag-item sc-flag-${f.flag}`}>
                <div className="sc-flag-header">
                  <span className={`sc-flag-badge sc-flag-badge-${f.flag}`}>
                    {f.flag === 'underperformed' ? '⚠ Below target' : '↑ Above target'}
                  </span>
                  <span className="sc-flag-date">{fmtDate(f.workout_date)}</span>
                </div>
                <div className="sc-flag-name">{f.routine_name}</div>
                <div className="sc-flag-detail">
                  {f.flag === 'underperformed'
                    ? `${f.shortfall_ratio}% of sets below target`
                    : `${f.surplus_ratio}% of sets above target`}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Exercise list */}
      <Section title="All Exercises">
        {filtered.length === 0 ? <Empty message="No exercises match your filter." /> : (
          <div className="sc-ex-list">
            {filtered.map(ex => (
              <div key={ex.exercise_id} className="sc-ex-row" onClick={() => openExercise(ex)}>
                <div className="sc-ex-row-main">
                  <span className="sc-ex-name">{ex.exercise_name}</span>
                  <span className="sc-ex-cat">{ex.category}</span>
                </div>
                <div className="sc-ex-row-stats">
                  <span>{ex.sessions_logged} sessions</span>
                  <span>{ex.max_weight} lbs max</span>
                  <span>Est. 1RM: {ex.estimated_1rm}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CARDIO TAB
// ═══════════════════════════════════════════════════════════════════════════
function CardioTab({ onSelectWorkout, initialDrillType, onDrillChange, programId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cardioType, setCardioType] = useState('');
  const [drillType, setDrillType] = useState(initialDrillType || null);
  const [metric, setMetric] = useState('duration_seconds');
  const [chartType, setChartType] = useState('line');
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [showAllMix, setShowAllMix] = useState(false);

  const setDrill = (type) => {
    setDrillType(type);
    onDrillChange?.(type);
  };

  useEffect(() => {
    const qs = [];
    if (cardioType) qs.push(`cardioType=${encodeURIComponent(cardioType)}`);
    if (programId) qs.push(`programId=${programId}`);
    const params = qs.length ? `?${qs.join('&')}` : '';
    setLoading(true);
    apiFetch(`/cardio${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [cardioType, programId]);

  const CHART_OPTIONS = [
    { value: 'line', label: 'Line' },
    { value: 'bar', label: 'Bar' },
    { value: 'area', label: 'Area' },
    { value: 'scatter', label: 'Scatter' },
  ];
  const METRIC_OPTIONS = [
    { value: 'duration_seconds', label: 'Duration' },
    { value: 'distance', label: 'Distance' },
    { value: 'avg_speed', label: 'Avg Speed' },
    { value: 'avg_heart_rate', label: 'Avg HR' },
    { value: 'calories_burned', label: 'Calories' },
    { value: 'session_rating', label: 'Rating' },
  ];

  const TS = { fontSize: 11, fill: 'var(--text-secondary)' };
  const TT = { background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 12 };

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const { summary, time_series } = data;

  // ── Drill-down: one activity type, all its sessions ──────────────────────
  if (drillType) {
    const drillSessions = time_series.filter(s => s.cardio_type === drillType)
      .sort((a, b) => new Date(a.start_time || a.session_date) - new Date(b.start_time || b.session_date));
    const drillSummary = summary.find(s => s.cardio_type === drillType);

    const drillChartData = drillSessions.map(s => ({
      date: fmtDate(s.session_date),
      value: metric === 'duration_seconds'
        ? Math.round((s.duration_seconds || 0) / 60)
        : parseFloat(s[metric]) || null,
      raw: s,
    })).filter(d => d.value != null);

    const metricLabel = METRIC_OPTIONS.find(m => m.value === metric)?.label;

    const renderDrillChart = () => (
      <ResponsiveContainer width="100%" height={240}>
        {chartType === 'bar' ? (
          <BarChart data={drillChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis dataKey="date" tick={TS} />
            <YAxis tick={TS} type="number" domain={[0, "auto"]} />
            <Tooltip contentStyle={TT} />
            <Bar dataKey="value" fill="#3498db" radius={[3,3,0,0]} name={metricLabel} />
          </BarChart>
        ) : chartType === 'area' ? (
          <AreaChart data={drillChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis dataKey="date" tick={TS} />
            <YAxis tick={TS} type="number" domain={[0, "auto"]} />
            <Tooltip contentStyle={TT} />
            <Area type="monotone" dataKey="value" stroke="#3498db" fill="#3498db" fillOpacity={0.15} name={metricLabel} />
          </AreaChart>
        ) : chartType === 'scatter' ? (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis dataKey="date" tick={TS} />
            <YAxis dataKey="value" tick={TS} type="number" domain={[0, "auto"]} />
            <Tooltip contentStyle={TT} />
            <Scatter data={drillChartData} fill="#3498db" name={metricLabel} />
          </ScatterChart>
        ) : (
          <LineChart data={drillChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis dataKey="date" tick={TS} />
            <YAxis tick={TS} type="number" domain={[0, "auto"]} />
            <Tooltip contentStyle={TT} />
            <Line type="monotone" dataKey="value" stroke="#3498db" strokeWidth={2} dot={{ r: 3 }} name={metricLabel} />
          </LineChart>
        )}
      </ResponsiveContainer>
    );

    return (
      <div>
        <button className="sc-back-btn" onClick={() => setDrill(null)}>← Back to Cardio</button>
        <h3 className="sc-ex-title">{drillType}</h3>

        {/* Summary stats for this type */}
        {drillSummary && (
          <div className="sc-stat-grid">
            <StatCard label="Sessions" value={drillSummary.sessions} />
            <StatCard label="Avg Duration" value={fmtDuration(drillSummary.avg_duration_seconds)} />
            {drillSummary.total_distance > 0 && <StatCard label="Total Distance" value={`${drillSummary.total_distance}`} />}
            {drillSummary.avg_speed && <StatCard label="Avg Speed" value={drillSummary.avg_speed} />}
            {drillSummary.avg_rating && <StatCard label="Avg Rating" value={`${drillSummary.avg_rating} / 5`} />}
            {drillSummary.total_calories > 0 && <StatCard label="Total Calories" value={drillSummary.total_calories?.toLocaleString()} />}
          </div>
        )}

        {/* Chart */}
        <Section
          title={`${metricLabel} Over Time`}
          controls={
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="sc-select" value={metric} onChange={e => setMetric(e.target.value)}>
                {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <ChartTypeToggle options={CHART_OPTIONS} value={chartType} onChange={setChartType} />
            </div>
          }
        >
          {drillChartData.length === 0 ? <Empty message="No data for this metric." /> : renderDrillChart()}
        </Section>

        {/* Individual session list */}
        <Section title="Sessions">
          <div className="sc-table-wrapper">
            <table className="sc-table">
              <thead>
                <tr><th>Date</th><th>Duration</th><th>Distance</th><th>Avg Speed</th><th>Avg HR</th><th>Rating</th></tr>
              </thead>
              <tbody>
                {[...drillSessions].reverse().map((s, i) => (
                  <tr
                    key={i}
                    className="sc-clickable-row"
                    onClick={() => onSelectWorkout && onSelectWorkout({
                      workout_id: s.session_id,
                      id: s.session_id,
                      type: s.source === 'cardio_session' ? 'cardio' : (s.source || 'strength'),
                    })}
                  >
                    <td>{fmtDate(s.session_date)}</td>
                    <td>{fmtDuration(s.duration_seconds)}</td>
                    <td>{s.distance ? `${s.distance} ${s.distance_unit || ''}` : '—'}</td>
                    <td>{s.avg_speed ?? '—'}</td>
                    <td>{s.avg_heart_rate ? `${s.avg_heart_rate} bpm` : '—'}</td>
                    <td style={{ color: ratingColor(s.session_rating), fontWeight: s.session_rating != null ? 600 : 400 }}>
                      {s.session_rating ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    );
  }

  // ── Main cardio view ─────────────────────────────────────────────────────
  const types = [...new Set(time_series.map(s => s.cardio_type))];
  const totalSessions = summary.reduce((n, s) => n + s.sessions, 0);

  // Top 5 by session count for the stat cards
  const sortedSummary = [...summary].sort((a, b) => b.sessions - a.sessions);
  const visibleSummary = showAllTypes ? sortedSummary : sortedSummary.slice(0, 5);

  // Better differentiated color palette — visually distinct even for color-blind users
  const PIE_COLORS = [
    '#3498db', // blue
    '#e05c2a', // orange (primary)
    '#22c55e', // green
    '#a855f7', // purple
    '#ef4444', // red
    '#14b8a6', // teal
    '#f59e0b', // amber
    '#6366f1', // indigo
    '#ec4899', // pink
    '#84cc16', // lime
    '#0ea5e9', // sky
    '#f97316', // deep orange
    '#8b5cf6', // violet
    '#10b981', // emerald
    '#e11d48', // rose
  ];

  const visibleMixRows = showAllMix ? sortedSummary : sortedSummary.slice(0, 5);

  const pieData = sortedSummary.map((s, i) => ({
    name: s.cardio_type,
    value: s.sessions,
    color: PIE_COLORS[i % PIE_COLORS.length],
    pct: Math.round(s.sessions / totalSessions * 100),
  }));

  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, pct, name }) => {
    if (pct < 5) return null; // skip tiny slices
    const RADIAN = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {pct}%
      </text>
    );
  };

  const chartData = time_series
    .sort((a, b) => new Date(a.start_time || a.session_date) - new Date(b.start_time || b.session_date))
    .map(s => ({
      date: fmtDate(s.session_date),
      value: metric === 'duration_seconds'
        ? Math.round((s.duration_seconds || 0) / 60)
        : parseFloat(s[metric]) || null,
      type: s.cardio_type,
    }))
    .filter(d => d.value != null);

  const metricLabel = METRIC_OPTIONS.find(m => m.value === metric)?.label;
  const strokeColor = '#3498db';

  const renderChart = () => (
    <ResponsiveContainer width="100%" height={240}>
      {chartType === 'bar' ? (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={TS} />
          <YAxis tick={TS} type="number" domain={[0, "auto"]} />
          <Tooltip contentStyle={TT} />
          <Bar dataKey="value" fill={strokeColor} radius={[3,3,0,0]} name={metricLabel} />
        </BarChart>
      ) : chartType === 'area' ? (
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={TS} />
          <YAxis tick={TS} type="number" domain={[0, "auto"]} />
          <Tooltip contentStyle={TT} />
          <Area type="monotone" dataKey="value" stroke={strokeColor} fill={strokeColor} fillOpacity={0.15} name={metricLabel} />
        </AreaChart>
      ) : chartType === 'scatter' ? (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={TS} />
          <YAxis dataKey="value" tick={TS} type="number" domain={[0, "auto"]} />
          <Tooltip contentStyle={TT} />
          <Scatter data={chartData} fill={strokeColor} name={metricLabel} />
        </ScatterChart>
      ) : (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={TS} />
          <YAxis tick={TS} type="number" domain={[0, "auto"]} />
          <Tooltip contentStyle={TT} />
          <Line type="monotone" dataKey="value" stroke={strokeColor} strokeWidth={2} dot={{ r: 3 }} name={metricLabel} />
        </LineChart>
      )}
    </ResponsiveContainer>
  );

  return (
    <div>
      {/* Top activity type cards — top 5, expandable */}
      <div className="sc-stat-grid">
        {visibleSummary.map(s => (
          <StatCard
            key={s.cardio_type}
            label={s.cardio_type}
            value={s.sessions}
            sub="sessions"
            onClick={() => setDrill(s.cardio_type)}
            clickable
          />
        ))}
      </div>
      {sortedSummary.length > 5 && (
        <button className="sc-show-more-btn" onClick={() => setShowAllTypes(v => !v)}>
          {showAllTypes ? `Show fewer` : `Show all ${sortedSummary.length} types`}
        </button>
      )}

      {/* Ratio bars + pie */}
      <Section title="Activity Mix">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Progress bars — top 5 with expand */}
          <div style={{ flex: '1 1 220px' }}>
            {visibleMixRows.map((s, i) => (
              <div
                key={s.cardio_type}
                style={{ marginBottom: 10, cursor: 'pointer' }}
                onClick={() => setDrill(s.cardio_type)}
                title={`View ${s.cardio_type} sessions`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: PIE_COLORS[sortedSummary.indexOf(s) % PIE_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
                    {s.cardio_type}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{s.sessions} ({Math.round(s.sessions / totalSessions * 100)}%)</span>
                </div>
                <div style={{ height: 6, background: 'var(--border-color)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(s.sessions / totalSessions) * 100}%`,
                    background: PIE_COLORS[sortedSummary.indexOf(s) % PIE_COLORS.length],
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            ))}
            {sortedSummary.length > 5 && (
              <button className="sc-show-more-btn" onClick={() => setShowAllMix(v => !v)}>
                {showAllMix ? 'Show fewer' : `Show all ${sortedSummary.length} types`}
              </button>
            )}
          </div>
          {/* Pie chart with % labels */}
          <div style={{ flex: '0 0 200px' }}>
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={44}
                  labelLine={false}
                  label={renderPieLabel}
                >
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={TT}
                  formatter={(v, name) => [`${v} sessions (${pieData.find(p => p.name === name)?.pct ?? 0}%)`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Section>

      {/* Type filter pills */}
      <div className="sc-filter-row">
        <button className={`sc-window-btn ${!cardioType ? 'active' : ''}`} onClick={() => setCardioType('')}>All</button>
        {types.map(t => (
          <button key={t} className={`sc-window-btn ${cardioType === t ? 'active' : ''}`} onClick={() => setCardioType(t)}>{t}</button>
        ))}
      </div>

      {/* Time series chart */}
      <Section
        title={metricLabel}
        controls={
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="sc-select" value={metric} onChange={e => setMetric(e.target.value)}>
              {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <ChartTypeToggle options={CHART_OPTIONS} value={chartType} onChange={setChartType} />
          </div>
        }
      >
        {chartData.length === 0 ? <Empty /> : renderChart()}
      </Section>

      {/* By Activity Type table — rows clickable → drill */}
      <Section title="By Activity Type">
        <div className="sc-table-wrapper">
          <table className="sc-table">
            <thead>
              <tr><th>Type</th><th>Sessions</th><th>Avg Duration</th><th>Avg Distance</th><th>Avg Speed</th><th>Avg Rating</th><th>Total Calories</th></tr>
            </thead>
            <tbody>
              {sortedSummary.map(s => (
                <tr key={s.cardio_type} className="sc-clickable-row" onClick={() => setDrill(s.cardio_type)}>
                  <td>{s.cardio_type}</td>
                  <td>{s.sessions}</td>
                  <td>{fmtDuration(s.avg_duration_seconds)}</td>
                  <td>{s.total_distance > 0 ? `${s.total_distance}` : '—'}</td>
                  <td>{s.avg_speed ?? '—'}</td>
                  <td style={{ color: ratingColor(s.avg_rating), fontWeight: s.avg_rating ? 600 : 400 }}>
                    {s.avg_rating ?? '—'}
                  </td>
                  <td>{s.total_calories ? s.total_calories.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Click any row to see sessions for that activity.</p>
      </Section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RECORDS TAB
// ═══════════════════════════════════════════════════════════════════════════
function RecordsTab({ programId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedExId, setSelectedExId] = useState(null);
  const [exData, setExData] = useState(null);
  const [exLoading, setExLoading] = useState(false);
  // Chart state for exercise drill-down — must be at top level (rules of hooks)
  const [recChartMetric, setRecChartMetric] = useState('max_weight');
  const [recChartType, setRecChartType] = useState('line');

  useEffect(() => {
    if (!selectedExId) return;
    setExLoading(true);
    apiFetch(`/exercise/${selectedExId}`)
      .then(setExData)
      .catch(console.error)
      .finally(() => setExLoading(false));
  }, [selectedExId]);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/records${programId ? `?programId=${programId}` : ''}`).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [programId]);

  if (loading) return <Loading />;
  if (!data || data.records.length === 0) return <Empty message="No PRs yet. Log some strength workouts to see your records." />;

  // Exercise drill-down from Records
  if (selectedExId && exData) {
    const seriesData = exData.per_session.map(s => ({
      date: fmtDate(s.workout_date),
      max_weight: parseFloat(s.max_weight),
      avg_weight: parseFloat(s.avg_weight),
      volume: s.volume,
      est_1rm: parseFloat(s.est_1rm),
      avg_rpe: parseFloat(s.avg_rpe),
      sets: s.sets,
    }));
    const CHART_OPTIONS = [
      { value: 'line', label: 'Line chart' },
      { value: 'bar', label: 'Bar chart' },
      { value: 'area', label: 'Area chart' },
      { value: 'scatter', label: 'Scatter plot' },
    ];
    const METRIC_OPTIONS = [
      { value: 'max_weight', label: 'Max Weight' },
      { value: 'avg_weight', label: 'Avg Weight' },
      { value: 'volume', label: 'Volume' },
      { value: 'est_1rm', label: 'Est. 1RM' },
      { value: 'sets', label: 'Sets' },
    ];
    const metricLabel = METRIC_OPTIONS.find(m => m.value === recChartMetric)?.label;
    const strokeColor = 'var(--color-primary)';

    return (
      <div>
        <button className="sc-back-btn" onClick={() => { setSelectedExId(null); setExData(null); }}>← Back to Records</button>
        <h3 className="sc-ex-title">{exData.exercise.name}</h3>
        <p className="sc-ex-meta">{exData.exercise.category} · {exData.exercise.equipment_type}</p>
        {exData.exercise.muscles_primary && <p className="sc-ex-muscles">Primary: {exData.exercise.muscles_primary}</p>}
        <div className="sc-stat-grid">
          <StatCard label="Best Est. 1RM" value={exData.bests.best_est_1rm ? `${exData.bests.best_est_1rm} lbs` : '—'} />
          <StatCard label="Max Weight" value={exData.bests.max_weight ? `${exData.bests.max_weight} lbs` : '—'} />
          <StatCard label="Max Reps" value={exData.bests.max_reps ?? '—'} />
          <StatCard label="Sessions" value={exData.bests.total_sessions ?? '—'} />
          <StatCard label="Total Sets" value={exData.bests.total_sets ?? '—'} />
        </div>

        <Section
          title={`${metricLabel} Over Time`}
          controls={
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="sc-select" value={recChartMetric} onChange={e => setRecChartMetric(e.target.value)}>
                {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <ChartTypeToggle options={CHART_OPTIONS} value={recChartType} onChange={setRecChartType} />
            </div>
          }
        >
          {seriesData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              {recChartType === 'bar' ? (
                <BarChart data={seriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Bar dataKey={recChartMetric} fill={strokeColor} radius={[3,3,0,0]} name={metricLabel} />
                </BarChart>
              ) : recChartType === 'area' ? (
                <AreaChart data={seriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Area type="monotone" dataKey={recChartMetric} stroke={strokeColor} fill={strokeColor} fillOpacity={0.15} name={metricLabel} />
                </AreaChart>
              ) : recChartType === 'scatter' ? (
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis dataKey={recChartMetric} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Scatter data={seriesData} fill={strokeColor} name={metricLabel} />
                </ScatterChart>
              ) : (
                <LineChart data={seriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                  <Line type="monotone" dataKey={recChartMetric} stroke={strokeColor} strokeWidth={2} dot={{ r: 3 }} name={metricLabel} />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="Session Log">
          <div className="sc-table-wrapper">
            <table className="sc-table">
              <thead><tr><th>Date</th><th>Sets</th><th>Avg Reps</th><th>Max Weight</th><th>Volume</th><th>Est. 1RM</th></tr></thead>
              <tbody>
                {exData.per_session.map((s, i) => (
                  <tr key={i}>
                    <td>{fmtDate(s.workout_date)}</td>
                    <td>{s.sets}</td>
                    <td>{s.avg_reps}</td>
                    <td>{s.max_weight} lbs</td>
                    <td>{s.volume?.toLocaleString()}</td>
                    <td>{s.est_1rm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    );
  }
  if (exLoading) return <Loading />;

  const filtered = data.records.filter(r =>
    !search || r.exercise_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <input className="sc-search" placeholder="Search exercises…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16 }} />
      <div className="sc-table-wrapper">
        <table className="sc-table">
          <thead>
            <tr>
              <th>Exercise</th>
              <th>Best Est. 1RM <span className="sc-th-hint" title="Epley formula: weight × (1 + reps/30). An approximation, not a measured lift.">?</span></th>
              <th>Heaviest Set</th>
              <th>Most Reps</th>
              <th>Last Logged</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr
                key={r.exercise_id}
                className="sc-clickable-row"
                onClick={() => setSelectedExId(r.exercise_id)}
                title="Click to see full stats"
              >
                <td>
                  <span className="sc-ex-name">{r.exercise_name}</span>
                  <span className="sc-ex-cat" style={{ marginLeft: 6 }}>{r.category}</span>
                </td>
                <td className="sc-pr-value">{r.best_est_1rm ? `${r.best_est_1rm} lbs` : '—'}</td>
                <td>{r.best_weight ? `${r.best_weight} lbs × ${r.best_weight_reps}` : '—'}</td>
                <td>{r.most_reps ? `${r.most_reps} @ ${r.most_reps_weight} lbs` : '—'}</td>
                <td>{fmtDate(r.last_logged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED TAB
// ═══════════════════════════════════════════════════════════════════════════
function CombinedTab({ onSelectWorkout, programId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState(8);
  const [customWeeks, setCustomWeeks] = useState('');
  const [chartType, setChartType] = useState('line');

  useEffect(() => {
    setLoading(true);
    apiFetch(`/combined?weeks=${weeks}${programId ? `&programId=${programId}` : ''}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [weeks, programId]);

  const CHART_OPTIONS = [
    { value: 'line', label: 'Line chart' },
    { value: 'bar', label: 'Bar chart' },
    { value: 'scatter', label: 'Scatter plot' },
  ];

  if (loading) return <Loading />;
  if (!data || data.sessions.length === 0) return <Empty />;

  // Sessions arrive newest-first from API — reverse for chronological chart display
  const sessionsChronological = [...data.sessions].reverse();
  const chartData = sessionsChronological.map(s => ({
    date: fmtDate(s.date),
    volume: s.volume || null,
    duration: s.duration_seconds ? Math.round(s.duration_seconds / 60) : null,
    rating: s.session_rating ? parseFloat(s.session_rating) : null,
    distance: s.distance ? parseFloat(s.distance) : null,
    hr: s.avg_heart_rate || null,
    type: s.type,
  }));

  const renderMultiLine = () => (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
        <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
        <Legend />
        <Line yAxisId="left" type="monotone" dataKey="duration" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="Duration (min)" connectNulls />
        <Line yAxisId="right" type="monotone" dataKey="rating" stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} name="Rating" connectNulls />
        <Line yAxisId="left" type="monotone" dataKey="distance" stroke="var(--color-info)" strokeWidth={2} dot={false} name="Distance" connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <div>
      <p className="sc-combined-hint">
        All sessions on a shared timeline. Look for patterns across strength, cardio, and effort.
      </p>

      <TimeWindowSelector weeks={weeks} setWeeks={setWeeks} customWeeks={customWeeks} setCustomWeeks={setCustomWeeks} />

      <Section
        title="All Activity"
        controls={<ChartTypeToggle options={CHART_OPTIONS} value={chartType} onChange={setChartType} />}
      >
        {chartType === 'scatter' ? (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <YAxis dataKey="duration" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              <Scatter data={chartData.filter(d => d.type === 'strength')} fill="var(--color-primary)" name="Strength" />
              <Scatter data={chartData.filter(d => d.type === 'cardio')} fill="var(--color-info)" name="Cardio" />
              <Legend />
            </ScatterChart>
          </ResponsiveContainer>
        ) : chartType === 'bar' ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              <Bar dataKey="duration" name="Duration (min)" stackId="a" fill="var(--color-primary)" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        ) : renderMultiLine()}
      </Section>

      {/* Session list */}
      <Section title="Session Log">
        <div className="sc-table-wrapper">
          <table className="sc-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Title</th><th>Duration</th><th>Rating</th><th>Volume / Distance</th></tr>
            </thead>
            <tbody>
              {data.sessions.map((s, i) => (
                <tr
                  key={i}
                  className={onSelectWorkout ? 'sc-clickable-row' : ''}
                  onClick={() => onSelectWorkout && onSelectWorkout(s)}
                  title={onSelectWorkout ? 'View workout detail' : undefined}
                >
                  <td>{fmtDate(s.date)}</td>
                  <td><span className={`history-type-badge ${s.type}`}>{s.type}</span></td>
                  <td>{s.title}</td>
                  <td>{fmtDuration(s.duration_seconds)}</td>
                  <td style={{ color: ratingColor(s.session_rating), fontWeight: s.session_rating != null ? 600 : 400 }}>
                    {s.session_rating ?? '—'}
                  </td>
                  <td>{s.volume ? s.volume.toLocaleString() : s.distance ? `${s.distance}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════════════════════════
function HistoryTab({ initialWorkoutId, onClearSelected, onSelectWorkout, programId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState(8);
  const [customWeeks, setCustomWeeks] = useState('');
  const [ratingChart, setRatingChart] = useState('line');
  const [durationChart, setDurationChart] = useState('bar');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [pageSize, setPageSize] = useState(10);
  const [customPageSize, setCustomPageSize] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/combined?weeks=${weeks}${programId ? `&programId=${programId}` : ''}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [weeks, programId]);

  const CHART_OPTIONS = [
    { value: 'line', label: 'Line chart' },
    { value: 'bar', label: 'Bar chart' },
    { value: 'area', label: 'Area chart' },
    { value: 'scatter', label: 'Scatter plot' },
  ];
  const RATING_OPTIONS = [
    { value: 'line', label: 'Line chart' },
    { value: 'bar', label: 'Bar chart' },
    { value: 'scatter', label: 'Scatter plot' },
  ];

  if (loading) return <Loading />;

  // Rated sessions only — reverse to chronological for chart display
  const ratedSessions = (data?.sessions || []).filter(s => s.session_rating != null).reverse();
  const ratingData = ratedSessions.map(s => ({
    date: fmtDate(s.date),
    rating: parseFloat(s.session_rating),
    type: s.type,
    title: s.title,
  }));

  const renderRatingChart = () => {
    const common = {
      data: ratingData,
      margin: { top: 4, right: 8, left: 0, bottom: 0 },
    };
    const axisStyle = { fontSize: 11, fill: 'var(--text-secondary)' };
    const tooltipStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' };

    if (ratingChart === 'bar') return (
      <BarChart {...common}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
        <XAxis dataKey="date" tick={axisStyle} />
        <YAxis domain={[0, 5]} tick={axisStyle} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="rating" fill="var(--color-warning)" radius={[2, 2, 0, 0]} name="Rating" />
      </BarChart>
    );
    if (ratingChart === 'scatter') return (
      <ScatterChart {...common}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
        <XAxis dataKey="date" tick={axisStyle} />
        <YAxis dataKey="rating" domain={[0, 5]} tick={axisStyle} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
        <Scatter data={ratingData} fill="var(--color-warning)" name="Rating" />
      </ScatterChart>
    );
    return (
      <LineChart {...common}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
        <XAxis dataKey="date" tick={axisStyle} />
        <YAxis domain={[0, 5]} tick={axisStyle} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey="rating" stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </LineChart>
    );
  };

  const TS = { fontSize: 11, fill: 'var(--text-secondary)' };
  const TT = { background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 12 };

  // Chronological sessions for charts
  const chronoSessions = [...(data?.sessions || [])].reverse();

  // Duration over time chart data
  const durationData = chronoSessions
    .filter(s => s.duration_seconds)
    .map(s => ({
      date: fmtDate(s.date),
      duration: Math.round(s.duration_seconds / 60),
      durationRaw: s.duration_seconds,
      title: s.title,
      type: s.type,
    }));

  return (
    <div>
      <TimeWindowSelector weeks={weeks} setWeeks={setWeeks} customWeeks={customWeeks} setCustomWeeks={setCustomWeeks} />

      {/* Effort & Vibes over time */}
      <Section
        title="Effort & Vibes Over Time"
        controls={<ChartTypeToggle options={RATING_OPTIONS} value={ratingChart} onChange={setRatingChart} />}
      >
        {ratingData.length === 0
          ? <Empty message="No sessions rated yet." />
          : <ResponsiveContainer width="100%" height={220}>{renderRatingChart()}</ResponsiveContainer>
        }
      </Section>

      {/* Workout duration over time */}
      {durationData.length > 0 && (
        <Section
          title="Workout Duration Over Time"
          controls={<ChartTypeToggle options={CHART_OPTIONS} value={durationChart} onChange={setDurationChart} />}
        >
          <ResponsiveContainer width="100%" height={220}>
            {durationChart === 'area' ? (
              <AreaChart data={durationData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={TS} />
                <YAxis tick={TS} type="number" domain={[0, "auto"]} unit="m" />
                <Tooltip contentStyle={TT} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return <div style={{ ...TT, padding: '8px 10px' }}><p style={{ margin: '0 0 3px', fontWeight: 600 }}>{d.title}</p><p style={{ margin: 0 }}>{fmtDuration(d.durationRaw)}</p></div>;
                }} />
                <Area type="monotone" dataKey="duration" name="Duration (min)" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.2} />
              </AreaChart>
            ) : durationChart === 'scatter' ? (
              <ScatterChart data={durationData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={TS} />
                <YAxis dataKey="duration" tick={TS} type="number" domain={[0, "auto"]} unit="m" />
                <Tooltip contentStyle={TT} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return <div style={{ ...TT, padding: '8px 10px' }}><p style={{ margin: '0 0 3px', fontWeight: 600 }}>{d.title}</p><p style={{ margin: 0 }}>{fmtDuration(d.durationRaw)}</p></div>;
                }} />
                <Scatter data={durationData} fill="var(--color-primary)" name="Duration (min)" />
              </ScatterChart>
            ) : durationChart === 'line' ? (
              <LineChart data={durationData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={TS} />
                <YAxis tick={TS} type="number" domain={[0, "auto"]} unit="m" />
                <Tooltip contentStyle={TT} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return <div style={{ ...TT, padding: '8px 10px' }}><p style={{ margin: '0 0 3px', fontWeight: 600 }}>{d.title}</p><p style={{ margin: 0 }}>{fmtDuration(d.durationRaw)}</p></div>;
                }} />
                <Line type="monotone" dataKey="duration" name="Duration (min)" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            ) : (
              <BarChart data={durationData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={TS} />
                <YAxis tick={TS} type="number" domain={[0, "auto"]} unit="m" />
                <Tooltip contentStyle={TT} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return <div style={{ ...TT, padding: '8px 10px' }}><p style={{ margin: '0 0 3px', fontWeight: 600 }}>{d.title}</p><p style={{ margin: 0 }}>{fmtDuration(d.durationRaw)}</p></div>;
                }} />
                <Bar dataKey="duration" name="Duration (min)" fill="var(--color-primary)" radius={[3,3,0,0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </Section>
      )}

      {/* Session log — single unified list, no WorkoutHistory duplicate */}
      {data && data.sessions.length > 0 && (() => {
        const TYPE_FILTERS = [
          { key: 'all', label: 'All' },
          { key: 'strength', label: 'Strength' },
          { key: 'mixed', label: 'Mixed' },
          { key: 'open', label: 'Open' },
          { key: 'cardio', label: 'Cardio' },
        ];
        const SORT_OPTIONS = [
          { value: 'date_desc', label: 'Newest first' },
          { value: 'date_asc', label: 'Oldest first' },
          { value: 'duration_desc', label: 'Longest first' },
          { value: 'duration_asc', label: 'Shortest first' },
          { value: 'rating_desc', label: 'Highest rated' },
          { value: 'rating_asc', label: 'Lowest rated' },
        ];
        const PAGE_SIZES = [5, 10, 15];

        const filtered = data.sessions.filter(s => {
          if (typeFilter === 'all') return true;
          return s.type === typeFilter;
        });

        const sorted = [...filtered].sort((a, b) => {
          if (sortBy === 'date_asc') return new Date(a.date) - new Date(b.date);
          if (sortBy === 'duration_desc') return (b.duration_seconds || 0) - (a.duration_seconds || 0);
          if (sortBy === 'duration_asc') return (a.duration_seconds || 0) - (b.duration_seconds || 0);
          if (sortBy === 'rating_desc') return (b.session_rating || 0) - (a.session_rating || 0);
          if (sortBy === 'rating_asc') return (a.session_rating || 0) - (b.session_rating || 0);
          return new Date(b.date) - new Date(a.date); // date_desc default
        });

        const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
        const safePage = Math.min(page, totalPages);
        const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

        return (
          <Section title="Session Log">
            {/* Filters + sort row */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TYPE_FILTERS.map(f => (
                  <button
                    key={f.key}
                    className={`sc-window-btn ${typeFilter === f.key ? 'active' : ''}`}
                    onClick={() => { setTypeFilter(f.key); setPage(1); }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <select
                className="sc-select"
                value={sortBy}
                onChange={e => { setSortBy(e.target.value); setPage(1); }}
                style={{ marginLeft: 'auto' }}
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Table */}
            <div className="sc-table-wrapper">
              <table className="sc-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Title</th>
                    <th>Duration</th>
                    <th>Effort & Vibes</th>
                    <th>Volume / Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '16px' }}>No sessions match this filter.</td></tr>
                  ) : pageRows.map((s, i) => (
                    <tr
                      key={i}
                      className={onSelectWorkout ? 'sc-clickable-row' : ''}
                      onClick={() => onSelectWorkout && onSelectWorkout(s)}
                    >
                      <td>{fmtDate(s.date)}</td>
                      <td><span className={`history-type-badge ${s.type}`}>{s.type}</span></td>
                      <td>{s.title}</td>
                      <td>{fmtDuration(s.duration_seconds)}</td>
                      <td style={{ color: ratingColor(s.session_rating), fontWeight: s.session_rating != null ? 600 : 400 }}>
                        {s.session_rating != null ? `${s.session_rating} / 5` : '—'}
                      </td>
                      <td>{s.volume ? s.volume.toLocaleString() : s.distance ? `${s.distance}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {filtered.length} session{filtered.length !== 1 ? 's' : ''}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Per page:</span>
                {PAGE_SIZES.map(n => (
                  <button
                    key={n}
                    className={`sc-window-btn ${pageSize === n && !customPageSize ? 'active' : ''}`}
                    onClick={() => { setPageSize(n); setCustomPageSize(''); setPage(1); }}
                  >
                    {n}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  placeholder="Custom"
                  value={customPageSize}
                  className="sc-custom-input"
                  style={{ width: 60 }}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    setCustomPageSize(e.target.value);
                    if (v > 0) { setPageSize(v); setPage(1); }
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="sc-window-btn" disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
                <span style={{ fontSize: 12 }}>{safePage} / {totalPages}</span>
                <button className="sc-window-btn" disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
              </div>
            </div>
          </Section>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN STATS CENTER
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// PROGRAMS TAB — same tabs/charts as above, scoped to a program (or all programs
// vs. no program at all). Selecting multiple programs shows a labeled section per
// program, side by side, for comparison. Cross-program overlays on a single chart
// are a further step, not built yet.
// ═══════════════════════════════════════════════════════════════════════════
function ProgramsTab({ onSelectWorkout, selectedProgramIds, setSelectedProgramIds, subTab, setSubTab }) {
  const [programs, setPrograms] = useState([]);
  const [loadingPrograms, setLoadingPrograms] = useState(true);
  // activePids is what actually gets passed to the sub-tab — only updates after a 300ms debounce
  // to prevent a fetch storm when the user toggles pills quickly.
  const [activePids, setActivePids] = useState(selectedProgramIds);
  const debounceRef = useRef(null);

  // Sync activePids when the parent sets selectedProgramIds externally
  // (e.g. deep-link via Stats → button on ProgramDetail).
  // Skip if the arrays are already equal to avoid a spurious re-fetch.
  useEffect(() => {
    const same =
      selectedProgramIds.length === activePids.length &&
      selectedProgramIds.every((id, i) => id === activePids[i]);
    if (!same) {
      clearTimeout(debounceRef.current);
      setActivePids(selectedProgramIds);
    }
  }, [selectedProgramIds]);

  useEffect(() => {
    fetch(`${API_BASE}/programs`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.json())
      .then(d => setPrograms(d.programs || []))
      .catch(console.error)
      .finally(() => setLoadingPrograms(false));
  }, []);

  const toggleProgram = (id) => {
    const next = selectedProgramIds.includes(id)
      ? selectedProgramIds.filter(p => p !== id)
      : [...selectedProgramIds, id];
    setSelectedProgramIds(next);
    // debounce the actual fetch trigger
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setActivePids(next), 300);
  };

  const clearAll = () => {
    setSelectedProgramIds([]);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setActivePids([]), 300);
  };

  // Derived: what programId to pass to the single rendered sub-tab
  // 0 selected → 'all'
  // 1 selected → that program's id
  // 2+ selected → we render one section per program, handled below
  const compareMode = activePids.length > 1;
  const singlePid = activePids.length === 0 ? 'all' : activePids.length === 1 ? activePids[0] : null;

  const renderSubTab = (pid) => {
    // key includes both pid and subTab so switching either triggers a clean remount + fresh fetch
    const key = `${pid}-${subTab}`;
    switch (subTab) {
      case 'Overview': return <OverviewTab key={key} onSelectWorkout={onSelectWorkout} programId={pid} />;
      case 'Strength': return <StrengthTab key={key} programId={pid} />;
      case 'Cardio':   return <CardioTab   key={key} onSelectWorkout={onSelectWorkout} programId={pid} />;
      case 'Records':  return <RecordsTab  key={key} programId={pid} />;
      case 'Combined': return <CombinedTab key={key} onSelectWorkout={onSelectWorkout} programId={pid} />;
      case 'History':  return <HistoryTab  key={key} onSelectWorkout={onSelectWorkout} programId={pid} />;
      default: return null;
    }
  };

  return (
    <div className="sc-programs-tab">
      <div className="sc-subtab-bar">
        {PROGRAM_SUB_TABS.map(t => (
          <button key={t} className={`sc-subtab-btn ${subTab === t ? 'active' : ''}`} onClick={() => setSubTab(t)}>{t}</button>
        ))}
      </div>

      <div className="sc-program-selector">
        {loadingPrograms ? (
          <span className="sc-program-selector-loading">Loading programs…</span>
        ) : programs.length === 0 ? (
          <span className="sc-program-selector-empty">No programs yet.</span>
        ) : (
          programs.map(p => (
            <button
              key={p.id}
              className={`sc-program-pill ${selectedProgramIds.includes(p.id) ? 'active' : ''}`}
              onClick={() => toggleProgram(p.id)}
            >
              {p.name}
            </button>
          ))
        )}
        {selectedProgramIds.length > 0 && (
          <button className="sc-program-pill sc-program-pill-clear" onClick={clearAll}>Clear</button>
        )}
      </div>

      {/* Single program or 'all' — one fetch, one sub-tab */}
      {!compareMode && (
        <div className="sc-program-section">
          {activePids.length === 0 && (
            <h4 className="sc-program-section-title">All Programs</h4>
          )}
          {renderSubTab(singlePid)}
        </div>
      )}

      {/* Compare mode — one section per program, each rendering one sub-tab */}
      {compareMode && activePids.map(id => {
        const prog = programs.find(p => p.id === id);
        return (
          <div key={id} className="sc-program-section">
            <h4 className="sc-program-section-title">{prog?.name || `Program ${id}`}</h4>
            {renderSubTab(id)}
          </div>
        );
      })}
    </div>
  );
}

export default function StatsCenter({ initialProgramId, onProgramStatsConsumed }) {
  const [tab, setTab] = useState('Overview');
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [detailWorkout, setDetailWorkout] = useState(null); // { id, type }
  const [cardioDrillType, setCardioDrillType] = useState(null); // restored after back from detail
  const [programsSelectedIds, setProgramsSelectedIds] = useState([]);
  const [programsSubTab, setProgramsSubTab] = useState('Overview');

  // Deep link from a program's "Stats →" button
  useEffect(() => {
    if (initialProgramId) {
      setTab('Programs');
      setProgramsSelectedIds([initialProgramId]);
      onProgramStatsConsumed?.();
    }
  }, [initialProgramId]);

  const handleSelectWorkout = (session) => {
    const id = session.workout_id ?? session.id;
    const type = session.type || 'strength';
    setDetailWorkout({ id, type });
  };

  if (detailWorkout) {
    return (
      <div className="sc-container">
        <WorkoutDetailPage
          workoutId={detailWorkout.id}
          workoutType={detailWorkout.type}
          onBack={() => setDetailWorkout(null)}
        />
      </div>
    );
  }

  return (
    <div className="sc-container">
      <div className="sc-tab-bar">
        {TABS.map(t => (
          <button
            key={t}
            className={`sc-tab-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="sc-content">
        {tab === 'Overview'  && <OverviewTab onSelectWorkout={handleSelectWorkout} />}
        {tab === 'Strength'  && <StrengthTab />}
        {tab === 'Cardio'    && <CardioTab onSelectWorkout={handleSelectWorkout} initialDrillType={cardioDrillType} onDrillChange={setCardioDrillType} />}
        {tab === 'Records'   && <RecordsTab />}
        {tab === 'Combined'  && <CombinedTab onSelectWorkout={handleSelectWorkout} />}
        {tab === 'History'   && <HistoryTab initialWorkoutId={selectedHistoryId} onClearSelected={() => setSelectedHistoryId(null)} onSelectWorkout={handleSelectWorkout} />}
        {tab === 'Programs'  && (
          <ProgramsTab
            onSelectWorkout={handleSelectWorkout}
            selectedProgramIds={programsSelectedIds}
            setSelectedProgramIds={setProgramsSelectedIds}
            subTab={programsSubTab}
            setSubTab={setProgramsSubTab}
          />
        )}
      </div>
    </div>
  );
}
