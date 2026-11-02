# Finance Sambas — Production Readiness

Tanggal penilaian: 29 Oktober 2026  
Ruang lingkup: Finance–Nagagold saja.

## Keputusan akhir

**NOT READY FOR PRODUCTION** untuk deployment operasional penuh.

Aplikasi **READY WITH RESTRICTIONS untuk pilot internal terbatas** dengan satu instance, satu management, proses manual, dan auto-posting tetap nonaktif. Status ini tidak sama dengan persetujuan untuk menghubungkan seluruh cabang atau mengaktifkan posting otomatis.

## Dasar keputusan

### Sudah terbukti pada testing

- `npm test`: 22 test lulus.
- `npm run build`: build frontend berhasil.
- MongoDB integration test pada database testing terpisah lulus, mencakup concurrency approval, maker-checker, idempotency pembayaran/reversal/recovery/fetch, rollback, saldo, jurnal seimbang, mapping, laporan, dan export.
- Fetch berulang source yang sama tidak menghasilkan dokumen `tt_sinkronisasi` kedua pada test.
- Transaksi `BLOCKED`, provisional, pending, rejected, dan matched tidak dihitung sebagai saldo confirmed.

### Belum memenuhi syarat production penuh

1. UAT nyata bersama Admin dan Owner belum dilakukan.
2. Akses dan filter data per cabang belum ada di backend.
3. Remember Me masih menyimpan password plaintext di localStorage.
4. Finalitas `OPEN` Nagagold, settlement, pembatalan, retur, dan koreksi belum disetujui.
5. Sebagian snapshot legacy, mapping, dan dekripsi belum lengkap.
6. Backup/restore drill dan monitoring production belum memiliki bukti hasil.
7. Lock worker belum aman untuk deployment multi-instance.
8. Startup existing memperbarui saldo master melalui rekonstruksi jurnal dan belum memiliki mode preview/approval khusus.

## Fitur yang boleh dipakai pada pilot terbatas

- Login role global Admin/Owner/Super User.
- Input mutasi internal oleh Admin/Super User.
- Approval Owner/Super User dengan maker-checker.
- Request cabang, approval, dan konfirmasi pembayaran manual.
- Jurnal provisional/posted/reversal pada transaksi yang diuji.
- Rekonsiliasi manual tanpa posting tambahan.
- Monitoring hasil fetch Nagagold.
- Dashboard, laporan, dan export dengan filter.
- Mapping dan preview snapshot tanpa apply production.

## Fitur yang dilarang diaktifkan

- `NAGAGOLD_AUTO_POSTING_ENABLED=true`.
- Rule auto-posting aktif.
- Worker Optik atau integrasi Optik.
- Backfill/recovery snapshot production tanpa preview dan persetujuan eksplisit.
- Akses user cabang sebelum filter otorisasi backend.
- Deployment horizontal lebih dari satu worker tanpa distributed lock.

## Konfigurasi minimum pilot

```ini
NODE_ENV=production
AUTH_ENABLED=true
AUTH_SESSION_TTL_HOURS=12
AUTH_SUPER_USERNAME=<secret>
AUTH_SUPER_PASSWORD=<strong-secret>
MONGODB_URI=<finance-production-uri>
NAGAGOLD_MONGODB_URI=<nagagold-cluster-uri>
NAGAGOLD_SYNC_ENABLED=false
NAGAGOLD_AUTO_POSTING_ENABLED=false
NAGAGOLD_DECRYPTION_KEY=<secret>
NAGAGOLD_ENCRYPTION_MODE=1
CORS_ORIGIN=<internal-frontend-origin>
```

Aktifkan `NAGAGOLD_SYNC_ENABLED=true` hanya setelah koneksi read-only, cabang, cursor awal, dan hasil dry-run diverifikasi. Jangan memakai `NAGAGOLD_SYNC_INITIAL_FROM` untuk backfill besar tanpa rencana kapasitas dan preview.

## Gate sebelum status READY

- UAT bisnis seluruh skenario pada `FINAL_UAT_REPORT.md` memiliki bukti PASS.
- Role cabang dan row-level branch filter diuji negatif.
- Remember Me diganti dengan mekanisme yang tidak menyimpan password.
- Restore backup berhasil pada database non-production.
- Monitoring dan alert sync gagal diuji.
- Definisi finalitas Nagagold dan aturan mapping disetujui Owner.
- Rekonsiliasi saldo master versus jurnal memiliki laporan selisih dan approval.
- Distributed lock atau kebijakan single-worker ditetapkan.
- Auto-posting tetap false sampai ada keputusan aktivasi terpisah.

