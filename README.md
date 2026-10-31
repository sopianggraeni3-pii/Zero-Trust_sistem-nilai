# Sistem Nilai - Zero Trust Security

Repositori ini berisi implementasi Tugas Praktikum Individu untuk mata kuliah Keamanan Informasi, program studi Informatika, Universitas Siliwangi.

Proyek ini mensimulasikan sebuah Sistem Nilai akademik yang menerapkan arsitektur **Zero Trust Security** berdasarkan panduan NIST SP 800-207. Implementasi utama difokuskan pada penggunaan **API Gateway sebagai Policy Enforcement Point (PEP)** yang berdiri terpisah dari microservices di belakangnya. Sistem dirancang dengan berpegang pada prinsip: _never trust_, _always verify_, _least privilege_, dan _assume breach_.

```
Client (curl/Postman) --token + X-Device-ID--> API Gateway :3000 (PEP + Policy Engine/Administrator)
                                                   |--> Audit Log (tabel audit_log + stdout)
                                                   |--allow + X-Gateway-Secret--> Service Nilai     :3001
                                                   |--allow + X-Gateway-Secret--> Service Transkrip :3002
Service Nilai --(token service, lewat gateway)--> POST /transkrip/sinkron     (saat finalisasi)
Semua komponen membaca satu database SQLite bersama (data/sistem-nilai.db)
```

## Cara menjalankan

Prasyarat & Setup Lingkungan:
Untuk meminimalkan dependensi eksternal dan mendemonstrasikan pemahaman konsep inti (bukan sekadar menggunakan library jadi), proyek ini dibangun murni menggunakan fitur bawaan Node.js.

- Syarat Sistem: Membutuhkan Node.js versi >= 22.13 (karena memanfaatkan modul bawaan node:sqlite untuk database dan fetch API standar).
- Instalasi: Tidak memerlukan instalasi modul pihak ketiga (seperti Express atau pustaka JWT eksternal). Anda tidak perlu menjalankan npm install.

```bash
npm start          # seed otomatis jika DB kosong, lalu jalankan gateway + 2 service
npm run seed       # reset database & isi ulang data awal (hentikan server dulu)
npm test           # tes otomatis end-to-end (55 skenario) pada port & DB sementara
```

Atau jalankan tiap komponen di terminal terpisah (berguna saat demo video):
`npm run start:nilai`, `npm run start:transkrip`, `npm run start:gateway`
(jalankan `npm run seed` sekali sebelumnya).

## Akun dan Device ID data awal

| Username | Password | Role      | NIM            | Device ID (terdaftar) |
| -------- | -------- | --------- | -------------- | --------------------- |
| admin    | admin123 | admin     | -              | DEV-ADMIN-01          |
| dosen1   | dosen123 | dosen     | -              | DEV-DOSEN1-01         |
| dosen2   | dosen123 | dosen     | -              | DEV-DOSEN2-01         |
| mhs1     | mhs123   | mahasiswa | 09021282025001 | DEV-MHS1-01           |
| mhs2     | mhs123   | mahasiswa | 09021282025002 | DEV-MHS2-01           |
| mhs3     | mhs123   | mahasiswa | 09021282025003 | DEV-MHS3-01           |

Kelas: **id 1** KP70065004 Keamanan Informasi (diampu `dosen1`), **id 2** IF70045002 Basis Data (diampu `dosen2`).
Setiap kelas berisi nilai 3 mahasiswa (belum final). Service client: `service-nilai` / `dev-service-client-secret`.

## Konfigurasi

- **Jam akses** (`policy-config.json`), dibaca ulang tiap request sehingga bisa diubah saat demo tanpa restart:
  ```json
  {
    "timezone": "Asia/Jakarta",
    "accessHours": { "start": "07:00", "end": "21:00" }
  }
  ```
  Contoh menutup akses: `"start": "00:00", "end": "00:00"`.
- Secret dan port lewat environment variable: `JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_CLIENT_ID`,
  `SERVICE_CLIENT_SECRET`, `GATEWAY_PORT`, `NILAI_PORT`, `TRANSKRIP_PORT`, `DB_PATH` (lihat `config.js`).

## Peta kebutuhan (bagian 4) -> kode

