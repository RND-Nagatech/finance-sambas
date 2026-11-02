import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECONCILIATION_STATUSES,
  candidateEvidence,
  candidateIsUseful,
  isCashPayment,
  isNagagoldInternalTransfer,
  normalizeNagagoldValue,
  reconciliationApplicable,
  sourcePaymentMethod,
} from '../reconciliation.js';

test('CASH tidak membutuhkan nomor rekening bank', () => {
  assert.equal(isCashPayment({ jenis: 'CASH', no_rekening: '-' }), true);
  assert.equal(isCashPayment({ jenis: 'TRANSFER', no_rekening: 'false', kode_bank: 'false' }), true);
  assert.equal(normalizeNagagoldValue('false'), '');
  assert.equal(sourcePaymentMethod({ jenis: 'CASH', no_rekening: '-' }), 'CASH');
  assert.equal(isCashPayment({ jenis: 'TRANSFER', no_rekening: '123', kode_bank: 'BCA' }), false);
});

test('nominal dan tanggal saja tidak cukup untuk pasangan otomatis', () => {
  const evidence = candidateEvidence(
    { isImported: true, arahDana: 'MASUK', amount: 10000000, transactionDate: '2026-10-28', kodeToko: 'QBS', rekeningId: 'cash-qbs' },
    { isImported: false, amount: 10000000, transactionDate: '2026-10-28', kodeToko: 'WTS', destinationAccountId: 'cash-wts' },
  );
  assert.equal(evidence.amountMatch, true);
  assert.equal(evidence.dateMatch, true);
  assert.equal(candidateIsUseful(evidence), false);
  assert.equal(RECONCILIATION_STATUSES.MATCH_CANDIDATE, 'MATCH_CANDIDATE');
});

test('pasangan kandidat memakai bukti cabang dan rekening', () => {
  const evidence = candidateEvidence(
    { isImported: true, arahDana: 'MASUK', amount: 10000000, transactionDate: '2026-10-28', kodeToko: 'QBS', rekeningId: 'cash-qbs' },
    { isImported: false, amount: 10000000, transactionDate: '2026-10-28', kodeToko: 'QBS', destinationAccountId: 'cash-qbs' },
  );
  assert.equal(evidence.branchMatch, true);
  assert.equal(evidence.accountMatch, true);
  assert.equal(candidateIsUseful(evidence), true);
});

test('request_id boleh mencocokkan tanggal penerimaan yang berbeda dari tanggal transfer', () => {
  const evidence = candidateEvidence(
    { isImported: true, requestId: 'RQS-001', arahDana: 'MASUK', amount: 10000000, transactionDate: '2026-10-29', kodeToko: 'QBS', rekeningId: 'cash-qbs' },
    { isImported: false, requestId: 'RQS-001', amount: 10000000, transactionDate: '2026-10-28', kodeToko: 'QBS', destinationAccountId: 'cash-qbs' },
  );
  assert.equal(evidence.requestMatch, true);
  assert.equal(evidence.dateMatch, false);
  assert.equal(candidateIsUseful(evidence), true);
});

test('transaksi sumber biasa tidak dipaksa mencari pasangan; request_id menjadi penanda duplikasi resmi', () => {
  assert.equal(reconciliationApplicable({ isImported: true, jenisSumber: 'TRANSFER', kategoriSumber: 'PENJUALAN' }), false);
  assert.equal(isNagagoldInternalTransfer({ isImported: true, jenisSumber: 'TRANSFER', kategoriSumber: 'TERIMA UANG' }), false);
  assert.equal(isNagagoldInternalTransfer({ isImported: true, jenisSumber: 'CASH', kategoriSumber: 'PENJUALAN', request_id: 'RQS-001' }), true);
  assert.equal(reconciliationApplicable({ isImported: true, jenisSumber: 'CASH', kategoriSumber: 'PENJUALAN', requestId: 'RQS-001' }), true);
  assert.equal(reconciliationApplicable({ bentukTransaksi: 'TRANSFER_INTERNAL' }), true);
  assert.equal(reconciliationApplicable({ bentukTransaksi: 'MUTASI_REKENING' }), true);
  assert.equal(reconciliationApplicable({ bentukTransaksi: 'LAINNYA', source_type: 'MANUAL_ADMIN' }), false);
});

