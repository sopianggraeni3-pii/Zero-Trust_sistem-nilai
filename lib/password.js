const crypto = require('crypto');

function hash(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(plain, salt, 32).toString('hex')}`;
}
function verify(plain, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const given = crypto.scryptSync(String(plain), salt, 32);
  const expected = Buffer.from(key, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

module.exports = { hash, verify, sha256 };
