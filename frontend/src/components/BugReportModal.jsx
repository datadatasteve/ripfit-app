// frontend/src/components/BugReportModal.jsx
import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default function BugReportModal({ onClose, currentView }) {
  const [form, setForm] = useState({ title: '', description: '' });
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error

  async function submit() {
    if (!form.title.trim() || !form.description.trim()) return;
    setStatus('submitting');
    try {
      const res = await fetch(`${API_BASE}/admin/bug-reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('ripfit_token')}`,
        },
        body: JSON.stringify({ ...form, current_view: currentView }),
      });
      if (!res.ok) throw new Error();
      setStatus('success');
      setTimeout(onClose, 2000);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3 style={{ marginBottom: 16 }}>Report a Bug</h3>

        {status === 'success' ? (
          <p style={{ color: 'var(--color-success)', textAlign: 'center', padding: '20px 0' }}>
            Thanks — report submitted.
          </p>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                Summary
              </label>
              <input
                type="text"
                maxLength={200}
                placeholder="Short description of the issue"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.8em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                Details
              </label>
              <textarea
                rows={5}
                maxLength={2000}
                placeholder="What were you doing? What did you expect to happen? What actually happened?"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>

            {status === 'error' && (
              <p style={{ color: 'var(--color-danger)', fontSize: '0.85em', marginBottom: 12 }}>
                Failed to submit. Please try again.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={status === 'submitting' || !form.title.trim() || !form.description.trim()}
                style={{ flex: 1 }}
              >
                {status === 'submitting' ? 'Submitting…' : 'Submit Report'}
              </button>
              <button
                onClick={onClose}
                style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
