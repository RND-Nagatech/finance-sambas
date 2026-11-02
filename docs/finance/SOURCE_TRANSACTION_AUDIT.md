# Audit Sumber Transaksi Nagagold

Tanggal audit: 29 Oktober 2026  
Metode: query MongoDB **read-only**  
Cakupan: cabang aktif yang tersedia saat audit, yaitu `SPW`

Tidak ada kredensial, nomor rekening, `no_reff`, nomor faktur, atau nilai field terenkripsi mentah yang disalin ke laporan ini. Angka nominal di bawah adalah agregat untuk audit, bukan data operasional per transaksi.

## Ringkasan data

Collection yang diperiksa adalah `tt_cash_daily`. Total dokumen yang ditemukan: **144.698**.

| Pemeriksaan | Hasil |
| --- | ---: |
| Status `OPEN` | 144.698 |
| Status selain `OPEN` | 0 pada cabang yang diaudit |
| Hanya `jumlah_in` positif | 84.204 |
| Hanya `jumlah_out` positif | 59.654 |
| `jumlah_in` dan `jumlah_out` sama-sama nol | 840 |
| `jumlah_in` dan `jumlah_out` sama-sama positif | 0 |
| Memiliki `detail_transaction` | 18.961 |
| Tidak memiliki `detail_transaction` | 125.737 |
| Memiliki `no_faktur_list` | Tidak ditemukan pada sampel field yang diaudit |

`jumlah_in` dan `jumlah_out` menjadi sumber penentuan arah dana. Field `jenis` sendiri tidak cukup untuk menentukan debit/kredit. Tidak ditemukan nilai `CREDIT` pada cabang ini; nilai jenis yang terbaca adalah `CASH`, `DEBET`, dan `TRANSFER`, ditambah satu varian jenis yang tidak dapat didekripsi bersih.

## Inventaris kombinasi jenis/status/kategori

Semua status yang terbaca adalah `OPEN`. Karena status final belum terbukti dari kode/data sumber, kombinasi di bawah **belum direkomendasikan untuk auto-posting**.

| Jenis | Status | Kategori terbaca | Jumlah | Total masuk | Total keluar | Rekomendasi awal |
| --- | --- | --- | ---: | ---: | ---: | --- |
| CASH | OPEN | PENJUALAN | 58.940 | Rp104.836.799.800 | Rp0 | REVIEW_ADMIN |
| CASH | OPEN | PEMBELIAN | 52.506 | Rp0 | Rp104.541.809.200 | REVIEW_ADMIN |
| [tidak terbaca bersih] | OPEN | SALDO AWAL | 12.045 | Rp17.687.128.004.520 | Rp0 | IGNORE untuk auto-post |
| CASH | OPEN | kategori tidak terbaca | 6.878 | - | - | REVIEW_ADMIN |
| DEBET | OPEN | PENJUALAN | 6.475 | Rp17.007.563.220 | Rp0 | REVIEW_ADMIN |
| TRANSFER | OPEN | PENJUALAN | 4.232 | Rp12.982.175.000 | Rp0 | RECONCILIATION |
| CASH | OPEN | SALDO AWAL | 1.737 | Rp297.114.848.803 | Rp0 | IGNORE untuk auto-post |
| CASH | OPEN | SERVICE | 777 | Rp45.265 | Rp0 | REVIEW_ADMIN |
| CASH | OPEN | kategori tidak terbaca | 555 | - | - | REVIEW_ADMIN |
| CASH | OPEN | kategori tidak terbaca | 112 | - | - | REVIEW_ADMIN |
| CASH | OPEN | KIRIM UANG | 100 | Rp0 | Rp5.176.705.000 | RECONCILIATION |
| CASH | OPEN | kategori tidak terbaca | 64 | - | - | REVIEW_ADMIN |
| CASH | OPEN | BATAL/varian tidak terbaca | 51 | - | - | RECONCILIATION |
| CASH | OPEN | KAS KECIL | 49 | Rp1.108.814.930 | Rp2.743.573.930 | REVIEW_ADMIN |
| CASH | OPEN | BATAL BELI | 40 | Rp139.362.000 | Rp0 | RECONCILIATION |
| CASH | OPEN | LM ANTAM | 34 | Rp0 | Rp310.788.000 | REVIEW_ADMIN |
| CASH | OPEN | kategori tidak terbaca | 32 | - | - | REVIEW_ADMIN |
| CASH | OPEN | ANTAM | 19 | Rp751.135.000 | Rp836.266.000 | REVIEW_ADMIN |
| CASH | OPEN | kategori tidak terbaca | 12 | - | - | REVIEW_ADMIN |
| TRANSFER | OPEN | PEMBELIAN | 9 | Rp0 | Rp163.145.000 | RECONCILIATION |
| CASH | OPEN | BATAL/varian tidak terbaca | 8 | - | - | RECONCILIATION |
| CASH | OPEN | kategori tidak terbaca | 7 | - | - | REVIEW_ADMIN |
| CASH | OPEN | KAS BESAR | 4 | Rp50.000.000 | Rp200.900.000 | RECONCILIATION |
| CASH | OPEN | BELANJA | 3 | Rp184.403.000 | Rp184.403.000 | REVIEW_ADMIN |
| CASH | OPEN | BATAL/varian tidak terbaca | 3 | - | - | RECONCILIATION |
| CASH | OPEN | BATAL DEBIT/varian | 2 | Rp3.831.000 | Rp0 | RECONCILIATION |
| CASH | OPEN | TITIPAN | 1 | Rp988.000 | Rp0 | REVIEW_ADMIN |
| TRANSFER | OPEN | BATAL/varian tidak terbaca | 1 | Rp0 | Rp2.236.000 | RECONCILIATION |
| CASH | OPEN | kategori tidak terbaca | 1 | - | - | REVIEW_ADMIN |

