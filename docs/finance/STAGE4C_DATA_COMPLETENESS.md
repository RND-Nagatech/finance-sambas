# Finance Sambas — Tahap 4C

Tanggal audit: 29 Oktober 2026  
Ruang lingkup: Nagagold saja; tidak mencakup Optik.

## Hasil utama

Tahap 4C memperbaiki kelengkapan metadata untuk transaksi baru dan menyiapkan pemeriksaan read-only untuk transaksi lama. Tidak ada backfill production yang dijalankan, tidak ada saldo atau jurnal yang diubah, dan auto-posting tetap nonaktif.

Data hasil sinkronisasi disimpan di `tt_sinkronisasi`. Konfigurasi mapping baru disimpan di `tm_pemetaan_rekening`; ini bukan collection transaksi dan tidak membuat jurnal.

## Penyebab transaksi BLOCKED

Audit read-only terbaru terhadap Finance menemukan 247 transaksi Nagagold dengan total Rp89.832.577.660. Perubahan jumlah dari laporan Tahap 4B terjadi karena worker menerima dua transaksi sumber tambahan; angka 246/Rp89.817.732.660 tetap disimpan sebagai baseline historis Tahap 4B.

Klasifikasi read-only terbaru:

| Hasil | Jumlah | Nominal |
| --- | ---: | ---: |
| `AUTO_ELIGIBLE` | 0 | Rp0 |
| `REVIEW_REQUIRED` | 0 | Rp0 |
| `RECONCILIATION_REQUIRED` | 0 | Rp0 |
| `BLOCKED` | 247 | Rp89.832.577.660 |

Penyebab dominan:

- 245 transaksi lama belum memiliki snapshot lengkap dan belum menyimpan `jumlah_in`/`jumlah_out` secara historis.
- Seluruh 247 transaksi belum memiliki mapping unik aktif pada saat audit (`mappingStatus=PERLU_PEMETAAN`).
- 37 transaksi masih memiliki jenis/kategori yang tidak terbaca dengan aman.
- Data lama belum memiliki metadata finalitas/dekripsi yang baru ditambahkan.

Ketiadaan snapshot lama tidak diperlakukan sebagai nilai nol. Arah dana tidak ditebak dari `amount` Finance.

## Pemulihan snapshot

Endpoint preview:

```http
POST /api/nagagold-transactions/snapshot-recovery/preview
```

Contoh:

```json
{
  "kodeToko": "SPW",
  "onlyIncomplete": true,
  "limit": 100
}
```

Preview memvalidasi database berdasarkan `kode_toko`, `source_database_name`, dan `source_transaction_id`. Sistem kemudian mencocokkan sourceKey, ID sumber, nominal Finance dengan satu arah `jumlah_in` atau `jumlah_out`, arah dana, fingerprint snapshot jika tersedia, serta perubahan status atau isi sumber.

Hasil `PENDING_APPLY` berarti metadata dapat disiapkan untuk pemulihan setelah persetujuan terpisah. Hasil `PREVIEW_MISMATCH`, `SOURCE_NOT_FOUND`, atau `ERROR` tidak boleh dipulihkan otomatis.

Endpoint ini mengembalikan `previewOnly=true` dan `writesPerformed=false`. Belum ada endpoint apply production yang aktif. Backfill hanya boleh dibuat setelah hasil preview ditinjau.

## Snapshot worker baru

Fetch Nagagold tetap berjalan setiap 10 menit. Setiap transaksi baru menyimpan identitas sumber dan database, `no_reff`, tanggal, jenis, kategori, rekening, bank, `jumlah_in`, `jumlah_out`, status sumber, `is_validate`, `status_receive`, deskripsi, keterangan, detail transaksi, daftar faktur, fingerprint, provenance waktu pembacaan, status dekripsi, status finalitas, serta status dan alasan mapping rekening.

