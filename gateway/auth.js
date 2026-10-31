// Bagian Policy Administrator (PA): login, refresh, logout, token service.
// Handler ini dipanggil oleh gateway untuk semua endpoint /auth/*.
const config = require("../config");
const jwt = require("../lib/jwt");
const pw = require("../lib/password");
const crypto = require("crypto");

const DUMMY_HASH = pw.hash("dummy-untuk-menyamakan-waktu");
const nowSec = () => Math.floor(Date.now() / 1000);
const fail = (subject, status, reason) => ({
  allow: false,
  status,
  subject,
  reason,
  body: { error: "akses ditolak", alasan: reason },
});
const ok = (subject, reason, body) => ({
  allow: true,
  status: 200,
  subject,
  reason,
  body,
});

function issueAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role },
    config.jwtSecret,
    config.accessTokenTtl,
  );
}

// POST /auth/login  -> kredensial valid + device terdaftar
function login(db, body, deviceId) {
  const { username, password } = body;
  const user =
    typeof username === "string"
      ? db.prepare("SELECT * FROM users WHERE username = ?").get(username)
      : null;
  const passOk = pw.verify(
    String(password ?? ""),
    user ? user.password_hash : DUMMY_HASH,
  );
  if (!user || !passOk)
    return fail(username || null, 401, "kredensial tidak valid");

  const dev =
    deviceId &&
    db
      .prepare("SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?")
      .get(user.id, deviceId);
  if (!dev)
    return fail(user.username, 403, "device tidak terdaftar untuk user ini");

  const refreshToken = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO refresh_tokens(token_hash, user_id, expires_at) VALUES (?,?,?)",
  ).run(pw.sha256(refreshToken), user.id, nowSec() + config.refreshTokenTtl);

  return ok(
    user.username,
    "login berhasil: kredensial valid dan device terdaftar",
    {
      access_token: issueAccessToken(user),
      token_type: "Bearer",
      expires_in: config.accessTokenTtl,
      refresh_token: refreshToken,
      refresh_expires_in: config.refreshTokenTtl,
    },
  );
}

function findValidRefresh(db, token) {
  if (typeof token !== "string" || !token)
    return { error: "refresh token tidak ada" };
  const row = db
    .prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
    .get(pw.sha256(token));
  if (!row) return { error: "refresh token tidak dikenal" };
  if (row.revoked) return { error: "refresh token sudah dicabut", row };
  if (row.expires_at <= nowSec())
    return { error: "refresh token sudah kedaluwarsa", row };
  return { row };
}

// POST /auth/refresh -> access token baru jika refresh token valid & belum dicabut
function refresh(db, body) {
  const { row, error } = findValidRefresh(db, body.refresh_token);
  if (error) return fail(null, 401, error);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  if (!user) return fail(null, 401, "user tidak ditemukan");
  return ok(user.username, "access token diperbarui", {
    access_token: issueAccessToken(user),
    token_type: "Bearer",
    expires_in: config.accessTokenTtl,
  });
}

// POST /auth/logout -> mencabut refresh token
function logout(db, body) {
  const { row, error } = findValidRefresh(db, body.refresh_token);
  if (error) return fail(null, 401, error);
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?").run(row.id);
  const user = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(row.user_id);
  return ok(user ? user.username : null, "logout: refresh token dicabut", {
    message: "logout berhasil, refresh token dicabut",
  });
}

// POST /auth/service -> token service (role: service, 5 menit) untuk Service Nilai
function serviceToken(db, body) {
  const { client_id: id, client_secret: secret } = body;
  const client =
    typeof id === "string"
      ? db.prepare("SELECT * FROM service_clients WHERE client_id = ?").get(id)
      : null;
  const valid = pw.verify(
    String(secret ?? ""),
    client ? client.secret_hash : DUMMY_HASH,
  );
  if (!client || !valid)
    return fail(id || null, 401, "client id atau secret tidak valid");
  const token = jwt.sign(
    { sub: client.client_id, role: "service" },
    config.jwtSecret,
    config.serviceTokenTtl,
  );
  return ok(client.client_id, "token service diterbitkan", {
    access_token: token,
    token_type: "Bearer",
    expires_in: config.serviceTokenTtl,
  });
}

const routes = {
  "/auth/login": login,
  "/auth/refresh": refresh,
  "/auth/logout": logout,
  "/auth/service": serviceToken,
};

function handle(db, pathname, body, deviceId) {
  const fn = routes[pathname];
  if (!fn) return fail(null, 404, "endpoint auth tidak dikenal (default deny)");
  return fn(db, body, deviceId);
}

module.exports = { handle };
