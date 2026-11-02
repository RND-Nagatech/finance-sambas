# Nagagold — Category Mapping Stage 4B

Tanggal: 29 Oktober 2026  
Ruang lingkup: hanya Nagagold dan collection sumber `tt_cash_daily`

## Keputusan klasifikasi

Klasifikasi disimpan di collection hasil sinkronisasi `tt_sinkronisasi` melalui field:

- `classification_status` — `AUTO_ELIGIBLE`, `REVIEW_REQUIRED`, `RECONCILIATION_REQUIRED`, atau `BLOCKED`;
- `classification_reason` — alasan keputusan yang dapat dibaca user;
- `classification_rule_version` — saat ini `4B.1`;
- `classification_proposal` — preview akun debit/kredit, tidak membuat jurnal;
- `classification_flags` — tanda risiko seperti `MATCHED_EXISTING`, `TRANSFER_LIKE`, atau `SOURCE_FINALITY_UNPROVEN`;
- `classified_at` dan `classified_by` — audit klasifikasi.

Field ini backward-compatible. Klasifikasi tidak mengubah `approval_status`, `journal_status`, `sync_status`, `status_valid`, saldo, jurnal, atau dokumen sumber.

## Bukti dari audit sumber

Audit read-only Tahap 4A menemukan pada cabang SPW:

- 144.698 dokumen `tt_cash_daily`;
- seluruh dokumen berstatus `OPEN`;
- arah dana harus ditentukan dari `jumlah_in` dan `jumlah_out`;
- ditemukan `CASH`, `DEBET`, `TRANSFER`, serta satu varian jenis yang tidak terbaca bersih;
- `detail_transaction` hanya ada pada sebagian data;
- satu dokumen sumber dapat memiliki beberapa nomor faktur.

Kode Nagagold yang tersedia menggunakan `Encryptor.encryptascii`/`decryptascii` berbasis key yang sama. Nilai yang tidak dapat menghasilkan teks printable tidak ditebak atau dipaksa menjadi kategori lain. Kode sumber yang tersedia juga belum memberikan bukti bahwa status `OPEN` adalah status final akuntansi; status tersebut diperlakukan sebagai belum final.

## Aturan kategori

| Jenis/kategori | Arti operasional yang dapat dipastikan | Arah dana | Klasifikasi saat ini | Aturan akun |
| --- | --- | --- | --- | --- |
| `CASH` + `PENJUALAN` | Penerimaan penjualan tunai berdasarkan kategori sumber | Dari `jumlah_in`/`jumlah_out` | `REVIEW_REQUIRED` untuk status `OPEN`; dapat menjadi `AUTO_ELIGIBLE` hanya jika finalitas disahkan | `KAS_TUNAI_TOKO` sesuai unit + kode toko |
| `CASH` + `SERVICE` | Penerimaan service tunai | Dari angka masuk/keluar | `REVIEW_REQUIRED` sampai aturan service disetujui | `KAS_TUNAI_TOKO` sesuai unit + kode toko |
| `CASH` + `PEMBELIAN`/`BELANJA` | Pengeluaran pembelian/belanja | Dari angka masuk/keluar | `REVIEW_REQUIRED` | Akun kas tunai yang benar; tidak otomatis Kas Kecil Operasional |
| `DEBET` | Label sumber yang belum cukup untuk menentukan arti debit jurnal Finance | Tidak boleh ditentukan dari nama `DEBET` | `REVIEW_REQUIRED` | Perlu bukti rekening/bank dan arti bisnis |
| `TRANSFER` | Mutasi rekening atau perpindahan dana sumber | Dari angka masuk/keluar | `RECONCILIATION_REQUIRED` | Cocokkan rekening, bank, cabang, request, dan transaksi Finance |
| `KIRIM UANG`/`KAS BESAR` | Kategori yang berpotensi menjadi mutasi antar kas | Dari angka masuk/keluar | `RECONCILIATION_REQUIRED` | Jangan membuat jurnal kedua jika mutasi sudah tercatat |
| `SALDO AWAL` | Data pembukaan saldo, bukan mutasi operasional biasa | Biasanya masuk | `BLOCKED` | Gunakan proses `tt_saldo_awal` dan jurnal `OPENING` |
| `BATAL*` | Peristiwa pembatalan/koreksi | Harus dilihat bersama transaksi asal | `RECONCILIATION_REQUIRED` | Reversal hanya setelah transaksi asal terverifikasi |
| Kategori terenkripsi/tidak dikenal | Belum ada bukti arti bisnis | Tidak diketahui | `BLOCKED` | Tidak boleh dipetakan berdasarkan tebakan |

## Prioritas keamanan

Urutan keputusan mesin adalah:

1. Data tidak memiliki `sourceKey`, ID sumber, nominal valid, atau mapping akun unik → `BLOCKED`.
2. Data sudah `MATCHED`, memiliki kandidat rekonsiliasi, request terkait, atau jurnal existing → `RECONCILIATION_REQUIRED`; hubungan existing diprioritaskan agar tidak dibuat jurnal kedua.
3. Kategori transfer/pembatalan/saldo awal mengikuti aturan khusus di atas.
4. Status sumber `OPEN` yang finalitasnya belum terbukti → `REVIEW_REQUIRED`.
5. Hanya transaksi `CASH` kategori `PENJUALAN`/`SERVICE`, mapping Kas Tunai Toko tepat, status final terbukti, dan tidak punya pasangan/jurnal existing yang dapat menjadi `AUTO_ELIGIBLE`.

`AUTO_ELIGIBLE` berarti kandidat untuk tahap berikutnya, bukan instruksi posting. Pada deployment saat ini tidak ada jalur yang membuat jurnal atau mengubah saldo dari klasifikasi tersebut.

## Mapping rekening

- `CASH` harus menggunakan `bentuk_saldo=KAS_TUNAI`, `jenis_akun=KAS_TUNAI_TOKO`, unit yang sesuai, dan `kode_toko` yang sama.
- Transaksi non-CASH harus menggunakan `bentuk_saldo=REKENING_BANK`, dengan nomor rekening dan kode bank yang cocok bila tersedia.
- `KAS_TUNAI_TOKO` tidak disamakan dengan `KAS_KECIL_OPERASIONAL`.
- Jika beberapa rekening cocok atau tidak ada rekening cocok, hasilnya ditahan; sistem tidak memilih secara acak.
- Preview jurnal memakai satu peristiwa sumber. Beberapa faktur dalam `detail_transaction` hanya menjadi detail referensi, bukan beberapa jurnal.

