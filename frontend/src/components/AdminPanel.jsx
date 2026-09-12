// frontend/src/components/AdminPanel.jsx
import { useState, useEffect } from 'react';
import StatsCenter from './StatsCenter';
import WorkoutHistory from './WorkoutHistory';
import './AdminPanel.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function token() { return localStorage.getItem('ripfit_token'); }

function fmtDate(d) {
  if (!d) return '—';
  const date = /T00:00:00/.test(d) ? new Date(d.slice(0, 10) + 'T00:00:00') : new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelative(d) {
  if (!d) return 'Never';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
}

// ── Admin tab bar ─────────────────────────────────────────────────────────
const ADMIN_TABS = ['Users', 'Exercises', 'Bug Reports', 'Error Logs'];

// ── Status badge ──────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const colors = {
    open: '#ef4444',
    in_progress: '#f59e0b',
    resolved: '#22c55e',
    wont_fix: '#6b7280',
    error: '#ef4444',
    server_error: '#dc2626',
    warning: '#f59e0b',
    info: '#3b82f6',
  };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '0.75em',
      fontWeight: 600,
      background: `${colors[status] || '#6b7280'}22`,
      color: colors[status] || '#6b7280',
      border: `1px solid ${colors[status] || '#6b7280'}44`,
    }}>
      {status?.replace(/_/g, ' ')}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userTab, setUserTab] = useState('overview');
  const [actionMsg, setActionMsg] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.json())
      .then(d => setUsers(d.users || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function openUser(user) {
    setSelectedUser(user);
    setUserLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/users/${user.id}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setUserData(data);
    } catch (e) { console.error(e); }
    finally { setUserLoading(false); }
  }

  async function adminAction(userId, payload) {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setActionMsg('Done.');
      // Refresh user list
      const updated = await fetch(`${API_BASE}/admin/users`, { headers: { Authorization: `Bearer ${token()}` } }).then(r => r.json());
      setUsers(updated.users || []);
    } catch {
      setActionMsg('Failed.');
    } finally {
      setTimeout(() => setActionMsg(''), 3000);
    }
  }

  // User drill-down
  if (selectedUser) {
    return (
      <div>
        <button className="admin-back-btn" onClick={() => { setSelectedUser(null); setUserData(null); }}>
          ← All Users
        </button>

        {userLoading ? <p className="admin-loading">Loading…</p> : !userData ? null : (
          <div>
            <div className="admin-user-header">
              <div>
                <h3 className="admin-user-name">{userData.user.display_name || userData.user.username}</h3>
                <p className="admin-user-email">{userData.user.email}</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {userData.user.email_verified
                    ? <StatusBadge status="resolved" />
                    : <StatusBadge status="open" />}
                  {userData.user.is_admin && <StatusBadge status="info" />}
                  <span style={{ fontSize: '0.8em', color: 'var(--text-secondary)' }}>
                    Joined {fmtDate(userData.user.created_at)}
                  </span>
                </div>
              </div>

              <div className="admin-user-actions">
                {!userData.user.email_verified && (
                  <button className="admin-action-btn"
                    onClick={() => adminAction(userData.user.id, { email_verified: true })}>
                    Verify Email
                  </button>
                )}
                <button className="admin-action-btn danger"
                  onClick={() => {
                    const pw = prompt('New password (must meet requirements):');
                    if (pw) adminAction(userData.user.id, { new_password: pw });
                  }}>
                  Reset Password
                </button>
                {!userData.user.is_admin && (
                  <button className="admin-action-btn"
                    onClick={() => adminAction(userData.user.id, { is_admin: true })}>
                    Grant Admin
                  </button>
                )}
                {actionMsg && <span style={{ fontSize: '0.85em', color: 'var(--color-success)' }}>{actionMsg}</span>}
              </div>
            </div>

            {/* Sub-tabs for user data */}
            <div className="admin-sub-tabs">
              {['overview', 'workouts', 'bugs', 'errors'].map(t => (
                <button key={t} className={`admin-sub-tab ${userTab === t ? 'active' : ''}`} onClick={() => setUserTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                  {t === 'bugs' && userData.bug_reports.length > 0 && (
                    <span className="admin-badge">{userData.bug_reports.length}</span>
                  )}
                  {t === 'errors' && userData.error_logs.filter(e => !e.resolved).length > 0 && (
                    <span className="admin-badge admin-badge-red">{userData.error_logs.filter(e => !e.resolved).length}</span>
                  )}
                </button>
              ))}
            </div>

            {userTab === 'overview' && (
              <div className="admin-overview-grid">
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{userData.workouts.length}</span>
                  <span className="admin-stat-label">Strength workouts</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{userData.cardio.length}</span>
                  <span className="admin-stat-label">Cardio sessions</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{userData.bug_reports.length}</span>
                  <span className="admin-stat-label">Bug reports</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{userData.error_logs.filter(e => !e.resolved).length}</span>
                  <span className="admin-stat-label">Open errors</span>
                </div>
                {userData.user.goals?.length > 0 && (
                  <div className="admin-stat-card" style={{ gridColumn: '1 / -1' }}>
                    <span className="admin-stat-label">Goals</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {userData.user.goals.map(g => (
                        <span key={g.type} style={{ padding: '2px 8px', background: 'var(--bg-secondary)', borderRadius: 4, fontSize: '0.8em' }}>
                          {g.type.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {userTab === 'workouts' && (
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr><th>Date</th><th>Routine</th><th>Duration</th><th>Exercises</th><th>Sets</th><th>Rating</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {userData.workouts.map(w => (
                      <tr key={w.id}>
                        <td>{fmtDate(w.workout_date)}</td>
                        <td>{w.routine_name}</td>
                        <td>{w.duration_seconds ? `${Math.round(w.duration_seconds / 60)}m` : '—'}</td>
                        <td>{w.exercise_count}</td>
                        <td>{w.set_count}</td>
                        <td>{w.session_rating ?? '—'}</td>
                        <td><StatusBadge status={w.status} /></td>
                      </tr>
                    ))}
                    {userData.workouts.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No workouts yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {userTab === 'bugs' && (
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead><tr><th>Date</th><th>Title</th><th>Page</th><th>Status</th></tr></thead>
                  <tbody>
                    {userData.bug_reports.map(b => (
                      <tr key={b.id}>
                        <td>{fmtDate(b.created_at)}</td>
                        <td>{b.title}</td>
                        <td>{b.current_view || '—'}</td>
                        <td><StatusBadge status={b.status} /></td>
                      </tr>
                    ))}
                    {userData.bug_reports.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No bug reports</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {userTab === 'errors' && (
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead><tr><th>Date</th><th>Error</th><th>Component</th><th>Severity</th><th>Resolved</th></tr></thead>
                  <tbody>
                    {userData.error_logs.map(e => (
                      <tr key={e.id}>
                        <td>{fmtDate(e.created_at)}</td>
                        <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.error_message}</td>
                        <td>{e.component || '—'}</td>
                        <td><StatusBadge status={e.severity} /></td>
                        <td>{e.resolved ? '✓' : '—'}</td>
                      </tr>
                    ))}
                    {userData.error_logs.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No errors logged</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // User list
  return (
    <div>
      <h3 className="admin-section-title">All Users ({users.length})</h3>
      {loading ? <p className="admin-loading">Loading…</p> : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Joined</th>
                <th>Last Active</th>
                <th>Workouts</th>
                <th>Verified</th>
                <th>Bugs</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="admin-clickable-row" onClick={() => openUser(u)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.display_name || u.username}</div>
                    <div style={{ fontSize: '0.8em', color: 'var(--text-secondary)' }}>{u.email}</div>
                    {u.is_admin && <span style={{ fontSize: '0.7em', color: 'var(--color-primary)' }}>ADMIN</span>}
                  </td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td>{fmtRelative(u.last_active)}</td>
                  <td>{parseInt(u.workout_count) + parseInt(u.cardio_count)}</td>
                  <td>{u.email_verified ? '✓' : <span style={{ color: 'var(--color-danger)' }}>✗</span>}</td>
                  <td>{u.bug_reports > 0 ? <span style={{ color: 'var(--color-warning)' }}>{u.bug_reports}</span> : '—'}</td>
                  <td>{u.error_count > 0 ? <span style={{ color: 'var(--color-danger)' }}>{u.error_count}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BUG REPORTS TAB
// ═══════════════════════════════════════════════════════════════════════════
function BugReportsTab() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchReports = () => {
    const q = statusFilter ? `?status=${statusFilter}` : '';
    setLoading(true);
    fetch(`${API_BASE}/admin/bug-reports${q}`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.json())
      .then(d => setReports(d.bug_reports || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchReports(); }, [statusFilter]);

  async function updateReport(id, payload) {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/admin/bug-reports/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(payload),
      });
      fetchReports();
      setSelected(null);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  const STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'wont_fix'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`admin-filter-btn ${!statusFilter ? 'active' : ''}`} onClick={() => setStatusFilter('')}>All</button>
        {STATUS_OPTIONS.map(s => (
          <button key={s} className={`admin-filter-btn ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {selected && (
        <div className="admin-modal-overlay" onClick={() => setSelected(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>{selected.title}</h3>
            <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: 8 }}>
              {selected.username} · {fmtDate(selected.created_at)} · {selected.current_view || 'unknown page'}
            </p>
            <p style={{ marginBottom: 16, lineHeight: 1.6 }}>{selected.description}</p>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: '0.8em', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Status</label>
              <select
                value={selected.status}
                onChange={e => setSelected(s => ({ ...s, status: e.target.value }))}
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 4 }}
              >
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.8em', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Admin Notes</label>
              <textarea
                rows={3}
                value={selected.admin_notes || ''}
                onChange={e => setSelected(s => ({ ...s, admin_notes: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px', borderRadius: 4 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="admin-action-btn" onClick={() => updateReport(selected.id, { status: selected.status, admin_notes: selected.admin_notes })} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setSelected(null)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? <p className="admin-loading">Loading…</p> : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>User</th><th>Title</th><th>Page</th><th>Status</th></tr></thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id} className="admin-clickable-row" onClick={() => setSelected(r)}>
                  <td>{fmtDate(r.created_at)}</td>
                  <td>{r.username || '—'}</td>
                  <td>{r.title}</td>
                  <td>{r.current_view || '—'}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No bug reports</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR LOGS TAB
// ═══════════════════════════════════════════════════════════════════════════
function ErrorLogsTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const fetchLogs = () => {
    setLoading(true);
    const q = showResolved ? '' : '?resolved=false';
    fetch(`${API_BASE}/admin/error-logs${q}`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then(r => r.json())
      .then(d => setLogs(d.error_logs || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLogs(); }, [showResolved]);

  async function resolve(id) {
    await fetch(`${API_BASE}/admin/error-logs/${id}/resolve`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token()}` },
    });
    fetchLogs();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9em', cursor: 'pointer' }}>
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
        <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>
          {logs.filter(l => !l.resolved).length} open
        </span>
      </div>

      {loading ? <p className="admin-loading">Loading…</p> : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>User</th><th>Error</th><th>Component</th><th>Severity</th><th>Action</th></tr></thead>
            <tbody>
              {logs.map(e => (
                <>
                  <tr key={e.id} className="admin-clickable-row" onClick={() => setExpanded(expanded === e.id ? null : e.id)} style={{ opacity: e.resolved ? 0.5 : 1 }}>
                    <td>{fmtRelative(e.created_at)}</td>
                    <td>{e.username || 'Anonymous'}</td>
                    <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.error_message}</td>
                    <td>{e.component || '—'}</td>
                    <td><StatusBadge status={e.severity} /></td>
                    <td>
                      {!e.resolved && (
                        <button
                          className="admin-action-btn"
                          style={{ padding: '4px 10px', fontSize: '0.8em' }}
                          onClick={ev => { ev.stopPropagation(); resolve(e.id); }}
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === e.id && (
                    <tr key={`${e.id}-detail`}>
                      <td colSpan={6}>
                        <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.8em', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                          {e.error_stack || e.error_message}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No error logs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXERCISE MANAGER
// ═══════════════════════════════════════════════════════════════════════════

const EXERCISE_CATEGORIES = [
  'Abs', 'Arms', 'Back', 'Cardio', 'Chest', 'Legs', 'Neck', 'Shoulders',
  'Stretch', 'Yoga', 'Pilates', 'Conditioning', 'Mobility',
];

const EQUIPMENT_VALUES = [
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bodyweight',
  'resistance-band', 'pull-up-bar', 'bench', 'mat', 'box', 'agility-ladder',
  'yoga-block', 'yoga-strap', 'none',
];

// react-body-highlighter slugs — the only values the muscle diagram renders.
const MUSCLE_SLUGS = [
  'trapezius', 'upper-back', 'lower-back', 'chest', 'biceps', 'triceps',
  'forearm', 'back-deltoids', 'front-deltoids', 'abs', 'obliques', 'adductor',
  'hamstring', 'quadriceps', 'abductors', 'calves', 'gluteal', 'head', 'neck',
];

const FORCE_VALUES = ['push', 'pull', 'static'];
const LEVEL_VALUES = ['beginner', 'intermediate', 'expert'];
const MECHANIC_VALUES = ['compound', 'isolation'];

const EMPTY_EXERCISE = {
  name: '', description: '', category: '', subcategory: '', equipment_type: '',
  muscles_primary: [], muscles_secondary: [], force: '', level: '', mechanic: '',
  instructions: [], video_url_male: '', video_url_female: '',
};

/** Checkbox grid for one of the two muscle-slug arrays. */
function MuscleSelect({ label, selected, onChange }) {
  const toggle = (slug) => {
    onChange(selected.includes(slug)
      ? selected.filter(s => s !== slug)
      : [...selected, slug]);
  };

  return (
    <div className="exm-field exm-field-wide">
      <label>{label}</label>
      <div className="exm-muscle-grid">
        {MUSCLE_SLUGS.map(slug => (
          <label key={slug} className={`exm-muscle-chip ${selected.includes(slug) ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={selected.includes(slug)}
              onChange={() => toggle(slug)}
            />
            {slug}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Ordered, editable list of instruction steps. */
function InstructionsEditor({ steps, onChange }) {
  return (
    <div className="exm-field exm-field-wide">
      <label>Instructions</label>
      {steps.map((step, i) => (
        <div key={i} className="exm-step-row">
          <span className="exm-step-num">{i + 1}</span>
          <input
            type="text"
            value={step}
            onChange={e => onChange(steps.map((s, idx) => (idx === i ? e.target.value : s)))}
          />
          <button
            type="button"
            className="exm-step-remove"
            onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
            aria-label={`Remove step ${i + 1}`}
          >×</button>
        </div>
      ))}
      <button type="button" className="admin-action-btn" onClick={() => onChange([...steps, ''])}>
        + Step
      </button>
    </div>
  );
}

/** Add/edit form. `initial` null means create. */
function ExerciseForm({ initial, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_EXERCISE,
    ...(initial || {}),
    muscles_primary: initial?.muscles_primary || [],
    muscles_secondary: initial?.muscles_secondary || [],
    instructions: initial?.instructions || [],
    description: initial?.description || '',
    subcategory: initial?.subcategory || '',
    equipment_type: initial?.equipment_type || '',
    force: initial?.force || '',
    level: initial?.level || '',
    mechanic: initial?.mechanic || '',
    video_url_male: initial?.video_url_male || '',
    video_url_female: initial?.video_url_female || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        instructions: form.instructions.filter(s => s.trim()),
      };
      const res = await fetch(
        initial ? `${API_BASE}/admin/exercises/${initial.id}` : `${API_BASE}/admin/exercises`,
        {
          method: initial ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Save failed');
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  return (
    <div className="exm-form">
      <h3 className="exm-form-title">{initial ? `Edit: ${initial.name}` : 'Add exercise'}</h3>

      <div className="exm-form-grid">
        <div className="exm-field exm-field-wide">
          <label>Name</label>
          <input type="text" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>

        <div className="exm-field">
          <label>Category</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}>
            <option value="">—</option>
            {EXERCISE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="exm-field">
          <label>Subcategory</label>
          <input type="text" value={form.subcategory} onChange={e => set('subcategory', e.target.value)} />
        </div>

        <div className="exm-field">
          <label>Equipment</label>
          <select value={form.equipment_type} onChange={e => set('equipment_type', e.target.value)}>
            <option value="">—</option>
            {EQUIPMENT_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="exm-field">
          <label>Force</label>
          <select value={form.force} onChange={e => set('force', e.target.value)}>
            <option value="">—</option>
            {FORCE_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="exm-field">
          <label>Level</label>
          <select value={form.level} onChange={e => set('level', e.target.value)}>
            <option value="">—</option>
            {LEVEL_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="exm-field">
          <label>Mechanic</label>
          <select value={form.mechanic} onChange={e => set('mechanic', e.target.value)}>
            <option value="">—</option>
            {MECHANIC_VALUES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <MuscleSelect
          label="Primary muscles"
          selected={form.muscles_primary}
          onChange={v => set('muscles_primary', v)}
        />
        <MuscleSelect
          label="Secondary muscles"
          selected={form.muscles_secondary}
          onChange={v => set('muscles_secondary', v)}
        />

        <div className="exm-field exm-field-wide">
          <label>Description</label>
          <textarea rows="3" value={form.description} onChange={e => set('description', e.target.value)} />
        </div>

        <InstructionsEditor steps={form.instructions} onChange={v => set('instructions', v)} />

        <div className="exm-field">
          <label>Video URL (male)</label>
          <input type="text" value={form.video_url_male} onChange={e => set('video_url_male', e.target.value)} />
        </div>

        <div className="exm-field">
          <label>Video URL (female)</label>
          <input type="text" value={form.video_url_female} onChange={e => set('video_url_female', e.target.value)} />
        </div>
      </div>

      {error && <p className="exm-error">{error}</p>}

      <div className="exm-form-actions">
        <button className="admin-action-btn" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create exercise'}
        </button>
        <button className="admin-action-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ExerciseManagerTab() {
  const [exercises, setExercises] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState(undefined);   // undefined = closed, null = new
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [actionMsg, setActionMsg] = useState('');

  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);

  async function load(searchTerm = search, cat = category) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (cat) params.set('category', cat);
      const res = await fetch(`${API_BASE}/admin/exercises?${params}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setExercises(data.exercises || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load exercises:', err);
    }
    setLoading(false);
  }

  async function loadReports() {
    setReportsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/exercise-reports`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setReports(data.reports || []);
    } catch (err) {
      console.error('Failed to load exercise reports:', err);
    }
    setReportsLoading(false);
  }

  useEffect(() => { load(); loadReports(); }, []);

  async function resolveReport(id) {
    try {
      await fetch(`${API_BASE}/admin/exercise-reports/${id}/resolve`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token()}` },
      });
      setReports(rs => rs.filter(r => r.id !== id));
    } catch (err) {
      console.error('Failed to resolve report:', err);
    }
  }

  // Two-step delete: the server rejects the first call when routines reference
  // the exercise, and the confirm dialog re-sends with force=true.
  async function doDelete(exercise, force) {
    try {
      const res = await fetch(
        `${API_BASE}/admin/exercises/${exercise.id}${force ? '?force=true' : ''}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } }
      );
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body.requires_confirmation) {
        setConfirmDelete({ exercise, routineCount: body.routine_count });
        return;
      }
      if (!res.ok) {
        setActionMsg(body.error || 'Delete failed');
        setConfirmDelete(null);
        return;
      }

      setConfirmDelete(null);
      setActionMsg(`Deleted "${exercise.name}"`);
      load();
    } catch (err) {
      console.error('Delete failed:', err);
      setActionMsg('Delete failed');
    }
  }

  if (editing !== undefined) {
    return (
      <ExerciseForm
        initial={editing}
        onCancel={() => setEditing(undefined)}
        onSaved={() => { setEditing(undefined); load(); }}
      />
    );
  }

  return (
    <div className="exm-tab">
      {/* ── Unresolved reports ── */}
      <div className="exm-reports">
        <h3 className="exm-section-title">
          Flagged exercises
          {reports.length > 0 && <span className="admin-badge admin-badge-red">{reports.length}</span>}
        </h3>
        {reportsLoading ? (
          <p className="admin-loading">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="exm-empty">No unresolved reports.</p>
        ) : (
          reports.map(r => (
            <div key={r.id} className="exm-report-row">
              <div className="exm-report-body">
                <strong>{r.exercise_name || `Exercise #${r.exercise_id}`}</strong>
                <p>{r.report_text}</p>
                <span className="exm-report-meta">
                  {r.reporter_email || 'Unknown'} · {fmtDate(r.created_at)}
                </span>
              </div>
              <div className="exm-report-actions">
                <button
                  className="admin-action-btn"
                  onClick={() => {
                    const target = exercises.find(e => e.id === r.exercise_id);
                    if (target) setEditing(target);
                    else setActionMsg('Search for the exercise to edit it.');
                  }}
                >Edit</button>
                <button className="admin-action-btn" onClick={() => resolveReport(r.id)}>Resolve</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Search / filter / add ── */}
      <div className="exm-toolbar">
        <input
          type="text"
          className="exm-search"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(search, category)}
        />
        <select
          value={category}
          onChange={e => { setCategory(e.target.value); load(search, e.target.value); }}
        >
          <option value="">All categories</option>
          {EXERCISE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="admin-action-btn" onClick={() => load(search, category)}>Search</button>
        <button className="admin-action-btn" onClick={() => setEditing(null)}>+ Add exercise</button>
      </div>

      {actionMsg && <p className="exm-action-msg">{actionMsg}</p>}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <div className="exm-confirm">
          <p>
            <strong>{confirmDelete.exercise.name}</strong> is used in {confirmDelete.routineCount} saved
            routine{confirmDelete.routineCount !== 1 ? 's' : ''}. Deleting removes it from those routines.
          </p>
          <div className="exm-form-actions">
            <button className="admin-action-btn danger" onClick={() => doDelete(confirmDelete.exercise, true)}>
              Delete anyway
            </button>
            <button className="admin-action-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <p className="admin-loading">Loading…</p>
      ) : (
        <>
          <p className="exm-count">{exercises.length} of {total} shown</p>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Primary muscles</th>
                  <th>Routines</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {exercises.map(ex => (
                  <tr key={ex.id}>
                    <td>{ex.name}</td>
                    <td>{ex.category || '—'}</td>
                    <td className="exm-muscle-cell">{(ex.muscles_primary || []).join(', ') || '—'}</td>
                    <td>{ex.routine_use_count}</td>
                    <td className="exm-row-actions">
                      <button className="admin-action-btn" onClick={() => setEditing(ex)}>Edit</button>
                      <button className="admin-action-btn danger" onClick={() => doDelete(ex, false)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {exercises.length === 0 && (
                  <tr><td colSpan={5} className="exm-empty-cell">No exercises match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════
export default function AdminPanel({ onBack }) {
  const [tab, setTab] = useState('Users');

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <button className="admin-back-btn" onClick={onBack}>← Back</button>
        <h2 className="admin-title">Admin Panel</h2>
      </div>

      <div className="admin-tab-bar">
        {ADMIN_TABS.map(t => (
          <button
            key={t}
            className={`admin-tab-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="admin-content">
        {tab === 'Users' && <UsersTab />}
        {tab === 'Exercises' && <ExerciseManagerTab />}
        {tab === 'Bug Reports' && <BugReportsTab />}
        {tab === 'Error Logs' && <ErrorLogsTab />}
      </div>
    </div>
  );
}
