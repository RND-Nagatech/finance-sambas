# Dry-run Nagagold — Stage 4D

Tanggal pemeriksaan: 29 Oktober 2026  
Mode: read-only production audit dan database testing terpisah.  
Auto-posting: nonaktif.

## Hasil klasifikasi Finance

Dry-run mengklasifikasikan ulang seluruh transaksi `tt_sinkronisasi` dengan `isImported=true` dan `sourceSystem=nagagold` tanpa menyimpan hasil klasifikasi.

| Hasil | Jumlah | Nominal |
|---|---:|---:|
| `AUTO_ELIGIBLE` | 0 | Rp0 |
| `REVIEW_REQUIRED` | 0 | Rp0 |
| `RECONCILIATION_REQUIRED` | 0 | Rp0 |
| `BLOCKED` | 247 | Rp89.832.577.660 |

Tidak ada transaksi dari 247 data tersebut yang memiliki pencatatan `tt_keuangan`, pasangan rekonsiliasi, atau request cabang terkait pada saat audit. Walaupun demikian, seluruh transaksi tetap `BLOCKED` karena snapshot lama dan mapping belum lengkap.

## Penyebab BLOCKED

- 245 transaksi legacy tidak menyimpan snapshot lengkap, termasuk `jumlah_in`/`jumlah_out`.
- 247 transaksi belum memiliki mapping rekening unik yang aktif.
- 37 transaksi legacy memiliki jenis/kategori yang belum terbaca aman.
- Status finalitas legacy belum tersedia.

Dua transaksi yang lebih baru sudah memiliki snapshot dan status dekripsi yang terbaca, tetapi tetap tertahan karena mapping dan finalitas belum cukup.

## Cakupan sumber vs Finance

Audit read-only cabang SPW menemukan 144.700 dokumen `tt_cash_daily` dengan:

- tanggal transaksi: `2022-01-26` sampai `2026-10-29`;
- waktu input: `2022-01-27` sampai `2026-10-29T08:11:47Z`;
- seluruh status sumber: `OPEN`;
- 84.204 dokumen memiliki `jumlah_in` saja;
- 59.656 memiliki `jumlah_out` saja;
- 840 bernilai nol pada kedua arah;
- tidak ada dokumen dengan kedua arah sama-sama bernilai.

Jenis yang terbaca pada sampel SPW:

| Jenis | Jumlah |
|---|---:|
| `CASH` | 121.938 |
| `DEBET` | 6.475 |
| `TRANSFER` | 4.242 |
| Tidak printable/tidak terbaca aman | 12.045 |

Kategori terbaca yang dominan:

| Kategori | Jumlah |
|---|---:|
| `PENJUALAN` | 69.647 |
| `PEMBELIAN` | 52.517 |
| `SALDO AWAL` | 13.782 |
| `TUKAR KURANG` | 6.878 |
| `SERVICE` | 777 |
| `KAS KECIL` | 49 |
| `BATAL BELI` | 40 |
| `KAS BESAR` | 4 |
| `LM ANTAM` | 34 |
| `ANTAM` | 19 |
| `KIRIM UANG` | 100 |
| `BELANJA` | 3 |
| `TITIPAN` | 1 |
| Varian kategori tidak printable/rusak | sekitar 7.725 |

Perbedaan 247 Finance dengan 144.700 sumber dapat dijelaskan:

1. Query audit sumber membaca seluruh histori `tt_cash_daily`.
2. Worker Finance membaca window berdasarkan `input_date`, bukan seluruh histori.
3. Konfigurasi saat audit: interval 10 menit, overlap 2 menit, initial lookback 60 menit, reconcile window 3 hari, limit 1.000, dan `NAGAGOLD_SYNC_INITIAL_FROM=2026-10-29T00:00:00+07:00`.
4. Data Finance yang ada memiliki tanggal transaksi `2026-10-26` sampai `2026-10-29`; 245 di antaranya adalah legacy yang snapshot sumbernya belum lengkap.
5. State worker SPW terakhir memiliki cursor `2026-10-29T08:11:47Z`, fetch terakhir membaca 1 data, memasukkan 0, dan memperbarui 1 metadata transaksi.

Dengan demikian, 247 bukan jumlah seluruh dokumen sumber dan tidak boleh digunakan sebagai rekonsiliasi histori penuh. Untuk backfill histori perlu proses terpisah, bertahap, read-only preview, dan persetujuan.

## Multiple invoice

41 dari 247 transaksi Finance memiliki lebih dari satu nomor faktur sumber. Ini sesuai dengan pola Nagagold bahwa satu `deskripsi/no_faktur_group` dapat menjadi pembayaran gabungan. Finance mempertahankan satu transaksi sumber dan menyimpan faktur sebagai detail; nominal tidak dikalikan berdasarkan jumlah faktur.

## Preview yang tersedia

### Preview snapshot

```http
POST /api/nagagold-transactions/snapshot-recovery/preview
```

Preview memeriksa source ID, database cabang, `sourceKey`, nominal, arah, fingerprint, dan perubahan status. Tidak ada endpoint apply production pada Stage 4D.

### Preview mapping massal

```http
POST /api/nagagold-mapping/bulk-preview
```

Preview mengelompokkan transaksi berdasarkan cabang, metode pembayaran, kode bank, dan nomor rekening. Hasilnya hanya usulan kandidat; mapping tidak disimpan otomatis.

## Perbandingan Stage 4C

| Ukuran | Stage 4C | Stage 4D |
|---|---:|---:|
| Transaksi Finance Nagagold | 247 | 247 |
| Nominal Finance | Rp89.832.577.660 | Rp89.832.577.660 |
| `AUTO_ELIGIBLE` | 0 | 0 |
| `BLOCKED` | 247 | 247 |
| Source SPW | 144.700 | 144.700 |
| Jurnal existing pada transaksi Nagagold | 0 | 0 |

Stage 4D tidak melonggarkan aturan. Hasil tetap `BLOCKED` karena itu yang paling aman berdasarkan bukti yang tersedia.

## Pengujian setelah perubahan

- `npm test`: 22 lulus, 0 gagal.
- `npm run test:integration`: lulus pada MongoDB testing terpisah, termasuk mapping CASH per cabang, bank dengan nomor sama tetapi bank berbeda, mapping ambigu, recovery snapshot, concurrency, idempotency, rollback, dan jurnal seimbang.
- `npm run build`: berhasil.
- Preview mapping massal dan preview recovery memiliki flag `previewOnly=true` serta `writesPerformed=false`.

## Keputusan sebelum tahap berikutnya

Auto-posting belum boleh diaktifkan sebelum:

1. status final Nagagold disepakati;
2. mapping rekening per cabang disetujui;
3. aturan settlement DEBET/CREDIT dipastikan;
4. pembatalan dan koreksi mempunyai referensi transaksi asal;
5. hasil recovery snapshot ditinjau dan disetujui satu per satu atau per batch yang jelas.
