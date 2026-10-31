// SERVICE TRANSKRIP (port 3002) - resource. Hanya menerima request dari gateway.
const http = require('http');
const config = require('../config');
const dbLib = require('../lib/db');
const { authenticate } = require('../lib/guard');
const { httpError, readBody, parseJson, sendJson } = require('../lib/http');

const db = dbLib.open();

function grade(n) {
  if (n >= 80) return { huruf: 'A', bobot: 4 };
  if (n >= 70) return { huruf: 'B', bobot: 3 };
  if (n >= 60) return { huruf: 'C', bobot: 2 };
  if (n >= 50) return { huruf: 'D', bobot: 1 };
  return { huruf: 'E', bobot: 0 };
}

function getTranskrip(claims, nim) {
  if (claims.role === 'service') throw httpError(403, 'token service tidak boleh membaca transkrip');
  const user = dbLib.userBySub(db, claims.sub);
  if (!user || user.role !== claims.role) throw httpError(401, 'user tidak valid');
  if (user.role === 'mahasiswa') {
    if (user.nim !== nim) throw httpError(403, 'mahasiswa hanya boleh melihat transkrip NIM sendiri');
  } else if (user.role !== 'admin') {
    throw httpError(403, `role ${user.role} tidak berhak melihat transkrip`);
  }
  const mhs = db.prepare("SELECT nama FROM users WHERE nim = ? AND role = 'mahasiswa'").get(nim);
  if (!mhs) throw httpError(404, 'mahasiswa tidak ditemukan');
  const mk = db.prepare(
    'SELECT kode, nama_mk, sks, nilai_angka, huruf, bobot FROM transkrip WHERE nim = ? ORDER BY kelas_id').all(nim);
  const sks = mk.reduce((a, r) => a + r.sks, 0);
  const mutu = mk.reduce((a, r) => a + r.sks * r.bobot, 0);
  return { nim, nama: mhs.nama, mata_kuliah: mk, total_sks: sks, ipk: sks ? Number((mutu / sks).toFixed(2)) : 0 };
}

function sinkron(claims, body) {
  if (claims.role !== 'service') throw httpError(403, 'hanya token service yang boleh menyinkronkan transkrip');
  const { kelas_id: kelasId, kode, nama, sks, entries } = body;
  if (!Number.isInteger(kelasId) || !Number.isInteger(sks) || !Array.isArray(entries) || !entries.length) {
    throw httpError(400, 'payload sinkron tidak valid');
  }
  const isMhs = db.prepare("SELECT 1 FROM users WHERE nim = ? AND role = 'mahasiswa'");
  for (const e of entries) {
    if (typeof e.nim !== 'string' || typeof e.nilai_angka !== 'number' || e.nilai_angka < 0 || e.nilai_angka > 100) {
      throw httpError(400, 'entri nilai tidak valid');
    }
    if (!isMhs.get(e.nim)) throw httpError(400, `NIM ${e.nim} tidak dikenal`);
  }
  const upsert = db.prepare(`INSERT INTO transkrip(nim, kelas_id, kode, nama_mk, sks, nilai_angka, huruf, bobot, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(nim, kelas_id) DO UPDATE SET nilai_angka = excluded.nilai_angka,
    huruf = excluded.huruf, bobot = excluded.bobot, synced_at = excluded.synced_at`);
  db.exec('BEGIN');
  try {
    const at = new Date().toISOString();
    for (const e of entries) {
      const g = grade(e.nilai_angka);
      upsert.run(e.nim, kelasId, kode ?? null, nama ?? null, sks, e.nilai_angka, g.huruf, g.bobot, at);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { message: 'transkrip disinkronkan', kelas_id: kelasId, jumlah: entries.length };
}

async function handle(req, res) {
  const claims = authenticate(req);                 // gateway secret + token
  const url = new URL(req.url, 'http://service');
  const seg = url.pathname.split('/').filter(Boolean);
  const body = parseJson(await readBody(req));

  if (req.method === 'POST' && seg.length === 2 && seg[0] === 'transkrip' && seg[1] === 'sinkron') {
    return sendJson(res, 200, sinkron(claims, body));
  }
  if (req.method === 'GET' && seg.length === 2 && seg[0] === 'transkrip') {
    return sendJson(res, 200, getTranskrip(claims, seg[1]));
  }
  throw httpError(404, 'endpoint tidak ditemukan');
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : 'kesalahan internal service transkrip' });
  });
}).listen(config.ports.transkrip, config.HOST, () => {
  console.log(`[service-transkrip] berjalan di http://${config.HOST}:${config.ports.transkrip}`);
});
