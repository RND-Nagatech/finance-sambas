# Rancangan Awal Program Finance Sambas

Dokumen ini adalah rancangan fungsional dan konseptual. Belum mencakup implementasi frontend, backend, atau pilihan framework.

## 1. Tujuan

Program Finance menjadi sumber pencatatan terpusat untuk seluruh perpindahan uang Sambas, dimulai dari alur Nagagold. Setiap transaksi yang diinput admin langsung terlihat dalam laporan, tetapi belum dianggap tervalidasi sampai disetujui Owner.

Rancangan ini menyelesaikan masalah utama berikut:

- permintaan transfer dari cabang belum tercatat secara sistem;
- pencatatan masih menunggu rekap manual di akhir bulan;
- Owner membutuhkan daftar transaksi yang dapat diperiksa dan diproses sekaligus;
- transaksi yang ditolak harus tetap memiliki jejak jurnal yang benar;
- transaksi tunai dan non-tunai perlu masuk ke laporan Finance.

## 2. Batasan tahap pertama

### Termasuk

- Finance Utama/Kas Utama;
- Kas Besar Nagagold;
- rekening atau kas tujuan di bawah Nagagold;
- input transfer oleh admin;
- request transfer buyback dari cabang melalui endpoint/API atau Postman;
- daftar transaksi menunggu verifikasi;
- detail transaksi dan riwayat perubahan;
- approve/reject satu atau banyak transaksi;
- jurnal transaksi awal dan jurnal balik ketika ditolak;
- laporan transaksi dengan status pending, approved, dan rejected;
- pencatatan transaksi tunai maupun non-tunai.

### Belum termasuk

- perubahan program Nagagold sebagai pengirim request;
- implementasi modul Optik secara operasional;
- perhitungan atau desain fitur `interval: 10` pada gambar;
- implementasi frontend dan backend;
- rekonsiliasi bank otomatis;
- alur approval bertingkat lebih dari satu approver.

Struktur data tetap dibuat extensible agar Optik dapat ditambahkan tanpa mengubah konsep inti.

## 3. Aktor dan hak akses

| Aktor | Tanggung jawab | Hak utama |
|---|---|---|
| Admin Finance | Mencatat transfer yang telah dilakukan dan melengkapi catatan | Membuat transaksi, melihat transaksi, mengirim untuk approval |
| Owner | Memverifikasi transaksi | Melihat detail, approve, reject, approve/reject secara bulk |
| Sistem Cabang Nagagold | Mengirim request kebutuhan pembayaran buyback | Membuat request melalui API/integrasi |
| Sistem Finance | Membuat jurnal, notifikasi, laporan, dan audit trail | Menjaga konsistensi status serta saldo |

Approval dilakukan oleh Owner, bukan oleh orang yang membuat input transfer. Sistem sebaiknya menolak approval oleh pembuat transaksi jika kebijakan segregation of duties diberlakukan.

## 4. Struktur hierarki kas

Setiap rekening disimpan sebagai data mandiri dengan kelompok rekening, unit, bank, dan nomor rekening. Cabang tidak disimpan pada master rekening; cabang dicatat pada request atau transaksi yang menggunakannya.

```text
Finance Utama / Kas Utama
├── Rekening Kas Utama 1
├── Rekening Kas Utama 2
├── Kas Besar Nagagold
│   ├── Rekening Kas Besar Nagagold 1
│   ├── Rekening Kas Besar Nagagold 2
│   └── Kas Kecil Operasional Toko Nagagold
│       └── Rekening Operasional QBS
└── Kas Besar Optik
    ├── Rekening Kas Besar Optik 1
    └── Kas Kecil Operasional Toko Optik
        └── Rekening Operasional Optik 1
```

Nama dan jumlah rekening dapat bertambah. Saat membuat akun/rekening, admin memilih:

- kelompok kas: `KAS_UTAMA`, `KAS_BESAR`, atau `KAS_KECIL`;
- unit bisnis: `NAGAGOLD` atau `OPTIK`;
- bank dari master bank;
- nomor rekening;
- nama dan status aktif.

Namun, level sebaiknya tidak sepenuhnya bebas diisi. Sistem memvalidasi struktur berikut:

- `KAS_UTAMA`, `KAS_BESAR`, dan `KAS_KECIL` menjadi klasifikasi rekening;
- rekening aktif hanya dapat dipakai sebagai sumber atau tujuan transaksi.

Dengan begitu, admin tetap dapat memilih rekening secara fleksibel, tetapi laporan tetap dapat mengelompokkan saldo berdasarkan Kas Utama, Kas Besar, Kas Kecil, unit bisnis, dan cabang.

Saldo akhir rekening tidak diinput manual pada master. Nilainya dihitung dari saldo awal yang sudah approved, ditambah dana masuk approved, dan dikurangi dana keluar approved. Untuk mencegah saldo terpakai ganda, validasi transaksi menggunakan saldo tersedia yang juga mengurangi transaksi keluar berstatus pending.

Contoh transaksi tahap pertama:

```text
Sumber  : Kas Besar Nagagold
Tujuan  : Rekening Operasional Cabang QBS / rekening 123
Nominal : Rp10.000.000
```

Catatan penting: rekening 123 sebaiknya disimpan sebagai akun kas yang terdaftar di sistem, bukan hanya teks bebas. Karena aplikasi ini digunakan oleh pengguna internal, nomor rekening ditampilkan penuh pada UI/API.