| Kebutuhan                                                                      | Lokasi kode                                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Access token JWT 10 menit (`sub`, `role`), header Bearer                       | `gateway/auth.js` (`issueAccessToken`), `lib/jwt.js`, `config.js`                                        |
| Refresh token 1 hari di DB, bisa dicabut; logout mencabut                      | `gateway/auth.js` (`login`, `refresh`, `logout`), tabel `refresh_tokens` (disimpan sebagai hash SHA-256) |
| Token service 5 menit dari `POST /auth/service`                                | `gateway/auth.js` (`serviceToken`); pemanggil: `service-nilai/server.js` (`getServiceToken`)             |
| Gateway secret `X-Gateway-Secret`                                              | Ditambahkan di `gateway/server.js` (`forward`), diperiksa di `lib/guard.js`                              |
| Verifikasi ulang token di service (tanda tangan + masa berlaku)                | `lib/guard.js`, dipakai kedua service                                                                    |
| Kebijakan akses Tabel 3 (kepemilikan data dibaca dari DB)                      | `gateway/policy.js` (`decide`)                                                                           |
| Device terdaftar (`X-Device-ID`)                                               | `gateway/policy.js` langkah 4; login di `gateway/auth.js`                                                |
| Jam akses 07.00-21.00 dapat dikonfigurasi                                      | `gateway/policy.js` (`inAccessHours`), `policy-config.json`                                              |
| Audit log (waktu, subjek, endpoint, device, hasil, alasan)                     | `gateway/audit.js`, dipanggil di `gateway/server.js`                                                     |
| Finalisasi -> sinkron transkrip lewat gateway                                  | `service-nilai/server.js` (`finalisasi`, `syncTranskrip`), `service-transkrip/server.js` (`sinkron`)     |
| Pertahanan berlapis (assume breach): role & kepemilikan dicek ulang di service | `currentUser`, `ownedKelas` di service-nilai; `getTranskrip`, `sinkron` di service-transkrip             |

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
  (tab Collections, menu titik tiga, Import). Jalankan folder _1. Autentikasi_ lebih dulu; token tersimpan
  otomatis ke variabel koleksi, lalu jalankan folder lain. Nama tiap request memuat hasil yang diharapkan (200/403/dst).
- `requests.http` - untuk **VS Code** dengan ekstensi _REST Client_ (Huachao Mao). Buka file, klik
  "Send Request" di atas tiap baris `###`.

Catatan: finalisasi hanya bisa sekali per kelas. Untuk mengulang demo, hentikan server lalu `npm run seed`.

## Analisis dan Keputusan Design

Dalam mengerjakan tugas ini, saya mengambil beberapa keputusan desain untuk memenuhi kriteria Zero Trust:

- **Zero Dependency Policy**: Modul seperti Gateway, fungsionalitas reverse proxy, dan implementasi algoritma JWT HS256 dibangun dari awal ( from scratch ) menggunakan modul bawaan (node:http, node:crypto, node:sqlite). Keputusan ini diambil agar saya bisa benar-benar fokus memahami dan mengimplementasikan mekanisme kontrol akses secara fundamental, tanpa disembunyikan oleh "sihir" dari framework pihak ketiga.
  Pendekatan "Default Deny": Semua endpoint yang tidak terdaftar secara eksplisit di dalam aturan kebijakan (policy) akan langsung ditolak secara default. Misalnya, token khusus tingkat service hanya diizinkan secara ketat untuk rute POST /transkrip/sinkron.

- **Verifikasi Berlapis (Assume Breach)**: Meskipun request sudah lolos dari API Gateway (sebagai PEP), service tujuan (Nilai atau Transkrip) akan tetap melakukan validasi ulang. Kredensial role tidak hanya dipercaya dari payload token, tetapi diverifikasi kembali kesesuaiannya dengan data di database.

- **Keamanan Transaksi Data**: Pada proses finalisasi nilai, jika proses sinkronisasi ke service transkrip gagal (misalnya karena gangguan jaringan antar-service), maka status final di service nilai akan dikembalikan ke keadaan semula (rollback) untuk menjaga integritas data.

- **Evaluasi Keamanan & Limitasi**: Untuk keperluan praktikum ini, saya menggunakan algoritma symmetric HS256 untuk penandatanganan JWT dengan sebuah shared secret. Saya menyadari bahwa pada lingkungan produksi sesungguhnya, arsitektur ini memiliki kelemahan: jika service tertentu diretas dan secret-nya bocor, penyerang dapat menerbitkan token palsu. Untuk pengembangan lebih lanjut di dunia nyata, sistem ini harus ditingkatkan menggunakan algoritma asymmetric (seperti RS256 atau EdDSA), menerapkan koneksi TLS/mTLS antar komponen, serta memberlakukan rate limiting pada endpoint otentikasi.
