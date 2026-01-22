# RipFit App

A comprehensive fitness and nutrition tracking web application for logging workouts and meals, tracking body composition, and analyzing progress over time.

## Project Overview

RipFit is a full-stack fitness and nutrition tracking application that enhances traditional gym apps with features like:

- **Comprehensive Workout Logging**: Track sets, reps, weights, RPE, rest times, and more
- **Nutrition Tracking**: Log meals and track daily macros (calories, protein, carbs, fat)
- **Flexible Routine Management**: Create reusable workout programs with superset support
- **Body Composition Tracking**: Import scans from InBody, DEXA, and other devices
- **Progress Analytics**: Visualize strength gains, nutrition trends, and body composition changes
- **Data Ownership**: Export all your data in CSV/JSON formats
- **Privacy-First**: Photos stored locally on your device

## Tech Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Docker container)
- **Authentication**: JWT + OAuth (Google, Apple)
- **Testing**: Jest + Supertest

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Styling**: CSS Variables (themeable)
- **Features**: Dark/Light/System mode

## Prerequisites

- Node.js (v18 or higher)
- Docker Desktop
- npm or yarn
- Git

## Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd ripfit-app
```

### 2. Start Database (Docker)

```bash
# Start PostgreSQL in Docker container
docker-compose up -d

# Check container is running
docker ps
```

Database will be available at `localhost:5432`
PgAdmin (optional GUI) at `http://localhost:5050`

### 3. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# .env is pre-configured for Docker - no changes needed!
npm run migrate  # Run database migrations
npm run dev      # Start development server
```

Backend will run on `http://localhost:3000`

### 4. Frontend Setup

```bash
cd frontend
npm install
npm run dev      # Start development server
```

Frontend will run on `http://localhost:8080`

## Project Structure

```
ripfit-app/
├── backend/
│   ├── src/
│   │   ├── config/         # Configuration files
│   │   ├── controllers/    # Route controllers
│   │   ├── middleware/     # Custom middleware
│   │   ├── models/         # Database models
│   │   ├── routes/         # API routes
│   │   ├── utils/          # Helper functions
│   │   └── app.js          # Express app
│   ├── database/
│   │   ├── migrations/     # Database migrations
│   │   └── seeds/          # Seed data
│   └── tests/              # Backend tests
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── contexts/       # React contexts (theme, auth)
│   │   ├── styles/         # CSS files
│   │   ├── utils/          # Helper functions
│   │   ├── App.jsx         # Main app component
│   │   └── main.jsx        # React entry point
│   ├── index.html          # HTML template
│   └── vite.config.js      # Vite configuration
├── docs/                   # Documentation
├── docker-compose.yml      # Docker services
└── README.md
```

## Database Schema

See [docs/database-schema.md](docs/database-schema.md) for complete database design.

**Core tables:**
- `users` - User accounts and authentication
- `exercises` - Exercise library (system + custom)
- `foods` - Nutrition database (USDA + custom)
- `workout_routines` - Saved workout programs
- `workouts` - Logged gym sessions
- `workout_sets` - Individual set records
- `meals` - Logged meals
- `meal_foods` - Individual foods in meals
- `user_metrics` - Body composition data
- `nutrition_plans` - Dietary targets

## API Documentation

See [docs/api-documentation.md](docs/api-documentation.md) for complete API reference.

**Base URL**: `http://localhost:3000/api/v1`

**Key endpoints:**
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `GET /workouts` - List user's workouts
- `POST /workouts` - Log a new workout
- `GET /routines` - List user's routines
- `GET /meals` - List user's meals
- `POST /meals` - Log a new meal
- `GET /nutrition/daily` - Get daily nutrition summary
- `POST /body-composition` - Record body scan

## Import/Export

See [docs/import-export-guide.md](docs/import-export-guide.md) for detailed instructions.

**Export formats:**
- CSV/XLSX - For spreadsheet analysis
- JSON - For full backup and re-import

**Import sources:**
- CSV templates (provided)
- Body scan PDFs (InBody, DEXA)
- Manual entry forms

## Testing

### Run Backend Tests
```bash
cd backend
npm test                    # Run all tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report
```

### Run Frontend Tests
```bash
cd frontend
npm test
```

## Deployment

Deployment instructions coming soon. Will support:
- Heroku
- DigitalOcean
- AWS (EC2/RDS)

## Development Roadmap

### Phase 1 - MVP (Current)
- [x] Database schema design
- [ ] User authentication (simple + OAuth)
- [ ] Exercise library (import from wger API)
- [ ] Nutrition database (import from USDA)
- [ ] Workout logging
- [ ] Meal logging and nutrition tracking
- [ ] Routine management
- [ ] Basic body composition tracking
- [ ] CSV/JSON export

### Phase 2 - Enhancements
- [ ] Progress charts and analytics
- [ ] PDF import for body scans
- [ ] Advanced superset/circuit support
- [ ] Mobile-responsive UI improvements
- [ ] Auto-export to Google Drive

### Phase 3 - Advanced Features
- [ ] Exercise video library
- [ ] Recipe builder and meal planning
- [ ] Social features (optional sharing)
- [ ] Mobile app (React Native)

## Contributing

This is a personal portfolio project, but feedback and suggestions are welcome!

## License

MIT License - See LICENSE file for details

## Author

**Rip** - [GitHub Profile]
- Portfolio project demonstrating full-stack development
- Transitioning from loan operations to data analytics
- Building in public to showcase technical growth

## Acknowledgments

- Exercise data from wger.de API
- Inspired by Anytime Fitness and other fitness tracking apps
- Built as part of The Odin Project curriculum

---

**Status**: Active Development  
**Last Updated**: January 15, 2026
