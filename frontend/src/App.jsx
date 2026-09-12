import { useState, useEffect, useRef } from 'react'
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
import './styles/App.css'

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
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
    return <span className="header-workout-pulse" title="Workout in progress" aria-label="Workout in progress" />;
  }

  const isPaused = !!workout.paused_at;
  const seconds = isPaused
    ? Math.floor((Date.now() - new Date(workout.paused_at).getTime()) / 1000)
    : getElapsedSeconds(workout);

  return (
    <button
      type="button"
      className={`header-workout-timer ${isPaused ? 'paused' : ''}`}
      onClick={onReturn}
      aria-label="Return to active workout"
    >
      {formatClock(seconds)}
    </button>
  );
}

/** Slide-in drawer nav for mobile viewports. */
function MobileNavDrawer({ open, onClose, currentView, hasActiveWorkout, onNavigate, onReturnToWorkout }) {
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
          <button type="button" className="mobile-drawer-close" onClick={onClose} aria-label="Close menu">×</button>
        </div>

        <nav className="mobile-drawer-nav">
          {hasActiveWorkout && (
            <button
              type="button"
              className="mobile-drawer-link return-to-workout"
              onClick={onReturnToWorkout}
            >
              <span className="mobile-drawer-dot" />
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

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => !!localStorage.getItem('ripfit_token')
  );
  const [hubView, setHubView] = useState('home');
  const [selectedProgramId, setSelectedProgramId] = useState(null);
  const [currentView, setCurrentView] = useState('workout');
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [workoutSummary, setWorkoutSummary] = useState(null);
  const [showNavClock, setShowNavClock] = useState(true);
  const [verifiedToast, setVerifiedToast] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [programStatsId, setProgramStatsId] = useState(null);
  const [viewingWorkout, setViewingWorkout] = useState(null); // { id, type }
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      .then(d => { if (d.is_admin) setIsAdmin(true); })
      .catch(() => {});
  }, [isLoggedIn]);

  const handleLogin = (user) => {
    setIsLoggedIn(true);
    setCurrentView('workout');
  };

  const handleLogout = () => {
    localStorage.removeItem('ripfit_token');
    setIsLoggedIn(false);
    setIsAdmin(false);
    setActiveWorkout(null);
    setWorkoutSummary(null);
    setDrawerOpen(false);
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

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <nav className="nav">
            {isLoggedIn && (
              <button
                type="button"
                className="nav-hamburger"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
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
              <AdminPanel onBack={() => setCurrentView('workout')} />
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
  )
}

export default App
