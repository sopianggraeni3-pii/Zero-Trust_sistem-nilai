// Satu database SQLite bersama untuk gateway, Service Nilai, dan Service Transkrip.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  nama TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('mahasiswa','dosen','admin')), nim TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS devices(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL, UNIQUE(user_id, device_id));
CREATE TABLE IF NOT EXISTS kelas(
  id INTEGER PRIMARY KEY, kode TEXT NOT NULL, nama TEXT NOT NULL, sks INTEGER NOT NULL DEFAULT 3,
  dosen_id INTEGER NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS nilai(
  id INTEGER PRIMARY KEY, kelas_id INTEGER NOT NULL REFERENCES kelas(id), nim TEXT NOT NULL,
  nilai_angka REAL NOT NULL, final INTEGER NOT NULL DEFAULT 0, UNIQUE(kelas_id, nim));
CREATE TABLE IF NOT EXISTS refresh_tokens(
  id INTEGER PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS service_clients(client_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transkrip(
  id INTEGER PRIMARY KEY, nim TEXT NOT NULL, kelas_id INTEGER NOT NULL, kode TEXT, nama_mk TEXT,
  sks INTEGER NOT NULL, nilai_angka REAL NOT NULL, huruf TEXT NOT NULL, bobot REAL NOT NULL,
  synced_at TEXT NOT NULL, UNIQUE(nim, kelas_id));
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, waktu TEXT NOT NULL, subjek TEXT, endpoint TEXT NOT NULL,
  device TEXT, hasil TEXT NOT NULL, alasan TEXT);
`;

function open() {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

const userBySub = (db, sub) => {
  const id = Number(sub);
  return Number.isInteger(id) ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : undefined;
};

module.exports = { open, userBySub };
