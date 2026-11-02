# Product Requirements Document

## Finance Sambas

**Versi:** 0.1  
**Tanggal:** 28 Oktober 2026  
**Status:** Draft untuk review

## 1. Ringkasan produk

Finance Sambas adalah program pencatatan dan verifikasi perpindahan dana yang terhubung dengan sistem Nagagold. Program ini menjadi tempat terpusat untuk mencatat request dana dari cabang, transaksi transfer yang dilakukan Admin, proses approval oleh Owner, jurnal, serta laporan keuangan.

Tahap pertama berfokus pada alur pembayaran buyback Nagagold. Optik, transaksi operasional yang lebih luas, dan integrasi langsung dari program Nagagold dapat ditambahkan secara bertahap.

## 2. Latar belakang dan masalah

Saat ini permintaan transfer dari cabang belum tercatat secara sistematis. Admin atau pihak terkait dapat melakukan transfer dari kas besar, tetapi pencatatan sering baru direkap kemudian ketika waktu Owner tersedia.

Akibatnya:

- request dari cabang sulit ditelusuri;
- waktu request, transfer, dan approval tidak tercatat dalam satu alur;
- laporan tidak langsung tersedia setelah transaksi dilakukan;
- transaksi yang ditolak belum memiliki mekanisme jurnal balik yang jelas;
- Owner kesulitan memverifikasi banyak transaksi sekaligus.

## 3. Tujuan produk

1. Mencatat setiap request dana dari cabang dengan identitas cabang yang jelas.
2. Mencatat transaksi aktual yang dilakukan Admin.
3. Menyediakan daftar transaksi yang perlu diverifikasi Owner.
4. Mendukung approve/reject satu transaksi maupun beberapa transaksi sekaligus.
5. Membuat laporan segera setelah input transaksi.
6. Menjaga audit trail dan membuat jurnal balik ketika transaksi ditolak.
7. Menyediakan struktur rekening Kas Utama, Kas Besar, dan Kas Kecil yang fleksibel.
8. Menyediakan master bank yang dipilih saat membuat rekening.

## 4. Sasaran pengguna

| Pengguna | Kebutuhan utama |
|---|---|
| Admin Finance | Menerima request, mencatat transfer, memilih kas sumber/tujuan, dan melihat status transaksi |
| Owner | Memeriksa detail transaksi, approve/reject, dan memantau laporan |
| Sistem Nagagold | Mengirim request kebutuhan dana dari cabang |

Pada MVP tersedia login berbasis session backend. Hanya satu akun awal `SUPER_USER` yang dikonfigurasi melalui environment server lalu diimpor dengan `npm run seed` ke collection `tm_user`. Password disimpan sebagai hash, sedangkan aplikasi membaca user aktif dari MongoDB. User dengan role `ADMIN` atau `OWNER` akan dikelola kemudian melalui menu Data User.

## 5. Ruang lingkup MVP

### Termasuk

- Dashboard Finance;
- master rekening dengan pilihan kelompok Kas Utama, Kas Besar, atau Kas Kecil;
- identitas cabang dari `kode_toko` pada payload request;
- penerimaan request dari Nagagold melalui API/Postman;
- request pembayaran buyback;
- input transaksi oleh Admin;
- transaksi tunai dan non-tunai;
- daftar transaksi pending approval;
- detail transaksi;
- approve/reject satu atau banyak transaksi;
- jurnal provisional;
- jurnal reversal ketika transaksi ditolak;
- laporan transaksi berdasarkan status, cabang, akun, dan periode;
- notifikasi request baru dan transaksi yang menunggu approval;
- login dan logout user Finance;
- penyimpanan MongoDB.

### Tidak termasuk MVP

- perubahan pada program Nagagold sebagai pengirim request;
- manajemen user dari UI dan permission yang lebih rinci per menu;
- integrasi bank otomatis;
- upload dan penyimpanan bukti transfer secara penuh;
- approval bertingkat;
- rekonsiliasi bank otomatis;
- perhitungan fitur `interval: 10`;
- implementasi operasional modul Optik secara lengkap.
- integrasi langsung ke seluruh database cabang; tahap awal connector dapat diuji pada satu cabang Nagagold terlebih dahulu.

