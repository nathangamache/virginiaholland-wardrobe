#!/usr/bin/env node
/**
 * Mark all migration files as "applied" without running them.
 * Use this exactly once when adopting the tracking system on a database
 * that already has the schema from a different source (like a pg_restore
 * from another server).
 *
 * Usage: node scripts/migrate-baseline.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const f of files) {
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [f]
    );
    console.log(`marked: ${f}`);
  }

  const { rows } = await client.query(
    `SELECT count(*)::int AS count FROM schema_migrations`
  );
  console.log(`Baseline complete. ${rows[0].count} migration(s) tracked.`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});