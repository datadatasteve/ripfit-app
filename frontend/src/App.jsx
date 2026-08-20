import { useState, useEffect } from 'react'
import ProfileMenu from './components/ProfileMenu'
import ActiveWorkout from './components/ActiveWorkout'
import ExerciseBrowser from './components/ExerciseBrowser'
import StatsCenter from './components/StatsCenter'
import UserPreferencesPage from './components/UserPreferencesPage'
import AdminPanel from './components/AdminPanel'
import ErrorBoundary from './components/ErrorBoundary'
import NutritionPage from './components/NutritionPage'
import Login from './components/Login'
import './styles/App.css'

function NavElapsedClock({ workout }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!workout?.start_time) return null;

  const pausedSeconds = workout.total_paused_seconds || 0;
  const currentPauseSeconds = workout.paused_at
    ? Math.floor((Date.now() - new Date(workout.paused_at).getTime()) / 1000)
    : 0;
  const elapsedMs = Date.now() - new Date(workout.start_time).getTime();
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000) - pausedSeconds - currentPauseSeconds);

  const m = Math.floor(elapsedSeconds / 60);
  const s = elapsedSeconds % 60;

  const isPaused = !!workout.paused_at;

  if (isPaused) {
    const pauseSeconds = Math.floor((Date.now() - new Date(workout.paused_at).getTime()) / 1000);
    const pm = Math.floor(pauseSeconds / 60);
    const ps = pauseSeconds % 60;
    return <span className="nav-elapsed-clock paused">{pm}:{String(ps).padStart(2, '0')}</span>;
  }

  return <span className="nav-elapsed-clock">{m}:{String(s).padStart(2, '0')}</span>;
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => !!localStorage.getItem('ripfit_token')
  );
  const [currentView, setCurrentView] = useState('workout');
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [workoutSummary, setWorkoutSummary] = useState(null);
  const [showNavClock, setShowNavClock] = useState(true);
  const [verifiedToast, setVerifiedToast] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [programStatsId, setProgramStatsId] = useState(null);

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
  };

  const goToWorkouts = () => {
    if (workoutSummary) setWorkoutSummary(null);
    setCurrentView('workout');
  };

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <nav className="nav">
            <div className="nav-brand">
              {/* RipFit click → home (no-op until home page is built) */}
              <h1 style={{ cursor: 'pointer' }} onClick={() => setCurrentView('home')}>RipFit</h1>
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

      <main className="main">
        <ErrorBoundary>
        {!isLoggedIn ? (
          <Login onLogin={handleLogin} />
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
              />
            ) : currentView === 'exercises' ? (
              <ExerciseBrowser activeWorkout={activeWorkout} setActiveWorkout={setActiveWorkout} />
            ) : currentView === 'stats' ? (
              <StatsCenter />
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
