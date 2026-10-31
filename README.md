# Sistem Nilai - Zero Trust Security

Tugas Praktikum Individu - Keamanan Informasi (KP70065004), Informatika Universitas Siliwangi.

Sistem Nilai dengan **API Gateway sebagai Policy Enforcement Point (PEP)** yang terpisah dari service,
mengikuti NIST SP 800-207. Prinsip: *never trust, always verify*, *least privilege*, *assume breach*.

```
Client (curl/Postman) --token + X-Device-ID--> API Gateway :3000 (PEP + Policy Engine/Administrator)
                                                   |--> Audit Log (tabel audit_log + stdout)
                                                   |--allow + X-Gateway-Secret--> Service Nilai     :3001
                                                   |--allow + X-Gateway-Secret--> Service Transkrip :3002
Service Nilai --(token service, lewat gateway)--> POST /transkrip/sinkron     (saat finalisasi)
Semua komponen membaca satu database SQLite bersama (data/sistem-nilai.db)
```

## Cara menjalankan

Prasyarat: **Node.js >= 22.13** (memakai `node:sqlite` dan `fetch` bawaan). **Tidak perlu `npm install`.**

```bash
npm start          # seed otomatis jika DB kosong, lalu jalankan gateway + 2 service
npm run seed       # reset database & isi ulang data awal (hentikan server dulu)
npm test           # tes otomatis end-to-end (55 skenario) pada port & DB sementara
```

Atau jalankan tiap komponen di terminal terpisah (berguna saat demo video):
`npm run start:nilai`, `npm run start:transkrip`, `npm run start:gateway`
(jalankan `npm run seed` sekali sebelumnya).

## Akun dan Device ID data awal

| Username | Password   | Role      | NIM              | Device ID (terdaftar) |
|----------|------------|-----------|------------------|-----------------------|
| admin    | admin123   | admin     | -                | DEV-ADMIN-01          |
| dosen1   | dosen123   | dosen     | -                | DEV-DOSEN1-01         |
| dosen2   | dosen123   | dosen     | -                | DEV-DOSEN2-01         |
| mhs1     | mhs123     | mahasiswa | 09021282025001   | DEV-MHS1-01           |
| mhs2     | mhs123     | mahasiswa | 09021282025002   | DEV-MHS2-01           |
| mhs3     | mhs123     | mahasiswa | 09021282025003   | DEV-MHS3-01           |

Kelas: **id 1** KP70065004 Keamanan Informasi (diampu `dosen1`), **id 2** IF70045002 Basis Data (diampu `dosen2`).
Setiap kelas berisi nilai 3 mahasiswa (belum final). Service client: `service-nilai` / `dev-service-client-secret`.

## Konfigurasi

- **Jam akses** (`policy-config.json`), dibaca ulang tiap request sehingga bisa diubah saat demo tanpa restart:
  ```json
  { "timezone": "Asia/Jakarta", "accessHours": { "start": "07:00", "end": "21:00" } }
  ```
  Contoh menutup akses: `"start": "00:00", "end": "00:00"`.
- Secret dan port lewat environment variable: `JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_CLIENT_ID`,
  `SERVICE_CLIENT_SECRET`, `GATEWAY_PORT`, `NILAI_PORT`, `TRANSKRIP_PORT`, `DB_PATH` (lihat `config.js`).

## Peta kebutuhan (bagian 4) -> kode

