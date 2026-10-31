// SERVICE NILAI (port 3001) - resource. Hanya menerima request dari gateway.
// Verifikasi ulang: X-Gateway-Secret + tanda tangan/masa berlaku token (lib/guard.js),
// ditambah pemeriksaan role/kepemilikan sebagai lapisan pertahanan kedua (assume breach).
const http = require('http');
const config = require('../config');
const dbLib = require('../lib/db');
const { authenticate } = require('../lib/guard');
const { httpError, readBody, parseJson, sendJson } = require('../lib/http');

const db = dbLib.open();

// ---------- Token service untuk memanggil Service Transkrip lewat gateway ----------
let cached = null;
async function getServiceToken() {
  if (cached && cached.exp - 30 > Date.now() / 1000) return cached.token;
  const r = await fetch(`${config.gatewayUrl}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.serviceClient.id, client_secret: config.serviceClient.secret }),
  });
  if (!r.ok) throw new Error(`gateway menolak /auth/service (${r.status})`);
  const { access_token: token } = await r.json();
  cached = { token, exp: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp };
  return token;
}

async function syncTranskrip(payload) {
  const token = await getServiceToken();
  const r = await fetch(`${config.gatewayUrl}/transkrip/sinkron`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`sinkron transkrip gagal (${r.status}): ${data.alasan || data.error || ''}`);
  return data;
}

// ---------- Helper otorisasi lapisan service ----------
function currentUser(claims, ...roles) {
  if (claims.role === 'service') throw httpError(403, 'token service tidak boleh mengakses endpoint ini');
  const user = dbLib.userBySub(db, claims.sub);
  if (!user || user.role !== claims.role) throw httpError(401, 'user tidak valid');
  if (!roles.includes(user.role)) throw httpError(403, `role ${user.role} tidak berhak`);
  return user;
}
function ownedKelas(user, id) {
  const kelas = db.prepare('SELECT * FROM kelas WHERE id = ?').get(id);
  if (!kelas) throw httpError(404, 'kelas tidak ditemukan');
  if (kelas.dosen_id !== user.id) throw httpError(403, 'kelas bukan kelas yang diampu dosen ini');
  return kelas;
}
const intParam = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

// ---------- Handler ----------
const SELECT_NILAI = `SELECT n.id, n.kelas_id, k.kode, k.nama AS nama_mk, n.nim, u.nama AS nama_mahasiswa,
  n.nilai_angka, n.final FROM nilai n JOIN kelas k ON k.id = n.kelas_id LEFT JOIN users u ON u.nim = n.nim`;

function listNilai(claims, url) {
  const user = currentUser(claims, 'mahasiswa', 'dosen');
  if (user.role === 'mahasiswa') {
    return db.prepare(`${SELECT_NILAI} WHERE n.nim = ? ORDER BY n.id`).all(user.nim);
  }
  const kelas = ownedKelas(user, intParam(url.searchParams.get('kelas_id')));
  return db.prepare(`${SELECT_NILAI} WHERE n.kelas_id = ? ORDER BY n.id`).all(kelas.id);
}

function updateNilai(claims, id, body) {
  const user = currentUser(claims, 'dosen');
  const row = db.prepare('SELECT * FROM nilai WHERE id = ?').get(id);
  if (!row) throw httpError(404, 'data nilai tidak ditemukan');
  ownedKelas(user, row.kelas_id);
  if (row.final) throw httpError(409, 'nilai sudah final dan tidak dapat diubah');
  const v = body.nilai_angka;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
    throw httpError(400, 'nilai_angka harus berupa angka 0-100');
  }
  db.prepare('UPDATE nilai SET nilai_angka = ? WHERE id = ?').run(v, id);
  return { message: 'nilai diperbarui', id, nilai_angka: v };
}

async function finalisasi(claims, kelasId) {
  const user = currentUser(claims, 'dosen');
  const kelas = ownedKelas(user, kelasId);
  const rows = db.prepare('SELECT nim, nilai_angka FROM nilai WHERE kelas_id = ?').all(kelas.id);
  if (!rows.length) throw httpError(409, 'kelas belum memiliki nilai');
  if (db.prepare('SELECT 1 FROM nilai WHERE kelas_id = ? AND final = 1').get(kelas.id)) {
    throw httpError(409, 'kelas sudah difinalisasi');
  }
  db.prepare('UPDATE nilai SET final = 1 WHERE kelas_id = ?').run(kelas.id);
  try {
    const sync = await syncTranskrip({
      kelas_id: kelas.id, kode: kelas.kode, nama: kelas.nama, sks: kelas.sks,
      entries: rows.map((r) => ({ nim: r.nim, nilai_angka: r.nilai_angka })),
    });
    return { message: 'kelas difinalisasi dan dikirim ke transkrip', kelas_id: kelas.id, jumlah_nilai: rows.length, sinkron: sync };
  } catch (e) {
    db.prepare('UPDATE nilai SET final = 0 WHERE kelas_id = ?').run(kelas.id); // rollback
    throw httpError(502, `finalisasi dibatalkan: ${e.message}`);
  }
}

async function handle(req, res) {
  const claims = authenticate(req);                 // gateway secret + token
  const url = new URL(req.url, 'http://service');
  const seg = url.pathname.split('/').filter(Boolean);
  const body = parseJson(await readBody(req));

  if (req.method === 'GET' && seg.length === 1 && seg[0] === 'nilai') return sendJson(res, 200, listNilai(claims, url));
  if (req.method === 'PUT' && seg.length === 2 && seg[0] === 'nilai') {
    const id = intParam(seg[1]);
    if (!id) throw httpError(400, 'id tidak valid');
    return sendJson(res, 200, updateNilai(claims, id, body));
  }
  if (req.method === 'POST' && seg.length === 3 && seg[0] === 'kelas' && seg[2] === 'finalisasi') {
    const id = intParam(seg[1]);
    if (!id) throw httpError(400, 'id tidak valid');
    return sendJson(res, 200, await finalisasi(claims, id));
  }
  throw httpError(404, 'endpoint tidak ditemukan');
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : 'kesalahan internal service nilai' });
  });
}).listen(config.ports.nilai, config.HOST, () => {
  console.log(`[service-nilai] berjalan di http://${config.HOST}:${config.ports.nilai}`);
});