## 5. Alur bisnis utama

### A. Request buyback dari cabang

1. Cabang Nagagold mengirim request pembayaran, awalnya melalui Postman/API.
2. Finance menerima dan menyimpan request dengan status `REQUESTED`.
3. Request tampil sebagai notifikasi atau daftar pekerjaan admin.
4. Admin melakukan transfer secara aktual melalui kanal bank/kas.
5. Setelah transfer dilakukan, admin membuat transaksi Finance berdasarkan request tersebut.
6. Sistem membuat jurnal provisional dan transaksi masuk ke daftar approval Owner.

### C. Import transaksi harian dari Nagagold

Finance juga akan membaca data transaksi dari collection eksternal Nagagold `tt_cash_daily`. Collection tersebut bukan milik Finance dan tidak boleh diubah oleh Finance.

Alur awal:

1. Finance mengambil data baru atau data yang berubah berdasarkan cursor/tanggal terakhir yang berhasil diproses.
2. Connector mencatat konteks database sumber sebagai identitas cabang. Dokumen `tt_cash_daily` sendiri tidak memiliki `kode_toko`.
3. Finance memetakan field transaksi sumber ke rekening, tanggal, nominal, dan jenis transaksi Finance.
4. Finance menyimpan referensi `sumber_sistem`, `sumber_koleksi`, `sumber_id`, dan `kode_toko` pada `tt_sinkronisasi`; mutasi internal Finance disimpan pada `tt_mutasi`.
5. Finance mencegah duplikasi berdasarkan identitas database sumber dan `_id` dokumen sumber.
6. Data hasil import masuk `PENDING_APPROVAL` sampai aturan approval untuk transaksi harian ditetapkan.
7. Data yang rekeningnya belum dapat dipetakan masuk daftar perlu diperiksa dan tidak mengubah saldo.

Untuk tahap awal, pilihan yang disarankan adalah endpoint/worker di sisi Nagagold yang sudah memiliki `Encryptor`, lalu mengirim data yang sudah dinormalisasi ke Finance. Finance tidak perlu menyimpan kunci dekripsi Nagagold. Alternatifnya adalah koneksi read-only langsung ke setiap database cabang, tetapi connector harus memiliki konfigurasi pemetaan database ke `kode_toko` dan mekanisme dekripsi yang kompatibel.

#### Struktur transaksi sumber `tt_cash_daily`

Field yang digunakan untuk integrasi Nagagold:

| Field sumber | Perlakuan di Finance |
|---|---|
| `_id` | `sumber_id`; bagian dari kunci idempotensi |
| `no_reff` | `sumber_no_reff`; referensi transaksi sumber |
| `tanggal` | tanggal transaksi Finance |
| `jenis` | `TRANSFER`, `DEBET`, atau `CREDIT`; disimpan sebagai jenis sumber |
| `kategori` | kategori bisnis sumber, misalnya `PENJUALAN` atau `PEMBELIAN` |
| `deskripsi` | referensi bisnis sumber; tetap diperlakukan sebagai nilai opaque |
| `keterangan` | keterangan transaksi setelah dinormalisasi |
| `no_rekening` | dicocokkan ke `tm_rekening.nomor_rekening` |
| `jumlah_in` | nilai masuk ke rekening |
| `jumlah_out` | nilai keluar dari rekening |
| `kode_bank`, `nama_bank` | informasi bank sumber; `kode_bank` dapat digunakan untuk pencocokan bank |
| `status` | hanya data dengan status sumber yang diizinkan yang diimport |

Aturan nominal:

- `jumlah_in > 0` berarti saldo rekening bertambah;
- `jumlah_out > 0` berarti saldo rekening berkurang;
- satu dokumen normal tidak boleh memiliki `jumlah_in` dan `jumlah_out` sama-sama lebih dari nol;
- Finance tidak menganggap `jenis = DEBET` selalu masuk atau `jenis = CREDIT` selalu keluar, karena arah aktual ditentukan oleh `jumlah_in`/`jumlah_out`.

#### Enkripsi data Nagagold

Saat `ENCRYPTION_MODE` aktif, Nagagold mengenkripsi string secara rekursif sebelum disimpan. Implementasinya berada di `src/services/Encryptor.ts` dan kunci dekripsinya bergantung pada key aplikasi serta validasi mesin Nagagold. Angka seperti `jumlah_in`, `jumlah_out`, `fee`, dan `ppn_rp` tidak dienkripsi oleh fungsi penyimpanan tersebut.

Untuk `tt_cash_daily`, daftar field yang tidak didekripsi adalah `no_reff`, `tanggal`, `deskripsi`, `deskripsi_bak`, `input_date`, `no_faktur`, `kode_bank`, `_id`, `status`, dan `no_faktur_list`. Karena itu `deskripsi` tidak boleh dipakai sebagai kode cabang atau nomor rekening. `no_rekening`, `jenis`, `kategori`, `nama_bank`, dan string lain yang bukan pengecualian harus dinormalisasi oleh connector Nagagold sebelum dikirim ke Finance.

