# Finance Sambas — Deployment dan Rollback Checklist

Checklist ini untuk deployment Finance–Nagagold. Tidak mencakup Optik dan tidak menjalankan backfill production.

## A. Persiapan release

- [ ] Review diff dan pastikan tidak ada perubahan collection transaksi baru.
- [ ] Pastikan `npm test` lulus.
- [ ] Pastikan `npm run test:integration` memakai `MONGODB_TEST_URI` terpisah dari production.
- [ ] Pastikan `npm run build` lulus.
- [ ] Simpan hasil test dan commit/release identifier.
- [ ] Pastikan `NAGAGOLD_AUTO_POSTING_ENABLED=false`.
- [ ] Pastikan tidak ada rule auto-posting aktif tanpa persetujuan tertulis.

## B. Environment dan secret

- [ ] `NODE_ENV=production`.
- [ ] `MONGODB_URI` mengarah ke database Finance production yang benar.
- [ ] `NAGAGOLD_MONGODB_URI` mengarah ke cluster Nagagold yang benar.
- [ ] `NAGAGOLD_DECRYPTION_KEY` diisi melalui secret manager/environment, bukan file repository.
- [ ] `NAGAGOLD_ENCRYPTION_MODE` sama dengan mode resmi yang digunakan Nagagold.
- [ ] `AUTH_ENABLED=true`.
- [ ] Username/password super user bukan nilai contoh.
- [ ] `CORS_ORIGIN` origin internal eksplisit.
- [ ] `NAGAGOLD_SYNC_ENABLED=false` sampai smoke test read-only selesai.
- [ ] Tidak ada credential/token/connection string di log release.

## C. Database safety

- [ ] Backup Finance dibuat sebelum deployment.
- [ ] Backup dapat diidentifikasi berdasarkan waktu, database, dan release.
- [ ] Restore drill dilakukan pada database non-production.
- [ ] MongoDB deployment mendukung transaction/replica set.
- [ ] Index existing diperiksa; unique index baru tidak dibuat tanpa audit duplikasi.
- [ ] Tidak menjalankan `dropDatabase`, `deleteMany`, migrasi destructive, atau recovery production sebagai bagian startup.
- [ ] Selisih `tm_rekening.saldo_akhir` versus jurnal posted diekspor sebelum deployment.
- [ ] Perubahan saldo historical tidak dilakukan otomatis.

## D. Startup smoke test

- [ ] Server start pada port yang benar.
- [ ] `GET /api/health` menunjukkan database connected.
- [ ] Login super user berhasil.
- [ ] Login dengan password salah ditolak.
- [ ] User tanpa role approval tidak dapat memanggil endpoint approval.
- [ ] Dashboard dan laporan dapat dibuka.
- [ ] Export Excel/PDF kecil berhasil.
- [ ] Worker tetap nonaktif selama smoke test awal.

## E. Aktivasi sync Nagagold terbatas

- [ ] Daftar cabang aktif dan `database_name` diverifikasi.
- [ ] Satu cabang pilot dipilih.
- [ ] Cursor awal dan timezone Asia/Jakarta disetujui.
- [ ] Fetch manual read-only diuji.
- [ ] Hasil mapping dan klasifikasi ditinjau Admin.
- [ ] Tidak ada transaksi source yang diposting otomatis.
- [ ] Monitoring `tt_sync_state` dan error tersedia.
- [ ] Setelah smoke test, baru pertimbangkan `NAGAGOLD_SYNC_ENABLED=true`.
- [ ] Worker dijalankan satu instance sampai distributed lock tersedia.

## F. UAT dan go/no-go

- [ ] Admin menyelesaikan input, request, mapping, laporan, dan export.
- [ ] Owner menyelesaikan detail, approval, reject, bulk approval, dan melihat audit trail.
- [ ] Maker-checker diuji dengan akun berbeda.
- [ ] Payment request diuji dua kali untuk memastikan idempotent.
- [ ] Saldo dan jurnal diuji sebelum/sesudah approval.
- [ ] UAT report ditandatangani atau disetujui pihak bisnis.
- [ ] Semua blocker pada `PRODUCTION_READINESS.md` memiliki keputusan.
- [ ] Auto-posting tetap OFF pada go/no-go.

## G. Rollback deployment

1. Hentikan instance baru dan jangan menjalankan worker tambahan.
2. Jika sync aktif, set `NAGAGOLD_SYNC_ENABLED=false` dan restart secara terkontrol.
3. Simpan log error, `tt_sync_state`, dan correlation/audit id terkait.
4. Jangan menghapus transaksi atau jurnal untuk membersihkan efek deployment.
5. Kembalikan artifact aplikasi ke release sebelumnya.
6. Jika ada kerusakan data yang terbukti, gunakan backup/restore procedure yang sudah diuji; jangan `reset` atau mengubah saldo manual.
7. Rekonsiliasi ulang `tt_keuangan`, `tm_rekening.saldo_akhir`, `tt_mutasi`, dan `tt_sinkronisasi` setelah rollback.
8. Catat keputusan Owner dan waktu setiap tindakan.

## H. Larangan operasional

- [ ] Jangan menyalakan auto-posting untuk menaikkan jumlah transaksi eligible.
- [ ] Jangan menganggap status `OPEN` sebagai final tanpa keputusan bisnis.
- [ ] Jangan menjalankan recovery snapshot production tanpa preview token, batch kecil, approval, dan backup.
- [ ] Jangan menambah instance worker tanpa distributed lock.
- [ ] Jangan membagikan `.env`, token sesi, password, atau key dekripsi.
- [ ] Jangan memakai data monitoring pending/blocked sebagai saldo confirmed.

