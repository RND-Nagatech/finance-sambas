import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NAGAGOLD_CLASSIFICATION_STATUSES,
  NAGAGOLD_CLASSIFICATION_RULE_VERSION,
  classifyNagagoldTransaction,
} from '../nagagold-classifier.js';
import { ACCOUNT_KINDS } from '../models.js';

const cashAccount = { _id: 'cash-qbs', nama_rekening: 'Kas Tunai QBS', jenis_akun: ACCOUNT_KINDS.STORE_CASH, bentuk_saldo: 'KAS_TUNAI', kode_toko: 'QBS' };
const businessCashAccount = { _id: 'cash-ng', nama_rekening: 'Kas Tunai Nagagold', jenis_akun: ACCOUNT_KINDS.CASH_ACCOUNT, bentuk_saldo: 'KAS_TUNAI', unit: 'NAGAGOLD' };
const bankAccount = { _id: 'bank-qbs', nama_rekening: 'Rekening BCA QBS', jenis_akun: ACCOUNT_KINDS.BANK_ACCOUNT, bentuk_saldo: 'REKENING_BANK', nomor_rekening: '123', kode_toko: 'QBS' };

function base(overrides = {}) {
  return {
    isImported: true,
    source_type: 'SYNC_NAGAGOLD',
    sourceKey: 'nagagold:QBS:tt_cash_daily:source-1',
    source_transaction_id: 'source-1',
    amount: 100000,
    source_amount_in: 100000,
    source_amount_out: 0,
    arahDana: 'MASUK',
    jenisSumber: 'CASH',
    kategoriSumber: 'PENJUALAN',
    statusSumber: 'CLOSED',
    source_payment_method: 'CASH',
    rekeningId: 'cash-qbs',
    mappingStatus: 'TERPETAKAN',
    reconciliation_status: 'UNMATCHED',
    journal_status: 'BELUM_DIBUAT',
    ...overrides,
  };
}

test('transaksi Cash dengan mapping lengkap menjadi kandidat auto-posting masa depan', () => {
  const result = classifyNagagoldTransaction(base(), { account: cashAccount, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE);
  assert.equal(result.ruleVersion, NAGAGOLD_CLASSIFICATION_RULE_VERSION);
  assert.equal(result.proposedJournal.debitAccountId, 'cash-qbs');
});

test('pembayaran penjualan melalui TRANSFER bukan mutasi Finance dan tidak dipaksa rekonsiliasi', () => {
  const result = classifyNagagoldTransaction(base({ jenisSumber: 'TRANSFER', source_payment_method: 'TRANSFER', kategoriSumber: 'PENJUALAN', sourceNoRekening: '123', sourceKodeBank: 'BCA', rekeningId: 'bank-qbs', statusSumber: 'CLOSED' }), { account: bankAccount, accountBankCode: 'BCA', sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE);
  assert.equal(result.flags.includes('RECONCILIATION_CANDIDATE'), false);
});

test('CASH menggunakan akun TUNAI berdasarkan unit bisnis tanpa kode toko akun', () => {
  const result = classifyNagagoldTransaction(base({ jenis_bisnis: 'NAGAGOLD', rekeningId: 'cash-ng' }), { account: businessCashAccount, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE);
});

test('CASH ambigu masuk BLOCKED dan tidak memiliki jurnal usulan', () => {
  const result = classifyNagagoldTransaction(base({ rekeningId: '' }), { account: null, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED);
  assert.equal(result.proposedJournal, null);
});

test('DEBET yang sudah divalidasi sumber mengikuti mapping rekening', () => {
  const result = classifyNagagoldTransaction(base({ jenisSumber: 'DEBET', source_payment_method: 'DEBET', sourceNoRekening: '123', sourceKodeBank: 'BCA', rekeningId: 'bank-qbs' }), { account: bankAccount, accountBankCode: 'BCA', sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE);
  assert.doesNotMatch(result.reason, /Makna DEBET/);
});

test('TRANSFER yang sudah MATCHED wajib tetap melalui rekonsiliasi dan tidak di-auto-post', () => {
  const result = classifyNagagoldTransaction(base({ jenisSumber: 'TRANSFER', source_payment_method: 'BANK', sourceNoRekening: '123', sourceKodeBank: 'BCA', rekeningId: 'bank-qbs', reconciliation_status: 'MATCHED', arahDana: 'KELUAR', source_amount_in: 0, source_amount_out: 100000 }), { account: bankAccount, accountBankCode: 'BCA', sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED);
});

test('request_id sumber yang tidak ditemukan ditahan dan tidak boleh diposting', () => {
  const result = classifyNagagoldTransaction(base({ requestId: 'RQS-TIDAK-ADA' }), { account: cashAccount, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED);
  assert.ok(result.flags.includes('REQUEST_NOT_FOUND'));
});

test('request_id yang belum memiliki realisasi tetap perlu rekonsiliasi', () => {
  const result = classifyNagagoldTransaction(base({ requestId: 'RQS-BELUM-BAYAR' }), { account: cashAccount, request: { requestId: 'RQS-BELUM-BAYAR', finance_transaction_id: '' }, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED);
  assert.ok(result.flags.includes('REQUEST_PAYMENT_NOT_RECORDED'));
});

test('OPEN dianggap tervalidasi kasir sesuai aturan bisnis Finance', () => {
  const result = classifyNagagoldTransaction(base({ statusSumber: 'OPEN' }), { account: cashAccount, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE);
});

test('teks terenkripsi yang tidak terbaca ditahan', () => {
  const result = classifyNagagoldTransaction(base({ kategoriSumber: '\u0001\u0002' }), { account: cashAccount, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED);
});

test('arah dana lama yang tidak menyimpan jumlah_in/jumlah_out ditahan', () => {
  const transaction = base();
  delete transaction.source_amount_in;
  delete transaction.source_amount_out;
  const result = classifyNagagoldTransaction(transaction, { account: cashAccount, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.equal(result.status, NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED);
});

test('beberapa faktur tetap satu proposal jurnal', () => {
  const result = classifyNagagoldTransaction(base({ sourceInvoiceNumbers: ['FJ-1', 'FJ-2'] }), { account: cashAccount, sourceStatusFinal: true, reconciliationCandidateCount: 0 });
  assert.ok(result.proposedJournal);
  assert.equal(result.proposedJournal.amount, 100000);
});

test('jurnal existing menjadi rekonsiliasi dan klasifikasi berulang konsisten', () => {
  const transaction = base({ journal_status: 'POSTED' });
  const context = { account: cashAccount, existingJournal: { journalType: 'PENJUALAN', status: 'POSTED' }, sourceStatusFinal: true, reconciliationCandidateCount: 0 };
  const first = classifyNagagoldTransaction(transaction, context);
  const second = classifyNagagoldTransaction(transaction, context);
  assert.equal(first.status, NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED);
  assert.deepEqual(second, first);
});