Finance tidak boleh mencoba mendekripsi nilai mentah dengan menyalin secret Nagagold ke `.env` Finance. Bila data dibaca langsung dari MongoDB, proses tersebut harus ditempatkan pada connector yang berjalan di lingkungan Nagagold dan memiliki keygen yang sah.

Contoh data yang diberikan menghasilkan pemetaan inti berikut setelah normalisasi:

```text
jenis       = TRANSFER
kategori    = PENJUALAN
no_rekening = 0462457977
jumlah_in   = 835000
jumlah_out  = 0
kode_bank   = BCA
```

Dengan demikian, baris tersebut adalah transaksi sumber Nagagold yang menambah saldo rekening operasional, bukan request transfer dari cabang dan bukan transaksi yang harus dibuat ulang oleh admin Finance.

#### Bentuk transaksi Finance untuk data import

Data import tidak boleh dipaksa mengikuti bentuk transfer internal. Finance membedakan dua bentuk transaksi:

| Bentuk Finance | Penggunaan | Rekening yang diperlukan |
|---|---|---|
| `TRANSFER_INTERNAL` | Transfer Kas Besar ke Kas Kecil atau mutasi antar rekening Finance | rekening sumber dan rekening tujuan |
| `MUTASI_REKENING` | Penjualan, pembelian, debet, credit, atau transaksi lain dari `tt_cash_daily` | satu rekening operasional, arah `MASUK` atau `KELUAR` |

Untuk `MUTASI_REKENING`, Finance menyimpan `rekening_id`, `arah`, dan `nilai_rp`. Akun lawan dapat disimpan sebagai kategori sumber terlebih dahulu; Finance tidak boleh mengarang rekening sumber/tujuan kedua jika memang tidak ada pada dokumen Nagagold.

Implikasinya, `tt_mutasi` menangani mutasi internal Finance, sedangkan `tt_sinkronisasi` menangani transaksi hasil sinkronisasi. Field rekening sumber/tujuan wajib hanya untuk `TRANSFER_INTERNAL`, sedangkan field rekening dan arah wajib untuk `MUTASI_REKENING`. Jurnal import juga dibuat dari satu rekening operasional dengan kategori sumber, bukan dari dua rekening kas.

Nilai contoh `keterangan` yang diberikan belum dapat direkonstruksi penuh dengan algoritma `Encryptor` saat ini, sedangkan field inti lainnya dapat dipetakan. Karena itu connector harus menolak atau menandai data yang gagal dinormalisasi, menyimpan nilai mentah secara terbatas untuk audit, dan tidak menggunakan `keterangan` sebagai kunci pencocokan rekening.

#### Fetch otomatis setiap 10 menit

Fetch berjalan per cabang dan memiliki cursor sendiri. Contoh urutan waktu:

```text
cursor terakhir  = 10:42
fetch berikutnya  = data sejak 10:42 sampai 10:52
fetch berikutnya  = data sejak 10:52 sampai 11:02
```

Implementasinya tidak boleh bergantung pada batas waktu yang persis tanpa pengaman. Setiap window memakai overlap kecil dan upsert idempotent berdasarkan `kode_toko + sumber_koleksi + sumber_id`, sehingga data di batas 10:52 tidak hilang dan data yang terbaca dua kali tidak menjadi transaksi ganda.

Karena `tt_cash_daily` tidak memiliki `updatedAt` pada schema yang ditemukan, diperlukan dua proses:

1. **Fetch incremental** berdasarkan `input_date` untuk mengambil dokumen baru setiap 10 menit.
2. **Rekonsiliasi rolling** untuk tanggal berjalan dan beberapa hari terakhir agar perubahan `CLOS` menjadi `OPEN`, atau koreksi status sumber, ikut terbaca. Cursor saja tidak cukup untuk mendeteksi perubahan pada dokumen lama.

Pada backend Finance, endpoint pengujian dan status yang tersedia adalah:

- `GET /api/cabang` dan `POST /api/cabang` untuk melihat atau menambahkan data cabang di `tm_cabang`;
- `POST /api/sinkronisasi/nagagold/run` untuk menjalankan fetch manual;
- `GET /api/sinkronisasi/nagagold/status` untuk melihat cursor dan hasil fetch per cabang;
- `GET /api/nagagold-transactions` untuk melihat data hasil import;
- `GET /api/nagagold-rekening` untuk melihat daftar nomor rekening sumber dan jumlah transaksinya;
- `POST /api/nagagold-transactions/:id/validate` atau `POST /api/nagagold-transactions/bulk-validate` untuk validasi Admin.

Konfigurasi global di `server/.env` hanya menyimpan key dekripsi yang sama untuk semua cabang:

```env
NAGAGOLD_SYNC_ENABLED=false
NAGAGOLD_SYNC_INTERVAL_MINUTES=10
NAGAGOLD_SYNC_INITIAL_FROM=2026-10-29T00:00:00+07:00
NAGAGOLD_SYNC_RECONCILE_DAYS=3
NAGAGOLD_DECRYPTION_KEY=
```

Data cabang disimpan di collection `tm_cabang`, dengan field `kode_toko`, `nama_toko`, `portal`, `tipe_toko`, `database_name`, dan `aktif`. URI cluster bersama disimpan satu kali di `NAGAGOLD_MONGODB_URI`. Finance membuka koneksi read-only ke URI tersebut dengan `database_name` masing-masing cabang, membaca collection `tt_cash_daily` berdasarkan `input_date`, lalu menormalisasi field terenkripsi menggunakan `NAGAGOLD_DECRYPTION_KEY` yang sama untuk semua cabang. Finance tidak mengubah database Nagagold.

