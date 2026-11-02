# Finance Sambas — Final UAT dan Regression Report

Tanggal: 29 Oktober 2026  
Ruang lingkup: Finance–Nagagold saja. Optik dan auto-posting tidak termasuk aktivasi tahap ini.

## Kesimpulan pengujian

Pengujian teknis pada database MongoDB testing terpisah lulus. UAT bisnis dengan Admin/Owner dan data operasional Nagagold nyata belum dilakukan, sehingga hasil teknis tidak boleh dianggap sebagai persetujuan bisnis atau bukti siap production penuh.

Run terakhir:

```text
STAGE4A_TEST_PORT=3317 npm run test:integration
ok: true
database: finance_sambas_stage4a_test
makerChecker: true
concurrency: true
idempotency: true
rollback: true
```

Test memakai data sintetis, database Finance testing yang di-drop sebelum test, dan database sumber Nagagold testing terpisah. Guard test menolak apabila `MONGODB_TEST_URI` sama dengan `MONGODB_URI` production.

## Checklist teknis

| Modul | Skenario | Hasil aktual | Status | Bukti |
|---|---|---|---|---|
| Authentication | Login Admin, Owner, dan Super User | Token sesi berhasil dibuat | PASS | `server/test/integration-stage4a.mjs` |
| Maker-checker | Admin tidak dapat approve transaksi yang dibuat sendiri | Backend mengembalikan 403 | PASS | Integration test |
| Transaksi Admin | Input transaksi membuat jurnal `PROVISIONAL` tanpa mengubah saldo confirmed | Saldo tetap, jurnal provisional terbentuk | PASS | Integration test |
| Approval | Dua approver memproses transaksi yang sama | Tepat satu request mem-posting saldo dan jurnal | PASS | Integration test |
| Reject pending | Reject sebelum posting | Tidak ada saldo berubah dan tidak ada reversal saldo | PASS | Integration test |
| Reversal | Reversal transaksi posted dikirim dua kali | Satu reversal dibuat; percobaan kedua idempotent | PASS | Integration test |
| Request cabang | Request approved tetapi belum dibayar | Pembayaran sebelum approval ditolak; approval tidak mengubah saldo | PASS | Integration test |
| Realisasi pembayaran | Konfirmasi transfer dua kali | Satu transaksi Finance dan satu jurnal | PASS | Integration test |
| Rekonsiliasi | Hasil fetch dipasangkan dengan transaksi Admin | Pair tersimpan tanpa membuat jurnal tambahan | PASS | Integration test |
| Mapping CASH | QBS dan WTS memiliki kas tunai berbeda | Mapping mengikuti kode toko | PASS | Integration test |
| Mapping bank | Nomor rekening sama pada BCA dan Mandiri | Kode bank membedakan kandidat | PASS | Integration test |
| Mapping ambigu | Nomor rekening tanpa bank dengan beberapa kandidat | Ditahan sebagai `PEMETAAN_AMBIGU` | PASS | Integration test |
| Snapshot | Sumber cocok, sumber berubah, dan apply berulang | Preview mismatch terdeteksi; apply idempotent | PASS | Integration test |
| Dry-run | Klasifikasi Nagagold | Tidak mengubah saldo, jurnal, approval, atau sumber | PASS | Integration test |
| Fetch berulang | Trigger sync dengan source yang sama | Tidak menambah `tt_sinkronisasi` kedua | PASS | Integration test |
| Bulk approval | Satu transaksi valid dan satu gagal saldo | Hasil per transaksi jelas; saldo hanya berubah untuk yang berhasil | PASS | Integration test |
| Rollback | Operasi MongoDB gagal di tengah transaction | Saldo dan jurnal kembali seperti semula | PASS | Integration test |
| Jurnal | Seluruh jurnal test | Debit dan kredit setiap jurnal seimbang | PASS | Integration test |
| Laporan | Dashboard, saldo, transaksi, integrated, jurnal, rekonsiliasi | Endpoint mengembalikan filter dan data yang diharapkan | PASS | Integration test |
| Export | Excel dan PDF dengan filter | File valid dan tidak kosong | PASS | Integration test |

## UAT bisnis yang masih terbuka

| Modul | Skenario | Status | Catatan |
|---|---|---|---|
| Transaksi Admin | Admin membuat pemasukan/pengeluaran non-mutasi melalui UI | BLOCKED | Endpoint transaksi existing berfokus pada mutasi internal antar akun; definisi akun lawan untuk pemasukan/pengeluaran belum disepakati. |
| Request cabang | Pengguna cabang login sendiri dan mengajukan request | BLOCKED | Role dan pembatasan data per cabang belum tersedia; saat ini alur request diuji melalui Admin. |
| Notifikasi | Owner menerima notifikasi di lingkungan operasional | BLOCKED | Notifikasi tersimpan di aplikasi, tetapi pengujian penerimaan user nyata belum dilakukan. |
| UAT Owner | Owner memeriksa detail dan approve/reject massal menggunakan browser | BLOCKED | Belum ada sesi UAT bisnis yang disaksikan/dikonfirmasi user. |
| Sync Nagagold | Menguji koneksi read-only ke cabang Nagagold non-production | BLOCKED | Test yang lulus menggunakan database sumber sintetis; data production hanya boleh diaudit read-only dengan persetujuan. |
| Finalitas | Memutuskan `OPEN`/`is_validate` sebagai bukti final | BLOCKED | Audit sebelumnya belum menemukan bukti bahwa `OPEN` adalah finalitas akuntansi. |

## Status fitur

| Status | Fitur |
|---|---|
| Implementasi tersedia | Login, role dasar, maker-checker, transaksi manual internal, request cabang, approval massal, jurnal provisional/posted/reversal, rekonsiliasi, mapping Nagagold, snapshot preview/recovery terkontrol, worker 10 menit, dashboard, laporan, Excel/PDF. |
| Lulus pengujian teknis | Approval/concurrency/idempotency/rollback, saldo dan jurnal testing, mapping CASH/bank/ambigu, dry-run, fetch berulang, laporan dan export. |
| Belum lulus UAT bisnis | Skenario browser nyata, user cabang, notifikasi operasional, transaksi pemasukan/pengeluaran non-mutasi, dan keputusan finalitas Nagagold. |
| Tidak boleh diaktifkan | Auto-posting Nagagold, worker Optik, recovery/backfill production, dan akses multi-cabang tanpa kebijakan role cabang. |

## Catatan perbaikan Tahap 7

- Write endpoint yang sebelumnya hanya membutuhkan login sekarang diberi pembatasan role sesuai risiko aksi.
- Trigger sync diberi lock in-process agar interval dan trigger manual dalam satu proses tidak berjalan bersamaan.
- Test fixture diperbaiki agar database sumber QBS dan WTS tidak sama; sebelumnya fixture tersebut membuat satu dokumen sumber terlihat sebagai sumber dua cabang dan menghasilkan false positive pada pengujian duplikasi.
- Error 500 pada production tidak lagi mencetak object error lengkap ke log; detail tetap tersedia pada mode non-production.
- `.env.example` sekarang mencantumkan mode dekripsi yang memang dibaca worker.

## Keputusan UAT

Secara teknis, suite regression dan integration test lulus. Secara bisnis, UAT belum lengkap dan beberapa kontrol production penting masih terbuka. Karena itu dokumen ini tidak memberi status PASS untuk skenario yang belum benar-benar diuji oleh pengguna.

