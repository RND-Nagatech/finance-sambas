import test from 'node:test';
import assert from 'node:assert/strict';
import { isNagagoldOpeningBalance } from '../nagagold-classifier.js';

test('saldo awal Nagagold tidak dianggap sebagai transaksi pergerakan kas', () => {
  assert.equal(isNagagoldOpeningBalance({ kategori: 'SALDO AWAL' }), true);
  assert.equal(isNagagoldOpeningBalance({ kategori_sumber: 'saldo awal' }), true);
  assert.equal(isNagagoldOpeningBalance({ kategori: 'PEMBELIAN', jenis: 'CASH' }), false);
  assert.equal(isNagagoldOpeningBalance({ kategori: 'PENJUALAN' }), false);
});
