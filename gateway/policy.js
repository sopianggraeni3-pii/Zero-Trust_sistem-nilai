// POLICY ENGINE (PE) - memutuskan allow/deny beserta alasan.
// Kebijakan mengikuti Tabel 3 + verifikasi konteks (4.3). Kebijakan berbasis kepemilikan data
// (kelas yang diampu, NIM sendiri) tidak bisa diputuskan dari isi token, sehingga atributnya
// dibaca dari database. Prinsip: DEFAULT DENY.
const config = require('../config');
const { userBySub } = require('../lib/db');

const allow = (subject, reason) => ({ allow: true, status: 200, subject, reason });
const deny = (subject, status, reason) => ({ allow: false, status, subject, reason });
const toInt = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null);

// ---- Verifikasi konteks: jam akses (dapat diatur di policy-config.json) ----
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}
function inAccessHours(now, cfg) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const cur = Number(parts.find((p) => p.type === 'hour').value) * 60 +
              Number(parts.find((p) => p.type === 'minute').value);
  const start = toMinutes(cfg.accessHours.start);
  const end = toMinutes(cfg.accessHours.end);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}
const hoursText = (cfg) => `${cfg.accessHours.start}-${cfg.accessHours.end} ${cfg.timezone}`;

/**
 * @param db   koneksi database (untuk membaca atribut user/kelas/nilai)
 * @param req  { method, pathname, query (URLSearchParams), claims | null, tokenError, deviceId }
 * @returns    { allow, status, subject, reason }
 */
function decide(db, req, now = new Date()) {
  const { method, pathname, query, claims, tokenError, deviceId } = req;

  // 1. Autentikasi: token wajib valid
  if (!claims) return deny(null, 401, tokenError || 'access token tidak ada');

  // 2. Token service: hanya boleh ke POST /transkrip/sinkron (least privilege)
  if (claims.role === 'service') {
    if (method === 'POST' && pathname === '/transkrip/sinkron') {
      return allow(claims.sub, 'token service valid untuk sinkron transkrip');
    }
    return deny(claims.sub, 403, 'token service hanya boleh mengakses POST /transkrip/sinkron');
  }

  // 3. Atribut user dari database (role di DB menjadi acuan, bukan sekadar isi token)
  const user = userBySub(db, claims.sub);
  if (!user) return deny(String(claims.sub), 401, 'user pada token tidak ditemukan');
  const subject = user.username;
  if (user.role !== claims.role) return deny(subject, 401, 'role pada token tidak sesuai database');

  // 4. Verifikasi konteks: device terdaftar
  if (!deviceId) return deny(subject, 403, 'header X-Device-ID tidak ada');
  const dev = db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?').get(user.id, deviceId);
  if (!dev) return deny(subject, 403, 'device tidak terdaftar untuk user ini');

  // 5. Kebijakan per endpoint (Tabel 3)
  const seg = pathname.split('/').filter(Boolean);

  // GET /nilai  -> mahasiswa (miliknya) / dosen (kelas yang diampu)
  if (method === 'GET' && seg.length === 1 && seg[0] === 'nilai') {
    if (user.role === 'mahasiswa') {
      const nim = query.get('nim');
      if (nim && nim !== user.nim) return deny(subject, 403, 'mahasiswa hanya boleh melihat nilai miliknya sendiri');
      return allow(subject, 'mahasiswa melihat nilai miliknya sendiri');
    }
    if (user.role === 'dosen') {
      const kelasId = toInt(query.get('kelas_id'));
      if (!kelasId) return deny(subject, 400, 'dosen wajib menyertakan parameter kelas_id');
      const kelas = db.prepare('SELECT dosen_id FROM kelas WHERE id = ?').get(kelasId);
      if (!kelas) return deny(subject, 404, 'kelas tidak ditemukan');
      if (kelas.dosen_id !== user.id) return deny(subject, 403, 'kelas bukan kelas yang diampu dosen ini');
      return allow(subject, 'dosen melihat nilai kelas yang diampunya');
    }
    return deny(subject, 403, `role ${user.role} tidak berhak melihat nilai`);
  }

  // PUT /nilai/:id  -> dosen, kelas diampu, belum final, dalam jam akses
  if (method === 'PUT' && seg.length === 2 && seg[0] === 'nilai') {
    if (user.role !== 'dosen') return deny(subject, 403, `role ${user.role} tidak berhak mengubah nilai`);
    const id = toInt(seg[1]);
    const row = id && db.prepare(
      'SELECT n.final, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?').get(id);
    if (!row) return deny(subject, 404, 'data nilai tidak ditemukan');
    if (row.dosen_id !== user.id) return deny(subject, 403, 'nilai ini bukan milik kelas yang diampu dosen ini');
    if (row.final) return deny(subject, 409, 'nilai sudah final dan tidak dapat diubah');
    const cfg = config.loadPolicyConfig();
    if (!inAccessHours(now, cfg)) return deny(subject, 403, `di luar jam akses (${hoursText(cfg)})`);
    return allow(subject, 'dosen mengubah nilai kelas yang diampu, belum final, dalam jam akses');
  }

  // POST /kelas/:id/finalisasi  -> dosen, kelas diampu, dalam jam akses
  if (method === 'POST' && seg.length === 3 && seg[0] === 'kelas' && seg[2] === 'finalisasi') {
    if (user.role !== 'dosen') return deny(subject, 403, `role ${user.role} tidak berhak memfinalisasi nilai`);
    const id = toInt(seg[1]);
    const kelas = id && db.prepare('SELECT dosen_id FROM kelas WHERE id = ?').get(id);
    if (!kelas) return deny(subject, 404, 'kelas tidak ditemukan');
    if (kelas.dosen_id !== user.id) return deny(subject, 403, 'kelas bukan kelas yang diampu dosen ini');
    const cfg = config.loadPolicyConfig();
    if (!inAccessHours(now, cfg)) return deny(subject, 403, `di luar jam akses (${hoursText(cfg)})`);
    return allow(subject, 'dosen memfinalisasi kelas yang diampu dalam jam akses');
  }

  // POST /transkrip/sinkron  -> hanya token service; token user mana pun ditolak
  if (method === 'POST' && pathname === '/transkrip/sinkron') {
    return deny(subject, 403, 'endpoint sinkron hanya untuk token service, token user ditolak');
  }

  // GET /transkrip/:nim  -> mahasiswa (NIM sendiri) / admin (semua)
  if (method === 'GET' && seg.length === 2 && seg[0] === 'transkrip') {
    if (user.role === 'admin') return allow(subject, 'admin melihat transkrip');
    if (user.role === 'mahasiswa') {
      if (seg[1] !== user.nim) return deny(subject, 403, 'mahasiswa hanya boleh melihat transkrip NIM sendiri');
      return allow(subject, 'mahasiswa melihat transkrip sendiri');
    }
    return deny(subject, 403, `role ${user.role} tidak berhak melihat transkrip`);
  }

  // Default deny
  return deny(subject, 404, 'endpoint tidak dikenal (default deny)');
}

module.exports = { decide, inAccessHours };
