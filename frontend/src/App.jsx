import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ProfileMenu from './components/ProfileMenu'
import ActiveWorkout from './components/ActiveWorkout'
import ExerciseBrowser from './components/ExerciseBrowser'
import StatsCenter from './components/StatsCenter'
import WorkoutDetailPage from './components/WorkoutDetailPage'
import UserPreferencesPage from './components/UserPreferencesPage'
import AdminPanel from './components/AdminPanel'
import ErrorBoundary from './components/ErrorBoundary'
import NutritionPage from './components/NutritionPage'
import Login from './components/Login'
import { useMeditationEngine, segmentRemaining } from './components/MeditationTimer'
import { UserPrefsContext, DEFAULT_USER_PREFS, prefsFromProfile } from './contexts/UserPrefsContext'
import { ActiveWorkoutContext, mergeServerWorkout, WORKOUT_CLOSED_ELSEWHERE } from './contexts/ActiveWorkoutContext'
import { usePersistentState, clearViewState } from './hooks/usePersistentState'
import TooltipLayer from './components/TooltipLayer'
import './styles/App.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

/**
 * Shown on app load when the user has an unfinished workout (Phase 0A-2).
 * Nothing restores the workout without the user choosing Resume.
 */
function ResumeWorkoutPrompt({ data, busy, error, onResume, onCancel }) {
  const w = data.workout;
  const setCount = (data.exercises || []).reduce((n, ex) => n + (ex.logged_sets?.length || 0), 0);
  const segCount = (data.exercises || []).reduce((n, ex) => n + (ex.cardio_segments?.length || 0), 0);
  const started = w.start_time
    ? new Date(w.start_time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : null;
  return (
    <div className="resume-prompt-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-prompt-title">
      <div className="resume-prompt">
        <h3 id="resume-prompt-title">Unfinished workout</h3>
        <p className="resume-prompt-name">{data.routine_name || w.workout_title || 'Workout'}</p>
        <p className="resume-prompt-meta">
          {started && <>Started {started}</>}
          {` · ${setCount} ${setCount === 1 ? 'set' : 'sets'} logged`}
          {segCount > 0 && ` · ${segCount} ${segCount === 1 ? 'segment' : 'segments'}`}
          {w.paused_at && ' · Paused'}
        </p>
        {error && <p className="resume-prompt-error">{error}</p>}
        <div className="resume-prompt-actions">
          <button type="button" className="resume-prompt-resume" onClick={onResume} disabled={busy}>Resume</button>
          <button type="button" className="resume-prompt-cancel" onClick={onCancel} disabled={busy}>Cancel workout</button>
        </div>
      </div>
    </div>
  );
}

// Shared elapsed-seconds math for the active workout (excludes paused time).
function getElapsedSeconds(workout) {
  if (!workout?.start_time) return 0;
  const pausedSeconds = workout.total_paused_seconds || 0;
  const currentPauseSeconds = workout.paused_at
    ? Math.floor((Date.now() - new Date(workout.paused_at).getTime()) / 1000)
    : 0;
  const elapsedMs = Date.now() - new Date(workout.start_time).getTime();
  return Math.max(0, Math.floor(elapsedMs / 1000) - pausedSeconds - currentPauseSeconds);
}

function formatClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function NavElapsedClock({ workout }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!workout?.start_time) return null;

  const isPaused = !!workout.paused_at;

  if (isPaused) {
    const pauseSeconds = Math.floor((Date.now() - new Date(workout.paused_at).getTime()) / 1000);
    return <span className="nav-elapsed-clock paused">{formatClock(pauseSeconds)}</span>;
  }

  return <span className="nav-elapsed-clock">{formatClock(getElapsedSeconds(workout))}</span>;
}

/**
 * Mobile header indicator for an in-progress workout.
 * On the workout view: a green pulse dot. Anywhere else: a live elapsed timer
 * (amber while paused) that taps back into the workout.
 */
