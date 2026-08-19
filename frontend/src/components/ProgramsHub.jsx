// frontend/src/components/ProgramsHub.jsx
import { useState, useEffect } from 'react';
import ProgramBuilder from './ProgramBuilder';
import ProgramDetail from './ProgramDetail';
import './ProgramsHub.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('ripfit_token')}` };
}

function ProgressBar({ pct }) {
  return (
    <div className="ph-progress-track">
      <div className="ph-progress-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function ProgramCard({ program, onClick }) {
  const total = parseInt(program.total_workout_days) || 0;
  const done = parseInt(program.completed_workouts) || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="ph-program-card" onClick={onClick}>
      <div className="ph-card-header">
        <span className="ph-card-name">{program.name}</span>
        {program.status === 'active' && <span className="ph-badge-active">Active</span>}
        {program.status === 'completed' && <span className="ph-badge-done">Complete</span>}
        {program.status === 'draft' && <span className="ph-badge-draft">Draft</span>}
      </div>
      {program.description && <p className="ph-card-desc">{program.description}</p>}
      <div className="ph-card-meta">
        {program.duration_weeks && <span>{program.duration_weeks}w program</span>}
        <span>{total} workouts</span>
        {done > 0 && <span>{done} done</span>}
      </div>
      {total > 0 && (
        <div className="ph-card-progress">
          <ProgressBar pct={pct} />
          <span className="ph-progress-label">{pct}%</span>
        </div>
      )}
    </div>
  );
}

export default function ProgramsHub({ onStartProgramWorkout, onViewProgramStats }) {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // list | detail | builder
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [editingProgram, setEditingProgram] = useState(null);

  useEffect(() => { fetchPrograms(); }, []);

  const fetchPrograms = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/programs`, { headers: authHeaders() });
      const data = await res.json();
      setPrograms(data.programs || []);
    } catch (err) {
      console.error('Failed to fetch programs:', err);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = (program) => {
    setSelectedProgram(program);
    setView('detail');
  };

  const openBuilder = (program = null) => {
    setEditingProgram(program);
    setView('builder');
  };

  const handleSaved = (program) => {
    fetchPrograms();
    setView('detail');
    setSelectedProgram(program);
    setEditingProgram(null);
  };

  const handleDeleted = () => {
    fetchPrograms();
    setView('list');
    setSelectedProgram(null);
  };

  if (view === 'builder') {
    return (
      <ProgramBuilder
        existingProgram={editingProgram}
        onSaved={handleSaved}
        onClose={() => setView(selectedProgram ? 'detail' : 'list')}
      />
    );
  }

  if (view === 'detail' && selectedProgram) {
    return (
      <ProgramDetail
        programId={selectedProgram.id}
        onBack={() => setView('list')}
        onEdit={() => openBuilder(selectedProgram)}
        onDeleted={handleDeleted}
        onStartWorkout={onStartProgramWorkout}
        onViewStats={onViewProgramStats}
      />
    );
  }

  const active = programs.filter(p => p.status === 'active');
  const saved = programs.filter(p => p.status !== 'active');

  return (
    <div className="ph-container">
      <div className="ph-header">
        <h2 className="ph-title">Programs</h2>
        <button className="ph-new-btn" onClick={() => openBuilder(null)}>+ New Program</button>
      </div>

      {loading && <p className="ph-loading">Loading…</p>}

      {!loading && programs.length === 0 && (
        <div className="ph-empty">
          <p>No programs yet.</p>
          <button className="ph-new-btn" onClick={() => openBuilder(null)}>Create your first program</button>
        </div>
      )}

      {active.length > 0 && (
        <section className="ph-section">
          <h3 className="ph-section-title">Active</h3>
          <div className="ph-card-grid">
            {active.map(p => (
              <ProgramCard key={p.id} program={p} onClick={() => openDetail(p)} />
            ))}
          </div>
        </section>
      )}

      {saved.length > 0 && (
        <section className="ph-section">
          <h3 className="ph-section-title">Your Programs</h3>
          <div className="ph-card-grid">
            {saved.map(p => (
              <ProgramCard key={p.id} program={p} onClick={() => openDetail(p)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