## 6. Prinsip bisnis

### 6.1 Request dan transaksi adalah objek berbeda

Request menjawab: “cabang membutuhkan dana untuk apa?”

Transaksi menjawab: “Admin sudah melakukan perpindahan dana apa?”

Request tidak langsung membuat jurnal. Jurnal dibuat ketika Admin mencatat transaksi aktual dan menghubungkannya dengan `request_id`.

### 6.2 Transaksi harian dari Nagagold

Selain request transfer, Finance akan menerima transaksi harian dari Nagagold. Sumber awalnya adalah collection `tt_cash_daily` pada database masing-masing cabang Nagagold. Data tersebut dapat berasal dari penjualan, pembelian, dan proses lain yang mempengaruhi rekening operasional.

Nilai `jenis` pada sumber Nagagold adalah klasifikasi cara transaksi: `TRANSFER`, `DEBET`, atau `CREDIT`. Arah penambahan/pengurangan saldo ditentukan dari `jumlah_in` dan `jumlah_out`:

- `jumlah_in` berarti saldo rekening bertambah;
- `jumlah_out` berarti saldo rekening berkurang;
- Finance tidak boleh mengartikan `DEBET` atau `CREDIT` hanya berdasarkan nama jenisnya.

Transaksi sumber ini berbeda dengan transfer internal Finance. Transfer internal memiliki rekening sumber dan tujuan. Transaksi penjualan/pembelian dari `tt_cash_daily` biasanya hanya menunjuk satu rekening operasional dan memiliki lawan transaksi berupa kategori bisnis. Karena itu Finance menggunakan dua bentuk transaksi:

- `TRANSFER_INTERNAL`: dua rekening Finance, untuk mutasi antar rekening;
- `MUTASI_REKENING`: satu rekening operasional, arah `MASUK` atau `KELUAR`, untuk data import Nagagold.

Model dan jurnal Finance harus mendukung keduanya. Data import tidak boleh dibuat-buat memiliki rekening sumber atau rekening tujuan kedua.

Dokumen `tt_cash_daily` tidak memiliki `kode_toko`. Karena database setiap cabang berbeda, connector wajib menambahkan konteks cabang dari koneksi yang sedang diproses. Pemetaan minimalnya adalah `database sumber -> kode_toko`; bila diperlukan nama cabang disimpan sebagai snapshot.

Data sumber tidak diubah oleh Finance. Finance menyimpan salinan ter-normalisasi beserta `sumber_sistem`, `sumber_koleksi`, `sumber_id`, `sumber_no_reff`, dan `kode_toko` untuk audit serta idempotensi.

### 6.3 Enkripsi data sumber Nagagold

Ketika `ENCRYPTION_MODE` aktif, string pada `tt_cash_daily` dienkripsi oleh `Encryptor` Nagagold secara rekursif. Angka nominal tidak dienkripsi oleh proses tersebut. Beberapa field dikecualikan dari dekripsi, termasuk `no_reff`, `tanggal`, `deskripsi`, `input_date`, `no_faktur`, `kode_bank`, `_id`, `status`, dan `no_faktur_list`.

Finance tidak menyimpan atau menyalin kunci aplikasi Nagagold. Normalisasi/dekripsi dilakukan melalui connector di lingkungan Nagagold atau endpoint Nagagold yang mengembalikan data ter-normalisasi. Nilai `deskripsi` diperlakukan sebagai referensi opaque, bukan sebagai nomor rekening atau identitas cabang.

Apabila suatu field gagal dinormalisasi, record tidak boleh langsung mempengaruhi saldo. Record tersebut masuk daftar perlu diperiksa dengan alasan kegagalan dan referensi sumbernya.

### 6.4 Fetch berkala

