// frontend/src/components/ErrorBoundary.jsx
// React class component — error boundaries must be class components per React spec.
// Catches any JS error in the component tree below it, logs it to the backend,
// and shows a friendly recovery screen instead of a blank crash.

import { Component } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorId: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Determine current view from URL or localStorage
    const currentView = new URLSearchParams(window.location.search).get('view') || 'unknown';
    const userId = this.getUserId();

    // Post to backend — fire and forget, don't let logging errors cause more crashes
    fetch(`${API_BASE}/admin/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        error_message: error?.message || String(error),
        error_stack: error?.stack || info?.componentStack || null,
        component: info?.componentStack?.split('\n')[1]?.trim() || null,
        current_view: currentView,
        user_agent: navigator.userAgent,
        url: window.location.href,
        severity: 'error',
      }),
    }).catch(() => {}); // silently ignore if logging itself fails
  }

  getUserId() {
    try {
      const token = localStorage.getItem('ripfit_token');
      if (!token) return null;
      // Decode JWT payload (middle section, base64)
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.userId || null;
    } catch {
      return null;
    }
  }

  handleReset() {
    this.setState({ hasError: false });
    // Navigate to home/workouts
    window.location.hash = '';
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          background: 'var(--bg-primary, #0f172a)',
          color: 'var(--text-primary, #f0f0f0)',
          textAlign: 'center',
          fontFamily: 'var(--font-sans, sans-serif)',
        }}>
          <div style={{ fontSize: '3em', marginBottom: '16px' }}>⚠</div>
          <h2 style={{ fontSize: '1.4em', marginBottom: '8px', color: 'var(--text-primary, #f0f0f0)' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'var(--text-secondary, #888)', marginBottom: '24px', maxWidth: '400px' }}>
            RipFit ran into an error. This has been automatically reported.
            Try returning to the home screen — your workout data is safe.
          </p>
          <button
            onClick={() => this.handleReset()}
            style={{
              padding: '12px 28px',
              background: 'var(--color-primary, #7c3aed)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '1em',
              fontWeight: '600',
            }}
          >
            Return to RipFit
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '12px',
              padding: '8px 20px',
              background: 'transparent',
              color: 'var(--text-secondary, #888)',
              border: '1px solid var(--border-color, #333)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9em',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
