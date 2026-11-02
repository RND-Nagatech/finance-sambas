# Finance Sambas Tahap 6 — Dashboard dan Laporan Nagagold

## Ruang lingkup

Tahap ini menambahkan dashboard dan laporan read-only untuk Finance–Nagagold. Tidak ada worker Optik, auto-posting baru, recovery production, migrasi saldo, atau collection transaksi baru.

Sumber utama tetap:

- `tt_mutasi` untuk transaksi mutasi Finance.
- `tt_sinkronisasi` untuk monitoring transaksi hasil sinkronisasi sumber.
- `tt_keuangan` untuk pencatatan saldo dan pergerakan uang Finance.
- `tm_rekening` untuk master kas/rekening serta saldo tersimpan.
- `tt_saldo_awal` melalui pencatatan `SALDO_AWAL` yang dibuat oleh alur Finance.
- `tt_request_transfer` untuk laporan request, approval, dan realisasi pembayaran.
- `tt_sync_state` untuk status worker Nagagold.

## Menu dan endpoint

Menu Laporan sekarang memakai tab:

- Semua Transaksi
- Saldo Kas & Rekening
- Terintegrasi Nagagold
- Mutasi Antar Kas
- Request & Approval
- Jurnal & Buku Besar
- Rekonsiliasi

Endpoint read-only yang digunakan:

```text
GET /api/reports/dashboard
GET /api/reports/balances
GET /api/reports/transactions
GET /api/reports/integrated
GET /api/reports/mutations
GET /api/reports/requests
GET /api/reports/journals
GET /api/reports/reconciliation
GET /api/reports/export?report=<jenis>&format=xlsx|pdf
```

Semua endpoint laporan membutuhkan role `ADMIN`, `OWNER`, atau `SUPER_USER`. Endpoint tidak menulis transaksi, jurnal, saldo, approval, atau data sumber.

## Pemisahan confirmed dan monitoring

Transaksi dianggap confirmed hanya jika memenuhi dua kondisi:

```text
status = APPROVED
dan
journal_status = POSTED
```

Transaksi `PENDING`, `REVIEW_REQUIRED`, `BLOCKED`, `REJECTED`, atau belum memiliki jurnal posted tetap dapat tampil pada monitoring. Nilainya tidak dijumlahkan sebagai saldo confirmed.

Dokumen `tt_cash_daily` dengan beberapa faktur tetap satu baris peristiwa sumber. Nomor faktur hanya ditampilkan sebagai rincian.

## Rumus saldo

Untuk setiap akun kas/rekening:

```text
Saldo akhir periode = saldo awal periode + debit posted periode - kredit posted periode
```

Saldo awal periode berasal dari:

- jurnal `OPENING` sampai tanggal awal periode; dan
- jurnal non-`OPENING` sebelum tanggal awal periode.

Jurnal `PROVISIONAL` tidak dihitung. Jurnal `REVERSAL` dihitung sesuai line debit/kredit yang sudah berstatus `POSTED`. Mutasi internal tidak dimasukkan sebagai pendapatan atau biaya konsolidasi; hanya mengubah saldo akun sumber dan tujuan.

`tm_rekening.saldo_akhir` ditampilkan sebagai nilai tersimpan untuk rekonsiliasi. Sistem tidak otomatis mengoreksi perbedaan antara saldo tersimpan dan hasil jurnal.

## Export

Excel dan PDF menggunakan endpoint serta filter yang sama dengan web. Excel memiliki header, format nominal numerik, freeze header, dan judul laporan. PDF memiliki judul, periode, timezone Asia/Jakarta, waktu pembuatan, dan nomor halaman.

Export dibatasi maksimal 20.000 baris per permintaan untuk mencegah server kehabisan memori. Data lebih besar perlu diekspor dengan pagination/batch pada tahap berikutnya.

## Pengujian

Yang berhasil dijalankan:

- `npm test`: 22 unit/regression test existing lulus.
- `STAGE4A_TEST_PORT=3311 npm run test:integration`: lulus pada MongoDB testing terpisah, termasuk approval concurrency, idempotency, rollback, saldo/jurnal, endpoint laporan, dan export Excel/PDF.
- `npm run build` pada `web`: lulus.

Integration test tidak menggunakan database production. Port `3311` dipakai karena port default testing sedang digunakan proses lokal lain.

## Catatan Tahap 7

- Tambahkan role cabang dan pembatasan data per cabang apabila role tersebut sudah diputuskan di model user.
- Tambahkan endpoint export streaming/batch untuk dataset di atas 20.000 baris.
- Tetapkan definisi bisnis final untuk penerimaan/pengeluaran non-mutasi jika laporan pendapatan atau biaya formal diperlukan.
- Tambahkan grafik historis berbasis agregasi jurnal apabila kebutuhan analitik harian/bulanan sudah disetujui.
