// Tes end-to-end: menjalankan seluruh sistem pada port & database sementara, lalu menguji kebijakan.
// Jalankan: npm test
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nilai-test-'));
const env = {
  ...process.env,
  DB_PATH: path.join(tmp, 'test.db'),
  POLICY_CONFIG: path.join(tmp, 'policy.json'),
  GATEWAY_PORT: '13000', NILAI_PORT: '13001', TRANSKRIP_PORT: '13002',
};
Object.assign(process.env, env); // agar require('../config') memakai nilai yang sama

const config = require('../config');
const jwt = require('../lib/jwt');
const GW = config.gatewayUrl, NILAI = config.nilaiUrl, TRANSKRIP = config.transkripUrl;
const NIM = { 1: '09021282025001', 2: '09021282025002', 3: '09021282025003' };

const setHours = (start, end) => fs.writeFileSync(env.POLICY_CONFIG, JSON.stringify({ timezone: 'Asia/Jakarta', accessHours: { start, end } }));
const open = () => setHours('00:00', '24:00');
const closed = () => setHours('00:00', '00:00');

async function call(base, method, p, { token, device, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const gw = (m, p, o) => call(GW, m, p, o);
const login = async (u, p, d) => (await gw('POST', '/auth/login', { body: { username: u, password: p }, device: d }));

let pass = 0, failN = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failN++; console.log(`  FAIL  ${name} ${extra}`); }
}
const expect = (name, res, status, reasonPart) =>
  check(name, res.status === status && (!reasonPart || JSON.stringify(res.body).includes(reasonPart)),
    `(dapat ${res.status} ${JSON.stringify(res.body)})`);

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(GW + '/'); await fetch(NILAI + '/'); await fetch(TRANSKRIP + '/'); return; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('server tidak siap');
}

