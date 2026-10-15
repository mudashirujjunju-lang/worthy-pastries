// Persistence for Render free plan: the local disk is wiped on every restart/redeploy,
// so the whole SQLite database (incl. uploaded photos, stored as BLOBs) is snapshotted
// into Postgres (DATABASE_URL) after each change and restored on boot.
// Works with any Postgres: Render, Neon, Supabase... just change DATABASE_URL.
const fs = require('fs');
const path = require('path');
const URL = process.env.DATABASE_URL;
let pool = null, db = null, timer = null, saving = null, dirty = false;
if (URL) {
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1|dpg-[a-z0-9]+-a)(:|\/)/.test(URL); // Render internal hosts need no SSL
  pool = new Pool({ connectionString: URL, ssl: local ? false : { rejectUnauthorized: false }, max: 2 });
}
const enabled = () => !!pool;

async function restore(dbFile) {
  if (!pool) { console.warn('WARNING: DATABASE_URL not set - data lives only on local disk and is lost on restart.'); return false; }
  await pool.query('CREATE TABLE IF NOT EXISTS sqlite_snapshot(id INTEGER PRIMARY KEY, data BYTEA NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const r = await pool.query('SELECT data, saved_at FROM sqlite_snapshot WHERE id=1');
  if (!r.rows.length) { console.log('persist: no snapshot in Postgres yet - starting from local/seed data'); return false; }
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) fs.rmSync(f, { force: true });
  fs.writeFileSync(dbFile, r.rows[0].data);
  console.log(`persist: restored ${r.rows[0].data.length} bytes from snapshot saved ${r.rows[0].saved_at.toISOString()}`);
  return true;
}

function attach(database) { db = database; }

async function save() {
  if (!pool || !db) return;
  if (saving) { dirty = true; return saving; }
  dirty = false;
  saving = (async () => {
    try {
      const buf = db.serialize();
      await pool.query('INSERT INTO sqlite_snapshot(id,data,saved_at) VALUES(1,$1,now()) ON CONFLICT(id) DO UPDATE SET data=excluded.data, saved_at=excluded.saved_at', [buf]);
    } catch (e) { console.error('persist: save failed', e.message); dirty = true; }
    finally { saving = null; }
    if (dirty) return save();
  })();
  return saving;
}
// Debounced: many writes in quick succession -> one upload.
function schedule() { if (!pool) return; clearTimeout(timer); timer = setTimeout(save, 300); }
async function flush() { clearTimeout(timer); await save(); if (saving) await saving; }

module.exports = { enabled, restore, attach, save, schedule, flush };
