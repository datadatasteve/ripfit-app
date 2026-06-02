# RipFit - Quick Setup Guide

Welcome to your RipFit project! This guide will help you get started.

## What's Been Created

Your project structure is ready with:

### Backend (Node.js/Express)
- Complete database schema (20 tables)
- Express server with middleware configured
- Database connection setup
- Migration system ready
- Basic testing infrastructure
- Authentication stubs (JWT + OAuth)

### Frontend (React + Vite)
- React 18 application
- Vite build system (fast development)
- Themeable design system (CSS variables)
- Dark/Light/System mode support
- Component structure ready

### Docker
- PostgreSQL database container
- Pre-configured environment

### Documentation
- Complete database schema documentation
- API endpoint specifications
- Import/export guide
- Comprehensive README

---

## Next Steps to Get Running

### 1. Install Docker Desktop

Docker runs PostgreSQL in a container - no need to install PostgreSQL directly!

**Mac:**
1. Download from https://www.docker.com/products/docker-desktop/
2. Open the .dmg file and drag Docker to Applications
3. Open Docker Desktop from Applications
4. Wait for Docker to start (whale icon in menu bar)

**Windows:**
1. Download from https://www.docker.com/products/docker-desktop/
2. Run the installer
3. Restart computer if prompted
4. Open Docker Desktop
5. Accept terms and wait for Docker to start

**Linux (Ubuntu/Debian):**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose

# Add your user to docker group (no sudo needed)
sudo usermod -aG docker $USER
# Log out and back in for this to take effect
```

**Verify Docker is running:**
```bash
docker --version
# Should show: Docker version 24.x.x or higher

docker-compose --version
# Should show: Docker Compose version 2.x.x or higher
```

---

### 2. Download Project

Download the project to: `~/Desktop/dev_proj/ripfit-app`

```bash
# Create directory if it doesn't exist
mkdir -p ~/Desktop/dev_proj

# Navigate there
cd ~/Desktop/dev_proj

# If you have the git repository:
git clone <your-repo-url> ripfit-app

# If you downloaded as zip:
# Unzip to ~/Desktop/dev_proj/ripfit-app
```

---

### 3. Start Database with Docker

```bash
cd ~/Desktop/dev_proj/ripfit-app

# Start PostgreSQL container
docker-compose up -d

# Verify container is running
docker ps
# Should see: ripfit-db container running

# Check database logs (optional)
docker-compose logs postgres
```

**Database is now running at `localhost:5432`**

**Database credentials (from docker-compose.yml):**
- Database: ripfit_dev
- User: ripfit_user  
- Password: ripfit_password

---

### 4. Backend Setup

```bash
cd ~/Desktop/dev_proj/ripfit-app/backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# The .env file is PRE-CONFIGURED for Docker!
# No changes needed - Docker credentials already set

# Run database migrations
npm run migrate

# You should see:
# → Running 001_initial_schema.sql...
# ✓ Completed 001_initial_schema.sql
# → Running 002_nutrition_tables.sql...
# ✓ Completed 002_nutrition_tables.sql
# ✓ All migrations completed successfully!

# Start development server
npm run dev
```

**Server should now be running at `http://localhost:3000`**

**Verify it works:**
```bash
# In a new terminal:
curl http://localhost:3000/health
# Should return: {"status":"ok",...}
```

---

### 5. Frontend Setup

```bash
# Open a NEW terminal (keep backend running)
cd ~/Desktop/dev_proj/ripfit-app/frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

**Frontend should now be running at `http://localhost:8080`**

**Open in browser:** http://localhost:8080

You should see:
- RipFit landing page
- Theme toggle (Light/Dark/System) in header
- Clean, professional design

---

### 6. Verify Everything Works

**Check API:**
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok",...}
```

**Check Database:**
```bash
# Connect to database (password: ripfit_password)
docker exec -it ripfit-db psql -U ripfit_user -d ripfit_dev

# Inside PostgreSQL:
\dt
# Should list all 20 tables

