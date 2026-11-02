# Nagagold — Auto-posting Dry-run Stage 4B

## Fasilitas

Endpoint dry-run:

```http
POST /api/nagagold-transactions/classification/dry-run
```

Contoh body:

```json
{
  "kodeToko": "SPW",
  "dateFrom": "2026-10-01",
  "dateTo": "2026-10-29",
  "limit": 1000
}
```

Endpoint hanya dapat digunakan oleh `ADMIN`, `OWNER`, atau `SUPER_USER`. Hasilnya berisi:

- jumlah transaksi per jenis;
- jumlah dan nominal per hasil klasifikasi;
- akun debit/kredit yang diusulkan;
- daftar alasan transaksi perlu review atau ditahan;
- `ruleVersion`;
- `autoPostingEnabled=false`.

Dry-run tidak:

- membuat atau mengubah jurnal;
- mengubah `tm_rekening.saldo_akhir`;
- mengubah approval, payment, atau `status_valid`;
- mengonfirmasi request cabang;
- menulis ke database Nagagold;
- mengubah cursor sinkronisasi.

Endpoint klasifikasi satu transaksi tersedia di:

```http
POST /api/nagagold-transactions/:id/classify
```

Endpoint tersebut hanya menyimpan metadata klasifikasi pada `tt_sinkronisasi`. Sinkronisasi Nagagold setiap 10 menit juga menjalankan klasifikasi metadata setelah upsert, tanpa posting.

## Hasil simulasi read-only

Simulasi dijalankan terhadap transaksi Nagagold yang sudah tersimpan di Finance, menggunakan query read-only dan mesin aturan yang sama dengan endpoint dry-run. Cakupan ini adalah **246 transaksi `tt_sinkronisasi`**, bukan seluruh 144.698 dokumen sumber di cabang SPW.

| Hasil | Jumlah | Nominal |
| --- | ---: | ---: |
| `AUTO_ELIGIBLE` | 0 | Rp0 |
| `REVIEW_REQUIRED` | 0 | Rp0 |
| `RECONCILIATION_REQUIRED` | 0 | Rp0 |
| `BLOCKED` | 246 | Rp89.817.732.660 |

Penyebab utama: seluruh 246 transaksi lama belum menyimpan snapshot `jumlah_in`/`jumlah_out`, sehingga arah dana tidak boleh ditebak oleh classifier; 208 transaksi juga belum memiliki mapping rekening unik, dan 37 transaksi juga memiliki jenis/kategori terenkripsi yang belum terbaca aman. Tidak ada transaksi yang layak menjadi kandidat auto-posting pada data Finance saat simulasi dilakukan.

### Per jenis sumber

| Jenis terbaca | Jumlah | Nominal |
| --- | ---: | ---: |
| `CASH` | 186 | Rp411.488.000 |
| `TRANSFER` | 23 | Rp80.344.000 |
| `DEBET` | 10 | Rp29.952.000 |
| Jenis tidak terbaca bersih | 27 | Rp89.295.948.660 |

### Per kategori

| Kategori | Jumlah |
| --- | ---: |
| `PENJUALAN` | 115 |
| `PEMBELIAN` | 94 |
| `SALDO AWAL` | 27 |
| Kategori tidak terbaca bersih | 10 |

Seluruh data Finance yang disimulasikan memiliki `statusSumber=OPEN`, sehingga status tersebut tetap dianggap belum final.

## Interpretasi hasil

Hasil `BLOCKED` bukan berarti transaksi sumber dihapus atau ditolak secara bisnis. Artinya Finance belum memiliki bukti yang cukup untuk menyarankan posting aman. Admin perlu melengkapi mapping Kas Tunai Toko/rekening bank dan, untuk data terenkripsi, memastikan format/key sumber dapat dibaca secara konsisten.

Jika transaksi kemudian mempunyai pasangan Finance yang terverifikasi, hasil klasifikasinya menjadi `RECONCILIATION_REQUIRED`. Ini menjaga agar penerimaan hasil fetch tidak menambah saldo untuk kedua kalinya.

## Pengujian

Pengujian yang ditambahkan mencakup:

- Cash dengan mapping lengkap sebagai kandidat masa depan;
- Cash ambigu menjadi `BLOCKED`;
- Debet tetap `REVIEW_REQUIRED`;
- Transfer yang `MATCHED` tetap rekonsiliasi;
- status `OPEN` tetap review;
- nilai terenkripsi tidak terbaca ditahan;
- beberapa faktur tetap satu proposal jurnal;
- jurnal existing mencegah auto-posting;
- klasifikasi berulang menghasilkan keputusan konsisten;
- dry-run tidak mengubah saldo, jurnal, approval, atau status jurnal.

Hasil terakhir:

- `npm test`: 22 lulus, 0 gagal;
- integration MongoDB Stage 4A: lulus, 14 skenario;
- `npm run build`: lulus.

## Keputusan sebelum auto-posting

Auto-posting belum boleh diaktifkan sebelum disepakati:

1. status sumber final yang benar-benar berarti selesai;
2. mapping Kas Tunai Toko per cabang;
3. arti bisnis `DEBET` dan kategori pembelian/biaya;
4. hubungan `TRANSFER`/`KIRIM UANG` dengan request cabang;
5. aturan pembatalan dan reversal;
6. perbaikan/konfirmasi dekripsi kategori yang belum terbaca.

