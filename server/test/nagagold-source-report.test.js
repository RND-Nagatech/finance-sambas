import test from 'node:test';
import assert from 'node:assert/strict';
import { reportSourceRow, sourceMovement } from '../reporting.js';

test('satu dokumen sumber dengan beberapa faktur tetap dihitung sebagai satu pergerakan', () => {
  const movement = sourceMovement({ source_amount_in: 835000, source_amount_out: 0, arahDana: 'MASUK', amount: 835000 });
  const row = reportSourceRow({
    _id: 'finance-1',
    transactionNumber: 'NGT-1',
    source_transaction_id: 'cash-1',
    source_amount_in: 835000,
    source_amount_out: 0,
    amount: 835000,
    arahDana: 'MASUK',
    sourceInvoiceNumbers: ['FJ-001', 'FJ-002'],
    status: 'MENUNGGU_VALIDASI_ADMIN',
    journal_status: 'BELUM_DIBUAT',
  });

  assert.deepEqual(movement, { masuk: 835000, keluar: 0 });
  assert.equal(row.jumlahIn, 835000);
  assert.equal(row.jumlahOut, 0);
  assert.equal(row.sourceInvoiceNumbers.length, 2);
  assert.equal(row.confirmed, false);
});

test('transaksi sumber yang sudah matched tidak masuk confirmed lagi', () => {
  const row = reportSourceRow({
    _id: 'finance-2',
    transactionNumber: 'NGT-2',
    source_transaction_id: 'cash-2',
    source_amount_in: 10000000,
    amount: 10000000,
    arahDana: 'MASUK',
    status: 'APPROVED',
    journal_status: 'POSTED',
    reconciliation_status: 'MATCHED',
    matched_transaction_id: 'manual-1',
  });

  assert.equal(row.confirmed, false);
  assert.equal(row.confirmedIn, 0);
  assert.equal(row.excludedFromConfirmed, true);
});

test('transaksi posted yang tidak matched dapat masuk confirmed', () => {
  const row = reportSourceRow({
    _id: 'finance-3',
    transactionNumber: 'NGT-3',
    source_transaction_id: 'cash-3',
    source_amount_out: 2500000,
    amount: 2500000,
    arahDana: 'KELUAR',
    status: 'APPROVED',
    journal_status: 'POSTED',
    reconciliation_status: 'UNMATCHED',
  });

  assert.equal(row.confirmed, true);
  assert.equal(row.confirmedOut, 2500000);
});

test('baris laporan sumber mempertahankan konteks rekening dan keterangan Nagagold', () => {
  const row = reportSourceRow({
    _id: 'finance-bank-1',
    transactionNumber: 'NGT-BANK-1',
    source_transaction_id: 'cash-bank-1',
    sourceTanggal: '2026-10-31',
    sourceNoReff: 'TRF-001',
    sourceNoRekening: '1234567890',
    sourceKodeBank: 'BCA',
    sourceNamaBank: 'BANK CENTRAL ASIA',
    sourceKeterangan: 'SETORAN PENJUALAN',
    source_amount_in: 1500000,
    source_payment_method: 'TRANSFER',
    arahDana: 'MASUK',
    kodeToko: 'QBS',
  });

  assert.equal(row.sourceDate, '2026-10-31');
  assert.equal(row.noRekening, '1234567890');
  assert.equal(row.kodeBank, 'BCA');
  assert.equal(row.namaBank, 'BANK CENTRAL ASIA');
  assert.equal(row.keterangan, 'SETORAN PENJUALAN');
  assert.equal(row.jumlahIn, 1500000);
  assert.equal(row.jumlahOut, 0);
});