Worker mengambil data Nagagold setiap 10 menit per cabang. Finance membaca daftar cabang aktif dari `tm_cabang`, membuka koneksi langsung ke database sumber masing-masing, lalu membaca collection `tt_cash_daily`. Window mengambil data dari cursor sebelumnya sampai waktu fetch saat ini, menggunakan overlap dan idempotensi berdasarkan kombinasi `kode_toko`, `sumber_koleksi`, dan `sumber_id`. Key dekripsi yang sama untuk semua cabang disimpan di `NAGAGOLD_DECRYPTION_KEY` pada `.env`.

Karena schema `tt_cash_daily` tidak memiliki `updatedAt`, worker juga melakukan rekonsiliasi rolling beberapa hari terakhir (`NAGAGOLD_SYNC_RECONCILE_DAYS`). Ini diperlukan untuk menangkap perubahan status `CLOS` menjadi `OPEN` pada dokumen yang sudah pernah terbaca.

### 6.5 Validasi transaksi hasil fetch

Data hasil fetch ditampilkan di menu **Transaksi Nagagold** dengan alur:

```text
FETCHED / tersimpan di tt_sinkronisasi
  -> MENUNGGU_VALIDASI_ADMIN
  -> PENDING_APPROVAL
  -> APPROVED / REJECTED
```

Validasi Admin hanya memeriksa dan memetakan data. Saldo rekening tidak berubah pada tahap `FETCHED` maupun `MENUNGGU_VALIDASI_ADMIN`. Saldo `tm_rekening.saldo_akhir` dan jurnal final hanya berubah setelah Owner melakukan `APPROVED`.

Untuk transaksi yang ditolak sebelum posting, tidak perlu membuat jurnal balik karena belum ada saldo yang diposting. Jurnal balik hanya diperlukan jika transaksi Finance sebelumnya sudah memposting saldo lalu dilakukan koreksi.

### 6.6 Transaksi CASH dan pembatalan

`CASH` pada Nagagold adalah metode pembayaran, bukan rekening bank. Jika Finance ingin menghitung saldo uang tunai cabang, perlu dibuat akun virtual `KAS_TUNAI` per cabang dan dipetakan otomatis dari `kode_toko`. Tanpa akun tersebut, transaksi `CASH` tetap masuk daftar import tetapi berstatus `PERLU_PEMETAAN` dan tidak mengubah saldo bank.

Pembatalan dari Nagagold masuk sebagai event baru. Finance tidak menghapus transaksi awal. Baris `BATAL PENJUALAN`, `BATAL BELI`, atau kategori koreksi lain akan mengurangi/menambah saldo sesuai `jumlah_in` dan `jumlah_out`, lalu tetap melewati validasi Admin dan approval Owner.

### 6.2 Identitas cabang wajib

Setiap request harus memiliki `kode_toko`. Untuk data Sambas saat ini, contoh cabang yang tersedia di `tp_system` adalah:

```json
{
  "kode_toko": "QBS",
  "nama_toko": "BACKUP SAMBAS #1"
}
```

`kode_toko` menjadi business key. `nama_toko` dapat dikirim oleh Nagagold sebagai snapshot, tetapi Finance tidak wajib mengakses database Nagagold.

### 6.3 Status validasi

Transaksi yang baru dicatat Admin belum tervalidasi:

```text
status = PENDING_APPROVAL
status_valid = false
```

Setelah Owner menyetujui:

```text
status = APPROVED
status_valid = true
```

Jika Owner menolak:

```text
status = REJECTED
status_valid = false
```

Transaksi rejected tidak dihapus. Jurnal awal tetap disimpan dan jurnal balik dibuat berdasarkan tanggal reject.

## 7. Klasifikasi request dan transaksi

`jenis_request` digunakan untuk menjelaskan alasan atau kebutuhan dana. Contoh:

- `PEMBAYARAN_BUYBACK`;
- `SALDO_AWAL`;
- `TAMBAHAN_OPERASIONAL`;
- `PENARIKAN_DANA`;
- `LAINNYA`.

