// API GATEWAY = Policy Enforcement Point (PEP). Satu-satunya pintu masuk (port 3000).
// Alur: terima request -> verifikasi token -> minta keputusan Policy Engine -> catat audit log
//       -> jika allow, teruskan ke service dengan X-Gateway-Secret.
const http = require('http');
const config = require('../config');
const jwt = require('../lib/jwt');
const dbLib = require('../lib/db');
const { readBody, parseJson, sendJson, bearer } = require('../lib/http');
const { createAudit } = require('./audit');
const { decide } = require('./policy');
const auth = require('./auth');

const db = dbLib.open();
const audit = createAudit(db);

const normalize = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

// Meneruskan request ke service. Header X-Gateway-Secret SELALU ditimpa oleh gateway.
async function forward(req, res, body, target) {
  const headers = { 'x-gateway-secret': config.gatewaySecret };
  for (const h of ['authorization', 'content-type', 'x-device-id']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  try {
    const upstream = await fetch(target + req.url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      signal: AbortSignal.timeout(10_000),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(buf);
  } catch (e) {
    sendJson(res, 502, { error: 'service tidak dapat dihubungi', detail: e.message });
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://gateway');
  const pathname = normalize(url.pathname);
  const method = req.method;
  const deviceId = req.headers['x-device-id'];
  const body = await readBody(req);

  // --- Endpoint /auth/* ditangani gateway sendiri ---
  if (pathname.startsWith('/auth/')) {
    let result;
    if (method !== 'POST') {
      result = { allow: false, status: 405, subject: null, reason: 'endpoint auth hanya menerima POST', body: { error: 'metode tidak diizinkan' } };
    } else {
      result = auth.handle(db, pathname, parseJson(body), deviceId);
    }
    audit({ subject: result.subject, method, pathname, device: deviceId, allowed: result.allow, reason: result.reason });
    return sendJson(res, result.status, result.body);
  }

  // --- Endpoint lain: verifikasi token -> Policy Engine -> audit -> proxy ---
  let claims = null, tokenError = null;
  const token = bearer(req);
  if (!token) tokenError = 'access token tidak ada';
  else {
    try { claims = jwt.verify(token, config.jwtSecret); }
    catch (e) { tokenError = `token ditolak: ${e.message}`; }
  }

  const decision = decide(db, { method, pathname, query: url.searchParams, claims, tokenError, deviceId });
  audit({ subject: decision.subject, method, pathname, device: deviceId, allowed: decision.allow, reason: decision.reason });

  if (!decision.allow) return sendJson(res, decision.status, { error: 'akses ditolak', alasan: decision.reason });

  const target = pathname.startsWith('/transkrip') ? config.transkripUrl : config.nilaiUrl;
  return forward(req, res, body, target);
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : 'kesalahan internal gateway' });
  });
}).listen(config.ports.gateway, config.HOST, () => {
  console.log(`[gateway] PEP berjalan di http://${config.HOST}:${config.ports.gateway}`);
});
