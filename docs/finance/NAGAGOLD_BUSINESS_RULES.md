# Aturan Bisnis Nagagold — Stage 4D

Tanggal audit: 29 Oktober 2026  
Ruang lingkup: Nagagold, collection sumber `tt_cash_daily`, tanpa integrasi Optik.

## Kesimpulan eksekutif

`tt_cash_daily` memang merupakan sumber pergerakan uang Nagagold. Namun, satu baris sumber tidak selalu berarti satu transaksi Finance yang boleh langsung diposting. Baris tersebut dapat berupa penerimaan penjualan/service, pengeluaran pembelian, saldo awal, mutasi kas/rekening, atau pembatalan.

Aturan Finance Stage 4D:

1. Arah uang selalu berasal dari `jumlah_in` dan `jumlah_out`, bukan dari nama `jenis`.
2. `OPEN` dan `is_validate=true` belum cukup untuk menyatakan transaksi final secara akuntansi.
3. Setiap transaksi harus memiliki identitas sumber, nominal, arah dana, dan mapping akun yang unik.
4. Mutasi `TRANSFER`, `KIRIM UANG`, dan `KAS BESAR` harus direkonsiliasi sebelum posting.
5. Pembatalan harus dihubungkan ke transaksi asal sebelum reversal.
6. `SALDO AWAL` tidak diperlakukan sebagai transaksi operasional; gunakan alur saldo awal Finance.
7. Kandidat `AUTO_ELIGIBLE` hanya berarti layak dievaluasi untuk auto-posting pada tahap berikutnya. Auto-posting production tetap nonaktif.

## Bukti dari kode Nagagold

Audit repository Nagagold menemukan:

- `CashRepositories.ValidasiCash` mengubah semua `status: DONE` menjadi `status: OPEN` dan mengisi `is_validate=true`.
- `CashController.InCash`, `OutCash`, `MutasiUangCash`, dan `MutasiUangBank` menulis `jumlah_in`/`jumlah_out` ke `tt_cash_daily`.
- Laporan penjualan mengambil pembayaran dari `tt_cash_daily` melalui `deskripsi = no_faktur_group` dan memfilter `status: OPEN`.
- `MutasiUangCash` membuat dua baris untuk perpindahan bank ↔ cash. `MutasiUangBank` membuat dua baris `TRANSFER` untuk perpindahan bank ↔ bank.
- Pembatalan penjualan, pembatalan pembelian, dan pembatalan service membuat catatan koreksi yang harus dibaca bersama transaksi asal.

Dengan bukti tersebut, Finance tidak boleh menyamakan `OPEN` dengan `POSTED` atau `APPROVED`.

## Arti kategori dan perlakuan Finance

