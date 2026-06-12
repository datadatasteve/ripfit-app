import { useState, useEffect, useCallback } from 'react';
import './ExerciseBrowser.css';

const API_BASE = 'http://localhost:3000/api/v1';
const LIMIT = 50;
const CATEGORIES = ['All', 'Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Abs', 'Cardio', 'General'];

export default function ExerciseBrowser() {
  const [exercises, setExercises] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const [selectedExercise, setSelectedExercise] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [armsExpanded, setArmsExpanded] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState(''); // committed search term

  const token = localStorage.getItem('ripfit_token');
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const getHeaders = () => {
    const t = localStorage.getItem('ripfit_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  // ----------------------------------------------------------------
  // Core fetch — takes explicit args so no stale closure issues
  // ----------------------------------------------------------------
  const fetchBrowse = useCallback(async (cat, subcat, newOffset, append) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: newOffset });
      if (cat) params.set('category', cat);
      if (subcat) params.set('subcategory', subcat);

      const res = await fetch(`${API_BASE}/workouts/exercises/browse?${params}`, { headers: getHeaders() });
      const data = await res.json();
      setTotal(data.total ?? 0);
      setOffset(newOffset);
      setExercises(prev => append ? [...prev, ...(data.exercises || [])] : (data.exercises || []));
    } catch (err) {
      console.error('Browse failed:', err);
    }
    setLoading(false);
  }, []);

  const fetchSearch = useCallback(async (q, newOffset, append) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/workouts/exercises/search?q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${newOffset}`,
        { headers: getHeaders() }
      );
      const data = await res.json();
      const results = data.exercises || [];
      setOffset(newOffset);
      setTotal(newOffset + results.length + (results.length === LIMIT ? LIMIT : 0));
      setExercises(prev => append ? [...prev, ...results] : results);
    } catch (err) {
      console.error('Search failed:', err);
    }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    fetchBrowse('', '', 0, false);
  }, []);

  // ----------------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------------
  const handleCategoryClick = (cat) => {
    setSelectedExercise(null);
    setSearchInput('');
    setActiveSearch('');

    if (cat === '' || cat === 'All') {
      setCategoryFilter('');
      setSubcategoryFilter('');
      setArmsExpanded(false);
      fetchBrowse('', '', 0, false);
    } else if (cat === 'Arms') {
      const expanding = !armsExpanded;
      setArmsExpanded(expanding);
      setCategoryFilter('Arms');
      setSubcategoryFilter('');
      fetchBrowse('Arms', '', 0, false);
    } else {
      setCategoryFilter(cat);
      setSubcategoryFilter('');
      setArmsExpanded(false);
      fetchBrowse(cat, '', 0, false);
    }
  };

  const handleSubcategoryClick = (sub) => {
    setSubcategoryFilter(sub);
    setCategoryFilter('Arms');
    setSelectedExercise(null);
    fetchBrowse('Arms', sub, 0, false);
  };

  const handleSearch = () => {
    const q = searchInput.trim();
    if (!q) return;
    setActiveSearch(q);
    setSelectedExercise(null);
    setCategoryFilter('');
    setSubcategoryFilter('');
    setArmsExpanded(false);
    fetchSearch(q, 0, false);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setActiveSearch('');
    setSelectedExercise(null);
    fetchBrowse(categoryFilter, subcategoryFilter, 0, false);
  };

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT;
    if (activeSearch) {
      fetchSearch(activeSearch, newOffset, true);
    } else {
      fetchBrowse(categoryFilter, subcategoryFilter, newOffset, true);
    }
  };

  const fetchDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/workouts/exercises/${id}`, { headers: getHeaders() });
      const data = await res.json();
      setSelectedExercise(data);
    } catch (err) {
      console.error('Detail fetch failed:', err);
    }
    setDetailLoading(false);
  };

  const hasMore = exercises.length > 0 && exercises.length < total;

  const activeCatLabel = subcategoryFilter || (categoryFilter || 'All');

  return (
    <div className="browser-layout">

      {/* ---- LEFT SIDEBAR ---- */}
      <div className="browser-sidebar">

        {/* Search bar */}
        <div className="browser-search-bar">
          <input
            type="text"
            placeholder="Search exercises..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button className="search-btn" onClick={handleSearch}>Search</button>
          {activeSearch && (
            <button className="clear-btn" onClick={handleClearSearch}>✕</button>
          )}
        </div>

        {/* Category filter pills — always visible */}
        <div className="browser-category-filters">
          {CATEGORIES.map(cat => (
            <div key={cat} className="cat-pill-wrapper">
              <button
                className={`cat-pill ${
                  cat === 'All'
                    ? (!categoryFilter && !activeSearch) ? 'active' : ''
                    : cat === 'Arms'
                    ? (categoryFilter === 'Arms') ? 'active' : ''
                    : categoryFilter === cat && !subcategoryFilter ? 'active' : ''
                }`}
                onClick={() => handleCategoryClick(cat === 'All' ? '' : cat)}
              >
                {cat === 'Arms' ? `Arms ${armsExpanded ? '▾' : '▸'}` : cat}
              </button>
              {cat === 'Arms' && armsExpanded && (
                <div className="subcategory-pills">
                  <button
                    className={`cat-pill cat-pill-sub ${subcategoryFilter === 'Biceps' ? 'active' : ''}`}
                    onClick={() => handleSubcategoryClick('Biceps')}
                  >↳ Biceps</button>
                  <button
                    className={`cat-pill cat-pill-sub ${subcategoryFilter === 'Triceps' ? 'active' : ''}`}
                    onClick={() => handleSubcategoryClick('Triceps')}
                  >↳ Triceps</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Result count */}
        <div className="browser-list-header">
          {activeSearch
            ? `Results for "${activeSearch}" — ${exercises.length}${hasMore ? '+' : ''}`
            : `${total} exercise${total !== 1 ? 's' : ''}${categoryFilter ? ` · ${activeCatLabel}` : ''}`
          }
        </div>

        {/* Exercise list */}
        <div className="browser-exercise-list">
          {loading && exercises.length === 0 && (
            <p className="browser-status">Loading...</p>
          )}
          {!loading && exercises.length === 0 && (
            <p className="browser-status">No exercises found.</p>
          )}

          {exercises.map(ex => (
            <div
              key={ex.id}
              className={`browser-exercise-row ${selectedExercise?.id === ex.id ? 'selected' : ''}`}
              onClick={() => fetchDetail(ex.id)}
            >
              <div className="browser-exercise-name">
                {ex.name}
                {ex.in_user_routine && <span className="routine-badge" title="In one of your routines">★</span>}
              </div>
              <div className="browser-exercise-meta">
                {ex.category}{ex.subcategory ? ` › ${ex.subcategory}` : ''} · {ex.equipment_type}
              </div>
            </div>
          ))}

          {hasMore && (
            <button className="load-more-btn" onClick={handleLoadMore} disabled={loading}>
              {loading ? 'Loading...' : `Load more (${total - exercises.length} remaining)`}
            </button>
          )}
        </div>
      </div>

      {/* ---- RIGHT DETAIL PANEL ---- */}
      <div className="browser-detail">
        {detailLoading && <p className="browser-status">Loading...</p>}

        {!selectedExercise && !detailLoading && (
          <div className="detail-empty">Select an exercise to view details</div>
        )}

        {selectedExercise && !detailLoading && (
          <div className="detail-card">
            <h2 className="detail-title">{selectedExercise.name}</h2>

            <div className="detail-tags">
              <span className="detail-tag">{selectedExercise.category}</span>
              {selectedExercise.subcategory && (
                <span className="detail-tag detail-tag-sub">{selectedExercise.subcategory}</span>
              )}
              {selectedExercise.equipment_type && (
                <span className="detail-tag">{selectedExercise.equipment_type}</span>
              )}
            </div>

            {parseInt(selectedExercise.routine_count) > 0 && (
              <div className="detail-routine-notice">
                ★ Used in {selectedExercise.routine_count} of your saved routine{selectedExercise.routine_count != 1 ? 's' : ''}
              </div>
            )}

            <div className="detail-section">
              <h4>Description</h4>
              {selectedExercise.description
                ? <p>{selectedExercise.description}</p>
                : <p className="detail-missing">No description available yet.</p>
              }
            </div>

            <div className="detail-section detail-coming-soon">
              <h4>Coming Soon</h4>
              <ul>
                <li>🎥 Video demonstration</li>
                <li>💪 Muscles worked diagram</li>
                <li>📊 Your stats for this exercise (times logged, routines used in)</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}