`jenis_transaksi` digunakan untuk menjelaskan jenis pencatatan keuangan. Contoh:

- `PEMBELIAN`;
- `TRANSFER_INTERNAL`;
- `PENJUALAN`;
- `KOREKSI`.

Contoh pemetaan:

| Kebutuhan | `jenis_request` | `jenis_transaksi` |
|---|---|---|
| Pembayaran buyback | `PEMBAYARAN_BUYBACK` | `PEMBELIAN` |
| Pengisian saldo awal | `SALDO_AWAL` | `TRANSFER_INTERNAL` |
| Dana operasional toko | `TAMBAHAN_OPERASIONAL` | `TRANSFER_INTERNAL` |
| Penarikan dana dari cabang | `PENARIKAN_DANA` | `TRANSFER_INTERNAL` |

Dengan pemisahan ini, penamaan tetap konsisten ketika kebutuhan baru muncul.

## 8. Struktur kas dan rekening

Kelompok kas adalah atribut langsung pada setiap rekening. Finance tidak membuat rekening virtual parent-child dan tidak meminta pilihan toko saat membuat rekening. Toko/cabang dicatat pada request atau transaksi yang menggunakannya.

| Kelompok rekening | Unit yang dapat dipilih | Penggunaan |
|---|---|---|
| `KAS_UTAMA` | `PUSAT` | Rekening utama pusat |
| `KAS_BESAR` | `NAGAGOLD` atau `OPTIK` | Rekening sumber dana unit bisnis |
| `KAS_KECIL` | `NAGAGOLD` atau `OPTIK` | Rekening operasional toko |

Saat membuat rekening, Admin memilih kelompok rekening, unit bisnis bila diperlukan, bank dari master bank, nama rekening, nomor rekening, dan status aktif. Toko tidak dipilih di master rekening karena satu rekening Kas Kecil dapat dipakai sebagai tujuan request dari cabang yang dikirim oleh sistem sumber.

Saldo akhir setiap rekening disimpan pada `tm_rekening.saldo_akhir` dan diperbarui saat saldo awal atau transaksi approved mengubah posisi rekening. Akun nonaktif tidak boleh dipakai untuk transaksi baru dan akun sumber/tujuan tidak boleh sama.

## 9. Alur utama

### 9.1 Request dari Nagagold

1. Nagagold mengirim request melalui API atau Postman.
2. Finance memvalidasi `source_system`, `request_id`, `kode_toko`, nominal, dan rekening.
3. Finance menyimpan `kode_toko` dan nama toko snapshot bila dikirim oleh Nagagold.
4. Finance menyimpan request dengan status `REQUESTED`.
5. Admin melihat request pada menu Request Cabang.

Request yang sama berdasarkan kombinasi `source_system` dan `request_id` tidak boleh membuat data duplikat.

### 9.1.1 Import transaksi dari Nagagold `tt_cash_daily`

Selain request transfer, Finance akan menerima atau mengambil data transaksi harian dari collection `tt_cash_daily` milik Nagagold.

Ketentuannya:

- `tt_cash_daily` adalah sumber eksternal dan bersifat read-only dari sisi Finance;
- Finance tidak mengubah dokumen di `tt_cash_daily`;
- data yang diambil dipetakan ke `tt_sinkronisasi` Finance;
- setiap data menyimpan referensi sumber berupa `sumber_sistem`, `sumber_koleksi`, dan `sumber_id`;
- proses import harus idempotent agar data yang sama tidak menjadi transaksi ganda;
- default MVP, transaksi hasil import masuk `MENUNGGU_VALIDASI_ADMIN`, lalu menjadi `PENDING_APPROVAL` setelah Admin memetakan rekening; saldo belum memengaruhi rekening sampai disetujui Owner;
- data yang tidak dapat dipetakan ke rekening Finance tidak boleh langsung diposting dan harus masuk daftar perlu diperiksa;
- detail field dan aturan filter import menunggu contoh dokumen aktual dari `tt_cash_daily`.

