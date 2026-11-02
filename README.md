# Finance Sambas

Program Finance Sambas dengan visual bergaya sistem operasional internal.

## Struktur project

```text
finance-sambas/
├── web/       # Frontend React + Vite
├── server/    # Backend Express + MongoDB
└── docs/      # PRD dan rancangan sistem
```

## Menjalankan frontend

```bash
cd web
cp .env.example .env
npm install
npm run dev
```

Buka alamat Vite yang tampil di terminal, biasanya `http://localhost:5173`.

## Menjalankan backend

Di terminal lain, salin `server/.env.example` menjadi `server/.env`, lalu isi koneksi MongoDB:

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Backend menyediakan API di `http://localhost:3000/api`. Jalankan frontend dengan `VITE_API_BASE_URL=http://localhost:3000/api` agar data diambil dari MongoDB. Jika backend belum aktif, frontend tetap memakai data demo lokal.

### Login dan seed user

Akun awal berupa satu `SUPER_USER` diatur melalui environment, lalu diimpor ke collection `tm_user` dengan:

```bash
cd server
npm run seed
```

Variable akun awal yang digunakan oleh seed:

- `AUTH_SUPER_USERNAME`, `AUTH_SUPER_PASSWORD`, dan `AUTH_SUPER_NAME`.

Ubah password pada `server/.env` sebelum menjalankan seed. Login berikutnya membaca user dari MongoDB, bukan dari environment. Password disimpan dalam bentuk hash. Session login berlaku sesuai `AUTH_SESSION_TTL_HOURS`, dan tombol **Keluar** tersedia pada menu informasi user.

User berikutnya dengan role `ADMIN` atau `OWNER` akan dibuat dari menu Data User setelah menu tersebut diimplementasikan.

Backend menggunakan collection berikut:

- `tm_user`;
- `tm_rekening`;
- `tm_bank`;
- `tt_request_transfer`;
- `tt_mutasi` untuk transaksi mutasi kas/rekening yang dibuat di Finance;
- `tt_sinkronisasi` untuk data transaksi hasil sinkronisasi dari sumber seperti Nagagold;
- `tt_saldo_awal`;
- `tt_keuangan`;
- `th_approval`;
- `th_audit`;
- `th_notifikasi`.

Finance tidak mengakses `tp_system` Nagagold untuk memvalidasi request. Integrasi transaksi dari `tt_cash_daily` akan dibuat terpisah dengan akses read-only atau endpoint integrasi.

## Fitur Finance

- Dashboard ringkasan Finance;
- daftar request cabang berbasis `kode_toko`;
- input transaksi dari request atau manual;
- daftar transaksi pending approval;
- input saldo awal per rekening dan approval saldo awal;
- checkbox-all dan approve/reject bulk;
- detail transaksi dan simulasi jurnal reversal saat reject;
- master bank dan master rekening dengan hierarki Kas Utama, Kas Besar, dan Kas Kecil;
- laporan transaksi;
- login dan logout berbasis session backend;
- Saat backend belum terhubung, data demo dapat tampil sebagai fallback browser. Pada mode database, data dibaca dari MongoDB dan tidak ada aksi reset data production dari UI.

## Catatan integrasi

Field request yang digunakan di API dan UI:

```json
{
  "request_id": "RQS-20261028-0001",
  "source_system": "nagagold",
  "jenis_request": "PEMBAYARAN_BUYBACK",
  "kode_toko": "QBS",
  "no_rekening": "1234567899",
  "nilai_rp": 10000000,
  "requested_at": "2026-10-28T09:00:00+07:00",
  "tujuan": "Pembayaran buyback"
}
```
