# Finance Sambas — Tahap 5

## Status implementasi

Tahap 5 menyelesaikan dua hambatan operasional tanpa mengaktifkan auto-posting dan tanpa mengubah saldo production:

1. Konfigurasi mapping Nagagold tetap menggunakan `tm_pemetaan_rekening` dan kini dapat dipreview secara massal berdasarkan cabang, unit, metode pembayaran, kode bank, dan nomor rekening.
2. Pemulihan metadata snapshot lama memiliki alur preview → token preview → apply terkontrol. Apply dibatasi maksimal 25 transaksi per batch, hanya Owner/Super User, dan tidak mengubah nominal Finance, saldo, jurnal, approval, atau `status_valid`.
3. Whitelist auto-posting disimpan di collection baru `tm_auto_posting`. Semua aturan baru dibuat `aktif=false`.

Tidak ada backfill production, aktivasi whitelist, perubahan saldo historical, penghapusan transaksi, atau pembuatan jurnal production yang dijalankan dalam Tahap 5.

## Mapping Nagagold

Menu existing **Mapping Nagagold** sekarang mencakup:

- daftar mapping aktif;
- contoh transaksi yang belum terpetakan;
- preview mapping massal;
- uji satu konteks mapping sebelum disimpan;
- pemilihan rekening secara eksplisit ketika kandidat lebih dari satu;
- audit log `NAGAGOLD_MAPPING_SAVED`.

Aturan mapping yang dipertahankan:

- `CASH` hanya boleh dipetakan ke `KAS_TUNAI_TOKO` pada unit dan kode toko yang sama;
- transaksi non-CASH memerlukan `REKENING_BANK`, kode bank, dan nomor rekening yang sama;
- nomor rekening sama pada dua bank berbeda tetap menjadi konteks berbeda;
- kandidat ambigu tidak memilih rekening pertama secara otomatis;
- `KAS_KECIL_OPERASIONAL` tidak digunakan sebagai pengganti kas tunai toko.

Endpoint preview massal: `POST /api/nagagold-mapping/bulk-preview`.

## Pemulihan snapshot lama

Endpoint preview: `POST /api/nagagold-transactions/snapshot-recovery/preview`.

Preview memverifikasi:

- `sourceKey`, cabang, database sumber, dan ID `tt_cash_daily`;
- nominal serta arah dana;
- fingerprint sumber terhadap snapshot yang tersimpan;
- field metadata yang belum lengkap;
- perubahan status atau kondisi sumber.

Endpoint apply: `POST /api/nagagold-transactions/snapshot-recovery/apply`.

Apply mensyaratkan:

- token dari preview yang masih sesuai;
- `confirmation=APPLY_NAGAGOLD_SNAPSHOT_RECOVERY`;
- role `OWNER` atau `SUPER_USER`;
- maksimal 25 transaksi dalam satu batch.

Apply hanya mengisi metadata snapshot yang hilang. Transaksi yang sudah `POSTED`, `REVERSED`, `APPROVED`, atau `REJECTED` dilewati. Update memakai filter status dan dapat diulang secara idempotent. Audit log mencatat batch dan hasil tiap transaksi dengan penanda bahwa saldo, jurnal, dan approval tidak berubah.

Preview tetap dapat digunakan tanpa apply. Tidak ada endpoint apply yang dipanggil terhadap production dalam pekerjaan ini.

## Whitelist auto-posting

Collection: `tm_auto_posting`.

Konteks aturan:

- unit;
- kode toko atau `*` untuk wildcard;
- jenis sumber (`CASH`, `DEBET`, `TRANSFER`, atau wildcard);
- kategori sumber;
- metode pembayaran;
- status finalitas, saat ini hanya `FINAL_CONFIRMED`;
- status aktif dan riwayat persetujuan.

Endpoint:

- `GET /api/nagagold-auto-posting/rules`;
- `POST /api/nagagold-auto-posting/rules` untuk menyimpan aturan nonaktif;
- `PATCH /api/nagagold-auto-posting/rules/:id` untuk menonaktifkan atau meminta aktivasi eksplisit.

Aktivasi ditolak bila `NAGAGOLD_AUTO_POSTING_ENABLED=false`. Jika flag global nanti sengaja diubah, aktivasi tetap memerlukan role Owner/Super User dan confirmation `AKTIFKAN_AUTO_POSTING`. Tahap 5 tidak mengubah flag tersebut dan tidak membuat worker melakukan posting otomatis.

Dry-run klasifikasi sekarang juga melaporkan jumlah aturan whitelist, aturan aktif, kecocokan, serta alasan transaksi belum bisa dipertimbangkan. Dry-run tidak menulis klasifikasi, jurnal, saldo, approval, atau pembayaran.

## Finalitas dan kategori

Bukti dari kode Nagagold yang sudah diaudit menunjukkan validasi cash mengubah `DONE` menjadi `OPEN` dan menandai `is_validate=true`. Karena itu `OPEN` tidak dianggap final secara akuntansi.

Konsekuensinya:

- `CASH` + kategori penjualan/service dapat menjadi kandidat teknis hanya setelah finalitas disahkan, mapping unik, tidak ada jurnal, dan tidak ada pasangan transfer;
- `DEBET` tetap review sampai mekanisme settlement kartu ke rekening diketahui;
- `TRANSFER` harus diperiksa untuk pasangan mutasi/request dan tidak boleh dibuat jurnal kedua;
- `SALDO AWAL` tidak boleh auto-post dari `tt_cash_daily`;
- `BATAL_*`, `KIRIM UANG`, `TERIMA UANG`, dan mutasi antar rekening perlu rekonsiliasi atau aturan reversal yang disahkan;
- data terenkripsi yang tidak terbaca tetap ditahan.

## Hasil pengujian

Database testing memakai database terpisah dan data sintetis. Hasil terakhir:

- unit test: **22 lulus, 0 gagal**;
- integration MongoDB: **lulus**;
- mapping CASH per cabang: lulus;
- mapping bank dengan kode bank + nomor rekening: lulus;
- mapping ambigu: ditahan;
- aturan whitelist default nonaktif: lulus;
- aktivasi ditolak saat flag global nonaktif: lulus;
- preview snapshot tidak mengubah saldo/jurnal: lulus;
- apply snapshot terverifikasi mengisi snapshot satu kali: lulus;
- apply berulang menjadi idempotent: lulus;
- saldo dan jumlah jurnal tetap sama selama recovery: lulus;
- concurrency, maker-checker, rollback, reversal, request payment, dan balanced journal dari regresi Tahap 4A: lulus.

## Kondisi production yang masih harus diputuskan

Berdasarkan audit sebelumnya, seluruh transaksi Finance Nagagold yang tersedia masih perlu ditangani secara konservatif karena status sumber `OPEN` belum terbukti sebagai finalitas akuntansi. Sebelum whitelist diaktifkan, Owner perlu menyetujui:

1. field atau proses yang menjadi bukti finalitas;
2. aturan settlement DEBET/kartu;
3. apakah CASH tertentu mewakili penerimaan kas toko atau mutasi lain;
4. kategori yang boleh auto-post dan mapping akun debit/kreditnya;
5. prosedur untuk `BATAL_*`, retur, dan koreksi;
6. batch recovery production mana yang disetujui setelah preview diperiksa.

Sampai keputusan itu tersedia, status **BLOCKED**, **REVIEW_REQUIRED**, dan **RECONCILIATION_REQUIRED** adalah hasil yang benar. Monitoring tetap menampilkan transaksi tersebut, tetapi nominal monitoring tidak dicampur dengan saldo confirmed.