# Exit with:
\q
```

**Check Frontend:**
- Open http://localhost:8080 in browser
- Click theme toggle - should switch between Light/Dark/System
- All buttons and links should be styled

**All three working?** You're ready to build!

---

## Your Framework Review Checklist

Before moving forward, review these files:

### Database Layer
- [ ] `backend/database/migrations/001_initial_schema.sql` - Original 16 tables
- [ ] `backend/database/migrations/002_nutrition_tables.sql` - 4 nutrition tables
- [ ] `docs/database-schema.md` - Full schema documentation (20 tables)
- [ ] Verify both migrations run successfully

### Backend Structure
- [ ] `backend/src/app.js` - Main Express application
- [ ] `backend/src/config/database.js` - Database connection
- [ ] `backend/package.json` - Dependencies and scripts
- [ ] `backend/.env.example` - Environment variables (Docker-ready)

### Frontend Structure (React)
- [ ] `frontend/src/App.jsx` - Main React component
- [ ] `frontend/src/main.jsx` - React entry point
- [ ] `frontend/src/contexts/ThemeContext.jsx` - Theme management
- [ ] `frontend/src/styles/index.css` - Themeable design system
- [ ] `frontend/vite.config.js` - Vite configuration

### Docker
- [ ] `docker-compose.yml` - PostgreSQL service
- [ ] Containers running: `docker ps`

### Documentation
- [ ] `README.md` - Project overview
- [ ] `CHANGES.md` - What changed from v1
- [ ] `docs/api-documentation.md` - API specs
- [ ] `docs/import-export-guide.md` - Data import/export

---

## Common Issues & Solutions

### "Cannot connect to database"
```bash
# Check if Docker container is running
docker ps

# If not running, start it:
docker-compose up -d

# Check logs for errors:
docker-compose logs postgres
```

### "Port 5432 already in use"
You might have PostgreSQL installed locally using port 5432.

**Solution:**
```bash
# Stop local PostgreSQL
# Mac: brew services stop postgresql
# Linux: sudo systemctl stop postgresql

# Or change port in docker-compose.yml:
ports:
  - "5433:5432"  # Use 5433 instead
  
# Then update backend/.env:
DB_PORT=5433
```

### "Port 3000 already in use"
```bash
# Find what's using port 3000
lsof -i :3000

# Kill it or change PORT in backend/.env:
PORT=3001
```

### "Frontend shows blank page"
```bash
# Check browser console (F12) for errors
# Check terminal for Vite errors
# Try clearing cache and hard reload (Cmd+Shift+R / Ctrl+Shift+R)
```

### "npm install fails"
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and try again
rm -rf node_modules package-lock.json
npm install
```

---

## What to Build Next

The framework is ready. Here's the suggested build order:

### Phase 1 - Core Features (Start Here)

**Week 1: Database Imports & Authentication**

1. **Import Exercise Database** (`backend/database/seeds/import-exercises.js`)
   - Fetch from wger API (~400 exercises)
   - Parse and insert into database
   - One-time script, ~5-10 minutes

2. **Import Nutrition Database** (`backend/database/seeds/import-foods.js`)
   - Fetch from USDA FoodData Central
   - Use curated subset (~10k common foods)
   - One-time script, ~30-60 minutes

3. **Authentication Routes** (`backend/src/routes/auth.js`)
   - User registration
   - Login (email/password)
   - JWT token generation

4. **React Auth Components** (`frontend/src/components/auth/`)
   - Login form
   - Signup form
   - Protected routes

**Week 2: Nutrition Tracking Backend**

5. **Food Search API** (`backend/src/routes/foods.js`)
   - GET /foods (search with autocomplete)
   - GET /foods/:id (food details)
   - POST /foods (create custom food)

