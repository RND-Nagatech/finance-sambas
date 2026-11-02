# Analisis Finalitas Transaksi Nagagold — Stage 4D

## Bukti status sumber

Pada repository Nagagold:

- `CashRepositories.ValidasiCash` menjalankan update `{ status: "DONE" }` menjadi `{ status: "OPEN", is_validate: true }`.
- `ValidasiByDeskripsi`, `ValidasiByNoFaktur`, dan varian lain juga membuka kembali data `CLOS` menjadi `OPEN` dengan `is_validate=true`.
- Banyak laporan cash, laporan penjualan, dan query relasi menggunakan `status: "OPEN"` sebagai data aktif yang dibaca.
- `status_valid: "DONE"` berada pada dokumen transaksi penjualan/pembelian, bukan bukti bahwa `tt_cash_daily.status` `OPEN` sudah final.

## Kesimpulan

`OPEN` adalah status operasional/administratif untuk cash daily yang masih dipakai dalam relasi dan laporan. `is_validate=true` adalah tanda validasi administratif. Keduanya belum dapat dijadikan syarat finalitas akuntansi Finance.

Finance harus memakai status final terpisah, misalnya `FINAL_CONFIRMED`, hanya setelah ada bukti bisnis yang disepakati. Sampai saat itu:

- `OPEN` → `OPEN_UNVERIFIED`;
- status kosong atau status baru yang belum dipahami → `FINALITY_UNPROVEN`;
- nilai final yang belum punya bukti kode → tidak boleh di-auto-post;
- perubahan source setelah snapshot → perlu review/reconciliation.

## Siklus transaksi yang terlihat

1. Modul transaksi membuat baris `tt_cash_daily` dengan `jumlah_in` atau `jumlah_out`.
2. `deskripsi` dapat berisi `no_faktur_group`, sehingga beberapa faktur dapat berbagi satu catatan pembayaran.
3. Validasi cash dapat mengubah `DONE`/`CLOS` menjadi `OPEN` dan menandai `is_validate`.
4. Laporan membaca baris `OPEN` dan menghubungkannya ke penjualan/pembelian/service.
5. Pembatalan menulis koreksi dengan kategori `BATAL ...` dan referensi transaksi asal.

Karena satu baris dapat memiliki beberapa nomor faktur, nomor faktur hanya detail referensi. Ia tidak boleh digunakan untuk menggandakan nominal atau jurnal.

## Finalitas yang dibutuhkan sebelum posting

Sebuah transaksi Nagagold baru bisa dipertimbangkan final apabila seluruh syarat berikut terbukti:

- source ID dan `sourceKey` valid;
- dokumen sumber masih dapat ditemukan pada database cabang yang tepat;
- `jumlah_in`/`jumlah_out` konsisten dan hanya satu arah yang bernilai;
- jenis/kategori dapat didekripsi dan memiliki aturan bisnis;
- akun kas/rekening unik dan sesuai cabang/unit;
- tidak merupakan saldo awal, pembatalan, atau mutasi yang belum direkonsiliasi;
- status final resmi dari Nagagold tersedia;
- tidak ada jurnal/pasangan/request yang menyebabkan double posting.

## Status dan perlakuan

| Kondisi | Status yang disarankan | Tindakan |
|---|---|---|
| `OPEN`, data lengkap, kategori dikenal, belum ada bukti final | `REVIEW_REQUIRED` | Review Admin; jangan posting otomatis |
| `OPEN`, snapshot atau mapping belum lengkap | `BLOCKED` | Lengkapi data atau mapping |
| Source berubah setelah snapshot | `RECONCILIATION_REQUIRED` | Bandingkan versi sumber dan Finance |
| `BATAL ...` | `RECONCILIATION_REQUIRED` | Hubungkan transaksi asal lalu buat reversal aman |
| `TRANSFER`/`KIRIM UANG`/`KAS BESAR` | `RECONCILIATION_REQUIRED` | Pastikan pasangan sumber/tujuan |
| Status final resmi, CASH penjualan/service, mapping unik, tanpa pasangan/jurnal | `AUTO_ELIGIBLE` kandidat | Hanya setelah aturan disetujui; posting tetap dimatikan |

## Data terenkripsi

Repository Nagagold menggunakan `Encryptor.encryptascii`/`decryptascii` dan `doEncrypt`/`doDecrypt`. Pada sampel SPW, Finance berhasil membaca sebagian besar `jenis`, tetapi masih menemukan varian `jenis` dan `kategori` yang tidak menghasilkan teks printable dengan key/mekanisme konfigurasi saat audit.

Nilai tersebut tidak boleh diberi arti berdasarkan kemiripan nama. Finance menyimpannya sebagai unreadable dan menahannya di review integrasi.

## Keputusan yang diperlukan

Owner dan pemilik proses Nagagold perlu menetapkan:

1. field atau event yang benar-benar menandai finalitas cash daily;
2. apakah finalitas per baris, per faktur, atau per batch validasi;
3. apakah settlement DEBET/CREDIT dianggap terjadi saat input atau saat settlement bank;
4. bagaimana retur, pembatalan, dan koreksi dikaitkan;
5. apakah perubahan `OPEN` setelah posting menghasilkan event koreksi yang dapat dipercaya.