#### Validasi Admin dan posting saldo

Data yang baru di-fetch tidak langsung mengubah `tm_rekening.saldo_akhir`. Alur yang disarankan:

1. Data masuk menu baru **Transaksi Nagagold** dengan status `MENUNGGU_VALIDASI_ADMIN`.
2. Admin memeriksa hasil dekripsi, mencocokkan `no_rekening` ke `tm_rekening`, memastikan nominal dan arah, serta melihat referensi kategori/faktur.
3. Jika lengkap, Admin menekan **Validasi Data**. Ini bukan approval dan tidak mengubah saldo.
4. Data berpindah ke `PENDING_APPROVAL` untuk Owner.
5. Owner menyetujui atau menolak. Hanya `APPROVED` yang memposting perubahan saldo dan jurnal final.
6. Jika ditolak sebelum posting, saldo tidak berubah. Record tetap disimpan dengan alasan penolakan.

Dengan alur ini Admin tidak dapat menentukan sendiri saldo rekening. Admin hanya memastikan data sumber dapat dipetakan; keputusan keuangan tetap berada di approval Owner.

#### Referensi faktur tanpa penghitungan ganda

Satu dokumen `tt_cash_daily` adalah satu pergerakan uang. Field `deskripsi` diperlakukan sebagai referensi teknis/group pembayaran, bukan label utama untuk user. Nomor faktur `FJ` atau `FB` disimpan sebagai `sourceInvoiceNumbers` dan `sourceInvoiceDetails` di dalam transaksi Finance.

Jika satu pembayaran mencakup beberapa faktur, Finance tetap membuat satu transaksi dengan satu nominal dari `jumlah_in` atau `jumlah_out`. Daftar faktur hanya untuk tampilan dan penelusuran; `harga_total` faktur tidak dijumlahkan lagi ke saldo. Kunci idempotensi tetap memakai `_id` dokumen `tt_cash_daily`, bukan nomor faktur, karena satu faktur dapat muncul pada beberapa event pembayaran atau pembatalan.

#### Transaksi CASH

Pada Nagagold, `CASH` berarti cara pembayaran dan sering memiliki `no_rekening = "-"`. Karena Finance sebelumnya berfokus pada rekening bank, data `CASH` tidak boleh dimasukkan ke rekening bank secara paksa.

Jika saldo uang tunai cabang juga harus dihitung, Finance memerlukan akun virtual non-bank, misalnya `Kas Tunai QBS`, pada `tm_rekening` dengan tipe `KAS_TUNAI`. Akun ini dapat dipilih otomatis berdasarkan `kode_toko` dari database sumber; Admin tidak perlu memilihnya manual. Jika akun virtual tersebut belum disediakan, data `CASH` hanya boleh tampil sebagai transaksi belum terpetakan dan tidak boleh mengubah saldo rekening bank.

#### Pembatalan dan koreksi

Nagagold menyimpan pembatalan sebagai baris baru di `tt_cash_daily`, bukan sebagai perubahan saldo langsung pada baris lama. Contoh yang ditemukan:

- penjualan masuk: `kategori = PENJUALAN`, `jumlah_in > 0`;
- batal penjualan: `kategori = BATAL PENJUALAN`, `jumlah_out > 0`;
- pembelian keluar: `kategori = PEMBELIAN`, `jumlah_out > 0`;
- batal pembelian: `kategori = BATAL BELI`, `jumlah_in > 0`;
- pembatalan pengembalian transfer dapat membuat baris `BATAL KEMBALI TRANSFER` dengan arah masuk.

Finance memperlakukan setiap `_id` sumber sebagai event tersendiri dan tidak menghapus transaksi awal. `deskripsi`, `no_faktur`, dan `no_faktur_list` dipakai sebagai relasi audit/pengelompokan, bukan sebagai pengganti `sumber_id`.

- Jika transaksi awal sudah `APPROVED`, baris pembatalan menjadi transaksi koreksi baru yang harus melalui validasi dan approval.
- Jika transaksi awal masih pending, transaksi awal dan pembatalannya ditampilkan sebagai satu kelompok referensi agar Owner dapat melihat dampak bersihnya.
- Jika transaksi awal ditolak sebelum pernah memposting saldo, pembatalannya tidak boleh otomatis dianggap sebagai reversal Finance; keduanya tetap mengikuti status sumber dan approval masing-masing.
- Jika ada transaksi Finance yang sudah approved lalu dikoreksi oleh user Finance, gunakan jurnal reversal Finance. Jangan mengubah atau menghapus dokumen sumber Nagagold.

Request cabang dan transaksi Finance harus menjadi dua objek berbeda. Request menjawab “cabang membutuhkan pembayaran”, sedangkan transaksi menjawab “admin telah mencatat uang yang ditransfer”. Keduanya dihubungkan dengan `request_id`.

### B. Input transfer oleh admin

Form minimal:

- tanggal transfer;
- sumber kas;
- tujuan kas/rekening;
- nominal;
- jenis transaksi, misalnya `BUYBACK_TRANSFER` atau `INTERNAL_CASH_TRANSFER`;
- cabang/unit terkait;
- referensi request cabang, bila ada;
- bukti transfer, opsional tetapi disarankan;
- keterangan admin, opsional.

