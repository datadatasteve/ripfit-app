const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./config/database');
const runMigrations = require('../database/migrate');
const seedExercises = require('../database/seeds/seed-exercises');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Security headers
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080', 'https://datadatasteve.github.io'],
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy — required for rate limiter behind Northflank's load balancer
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(`/api/${API_VERSION}`, limiter);

// ============================================================================
// ROUTES
// ============================================================================

const nutritionRoutes = require('./routes/nutritionRoutes');
const authRoutes = require('./routes/authRoutes');
const workoutRoutes = require('./routes/workoutRoutes');
const routineRoutes = require('./routes/routineRoutes');
const cardioRoutes = require('./routes/cardioRoutes');
const profileRoutes = require('./routes/profileRoutes');
const statsRoutes = require('./routes/statsRoutes');

app.use(`/api/${API_VERSION}/nutrition`, nutritionRoutes);
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/workouts`, workoutRoutes);
app.use(`/api/${API_VERSION}/routines`, routineRoutes);
app.use(`/api/${API_VERSION}/cardio`, cardioRoutes);
app.use('/api/v1/users', profileRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1', statsRoutes); // admin reset password (protected by ADMIN_SECRET)

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// API root
app.get(`/api/${API_VERSION}`, (req, res) => {
  res.json({
    message: 'RipFit API',
    version: API_VERSION,
    endpoints: {
      health: '/health',
      auth: `/api/${API_VERSION}/auth`,
      routines: `/api/${API_VERSION}/routines`,
      workouts: `/api/${API_VERSION}/workouts`,
      cardio: `/api/${API_VERSION}/cardio`,
      nutrition: `/api/${API_VERSION}/nutrition`,
    },
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    path: req.path,
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ============================================================================
// SERVER
// ============================================================================

if (process.env.NODE_ENV !== 'test') {
  runMigrations()
    .then(() => seedExercises())
    .then(() => {
      app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════╗
║         RipFit API Server                  ║
╠════════════════════════════════════════════╣
║ Environment: ${process.env.NODE_ENV?.padEnd(28)}║
║ Port:        ${PORT.toString().padEnd(28)}║
║ API Version: ${API_VERSION.padEnd(28)}║
║ Database:    ${process.env.DB_NAME?.padEnd(28)}║
╠════════════════════════════════════════════╣
║ API Base:    http://localhost:${PORT}/api/${API_VERSION.padEnd(3)}║
║ Health:      http://localhost:${PORT}/health     ║
╚════════════════════════════════════════════╝
        `);
      });
    })
    .catch(err => {
      console.error('Migration failed, server not started:', err);
      process.exit(1);
    });
}

// Graceful shutdown
const shutdown = async () => {
  console.log('\n\nShutting down server...');
  await db.shutdown();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
