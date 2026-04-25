#!/usr/bin/env node
/**
 * Apply SQL migrations exactly once per database.
 *
 * Tracks applied migrations in a schema_migrations table. Each file in
 * migrations/ is a named migration; the filename is the identifier. Files
 * are applied in alphabetical order, and already-applied ones are skipped.
 *
 * This replaces the old runner which re-ran every file on every invocation —
 * safe when files were idempotent, destructive when they weren't.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Create the tracking table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Which migrations have already run?
  const { rows: applied } = await client.query(
    `SELECT name FROM schema_migrations ORDER BY name`
  );
  const appliedSet = new Set(applied.map((r) => r.name));

  // Find migration files on disk
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  let applyCount = 0;
  for (const f of files) {
    if (appliedSet.has(f)) {
      console.log(`  skip  ${f} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`apply   ${f}...`);

    // Wrap each migration in a transaction so it's all-or-nothing
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (name) VALUES ($1)`,
        [f]
      );
      await client.query('COMMIT');
      console.log(`  ok    ${f}`);
      applyCount++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  FAIL  ${f}: ${e.message}`);
      throw e;
    }
  }

  await client.end();
  console.log(
    applyCount === 0
      ? `No pending migrations (${files.length} already applied).`
      : `Applied ${applyCount} migration(s).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});