async function main() {
  open();
  const run = (args) => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  const seedP = run([path.join(__dirname, '..', 'seed.js'), '--reset']);
  await new Promise((r) => seedP.on('exit', r));
  const procs = ['service-nilai', 'service-transkrip', 'gateway'].map((n) => run([path.join(__dirname, '..', n, 'server.js')]));
  try {
    await waitReady();

    console.log('\n== 4.1 Autentikasi & token ==');
    const mhs1 = await login('mhs1', 'mhs123', 'DEV-MHS1-01');
    expect('login valid -> 200 + access & refresh token', mhs1, 200);
    const mt = mhs1.body.access_token;
    const claims = JSON.parse(Buffer.from(mt.split('.')[1], 'base64url'));
    check('access token berlaku 10 menit & memuat sub + role', claims.exp - claims.iat === 600 && claims.sub && claims.role === 'mahasiswa');
    expect('login password salah -> 401', await login('mhs1', 'salah', 'DEV-MHS1-01'), 401, 'kredensial');
    expect('login device tidak terdaftar -> 403', await login('mhs1', 'mhs123', 'DEV-MHS2-01'), 403, 'device');
    expect('login tanpa X-Device-ID -> 403', await login('mhs1', 'mhs123', undefined), 403, 'device');
    expect('tanpa token -> 401', await gw('GET', '/nilai', { device: 'DEV-MHS1-01' }), 401);
    expect('token dirusak -> 401', await gw('GET', '/nilai', { token: mt.slice(0, -3) + 'abc', device: 'DEV-MHS1-01' }), 401, 'tanda tangan');
    const expired = jwt.sign({ sub: '4', role: 'mahasiswa' }, config.jwtSecret, -10);
    expect('token kedaluwarsa -> 401', await gw('GET', '/nilai', { token: expired, device: 'DEV-MHS1-01' }), 401, 'kedaluwarsa');
    const forged = jwt.sign({ sub: '1', role: 'admin' }, 'secret-palsu', 600);
    expect('token dengan secret palsu -> 401', await gw('GET', '/nilai', { token: forged, device: 'DEV-ADMIN-01' }), 401);

    const svc = await gw('POST', '/auth/service', { body: { client_id: 'service-nilai', client_secret: 'dev-service-client-secret' } });
    expect('token service valid -> 200', svc, 200);
    const sc = JSON.parse(Buffer.from(svc.body.access_token.split('.')[1], 'base64url'));
    check('token service berlaku 5 menit, role: service', sc.exp - sc.iat === 300 && sc.role === 'service');
    expect('token service secret salah -> 401', await gw('POST', '/auth/service', { body: { client_id: 'service-nilai', client_secret: 'salah' } }), 401);

    const rf = mhs1.body.refresh_token;
    expect('refresh token valid -> access token baru', await gw('POST', '/auth/refresh', { body: { refresh_token: rf } }), 200);
    expect('logout -> 200', await gw('POST', '/auth/logout', { body: { refresh_token: rf } }), 200);
    expect('refresh setelah logout (dicabut) -> 401', await gw('POST', '/auth/refresh', { body: { refresh_token: rf } }), 401, 'dicabut');

    console.log('\n== Gateway secret & verifikasi ulang di service ==');
    expect('akses langsung service nilai tanpa secret -> 403', await call(NILAI, 'GET', '/nilai', { token: mt }), 403, 'Gateway-Secret');
    expect('akses langsung service transkrip tanpa secret -> 403', await call(TRANSKRIP, 'GET', `/transkrip/${NIM[1]}`, { token: mt }), 403);
    expect('secret benar tapi tanpa token -> 401', await call(NILAI, 'GET', '/nilai', { headers: { 'X-Gateway-Secret': config.gatewaySecret } }), 401);
    expect('secret benar + token palsu -> 401', await call(NILAI, 'GET', '/nilai', { token: forged, headers: { 'X-Gateway-Secret': config.gatewaySecret } }), 401);
    expect('secret benar + token kedaluwarsa -> 401', await call(NILAI, 'GET', '/nilai', { token: expired, headers: { 'X-Gateway-Secret': config.gatewaySecret } }), 401);
    expect('bypass gateway: service tetap menolak mahasiswa mengubah nilai -> 403',
      await call(NILAI, 'PUT', '/nilai/1', { token: mt, body: { nilai_angka: 100 }, headers: { 'X-Gateway-Secret': config.gatewaySecret } }), 403);
    expect('bypass gateway: service transkrip menolak token user di /sinkron -> 403',
      await call(TRANSKRIP, 'POST', '/transkrip/sinkron', { token: mt, body: {}, headers: { 'X-Gateway-Secret': config.gatewaySecret } }), 403);
    expect('header X-Gateway-Secret dari client tidak berpengaruh di gateway',
      await gw('GET', '/nilai', { device: 'DEV-MHS1-01', headers: { 'X-Gateway-Secret': config.gatewaySecret } }), 401);

    console.log('\n== 4.2 Kebijakan akses ==');
    const t = {};
    for (const [k, u, p, d] of [['mhs1', 'mhs1', 'mhs123', 'DEV-MHS1-01'], ['mhs2', 'mhs2', 'mhs123', 'DEV-MHS2-01'],
      ['d1', 'dosen1', 'dosen123', 'DEV-DOSEN1-01'], ['d2', 'dosen2', 'dosen123', 'DEV-DOSEN2-01'], ['admin', 'admin', 'admin123', 'DEV-ADMIN-01']]) {
      t[k] = (await login(u, p, d)).body.access_token;
    }
    let r = await gw('GET', '/nilai', { token: t.mhs1, device: 'DEV-MHS1-01' });
    check('GET /nilai mahasiswa -> hanya nilai miliknya', r.status === 200 && r.body.length === 2 && r.body.every((x) => x.nim === NIM[1]));
    expect('GET /nilai?nim=milik orang lain -> 403', await gw('GET', `/nilai?nim=${NIM[2]}`, { token: t.mhs1, device: 'DEV-MHS1-01' }), 403);
    expect('token mhs1 dengan device milik mhs2 -> 403', await gw('GET', '/nilai', { token: t.mhs1, device: 'DEV-MHS2-01' }), 403, 'device');
    r = await gw('GET', '/nilai?kelas_id=1', { token: t.d1, device: 'DEV-DOSEN1-01' });
    check('dosen1 melihat kelas 1 (diampu) -> 3 nilai', r.status === 200 && r.body.length === 3);
    expect('dosen1 melihat kelas 2 (bukan miliknya) -> 403', await gw('GET', '/nilai?kelas_id=2', { token: t.d1, device: 'DEV-DOSEN1-01' }), 403, 'diampu');
    expect('admin GET /nilai -> 403', await gw('GET', '/nilai', { token: t.admin, device: 'DEV-ADMIN-01' }), 403);

    console.log('\n== PUT nilai / finalisasi (jam akses diatur lewat config) ==');
    open();
    expect('mahasiswa PUT /nilai -> 403', await gw('PUT', '/nilai/1', { token: t.mhs1, device: 'DEV-MHS1-01', body: { nilai_angka: 100 } }), 403);
    expect('dosen2 PUT nilai kelas dosen1 -> 403', await gw('PUT', '/nilai/1', { token: t.d2, device: 'DEV-DOSEN2-01', body: { nilai_angka: 100 } }), 403, 'diampu');
    expect('dosen1 PUT nilai kelasnya (dalam jam akses) -> 200', await gw('PUT', '/nilai/1', { token: t.d1, device: 'DEV-DOSEN1-01', body: { nilai_angka: 90 } }), 200);
    expect('nilai_angka tidak valid -> 400', await gw('PUT', '/nilai/1', { token: t.d1, device: 'DEV-DOSEN1-01', body: { nilai_angka: 500 } }), 400);
    closed();
    expect('dosen1 PUT di luar jam akses -> 403', await gw('PUT', '/nilai/1', { token: t.d1, device: 'DEV-DOSEN1-01', body: { nilai_angka: 91 } }), 403, 'jam akses');
    expect('dosen1 finalisasi di luar jam akses -> 403', await gw('POST', '/kelas/1/finalisasi', { token: t.d1, device: 'DEV-DOSEN1-01' }), 403, 'jam akses');
    open();
    expect('mahasiswa finalisasi -> 403', await gw('POST', '/kelas/1/finalisasi', { token: t.mhs1, device: 'DEV-MHS1-01' }), 403);
    expect('dosen2 finalisasi kelas dosen1 -> 403', await gw('POST', '/kelas/1/finalisasi', { token: t.d2, device: 'DEV-DOSEN2-01' }), 403, 'diampu');
    expect('transkrip belum berisi sebelum finalisasi', await gw('GET', `/transkrip/${NIM[1]}`, { token: t.mhs1, device: 'DEV-MHS1-01' }), 200);
    r = await gw('GET', `/transkrip/${NIM[1]}`, { token: t.mhs1, device: 'DEV-MHS1-01' });
    check('  (transkrip masih kosong)', r.body.mata_kuliah.length === 0);
    r = await gw('POST', '/kelas/1/finalisasi', { token: t.d1, device: 'DEV-DOSEN1-01' });
    expect('dosen1 finalisasi kelas 1 -> 200 + sinkron transkrip', r, 200, 'transkrip disinkronkan');
    expect('PUT setelah final -> 409', await gw('PUT', '/nilai/1', { token: t.d1, device: 'DEV-DOSEN1-01', body: { nilai_angka: 50 } }), 409, 'final');
    expect('finalisasi ulang -> 409', await gw('POST', '/kelas/1/finalisasi', { token: t.d1, device: 'DEV-DOSEN1-01' }), 409);

    console.log('\n== Transkrip ==');
    r = await gw('GET', `/transkrip/${NIM[1]}`, { token: t.mhs1, device: 'DEV-MHS1-01' });
    check('mahasiswa melihat transkrip sendiri (berisi nilai final 90 -> A)', r.status === 200 && r.body.mata_kuliah[0]?.nilai_angka === 90 && r.body.mata_kuliah[0].huruf === 'A' && r.body.ipk === 4);
    expect('mahasiswa melihat transkrip NIM lain -> 403', await gw('GET', `/transkrip/${NIM[2]}`, { token: t.mhs1, device: 'DEV-MHS1-01' }), 403, 'NIM sendiri');
    expect('admin melihat transkrip semua NIM -> 200', await gw('GET', `/transkrip/${NIM[2]}`, { token: t.admin, device: 'DEV-ADMIN-01' }), 200);
    expect('dosen melihat transkrip -> 403', await gw('GET', `/transkrip/${NIM[1]}`, { token: t.d1, device: 'DEV-DOSEN1-01' }), 403);
    expect('POST /transkrip/sinkron token admin -> 403', await gw('POST', '/transkrip/sinkron', { token: t.admin, device: 'DEV-ADMIN-01', body: {} }), 403, 'token service');
    expect('POST /transkrip/sinkron token dosen -> 403', await gw('POST', '/transkrip/sinkron', { token: t.d1, device: 'DEV-DOSEN1-01', body: {} }), 403);
    const payload = { kelas_id: 2, kode: 'IF70045002', nama: 'Basis Data', sks: 3, entries: [{ nim: NIM[1], nilai_angka: 72 }] };
    expect('POST /transkrip/sinkron token service -> 200', await gw('POST', '/transkrip/sinkron', { token: svc.body.access_token, body: payload }), 200);
    expect('token service GET /nilai -> 403', await gw('GET', '/nilai', { token: svc.body.access_token }), 403, 'token service');
    expect('token service GET /transkrip -> 403', await gw('GET', `/transkrip/${NIM[1]}`, { token: svc.body.access_token }), 403);
    expect('endpoint tidak dikenal -> default deny', await gw('GET', '/admin/rahasia', { token: t.admin, device: 'DEV-ADMIN-01' }), 404, 'default deny');

    console.log('\n== 4.4 Audit log ==');
    const { open: openDb } = require('../lib/db');
    const db = openDb();
    const rows = db.prepare('SELECT * FROM audit_log').all();
    check('audit log mencatat allow & deny', rows.some((x) => x.hasil === 'allow') && rows.some((x) => x.hasil === 'deny'));
    check('audit log berisi waktu, subjek, endpoint, device, hasil, alasan', rows.every((x) => x.waktu && x.subjek && x.endpoint && x.device && x.hasil && x.alasan));
    check('audit log mencatat subjek service', rows.some((x) => x.subjek === 'service-nilai'));
    db.close();
  } finally {
    procs.forEach((p) => p.kill());
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nHasil: ${pass} lulus, ${failN} gagal`);
  process.exit(failN ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