Update fetch berikutnya tidak mengubah `amount`, saldo, jurnal posted, approval, atau `status_valid` transaksi final. Satu dokumen sumber dengan beberapa faktur tetap satu peristiwa Finance.

## Audit status OPEN dan dekripsi

Repository Nagagold menunjukkan:

- `CashRepositories` menyimpan transaksi dengan status `OPEN` dan memakai `jumlah_in`/`jumlah_out` sebagai arah arus.
- `ValidasiCash` mengubah `DONE` menjadi `OPEN` dan menandai `is_validate=true`.
- Banyak query laporan dan validasi tetap memakai `status=OPEN`; karena itu `OPEN` adalah status administratif/operasional, bukan bukti finalitas akuntansi.
- `is_validate=true` hanya bukti validasi administratif. Finance tetap menandainya `OPEN_UNVERIFIED`.
- Kode sumber menggunakan `Encryptor.doEncrypt`/`doDecrypt` dan `encryptascii`/`decryptascii`. Finance hanya menggunakan mekanisme dekripsi yang tersedia; nilai yang gagal menjadi teks printable tidak ditebak.

## Mapping rekening

Mapping tersimpan per konteks:

```text
nagagold + kode_toko + metode_pembayaran + kode_bank + nomor_rekening
```

Aturan utama:

- `CASH` hanya dapat dipetakan ke `KAS_TUNAI_TOKO` pada unit dan kode toko yang sama.
- `DEBET`, `TRANSFER`, atau `BANK` membutuhkan rekening bank, bank, dan nomor rekening yang sesuai.
- Kandidat lebih dari satu menghasilkan `PEMETAAN_AMBIGU`.
- Tidak ada rekening pertama yang dipilih secara otomatis.
- Mapping `KAS_TUNAI_TOKO` tidak dicampur dengan `KAS_KECIL_OPERASIONAL`.

UI baru tersedia pada menu **Mapping Nagagold** untuk melihat penyebab gagal mapping, menguji mapping, menyimpan konfigurasi, dan memulai preview snapshot lama.

## Perbandingan cakupan

| Cakupan | Tahap 4B | Audit Tahap 4C |
| --- | ---: | ---: |
| Dokumen sumber SPW | 144.698 | 144.700 |
| Status sumber SPW | 144.698 `OPEN` | 144.700 `OPEN` |
| Transaksi Finance Nagagold | 246 | 247 |
| Nominal transaksi Finance | Rp89.817.732.660 | Rp89.832.577.660 |

Perbedaan ini berasal dari data baru yang masuk; bukan hasil perubahan saldo historis.

## Pengujian

Integration test MongoDB menggunakan database dan database sumber sintetis terpisah. Pengujian mencakup mapping CASH QBS dan WTS tidak tertukar, rekening dengan nomor sama tetapi bank berbeda, mapping ambigu ketika bank tidak diberikan, snapshot source ID valid dan nominal konsisten, sumber berubah setelah pembacaan pertama menjadi `PREVIEW_MISMATCH`, dry-run dan preview recovery tidak mengubah saldo atau jurnal, serta approval, request, rekonsiliasi, concurrency, idempotency, rollback, dan jurnal seimbang.

Hasil terakhir:

- `npm test`: 22 lulus, 0 gagal;
- `npm run test:integration`: lulus pada MongoDB replica set testing, database `finance_sambas_stage4a_test`;
- `npm run build`: berhasil.

## Keputusan yang masih diperlukan

1. Definisi status final akuntansi Nagagold yang resmi.
2. Persetujuan mapping rekening per cabang dan metode pembayaran.
3. Keputusan apakah `is_validate` dapat digunakan sebagai syarat review, bukan sebagai finalitas.
4. Aturan bisnis `DEBET`, `TRANSFER`, pembatalan, retur, dan koreksi.
5. Persetujuan terpisah sebelum menjalankan apply recovery pada production.
6. Konfirmasi kategori serta field terenkripsi yang masih belum dapat didekripsi.
