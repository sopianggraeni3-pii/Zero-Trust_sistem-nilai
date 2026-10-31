// Konfigurasi terpusat. Semua nilai dapat di-override lewat environment variable.
const fs = require("fs");
const path = require("path");
const env = process.env;

const ports = {
  gateway: Number(env.GATEWAY_PORT) || 3000,
  nilai: Number(env.NILAI_PORT) || 3001,
  transkrip: Number(env.TRANSKRIP_PORT) || 3002,
};
const HOST = env.HOST || "127.0.0.1";

const DEFAULT_POLICY = {
  timezone: "Asia/Jakarta",
  accessHours: { start: "07:00", end: "21:00" },
};
const policyConfigPath =
  env.POLICY_CONFIG || path.join(__dirname, "policy-config.json");

module.exports = {
  HOST,
  ports,
  gatewayUrl: env.GATEWAY_URL || `http://${HOST}:${ports.gateway}`,
  nilaiUrl: env.NILAI_URL || `http://${HOST}:${ports.nilai}`,
  transkripUrl: env.TRANSKRIP_URL || `http://${HOST}:${ports.transkrip}`,
  dbPath: env.DB_PATH || path.join(__dirname, "data", "sistem-nilai.db"),

  // CATATAN: nilai default ini hanya untuk demo lokal. Ganti lewat env di lingkungan nyata.
  jwtSecret: env.JWT_SECRET || "dev-jwt-secret-ganti-di-produksi",
  gatewaySecret: env.GATEWAY_SECRET || "dev-gateway-secret-ganti-di-produksi",
  serviceClient: {
    id: env.SERVICE_CLIENT_ID || "service-nilai",
    secret: env.SERVICE_CLIENT_SECRET || "dev-service-client-secret",
  },

  accessTokenTtl: 10 * 60, // 10 menit
  refreshTokenTtl: 24 * 60 * 60, // 1 hari
  serviceTokenTtl: 5 * 60, // 5 menit

  policyConfigPath,
  // Dibaca ulang pada setiap request supaya jam akses bisa diubah saat demo tanpa restart.
  loadPolicyConfig() {
    try {
      const c = JSON.parse(fs.readFileSync(policyConfigPath, "utf8"));
      return {
        timezone: c.timezone || DEFAULT_POLICY.timezone,
        accessHours: {
          ...DEFAULT_POLICY.accessHours,
          ...(c.accessHours || {}),
        },
      };
    } catch {
      return DEFAULT_POLICY;
    }
  },
};