### 9.2 Pencatatan oleh Admin

1. Admin memilih request yang akan diproses atau membuat transaksi manual.
2. Admin mengisi tanggal transfer, rekening sumber Kas Besar, rekening tujuan, nominal, dan catatan.
3. Sistem memvalidasi nominal lebih besar dari nol serta akun sumber dan tujuan aktif.
4. Sistem membuat transaksi `PENDING_APPROVAL`.
5. Sistem membuat jurnal provisional.
6. Request terkait berubah menjadi `COMPLETED` setelah transaksi berhasil dibuat.

### 9.3 Approval oleh Owner

1. Owner membuka menu Perlu Verifikasi.
2. Owner dapat memfilter transaksi berdasarkan tanggal, cabang, jenis, kas, dan nominal.
3. Owner membuka detail jika diperlukan.
4. Owner mencentang transaksi tertentu atau menggunakan checkbox semua pada hasil filter.
5. Owner memilih Approve Terpilih.
6. Sistem meminta konfirmasi.
7. Sistem mengubah transaksi menjadi `APPROVED` dan `status_valid = true`.
8. Jurnal provisional menjadi jurnal approved; tidak dibuat jurnal uang tambahan.

### 9.4 Reject oleh Owner

1. Owner memilih satu atau beberapa transaksi.
2. Owner mengisi alasan reject.
3. Sistem mengubah transaksi menjadi `REJECTED`.
4. Sistem mempertahankan jurnal awal.
5. Sistem membuat jurnal reversal dengan tanggal reject.
6. Sistem mencatat aksi Owner dan alasan reject pada audit log.

## 10. Jurnal

### Input transfer

Contoh transfer dari Kas Besar Nagagold ke rekening operasional QBS:

```text
Debit  : Rekening Operasional QBS  Rp10.000.000
Kredit : Kas Besar Nagagold        Rp10.000.000
Status : PROVISIONAL
```

### Approve

Jurnal awal berubah status menjadi `POSTED` atau `APPROVED`. Tidak ada jurnal baru.

### Reject

Jika transfer dicatat pada 28 Oktober dan ditolak pada 30 Oktober:

```text
Jurnal awal, 28 Oktober:
Debit  : Rekening Operasional QBS  Rp10.000.000
Kredit : Kas Besar Nagagold        Rp10.000.000

Jurnal balik, 30 Oktober:
Debit  : Kas Besar Nagagold        Rp10.000.000
Kredit : Rekening Operasional QBS  Rp10.000.000
```

Jurnal reversal menyimpan referensi ke jurnal atau transaksi awal. Total debit dan kredit setiap jurnal harus sama.

## 11. Kebutuhan fitur

### 11.1 Dashboard

- kartu saldo seluruh rekening pada Kas Utama;
- kartu saldo seluruh rekening Kas Besar Nagagold;
- kartu saldo seluruh rekening Kas Besar Optik;
- kartu total tunai dari transaksi approved yang bertanda `CASH`/`TUNAI`;
- tabel saldo akhir setiap rekening yang termasuk Kas Kecil;
- grafik arus kas approved masuk dan keluar per hari untuk tujuh hari terakhir;
- donut komposisi transaksi approved per kategori bisnis, dipisahkan antara Nagagold dan Optik. Kategori minimal adalah Penjualan, Pembelian, dan Service bila datanya tersedia;
- ringkasan transaksi yang menunggu approval dan struktur rekening aktif.

Grafik dashboard menggunakan agregasi harian karena sumber Finance menyimpan transaksi per tanggal dan belum memiliki snapshot saldo harian. Grafik ini menampilkan mutasi masuk/keluar, bukan mengarang saldo historis dari data yang belum tersedia.

### 11.2 Request Cabang

- daftar request dari sistem Nagagold;
- detail request;
- filter status, cabang, tanggal, dan jenis request;
- tombol Buat Transaksi Finance;
- indikator request sudah atau belum memiliki transaksi;
- penanganan request duplikat.

### 11.3 Input Transaksi