Saat disimpan:

- status approval menjadi `PENDING_APPROVAL`;
- `status_valid = false`;
- transaksi langsung dapat muncul dalam laporan sebagai transaksi belum tervalidasi;
- sistem membuat jurnal provisional;
- Owner menerima notifikasi atau melihat angka pending pada menu verifikasi.

### C. Approval oleh Owner

1. Owner membuka menu “Perlu Verifikasi”.
2. Sistem menampilkan transaksi pending dengan filter tanggal, cabang, jenis, sumber, tujuan, dan nominal.
3. Owner dapat membuka detail transaksi sebelum mengambil keputusan.
4. Owner mencentang satu atau beberapa transaksi.
5. Sistem menyediakan aksi `Approve Terpilih` dan `Reject Terpilih`.
6. Untuk approve, sistem meminta konfirmasi lalu mengubah status menjadi `APPROVED` dan `status_valid = true`.
7. Approval tidak membuat jurnal uang baru. Jurnal provisional yang sama berubah menjadi tervalidasi/approved.
8. Untuk reject, sistem meminta alasan penolakan. Sistem membuat jurnal balik dengan tanggal rejection dan mengubah transaksi menjadi `REJECTED`.

Bulk action harus diproses per transaksi secara atomik. Jika satu transaksi gagal diproses, sistem harus melaporkan transaksi yang gagal dan tidak diam-diam menganggap seluruh batch berhasil.

## 6. Status transaksi

Status canonical yang disarankan:

```text
PENDING_APPROVAL -> APPROVED
PENDING_APPROVAL -> REJECTED
```

Aturan kompatibilitas untuk kebutuhan `status_valid`:

| Status approval | status_valid | Arti |
|---|---:|---|
| `PENDING_APPROVAL` | `false` | Sudah dicatat, belum diverifikasi Owner |
| `APPROVED` | `true` | Sudah disetujui Owner |
| `REJECTED` | `false` | Ditolak dan sudah memiliki jurnal balik |

`status_valid` boleh tetap tersedia di API, tetapi `approval_status` menjadi sumber kebenaran utama agar status tidak ambigu.

Status request cabang dapat berdiri sendiri:

```text
REQUESTED -> IN_PROGRESS -> COMPLETED
                     └──> CANCELLED
```

Request `COMPLETED` berarti admin telah mencatat transaksi. Itu tidak otomatis berarti transaksi Finance sudah `APPROVED`.

## 7. Konsep jurnal dan laporan

### Saat admin menyimpan transaksi

Sistem membuat jurnal provisional pada tanggal transfer:

```text
Debit  : Kas/Rekening tujuan       Rp10.000.000
Kredit : Kas Besar Nagagold        Rp10.000.000
Status jurnal: PROVISIONAL
```

Dengan demikian laporan dapat langsung terbentuk setelah input, namun laporan harus dapat membedakan transaksi `PENDING_APPROVAL` dari transaksi `APPROVED`.

### Saat disetujui

Tidak ada jurnal uang tambahan. Jurnal provisional ditandai sebagai `POSTED/APPROVED`, transaksi diberi:

```text
approval_status = APPROVED
status_valid = true
approved_at = waktu approval
approved_by = user Owner
```

### Saat ditolak

Jurnal awal tidak dihapus dan tidak diedit. Sistem membuat jurnal reversal baru pada tanggal penolakan:

```text
Jurnal awal, tanggal transfer:
Debit  : Kas/Rekening tujuan       Rp10.000.000
Kredit : Kas Besar Nagagold        Rp10.000.000

Jurnal balik, tanggal reject:
Debit  : Kas Besar Nagagold        Rp10.000.000
Kredit : Kas/Rekening tujuan       Rp10.000.000
```

Jurnal balik memiliki `reversal_of_journal_id` atau `reversal_of_transaction_id`, alasan reject, tanggal reject, dan user yang melakukan reject. Pendekatan ini menjaga audit trail dan mencegah penghapusan riwayat.

Laporan perlu menyediakan minimal tiga sudut pandang:

- **Laporan operasional:** semua input, termasuk pending;
- **Laporan tervalidasi:** hanya approved;
- **Laporan jurnal:** jurnal awal dan reversal secara berpasangan.

## 8. Rancangan menu

### Dashboard Finance

- saldo per akun kas;
- jumlah transaksi pending approval;
- total nominal pending approval;
- transaksi terbaru;
- notifikasi request buyback baru.

### Master Kas/Akun

- hierarki Kas Utama, Kas Besar, Kas Kecil, dan rekening;
- master bank untuk pilihan bank pada setiap rekening;
- tambah/nonaktifkan akun;
- hubungan akun dengan cabang/unit;
- kode akun dan tipe kas.

### Request Cabang

- daftar request dari Nagagold;
- detail kebutuhan pembayaran;
- status request;
- tombol “Buat Transaksi Finance”.

### Input Transaksi

- input transfer manual;
- pilihan request cabang;
- upload bukti transfer;
- keterangan opsional;
- validasi sumber dan tujuan tidak boleh sama;
- validasi nominal harus lebih besar dari nol.

### Perlu Verifikasi

