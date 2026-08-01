// frontend/src/components/UserPreferencesPage.jsx
// Full-page user preferences, replacing the cramped dropdown panel.
// Sections: Profile, Body Stats, Units, Goals, Change Password, App Settings (theme).
// Goals section links to GoalsPage for the full multi-select+detail flow.

import './UserPreferencesPage.css';
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ProfileCircle from './ProfileCircle';
import './UserPreferencesPage.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const GOAL_TYPES = [
  { id: 'weight_loss',  label: 'Weight Loss' },
  { id: 'muscle_gain',  label: 'Muscle Gain / Body Recomp' },
  { id: 'body_fat',     label: 'Body Fat %' },
  { id: 'speed',        label: 'Improve Speed' },
  { id: 'endurance',    label: 'Endurance' },
  { id: 'rehab',        label: 'Injury Rehab' },
  { id: 'consistency',  label: 'Consistency' },
  { id: 'flexibility',  label: 'Flexibility / Mobility' },
];

function token() { return localStorage.getItem('ripfit_token'); }

export default function UserPreferencesPage({ onBack }) {
  const { themeMode, setThemeMode } = useTheme();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState('ok'); // 'ok' | 'error'
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    display_name: '', initials: '', height_cm: '', weight_kg: '',
    date_of_birth: '', gender: '', units_weight: 'lbs',
    units_distance: 'mi', goals: [],
  });
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [pwMsgType, setPwMsgType] = useState('ok');
  const [picMsg, setPicMsg] = useState('');

  useEffect(() => { fetchProfile(); }, []);

  async function fetchProfile() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setUser(data);
      setForm({
        display_name:   data.display_name  || '',
        initials:       data.initials      || '',
        height_cm:      data.height_cm     || '',
        weight_kg:      data.weight_kg     || '',
        date_of_birth:  data.date_of_birth ? data.date_of_birth.split('T')[0] : '',
        gender:         data.gender        || '',
        units_weight:   data.units_weight  || 'lbs',
        units_distance: data.units_distance|| 'mi',
        goals:          data.goals         || [],
      });
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }

  function showMsg(msg, type = 'ok', setter = setSaveMsg, typeSetter = setSaveMsgType) {
    typeSetter(type);
    setter(msg);
    setTimeout(() => setter(''), 4000);
  }

  async function saveProfile() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => ({ ...prev, ...data }));
      showMsg('Saved.', 'ok');
    } catch (err) {
      showMsg(err.message || 'Failed to save.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function savePassword() {
    if (pwForm.next !== pwForm.confirm) {
      showMsg('New passwords do not match', 'error', setPwMsg, setPwMsgType);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/users/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showMsg('Password updated.', 'ok', setPwMsg, setPwMsgType);
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      showMsg(err.message || 'Failed to update password.', 'error', setPwMsg, setPwMsgType);
    }
  }

  function resizeImage(file, maxW, maxH, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
  }

  async function handlePictureUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setPicMsg('Please select an image file'); return; }
    setPicMsg('Processing…');
    try {
      let base64 = await resizeImage(file, 300, 300, 0.8);
      if (base64.length > 1_000_000) base64 = await resizeImage(file, 200, 200, 0.6);
      const res = await fetch(`${API_BASE}/users/me/picture`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ image: base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => ({ ...prev, profile_picture: base64 }));
      setPicMsg('Photo updated.');
    } catch (err) {
      setPicMsg(err.message || 'Failed to upload.');
    } finally {
      setTimeout(() => setPicMsg(''), 3000);
    }
  }

  async function removePhoto() {
    setPicMsg('Removing…');
    try {
      const res = await fetch(`${API_BASE}/users/me/picture`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => ({ ...prev, profile_picture: null }));
      setPicMsg('Photo removed.');
    } catch (err) {
      setPicMsg(err.message || 'Failed to remove.');
    } finally {
      setTimeout(() => setPicMsg(''), 3000);
    }
  }

  // Goal helpers
  function toggleGoal(goalId) {
    setForm(prev => {
      const exists = prev.goals.find(g => g.type === goalId);
      return exists
        ? { ...prev, goals: prev.goals.filter(g => g.type !== goalId) }
        : { ...prev, goals: [...prev.goals, { type: goalId, details: {} }] };
    });
  }

  const updateGoalDetail = useCallback((goalId, field, value) => {
    setForm(prev => ({
      ...prev,
      goals: prev.goals.map(g =>
        g.type === goalId ? { ...g, details: { ...g.details, [field]: value } } : g
      ),
    }));
  }, []);

  function getGoalDetails(goalId) {
    return form.goals.find(g => g.type === goalId)?.details || {};
  }

  const SECTIONS = [
    { id: 'profile',   label: 'Profile' },
    { id: 'body',      label: 'Body Stats' },
    { id: 'goals',     label: 'Goals' },
    { id: 'password',  label: 'Password' },
    { id: 'settings',  label: 'App Settings' },
  ];

  if (loading) return <div className="prefs-page"><p className="prefs-loading">Loading…</p></div>;

  return (
    <div className="prefs-page">
      {/* Header */}
      <div className="prefs-header">
        <button className="prefs-back-btn" onClick={onBack}>← Back</button>
        <h2 className="prefs-title">User Preferences</h2>
      </div>

      <div className="prefs-layout">
        {/* Sidebar nav */}
        <nav className="prefs-sidebar">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`prefs-nav-btn ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >{s.label}</button>
          ))}
        </nav>

        {/* Content */}
        <div className="prefs-content">

          {/* ── Profile section ── */}
          {activeSection === 'profile' && (
            <div className="prefs-section">
              <h3>Profile</h3>

              {/* Photo */}
              <div className="prefs-field-group">
                <label>Profile Photo</label>
                <div className="prefs-photo-row">
                  <ProfileCircle user={user} size={64} onClick={() => fileInputRef.current?.click()} />
                  <div className="prefs-photo-actions">
                    <button className="prefs-btn-secondary" onClick={() => fileInputRef.current?.click()}>
                      {user?.profile_picture ? 'Change photo' : 'Upload photo'}
                    </button>
                    {user?.profile_picture && (
                      <button className="prefs-btn-danger" onClick={removePhoto}>Remove</button>
                    )}
                  </div>
                  <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handlePictureUpload} />
                </div>
                {picMsg && <p className="prefs-msg">{picMsg}</p>}
              </div>

              <div className="prefs-field-group">
                <label>Display Name</label>
                <input type="text" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="How you want to be called" />
              </div>

              <div className="prefs-field-group">
                <label>Initials <span className="prefs-label-hint">(shown on plate icon)</span></label>
                <input
                  type="text" maxLength={3}
                  value={form.initials}
                  onChange={e => setForm(f => ({ ...f, initials: e.target.value.toUpperCase() }))}
                  placeholder="e.g. SR"
                  style={{ width: '80px' }}
                />
              </div>

              <div className="prefs-field-group">
                <label>Date of Birth</label>
                <input type="date" value={form.date_of_birth} onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
              </div>

              <div className="prefs-field-group">
                <label>Gender</label>
                <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="non-binary">Non-binary</option>
                </select>
              </div>

              <div className="prefs-field-group">
                <label>Units</label>
                <div className="prefs-units-row">
                  <div className="prefs-toggle-group">
                    <span>Weight</span>
                    {['lbs', 'kg'].map(u => (
                      <button key={u} className={`prefs-toggle-btn ${form.units_weight === u ? 'active' : ''}`} onClick={() => setForm(f => ({ ...f, units_weight: u }))}>{u}</button>
                    ))}
                  </div>
                  <div className="prefs-toggle-group">
                    <span>Distance</span>
                    {['mi', 'km'].map(u => (
                      <button key={u} className={`prefs-toggle-btn ${form.units_distance === u ? 'active' : ''}`} onClick={() => setForm(f => ({ ...f, units_distance: u }))}>{u}</button>
                    ))}
                  </div>
                </div>
              </div>

              <button className="prefs-btn-primary" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
              {saveMsg && <p className={`prefs-msg ${saveMsgType === 'error' ? 'error' : ''}`}>{saveMsg}</p>}
            </div>
          )}

          {/* ── Body Stats section ── */}
          {activeSection === 'body' && (
            <div className="prefs-section">
              <h3>Body Stats</h3>
              <p className="prefs-hint">Used for calculations like estimated calorie burn, macro targets, and progress tracking.</p>

              <div className="prefs-field-row">
                <div className="prefs-field-group">
                  <label>Height</label>
                  {form.units_weight === 'lbs' ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number" min={0} max={9}
                        value={form.height_cm ? Math.floor(form.height_cm / 30.48) : ''}
                        onChange={e => {
                          const ft = parseInt(e.target.value) || 0;
                          const curIn = form.height_cm ? Math.round((form.height_cm / 2.54) % 12) : 0;
                          setForm(f => ({ ...f, height_cm: Math.round((ft * 12 + curIn) * 2.54) }));
                        }}
                        style={{ width: 64 }}
                        placeholder="ft"
                      />
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}>ft</span>
                      <input
                        type="number" min={0} max={11}
                        value={form.height_cm ? Math.round((form.height_cm / 2.54) % 12) : ''}
                        onChange={e => {
                          const inches = parseInt(e.target.value) || 0;
                          const curFt = form.height_cm ? Math.floor(form.height_cm / 30.48) : 0;
                          setForm(f => ({ ...f, height_cm: Math.round((curFt * 12 + inches) * 2.54) }));
                        }}
                        style={{ width: 64 }}
                        placeholder="in"
                      />
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}>in</span>
                    </div>
                  ) : (
                    <input
                      type="number"
                      value={form.height_cm}
                      onChange={e => setForm(f => ({ ...f, height_cm: e.target.value }))}
                      placeholder="cm"
                      style={{ maxWidth: 120 }}
                    />
                  )}
                </div>
                <div className="prefs-field-group">
                  <label>Weight ({form.units_weight})</label>
                  <input type="number" step="0.1" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} style={{ maxWidth: 120 }} />
                </div>
              </div>

              <button className="prefs-btn-primary" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saveMsg && <p className={`prefs-msg ${saveMsgType === 'error' ? 'error' : ''}`}>{saveMsg}</p>}
            </div>
          )}

          {/* ── Goals section ── */}
          {activeSection === 'goals' && (
            <div className="prefs-section">
              <h3>Goals</h3>
              <p className="prefs-hint">Select all that apply. The more detail you fill in, the better RipFit can guide your programming and nutrition.</p>

              <div className="prefs-goals-list">
                {GOAL_TYPES.map(goal => {
                  const active = form.goals.some(g => g.type === goal.id);
                  const details = getGoalDetails(goal.id);
                  return (
                    <div key={goal.id} className={`prefs-goal-item ${active ? 'active' : ''}`}>
                      <button className="prefs-goal-toggle" onClick={() => toggleGoal(goal.id)}>
                        <span className={`prefs-goal-check ${active ? 'checked' : ''}`}>{active ? '✓' : '+'}</span>
                        {goal.label}
                      </button>
                      {active && (
                        <div className="prefs-goal-details">
                          <GoalDetails
                            key={goal.id}
                            goalId={goal.id}
                            details={details}
                            onChange={updateGoalDetail}
                            unitsWeight={form.units_weight}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button className="prefs-btn-primary" onClick={saveProfile} disabled={saving} style={{ marginTop: 20 }}>
                {saving ? 'Saving…' : 'Save Goals'}
              </button>
              {saveMsg && <p className={`prefs-msg ${saveMsgType === 'error' ? 'error' : ''}`}>{saveMsg}</p>}
            </div>
          )}

          {/* ── Password section ── */}
          {activeSection === 'password' && (
            <div className="prefs-section">
              <h3>Change Password</h3>
              <div className="prefs-field-group">
                <label>Current Password</label>
                <input type="password" value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} />
              </div>
              <div className="prefs-field-group">
                <label>New Password</label>
                <input type="password" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} />
              </div>
              <div className="prefs-field-group">
                <label>Confirm New Password</label>
                <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} />
              </div>
              <p className="prefs-hint">Min 8 chars, uppercase, lowercase, number, special character.</p>
              <button
                className="prefs-btn-primary"
                onClick={savePassword}
                disabled={!pwForm.current || !pwForm.next || !pwForm.confirm}
              >Update Password</button>
              {pwMsg && <p className={`prefs-msg ${pwMsgType === 'error' ? 'error' : ''}`}>{pwMsg}</p>}
            </div>
          )}

          {/* ── App Settings section ── */}
          {activeSection === 'settings' && (
            <div className="prefs-section">
              <h3>App Settings</h3>

              <div className="prefs-field-group">
                <label>Theme</label>
                <div className="prefs-toggle-group">
                  {['light', 'dark', 'system'].map(t => (
                    <button
                      key={t}
                      className={`prefs-toggle-btn ${themeMode === t ? 'active' : ''}`}
                      onClick={() => setThemeMode(t)}
                    >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
              </div>

              <div className="prefs-field-group" style={{ marginTop: 24 }}>
                <label>Email</label>
                <p className="prefs-value">{user?.email}</p>
                {user && !user.email_verified && (
                  <span className="prefs-unverified">Email not verified</span>
                )}
              </div>

              <div className="prefs-field-group">
                <label>Account</label>
                <p className="prefs-value">@{user?.username}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── GoalField: standalone component, never defined inside another component ──
// This is critical — defining components inside render functions causes React
// to treat them as new component types on every render, unmounting/remounting
// inputs and losing focus. GoalField lives at module scope permanently.
function GoalField({ label, field, type, placeholder, step, value, onFieldChange, onFieldBlur }) {
  return (
    <div className="prefs-goal-field">
      <label>{label}</label>
      <input
        type={type || 'text'}
        step={step}
        placeholder={placeholder || ''}
        value={value}
        onChange={e => onFieldChange(field, e.target.value)}
        onBlur={e => onFieldBlur(field, e.target.value)}
      />
    </div>
  );
}

// GoalDetails is memoized so it only re-renders when its own props change,
// not when the parent form state updates other fields.
const GoalDetails = memo(function GoalDetails({ goalId, details, onChange, unitsWeight }) {
  const wUnit = unitsWeight || 'lbs';
  const dimUnit = wUnit === 'lbs' ? 'in' : 'cm';

  // Local draft — initialized once, updated as user types.
  // Syncs to parent only on blur to avoid re-render on every keystroke.
  const [draft, setDraft] = useState(() => ({ ...details }));

  const handleChange = useCallback((field, value) => {
    setDraft(d => ({ ...d, [field]: value }));
  }, []);

  const handleBlur = useCallback((field, value) => {
    onChange(goalId, field, value);
  }, [goalId, onChange]);

  // Helper to render a GoalField with all shared props pre-filled.
  // Written as a regular function (not JSX component) so it never gets
  // a new identity and never triggers unmount/remount.
  const f = (label, field, type, placeholder, step) => (
    <GoalField
      key={field}
      label={label}
      field={field}
      type={type || 'text'}
      placeholder={placeholder || ''}
      step={step}
      value={draft[field] || ''}
      onFieldChange={handleChange}
      onFieldBlur={handleBlur}
    />
  );

  switch (goalId) {
    case 'weight_loss': return (
      <div className="prefs-goal-field-set">
        <p className="prefs-goal-hint">Used to calculate your target weekly deficit.</p>
        {f(`Current weight (${wUnit})`, 'current_weight', 'number')}
        {f(`Target weight (${wUnit})`, 'target_weight', 'number')}
        {f('Target date', 'target_date', 'date')}
        <WeightLossCalc details={draft} unit={wUnit} />
      </div>
    );
    case 'muscle_gain': return (
      <div className="prefs-goal-field-set">
        <p className="prefs-goal-hint">Track weight, measurements, and key lift targets.</p>
        {f(`Current weight (${wUnit})`, 'current_weight', 'number')}
        {f(`Target weight (${wUnit})`, 'target_weight', 'number')}
        {f('Target date', 'target_date', 'date')}
        {f(`Waist (${dimUnit})`, 'waist', 'number')}
        {f(`Chest (${dimUnit})`, 'chest', 'number')}
        {f(`Arm (${dimUnit})`, 'arm', 'number')}
        {f(`Squat current 1RM (${wUnit})`, 'squat_current', 'number')}
        {f(`Squat target 1RM (${wUnit})`, 'squat_target', 'number')}
        {f(`Bench current 1RM (${wUnit})`, 'bench_current', 'number')}
        {f(`Bench target 1RM (${wUnit})`, 'bench_target', 'number')}
        {f(`Deadlift current 1RM (${wUnit})`, 'deadlift_current', 'number')}
        {f(`Deadlift target 1RM (${wUnit})`, 'deadlift_target', 'number')}
      </div>
    );
    case 'body_fat': return (
      <div className="prefs-goal-field-set">
        {f('Current body fat %', 'current_bf', 'number', '', '0.1')}
        {f('Target body fat %', 'target_bf', 'number', '', '0.1')}
        {f('Target date', 'target_date', 'date')}
        {f('Measurement source', 'source', 'text', 'DEXA, calipers, scale…')}
      </div>
    );
    case 'speed': return (
      <div className="prefs-goal-field-set">
        {f('Event / distance', 'event', 'text', '100m, 5K, mile…')}
        {f('Current best time', 'current_time', 'text', 'e.g. 12.4s')}
        {f('Target time', 'target_time', 'text', 'e.g. 11.9s')}
        {f('Target date', 'target_date', 'date')}
        {f('Notes', 'notes', 'text', 'mid-race slump, acceleration…')}
      </div>
    );
    case 'endurance': return (
      <div className="prefs-goal-field-set">
        {f('Event / distance', 'event', 'text', 'half marathon, century ride…')}
        {f('Current capability', 'current', 'text', 'can run 8mi comfortably')}
        {f('Target finish time', 'target_time', 'text', 'sub-2hr')}
        {f('Race / event date', 'target_date', 'date')}
      </div>
    );
    case 'rehab': return (
      <div className="prefs-goal-field-set">
        <p className="prefs-goal-hint">Your trainer can add more specific programming once connected.</p>
        {f('Injury / area', 'injury', 'text', 'left knee, rotator cuff…')}
        {f('Target outcome', 'target', 'text', 'return to sport, pain-free squat…')}
        {f('Notes', 'notes')}
      </div>
    );
    case 'consistency': return (
      <div className="prefs-goal-field-set">
        {f('Sessions per week', 'sessions_per_week', 'number')}
        {f('Or: minutes per day', 'minutes_per_day', 'number')}
      </div>
    );
    case 'flexibility': return (
      <div className="prefs-goal-field-set">
        {f('Focus area', 'focus', 'text', 'hip flexors, hamstrings…')}
        {f('Current limitation', 'current', 'text', "can't touch toes")}
        {f('Target', 'target', 'text', 'full splits, overhead squat…')}
      </div>
    );
    default: return null;
  }
}); // end memo(GoalDetails)

function WeightLossCalc({ details, unit }) {
  const current = parseFloat(details.current_weight);
  const target  = parseFloat(details.target_weight);
  const date    = new Date(details.target_date);
  const today   = new Date();
  if (isNaN(current) || isNaN(target) || isNaN(date.getTime()) || target >= current) return null;
  const weeks   = Math.max(1, Math.round((date - today) / (7 * 24 * 60 * 60 * 1000)));
  const perWeek = ((current - target) / weeks).toFixed(2);
  const aggressive = parseFloat(perWeek) > 2;
  return (
    <div className={`prefs-calc ${aggressive ? 'aggressive' : ''}`}>
      <strong>~{perWeek} {unit}/week</strong> over {weeks} weeks
      {aggressive && <p className="prefs-calc-warning">That's an aggressive pace. Consider extending your timeline or consulting a registered dietitian.</p>}
    </div>
  );
}