- tanggal transaksi;
- request terkait, opsional untuk transaksi manual;
- jenis request;
- jenis transaksi;
- kode toko;
- rekening sumber dari kelompok `KAS_BESAR` Nagagold atau Optik;
- rekening tujuan dari kelompok `KAS_KECIL` operasional toko;
- nominal;
- seluruh transaksi menggunakan transfer antar rekening/non-tunai;
- keterangan opsional;
- referensi atau bukti transfer bila tersedia.

### 11.4 Perlu Verifikasi

- checkbox per transaksi;
- checkbox semua transaksi yang sedang terfilter;
- detail transaksi;
- Approve Terpilih;
- Reject Terpilih;
- alasan reject wajib;
- preview jumlah data dan total nominal sebelum bulk action;
- riwayat approval dan reject.

### 11.5 Master Akun

- menampilkan tree akun;
- membuat rekening dengan kelompok Kas Utama, Kas Besar, atau Kas Kecil;
- menonaktifkan akun;
- mencari rekening berdasarkan unit atau cabang;
- nomor rekening ditampilkan penuh untuk pengguna internal.
- menampilkan saldo akhir setiap rekening berdasarkan saldo awal approved dan transaksi approved;
- saldo tersedia untuk validasi transaksi tetap memperhitungkan transaksi keluar yang masih pending.

### 11.6 Saldo Awal Rekening

- Admin dapat mencatat saldo awal untuk setiap rekening aktif;
- saldo awal masuk status `PENDING_APPROVAL` terlebih dahulu;
- Owner dapat melihat detail, memilih beberapa data, lalu approve atau reject sekaligus;
- saldo awal yang approved menjadi dasar saldo tersedia rekening;
- saldo awal yang rejected tidak memengaruhi saldo dan menyimpan alasan reject;
- transaksi keluar yang masih pending menjadi reservasi saldo agar saldo tidak digunakan dua kali.

### 11.6 Laporan

Minimal tersedia:

- laporan semua input, termasuk pending;
- laporan approved;
- laporan rejected dan jurnal reversal;
- filter periode;
- filter cabang;
- filter jenis request dan jenis transaksi;
- filter kas sumber dan tujuan;
- detail jurnal dan relasi transaksi awal-reversal.

## 12. Kontrak request awal

Contoh payload dari Nagagold:

```json
{
  "request_id": "RQS-20261028-0001",
  "source_system": "nagagold",
  "jenis_request": "PEMBAYARAN_BUYBACK",
  "arah_dana": "KELUAR",
  "kode_toko": "QBS",
  "no_rekening": "1234567899",
  "nilai_rp": 10000000,
  "requested_at": "2026-10-28T09:00:00+07:00",
  "tujuan": "Pembayaran buyback"
}
```

Ketentuan:

- `request_id` unik dari sistem sumber;
- kombinasi `source_system` dan `request_id` idempotent;
- `kode_toko` wajib dikirim oleh sistem sumber dan tidak divalidasi Finance terhadap database Nagagold;
- `nilai_rp` harus berupa angka positif;
- `requested_at` disimpan sebagai waktu dengan timezone Asia/Jakarta;
- `tujuan` adalah keterangan bebas;
- nomor rekening ditampilkan penuh pada UI internal;
- request tidak langsung membuat jurnal.

## 13. Model data konseptual

### `tm_rekening`

Master akun kas dan rekening.

Field utama: `nama_rekening`, `kelompok_rekening`, `unit`, `bank_id`, `nomor_rekening`, `saldo_akhir`, `aktif`.

### `tm_bank`

Master bank yang tersedia untuk dipilih saat membuat rekening.

Field utama: `kode_bank`, `nama_bank`, `aktif`.

### `tt_request_transfer`

Request kebutuhan dana dari sistem sumber.

Field utama: `request_id`, `source_system`, `jenis_request`, `arah_dana`, `kode_toko`, `nama_toko_snapshot`, `no_rekening`, `nilai_rp`, `requested_at`, `tujuan`, `status`, `raw_reference`.

