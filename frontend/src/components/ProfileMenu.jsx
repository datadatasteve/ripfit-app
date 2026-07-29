// frontend/src/components/ProfileMenu.jsx
// Dropdown that opens from the profile circle. Three sections:
//   Settings        — app-level config (theme)
//   User Preferences — personal profile, goals
//   Logout

import './ProfileMenu.css';
import { useState, useEffect, useRef } from 'react';
import ProfileCircle from './ProfileCircle';
import { useTheme } from '../contexts/ThemeContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const GOAL_TYPES = [
  { id: 'weight_loss',       label: 'Weight Loss' },
  { id: 'muscle_gain',       label: 'Muscle Gain / Body Recomp' },
  { id: 'body_fat',          label: 'Body Fat %' },
  { id: 'speed',             label: 'Improve Speed' },
  { id: 'endurance',         label: 'Endurance' },
  { id: 'rehab',             label: 'Injury Rehab' },
  { id: 'consistency',       label: 'Consistency' },
  { id: 'flexibility',       label: 'Flexibility / Mobility' },
];

export default function ProfileMenu({ onLogout }) {
  const { themeMode, setThemeMode } = useTheme();
  const [open, setOpen]         = useState(false);
  const [panel, setPanel]       = useState(null); // null | 'settings' | 'prefs'
  const [user, setUser]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState('');
  const menuRef = useRef(null);

  // Profile form state
  const [form, setForm] = useState({
    display_name: '', initials: '', height_cm: '', weight_kg: '',
    date_of_birth: '', gender: '', units_weight: 'lbs',
    units_distance: 'mi', goals: [],
  });

  // Password form state
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg]   = useState('');

  // Picture upload state
  const [picMsg, setPicMsg] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open && !user) fetchProfile();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
        setPanel(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const token = () => localStorage.getItem('ripfit_token');

  async function fetchProfile() {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      const data = await res.json();
      setUser(data);
      setForm({
        display_name:  data.display_name  || '',
        initials:      data.initials      || '',
        height_cm:     data.height_cm     || '',
        weight_kg:     data.weight_kg     || '',
        date_of_birth: data.date_of_birth ? data.date_of_birth.split('T')[0] : '',
        gender:        data.gender        || '',
        units_weight:  data.units_weight  || 'lbs',
        units_distance:data.units_distance|| 'mi',
        goals:         data.goals         || [],
      });
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => ({ ...prev, ...data }));
      setSaveMsg('Saved.');
    } catch (err) {
      setSaveMsg(err.message || 'Failed to save');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }

  async function savePassword() {
    setPwMsg('');
    if (pwForm.next !== pwForm.confirm) {
      setPwMsg('New passwords do not match');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/users/me/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPwMsg('Password updated.');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwMsg(err.message || 'Failed to update password');
    } finally {
      setTimeout(() => setPwMsg(''), 4000);
    }
  }

  async function handlePictureUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPicMsg('Please select an image file');
      return;
    }

    setPicMsg('Processing…');

    try {
      // Resize client-side to max 400x400 before converting to base64.
      // This keeps the stored blob small regardless of source image size.
      let base64 = await resizeImage(file, 300, 300, 0.75);
      if (base64.length > 1_000_000) {
        base64 = await resizeImage(file, 200, 200, 0.6);
      }

      const res = await fetch(`${API_BASE}/users/me/picture`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({ image: base64 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => ({ ...prev, profile_picture: base64 }));
      setPicMsg('Photo updated.');
    } catch (err) {
      setPicMsg(err.message || 'Failed to upload photo');
    } finally {
      setTimeout(() => setPicMsg(''), 3000);
    }
  }

  // Draws the image onto a canvas at max dimensions, returns base64 JPEG.
  // maxW/maxH: maximum output dimensions. quality: JPEG compression 0-1.
  function resizeImage(file, maxW, maxH, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
  }

  // ── Goal helpers ──────────────────────────────────────────────────────────

  function toggleGoal(goalId) {
    setForm(prev => {
      const exists = prev.goals.find(g => g.type === goalId);
      if (exists) {
        return { ...prev, goals: prev.goals.filter(g => g.type !== goalId) };
      }
      return { ...prev, goals: [...prev.goals, { type: goalId, details: {} }] };
    });
  }

  function updateGoalDetail(goalId, field, value) {
    setForm(prev => ({
      ...prev,
      goals: prev.goals.map(g =>
        g.type === goalId ? { ...g, details: { ...g.details, [field]: value } } : g
      )
    }));
  }

  function getGoalDetails(goalId) {
    return form.goals.find(g => g.type === goalId)?.details || {};
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="profile-menu-wrapper" ref={menuRef}>
      <ProfileCircle
        user={user}
        onClick={() => { setOpen(o => !o); setPanel(null); }}
      />

      {open && (
        <div className="profile-dropdown">
          {/* ── Top: user identity ── */}
          <div className="profile-dropdown-identity">
            <span className="profile-dropdown-username">
              {user?.display_name || user?.username || '…'}
            </span>
            <span className="profile-dropdown-email">{user?.email || ''}</span>
            {user && !user.email_verified && (
              <span className="profile-unverified-badge">Email not verified</span>
            )}
          </div>

          <div className="profile-dropdown-divider" />

          {/* ── Main menu ── */}
          {!panel && (
            <ul className="profile-dropdown-menu">
              <li onClick={() => setPanel('settings')}>Settings</li>
              <li onClick={() => setPanel('prefs')}>User Preferences</li>
              <li className="profile-dropdown-logout" onClick={onLogout}>Log Out</li>
            </ul>
          )}

          {/* ── Settings panel ── */}
          {panel === 'settings' && (
            <div className="profile-panel">
              <button className="profile-panel-back" onClick={() => setPanel(null)}>← Back</button>
              <h3>Settings</h3>

              <div className="profile-field-group">
                <label>Theme</label>
                <div className="theme-options">
                  {['light', 'dark', 'system'].map(t => (
                    <button
                      key={t}
                      className={`theme-option-btn ${themeMode === t ? 'active' : ''}`}
                      onClick={() => setThemeMode(t)}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── User Preferences panel ── */}
          {panel === 'prefs' && (
            <div className="profile-panel">
              <button className="profile-panel-back" onClick={() => setPanel(null)}>← Back</button>
              <h3>User Preferences</h3>

              {loading ? (
                <p className="profile-loading">Loading…</p>
              ) : (
                <>
                  {/* Profile picture */}
                  <div className="profile-field-group">
                    <label>Profile Photo</label>
                    <div className="profile-pic-row">
                      <ProfileCircle user={user} size={56} onClick={() => fileInputRef.current?.click()} />
                      <button className="profile-pic-upload-btn" onClick={() => fileInputRef.current?.click()}>
                        {user?.profile_picture ? 'Change photo' : 'Upload photo'}
                      </button>
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handlePictureUpload}
                      />
                    </div>
                    {picMsg && <p className="profile-msg">{picMsg}</p>}
                  </div>

                  {/* Basic info */}
                  <div className="profile-field-group">
                    <label>Display Name</label>
                    <input
                      type="text"
                      value={form.display_name}
                      onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                      placeholder="How you want to be called"
                    />
                  </div>

                  <div className="profile-field-group">
                    <label>Initials <span className="profile-label-hint">(shown on plate icon)</span></label>
                    <input
                      type="text"
                      maxLength={3}
                      value={form.initials}
                      onChange={e => setForm(f => ({ ...f, initials: e.target.value.toUpperCase() }))}
                      placeholder="e.g. SR"
                      style={{ width: '80px' }}
                    />
                  </div>

                  <div className="profile-field-group">
                    <label>Date of Birth</label>
                    <input
                      type="date"
                      value={form.date_of_birth}
                      onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))}
                    />
                  </div>

                  <div className="profile-field-group">
                    <label>Gender</label>
                    <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                      <option value="">Prefer not to say</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="non-binary">Non-binary</option>
                    </select>
                  </div>

                  {/* Body stats */}
                  <div className="profile-field-group">
                    <label>Height</label>
                    <div className="profile-inline-row">
                      <input
                        type="number"
                        value={form.height_cm}
                        onChange={e => setForm(f => ({ ...f, height_cm: e.target.value }))}
                        placeholder={form.units_weight === 'lbs' ? 'inches' : 'cm'}
                        style={{ width: '80px' }}
                      />
                      <span className="profile-unit-label">
                        {form.units_weight === 'lbs' ? 'in' : 'cm'}
                      </span>
                    </div>
                  </div>

                  <div className="profile-field-group">
                    <label>Weight</label>
                    <div className="profile-inline-row">
                      <input
                        type="number"
                        step="0.1"
                        value={form.weight_kg}
                        onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))}
                        placeholder={form.units_weight === 'lbs' ? 'lbs' : 'kg'}
                        style={{ width: '80px' }}
                      />
                      <span className="profile-unit-label">{form.units_weight}</span>
                    </div>
                  </div>

                  {/* Unit preferences */}
                  <div className="profile-field-group">
                    <label>Units</label>
                    <div className="profile-units-row">
                      <div className="profile-toggle-group">
                        <span>Weight</span>
                        {['lbs', 'kg'].map(u => (
                          <button
                            key={u}
                            className={`unit-toggle-btn ${form.units_weight === u ? 'active' : ''}`}
                            onClick={() => setForm(f => ({ ...f, units_weight: u }))}
                          >
                            {u}
                          </button>
                        ))}
                      </div>
                      <div className="profile-toggle-group">
                        <span>Distance</span>
                        {['mi', 'km'].map(u => (
                          <button
                            key={u}
                            className={`unit-toggle-btn ${form.units_distance === u ? 'active' : ''}`}
                            onClick={() => setForm(f => ({ ...f, units_distance: u }))}
                          >
                            {u}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Goals */}
                  <div className="profile-field-group">
                    <label>Goals <span className="profile-label-hint">(select all that apply)</span></label>
                    <p className="profile-goals-hint">The more info you fill in, the better RipFit can guide you.</p>
                    <div className="profile-goals-list">
                      {GOAL_TYPES.map(goal => {
                        const active  = form.goals.some(g => g.type === goal.id);
                        const details = getGoalDetails(goal.id);
                        return (
                          <div key={goal.id} className={`profile-goal-item ${active ? 'active' : ''}`}>
                            <button
                              className="profile-goal-toggle"
                              onClick={() => toggleGoal(goal.id)}
                            >
                              <span className={`goal-check ${active ? 'checked' : ''}`}>
                                {active ? '✓' : '+'}
                              </span>
                              {goal.label}
                            </button>

                            {active && (
                              <div className="profile-goal-details">
                                <GoalDetails
                                  goalId={goal.id}
                                  details={details}
                                  onChange={(field, val) => updateGoalDetail(goal.id, field, val)}
                                  unitsWeight={form.units_weight}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Save profile */}
                  <button
                    className="profile-save-btn"
                    onClick={saveProfile}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save Profile'}
                  </button>
                  {saveMsg && <p className="profile-msg">{saveMsg}</p>}

                  <div className="profile-divider" />

                  {/* Change password */}
                  <div className="profile-field-group">
                    <label>Change Password</label>
                    <input
                      type="password"
                      placeholder="Current password"
                      value={pwForm.current}
                      onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                    />
                    <input
                      type="password"
                      placeholder="New password"
                      value={pwForm.next}
                      onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                      style={{ marginTop: '6px' }}
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={pwForm.confirm}
                      onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                      style={{ marginTop: '6px' }}
                    />
                    <button
                      className="profile-save-btn"
                      onClick={savePassword}
                      style={{ marginTop: '8px' }}
                      disabled={!pwForm.current || !pwForm.next || !pwForm.confirm}
                    >
                      Update Password
                    </button>
                    {pwMsg && <p className="profile-msg">{pwMsg}</p>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Goal detail sub-forms ──────────────────────────────────────────────────
// Each goal type gets its own optional fields. All fields are optional —
// the hint at the top of the goals section explains why more = better.

function GoalDetails({ goalId, details, onChange, unitsWeight }) {
  const wUnit = unitsWeight || 'lbs';

  switch (goalId) {
    case 'weight_loss':
      return (
        <GoalFieldSet hint="Used to calculate your target weekly deficit.">
          <GoalField label={`Current weight (${wUnit})`} field="current_weight" details={details} onChange={onChange} type="number" />
          <GoalField label={`Target weight (${wUnit})`} field="target_weight" details={details} onChange={onChange} type="number" />
          <GoalField label="Target date" field="target_date" details={details} onChange={onChange} type="date" />
          {details.current_weight && details.target_weight && details.target_date && (
            <WeightLossCalc details={details} unit={wUnit} />
          )}
        </GoalFieldSet>
      );

    case 'muscle_gain':
      return (
        <GoalFieldSet hint="Track multiple proxies — weight, measurements, and key lift targets.">
          <GoalField label={`Current weight (${wUnit})`} field="current_weight" details={details} onChange={onChange} type="number" />
          <GoalField label={`Target weight (${wUnit})`} field="target_weight" details={details} onChange={onChange} type="number" />
          <GoalField label="Target date" field="target_date" details={details} onChange={onChange} type="date" />
          <GoalField label={`Waist measurement (${wUnit === 'lbs' ? 'in' : 'cm'})`} field="waist" details={details} onChange={onChange} type="number" />
          <GoalField label={`Chest measurement (${wUnit === 'lbs' ? 'in' : 'cm'})`} field="chest" details={details} onChange={onChange} type="number" />
          <GoalField label={`Arm measurement (${wUnit === 'lbs' ? 'in' : 'cm'})`} field="arm" details={details} onChange={onChange} type="number" />
          <GoalField label={`Current squat 1RM (${wUnit})`} field="squat_current" details={details} onChange={onChange} type="number" />
          <GoalField label={`Target squat 1RM (${wUnit})`} field="squat_target" details={details} onChange={onChange} type="number" />
          <GoalField label={`Current bench 1RM (${wUnit})`} field="bench_current" details={details} onChange={onChange} type="number" />
          <GoalField label={`Target bench 1RM (${wUnit})`} field="bench_target" details={details} onChange={onChange} type="number" />
          <GoalField label={`Current deadlift 1RM (${wUnit})`} field="deadlift_current" details={details} onChange={onChange} type="number" />
          <GoalField label={`Target deadlift 1RM (${wUnit})`} field="deadlift_target" details={details} onChange={onChange} type="number" />
        </GoalFieldSet>
      );

    case 'body_fat':
      return (
        <GoalFieldSet hint="BF% from a scan or measurement gives the most accurate tracking.">
          <GoalField label="Current body fat %" field="current_bf" details={details} onChange={onChange} type="number" step="0.1" />
          <GoalField label="Target body fat %" field="target_bf" details={details} onChange={onChange} type="number" step="0.1" />
          <GoalField label="Target date" field="target_date" details={details} onChange={onChange} type="date" />
          <GoalField label="Measurement source (DEXA, calipers, scale…)" field="source" details={details} onChange={onChange} type="text" />
        </GoalFieldSet>
      );

    case 'speed':
      return (
        <GoalFieldSet hint="Choose your event and set a time target.">
          <GoalField label="Event / distance (e.g. 100m, 5K, mile)" field="event" details={details} onChange={onChange} type="text" />
          <GoalField label="Current best time" field="current_time" details={details} onChange={onChange} type="text" placeholder="e.g. 12.4s or 22:15" />
          <GoalField label="Target time" field="target_time" details={details} onChange={onChange} type="text" placeholder="e.g. 11.9s or 21:00" />
          <GoalField label="Target date" field="target_date" details={details} onChange={onChange} type="date" />
          <GoalField label="Notes (e.g. mid-race slump, acceleration)" field="notes" details={details} onChange={onChange} type="text" />
        </GoalFieldSet>
      );

    case 'endurance':
      return (
        <GoalFieldSet hint="Event-based goals help structure your training blocks.">
          <GoalField label="Event / distance" field="event" details={details} onChange={onChange} type="text" placeholder="e.g. half marathon, century ride" />
          <GoalField label="Current capability" field="current" details={details} onChange={onChange} type="text" placeholder="e.g. can run 8mi comfortably" />
          <GoalField label="Target finish time" field="target_time" details={details} onChange={onChange} type="text" placeholder="e.g. sub-2hr" />
          <GoalField label="Race / event date" field="target_date" details={details} onChange={onChange} type="date" />
        </GoalFieldSet>
      );

    case 'rehab':
      return (
        <GoalFieldSet hint="Your trainer can add more specific programming once connected.">
          <GoalField label="Injury / area" field="injury" details={details} onChange={onChange} type="text" placeholder="e.g. left knee, rotator cuff" />
          <GoalField label="Target outcome" field="target" details={details} onChange={onChange} type="text" placeholder="e.g. return to sport, pain-free squat" />
          <GoalField label="Notes" field="notes" details={details} onChange={onChange} type="text" />
        </GoalFieldSet>
      );

    case 'consistency':
      return (
        <GoalFieldSet hint="Sets a weekly target you can track in your stats.">
          <GoalField label="Sessions per week" field="sessions_per_week" details={details} onChange={onChange} type="number" />
          <GoalField label="Or: minutes per day" field="minutes_per_day" details={details} onChange={onChange} type="number" />
        </GoalFieldSet>
      );

    case 'flexibility':
      return (
        <GoalFieldSet hint="Pairs well with your workout programming once yoga/mobility content is added.">
          <GoalField label="Focus area (e.g. hip flexors, hamstrings)" field="focus" details={details} onChange={onChange} type="text" />
          <GoalField label="Current limitation" field="current" details={details} onChange={onChange} type="text" placeholder="e.g. can't touch toes" />
          <GoalField label="Target" field="target" details={details} onChange={onChange} type="text" placeholder="e.g. full splits, overhead squat" />
        </GoalFieldSet>
      );

    default:
      return null;
  }
}

// Simple wrapper for a goal's sub-fields with an optional hint line
function GoalFieldSet({ children, hint }) {
  return (
    <div className="goal-field-set">
      {hint && <p className="goal-field-hint">{hint}</p>}
      {children}
    </div>
  );
}

// Single labelled input inside a goal detail block
function GoalField({ label, field, details, onChange, type = 'text', placeholder, step }) {
  return (
    <div className="goal-field">
      <label>{label}</label>
      <input
        type={type}
        step={step}
        placeholder={placeholder || ''}
        value={details[field] || ''}
        onChange={e => onChange(field, e.target.value)}
      />
    </div>
  );
}

// Inline calculator for weight loss — shows weekly deficit needed
function WeightLossCalc({ details, unit }) {
  const current = parseFloat(details.current_weight);
  const target  = parseFloat(details.target_weight);
  const date    = new Date(details.target_date);
  const today   = new Date();

  if (isNaN(current) || isNaN(target) || isNaN(date.getTime())) return null;
  if (target >= current) return null;

  const weeks = Math.max(1, Math.round((date - today) / (7 * 24 * 60 * 60 * 1000)));
  const totalLoss = current - target;
  const perWeek   = (totalLoss / weeks).toFixed(2);

  // Flag if the rate is aggressive (>1% body weight/week is generally considered fast)
  const aggressive = parseFloat(perWeek) > 2;

  return (
    <div className={`weight-loss-calc ${aggressive ? 'aggressive' : ''}`}>
      <strong>~{perWeek} {unit}/week</strong> over {weeks} weeks
      {aggressive && (
        <p className="calc-warning">
          That's an aggressive pace. Consider extending your timeline or consulting a registered dietitian.
        </p>
      )}
    </div>
  );
}
