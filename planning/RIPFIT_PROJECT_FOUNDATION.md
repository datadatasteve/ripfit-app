# RipFit Project Foundation Document

## Project Overview

**Name:** RipFit
**Type:** Full-stack fitness and nutrition tracking application
**Purpose:** Enhanced alternative to Anytime Fitness app with robust workout logging, nutrition tracking, and data import/export capabilities

## Technical Stack

### Frontend
- React 18
- Vite
- Port: 8080

### Backend
- Node.js
- Express
- Port: 3000
- API Version: v1

### Database
- PostgreSQL 14
- Docker container: ripfit-db
- Port: 5432
- Database: ripfit_dev
- User: ripfit_user
- Password: ripfit_password

### Repository
- GitHub: datadatasteve/ripfit-app
- Local Path: ~/Desktop/dev_proj/ripfit-app/

## Database Schema (20 Tables)

### User Management (1 table)
- users

### Workout Tracking (11 tables)
- exercises
- exercise_categories
- exercise_equipment
- exercise_muscles
- muscle_groups
- workouts
- workout_exercises
- workout_sets
- routines
- routine_exercises
- body_measurements

### Nutrition Tracking (4 tables)
- foods
- meals
- meal_foods
- daily_nutrition_summary

### Progress Tracking (4 tables)
- progress_photos
- progress_notes
- achievements
- user_preferences

## Feature Roadmap

### Phase 1 - MVP (Current)

#### Workout Features
- Exercise library (873 exercises from wger API)
- Workout logging (sets, reps, weight, RPE, rest times)
- Custom routine creation and management
- Superset and circuit support
- In-workout notes
- Body composition tracking

#### Nutrition Features
- Food database (USDA Foundation Foods + Branded Foods)
- Barcode scanning
- Food search
- Meal logging
- Daily macro tracking (calories, protein, carbs, fat)
- Custom food creation

#### Core Infrastructure
- User authentication (email/password)
- SSO integration (Google, Apple)
- JWT-based API authentication
- CSV/JSON data import/export

### Phase 2 - Enhancements
- Progress charts and analytics
- PDF import for body composition scans
- Advanced superset/circuit UI
- Mobile-responsive design improvements
- Auto-export to Google Drive
- Exercise video library

### Phase 3 - Advanced Features
- Recipe builder and meal planning
- Social features (optional workout/meal sharing)
- Mobile app (React Native)
- Advanced workout programming features

## Current Project Status

### Completed
- Database schema design and migrations
- Docker PostgreSQL setup
- Backend API structure
- Exercise database import (873 exercises)
- Foundation foods import (413 foods)
- Nutrition API endpoints (search, barcode, meal logging)
- Backend controllers and routes

### In Progress
- Branded foods import (47,782 foods - currently broken)
- Barcode scanning functionality

### Not Started
- User authentication
- Frontend React application
- Progress tracking features
- Data visualization/analytics
- Import/export functionality

## API Endpoints (Current)

### Nutrition
- GET /api/v1/nutrition/foods/search?q={query}
- GET /api/v1/nutrition/foods/:id
- POST /api/v1/nutrition/foods/barcode/:barcode
- POST /api/v1/nutrition/meals
- GET /api/v1/nutrition/meals/:date
- GET /api/v1/nutrition/nutrition/daily/:date

### Health Check
- GET /health

## Data Sources

### Exercise Data
- Source: wger Workout Manager API
- Count: 873 exercises
- Includes: name, description, category, equipment, muscles worked

### Nutrition Data
- Source: USDA FoodData Central
- Foundation Foods: 413 items
- Branded Foods: 47,782 items (import broken - only 1 loaded)
- Includes: calories, macros (protein, carbs, fat), serving sizes, barcodes

## Key Design Decisions

### Why Nutrition in Phase 1
Originally planned for Phase 3, moved to Phase 1 because:
- Fitness and nutrition are complementary tracking needs
- Many users want both features from day one
- Building both APIs together creates better data architecture

### Database Design Philosophy
- Normalized schema for data integrity
- Timestamps on all tables (created_at, updated_at)
- Soft deletes where appropriate
- Foreign key constraints for referential integrity
- Indexed fields for common queries (barcode, food name, exercise name)

### API Design Philosophy
- RESTful endpoints
- Consistent error handling
- JSON responses
- Version prefix (/api/v1) for future compatibility

## Development Workflow

1. Backend-first approach (build APIs before UI)
2. Test APIs with curl/Postman before building frontend
3. Database migrations track all schema changes
4. Git commits after each working feature
5. Documentation updated alongside code changes

## Testing Strategy

### Manual Testing
- API endpoints tested via curl commands
- Database queries verified in psql
- Browser testing for search endpoints (JSON responses)

### Future Automated Testing
- Unit tests for controllers
- Integration tests for API endpoints
- Frontend component tests

## Known Issues

1. Branded foods import only loading 1 record (should be 47,782)
2. Transaction rollback issue in import script
3. No frontend exists yet (backend-only)
4. Barcode scanning returns "not found" for most barcodes (due to issue #1)

## Next Steps (Priority Order)

1. Fix branded foods import transaction issue
2. Verify barcode scanning works with imported foods
3. Build user authentication (email/password + SSO)
4. Create basic frontend test page for nutrition features
5. Build React frontend for nutrition logging
6. Implement workout logging UI
7. Add progress tracking features

## Success Metrics

### Phase 1 Goals
- User can create account and log in
- User can log complete workout with all details
- User can scan barcode and log meals
- User can view daily nutrition totals
- User can export workout/nutrition data to CSV

### Long-term Goals
- 100+ active users
- Mobile app in app stores
- Integration with fitness wearables
- Community feature adoption (workout sharing)
