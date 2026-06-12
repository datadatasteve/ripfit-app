# RipFit Handoff - Chat 7 → Chat 8
*June 2026*

## Project Overview
Full-stack fitness tracking app (web, eventually mobile).
**Goal:** Testable fitness + nutrition product by end of month.

## Tech Stack
- **Backend:** Node.js/Express, PostgreSQL (Docker `ripfit-db`)
- **Frontend:** React (Vite), port 8080
- **Auth:** JWT (test: test1@example.com / test123)
- **API Base:** `http://localhost:3000/api/v1`

## File Structure
```
~/Desktop/dev_proj/ripfit-app/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── workoutController.js
│   │   │   ├── routineController.js
│   │   │   ├── nutritionController.js
│   │   │   └── authController.js
│   │   ├── routes/
│   │   │   ├── workoutRoutes.js
│   │   │   ├── nutritionRoutes.js
│   │   │   ├── authRoutes.js
│   │   │   └── routineRoutes.js
│   │   ├── middleware/auth.js
│   │   └── app.js
│   └── database/migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_nutrition_tables.sql
│       ├── 003_add_barcode_support.sql
│       └── 004_user_food_overrides.sql
└── frontend/
    └── src/
        └── components/
            ├── ActiveWorkout.jsx (~1358 lines)
            ├── ActiveWorkout.css
            └── ThemeToggle.jsx
```

## Running the App
```bash
docker start ripfit-db
cd ~/Desktop/dev_proj/ripfit-app/backend && npm start   # port 3000
cd ~/Desktop/dev_proj/ripfit-app/frontend && npm run dev # port 8080
```

