import test from 'node:test';
import assert from 'node:assert/strict';
import { JournalEntry, TransferRequest, OpeningBalance, FinanceTransaction, ACCOUNT_KINDS } from '../models.js';

test('pencatatan keuangan flat dengan satu rekening dapat divalidasi tanpa koneksi database', async () => {
  const journal = new JournalEntry({
    no_keuangan: 'KU-20261029-0001',
    tanggal: '2026-10-29',
    tipe: 'SALDO_AWAL',
    rekening_id: 'ACCOUNT-A',
    debet: 100000,
    kredit: 0,
  });
  await assert.doesNotReject(journal.validate());
  assert.equal(journal.debet, 100000);
  assert.equal(journal.sumber, 'FINANCE');
});

test('jurnal keuangan menerima sumber integrasi yang eksplisit', async () => {
  const journal = new JournalEntry({
    no_keuangan: 'KU-20261029-0003',
    tanggal: '2026-10-29',
    tipe: 'PENJUALAN',
    sumber: 'OPTIK',
    rekening_id: 'ACCOUNT-OPTIK',
    debet: 0,
    kredit: 250000,
  });
  await assert.doesNotReject(journal.validate());
  assert.equal(journal.sumber, 'OPTIK');
});

test('pencatatan keuangan tanpa rekening atau nominal ditolak sebelum disimpan', async () => {
  const journal = new JournalEntry({
    no_keuangan: 'KU-20261029-0002',
    tanggal: '2026-10-29',
    tipe: 'PEMBALIKAN',
    rekening_id: '',
    debet: 0,
    kredit: 0,
  });
  await assert.rejects(journal.validate(), /rekening dan nominal/);
});

test('jenis akun kas membedakan kas tunai toko dan kas kecil operasional', () => {
  assert.notEqual(ACCOUNT_KINDS.STORE_CASH, ACCOUNT_KINDS.OPERATING_CASH);
  assert.equal(ACCOUNT_KINDS.CASH_ACCOUNT, 'KAS_TUNAI');
  assert.equal(ACCOUNT_KINDS.BANK_ACCOUNT, 'REKENING_BANK');
});

test('request approval tidak otomatis dianggap sudah dibayar', async () => {
  const request = new TransferRequest({
    requestId: 'TEST-RQS-1',
    sourceSystem: 'nagagold',
    jenisRequest: 'PEMBAYARAN_BUYBACK',
    kodeToko: 'QBS',
    noRekening: '123',
    nilaiRp: 100000,
    requestedAt: new Date(),
    status: 'APPROVED',
    approval_status: 'APPROVED',
    payment_status: 'MENUNGGU_TRANSFER',
  });
  await assert.doesNotReject(request.validate());
  assert.equal(request.payment_status, 'MENUNGGU_TRANSFER');
});

test('request yang diterima Admin menunggu approval Owner setelah realisasi transfer', async () => {
  const request = new TransferRequest({
    requestId: 'TEST-RQS-2',
    sourceSystem: 'nagagold',
    jenisRequest: 'PEMBAYARAN_BUYBACK',
    kodeToko: 'QBS',
    noRekening: '123',
    nilaiRp: 100000,
    requestedAt: new Date(),
    status: 'WAITING_PAYMENT_APPROVAL',
    approval_status: 'TIDAK_DIPERLUKAN',
    payment_status: 'MENUNGGU_APPROVAL',
  });
  await assert.doesNotReject(request.validate());
  assert.equal(request.status, 'WAITING_PAYMENT_APPROVAL');
  assert.equal(request.payment_status, 'MENUNGGU_APPROVAL');
});

test('permintaan dana internal tidak membutuhkan kode toko', async () => {
  const request = new TransferRequest({
    requestId: 'TEST-INTERNAL-RQS-1',
    sourceSystem: 'finance',
    asal_permintaan: 'INTERNAL',
    unit_pemohon: 'KAS BESAR NAGAGOLD',
    nama_pemohon: 'ADMIN FINANCE',
    jenisRequest: 'TAMBAHAN_OPERASIONAL',
    noRekening: 'AKUN-TUJUAN',
    nilaiRp: 100000,
    requestedAt: new Date(),
  });
  await assert.doesNotReject(request.validate());
  assert.equal(request.kodeToko, '');
  assert.equal(request.asal_permintaan, 'INTERNAL');
  assert.equal(request.source_account_id, null);
  assert.equal(request.destination_account_id, null);
});

test('saldo awal pending langsung diterapkan dan dapat dibalik saat ditolak', async () => {
  const transaction = new FinanceTransaction({
    transactionNumber: 'TEST-TRX-BALANCE',
    transactionDate: '2026-10-30',
    jenisTransaksi: 'MUTASI',
    jenisRequest: 'MUTASI_REKENING',
    sourceAccountId: '507f1f77bcf86cd799439011',
    destinationAccountId: '507f1f77bcf86cd799439012',
    amount: 100000,
    status: 'PENDING_APPROVAL',
    approval_status: 'PENDING',
    journal_status: 'PROVISIONAL',
    saldo_status: 'DITERAPKAN',
  });
  await assert.doesNotReject(transaction.validate());
  assert.equal(transaction.saldo_status, 'DITERAPKAN');

  const opening = new OpeningBalance({
    rekening_id: '507f1f77bcf86cd799439011',
    tanggal: '2026-10-30',
    nilai: 100000,
    status: 'PENDING_APPROVAL',
    saldo_status: 'DITERAPKAN',
  });
  await assert.doesNotReject(opening.validate());
  assert.equal(opening.saldo_status, 'DITERAPKAN');
});