### `tt_sinkronisasi` dan `tt_mutasi`

Transaksi aktual yang diinput Admin.

### `tt_saldo_awal`

Catatan saldo awal per rekening yang menunggu validasi Owner.

Field utama: `rekening_id`, `tanggal`, `nilai`, `keterangan`, `status`, `status_valid`, `dibuat_oleh`, `disetujui_oleh`, `disetujui_pada`, `ditolak_oleh`, `ditolak_pada`, `alasan_penolakan`.

Field utama: `transaction_number`, `request_id`, `transaction_date`, `jenis_transaksi`, `jenis_request`, `kode_toko`, `source_account_id`, `destination_account_id`, `amount`, `status`, `status_valid`, `note`, `sumber_sistem`, `sumber_koleksi`, `sumber_id`, `diambil_pada`, `created_by`, `approved_by`, `rejected_by`, `rejection_reason`, `reversal`.

### `tt_keuangan`

Pencatatan pergerakan uang Finance. Satu dokumen menyimpan kategori, nominal,
status, nomor transaksi bila ada, dan detail rekening yang menerima debet atau
kredit. Collection ini bukan buku besar akuntansi double-entry.

### `th_approval`

Riwayat aksi approve/reject, actor, waktu, alasan, dan batch ID.

### `th_audit`

Riwayat perubahan data penting dan status.

### `th_notifikasi`

Notifikasi request baru dan transaksi yang memerlukan verifikasi.

## 14. Persyaratan non-fungsional

- Nominal rupiah disimpan sebagai integer atau Decimal, bukan floating point.
- Operasi approve/reject dan jurnal reversal harus atomik.
- Jurnal awal dan reversal tidak boleh dihapus.
- Semua waktu bisnis menggunakan timezone Asia/Jakarta.
- API harus idempotent untuk request dari sistem sumber.
- Nomor rekening ditampilkan penuh pada response dan tampilan internal.
- Collection MongoDB menggunakan nama tetap tanpa database name variable atau collection prefix variable.
- Koneksi MongoDB diisi melalui `MONGODB_URI`.
- Error validasi harus dikembalikan dengan pesan yang dapat dipahami Admin.

## 15. Kriteria penerimaan MVP

### Request cabang

- Given request dengan `kode_toko` valid, when dikirim, then request tersimpan dan muncul di menu Request Cabang.
- Given request yang sama dikirim ulang, when diproses, then tidak ada request duplikat.
- Given `kode_toko` dikirim oleh sistem sumber, when request dikirim, then Finance menyimpan request tanpa membutuhkan akses ke database Nagagold.

### Input transaksi

- Given Admin mengisi transaksi valid, when disimpan, then transaksi berstatus `PENDING_APPROVAL` dan `status_valid=false`.
- Given request disetujui Owner, when belum ada konfirmasi transfer, then request tetap `APPROVED`/`WAITING_TRANSFER` dan belum mengubah saldo.
- Given Admin mengonfirmasi transfer dengan referensi yang valid, then request menjadi `PAID`, transaksi Finance terhubung, dan jurnal posting hanya dibuat satu kali.
- Given akun sumber nonaktif, when dipilih, then transaksi tidak dapat disimpan.

### Approval

- Given transaksi pending dipilih, when Owner approve, then status menjadi `APPROVED` dan `status_valid=true`.
- Given beberapa transaksi pending dipilih, when Owner approve bulk, then semua transaksi yang valid diproses dan hasil tiap transaksi dapat ditelusuri.
- Given transaksi approved, when dicoba di-approve lagi, then sistem menolak karena status sudah final.

### Reject dan jurnal balik

- Given transaksi pending ditolak tanpa alasan, then sistem menolak aksi reject.
- Given transaksi pending ditolak dengan alasan, then status menjadi `REJECTED`; jurnal provisional ditandai `REVERSED` tanpa mengurangi saldo confirmed.
- Given transaksi yang sudah posted direversal, then jurnal kompensasi dibuat tepat satu kali dan saldo dikembalikan secara atomik.
- Given transaksi ditolak, then jurnal awal tetap tersedia dan tanggal jurnal reversal mengikuti tanggal reject.

