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

// Request logging. The calendar feed's secret token (Phase 1A-1) is cut out
// of every logged URL.
morgan.token('url', (req) =>
  String(req.originalUrl || req.url).replace(/(\/calendar\/feed\/)[^/?#]+/, '$1[redacted]'));
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
const programRoutes = require('./routes/programRoutes');
const cardioRoutes = require('./routes/cardioRoutes');
const profileRoutes = require('./routes/profileRoutes');
const statsRoutes = require('./routes/statsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const circuitRoutes = require('./routes/circuitRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const habitRoutes = require('./routes/habitRoutes');
const injuryRoutes = require('./routes/injuryRoutes');
const checkinRoutes = require('./routes/checkinRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const bodyRoutes = require('./routes/bodyRoutes');

app.use(`/api/${API_VERSION}/nutrition`, nutritionRoutes);
app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/workouts`, workoutRoutes);
app.use(`/api/${API_VERSION}/routines`, routineRoutes);
app.use('/api/v1/programs', programRoutes);
app.use(`/api/${API_VERSION}/cardio`, cardioRoutes);
app.use('/api/v1/users', profileRoutes);
app.use('/api/v1/stats', statsRoutes);
// Admin reset password (no JWT, protected by ADMIN_SECRET in the body). Only
// this one route lives at the API root: mounting all of statsRoutes here put
// its auth on every /api/v1 path, so the API root and unknown routes got 401.
app.post('/api/v1/admin/reset-password', require('./controllers/statsController').adminResetPassword);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/circuits', circuitRoutes);     // Phase 1A-1
app.use('/api/v1/calendar', calendarRoutes);    // Phase 1A-1 (public .ics feed by token)
app.use('/api/v1/habits', habitRoutes);         // Phase 1A-2
app.use('/api/v1/injuries', injuryRoutes);      // Phase 1A-2
app.use('/api/v1/checkins', checkinRoutes);     // Phase 1A-2
app.use('/api/v1/device', deviceRoutes.device);            // Phase 1A-2
app.use('/api/v1/saved-routes', deviceRoutes.savedRoutes);  // Phase 1A-2
app.use('/api/v1/reviews', reviewRoutes);                   // Phase 1A-2
app.use('/api/v1/body', bodyRoutes.body);                   // Phase 1B-2
app.use('/api/v1/stickers', bodyRoutes.stickers);           // Phase 1B-2

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

  // Log server errors to DB for admin visibility
  if (statusCode >= 500) {
    const { pool } = require('./config/database');
    pool.query(
      `INSERT INTO error_logs (user_id, error_message, error_stack, current_view, url, severity)
       VALUES ($1, $2, $3, $4, $5, 'server_error')`,
      [
        req.user?.userId || null,
        message.slice(0, 2000),
        err.stack ? err.stack.slice(0, 5000) : null,
        null,
        req.path || null,
      ]
    ).catch(logErr => console.error('Failed to log error to DB:', logErr));
  }

  // Production (Phase 0B-2): no stack and no internal detail in a response.
  // A body that isn't valid JSON gets a plain 400; other client errors keep
  // their message only when it was written for the client (err.expose, as
  // set by body-parser / http-errors); anything else is a generic message.
  // Other NODE_ENV values behave as before.
  if (process.env.NODE_ENV === 'production') {
    let safe;
    if (err.type === 'entity.parse.failed') safe = 'Malformed JSON in request body';
    else if (statusCode < 500 && err.expose) safe = message;
    else safe = statusCode < 500 ? 'Bad Request' : 'Internal Server Error';
    return res.status(statusCode).json({ error: safe });
  }

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

