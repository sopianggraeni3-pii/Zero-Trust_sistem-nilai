const crypto = require('crypto');

const httpError = (status, message) => Object.assign(new Error(message), { status });

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'body terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(buf) {
  if (!buf || !buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw httpError(400, 'body bukan JSON yang valid'); }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
  return m ? m[1].trim() : null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { httpError, readBody, parseJson, sendJson, bearer, safeEqual };
