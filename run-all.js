// Menjalankan seed (jika DB kosong) lalu gateway + kedua service sebagai proses terpisah.
const { spawn } = require('child_process');
const path = require('path');
const db = require('./lib/db').open();
const { ensureSeeded } = require('./seed');
if (ensureSeeded(db)) console.log('[run-all] database kosong -> seed data awal dibuat');
db.close();

const children = ['service-nilai', 'service-transkrip', 'gateway'].map((name) =>
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, name, 'server.js')], { stdio: 'inherit' }));

const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { if (code) { console.error('[run-all] salah satu proses berhenti, menghentikan semua'); stop(); } }));
