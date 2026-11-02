# Rencana Mapping Akun Nagagold — Stage 4D

## Prinsip

Mapping tidak memilih rekening pertama dan tidak membuat master rekening otomatis. Setiap mapping harus dapat dijelaskan dengan kombinasi:

```text
source_system + unit + kode_toko + metode_pembayaran + kode_bank + nomor_rekening
```

Konfigurasi tersimpan di `tm_pemetaan_rekening`. Transaksi hasil sinkronisasi berada di `tt_sinkronisasi`, sedangkan mutasi Finance berada di `tt_mutasi`; master akun tetap di `tm_rekening`.

## Klasifikasi akun Finance

| Jenis akun | Kegunaan | Identitas wajib |
|---|---|---|
| `KAS_TUNAI_TOKO` | Uang tunai yang berada di toko | Unit `NAGAGOLD` dan `kode_toko` |
| `KAS_KECIL_OPERASIONAL` | Dana operasional toko yang dipisahkan dari uang tunai penjualan | Unit dan aturan operasional; tidak digunakan otomatis untuk `CASH` penjualan |
| `REKENING_BANK` | Rekening bank yang tercatat di Nagagold | Kode bank, nomor rekening, unit/konteks cabang |
| `KAS_BESAR` | Rekening/kas pengelolaan pusat atau kas besar unit | Unit dan rekening sumber/tujuan; bukan akun default untuk pembayaran toko |

## Rencana per metode

### CASH

Mapping:

```text
NAGAGOLD + kode_toko + CASH + nomor rekening "-"
  -> tm_rekening.jenis_akun = KAS_TUNAI_TOKO
  -> tm_rekening.kode_toko = kode_toko
```

`CASH` tidak membutuhkan nomor rekening bank. Ia tidak boleh dipetakan ke `KAS_KECIL_OPERASIONAL` hanya karena sama-sama berbentuk kas.

### DEBET

Source code menunjukkan `DEBET` digunakan sebagai metode pembayaran penjualan dan laporan EOD mencari rekening melalui `no_rekening` serta `kode_bank`. Finance harus memastikan terlebih dahulu apakah rekening yang dicatat adalah rekening settlement langsung atau rekening penampungan.

Syarat mapping:

- kode bank sumber tersedia;
- nomor rekening sumber tersedia;
- rekening Finance mempunyai bank dan nomor yang sama;
- mekanisme settlement sudah disetujui.

Tanpa bukti settlement, hasilnya `REVIEW_REQUIRED`, bukan auto-posting.

### TRANSFER

`TRANSFER` harus dipandang sebagai kemungkinan mutasi, bukan otomatis pendapatan atau beban. Cocokkan:

- rekening sumber dan tujuan;
- kode bank;
- cabang;
- request cabang atau referensi transfer;
- tanggal dan nominal;
- pasangan baris masuk/keluar.

Jika transfer Admin sudah tercatat, baris sumber menjadi pasangan rekonsiliasi dan tidak membuat jurnal kedua.

### KAS BESAR dan KAS KECIL

Keduanya harus menjadi akun yang berbeda dari `KAS_TUNAI_TOKO`. Mutasi antar-kas membutuhkan dua sisi sumber dan tujuan yang eksplisit. Mapping satu metode ke rekening pertama tidak diperbolehkan.

## Preview massal

Finance sekarang menyediakan:

```http
POST /api/nagagold-mapping/bulk-preview
```

Body opsional:

```json
{
  "kodeToko": "SPW",
  "metodePembayaran": "CASH",
  "kodeBank": "BCA",
  "nomorRekening": "123456789",
  "limit": 10000
}
```

Hasil dikelompokkan berdasarkan cabang, metode, bank, dan nomor rekening. Setiap kelompok menampilkan:

- jumlah transaksi dan nominal masuk/keluar;
- status sumber dan status mapping yang ada;
- kandidat rekening Finance;
- konfigurasi aktif yang sudah ada;
- hasil `TERPETAKAN_KONFIGURASI`, `KANDIDAT_UNIK`, `AMBIGU`, `BELUM_ADA_KANDIDAT`, atau `KONFIGURASI_TIDAK_VALID`.

Endpoint ini mengembalikan `previewOnly=true` dan `writesPerformed=false`. Tombolnya tersedia pada menu **Mapping Nagagold**.

## Urutan implementasi mapping

1. Pastikan seluruh cabang dan rekening sumber terbaca.
2. Buat/validasi master `tm_bank` dan `tm_rekening`.
3. Jalankan preview massal.
4. Periksa kelompok `AMBIGU` dan `BELUM_ADA_KANDIDAT`.
5. Simpan mapping hanya setelah Admin memilih rekening secara eksplisit.
6. Jalankan dry-run klasifikasi ulang.
7. Minta persetujuan aturan bisnis sebelum auto-posting.

Tidak ada langkah di atas yang mengubah saldo atau membuat jurnal posted.