## Database
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev
```
- Test routine ID: 1, User ID: 2 — "Push Day Test1" (10 exercises)
- RPE constraint: 1–11

## Current Working Features

### Workout Tracking
- Start workout from routine with last performance data side-by-side
- Log sets: reps, weight, RPE (1–11, Spinal Tap ref), bodyweight support
- Rest timer (60s countdown, skippable)
- Auto-progression to next exercise when target sets reached
- Add/change/skip exercises mid-workout
- Exercise reorder (up/down arrows in View All)
- View All rows fully clickable

### Notes System
- Per-exercise notes auto-tagged with set number: `Set 1: note text`
- General notes per exercise (not set-specific): `General: note text`
- Notes accumulate as log; editable with set tags preserved in backend
- Previous workout exercise notes visible during active workout
- Workout-level notes modal (accessible during workout + at finish)
- Substitution history shown in "Last time" (↔️ icon)
- Unsaved note warning before navigation

### Performance Indicators
- ⚠️ + red text on RPE 10 or 11 (logged sets)
- Orange text when reps or weight below target (logged sets)
- Caution symbols carry to next workout's "Last time" section
- Incomplete sets flagged red in workout summary

### Exercise Search
- Abbreviations: bb, db, kb, tri, bi, oh, shldr
- Synonym matching: bench↔press, fly↔butterfly, mason↔russian
- AND-first ranking; muscle group filter in both Add and Change modals
- Auto-focus cursor in search modal

### Change Exercise
- Shows original targets (sets/reps displayed, weight blank)
- Pre-fills new targets with original sets/reps only
- Substitution note auto-saved with old exercise notes preserved
- Asks for reason (optional)

### Workout Summary (post-workout)
- HH:MM:SS duration
- Exercise count, total sets, total reps
- Per-exercise breakdown with set details and notes
- Incomplete exercises flagged red
- Current + previous workout-level notes

### Routines
- CRUD operations
- Start from routine with last performance side-by-side
- Previous overall workout notes shown on second run

## API Endpoints (Current)

### Auth
- POST `/auth/register` — {email, username, password}
- POST `/auth/login` — {email, password} → JWT

### Workouts
- GET `/workouts/exercises/search?q=term`
- GET `/workouts/exercises/:id`
- POST `/workouts` — log workout
- GET `/workouts` — get user workouts
- POST `/workouts/:workoutId/sets` — log set
- POST `/workouts/:workoutId/exercises` — add exercise mid-workout
- DELETE `/workouts/:workoutId/exercises/:exerciseId`
- PUT `/workouts/:workoutId/exercises/:exerciseId/notes`
- PUT `/workouts/:workoutId/notes` — workout-level notes
- PUT `/workouts/:workoutId/finish`

### Routines
- POST `/routines`, GET `/routines`, GET `/routines/:id`
- PUT `/routines/:id`, DELETE `/routines/:id`
- POST `/routines/:id/start-workout`

### Nutrition
- GET `/nutrition/foods/search?q=term`
- POST `/nutrition/foods/barcode/:code`
- POST `/nutrition/meals`

## Known Bugs / Issues
- Search relevance imperfect (equipment type, context-aware results)
- Fuzzy search doesn't handle typos well (e.g. "cable crossoveer")
- "Arms" category not split — Biceps/Triceps mixed together

## What Was Being Built Next (PRIORITY ORDER)

### 1. Exercise Database Cleanup (START HERE)
**Decision made:** Option B — add `subcategory` column to exercises table.
- `category` = "Arms" (parent, still searchable)
- `subcategory` = "Biceps" or "Triceps" (child)
- Extends to: Legs → Quads/Hamstrings/Glutes/Calves, Shoulders → Front/Lateral/Rear
- Auto-categorize Arms exercises by name keywords:
  - curl → Biceps
  - pushdown/extension/dip/tricep → Triceps
  - ambiguous → stays "Arms" with null subcategory
- Search: "bi/bis/bicep/biceps" → Biceps only; "tri/tris/tricep/triceps" → Triceps only; "arms" → both
- Muscle filter dropdowns update: Arms with Biceps/Triceps sub-options
- Files to update: new migration SQL, workoutController.js (search), ActiveWorkout.jsx (filters)

### 2. Workout History View
- Browse/review past workouts
- Show exercises, sets, notes per workout
- Needed for proper testing of notes/data accuracy

### 3. User Preferences Screen
- Set tag display toggle (show/hide [Set X] in notes)
- Units preference
- localStorage first, then sync to database on session end

## User Preferences (Context)
- Limited programming experience — needs explicit file locations and line numbers
- Prefers functionality over aesthetics during dev
- Dark mode preference
- Wants detailed explanations when debugging
- Appreciates being told when uncertain

## CSS Files Note
All CSS additions have been appended to ActiveWorkout.css. Key classes added:
- `.previous-notes` — green left border, previous workout notes
- `.current-notes-log` — today's notes display
- `.save-note-btn` — green save button
- `.general-note-btn` — blue general note button
- `.workout-notes-btn` — orange workout notes header button
- `.set-pill.caution` — orange background for caution sets
- `.sets-caution` — orange caution text
- `.set-entry.rpe-warning` — red text for high RPE
- `.set-entry.under-target` — orange text for under-target
- `.incomplete-warning` — orange border warning box
- `.summary-stats`, `.stat-box` — workout summary layout
- `.summary-exercise-item`, `.summary-sets` — exercise breakdown

## Git Status
Last commit included: notes system, search improvements, auto-progression fixes,
workout summary, performance warnings, change exercise improvements.
All files committed and pushed to main.

## Token / Auth Note
JWT tokens expire every 7 days. When app shows "no routines" unexpectedly:
1. Open browser console (F12)
2. Run: `fetch('http://localhost:3000/api/v1/routines', {headers: {'Authorization': 'Bearer ' + localStorage.getItem('ripfit_token')}}).then(r => r.json()).then(d => console.log(d))`
3. If `{error: 'Invalid token'}`, get fresh token:
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test1@example.com","password":"test123"}'
```
4. `localStorage.setItem('ripfit_token', 'NEW_TOKEN_HERE')` in browser console
