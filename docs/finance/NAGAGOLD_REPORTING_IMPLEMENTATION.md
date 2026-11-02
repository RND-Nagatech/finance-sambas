# Implementasi Pelaporan Sumber Nagagold

Implementasi ini menggunakan `tt_sinkronisasi` sebagai cache Finance untuk satu
dokumen `tt_cash_daily` Nagagold. `sourceKey` dibentuk dari:

```text
nagagold:<KODE_TOKO>:tt_cash_daily:<ID_SUMBER>
```

Dengan begitu proses fetch berulang tidak membuat peristiwa transaksi kedua.

## Pemisahan laporan

- **Pergerakan Nagagold** menampilkan nilai monitoring dari snapshot
  `jumlah_in` dan `jumlah_out` sumber.
- **Saldo confirmed** hanya menghitung transaksi dengan
  `status=APPROVED` dan `journal_status=POSTED`.
- Transaksi yang sudah `MATCHED` dengan transaksi Finance tidak dihitung lagi
  sebagai confirmed karena perpindahan uangnya sudah direpresentasikan oleh
  transaksi Finance pasangan.
- Transaksi yang belum mapping, belum final, masih pending, atau gagal
  rekonsiliasi tetap terlihat sebagai monitoring.

Nomor faktur pada `sourceInvoiceNumbers` hanya menjadi rincian. Nilai sumber
tidak dijumlahkan per faktur, sehingga satu pembayaran yang mencakup beberapa
faktur tetap dihitung satu kali.

## Endpoint

```text
GET /api/reports/nagagold-source

Laporan sumber tersebut juga tersedia dalam dua tampilan khusus yang mengikuti
pemisahan operasional Nagagold:

- `GET /api/reports/nagagold-cash` hanya menampilkan event dengan metode `CASH`
  atau `no_rekening = "-"`;
- `GET /api/reports/nagagold-accounts` hanya menampilkan event non-CASH yang
  memiliki konteks rekening/bank.

Keduanya tetap membaca cache Finance `tt_sinkronisasi`, dengan satu baris Finance
untuk satu dokumen `tt_cash_daily`. Kolom sumber yang dipertahankan adalah
tanggal, nomor referensi, cabang, jenis, kategori, keterangan, bank/nomor
rekening, `jumlah_in`, dan `jumlah_out`. Nilai tersebut adalah monitoring
sumber; status approval dan jurnal Finance ditampilkan terpisah.
```

Endpoint menerima filter laporan standar seperti tanggal, cabang, kategori
sumber, metode pembayaran, status rekonsiliasi, status approval, dan status
jurnal. Endpoint ini bersifat read-only.

Export tersedia melalui:

```text
GET /api/reports/export?report=nagagold-source&format=xlsx
GET /api/reports/export?report=nagagold-source&format=pdf

Export khusus tersedia melalui `report=nagagold-cash` dan
`report=nagagold-accounts` dengan format yang sama.
```

## Identitas sumber

Saat sinkronisasi, `sourceDatabase` menyimpan nama database cabang yang
sebenarnya. `kodeToko` tetap menyimpan kode cabang. Keduanya tidak boleh
ditukar karena digunakan untuk audit dan pemulihan snapshot.

Auto-posting tetap nonaktif. Laporan ini tidak membuat jurnal, tidak mengubah
saldo, dan tidak mengubah status approval.