- tabel dengan checkbox per baris;
- checkbox all untuk data yang sedang terfilter;
- detail transaksi;
- approve terpilih;
- reject terpilih;
- alasan reject wajib untuk aksi reject;
- preview ringkas jumlah dan total nominal yang akan diproses.

### Laporan

- filter periode, status, cabang, akun sumber, akun tujuan, dan jenis transaksi;
- kolom tanggal transaksi, tanggal approval/reject, nominal, status, request, dan keterangan;
- detail jurnal;
- ekspor setelah format laporan disepakati.

## 9. Rancangan data inti

Entitas inti yang disarankan:

### `cash_accounts`

- `id`
- `nama_rekening`
- `kelompok_rekening`: `KAS_UTAMA`, `KAS_BESAR`, atau `KAS_KECIL`
- `unit`: `PUSAT`, `NAGAGOLD`, atau `OPTIK`
- `bank_id`
- `nomor_rekening`
- `aktif`

### `transfer_requests`

- `id`
- `request_id` dari sistem pengirim;
- `source_system`
- `jenis_request`: alasan kebutuhan dana, misalnya `PEMBAYARAN_BUYBACK`, `SALDO_AWAL`, `TAMBAHAN_OPERASIONAL`, `PENARIKAN_DANA`, atau `LAINNYA`;
- `arah_dana`: `KELUAR` atau `MASUK` terhadap `source_system`; untuk endpoint awal dapat diberi default `KELUAR`;
- `kode_toko`
- `nama_toko_snapshot`
- `no_rekening`
- `nilai_rp`
- `requested_at`
- `tujuan`
- `status`
- `raw_reference` atau metadata integrasi
- `created_at`, `updated_at`

### `finance_transactions`

- `id`
- `request_id`, nullable untuk input manual;
- `transaction_number`
- `jenis_transaksi`: klasifikasi bisnis/keuangan;
- `jenis_request`: alasan request yang mendasari transaksi;
- `arah_dana`: `KELUAR` atau `MASUK` terhadap `source_system`;
- `kode_toko`, nullable untuk mutasi internal Finance;
- `nama_toko_snapshot`, nullable;
- `transaction_date`
- `source_cash_account_id`
- `destination_cash_account_id`
- `amount`
- transaksi selalu berupa transfer antar rekening/non-tunai;
- `sumber_sistem`, nullable untuk input manual;
- `sumber_koleksi`, nullable untuk input manual;
- `sumber_id`, nullable untuk input manual;
- `diambil_pada`, nullable untuk input manual;
- `approval_status`
- `status_valid`
- `admin_note`
- `evidence_file_id`, nullable;
- `created_by`, `created_at`
- `approved_by`, `approved_at`, nullable;
- `rejected_by`, `rejected_at`, `rejection_reason`, nullable.

### `journal_entries` dan `journal_lines`

Header jurnal menyimpan nomor jurnal, tanggal jurnal, status, tipe jurnal, sumber transaksi, dan relasi reversal. Baris jurnal menyimpan akun, debit, kredit, dan keterangan.

Aturan dasar:

- total debit harus sama dengan total kredit;
- jurnal awal dan reversal tidak boleh dihapus;
- satu transaksi transfer memiliki satu jurnal awal;
- satu transaksi yang ditolak memiliki maksimal satu jurnal reversal;
- tanggal reversal mengikuti tanggal reject, bukan tanggal transaksi awal.

### `approval_actions`

- `transaction_id`
- `action`: `APPROVE` atau `REJECT`
- `actor_id`
- `reason`, wajib untuk reject;
- `acted_at`
- `batch_id`, bila diproses melalui bulk action.

### `notifications` dan `audit_logs`

Semua request baru, perubahan status, approval, reject, dan pembuatan reversal dicatat. Audit log minimal menyimpan actor, waktu, aksi, objek, nilai sebelum, nilai sesudah, dan correlation ID.

## 10. Kontrak integrasi awal dari cabang

Karena program Nagagold belum diubah, tahap awal dapat menggunakan endpoint simulasi melalui Postman. Contoh payload konseptual:

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

Untuk payload request dari Nagagold, cukup kirim `jenis_request`. Request hanya menyatakan kebutuhan dana; klasifikasi transaksi Finance ditentukan ketika admin mengubah request menjadi transaksi aktual. Di dokumen transaksi Finance, simpan dua klasifikasi:

- `jenis_transaksi` menjelaskan transaksi bisnis/keuangan, misalnya `PEMBELIAN` atau `TRANSFER_INTERNAL`;
- `jenis_request` menjelaskan alasan request dana, misalnya `PEMBAYARAN_BUYBACK` atau `SALDO_AWAL`.

Dengan pola ini, buyback tidak perlu menjadi kategori yang tumpang tindih dengan pembelian. Contohnya:

| Kebutuhan | `jenis_transaksi` | `jenis_request` |
|---|---|---|
| Pembayaran buyback | `PEMBELIAN` | `PEMBAYARAN_BUYBACK` |
| Pengisian saldo awal cabang | `TRANSFER_INTERNAL` | `SALDO_AWAL` |
| Penambahan dana operasional | `TRANSFER_INTERNAL` | `TAMBAHAN_OPERASIONAL` |
| Penarikan dana dari cabang | `TRANSFER_INTERNAL` | `PENARIKAN_DANA` |

