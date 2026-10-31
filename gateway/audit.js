// Audit log (kebutuhan 4.4): setiap keputusan akses dicatat ke tabel audit_log
// dan ke stdout. Kolom: waktu, subjek, endpoint, device, hasil, alasan.
function createAudit(db) {
  const insert = db.prepare(
    'INSERT INTO audit_log(waktu, subjek, endpoint, device, hasil, alasan) VALUES (?,?,?,?,?,?)'
  );
  return function record({ subject, method, pathname, device, allowed, reason }) {
    const entry = {
      waktu: new Date().toISOString(),
      subjek: subject || 'anonymous',
      endpoint: `${method} ${pathname}`,
      device: device || '-',
      hasil: allowed ? 'allow' : 'deny',
      alasan: reason,
    };
    insert.run(entry.waktu, entry.subjek, entry.endpoint, entry.device, entry.hasil, entry.alasan);
    console.log(`[AUDIT] ${entry.waktu} | ${entry.subjek} | ${entry.endpoint} | dev=${entry.device} | ${entry.hasil.toUpperCase()} | ${entry.alasan}`);
  };
}
module.exports = { createAudit };
