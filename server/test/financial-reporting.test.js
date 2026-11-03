import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFinancialEntry, financialSource, normalizeReportFilters } from '../reporting.js';

test('laporan keuangan mengklasifikasikan saldo awal berdasarkan tipe jurnal', () => {
  assert.deepEqual(
    classifyFinancialEntry({ tipe: 'SALDO_AWAL', debet: 200000000, kredit: 0 }),
    { code: 'SALDO_AWAL', label: 'SALDO AWAL' },
  );
});

test('laporan keuangan membedakan mutasi masuk dan keluar per rekening', () => {
  assert.deepEqual(
    classifyFinancialEntry({ tipe: 'MUTASI', debet: 40000000, kredit: 0 }, { bentukTransaksi: 'TRANSFER_INTERNAL' }),
    { code: 'MUTASI_MASUK', label: 'MUTASI MASUK' },
  );
  assert.deepEqual(
    classifyFinancialEntry({ tipe: 'MUTASI', debet: 0, kredit: 40000000 }, { bentukTransaksi: 'TRANSFER_INTERNAL' }),
    { code: 'MUTASI_KELUAR', label: 'MUTASI KELUAR' },
  );
});

test('laporan keuangan menaruh pembalikan dan tipe yang belum dikenal pada koreksi', () => {
  assert.deepEqual(
    classifyFinancialEntry({ tipe: 'PEMBALIKAN', debet: 0, kredit: 1000 }),
    { code: 'KOREKSI', label: 'KOREKSI' },
  );
  assert.deepEqual(
    classifyFinancialEntry({ tipe: 'TIPE_BARU', debet: 1000, kredit: 0 }),
    { code: 'LAINNYA', label: 'LAINNYA / BELUM TERKLASIFIKASI' },
  );
});

test('filter laporan keuangan default ke POSTED dan mempertahankan tanggal bisnis', () => {
  const filters = normalizeReportFilters({ dateFrom: '2026-10-28', dateTo: '2026-10-31', view: 'summary', groupBy: 'CASH_GROUP' });
  assert.equal(filters.dateFrom, '2026-10-28');
  assert.equal(filters.dateTo, '2026-10-31');
  assert.equal(filters.groupBy, 'CASH_GROUP');
  assert.equal(filters.view, 'summary');
  assert.equal(filters.includeEmptyAccounts, false);
});

test('laporan keuangan membedakan transaksi sumber OPTIK dan NAGAGOLD', () => {
  assert.equal(financialSource({ isImported: true, sumber: 'OPTIK' }), 'OPTIK');
  assert.equal(financialSource({ isImported: true, source_type: 'SYNC_OPTIK' }), 'OPTIK');
  assert.equal(financialSource({ isImported: true, sumber: 'NAGAGOLD' }), 'NAGAGOLD');
  assert.equal(financialSource({ source_type: 'MANUAL_ADMIN' }), 'FINANCE');
});
