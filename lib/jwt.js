// Implementasi JWT HS256 minimal memakai node:crypto (tanpa dependensi).
const crypto = require('crypto');

const b64 = (v) => Buffer.from(v).toString('base64url');
const hmac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest();

function sign(payload, secret, expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec, jti: crypto.randomUUID() };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64(JSON.stringify(body))}`;
  return `${data}.${hmac(data, secret).toString('base64url')}`;
}

// Melempar Error dengan pesan yang menjelaskan alasan penolakan.
function verify(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('format token tidak valid');
  const [h, p, s] = parts;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    throw new Error('format token tidak valid');
  }
  if (header.alg !== 'HS256') throw new Error('algoritma token tidak didukung'); // tolak alg:none
  const expected = hmac(`${h}.${p}`, secret);
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error('tanda tangan token tidak valid');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('token sudah kedaluwarsa');
  }
  if (!payload.sub || !payload.role) throw new Error('klaim sub/role tidak lengkap');
  return payload;
}

module.exports = { sign, verify };
