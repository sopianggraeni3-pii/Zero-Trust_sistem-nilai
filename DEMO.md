# Panduan Video Demo (target 7-8 menit)

Siapkan 3 terminal (nilai, transkrip, gateway) + 1 terminal curl + editor di samping.
Tunjukkan **kode** lalu **hasil** untuk setiap poin. Jalankan `npm run seed` sebelum merekam
(finalisasi hanya bisa sekali per kelas).

| Waktu | Isi | Tunjukkan di kode | Perintah demo |
|-------|-----|-------------------|---------------|
| 0:00-0:40 | Pengantar: skenario, role, arsitektur PEP/PE/PA | `README.md` diagram | `npm run start:*` di 3 terminal |
| 0:40-2:00 | **4.1 Token**: login, JWT 10 menit, refresh di DB, logout mencabut | `gateway/auth.js` (`login`, `refresh`, `logout`), tabel `refresh_tokens` | login dosen1; decode payload (`sub`,`role`,`exp`); refresh; logout; refresh lagi -> 401 |
| 2:00-3:00 | **Token service 5 menit** + sinkron antar-service lewat gateway | `serviceToken`, `getServiceToken`, `syncTranskrip` | `POST /auth/service` (secret benar & salah) |
| 3:00-4:00 | **Gateway secret + verifikasi ulang di service** | `forward` (gateway), `lib/guard.js` | `curl :3001/nilai` -> 403; secret benar tanpa token -> 401; token palsu -> 401 |
| 4:00-5:30 | **4.2 Kebijakan**: kepemilikan data dibaca dari DB | `gateway/policy.js` `decide` | mhs1 nilai sendiri vs `?nim=` orang lain; dosen1 kelas 1 vs 2; mhs1 `/transkrip/<NIM lain>` -> 403; admin -> 200; token user ke `/transkrip/sinkron` -> 403 |
| 5:30-6:30 | **4.3 Konteks**: device & jam akses | `policy.js` langkah 4, `inAccessHours`, `policy-config.json` | device milik user lain -> 403; ubah config jadi `00:00-00:00` -> PUT/finalisasi 403; kembalikan -> 200 |
| 6:30-7:30 | **Alur finalisasi end-to-end** | `finalisasi` (service-nilai), `sinkron` (service-transkrip) | PUT nilai -> finalisasi -> PUT lagi 409 -> mhs1 lihat transkrip terisi |
| 7:30-8:15 | **4.4 Audit log** + penutup | `gateway/audit.js` | terminal gateway (`[AUDIT]`) + query tabel `audit_log`; jalankan `npm test` |
