# RipFit Project Status

## Stack
- **Backend:** Node.js/Express, PostgreSQL (Docker `ripfit-db`)
- **Frontend:** React (Vite), port 8080
- **Auth:** JWT (test user: test1@example.com / test123)

## Working Features

### Authentication
- JWT login/register, manual token refresh via console

### Workout Tracking
- Start workout from routine template
- Log sets with reps, weight, RPE (1-11, Spinal Tap reference)
- Bodyweight exercise support (BW/0/-)
- Rest timer (60s countdown, skippable)
- Auto-progression to next exercise when target sets reached
- Add exercises mid-workout with target sets/reps
- Change exercises mid-workout (shows original targets, pre-fills sets/reps)
- Skip exercise with confirmation
- Reorder exercises (up/down arrows in View All)
- View All exercises - full rows clickable

### Notes System
- Per-exercise notes auto-tagged with set number (Set 1: note text)
- General notes per exercise (not set-specific)
- Notes accumulate as log, editable with set tags preserved
- Previous workout notes visible during active workout
- Workout-level notes accessible during workout and at finish
- Substitution history shown in "Last time" section (↔️)
- Unsaved note warning before navigating away

### Performance Indicators
- ⚠️ on sets where weight or reps below target (orange text)
- ⚠️ on RPE 10 or 11 (red text)
- Caution symbols carry to next workout's "Last time" section
- Incomplete sets flagged in workout summary

### Exercise Search
- Fuzzy search with abbreviation support (bb, db, kb, tri, bi, oh, shldr)
- Synonym matching (bench↔press, fly↔butterfly, mason↔russian)
- AND-first ranking (all words match before partial matches)
- Muscle group filter in both Add and Change modals
- Auto-focus cursor in search modal

### Workout Summary (post-workout)
- Duration (HH:MM:SS)
- Exercise count, total sets, total reps
- Per-exercise set breakdown with notes
- Incomplete exercises flagged in red
- Current and previous workout-level notes displayed
- Total lbs moved calculated silently (for future data use)

### Routines
- Create/read/update/delete
- Start workout from routine with last performance data side-by-side
- Template targets + last performance shown simultaneously
- Previous workout notes displayed on second run

## Known Issues / Backlog

### Near-term
- Search relevance still imperfect (equipment type, context-aware results)
- Drag-and-drop exercise reordering (arrows are functional but tedious)
- Color-coded performance across workouts (stagnation/regression tracking)
- Workout comparison across sessions in summary
- End-of-workout "reason for ending early" field

### Medium-term
- Workout history view (browse past workouts)
- Exercise database: split Arms → Biceps/Triceps
- Exercise descriptions (global, trainer-editable)
- User/trainer notes per exercise (account-level)
- Progressive overload automation
- Body measurements tracking
- Interval timer for calisthenics/non-traditional workouts

### Long-term
- Data visualizations (reps, weight, RPE over time)
- Trainer portal with client connections
- User preferences screen (set tag display toggle, metric display options)
- Settings sync: localStorage → database on session end
- Workout calendar view
- Data export

## File Locations
```
~/Desktop/dev_proj/ripfit-app/
├── backend/src/controllers/
│   ├── workoutController.js
│   ├── routineController.js
│   └── authController.js
├── backend/src/routes/
│   └── workoutRoutes.js (includes PUT /:workoutId/notes)
└── frontend/src/components/
    ├── ActiveWorkout.jsx
    └── ActiveWorkout.css
```

## Database
```bash
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev
```
- Test routine ID: 1, User ID: 2, 10 exercises (Push Day)
- RPE constraint: 1-11
