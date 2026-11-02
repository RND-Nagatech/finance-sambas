# Rekomendasi Auto-posting Finance

## Keputusan Stage 4A

**Auto-posting kategori Nagagold belum diaktifkan.** Hasil audit menunjukkan semua dokumen aktif yang ditemukan berstatus `OPEN`, sebagian nilai kategori tidak dapat didekripsi menjadi teks printable, dan beberapa kategori dapat beririsan dengan transfer yang dicatat Admin.

Transaksi hasil fetch boleh disimpan sebagai transaksi terintegrasi dengan `source_type=SYNC_NAGAGOLD`, tetapi tetap dipisahkan dari approval Owner dan tidak boleh mengubah saldo confirmed sebelum aturan posting disetujui.

## Matriks rekomendasi

| Kondisi sumber | Arah | Perlakuan saat ini | Kandidat masa depan |
| --- | --- | --- | --- |
| `CASH` + `PENJUALAN`/`SERVICE`, status final terbukti, mapping Kas Tunai Toko tepat, belum matched | Masuk | REVIEW_ADMIN | AUTO_POST setelah gate terpenuhi |
| `CASH` + `PEMBELIAN`/`BELANJA`/biaya | Keluar | REVIEW_ADMIN | Approval atau rule terpisah |
| `DEBET` | Umumnya masuk berdasarkan `jumlah_in` | REVIEW_ADMIN | AUTO_POST terbatas setelah definisi bank/debet disahkan |
| `TRANSFER`/`KIRIM UANG`/`KAS BESAR` | Masuk atau keluar | RECONCILIATION | Tidak auto-post sebelum pasangan transfer jelas |
| `SALDO AWAL` | Umumnya masuk | IGNORE dari auto-post transaksi | Proses opening balance terpisah |
| `BATAL*` | Koreksi | RECONCILIATION | Reversal hanya dari referensi transaksi asal yang terverifikasi |
| Kategori atau `jenis` tidak terbaca | Tidak diketahui | REVIEW_ADMIN; jangan ubah saldo | Tidak direkomendasikan |
| Status sumber belum terbukti final | Tidak diketahui | REVIEW_ADMIN | Tidak direkomendasikan |

## Syarat sebelum auto-posting diaktifkan

1. Ada kontrak status sumber yang membedakan transaksi final, batal, dan masih terbuka.
2. Dekripsi lulus validasi printable/known-category; nilai yang gagal tidak diposting.
3. Mapping akun exact berdasarkan unit, kode toko, jenis akun, bank, dan nomor rekening. `CASH` memakai Kas Tunai Toko, bukan otomatis Kas Kecil Operasional.
4. Setiap dokumen mempunyai `sourceKey` yang stabil dan unik. Fetch ulang tidak boleh membuat transaksi/jurnal baru.
5. Ada aturan koreksi yang menghubungkan `BATAL*` ke transaksi asal; reversal harus idempotent.
6. Pemeriksaan rekonsiliasi berjalan sebelum posting ketika ada kandidat transaksi Admin/request cabang.
7. Jurnal dibuat satu kali dengan guard idempotency dan hanya memengaruhi saldo setelah status posting valid.
8. Retry worker tidak memajukan cursor jika penyimpanan batch gagal dan semua error dapat dilacak.
9. Perubahan status sumber tidak menimpa jurnal `POSTED`; koreksi menggunakan jurnal kompensasi/reversal.
10. Kategori tersebut disetujui pemilik bisnis melalui konfigurasi rule dan diuji di database testing.

## Aturan anti-duplikasi

- `MATCHED` hanya menyatakan dua transaksi adalah pasangan; bukan berarti `APPROVED` atau `PAID`.
- Nominal dan tanggal yang sama saja tidak boleh menghasilkan match otomatis.
- Nomor faktur dari `detail_transaction` digunakan sebagai detail referensi. Satu `tt_cash_daily` yang membayar banyak faktur tetap satu transaksi sumber dan satu kandidat jurnal.
- Jika mutasi transfer sudah tercatat lengkap melalui request/payment Finance, hasil fetch hanya menjadi referensi rekonsiliasi dan tidak membuat jurnal kedua.
- Jika pasangan manual masih pending atau rejected, hasil fetch tidak boleh menambah saldo confirmed.

## Rekomendasi implementasi berikutnya

Tahap setelah 4A sebaiknya menambahkan rule mapping dan layar review untuk kategori yang sudah memiliki bukti final. Aktifkan satu kategori paling sederhana terlebih dahulu melalui feature flag, jalankan backfill dry-run di database testing, lalu bandingkan saldo sumber dan Finance. Jangan mengaktifkan seluruh `CASH`, `DEBET`, atau `TRANSFER` sekaligus.