Nominal `-` sengaja tidak ditulis sebagai total karena kategori tersebut belum terbaca aman dari data terenkripsi. Data aslinya tetap berada di database sumber.

## Temuan per field

### `no_reff`, `deskripsi`, dan `keterangan`

Field tersebut dapat menjadi kandidat referensi, tetapi tidak boleh dipakai sebagai pasangan transaksi hanya karena tampil sama. Satu deskripsi dapat menghubungkan beberapa faktur atau beberapa catatan pembayaran. Matching harus memprioritaskan request ID/referensi transfer unik, lalu memakai nominal, tanggal, rekening, dan kode toko sebagai bukti tambahan.

### `detail_transaction` dan nomor faktur

`detail_transaction` hanya ada pada sebagian dokumen. Nomor faktur harus diperlakukan sebagai daftar detail, bukan sebagai satu transaksi Finance baru per faktur. Satu `tt_cash_daily` dapat membayar lebih dari satu faktur sekaligus; membuat jurnal per faktur akan menggandakan nilai.

### `no_rekening` dan `kode_bank`

Untuk arah `TRANSFER` atau `DEBET`, pemetaan harus mencocokkan nomor rekening, kode bank, unit, dan konteks cabang. Nomor rekening saja tidak cukup karena nomor yang mirip di bank berbeda dapat menunjuk akun berbeda.

### `CASH`

`CASH` tidak boleh dipaksa masuk ke rekening bank. Jika `no_rekening` kosong dan kombinasi unit + kode toko memiliki mapping, gunakan akun **Kas Tunai Toko** cabang tersebut. Kas Tunai Toko tidak boleh otomatis disamakan dengan Kas Kecil Operasional.

### `status`

`OPEN` adalah status yang ditemukan, tetapi audit ini belum menemukan bukti bahwa `OPEN` berarti transaksi final untuk diposting. Karena itu hasil fetch harus tetap masuk pemeriksaan Integrasi & Sinkronisasi dan tidak boleh langsung mengubah saldo confirmed.

## Risiko utama

1. Kategori transaksi `PENJUALAN`/`SERVICE` yang sudah dicatat Admin dapat ditemukan kembali sebagai penerimaan sumber dan menggandakan saldo.
2. `TRANSFER`, `KIRIM UANG`, `KAS BESAR`, serta kategori pembatalan berpotensi merepresentasikan mutasi yang sama dengan request transfer Finance.
3. Kategori `SALDO AWAL` dapat menggandakan `tt_saldo_awal` jika diposting sebagai transaksi biasa.
4. Nilai terenkripsi yang tidak terbaca bersih tidak boleh dipetakan berdasarkan tebakan nama.
5. Tidak adanya status selain `OPEN` pada cabang ini belum membuktikan bahwa semua data final.

