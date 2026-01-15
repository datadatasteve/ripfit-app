const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./config/database');

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
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'],
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

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(`/api/${API_VERSION}`, limiter);

// ============================================================================
// ROUTES
// ============================================================================

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
      users: `/api/${API_VERSION}/users`,
      exercises: `/api/${API_VERSION}/exercises`,
      routines: `/api/${API_VERSION}/routines`,
      workouts: `/api/${API_VERSION}/workouts`,
      metrics: `/api/${API_VERSION}/metrics`,
      export: `/api/${API_VERSION}/export`,
    },
  });
});

// TODO: Import and use route modules
// const authRoutes = require('./routes/auth');
// const userRoutes = require('./routes/users');
// const exerciseRoutes = require('./routes/exercises');
// const routineRoutes = require('./routes/routines');
// const workoutRoutes = require('./routes/workouts');
// const metricsRoutes = require('./routes/metrics');
// const exportRoutes = require('./routes/export');

// app.use(`/api/${API_VERSION}/auth`, authRoutes);
// app.use(`/api/${API_VERSION}/users`, userRoutes);
// app.use(`/api/${API_VERSION}/exercises`, exerciseRoutes);
// app.use(`/api/${API_VERSION}/routines`, routineRoutes);
// app.use(`/api/${API_VERSION}/workouts`, workoutRoutes);
// app.use(`/api/${API_VERSION}/metrics`, metricsRoutes);
// app.use(`/api/${API_VERSION}/export`, exportRoutes);

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    path: req.path,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Don't leak error details in production
  const response = {
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  };

  res.status(statusCode).json(response);
});

// ============================================================================
// SERVER
// ============================================================================

// Only start server if not in test mode
if (process.env.NODE_ENV !== 'test') {
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