`tujuan` tetap menjadi keterangan bebas untuk menjelaskan detail yang tidak perlu dijadikan enum. Nilai enum digunakan untuk filter dan laporan agar konsisten.

`arah_dana` diperlukan karena satu kebutuhan dapat memiliki arah uang yang berbeda. Nilai `KELUAR` berarti uang keluar dari `source_system`/Nagagold, sedangkan `MASUK` berarti uang masuk ke `source_system`/Nagagold. Untuk request awal yang seluruhnya merupakan pencairan dari Nagagold, backend boleh memberi default `KELUAR`; ketika alur dana masuk mulai digunakan, nilainya harus dikirim secara eksplisit.

Integrasi wajib idempotent: pengiriman ulang kombinasi `source_system` dan `request_id` yang sama tidak boleh membuat request duplikat. API juga perlu autentikasi, validasi nominal, validasi rekening tujuan, dan pencatatan waktu.

Request dari Nagagold sebaiknya hanya mengirim data kebutuhan pembayaran, bukan langsung membuat jurnal Finance. Contoh alurnya:

1. Nagagold mengirim `kode_toko = QBS` dan kebutuhan pembayaran.
2. Finance memastikan `kode_toko` tersedia pada payload request.
3. Finance menyimpan `kode_toko` dan `nama_toko` snapshot bila dikirim oleh Nagagold.
4. Request diberi status `REQUESTED` dan admin menerima notifikasi.
5. Admin melakukan transfer aktual lalu membuat transaksi Finance dengan `request_id` tersebut.
6. Jurnal provisional baru dibuat ketika transaksi aktual dicatat oleh admin.

`no_rekening` harus divalidasi terhadap master rekening Finance. Untuk tahap awal, nomor rekening dapat diterima dalam payload, tetapi setelah diterima Finance sebaiknya menghubungkannya ke rekening yang terdaftar. Jika rekening belum terdaftar, request masuk status error/needs-mapping dan tidak boleh langsung diproses admin.

## 11. Aturan penting dan kontrol risiko

- Transaksi approved tidak dapat diedit langsung. Koreksi dilakukan melalui transaksi koreksi/reversal baru.
- Transaksi rejected tidak boleh dihapus.
- Reject wajib menyertakan alasan.
- Approve/reject bulk hanya berlaku untuk transaksi yang masih `PENDING_APPROVAL`.
- Sistem menyimpan timezone bisnis Asia/Jakarta.
- Nominal menggunakan tipe decimal/integer rupiah, bukan floating point.
- Akun kas nonaktif tidak dapat dipilih untuk transaksi baru.
- Perubahan master akun dan status approval masuk audit log.
- File bukti transfer memiliki batas ukuran, tipe file, dan hak akses.
- Notifikasi harus dapat ditelusuri ke request atau transaksi tertentu.

## 12. Skenario contoh end-to-end

### Skenario approve

1. Cabang QBS mengirim request pembayaran Rp10.000.000.
2. Admin melakukan transfer pada 28 Oktober 2026 dan mencatatnya.
3. Sistem membuat transaksi `PENDING_APPROVAL`, `status_valid=false`, serta jurnal provisional.
4. Owner melihat detail dan memilih approve.
5. Sistem mengubah transaksi menjadi `APPROVED`, `status_valid=true`.
6. Tidak ada jurnal tambahan.

### Skenario reject

1. Langkah 1–3 sama seperti skenario approve.
2. Owner menolak pada 30 Oktober 2026 dengan alasan.
3. Sistem mempertahankan jurnal awal tanggal 28 Oktober.
4. Sistem membuat jurnal reversal tanggal 30 Oktober.
5. Transaksi menjadi `REJECTED`, `status_valid=false`.
6. Laporan memperlihatkan transaksi awal dan reversal secara terhubung.

## 13. Keputusan yang perlu dikonfirmasi sebelum implementasi

1. Apakah transaksi pending langsung memengaruhi saldo operasional, atau hanya muncul pada laporan pending sampai approved?
2. Apakah admin boleh membuat transfer tanpa `request_id` cabang untuk transaksi operasional biasa?
3. Apakah satu request cabang boleh dibayar dalam beberapa transaksi, atau wajib satu request satu transaksi?
4. Apakah approval hanya Owner, atau perlu disiapkan multi-approver untuk masa depan?
5. Bukti transfer wajib atau opsional?
6. Apakah laporan menggunakan metode kas sederhana atau jurnal double-entry penuh sejak tahap pertama?
7. Definisi detail `Kas Besar`, `Kas Kecil`, `Kas Tunai Toko`, `Rekening Utama`, dan `Rekening Toko` pada chart of accounts Sambas.

## 14. Kriteria rancangan dianggap siap dibangun

Rancangan siap diterjemahkan ke FE/BE setelah keputusan pada bagian 13 disepakati dan tersedia:

- daftar akun kas awal Nagagold;
- daftar cabang/unit awal;
- contoh request buyback nyata atau payload final;
- contoh laporan yang diharapkan Owner;
- aturan saldo pending yang disetujui;
- aturan koreksi setelah transaksi approved;
- daftar pengguna dan hak akses.

## 15. Rancangan penyimpanan MongoDB

Data aplikasi akan disimpan di MongoDB. Pada tahap implementasi, koneksi database disiapkan melalui environment variable sehingga nilai koneksi dapat diisi tanpa mengubah source code.

