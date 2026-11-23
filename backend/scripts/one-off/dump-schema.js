#!/usr/bin/env node
// ============================================================================
// dump-schema.js — READ-ONLY (Phase 0A-1)
//
// Usage (Northflank shell, repo root):
//   node backend/scripts/one-off/dump-schema.js > schema-prod.md
//
// Prints every table in the public schema with its columns (type, default,
// nullability) and constraints, in the same table layout as db-schema.md, so
// production can be diffed against the repo's generated doc. Also prints the
// session TimeZone (workouts.start_time / end_time and workout_sets.created_at
// are `timestamp without time zone` filled by NOW()/CURRENT_TIMESTAMP in some
// paths, which assumes UTC) and the applied migrations.
// ============================================================================

// The app's pool logs "Connected to database" via console.log; route all
// logging to stderr so stdout is only the dump (safe to redirect to a file).
console.log = (...args) => console.error(...args);

const { pool } = require('../../src/config/database');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const tz = (await client.query('SHOW timezone')).rows[0].TimeZone;
    const db = (await client.query('SELECT current_database() AS db, version() AS v')).rows[0];

    const cols = await client.query(`
      SELECT c.table_name, c.column_name, c.ordinal_position,
             CASE WHEN c.data_type = 'ARRAY' THEN substr(c.udt_name, 2) || '[]'
                  WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
                  WHEN c.character_maximum_length IS NOT NULL THEN c.data_type || '(' || c.character_maximum_length || ')'
                  WHEN c.data_type = 'numeric' AND c.numeric_precision IS NOT NULL AND c.numeric_scale IS NOT NULL
                       THEN 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
                  ELSE c.data_type END AS type,
             c.column_default, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`);

    const cons = await client.query(`
      SELECT rel.relname AS table_name, con.conname AS name, con.contype AS kind,
             pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = 'public'
      ORDER BY rel.relname, con.contype, con.conname`);

    let migrations = [];
    try {
      migrations = (await client.query('SELECT migration_name FROM schema_migrations ORDER BY migration_name')).rows.map(r => r.migration_name);
    } catch { /* table missing */ }

    const out = [];
    out.push(`# Schema dump: ${db.db}`, '');
    out.push(`- Generated: ${new Date().toISOString()}`);
    out.push(`- Session TimeZone: ${tz}${tz === 'UTC' || tz === 'Etc/UTC' ? '' : '  <-- NOT UTC: naive timestamps written by NOW() will not be UTC'}`);
    out.push(`- Server: ${db.v.split(',')[0]}`);
    out.push(`- Migrations applied (${migrations.length}): ${migrations.join(', ') || '(none)'}`, '');

    const byTable = new Map();
    for (const c of cols.rows) {
      if (!byTable.has(c.table_name)) byTable.set(c.table_name, { cols: [], cons: [] });
      byTable.get(c.table_name).cols.push(c);
    }
    for (const c of cons.rows) byTable.get(c.table_name)?.cons.push(c);

    const KIND = { p: 'PRIMARY KEY', f: 'FOREIGN KEY', u: 'UNIQUE', c: 'CHECK', x: 'EXCLUDE' };
    const esc = s => String(s ?? '').replace(/\|/g, '\\|');

    for (const [table, { cols: tc, cons: tk }] of byTable) {
      out.push(`### ${table}`, '', '|Column|Type|Default|Nullable|', '|---|---|---|---|');
      for (const c of tc) out.push(`|${c.column_name}|${esc(c.type)}|${esc(c.column_default)}|${c.is_nullable === 'YES' ? 'yes' : 'no'}|`);
      if (tk.length) {
        out.push('', 'Constraints:');
        for (const k of tk) out.push(`- \`${k.name}\` ${KIND[k.kind] || k.kind}: ${k.def}`);
      }
      out.push('');
    }

    process.stdout.write(out.join('\n') + '\n');
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('Dump failed:', err.message); process.exit(1); });