| Kategori/jenis | Arti yang didukung bukti kode | Arah dana | Akun yang disiapkan | Perlakuan | Keyakinan |
|---|---|---|---|---|---|
| `CASH` + `PENJUALAN` | Pembayaran penjualan tunai; dapat dirinci ke satu atau beberapa faktur melalui `deskripsi` dan `detail_transaction` | `jumlah_in` masuk atau `jumlah_out` keluar | `KAS_TUNAI_TOKO` sesuai cabang | Review Admin sampai finalitas disahkan; kandidat auto-posting hanya untuk data baru yang memenuhi semua syarat | Tinggi untuk hubungan ke penjualan, rendah untuk finalitas `OPEN` |
| `CASH` + `SERVICE` | Penerimaan service tunai; kode service membuat dan membaca cash daily | Berdasarkan angka sumber | `KAS_TUNAI_TOKO` sesuai cabang | Review Admin; jangan auto-post sebelum aturan service disetujui | Sedang |
| `CASH` + `PEMBELIAN`/`BELANJA` | Uang keluar untuk pembelian/belanja | Umumnya `jumlah_out`, tetap verifikasi field | Akun cash toko yang benar; bukan otomatis `KAS_KECIL_OPERASIONAL` | Review Admin dan validasi kategori | Tinggi untuk hubungan operasional, sedang untuk akun lawan |
| `DEBET` | Metode/kode pembayaran rekening yang dipakai pada penjualan; nama `DEBET` tidak menentukan sisi jurnal Finance | Sering masuk dari rekening, tetapi wajib dibuktikan dari angka dan rekening | `REKENING_BANK` + settlement yang benar | Review Admin; belum auto-post | Tinggi bahwa ini metode pembayaran, rendah untuk settlement final |
| `CREDIT` | Tidak ditemukan sebagai nilai jenis yang terbaca pada sampel SPW saat audit ini; source code menggunakannya sebagai metode pembayaran di beberapa laporan | Belum dapat dipastikan | Belum dipetakan | Review/blocked sampai ada data nyata dan aturan settlement | Rendah untuk SPW |
| `TRANSFER` | Perpindahan dana melalui rekening; juga digunakan oleh alur mutasi bank | Dari `jumlah_in`/`jumlah_out` | Rekening bank sumber/tujuan | Rekonsiliasi; satu mutasi sumber tidak boleh menjadi jurnal kedua | Tinggi |
| `KIRIM UANG`/`TERIMA UANG` | Label operasional pengiriman/penerimaan uang antar kas atau rekening | Berdasarkan angka | Akun sumber dan tujuan yang eksplisit | Rekonsiliasi dengan pasangan mutasi atau request | Tinggi untuk label, perlu bukti pasangan |
| `KAS BESAR`/`KAS KECIL` | Operasi kas internal | Berdasarkan angka | Akun kas yang sesuai jenisnya | Rekonsiliasi atau review; jangan mencampur kas tunai toko dan kas kecil operasional | Sedang |
| `SALDO AWAL` | Pembukaan saldo dan pembentukan saldo hari berikutnya | Umumnya masuk | `tt_saldo_awal` + jurnal `OPENING` Finance | Blocked dari posting transaksi biasa | Tinggi |
| `BATAL PENJUALAN`, `BATAL BELI`, `BATAL SERVICE`, `BATAL DEBET` | Pembatalan/koreksi transaksi asal | Kebalikan atau koreksi transaksi asal | Akun asal yang sudah diverifikasi | Rekonsiliasi lalu reversal/compensating entry | Tinggi untuk kebutuhan koreksi, perlu bukti pasangan |
| `TUKAR KURANG`, cashback, kelebihan bayar, dan kategori khusus | Penyesuaian pembayaran yang berhubungan dengan faktur | Bisa masuk atau keluar | Akun transaksi asal | Review/rekonsiliasi, tidak auto-post | Sedang |
| Kategori/jenis terenkripsi atau rusak | Arti belum dapat dibaca secara resmi | Tidak diketahui | Tidak boleh dipilih | `BLOCKED` | Tinggi |

## Matriks keputusan

| Kondisi | Hasil |
|---|---|
| Source ID/key, nominal, arah, snapshot, dan mapping unik tidak lengkap | `BLOCKED` |
| Teks jenis/kategori tidak terbaca atau key dekripsi tidak tersedia | `BLOCKED` |
| Status sumber `OPEN` tetapi finalitas belum dibuktikan | `REVIEW_REQUIRED` jika syarat lain lengkap; secara aktual data legacy tetap `BLOCKED` bila snapshot/mapping kurang |
| Sudah mempunyai jurnal, pasangan rekonsiliasi, kandidat pasangan, atau request terkait | `RECONCILIATION_REQUIRED` |
| `TRANSFER`, `KIRIM UANG`, `KAS BESAR`, atau pembatalan | `RECONCILIATION_REQUIRED` |
| `SALDO AWAL` | `BLOCKED`; gunakan proses saldo awal Finance |
| `CASH` penjualan/service, finalitas terbukti, mapping kas tunai cabang unik, tidak ada jurnal/pasangan/request, dan aturan disetujui | `AUTO_ELIGIBLE` sebagai kandidat masa depan |
| Metode `DEBET`/`CREDIT` tanpa bukti settlement | `REVIEW_REQUIRED` atau `BLOCKED` bila rekening/arah tidak lengkap |

## Approval dan laporan

- Semua hasil fetch tetap masuk `Transaksi Terintegrasi` dan `Semua Transaksi` sebagai data sumber.
- `REVIEW_REQUIRED` hanya perlu pemeriksaan Admin sesuai aturan integrasi.
- `APPROVAL_OWNER` hanya digunakan bila transaksi Finance memang menghasilkan kewajiban approval; hasil fetch tidak boleh otomatis dianggap approved.
- `MATCHED` hanya berarti pasangan transaksi ditemukan. Status tersebut tidak mengubah approval, payment, journal, atau saldo.
- Laporan harus membedakan nilai sumber, nilai provisional, dan saldo confirmed.

## Keputusan yang masih dibutuhkan

1. Status apa di Nagagold yang secara resmi berarti final secara akuntansi.
2. Apakah settlement kartu debit/credit dicatat saat transaksi atau saat dana masuk bank.
3. Daftar rekening settlement per cabang.
4. Aturan akuntansi kategori khusus dan pembatalan.
5. Persetujuan Owner sebelum kategori apa pun diaktifkan sebagai auto-posting.
