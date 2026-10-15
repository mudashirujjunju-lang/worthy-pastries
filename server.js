// Boot: restore the SQLite snapshot from Postgres (if DATABASE_URL set), then start the app.
const path = require('path');
const persist = require('./persist');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
persist.restore(path.join(DATA_DIR, 'worthy.db'))
  .catch(e => { console.error('persist: restore failed - refusing to start with empty data', e); process.exit(1); })
  .then(() => require('./app'));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { try { await persist.flush(); } finally { process.exit(0); } });
