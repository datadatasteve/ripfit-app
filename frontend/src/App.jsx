import { useState } from 'react'
import ThemeToggle from './components/ThemeToggle'
import ActiveWorkout from './components/ActiveWorkout'
import './styles/App.css'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentView, setCurrentView] = useState('home'); // 'home' or 'workout'

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <nav className="nav">
            <div className="nav-brand">
              <h1>RipFit</h1>
            </div>
            
            <ul className="nav-menu">
              <li><a href="#" onClick={() => setCurrentView('workout')}>Workouts</a></li>
              <li><a href="#routines">Routines</a></li>
              <li><a href="#progress">Progress</a></li>
            </ul>
            
            <div className="nav-actions">
              <ThemeToggle />
            </div>
          </nav>
        </div>
      </header>

      <main className="main">
        {currentView === 'workout' ? (
          <ActiveWorkout />
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
      </main>

      <footer className="footer">
        <div className="container">
          <p>© 2026 RipFit</p>
        </div>
      </footer>
    </div>
  )
}

export default App