| Kebutuhan | Lokasi kode |
|-----------|-------------|
| Access token JWT 10 menit (`sub`, `role`), header Bearer | `gateway/auth.js` (`issueAccessToken`), `lib/jwt.js`, `config.js` |
| Refresh token 1 hari di DB, bisa dicabut; logout mencabut | `gateway/auth.js` (`login`, `refresh`, `logout`), tabel `refresh_tokens` (disimpan sebagai hash SHA-256) |
| Token service 5 menit dari `POST /auth/service` | `gateway/auth.js` (`serviceToken`); pemanggil: `service-nilai/server.js` (`getServiceToken`) |
| Gateway secret `X-Gateway-Secret` | Ditambahkan di `gateway/server.js` (`forward`), diperiksa di `lib/guard.js` |
| Verifikasi ulang token di service (tanda tangan + masa berlaku) | `lib/guard.js`, dipakai kedua service |
| Kebijakan akses Tabel 3 (kepemilikan data dibaca dari DB) | `gateway/policy.js` (`decide`) |
| Device terdaftar (`X-Device-ID`) | `gateway/policy.js` langkah 4; login di `gateway/auth.js` |
| Jam akses 07.00-21.00 dapat dikonfigurasi | `gateway/policy.js` (`inAccessHours`), `policy-config.json` |
| Audit log (waktu, subjek, endpoint, device, hasil, alasan) | `gateway/audit.js`, dipanggil di `gateway/server.js` |
| Finalisasi -> sinkron transkrip lewat gateway | `service-nilai/server.js` (`finalisasi`, `syncTranskrip`), `service-transkrip/server.js` (`sinkron`) |
| Pertahanan berlapis (assume breach): role & kepemilikan dicek ulang di service | `currentUser`, `ownedKelas` di service-nilai; `getTranskrip`, `sinkron` di service-transkrip |

## Contoh pengujian dengan curl

```bash
# Login (device wajib terdaftar)
curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -H 'X-Device-ID: DEV-DOSEN1-01' -d '{"username":"dosen1","password":"dosen123"}'
TOKEN=<isi access_token>

# Dosen melihat nilai kelasnya (allow) vs kelas dosen lain (deny)
curl -s 'localhost:3000/nilai?kelas_id=1' -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN1-01'
curl -s 'localhost:3000/nilai?kelas_id=2' -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN1-01'

# Ubah nilai & finalisasi
curl -s -X PUT localhost:3000/nilai/1 -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN1-01' \
  -H 'Content-Type: application/json' -d '{"nilai_angka":90}'
curl -s -X POST localhost:3000/kelas/1/finalisasi -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN1-01'

# Akses langsung ke service (harus ditolak)
curl -s localhost:3001/nilai
```

Melihat audit log (selain di terminal gateway):
`node --disable-warning=ExperimentalWarning -e "const d=require('./lib/db').open();console.table(d.prepare('SELECT waktu,subjek,endpoint,device,hasil,alasan FROM audit_log ORDER BY id DESC LIMIT 15').all())"`

## Pengujian dengan Postman / Thunder Client / VS Code

Folder `api-tests/` berisi:

- `sistem-nilai.postman_collection.json` - impor ke **Postman** (Import) atau **Thunder Client**
  (tab Collections, menu titik tiga, Import). Jalankan folder *1. Autentikasi* lebih dulu; token tersimpan
  otomatis ke variabel koleksi, lalu jalankan folder lain. Nama tiap request memuat hasil yang diharapkan (200/403/dst).
- `requests.http` - untuk **VS Code** dengan ekstensi *REST Client* (Huachao Mao). Buka file, klik
  "Send Request" di atas tiap baris `###`.

Catatan: finalisasi hanya bisa sekali per kelas. Untuk mengulang demo, hentikan server lalu `npm run seed`.

## Catatan desain

- **Tanpa dependensi eksternal.** Gateway, proxy, dan JWT HS256 diimplementasikan dengan modul bawaan Node
  (`node:http`, `node:crypto`, `node:sqlite`) karena framework bebas. Fokusnya mekanisme kontrol akses.
- **Default deny:** endpoint yang tidak ada di kebijakan ditolak; token service hanya boleh `POST /transkrip/sinkron`.
- **Role diambil dari database**, bukan hanya dari token; token yang role-nya tidak cocok dengan DB ditolak.
- **Finalisasi:** jika sinkron ke transkrip gagal, status final dikembalikan (rollback).
- **Keterbatasan:** JWT memakai HS256 dengan secret bersama, sehingga service yang bocor dapat menerbitkan token.
  Untuk produksi gunakan RS256/EdDSA, TLS/mTLS antar-komponen, dan rate limiting login.