### Laporan

- Given transaksi baru dicatat, then transaksi langsung muncul pada laporan pending.
- Given transaksi approved, then transaksi masuk laporan tervalidasi.
- Given transaksi rejected, then laporan menampilkan transaksi awal dan reversal secara terhubung.

## 16. Keputusan yang masih perlu dikonfirmasi

1. Apakah transaksi pending memengaruhi saldo operasional, atau hanya laporan pending?
2. Apakah transaksi manual tanpa `request_id` diperbolehkan untuk seluruh kebutuhan operasional?
3. Apakah satu request dapat dibayar melalui beberapa transaksi?
4. Apakah bukti transfer wajib atau tetap opsional?
5. Apakah metode kas sederhana cukup untuk MVP atau double-entry harus diterapkan penuh sejak awal?
6. Apakah Owner dapat mengoreksi transaksi approved melalui transaksi koreksi, atau perlu proses khusus?
7. Apakah nama collection sudah sama dengan standar Nagagold atau perlu disesuaikan lagi?

## 17. Rencana tahap berikutnya

### Tahap 1 — MVP Finance

- stabilisasi master akun;
- request API/Postman;
- input transaksi;
- approval dan rejection;
- jurnal provisional dan reversal;
- laporan dasar.

### Tahap 2 — Integrasi operasional

- integrasi langsung dari Nagagold;
- import transaksi harian dari collection `tt_cash_daily`;
- pemetaan transaksi sumber ke rekening Finance dan pencegahan duplikasi;
- notifikasi yang lebih lengkap;
- bukti transfer;
- pembaruan transaksi tunai dan non-tunai dari cabang;
- pengembangan struktur Optik.

### Tahap 3 — Kontrol dan rekonsiliasi

- manajemen user dan role permission yang lebih rinci;
- approval bertingkat bila diperlukan;
- rekonsiliasi rekening;
- ekspor laporan;
- audit dan koreksi transaksi yang lebih lengkap.

## 18. Tahap 3 — Approval, pembayaran, dan keamanan jurnal

Tahap 3 mempertahankan collection transaksi existing dan menambahkan kontrol berikut:

- `tt_request_transfer` memisahkan status request, approval, dan pembayaran. Alurnya `REQUESTED → PENDING_APPROVAL → APPROVED → WAITING_TRANSFER → PAID`.
- Approval request tidak memposting saldo. Saldo baru berubah saat Admin menyimpan realisasi transfer dengan nomor referensi.
- Transaksi Admin tetap membuat jurnal `PROVISIONAL`; approve mengubah jurnal yang sama menjadi `POSTED`; reject sebelum posting tidak membuat reversal yang mempengaruhi saldo.
- Reversal transaksi posted menggunakan jurnal `REVERSAL` yang idempotent dan terhubung ke jurnal asal.
- Approval massal diproses per transaksi dalam batch sehingga satu kegagalan tidak membatalkan hasil transaksi lain. Response mengembalikan `processed`, `ignored`, dan `failed`.
- `tt_keuangan` menyimpan pergerakan uang dengan tipe `SALDO_AWAL`, `MUTASI`, `PENJUALAN`, `PEMBELIAN`, `OPERASIONAL`, `TRANSAKSI`, atau `PEMBALIKAN`. Tidak ada akun lawan virtual dan tidak dipaksa seimbang seperti jurnal akuntansi.
- `tt_saldo_awal` menggunakan pencatatan bertipe `SALDO_AWAL`; saldo awal yang telah diterapkan tidak dapat diterapkan kembali untuk rekening dan tanggal yang sama.
- Jenis akun membedakan `KAS_TUNAI_TOKO`, `KAS_KECIL_OPERASIONAL`, `REKENING_BANK`, dan `KAS_BESAR` tanpa memindahkan saldo historical otomatis.
