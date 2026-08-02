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
const ADMIN_TABS = ['Users', 'Bug Reports', 'Error Logs'];

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
        {tab === 'Bug Reports' && <BugReportsTab />}
        {tab === 'Error Logs' && <ErrorLogsTab />}
      </div>
    </div>
  );
}
