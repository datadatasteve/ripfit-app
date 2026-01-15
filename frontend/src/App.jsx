import { useState } from 'react'
import ThemeToggle from './components/ThemeToggle'
import './styles/App.css'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="container">
          <nav className="nav">
            <div className="nav-brand">
              <h1>RipFit</h1>
            </div>
            
            <ul className="nav-menu">
              <li><a href="#workouts">Workouts</a></li>
              <li><a href="#routines">Routines</a></li>
              <li><a href="#progress">Progress</a></li>
              <li><a href="#exercises">Exercises</a></li>
            </ul>
            
            <div className="nav-actions">
              <ThemeToggle />
              {!isLoggedIn && (
                <>
                  <button className="btn btn-secondary">Log In</button>
                  <button className="btn btn-primary">Sign Up</button>
                </>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Hero Section */}
        <section className="hero">
          <div className="container">
            <h2 className="hero-title">Track Your Fitness Journey</h2>
            <p className="hero-subtitle">
              Comprehensive workout logging, body composition tracking, and progress analytics - all in one place.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg">Get Started Free</button>
              <button className="btn btn-outline btn-lg">Learn More</button>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="features">
          <div className="container">
            <h3 className="section-title">Everything You Need to Track Progress</h3>
            
            <div className="feature-grid">
              <div className="card feature-card">
                <div className="feature-icon">📊</div>
                <h4>Detailed Workout Logging</h4>
                <p>Track sets, reps, weight, RPE, rest times, and notes for every exercise.</p>
              </div>
              
              <div className="card feature-card">
                <div className="feature-icon">🎯</div>
                <h4>Custom Routines</h4>
                <p>Create reusable workout programs with superset support and exercise alternatives.</p>
              </div>
              
              <div className="card feature-card">
                <div className="feature-icon">📈</div>
                <h4>Body Composition</h4>
                <p>Import scans from InBody, DEXA, and other devices. Track changes over time.</p>
              </div>
              
              <div className="card feature-card">
                <div className="feature-icon">💾</div>
                <h4>Your Data, Your Way</h4>
                <p>Export everything to CSV/JSON. Auto-backup to Google Drive or Dropbox.</p>
              </div>
            </div>
          </div>
        </section>

        {/* App Preview Placeholder */}
        <section className="app-preview">
          <div className="container">
            <h3 className="section-title">Simple, Powerful Interface</h3>
            <div className="preview-placeholder">
              <p className="preview-text">App Interface Coming Soon</p>
              <p className="preview-note">Currently in active development</p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <p>© 2026 RipFit. Built by Rip.</p>
          <p>
            Portfolio project -{' '}
            <a href="https://github.com/yourusername/ripfit-app" target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
