// frontend/src/components/StatsCenter.jsx
import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area,
} from 'recharts';
import WorkoutHistory from './WorkoutHistory';
import './StatsCenter.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) =>
  i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`
);

const TABS = ['Overview', 'Strength', 'Cardio', 'Records', 'Combined', 'History'];

function token() { return localStorage.getItem('ripfit_token'); }

async function apiFetch(path) {
  const res = await fetch(`${API_BASE}/stats${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Chart type toggle ─────────────────────────────────────────────────────
function ChartTypeToggle({ options, value, onChange }) {
  return (
    <div className="sc-chart-toggle">
      {options.map(o => (
        <button
          key={o.value}
          className={`sc-chart-toggle-btn ${value === o.value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
          title={o.label}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }) {
  return (
    <div className="sc-stat-card">
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
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Box-and-whisker calculation from array of values
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

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════
function OverviewTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [freqChart, setFreqChart] = useState('bar');
  const [durationChart, setDurationChart] = useState('boxwhisker');
  const [ratingChart, setRatingChart] = useState('line');
  const [weeks, setWeeks] = useState(12);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/overview?weeks=${weeks}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [weeks]);

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const { weekly_frequency, time_of_day, day_of_week, durations, ratings, totals } = data;
  const durationValues = durations.map(d => Math.round(d.duration_seconds / 60));
  const durationBW = boxWhisker(durationValues);
  const freqData = weekly_frequency.map(w => ({
    week: fmtDate(w.week_start),
    workouts: parseInt(w.count),
  }));
  const ratingData = ratings.map(r => ({
    date: fmtDate(r.date),
    rating: parseFloat(r.rating),
    type: r.type,
  }));

  const FREQ_OPTIONS = [
    { value: 'bar', label: 'Bar chart', icon: '▮▮' },
    { value: 'line', label: 'Line chart', icon: '╱' },
    { value: 'area', label: 'Area chart', icon: '◬' },
  ];
  const DUR_OPTIONS = [
    { value: 'boxwhisker', label: 'Box & whisker', icon: '⊡' },
    { value: 'bar', label: 'Bar chart', icon: '▮▮' },
    { value: 'scatter', label: 'Scatter', icon: '⋯' },
  ];
  const RATING_OPTIONS = [
    { value: 'line', label: 'Line chart', icon: '╱' },
    { value: 'bar', label: 'Bar chart', icon: '▮▮' },
    { value: 'scatter', label: 'Scatter', icon: '⋯' },
  ];

  return (
    <div>
      {/* Totals */}
      <div className="sc-stat-grid">
        <StatCard label="Total Workouts" value={totals.total_workouts} />
        <StatCard label="Total Time" value={fmtDuration(totals.total_seconds)} />
        <StatCard label="Avg Rating" value={totals.avg_rating ?? '—'} sub="/ 5" />
      </div>

      {/* Time window */}
      <div className="sc-window-selector">
        {[4, 8, 12, 26, 52].map(w => (
          <button
            key={w}
            className={`sc-window-btn ${weeks === w ? 'active' : ''}`}
            onClick={() => setWeeks(w)}
          >
            {w < 52 ? `${w}w` : '1y'}
          </button>
        ))}
      </div>

      {/* Weekly frequency */}
      <Section
        title="Workout Frequency"
        controls={<ChartTypeToggle options={FREQ_OPTIONS} value={freqChart} onChange={setFreqChart} />}
      >
        {freqData.length === 0 ? <Empty /> : (
          <ResponsiveContainer width="100%" height={220}>
            {freqChart === 'bar' ? (
              <BarChart data={freqData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Bar dataKey="workouts" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : freqChart === 'line' ? (
              <LineChart data={freqData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Line type="monotone" dataKey="workouts" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
              </LineChart>
            ) : (
              <AreaChart data={freqData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Area type="monotone" dataKey="workouts" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </Section>

      {/* Day/time heatmap */}
      <Section title="When You Train">
        {day_of_week.length === 0 && time_of_day.length === 0 ? <Empty /> : (
          <WorkoutHeatmap timeOfDay={time_of_day} dayOfWeek={day_of_week} />
        )}
      </Section>

      {/* Duration distribution */}
      <Section
        title="Session Duration"
        controls={<ChartTypeToggle options={DUR_OPTIONS} value={durationChart} onChange={setDurationChart} />}
      >
        {durationValues.length === 0 ? <Empty /> : (
          durationChart === 'boxwhisker' ? (
            <BoxWhiskerBar data={durationBW} unit="m" />
          ) : durationChart === 'bar' ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={durationValues.map((v, i) => ({ session: i + 1, minutes: v }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="session" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} label={{ value: 'Session', position: 'insideBottom', offset: -2, fill: 'var(--text-secondary)', fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} unit="m" />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} formatter={v => [`${v}m`, 'Duration']} />
                <Bar dataKey="minutes" fill="var(--color-info)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="session" name="Session" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis dataKey="minutes" name="Minutes" unit="m" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={durationValues.map((v, i) => ({ session: i + 1, minutes: v }))} fill="var(--color-info)" />
              </ScatterChart>
            </ResponsiveContainer>
          )
        )}
      </Section>

      {/* Session rating over time */}
      <Section
        title="Effort & Vibes Over Time"
        controls={<ChartTypeToggle options={RATING_OPTIONS} value={ratingChart} onChange={setRatingChart} />}
      >
        {ratingData.length === 0 ? <Empty message="No sessions rated yet." /> : (
          <ResponsiveContainer width="100%" height={200}>
            {ratingChart === 'scatter' ? (
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Scatter data={ratingData} fill="var(--color-warning)" />
              </ScatterChart>
            ) : ratingChart === 'bar' ? (
              <BarChart data={ratingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
                <Bar dataKey="rating" fill="var(--color-warning)" radius={[2, 2, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={ratingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
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
function StrengthTab() {
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
    const params = muscleFilter ? `?muscleGroup=${encodeURIComponent(muscleFilter)}` : '';
    setLoading(true);
    apiFetch(`/strength${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [muscleFilter]);

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
    { value: 'line', label: 'Line', icon: '╱' },
    { value: 'bar', label: 'Bar', icon: '▮▮' },
    { value: 'area', label: 'Area', icon: '◬' },
    { value: 'scatter', label: 'Scatter', icon: '⋯' },
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
        <input
          className="sc-search"
          placeholder="Filter by muscle group…"
          value={muscleFilter}
          onChange={e => setMuscleFilter(e.target.value)}
        />
      </div>

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
function CardioTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cardioType, setCardioType] = useState('');
  const [metric, setMetric] = useState('duration_seconds');
  const [chartType, setChartType] = useState('line');

  useEffect(() => {
    const params = cardioType ? `?cardioType=${encodeURIComponent(cardioType)}` : '';
    setLoading(true);
    apiFetch(`/cardio${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [cardioType]);

  const CHART_OPTIONS = [
    { value: 'line', label: 'Line', icon: '╱' },
    { value: 'bar', label: 'Bar', icon: '▮▮' },
    { value: 'area', label: 'Area', icon: '◬' },
    { value: 'scatter', label: 'Scatter', icon: '⋯' },
  ];
  const METRIC_OPTIONS = [
    { value: 'duration_seconds', label: 'Duration (min)' },
    { value: 'distance', label: 'Distance' },
    { value: 'avg_speed', label: 'Avg Speed' },
    { value: 'avg_heart_rate', label: 'Avg Heart Rate' },
    { value: 'calories_burned', label: 'Calories' },
    { value: 'session_rating', label: 'Session Rating' },
  ];

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const { summary, time_series } = data;
  const types = [...new Set(time_series.map(s => s.cardio_type))];

  const chartData = time_series.map(s => ({
    date: fmtDate(s.session_date),
    value: metric === 'duration_seconds'
      ? Math.round(s.duration_seconds / 60)
      : parseFloat(s[metric]) || 0,
    type: s.cardio_type,
  }));

  const metricLabel = METRIC_OPTIONS.find(m => m.value === metric)?.label;
  const strokeColor = 'var(--color-info)';

  const renderChart = () => (
    <ResponsiveContainer width="100%" height={240}>
      {chartType === 'bar' ? (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
          <Bar dataKey="value" fill={strokeColor} radius={[3, 3, 0, 0]} name={metricLabel} />
        </BarChart>
      ) : chartType === 'area' ? (
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
          <Area type="monotone" dataKey="value" stroke={strokeColor} fill={strokeColor} fillOpacity={0.15} name={metricLabel} />
        </AreaChart>
      ) : chartType === 'scatter' ? (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <YAxis dataKey="value" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
          <Scatter data={chartData} fill={strokeColor} name={metricLabel} />
        </ScatterChart>
      ) : (
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
          <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
          <Line type="monotone" dataKey="value" stroke={strokeColor} strokeWidth={2} dot={{ r: 3 }} name={metricLabel} />
        </LineChart>
      )}
    </ResponsiveContainer>
  );

  return (
    <div>
      {/* Summary cards per type */}
      <div className="sc-stat-grid">
        {summary.map(s => (
          <StatCard key={s.cardio_type} label={s.cardio_type} value={s.sessions} sub="sessions" />
        ))}
      </div>

      {/* Type filter */}
      <div className="sc-filter-row">
        <button className={`sc-window-btn ${!cardioType ? 'active' : ''}`} onClick={() => setCardioType('')}>All</button>
        {types.map(t => (
          <button key={t} className={`sc-window-btn ${cardioType === t ? 'active' : ''}`} onClick={() => setCardioType(t)}>{t}</button>
        ))}
      </div>

      {/* Chart */}
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

      {/* Summary table */}
      <Section title="By Activity Type">
        <div className="sc-table-wrapper">
          <table className="sc-table">
            <thead>
              <tr><th>Type</th><th>Sessions</th><th>Avg Duration</th><th>Avg Distance</th><th>Avg HR</th><th>Total Calories</th></tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={s.cardio_type}>
                  <td>{s.cardio_type}</td>
                  <td>{s.sessions}</td>
                  <td>{fmtDuration(s.avg_duration_seconds)}</td>
                  <td>{s.avg_distance ? `${s.avg_distance} ${time_series.find(t => t.cardio_type === s.cardio_type)?.distance_unit || ''}` : '—'}</td>
                  <td>{s.avg_hr ? `${s.avg_hr} bpm` : '—'}</td>
                  <td>{s.total_calories?.toLocaleString() ?? '—'}</td>
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
// RECORDS TAB
// ═══════════════════════════════════════════════════════════════════════════
function RecordsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiFetch('/records').then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (!data || data.records.length === 0) return <Empty message="No PRs yet. Log some strength workouts to see your records." />;

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
              <th>Best Est. 1RM</th>
              <th>Heaviest Set</th>
              <th>Most Reps</th>
              <th>First Logged</th>
              <th>Last Logged</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.exercise_id}>
                <td>
                  <span className="sc-ex-name">{r.exercise_name}</span>
                  <span className="sc-ex-cat" style={{ marginLeft: 6 }}>{r.category}</span>
                </td>
                <td className="sc-pr-value">{r.best_est_1rm ? `${r.best_est_1rm} lbs` : '—'}</td>
                <td>{r.best_weight ? `${r.best_weight} lbs × ${r.best_weight_reps}` : '—'}</td>
                <td>{r.most_reps ? `${r.most_reps} @ ${r.most_reps_weight} lbs` : '—'}</td>
                <td>{fmtDate(r.first_logged)}</td>
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
function CombinedTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weeks, setWeeks] = useState(26);
  const [chartType, setChartType] = useState('line');

  useEffect(() => {
    setLoading(true);
    apiFetch(`/combined?weeks=${weeks}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [weeks]);

  const CHART_OPTIONS = [
    { value: 'line', label: 'Line', icon: '╱' },
    { value: 'bar', label: 'Bar', icon: '▮▮' },
    { value: 'scatter', label: 'Scatter', icon: '⋯' },
  ];

  if (loading) return <Loading />;
  if (!data || data.sessions.length === 0) return <Empty />;

  const chartData = data.sessions.map(s => ({
    date: fmtDate(s.date),
    volume: s.volume,
    duration: s.duration_seconds ? Math.round(s.duration_seconds / 60) : null,
    rating: s.session_rating,
    distance: s.distance ? parseFloat(s.distance) : null,
    hr: s.avg_heart_rate,
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

      <div className="sc-window-selector">
        {[8, 12, 26, 52].map(w => (
          <button key={w} className={`sc-window-btn ${weeks === w ? 'active' : ''}`} onClick={() => setWeeks(w)}>
            {w < 52 ? `${w}w` : '1y'}
          </button>
        ))}
      </div>

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
                <tr key={i}>
                  <td>{fmtDate(s.date)}</td>
                  <td><span className={`history-type-badge ${s.type}`}>{s.type}</span></td>
                  <td>{s.title}</td>
                  <td>{fmtDuration(s.duration_seconds)}</td>
                  <td>{s.session_rating ?? '—'}</td>
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
// MAIN STATS CENTER
// ═══════════════════════════════════════════════════════════════════════════
export default function StatsCenter() {
  const [tab, setTab] = useState('Overview');

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
        {tab === 'Overview'  && <OverviewTab />}
        {tab === 'Strength'  && <StrengthTab />}
        {tab === 'Cardio'    && <CardioTab />}
        {tab === 'Records'   && <RecordsTab />}
        {tab === 'Combined'  && <CombinedTab />}
        {tab === 'History'   && <WorkoutHistory />}
      </div>
    </div>
  );
}
