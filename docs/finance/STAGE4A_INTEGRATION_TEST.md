# Finance Sambas — Stage 4A Integration Test

Tanggal pengujian: 29 Oktober 2026  
Status: **LULUS untuk skenario yang diuji**

## Ruang lingkup

Pengujian ini memeriksa alur saldo dan jurnal pada Finance existing, tanpa menyentuh database production. Cakupan pengujian:

- saldo awal dan jurnal pembukaan;
- transaksi Admin dengan jurnal `PROVISIONAL`;
- approval Owner, rejection, dan maker-checker;
- approval paralel dan idempotency;
- realisasi pembayaran request cabang;
- rekonsiliasi transaksi manual dengan hasil fetch;
- bulk approval sebagian berhasil;
- keseimbangan debit/kredit dan kesesuaian saldo akun dengan jurnal `POSTED`.

Tidak ada worker Optik atau auto-posting kategori Nagagold yang diaktifkan pada tahap ini.

## Lingkungan pengujian

Pengujian menggunakan MongoDB lokal Docker yang terpisah:

- MongoDB `mongo:7`;
- replica set `rs0`;
- database `finance_sambas_stage4a_test`;
- data sintetis: tiga akun dan tiga user testing;
- API Finance dijalankan pada port testing `3310`;
- `NAGAGOLD_SYNC_ENABLED=false` selama pengujian.

Runner menolak berjalan apabila `MONGODB_TEST_URI` sama persis dengan `MONGODB_URI`. Database testing dihapus dan diisi ulang hanya pada database testing sebelum skenario berjalan; tidak ada koneksi tulis ke database production.

Perintah yang digunakan:

```bash
cd server
npm test
npm run test:integration
```

Jika menyiapkan lingkungan baru:

```bash
docker run -d --name finance-sambas-mongo-test \
  -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all

docker exec finance-sambas-mongo-test mongosh \
  --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
```

## Hasil nyata

Hasil runner:

```json
{
  "ok": true,
  "database": "finance_sambas_stage4a_test",
  "scenarios": 14,
  "journals": 10,
  "postedJournals": 7,
  "makerChecker": true,
  "concurrency": true,
  "idempotency": true,
  "rollback": true
}
```

| Pemeriksaan | Hasil |
| --- | --- |
| Unit/model/status/reconciliation/sync-window test | 13 lulus, 0 gagal |
| Input manual membuat jurnal provisional | Lulus |
| Approval mengubah jurnal yang sama menjadi posted | Lulus |
| Approval bersamaan | Hanya satu proses yang memposting saldo |
| Maker-checker | Admin pembuat tidak dapat approve transaksinya sendiri |
| Rejection sebelum posting | Tidak mengubah saldo confirmed dan tidak membuat reversal |
| Reversal transaksi posted | Satu reversal; percobaan kedua idempotent |
| Pembayaran request cabang | Satu transaksi Finance dan satu jurnal |
| Konfirmasi pembayaran berulang | Percobaan kedua idempotent |
| Rekonsiliasi | Tidak membuat jurnal tambahan |
| Bulk approval parsial | Item valid berhasil; item saldo tidak cukup gagal dengan jelas |
| Rollback transaksi MongoDB | Saldo dan jurnal percobaan dikembalikan saat operasi dipaksa gagal |
| Debit dan kredit | Seluruh jurnal seimbang |
| Saldo akun | Sesuai akumulasi jurnal posted |

## Perhitungan saldo

Akun sumber dimulai dari nol. Akun tujuan juga dimulai dari nol. Akun ketiga digunakan untuk transaksi bulk yang sengaja dibuat tidak memiliki saldo cukup.

| Tahap | Saldo kas besar sumber | Saldo kas kecil tujuan | Keterangan |
| --- | ---: | ---: | --- |
| Setelah saldo awal di-approve | Rp1.000.000 | Rp0 | Jurnal opening diposting satu kali |
| Setelah transaksi manual Rp100.000 di-approve | Rp900.000 | Rp100.000 | Jurnal transaksi yang sama menjadi posted |
| Setelah transaksi maker-checker Rp10.000 di-approve Owner | Rp890.000 | Rp110.000 | Admin pembuat ditolak |
| Setelah transaksi pending ditolak | Rp890.000 | Rp110.000 | Tidak ada saldo confirmed yang berubah |
| Setelah transaksi Rp30.000 di-post lalu di-reverse | Rp890.000 | Rp110.000 | Saldo kembali; satu reversal |
| Setelah request dibayar Rp200.000 | Rp690.000 | Rp310.000 | Payment terhubung ke request asal |
| Setelah rekonsiliasi | Rp690.000 | Rp310.000 | Matching hanya menambah referensi |
| Setelah bulk: valid Rp1.000, invalid gagal | Rp689.000 | Rp311.000 | Tidak ada perubahan pada akun kosong |

Saldo akhir diverifikasi ulang terhadap seluruh jurnal `POSTED`, bukan hanya terhadap respons API.

## Skenario concurrency dan idempotency

1. Dua request approval untuk transaksi yang sama dikirim bersamaan. Guard status dan update atomik membuat tepat satu proses berhasil; saldo hanya berubah sekali.
2. Konfirmasi pembayaran request dikirim dua kali dengan referensi transfer yang sama. Respons kedua menandai operasi idempotent; tidak ada transaksi atau jurnal baru.
3. Reversal transaksi posted dikirim dua kali. Reversal kedua tidak membuat jurnal reversal kedua.
4. Bulk approval berisi satu transaksi valid dan satu transaksi dengan saldo tidak cukup. Hasil per item dikembalikan; transaksi valid diproses, transaksi gagal tetap tidak mengubah saldo.
5. Semua jurnal diperiksa dengan menjumlahkan debit dan kredit setiap baris.

## Defect yang ditemukan dan diperbaiki

- **Cursor worker:** perhitungan awal window memakai batas waktu yang salah sehingga dapat mengambil rentang terlalu lebar. Sekarang cursor memakai `cursor - lookback` dan hanya memakai waktu awal konfigurasi ketika cursor belum ada.
- **Audit multi-dokumen:** `AuditLog.create([...], { session })` pada Mongoose memerlukan `ordered: true`. Tanpa itu, realisasi pembayaran dan konfirmasi rekonsiliasi dapat gagal di tengah alur. Opsi tersebut sudah ditambahkan.
- **Maker-checker:** actor tidak lagi dapat diganti dari body request. Actor diambil dari session/token, dan endpoint approval memblokir pembuat transaksi/request yang sama.

## Batasan hasil

- Pengujian integration menggunakan data sintetis dan belum mengaktifkan worker sumber.
- Belum ada worker Optik sesuai batasan tahap ini.
- Kategori Nagagold yang statusnya `OPEN` belum dapat dianggap final tanpa kontrak status dari sumber.
- Sebagian nilai kategori sumber tidak dapat didekripsi menjadi teks printable dengan algoritma yang sama seperti source code Nagagold. Nilai tersebut tidak boleh masuk auto-posting.
- Pengujian production/Atlas tidak dilakukan dan memang tidak diperlukan untuk membuktikan keamanan database testing.

