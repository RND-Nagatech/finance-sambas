# Finance Sambas — Final Security Audit

Tanggal audit: 29 Oktober 2026  
Ruang lingkup: Finance–Nagagold. Audit kode dan test environment; tidak melakukan perubahan production.

## Kontrol yang ditemukan

| Area | Implementasi | Penilaian |
|---|---|---|
| Authentication | Bearer session disimpan server-side in-memory, TTL dari `AUTH_SESSION_TTL_HOURS`, login/logout/me tersedia | Memadai untuk satu instance internal; perlu session store terdistribusi bila scale-out |
| Authorization | Role backend `ADMIN`, `OWNER`, `SUPER_USER` dipakai pada endpoint write, approval, mapping, snapshot apply, sinkronisasi, laporan | Baik pada role global; belum ada isolasi per cabang |
| Maker-checker | Pembuat transaksi tidak dapat approve/reject dirinya sendiri; approval hanya Owner/Super User | Lulus integration test |
| Approval atomik | Approval, journal status, dan update saldo berada dalam MongoDB transaction pada jalur yang diuji | Lulus integration test replica set |
| Idempotency | Payment request, approval paralel, reversal, recovery snapshot, dan source fetch berulang diuji | Lulus integration test |
| Jurnal | Debit/kredit diperiksa seimbang; `PROVISIONAL` tidak masuk saldo confirmed; reversal posted diuji | Lulus pada database testing |
| Sinkronisasi | Cursor disimpan setelah batch diproses; source key unik; lock in-process ditambahkan | Aman untuk satu proses; perlu distributed lock untuk multi-instance |
| Auto-posting | `NAGAGOLD_AUTO_POSTING_ENABLED=false`; rule baru inactive secara default | Tetap nonaktif |
| Snapshot recovery | Preview dan apply terkontrol memerlukan role tinggi, token, confirmation, dan batch id | Tidak boleh dijalankan production tanpa persetujuan |
| Logging | Production error handler hanya menulis method/path dan pesan error, bukan object stack lengkap | Diperbaiki pada tahap ini |

## Temuan dan risiko

### S-01 — Isolasi data cabang belum tersedia (HIGH)

Model user hanya memiliki role global. Endpoint laporan dan data transaksi tidak memfilter berdasarkan cabang yang dimiliki user. Ini sesuai dengan kondisi awal satu super user/internal management, tetapi belum aman bila user cabang diberi akses langsung.

Mitigasi sebelum akses cabang: tambahkan daftar cabang/otorisasi pada user, terapkan filter backend pada transaksi, request, laporan, detail, export, dan notifikasi; uji kebocoran lintas cabang.

### S-02 — Remember Me menyimpan password di localStorage (HIGH)

`web/src/main.jsx` menyimpan object username dan password di `localStorage` ketika checkbox Ingat saya aktif. XSS pada origin aplikasi atau akses browser profile dapat membaca password tersebut.

Mitigasi sebelum production luas: simpan username saja, atau ganti dengan persistent session/refresh mechanism berbasis cookie `HttpOnly`, `Secure`, `SameSite` dan rotasi/revokasi sesi. Perilaku ini jangan dianggap aman hanya karena aplikasi internal.

### S-03 — Lock sync hanya berlaku dalam satu process (MEDIUM)

Lock `nagagoldSyncRunning` mencegah overlap pada satu process Node.js. Dua instance Finance yang aktif bersamaan tetap dapat menjalankan sync yang sama; unique index mencegah sebagian duplikasi, tetapi tetap dapat menimbulkan beban dan race pada metadata.

Mitigasi: jalankan satu worker instance sampai distributed lock berbasis MongoDB selesai, atau tambahkan lease/lock collection dengan TTL dan owner token.

### S-04 — Startup melakukan rekonstruksi `tm_rekening.saldo_akhir` (MEDIUM)

Startup existing memanggil `syncAccountBalances()`. Fungsi ini memperbarui saldo tersimpan berdasarkan jurnal. Ini bukan bagian dari test UAT production dan dapat mengubah nilai master ketika server restart.

Mitigasi: lakukan backup dan dry-run rekonsiliasi sebelum deployment; idealnya ubah menjadi command eksplisit atau mode `read-only` sebelum production. Jangan menganggap saldo master boleh dikoreksi otomatis tanpa laporan selisih.

### S-05 — Finalitas Nagagold belum disetujui (HIGH untuk auto-posting)

Audit sebelumnya menemukan status sumber `OPEN`, tetapi belum ada bukti bahwa `OPEN` adalah finalitas akuntansi. Kategori, pembatalan, retur, dan settlement tertentu juga belum seluruhnya memiliki aturan terverifikasi.

Mitigasi: pertahankan klasifikasi `BLOCKED`/`REVIEW_REQUIRED`, approval/manual review, dan auto-posting nonaktif.

### S-06 — Backup/restore dan observability production belum dibuktikan (HIGH)

Repository menyediakan health check, tetapi backup, restore drill, alerting, dan monitoring kegagalan sync belum dibuktikan pada audit ini.

Mitigasi: jalankan checklist deployment dan restore drill pada environment non-production sebelum menyatakan siap.

## Secret dan credential

- `MONGODB_URI`, `NAGAGOLD_MONGODB_URI`, `NAGAGOLD_DECRYPTION_KEY`, password seed, dan token tidak boleh masuk repository atau log.
- `.env.example` hanya berisi placeholder; file `.env` di-ignore.
- `CORS_ORIGIN` harus berupa origin internal yang eksplisit, bukan wildcard.
- `NAGAGOLD_ENCRYPTION_MODE` disediakan sebagai konfigurasi non-secret; key tetap hanya di environment secret manager.

## Kesimpulan keamanan

Kontrol saldo, approval, idempotency, dan role global lulus pada database testing. Aplikasi belum aman untuk akses multi-cabang dan belum layak mengaktifkan auto-posting. Risiko S-01, S-02, S-04, S-05, dan S-06 harus ditutup atau diterima secara eksplisit sebelum production penuh.

