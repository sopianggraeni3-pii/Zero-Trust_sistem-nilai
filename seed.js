// Data awal: 1 admin, 2 dosen, 3 mahasiswa, 2 kelas (dosen berbeda), 1 device per user.
// Jalankan: node seed.js --reset   (menghapus database lalu mengisi ulang)
const fs = require('fs');
const config = require('./config');
const pw = require('./lib/password');

function seed(db) {
  const user = db.prepare('INSERT INTO users(username, password_hash, nama, role, nim) VALUES (?,?,?,?,?)');
  const device = db.prepare('INSERT INTO devices(user_id, device_id) VALUES (?,?)');
  const add = (username, password, nama, role, nim, dev) => {
    const id = Number(user.run(username, pw.hash(password), nama, role, nim).lastInsertRowid);
    device.run(id, dev);
    return id;
  };

  add('admin', 'admin123', 'Admin Prodi Informatika', 'admin', null, 'DEV-ADMIN-01');
  const dosen1 = add('dosen1', 'dosen123', 'Dr. Budi Santoso', 'dosen', null, 'DEV-DOSEN1-01');
  const dosen2 = add('dosen2', 'dosen123', 'Siti Rahmawati, M.Kom.', 'dosen', null, 'DEV-DOSEN2-01');
  add('mhs1', 'mhs123', 'Andi Pratama', 'mahasiswa', '09021282025001', 'DEV-MHS1-01');
  add('mhs2', 'mhs123', 'Bunga Lestari', 'mahasiswa', '09021282025002', 'DEV-MHS2-01');
  add('mhs3', 'mhs123', 'Citra Dewi', 'mahasiswa', '09021282025003', 'DEV-MHS3-01');

  const kelas = db.prepare('INSERT INTO kelas(kode, nama, sks, dosen_id) VALUES (?,?,?,?)');
  const k1 = Number(kelas.run('KP70065004', 'Keamanan Informasi', 3, dosen1).lastInsertRowid);
  const k2 = Number(kelas.run('IF70045002', 'Basis Data', 3, dosen2).lastInsertRowid);

  const nilai = db.prepare('INSERT INTO nilai(kelas_id, nim, nilai_angka, final) VALUES (?,?,?,0)');
  [['09021282025001', 88], ['09021282025002', 76], ['09021282025003', 65]].forEach(([n, v]) => nilai.run(k1, n, v));
  [['09021282025001', 72], ['09021282025002', 91], ['09021282025003', 58]].forEach(([n, v]) => nilai.run(k2, n, v));

  db.prepare('INSERT INTO service_clients(client_id, secret_hash) VALUES (?,?)')
    .run(config.serviceClient.id, pw.hash(config.serviceClient.secret));
}

function ensureSeeded(db) {
  if (!db.prepare('SELECT COUNT(*) AS c FROM users').get().c) { seed(db); return true; }
  return false;
}

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    for (const s of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + s, { force: true });
  }
  const db = require('./lib/db').open();
  console.log(ensureSeeded(db) ? `Seed selesai: ${config.dbPath}` : 'Database sudah berisi data (pakai --reset untuk mengulang).');
  db.close();
}

module.exports = { seed, ensureSeeded };
