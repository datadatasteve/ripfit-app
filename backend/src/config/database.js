const { Pool } = require('pg');
require('dotenv').config();

// Database connection configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.NODE_ENV === 'test' 
    ? process.env.TEST_DB_NAME 
    : process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

// Create connection pool
const pool = new Pool(config);

// Log connection info (without sensitive data)
pool.on('connect', () => {
  console.log(`✓ Connected to database: ${config.database}`);
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

// Helper function to execute queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    
    return res;
  } catch (error) {
    console.error('Query error:', { text, error: error.message });
    throw error;
  }
};

// Helper function for transactions
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Graceful shutdown — called by app.js signal handlers only
const shutdown = async () => {
  console.log('\nShutting down database connections...');
  await pool.end();
  console.log('✓ Database connections closed');
};

// Do NOT register SIGINT/SIGTERM here — app.js handles signals
// and calls db.shutdown() directly, avoiding double pool.end()

module.exports = {
  pool,
  query,
  transaction,
  shutdown,
};
