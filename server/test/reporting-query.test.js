import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReportFilters, transactionMongoQuery } from '../reporting.js';

test('query laporan mutasi hanya mengambil mutasi Finance, bukan transaksi Nagagold import', () => {
  const filters = normalizeReportFilters({ dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  const query = transactionMongoQuery(filters, { mutationOnly: true });

  assert.equal(query.kategori_sistem, undefined);
  assert.deepEqual(query.isImported, { $ne: true });
  assert.equal(query.$and, undefined);
});