Konfigurasi minimum yang disiapkan:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/finance_sambas
```

Nama database dibaca langsung dari bagian akhir `MONGODB_URI`, sehingga tidak diperlukan environment variable database tambahan. Nama collection ditetapkan langsung oleh aplikasi agar konsisten dengan pola Finance Sambas dan tidak memerlukan prefix tambahan.

### Konvensi collection

Nama collection harus mengikuti konvensi yang sudah dipakai Nagagold, termasuk gaya singkatan, penggunaan underscore, bentuk singular/plural, dan penamaan field. Sebagai rancangan awal, kelompok collection dibedakan sebagai berikut:

| Prefix | Kelompok | Collection konseptual |
|---|---|---|
| `tm_` | master | `tm_user`, `tm_rekening`, `tm_bank` |
| `tt_` | transaksi | `tt_request_transfer`, `tt_mutasi`, `tt_sinkronisasi`, `tt_saldo_awal`, `tt_keuangan` |
| eksternal | sumber Nagagold read-only | `tt_cash_daily` |
| `th_` | histori | `th_approval`, `th_audit`, `th_notifikasi` |

Nama di atas adalah rancangan konseptual dan perlu dicocokkan dengan collection Nagagold sebelum coding. Jika Nagagold menggunakan format, misalnya, `tm_cash_account` atau `tt_transfer`, maka modul Finance harus mengikuti format tersebut agar konsisten. Jangan membuat pola nama baru hanya untuk Finance.

Nama collection dibuat singkat dan mengikuti pola `tm_`, `tt_`, dan `th_` agar mudah dikenali seperti collection di Nagagold. Untuk MVP, user disimpan dalam `tm_user`, rekening disimpan dalam `tm_rekening`, daftar bank disimpan dalam `tm_bank`, dan saldo awal disimpan dalam `tt_saldo_awal`. Satu user awal dengan role `SUPER_USER` diimpor dari environment menggunakan `npm run seed`, sedangkan password disimpan dalam bentuk hash. User dengan role `ADMIN` atau `OWNER` dibuat kemudian melalui menu Data User.

### Catatan pemodelan MongoDB

- Setiap dokumen memiliki `_id`, `created_at`, dan `updated_at`.
- ID relasi penting seperti `cash_account_id`, `request_id`, dan `transaction_id` disimpan secara eksplisit. Untuk asal cabang, simpan `kode_toko` sebagai business key dan `branch_id` hanya bila Finance memiliki master cabang lokal.
- Dokumen jurnal reversal menyimpan referensi ke jurnal/transaksi awal.
- Kombinasi `source_system` dan `request_id` diberi unique index.
- Query daftar approval membutuhkan index pada `approval_status`, `transaction_date`, `kode_toko`, dan `created_at`.
- Request dari cabang harus idempotent berdasarkan kombinasi `source_system` dan `request_id`.

## 16. Identitas cabang pada setiap request

Setiap request dari cabang wajib membawa identitas cabang asal. Identitas utama yang dikirim dalam request adalah `kode_toko`. Sistem tidak boleh menerima request buyback yang hanya berisi nominal dan tujuan tanpa informasi cabang. Finance tidak perlu memiliki akses langsung ke database Nagagold.

Minimal identitas cabang yang disimpan:

- `kode_toko` sebagai kode stabil dari sistem sumber, misalnya `QBS`;
- `nama_toko` sebagai snapshot nama saat request dibuat, bila dikirim oleh sistem sumber;
- `source_system`, misalnya `nagagold`;
- `request_id` dari sistem pengirim.

Contoh dokumen master cabang di Nagagold:

```json
{
  "_id": "6acdd826d829adba9d98d991",
  "tgl_system": "2026-10-13",
  "kode_toko": "QBS",
  "nama_toko": "BACKUP SAMBAS #1",
  "no_telp": "0293 – 58703",
  "alamat_toko": "-",
  "installed_date": "2026-10-13T07:05:10.048Z"
}
```

`kode_toko` digunakan sebagai business key untuk integrasi. `_id` MongoDB tidak perlu dijadikan satu-satunya identitas request karena nilai tersebut merupakan ID internal database. `nama_toko` disimpan sebagai snapshot agar laporan historis tetap terbaca jika nama cabang berubah.

Finance tidak mengambil master cabang dari `tp_system`. Nagagold mengirim `kode_toko` dan, bila diperlukan untuk laporan, `nama_toko` sebagai snapshot di dalam payload. Dengan begitu Finance dapat menggunakan database terpisah tanpa bergantung pada koneksi database Nagagold.

### Mengapa cabang wajib dicantumkan

- Owner dapat mengetahui asal setiap permintaan;
- laporan dapat difilter dan direkap per cabang;
- admin tidak salah memilih rekening tujuan yang memiliki nama serupa;
- audit trail dapat menelusuri request sampai ke cabang pengirim;
- integrasi dapat mencegah request duplikat antar cabang.

Jika suatu transaksi benar-benar bukan berasal dari cabang, misalnya mutasi internal Finance Utama, transaksi tersebut tetap memiliki `branch_id = null` dengan `transaction_origin = INTERNAL`. Nilai cabang tidak boleh diisi sembarangan atau dibiarkan kosong untuk request cabang.