6. **Meal Logging API** (`backend/src/routes/meals.js`)
   - POST /meals (log meal)
   - GET /meals (list user's meals)
   - GET /meals/:id (meal details)
   - DELETE /meals/:id

7. **Daily Summary API** (`backend/src/routes/nutrition.js`)
   - GET /nutrition/daily/:date
   - GET /nutrition/weekly

**Week 3: Nutrition Tracking Frontend**

8. **Food Search Component** (`frontend/src/components/nutrition/FoodSearch.jsx`)
   - Search bar with autocomplete
   - Food item display with macros
   - Add to meal button

9. **Meal Logger** (`frontend/src/pages/MealLogger.jsx`)
   - Date picker
   - Meal type selector
   - Food list with serving sizes
   - Macro totals display

10. **Daily Summary View** (`frontend/src/pages/DailySummary.jsx`)
    - Daily macro totals
    - Breakdown by meal
    - Progress bars vs targets

**Week 4: Exercise Tracking Backend**

11. **Exercise Library API** (`backend/src/routes/exercises.js`)
    - GET /exercises (search/filter)
    - GET /exercises/:id
    - POST /exercises (custom)

12. **Workout Logging API** (`backend/src/routes/workouts.js`)
    - POST /workouts (log workout)
    - GET /workouts (list)
    - GET /workouts/:id (details)

**Week 5: Exercise Tracking Frontend**

13. **Exercise Search** (`frontend/src/components/workouts/ExerciseSearch.jsx`)
    - Search exercises
    - Filter by category/equipment
    - Add to workout

14. **Workout Logger** (`frontend/src/pages/WorkoutLogger.jsx`)
    - Set tracking (reps/weight/RPE)
    - Timer for rest periods
    - Exercise notes

15. **Integration & Polish**
    - Same-day view (meals + workout)
    - Basic charts for both
    - Mobile responsiveness

### Phase 2 - Routines & Advanced Features

16. **Workout Routines**
17. **Progress Analytics**
18. **Import/Export Implementation**

### Phase 3 - Advanced Features

19. **Body Composition Tracking**
20. **Recipe Builder**
21. **OAuth Integration**

---

## Customizing the Theme

The app uses CSS variables for easy customization. To change the brand color for different gyms:

**Edit `frontend/src/styles/index.css`:**

```css
:root {
  /* Change these two values */
  --primary-hue: 220;        /* 0-360 (color wheel) */
  --primary-saturation: 80%; /* 0-100% (vibrancy) */
}
```

**Examples:**
- Red: `--primary-hue: 0;`
- Orange: `--primary-hue: 30;`
- Green: `--primary-hue: 140;`
- Blue: `--primary-hue: 220;` (current)
- Purple: `--primary-hue: 280;`

Save the file and refresh browser - instant rebrand!

---

## Questions to Answer as You Review

1. **Database Schema:**
   - Does the table structure support all your planned features?
   - Any additional fields needed?
   - Are the relationships correct?

2. **React Structure:**
   - Do the components make sense?
   - Want to add routing (React Router) now?
   - State management approach clear?

3. **Docker Setup:**
   - Is the database running correctly?
   - Need to adjust any ports?

4. **Design System:**
   - Like the default theme?
   - Want to customize colors now or later?
   - Dark mode working as expected?

---

## Tips for Success

- **Start Small**: Build authentication first, then one feature at a time
- **Test as You Go**: Use the test infrastructure from the start
- **Commit Often**: Small, focused commits with clear messages
- **Ask Questions**: If anything is unclear, ask before building
- **Use Docker**: Easier than managing PostgreSQL locally
- **Try Dark Mode**: Toggle theme to see it working

---

## Ready to Build?

When you're ready:
1. Review all the framework files
2. Run through the setup steps above
3. Verify everything works (checklist above)
4. Pick your first feature to implement
5. Start coding!

**To stop everything when done:**
```bash
# Stop backend (Ctrl+C in backend terminal)
# Stop frontend (Ctrl+C in frontend terminal)

# Stop Docker containers
docker-compose down

# Start again next time with:
docker-compose up -d
```

Let me know if you have questions about any part of the framework!

---

**Created**: January 15, 2026 (Updated for Nutrition Tracking)
**Git Commit**: TBD (after your first commit)
**Your Saved Location**: `~/Desktop/dev_proj/ripfit-app`