function HeaderWorkoutIndicator({ workout, isOnWorkoutView, onReturn }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isOnWorkoutView) return undefined;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isOnWorkoutView]);

  if (!workout?.start_time) return null;

  if (isOnWorkoutView) {
    const paused = !!workout.paused_at;
    return (
      <span
        className={`header-workout-pulse ${paused ? 'paused' : ''}`}
        title={paused ? 'Workout paused' : 'Workout in progress'}
        aria-label={paused ? 'Workout paused' : 'Workout in progress'}
      />
    );
  }

  // Workout elapsed time (pauses excluded), so while paused it simply holds
  // still — shown in amber — rather than counting the pause itself.
  const isPaused = !!workout.paused_at;
  const seconds = getElapsedSeconds(workout);

  return (
    <button
      type="button"
      className={`header-workout-timer ${isPaused ? 'paused' : ''}`}
      onClick={onReturn}
      aria-label={isPaused ? `Workout paused at ${formatClock(seconds)}. Return to workout` : 'Return to active workout'}
    >
      {formatClock(seconds)}
    </button>
  );
}

/**
 * Mobile header chip for a meditation session running off-screen. Shows the
 * time left in the current segment (amber when paused) and taps back to it.
 */
function HeaderMeditationIndicator({ session, onReturn }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (session?.status !== 'running') return undefined;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [session?.status]);

  if (!session) return null;

  const label = session.status === 'done' ? 'Done' : formatClock(segmentRemaining(session));

  return (
    <button
      type="button"
      className={`header-meditation-timer ${session.status}`}
      onClick={onReturn}
      aria-label="Return to meditation"
      title="Return to meditation"
    >
      🧘 {label}
    </button>
  );
}

