const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  try {
    console.log('Starting database migrations...\n');

    // Create migrations tracking table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      return;
    }

    // Check which migrations have already been run
    const { rows: executedMigrations } = await pool.query(
      'SELECT migration_name FROM schema_migrations'
    );
    const executedSet = new Set(executedMigrations.map(row => row.migration_name));

    // Run pending migrations
    for (const file of files) {
      if (executedSet.has(file)) {
        console.log(`⊘ Skipping ${file} (already executed)`);
        continue;
      }

      console.log(`→ Running ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
          [file]
        );
        await pool.query('COMMIT');
        console.log(`✓ Completed ${file}\n`);
      } catch (error) {
        await pool.query('ROLLBACK');
        console.error(`✗ Failed ${file}:`, error.message);
        throw error;
      }
    }

    console.log('✓ All migrations completed successfully!\n');
  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
