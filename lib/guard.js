// Verifikasi ulang di sisi service (kebutuhan 4.1):
//  1) X-Gateway-Secret harus benar  -> service tidak bisa diakses langsung
//  2) access token / token service harus valid (tanda tangan + masa berlaku)
const config = require('../config');
const jwt = require('./jwt');
const { httpError, bearer, safeEqual } = require('./http');

function authenticate(req) {
  if (!safeEqual(req.headers['x-gateway-secret'], config.gatewaySecret)) {
    throw httpError(403, 'X-Gateway-Secret tidak valid: service hanya dapat diakses melalui gateway');
  }
  const token = bearer(req);
  if (!token) throw httpError(401, 'token tidak ada (gateway secret saja tidak cukup)');
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (e) {
    throw httpError(401, `token ditolak service: ${e.message}`);
  }
}

module.exports = { authenticate };