/** Slide-in drawer nav for mobile viewports. */
function MobileNavDrawer({ open, onClose, currentView, hasActiveWorkout, workoutPaused, onNavigate, onReturnToWorkout }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const items = [
    { key: 'workout', label: 'Workouts' },
    { key: 'exercises', label: 'Exercises' },
    { key: 'stats', label: 'Stats' },
    { key: 'nutrition', label: 'Nutrition' },
  ];

  return (
    <div className={`mobile-drawer-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="mobile-drawer-overlay" onClick={onClose} />
      <aside className="mobile-drawer-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Navigation">
        <div className="mobile-drawer-header">
          <span className="mobile-drawer-title">RipFit</span>
          <button data-tooltip="Close menu" type="button" className="mobile-drawer-close" onClick={onClose} aria-label="Close menu">×</button>
        </div>

        <nav className="mobile-drawer-nav">
          {hasActiveWorkout && (
            <button
              type="button"
              className="mobile-drawer-link return-to-workout"
              onClick={onReturnToWorkout}
            >
              <span className={`mobile-drawer-dot ${workoutPaused ? 'paused' : ''}`} />
              Return to Active Workout
            </button>
          )}

          {items.map(item => (
            <button
              key={item.key}
              type="button"
              className={`mobile-drawer-link ${currentView === item.key ? 'active' : ''}`}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
    </div>
  );
}

const KNOWN_VIEWS = ['workout', 'exercises', 'stats', 'preferences', 'admin', 'nutrition', 'home'];

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => !!localStorage.getItem('ripfit_token')
  );
  // Kept across a reload (Phase 0B-1); a fresh login starts on Workouts.
  const [hubView, setHubView] = usePersistentState('hub', 'home', v => typeof v === 'string');
  const [selectedProgramId, setSelectedProgramId] = usePersistentState('program', null, v => v === null || Number.isInteger(v));
  const [currentView, setCurrentView] = usePersistentState('view', 'workout', v => KNOWN_VIEWS.includes(v));
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [workoutSummary, setWorkoutSummary] = useState(null);
  const [showNavClock, setShowNavClock] = useState(true);
  const [verifiedToast, setVerifiedToast] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [programStatsId, setProgramStatsId] = useState(null);
  const [viewingWorkout, setViewingWorkout] = useState(null); // { id, type }
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Lifted like activeWorkout so a session survives switching tabs.
  const [activeMeditation, setActiveMeditation] = useState(null);
  const [userPrefs, setUserPrefs] = useState(DEFAULT_USER_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // Unfinished workout found on load, waiting for Resume / Cancel.
  const [resumePrompt, setResumePrompt] = useState(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState('');
  // Shown when the open workout was cancelled or finished on another device.
  const [closedNotice, setClosedNotice] = useState('');

  // Advances segments, rings bowls and holds the wake lock whichever view is up.
  useMeditationEngine(activeMeditation, setActiveMeditation);

  // Handle ?verified=true redirect from email verification link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === 'true') {
      setVerifiedToast(true);
      setTimeout(() => setVerifiedToast(false), 6000);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Fetch profile on load to get admin status
  useEffect(() => {
    if (!isLoggedIn) return;
    const tok = localStorage.getItem('ripfit_token');
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/users/me`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.is_admin) setIsAdmin(true);
        // A stored Admin view only stands for an admin.
        else setCurrentView(v => (v === 'admin' ? 'workout' : v));
        setUserPrefs(prefsFromProfile(d));
        setPrefsLoaded(true);
        // Stats bucket by local hour/day in the user's zone: store the
        // browser's zone when it's unset or has changed.
        let zone = null;
        try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* very old browser */ }
        if (zone && d.id && d.timezone !== zone) {
          fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/users/me/preferences`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ timezone: zone }),
          }).catch(() => {});
        }
      })
      .catch(() => setCurrentView(v => (v === 'admin' ? 'workout' : v)));
  }, [isLoggedIn]);

  // On load (after login): is there an unfinished workout? If the call fails,
  // show nothing and leave the app as it is.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const controller = new AbortController();
    fetch(`${API_BASE}/workouts/active`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}` },
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.workout) setResumePrompt(d); })
      .catch(() => {});
    return () => controller.abort();
  }, [isLoggedIn]);

  // Open an active-workout payload (resume prompt, or reopening a cancelled
  // workout from its detail page).
  const openWorkout = useCallback((payload) => {
    if (!payload?.workout) return;
    setWorkoutSummary(null);
    setActiveWorkout({ ...payload, synced_at: Date.now() });
    setViewingWorkout(null);
    setDrawerOpen(false);
    setCurrentView('workout');
  }, []);

  // Everything logged is already on the server; only the local view closes.
  const workoutClosedElsewhere = useCallback(() => {
    setActiveWorkout(null);
    setWorkoutSummary(null);
    setClosedNotice(WORKOUT_CLOSED_ELSEWHERE);
  }, []);

  const resumeFromPrompt = () => {
    openWorkout(resumePrompt);
    setResumePrompt(null);
  };

  // Same call as the in-workout Cancel. Data is kept; the workout stays
  // resumable from its detail page.
  const cancelFromPrompt = async () => {
    setResumeBusy(true);
    setResumeError('');
    try {
      const res = await fetch(`${API_BASE}/workouts/${resumePrompt.workout.id}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ripfit_token')}` },
      });
      if (!res.ok) throw new Error();
      setResumePrompt(null);
    } catch {
      setResumeError('Could not cancel the workout. Check your connection and try again.');
    } finally {
      setResumeBusy(false);
    }
  };

  // Two devices: when the page becomes visible again with a workout open,
  // take the server's logged sets, segments and pause state. Notes typed
  // here and not yet sent stay local (ActiveWorkout flushes them).
  const activeWorkoutRef = useRef(activeWorkout);
  activeWorkoutRef.current = activeWorkout;
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    let lastFetch = 0;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const current = activeWorkoutRef.current;
      if (!current?.workout?.id) return;
      if (Date.now() - lastFetch < 5000) return; // one refetch per refocus burst
      lastFetch = Date.now();
      fetch(`${API_BASE}/workouts/active`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}` },
      })
        .then(r => (r.ok ? r.json() : null))
        .then(async d => {
          if (!d) return;
          if (d.workout?.id === current.workout.id) {
            setActiveWorkout(prev => (prev?.workout?.id === d.workout.id ? mergeServerWorkout(prev, d) : prev));
            return;
          }
          // The open workout isn't the one in progress: ask for its status,
          // and close it here only if it really was cancelled or finished.
          const r = await fetch(`${API_BASE}/workouts/history/${current.workout.id}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}` },
          });
          if (!r.ok) return;
          const detail = await r.json();
          if (detail?.status && detail.status !== 'in_progress'
              && activeWorkoutRef.current?.workout?.id === current.workout.id) {
            workoutClosedElsewhere();
          }
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isLoggedIn, workoutClosedElsewhere]);

  const activeWorkoutValue = useMemo(
    () => ({ activeWorkoutId: activeWorkout?.workout?.id ?? null, openWorkout, workoutClosedElsewhere }),
    [activeWorkout?.workout?.id, openWorkout, workoutClosedElsewhere]
  );

  // Optimistic: the UI switches immediately; a failed save rolls back and
  // rethrows so the caller can show an error.
  const prefsRef = useRef(userPrefs);
  prefsRef.current = userPrefs;
  const updatePrefs = useCallback(async (patch) => {
    const previous = prefsRef.current;
    setUserPrefs(p => ({ ...p, ...patch }));
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/users/me/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ripfit_token')}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      const saved = await res.json();
      setUserPrefs(p => ({ ...p, ...prefsFromProfile({ ...p, ...saved }) }));
    } catch (err) {
      setUserPrefs(previous);
      throw err;
    }
  }, []);

  const prefsValue = useMemo(
    () => ({ prefs: userPrefs, prefsLoaded, updatePrefs }),
    [userPrefs, prefsLoaded, updatePrefs]
  );

  const handleLogin = (user) => {
    clearViewState();
    setHubView('home');
    setSelectedProgramId(null);
    setIsLoggedIn(true);
    setCurrentView('workout');
  };

  const handleLogout = () => {
    localStorage.removeItem('ripfit_token');
    setIsLoggedIn(false);
    setIsAdmin(false);
    setActiveWorkout(null);
    setWorkoutSummary(null);
    setActiveMeditation(null);
    setUserPrefs(DEFAULT_USER_PREFS);
    setPrefsLoaded(false);
    setDrawerOpen(false);
    setResumePrompt(null);
    clearViewState();
  };

  const goToWorkouts = () => {
    if (workoutSummary) setWorkoutSummary(null);
    setHubView('home');
    setSelectedProgramId(null);
    setCurrentView('workout');
  };

  // Jump straight back into the in-progress workout. ActiveWorkout short-circuits
  // to WorkoutInProgress whenever activeWorkout is set, so hubView is left alone.
  const returnToActiveWorkout = () => {
    setViewingWorkout(null);
    setCurrentView('workout');
    setDrawerOpen(false);
  };

  const handleDrawerNavigate = (view) => {
    if (view === 'workout') {
      goToWorkouts();
    } else {
      setCurrentView(view);
    }
    setViewingWorkout(null);
    setDrawerOpen(false);
  };

  const onWorkoutView = currentView === 'workout' && !viewingWorkout;
  // ActiveWorkout shows the meditation screen whenever a session exists and no
  // workout is in progress (see its render order).
  const onMeditationView = onWorkoutView && !activeWorkout && !workoutSummary;

  return (
    <UserPrefsContext.Provider value={prefsValue}>
    <ActiveWorkoutContext.Provider value={activeWorkoutValue}>
    <div className="app">
      <TooltipLayer />
      {closedNotice && (
        <div className="workout-closed-notice" role="alert">
          <span>{closedNotice}</span>
          <button type="button" className="btn btn-primary" onClick={() => setClosedNotice('')}>OK</button>
        </div>
      )}
      {isLoggedIn && resumePrompt && !activeWorkout && (
        <ResumeWorkoutPrompt
          data={resumePrompt}
          busy={resumeBusy}
          error={resumeError}
          onResume={resumeFromPrompt}
          onCancel={cancelFromPrompt}
        />
      )}
      <header className="header">
        <div className="container">
          <nav className="nav">
            {isLoggedIn && (
              <button
                type="button"
                className="nav-hamburger"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                data-tooltip="Open menu"
                aria-expanded={drawerOpen}
              >
                <span className="nav-hamburger-bars" />
              </button>
            )}

            <div className="nav-brand">
              {/* RipFit click → home (no-op until home page is built) */}
              <h1 style={{ cursor: 'pointer' }} onClick={() => setCurrentView('home')}>RipFit</h1>
              {isLoggedIn && activeWorkout && (
                <HeaderWorkoutIndicator
                  workout={activeWorkout.workout}
                  isOnWorkoutView={onWorkoutView}
                  onReturn={returnToActiveWorkout}
                />
              )}
              {isLoggedIn && activeMeditation && !onMeditationView && (
                <HeaderMeditationIndicator
                  session={activeMeditation}
                  onReturn={returnToActiveWorkout}
                />
              )}
            </div>

            <ul className="nav-menu">
              <li>
                <a href="#" onClick={goToWorkouts}>
                  Workouts {activeWorkout && (
                    <span className="active-workout-dot" title="Workout in progress">
                      ● {showNavClock && <NavElapsedClock workout={activeWorkout.workout} />}
                    </span>
                  )}
                </a>
              </li>
              <li><a href="#" onClick={() => setCurrentView('exercises')}>Exercises</a></li>
              <li><a href="#" onClick={() => setCurrentView('stats')}>Stats</a></li>
              <li><a href="#" onClick={() => setCurrentView('nutrition')}>Nutrition</a></li>
            </ul>

            <div className="nav-actions">
              {isLoggedIn && (
                <ProfileMenu
                  onLogout={handleLogout}
                  onOpenPrefs={() => setCurrentView('preferences')}
                  onOpenAdmin={isAdmin ? () => setCurrentView('admin') : null}
                />
              )}
            </div>
          </nav>
        </div>
      </header>

      {isLoggedIn && (
        <MobileNavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          currentView={currentView}
          hasActiveWorkout={!!activeWorkout}
          workoutPaused={!!activeWorkout?.workout?.paused_at}
          onNavigate={handleDrawerNavigate}
          onReturnToWorkout={returnToActiveWorkout}
        />
      )}

      <main className="main">
        <ErrorBoundary>
        {!isLoggedIn ? (
          <Login onLogin={handleLogin} />
        ) : viewingWorkout ? (
          <WorkoutDetailPage
            workoutId={viewingWorkout.id}
            workoutType={viewingWorkout.type}
            onBack={() => {
              setViewingWorkout(null);
              if (selectedProgramId) setHubView('programs');
            }}
          />
        ) : (
          <>
            {currentView === 'workout' ? (
              <ActiveWorkout
                activeWorkout={activeWorkout}
                setActiveWorkout={setActiveWorkout}
                workoutSummary={workoutSummary}
                setWorkoutSummary={setWorkoutSummary}
                showNavClock={showNavClock}
                setShowNavClock={setShowNavClock}
                hubView={hubView}
                setHubView={setHubView}
                selectedProgramId={selectedProgramId}
                setSelectedProgramId={setSelectedProgramId}
                onViewWorkout={(id, type) => setViewingWorkout({ id, type: type || 'strength' })}
                onViewProgramStats={(pid) => { setProgramStatsId(pid); setCurrentView('stats'); }}
                activeMeditation={activeMeditation}
                setActiveMeditation={setActiveMeditation}
              />
            ) : currentView === 'exercises' ? (
              <ExerciseBrowser activeWorkout={activeWorkout} setActiveWorkout={setActiveWorkout} />
            ) : currentView === 'stats' ? (
              <StatsCenter
                initialProgramId={programStatsId}
                onProgramStatsConsumed={() => setProgramStatsId(null)}
              />
            ) : currentView === 'preferences' ? (
              <UserPreferencesPage onBack={() => setCurrentView('workout')} />
            ) : currentView === 'admin' ? (
              isAdmin
                ? <AdminPanel onBack={() => setCurrentView('workout')} />
                : <p className="view-loading">Loading…</p>
            ) : currentView === 'nutrition' ? (
              <NutritionPage />
            ) : (
              <section className="hero">
                <div className="container">
                  <h2 className="hero-title">Track Your Fitness Journey</h2>
                  <button className="btn btn-primary btn-lg" onClick={() => setCurrentView('workout')}>
                    Start Workout
                  </button>
                </div>
              </section>
            )}
          </>
        )}
        </ErrorBoundary>
      </main>

      {verifiedToast && (
        <div className="verified-toast">
          Email verified — you can now log in.
        </div>
      )}

      <footer className="footer">
        <div className="container">
          <p>© 2026 RipFit</p>
        </div>
      </footer>
    </div>
    </ActiveWorkoutContext.Provider>
    </UserPrefsContext.Provider>
  )
}

export default App
