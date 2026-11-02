import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { Account, Bank, Branch, CashType, FinanceMutation, SyncTransaction, JournalEntry, RequestType, TransactionType, TransferRequest, User } from '../models.js';
import { hashPassword } from '../auth.js';

const testUri = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/finance_sambas_stage4a_test?replicaSet=rs0';
const productionUri = process.env.MONGODB_URI || '';
if (productionUri && testUri === productionUri) throw new Error('MONGODB_TEST_URI tidak boleh sama dengan MONGODB_URI production.');
const port = Number(process.env.STAGE4A_TEST_PORT || 3310);
const baseUrl = `http://127.0.0.1:${port}/api`;
const password = 'stage4a-test-password';
let serverProcess;
let sourceConnection;

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server Finance testing tidak berhasil aktif dalam 30 detik.');
}

async function login(username) {
  const response = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.token;
}

async function api(path, token, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(body)}`);
  return body;
}

async function post(path, token, body, expectedStatus = 200) {
  return api(path, token, { method: 'POST', body: JSON.stringify(body) }, expectedStatus);
}

async function createManual(token, sourceAccountId, destinationAccountId, amount, note = 'Test tahap 4A') {
  return post('/transactions', token, { transactionDate: '2026-10-29', jenisTransaksi: 'TRANSFER_INTERNAL', jenisRequest: 'TAMBAHAN_OPERASIONAL', kodeToko: 'QBS', sourceAccountId, destinationAccountId, amount, note }, 201);
}

async function accountBalance(accountId) {
  return Number((await Account.findById(accountId).lean()).saldo_akhir || 0);
}

async function run() {
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  const sourceDatabaseName = 'finance_sambas_stage4a_source';
  sourceConnection = await mongoose.createConnection(testUri, { dbName: sourceDatabaseName, serverSelectionTimeoutMS: 10000 }).asPromise();
  await sourceConnection.db.dropDatabase();
  await sourceConnection.db.collection('tt_cash_daily').insertOne({ _id: 'source-stage4a-001', no_reff: 'REF-STAGE4A-001', jenis: 'TRANSFER', tanggal: '2026-10-29', kategori: 'PENJUALAN', deskripsi: 'Test snapshot', keterangan: 'Test snapshot sumber', no_rekening: 'SRC-001', kode_bank: 'BCA', jumlah_in: 0, jumlah_out: 5000, input_date: new Date('2026-10-29T08:00:00.000Z'), status: 'OPEN', no_faktur_list: ['FJ-STAGE4A-001'], detail_transaction: [{ no_faktur: 'FJ-STAGE4A-001', harga_total: 5000 }] });
  await User.create([
    { username: 'admin-stage4a', nama_user: 'Admin Stage4A', role: 'ADMIN', password_hash: hashPassword(password), aktif: true },
    { username: 'owner-stage4a', nama_user: 'Owner Stage4A', role: 'OWNER', password_hash: hashPassword(password), aktif: true },
    { username: 'super-stage4a', nama_user: 'Super Stage4A', role: 'SUPER_USER', password_hash: hashPassword(password), aktif: true },
  ]);
  const [source, destination, empty] = await Account.create([
    { nama_rekening: 'Test Kas Besar', kelompok_rekening: 'KAS_BESAR', unit: 'NAGAGOLD', bentuk_saldo: 'REKENING_BANK', jenis_akun: 'KAS_BESAR', nomor_rekening: 'SRC-001', saldo_akhir: 0, aktif: true },
    { nama_rekening: 'Test Kas Kecil', kelompok_rekening: 'KAS_KECIL', unit: 'NAGAGOLD', bentuk_saldo: 'REKENING_BANK', jenis_akun: 'KAS_KECIL_OPERASIONAL', nomor_rekening: 'DEST-001', saldo_akhir: 0, aktif: true },
    { nama_rekening: 'Test Kas Kosong', kelompok_rekening: 'KAS_BESAR', unit: 'NAGAGOLD', bentuk_saldo: 'REKENING_BANK', jenis_akun: 'KAS_BESAR', nomor_rekening: 'EMPTY-001', saldo_akhir: 0, aktif: true },
  ]);
  const bankBca = await Bank.create({ kode_bank: 'BCA', nama_bank: 'Bank Central Asia', aktif: true });
  const bankMandiri = await Bank.create({ kode_bank: 'MANDIRI', nama_bank: 'Bank Mandiri', aktif: true });
  const [cashQbs, cashWts, bankBcaAccount, bankMandiriAccount] = await Account.create([
    { nama_rekening: 'Kas Tunai QBS', kelompok_rekening: 'KAS_KECIL', unit: 'NAGAGOLD', bentuk_saldo: 'KAS_TUNAI', jenis_akun: 'KAS_TUNAI_TOKO', kode_toko: 'QBS', saldo_akhir: 0, aktif: true },
    { nama_rekening: 'Kas Tunai WTS', kelompok_rekening: 'KAS_KECIL', unit: 'NAGAGOLD', bentuk_saldo: 'KAS_TUNAI', jenis_akun: 'KAS_TUNAI_TOKO', kode_toko: 'WTS', saldo_akhir: 0, aktif: true },
    { nama_rekening: 'Rekening BCA Mapping', kelompok_rekening: 'KAS_BESAR', unit: 'NAGAGOLD', bentuk_saldo: 'REKENING_BANK', jenis_akun: 'KAS_BESAR', bank_id: bankBca._id, nomor_rekening: 'SAME-001', saldo_akhir: 0, aktif: true },
    { nama_rekening: 'Rekening Mandiri Mapping', kelompok_rekening: 'KAS_BESAR', unit: 'NAGAGOLD', bentuk_saldo: 'REKENING_BANK', jenis_akun: 'KAS_BESAR', bank_id: bankMandiri._id, nomor_rekening: 'SAME-001', saldo_akhir: 0, aktif: true },
  ]);
  await Branch.create([
    { kode_toko: 'QBS', nama_toko: 'BACKUP SAMBAS #1', database_name: sourceDatabaseName, aktif: true },
    { kode_toko: 'WTS', nama_toko: 'WATES SAMBAS', database_name: `${sourceDatabaseName}_wts`, aktif: true },
  ]);
  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), MONGODB_URI: testUri, AUTH_ENABLED: 'true', NAGAGOLD_SYNC_ENABLED: 'false', NAGAGOLD_MONGODB_URI: testUri, NAGAGOLD_SYNC_INITIAL_FROM: '2026-10-29T00:00:00.000Z', NAGAGOLD_ENCRYPTION_MODE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverErrors = [];
  serverProcess.stderr.on('data', (chunk) => serverErrors.push(String(chunk)));
  await waitForHealth();
  const admin = await login('admin-stage4a');
  const owner = await login('owner-stage4a');
  const superUser = await login('super-stage4a');
  const cashTypes = await api('/cash-types', admin);
  assert.deepEqual(cashTypes.filter((item) => item.selectable).map((item) => item.code), ['KAS_UTAMA', 'KAS_BESAR_NAGAGOLD', 'KAS_KECIL_NAGAGOLD', 'KAS_BESAR_OPTIK', 'KAS_KECIL_OPTIK']);
  assert.equal(await CashType.countDocuments({ kode_jenis: { $in: ['KAS_UTAMA', 'KAS_BESAR_NAGAGOLD', 'KAS_KECIL_NAGAGOLD', 'KAS_BESAR_OPTIK', 'KAS_KECIL_OPTIK'] } }), 5);
  const kasBesarNagagold = cashTypes.find((item) => item.code === 'KAS_BESAR_NAGAGOLD');
  const positionAccount = await post('/accounts', admin, { posKasId: kasBesarNagagold.id, name: 'Rekening Pos Kas Besar Test', bankId: bankBca._id.toString(), accountNumber: 'POSITION-TEST-001', bentukSaldo: 'REKENING_BANK' }, 201);
  assert.equal(positionAccount.accountType, 'KAS_BESAR');
  assert.equal(positionAccount.unitType, 'NAGAGOLD');
  assert.equal(positionAccount.posKasCode, 'KAS_BESAR_NAGAGOLD');
  const requestTypes = await api('/request-types', admin);
  const transactionTypes = await api('/transaction-types', admin);
  assert.deepEqual(requestTypes.map((item) => item.code), ['PEMBAYARAN_BUYBACK', 'SALDO_AWAL', 'TAMBAHAN_OPERASIONAL', 'PENARIKAN_DANA']);
  assert.deepEqual(transactionTypes.map((item) => item.code), ['PEMBELIAN', 'PENJUALAN', 'TRANSFER_INTERNAL', 'OPERASIONAL']);
  assert.equal(await RequestType.countDocuments(), 4);
  assert.equal(await TransactionType.countDocuments(), 4);
  const customRequestType = await post('/request-types', admin, { code: 'REQUEST_TEST', name: 'Request Testing', order: 9 }, 201);
  assert.equal(customRequestType.name, 'REQUEST TESTING');
  await api(`/request-types/${customRequestType.id}`, admin, { method: 'DELETE' });
  const customTransactionType = await post('/transaction-types', admin, { code: 'TRANSACTION_TEST', name: 'Transaction Testing', order: 9 }, 201);
  assert.equal(customTransactionType.name, 'TRANSACTION TESTING');
  await api(`/transaction-types/${customTransactionType.id}`, admin, { method: 'DELETE' });
  const customCashType = await post('/cash-types', admin, { code: 'KAS_TEST', name: 'Kas Testing', order: 9 }, 201);
  assert.equal(customCashType.name, 'KAS TESTING');
  const updatedCashType = await api(`/cash-types/${customCashType.id}`, admin, { method: 'PATCH', body: JSON.stringify({ name: 'Kas Testing Updated', order: 10 }) });
  assert.equal(updatedCashType.name, 'KAS TESTING UPDATED');
  await api(`/cash-types/${customCashType.id}`, admin, { method: 'DELETE' });
  assert.equal((await CashType.findById(customCashType.id).lean()).aktif, false);
  await post('/transactions', owner, {}, 403);
  await post('/requests', owner, {}, 403);

  const cashMappingQbs = await post('/nagagold-mapping/test', admin, { kodeToko: 'QBS', metodePembayaran: 'CASH' });
  assert.equal(cashMappingQbs.status, 'TERPETAKAN');
  assert.equal(cashMappingQbs.rekening.id, cashQbs._id.toString());
  const cashMappingWts = await post('/nagagold-mapping/test', admin, { kodeToko: 'WTS', metodePembayaran: 'CASH' });
  assert.equal(cashMappingWts.rekening.id, cashWts._id.toString());
  const bankMappingBca = await post('/nagagold-mapping/test', admin, { kodeToko: 'QBS', metodePembayaran: 'BANK', kodeBank: 'BCA', nomorRekening: 'SAME-001' });
  assert.equal(bankMappingBca.status, 'TERPETAKAN');
  assert.equal(bankMappingBca.rekening.id, bankBcaAccount._id.toString());
  const ambiguousBank = await post('/nagagold-mapping/test', admin, { kodeToko: 'QBS', metodePembayaran: 'BANK', nomorRekening: 'SAME-001' });
  assert.equal(ambiguousBank.status, 'PEMETAAN_AMBIGU');
  await post('/nagagold-mapping', admin, { kodeToko: 'QBS', metodePembayaran: 'CASH', rekeningId: cashQbs._id.toString(), keterangan: 'Mapping test' }, 200);

  const opening = await post('/saldo-awal', admin, { rekeningId: source._id.toString(), date: '2026-10-29', amount: 1000000, note: 'Saldo awal testing' }, 201);
  assert.equal(await accountBalance(source._id), 1000000, 'Saldo awal harus langsung tercatat sebagai saldo Finance.');
  await post(`/saldo-awal/${opening.id}/approve`, owner, {}, 200);
  assert.equal(await accountBalance(source._id), 1000000, 'Approval saldo awal tidak boleh menggandakan saldo.');
  await post('/saldo-awal', admin, { rekeningId: source._id.toString(), date: '2026-10-29', amount: 1000000 }, 409);

  const manual = await createManual(admin, source._id.toString(), destination._id.toString(), 100000);
  const manualRecord = await FinanceMutation.findById(manual.id).lean();
  const provisional = await JournalEntry.findOne({ no_transaksi: manualRecord.transactionNumber, tipe: { $ne: 'PEMBALIKAN' } }).lean();
  assert.equal(provisional.status, 'PROVISIONAL');
  assert.equal(await accountBalance(source._id), 1000000, 'Input manual mengubah saldo sebelum approval.');
  const concurrentApproval = await Promise.all([
    post(`/transactions/${manual.id}/approve`, owner, {}, 200),
    post(`/transactions/${manual.id}/approve`, superUser, {}, 200),
  ]);
  assert.equal(concurrentApproval.filter((item) => item.processed?.includes(manual.id)).length, 1, 'Approval paralel harus hanya memproses satu kali.');
  assert.equal(await accountBalance(source._id), 900000);
  assert.equal(await accountBalance(destination._id), 100000);
  assert.equal((await JournalEntry.countDocuments({ no_transaksi: manualRecord.transactionNumber, tipe: { $ne: 'PEMBALIKAN' } })), 2);

  const makerTransaction = await createManual(admin, source._id.toString(), destination._id.toString(), 10000, 'Maker checker');
  await post(`/transactions/${makerTransaction.id}/approve`, admin, {}, 403);
  await post(`/transactions/${makerTransaction.id}/approve`, owner, {}, 200);

  const pendingReject = await createManual(admin, source._id.toString(), destination._id.toString(), 25000, 'Reject provisional');
  const pendingRejectRecord = await FinanceMutation.findById(pendingReject.id).lean();
  const beforeReject = await accountBalance(source._id);
  await post(`/transactions/${pendingReject.id}/reject`, owner, { reason: 'Data pengujian ditolak' }, 200);
  assert.equal(await accountBalance(source._id), beforeReject);
  assert.equal(await JournalEntry.countDocuments({ no_transaksi: pendingRejectRecord.transactionNumber, tipe: 'PEMBALIKAN' }), 0, 'Reject provisional tidak boleh membuat reversal saldo.');

  const postedForReversal = await createManual(admin, source._id.toString(), destination._id.toString(), 30000, 'Reversal');
  const postedForReversalRecord = await FinanceMutation.findById(postedForReversal.id).lean();
  await post(`/transactions/${postedForReversal.id}/approve`, owner, {}, 200);
  const afterPosted = await accountBalance(source._id);
  const firstReverse = await post(`/transactions/${postedForReversal.id}/reverse`, owner, { reason: 'Koreksi testing' }, 200);
  const secondReverse = await post(`/transactions/${postedForReversal.id}/reverse`, owner, { reason: 'Retry koreksi testing' }, 200);
  assert.equal(firstReverse.idempotent, false);
  assert.equal(secondReverse.idempotent, true);
  assert.equal(await JournalEntry.countDocuments({ no_transaksi: postedForReversalRecord.transactionNumber, tipe: 'PEMBALIKAN' }), 2);
  assert.equal(await accountBalance(source._id), afterPosted + 30000);

  const branchRequest = await post('/requests', admin, { request_id: 'RQS-20261029-0001', source_system: 'nagagold', jenis_request: 'PEMBAYARAN_BUYBACK', kode_toko: 'QBS', no_rekening: 'DEST-001', nilai_rp: 200000, requested_at: '2026-10-29T09:00:00+07:00', tujuan: 'Test realisasi' }, 201);
  await post(`/requests/${branchRequest.id}/submit-approval`, admin, {}, 200);
  await post(`/requests/${branchRequest.id}/approve`, owner, {}, 200);
  const requestSourceBefore = await accountBalance(source._id);
  const paymentBody = { sourceAccountId: source._id.toString(), destinationAccountId: destination._id.toString(), amount: 200000, transferDate: '2026-10-29', transferReference: 'TRF-STAGE4A-001' };
  const paymentOne = await post(`/requests/${branchRequest.id}/payment`, admin, paymentBody, 201);
  const paymentTwo = await post(`/requests/${branchRequest.id}/payment`, admin, paymentBody, 200);
  assert.equal(paymentTwo.idempotent, true);
  assert.equal(await TransferRequest.countDocuments({ _id: branchRequest.id, finance_transaction_id: { $ne: '' } }), 1);
  assert.equal(await FinanceMutation.countDocuments({ requestId: 'RQS-20261029-0001' }), 1);
  assert.equal(await JournalEntry.countDocuments({ no_transaksi: paymentOne.transaction.transactionNumber, tipe: { $ne: 'PEMBALIKAN' } }), 2);
  assert.equal(await accountBalance(source._id), requestSourceBefore - 200000);

  const blockedRequest = await post('/requests', admin, { request_id: 'RQS-20261029-0002', source_system: 'nagagold', jenis_request: 'PEMBAYARAN_BUYBACK', kode_toko: 'QBS', no_rekening: 'DEST-001', nilai_rp: 50000, requested_at: '2026-10-29T09:10:00+07:00', tujuan: 'Belum approved' }, 201);
  const blockedBefore = await accountBalance(source._id);
  await post(`/requests/${blockedRequest.id}/payment`, admin, { ...paymentBody, amount: 50000, transferReference: 'TRF-STAGE4A-BLOCKED' }, 409);
  assert.equal(await accountBalance(source._id), blockedBefore);

  const reconciliationManual = await createManual(admin, source._id.toString(), destination._id.toString(), 5000, 'Pasangan rekonsiliasi');
  const imported = await SyncTransaction.create({ transactionNumber: 'SYN-20261029-0001', bentukTransaksi: 'MUTASI_REKENING', transactionDate: '2026-10-29', jenisTransaksi: 'MUTASI_REKENING', jenisRequest: 'PENJUALAN', arahDana: 'KELUAR', kodeToko: 'QBS', rekeningId: source._id, amount: 5000, status: 'MENUNGGU_VALIDASI_ADMIN', statusValid: false, isImported: true, sourceSystem: 'nagagold', sourceDatabase: sourceDatabaseName, sourceCollection: 'tt_cash_daily', sourceId: 'source-stage4a-001', sourceKey: 'nagagold:QBS:tt_cash_daily:source-stage4a-001', source_transaction_id: 'source-stage4a-001', source_database_name: sourceDatabaseName, source_type: 'SYNC_NAGAGOLD', sync_status: 'TERCATAT', approval_status: 'BELUM_DIPERIKSA', mappingStatus: 'TERPETAKAN', statusSumber: 'OPEN', source_payment_method: 'BANK', reconciliation_status: 'UNMATCHED', journal_status: 'BELUM_DIBUAT' });
  const journalBeforeMatch = await JournalEntry.countDocuments({ no_transaksi: imported.transactionNumber });
  await post(`/transactions/${imported._id}/reconciliation/confirm`, admin, { matchedTransactionId: reconciliationManual.id }, 200);
  assert.equal(await JournalEntry.countDocuments({ no_transaksi: imported.transactionNumber }), journalBeforeMatch, 'Rekonsiliasi tidak boleh membuat jurnal tambahan.');

  const bulkMappingPreview = await post('/nagagold-mapping/bulk-preview', admin, { kodeToko: 'QBS', limit: 100 }, 200);
  assert.equal(bulkMappingPreview.previewOnly, true);
  assert.equal(bulkMappingPreview.writesPerformed, false);
  assert.ok(bulkMappingPreview.rows.some((row) => row.kodeToko === 'QBS'));

  const dryRunBalance = await accountBalance(source._id);
  const dryRunJournalCount = await JournalEntry.countDocuments({});
  const dryRunBefore = await SyncTransaction.findById(imported._id).lean();
  const dryRun = await post('/nagagold-transactions/classification/dry-run', admin, { limit: 100 }, 200);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.autoPostingEnabled, false);
  assert.ok(dryRun.summary.byClassification.some((item) => item.status === 'RECONCILIATION_REQUIRED'));
  assert.equal(await accountBalance(source._id), dryRunBalance, 'Dry-run mengubah saldo.');
  assert.equal(await JournalEntry.countDocuments({}), dryRunJournalCount, 'Dry-run membuat atau mengubah jumlah jurnal.');
  const dryRunAfter = await SyncTransaction.findById(imported._id).lean();
  assert.equal(dryRunAfter.approval_status, dryRunBefore.approval_status, 'Dry-run mengubah approval status.');
  assert.equal(dryRunAfter.journal_status, dryRunBefore.journal_status, 'Dry-run mengubah journal status.');

  const dashboardReport = await api('/reports/dashboard?dateFrom=2026-10-29&dateTo=2026-10-29&kodeToko=QBS', admin);
  assert.equal(dashboardReport.timezone, 'Asia/Jakarta');
  assert.equal(typeof dashboardReport.balances.total, 'number');
  assert.equal(typeof dashboardReport.operations.mappingFailed, 'number');
  assert.ok(Array.isArray(dashboardReport.balanceRows));
  assert.ok(Array.isArray(dashboardReport.flow));
  assert.ok(Array.isArray(dashboardReport.categories));
  const transactionReport = await api('/reports/transactions?dateFrom=2026-10-29&dateTo=2026-10-29&pageSize=100', admin);
  assert.ok(transactionReport.total >= 1);
  assert.ok(transactionReport.rows.some((row) => row.sourceType === 'SYNC_NAGAGOLD'));
  assert.ok(transactionReport.rows.some((row) => row.sourceType === 'MANUAL_ADMIN'));
  const importedReportRow = transactionReport.rows.find((row) => row.id === imported._id.toString());
  assert.equal(importedReportRow.confirmedAmount, 0, 'Transaksi Nagagold belum posted tidak boleh masuk saldo confirmed.');
  const integratedReport = await api('/reports/integrated?dateFrom=2026-10-29&dateTo=2026-10-29', admin);
  assert.ok(integratedReport.rows.some((row) => row.id === imported._id.toString()));
  const balanceReport = await api('/reports/balances?dateFrom=2026-10-29&dateTo=2026-10-29', admin);
  const sourceBalanceRow = balanceReport.rows.find((row) => row.rekeningId === source._id.toString());
  assert.ok(sourceBalanceRow);
  assert.equal(sourceBalanceRow.totalDebit >= 0, true);
  const journalReport = await api('/reports/journals?dateFrom=2026-10-29&dateTo=2026-10-29', admin);
  assert.ok(journalReport.total > 0);
  const reconciliationReport = await api('/reports/reconciliation?dateFrom=2026-10-29&dateTo=2026-10-29', admin);
  assert.ok(reconciliationReport.summary);
  const exportExcel = await fetch(`${baseUrl}/reports/export?report=transactions&format=xlsx&dateFrom=2026-10-29&dateTo=2026-10-29`, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(exportExcel.status, 200);
  assert.match(exportExcel.headers.get('content-type') || '', /spreadsheetml/);
  assert.ok((await exportExcel.arrayBuffer()).byteLength > 100);
  const exportPdf = await fetch(`${baseUrl}/reports/export?report=balances&format=pdf&dateFrom=2026-10-29&dateTo=2026-10-29`, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal(exportPdf.status, 200);
  assert.match(exportPdf.headers.get('content-type') || '', /application\/pdf/);
  assert.ok((await exportPdf.arrayBuffer()).byteLength > 100);

  const recoveryBalance = await accountBalance(source._id);
  const recoveryJournalCount = await JournalEntry.countDocuments({});
  const recoveryPreview = await post('/nagagold-transactions/snapshot-recovery/preview', admin, { ids: [imported._id.toString()] }, 200);
  assert.equal(recoveryPreview.previewOnly, true);
  assert.equal(recoveryPreview.writesPerformed, false);
  assert.equal(recoveryPreview.summary.PENDING_APPLY, 1);
  assert.equal(recoveryPreview.transactions[0].amountConsistent, true);
  assert.equal(typeof recoveryPreview.previewToken, 'string');
  assert.equal(await accountBalance(source._id), recoveryBalance, 'Preview recovery mengubah saldo.');
  assert.equal(await JournalEntry.countDocuments({}), recoveryJournalCount, 'Preview recovery mengubah jurnal.');
  await sourceConnection.db.collection('tt_cash_daily').updateOne({ _id: 'source-stage4a-001' }, { $set: { jumlah_out: 6000 } });
  const changedSourcePreview = await post('/nagagold-transactions/snapshot-recovery/preview', admin, { ids: [imported._id.toString()] }, 200);
  assert.equal(changedSourcePreview.summary.PREVIEW_MISMATCH, 1);
  await sourceConnection.db.collection('tt_cash_daily').updateOne({ _id: 'source-stage4a-001' }, { $set: { jumlah_out: 5000 } });

  const autoPostingRulesBefore = await api('/nagagold-auto-posting/rules', admin);
  assert.equal(autoPostingRulesBefore.productionEnabled, false);
  assert.equal(autoPostingRulesBefore.rules.length, 0);
  const savedAutoPostingRule = await post('/nagagold-auto-posting/rules', admin, { kodeToko: 'QBS', jenisTransaksi: 'CASH', kategoriTransaksi: 'PENJUALAN', metodePembayaran: 'CASH', keterangan: 'Rule testing; belum diaktifkan.' }, 200);
  assert.equal(savedAutoPostingRule.rule.isActive, false, 'Whitelist auto-posting harus nonaktif secara default.');
  await api(`/nagagold-auto-posting/rules/${savedAutoPostingRule.rule.id}`, owner, { method: 'PATCH', body: JSON.stringify({ aktif: true, confirmation: 'AKTIFKAN_AUTO_POSTING' }) }, 409);

  const applyBalance = await accountBalance(source._id);
  const applyJournalCount = await JournalEntry.countDocuments({});
  const recoveryApply = await post('/nagagold-transactions/snapshot-recovery/apply', owner, { ids: [imported._id.toString()], previewToken: recoveryPreview.previewToken, confirmation: 'APPLY_NAGAGOLD_SNAPSHOT_RECOVERY', batchId: 'STAGE4A-SNAPSHOT-001' }, 200);
  assert.equal(recoveryApply.summary.applied, 1);
  const recoveredTransaction = await SyncTransaction.findById(imported._id).lean();
  assert.equal(recoveredTransaction.source_amount_out, 5000, JSON.stringify(recoveryApply));
  assert.equal(recoveredTransaction.sourceSnapshotRecoveryStatus, 'APPLIED');
  assert.equal(await accountBalance(source._id), applyBalance, 'Pemulihan snapshot mengubah saldo.');
  assert.equal(await JournalEntry.countDocuments({}), applyJournalCount, 'Pemulihan snapshot membuat atau mengubah jurnal.');
  const recoveryApplyAgain = await post('/nagagold-transactions/snapshot-recovery/apply', owner, { ids: [imported._id.toString()], previewToken: recoveryPreview.previewToken, confirmation: 'APPLY_NAGAGOLD_SNAPSHOT_RECOVERY', batchId: 'STAGE4A-SNAPSHOT-001' }, 200);
  assert.equal(recoveryApplyAgain.summary.idempotent, 1, 'Pemulihan snapshot berulang harus idempotent.');

  await sourceConnection.db.collection('tt_cash_daily').insertOne({ _id: 'source-stage4a-request-001', no_reff: 'REF-STAGE4A-REQUEST-001', request_id: 'RQS-20261029-0001', jenis: 'TRANSFER', tanggal: '2026-10-29', kategori: 'PEMBAYARAN_BUYBACK', deskripsi: 'Penerimaan dana pusat', keterangan: 'Request transfer dari Finance', no_rekening: 'DEST-001', kode_bank: '', jumlah_in: 200000, jumlah_out: 0, input_date: new Date('2026-10-29T10:00:00.000Z'), status: 'OPEN', no_faktur_list: [] });
  const countBeforeSyncRun = await SyncTransaction.countDocuments({});
  const destinationBalanceBeforeMirror = await accountBalance(destination._id);
  const journalCountBeforeMirror = await JournalEntry.countDocuments({});
  const manualSync = await post('/sinkronisasi/nagagold/run', admin, {});
  assert.equal(manualSync.skipped, false);
  assert.ok(manualSync.results.some((item) => item.kodeToko === 'QBS'));
  assert.equal(await SyncTransaction.countDocuments({}), countBeforeSyncRun + 1, 'Fetch ulang sourceKey yang sama membuat transaksi duplikat atau request mirror tidak tercatat.');
  const requestMirror = await SyncTransaction.findOne({ isImported: true, requestId: 'RQS-20261029-0001' }).lean();
  assert.ok(requestMirror, 'request_id dari tt_cash_daily tidak tersimpan di tt_sinkronisasi.');
  assert.equal(requestMirror.reconciliation_status, 'MATCHED', 'Penerimaan dengan request_id yang sudah terealisasi harus otomatis MATCHED.');
  assert.equal(requestMirror.match_method, 'REQUEST_ID');
  assert.equal(requestMirror.matched_transaction_id, paymentOne.transaction.id);
  assert.equal(requestMirror.approval_status, 'TIDAK_DIPERLUKAN');
  assert.equal(requestMirror.journal_status, 'BELUM_DIBUAT');
  assert.equal(await accountBalance(destination._id), destinationBalanceBeforeMirror, 'Penerimaan mirror Nagagold mengubah saldo untuk kedua kalinya.');
  assert.equal(await JournalEntry.countDocuments({}), journalCountBeforeMirror, 'Penerimaan mirror Nagagold membuat jurnal tambahan.');

  const bulkGood = await createManual(admin, source._id.toString(), destination._id.toString(), 1000, 'Bulk good');
  const bulkBad = await FinanceMutation.create({ transactionNumber: 'MTS-20261029-0099', bentukTransaksi: 'TRANSFER_INTERNAL', transactionDate: '2026-10-29', jenisTransaksi: 'TRANSFER_INTERNAL', jenisRequest: 'TAHAP4A_TEST', kodeToko: 'QBS', sourceAccountId: empty._id, destinationAccountId: destination._id, amount: 999999999, status: 'PENDING_APPROVAL', approval_status: 'PENDING', statusValid: false, journal_status: 'PROVISIONAL', source_type: 'MANUAL_ADMIN', payment_status: 'TIDAK_BERLAKU', reconciliation_status: 'UNMATCHED', createdBy: 'Admin Stage4A' });
  await JournalEntry.create([
    { no_keuangan: 'KU-20261029-9001', no_transaksi: bulkBad.transactionNumber, tanggal: '2026-10-29', tipe: 'TRANSAKSI', rekening_id: destination._id.toString(), debet: bulkBad.amount, kredit: 0, status: 'PROVISIONAL', dibuat_oleh: 'System' },
    { no_keuangan: 'KU-20261029-9002', no_transaksi: bulkBad.transactionNumber, tanggal: '2026-10-29', tipe: 'TRANSAKSI', rekening_id: empty._id.toString(), debet: 0, kredit: bulkBad.amount, status: 'PROVISIONAL', dibuat_oleh: 'System' },
  ]);
  const bulkBefore = await accountBalance(source._id);
  const bulkResult = await post('/transactions/bulk-approve', owner, { ids: [bulkGood.id, bulkBad._id.toString()] }, 200);
  assert.equal(bulkResult.processed.includes(bulkGood.id), true);
  assert.equal(bulkResult.failed.some((item) => item.id === bulkBad._id.toString()), true);
  assert.equal(await accountBalance(source._id), bulkBefore - 1000);
  assert.equal(await accountBalance(empty._id), 0);

  const rollbackBalance = await accountBalance(source._id);
  const rollbackJournalNumber = 'KU-20261029-9003';
  const rollbackSession = await mongoose.startSession();
  try {
    await rollbackSession.withTransaction(async () => {
      await Account.updateOne({ _id: source._id }, { $inc: { saldo_akhir: 12345 } }, { session: rollbackSession });
      await JournalEntry.create([{
        no_keuangan: rollbackJournalNumber,
        no_transaksi: 'stage4a-rollback',
        tanggal: '2026-10-29',
        tipe: 'TRANSAKSI',
        rekening_id: source._id.toString(),
        debet: 12345,
        kredit: 0,
        status: 'PROVISIONAL',
        dibuat_oleh: 'Stage4A rollback test',
      }], { session: rollbackSession, ordered: true });
      throw new Error('forced rollback for Stage 4A');
    });
  } catch (error) {
    assert.match(error.message, /forced rollback/);
  } finally {
    await rollbackSession.endSession();
  }
  assert.equal(await accountBalance(source._id), rollbackBalance, 'Rollback tidak mengembalikan saldo akun.');
  assert.equal(await JournalEntry.countDocuments({ no_keuangan: rollbackJournalNumber }), 0, 'Rollback masih menyisakan jurnal.');

  const journals = await JournalEntry.find({}).lean();
  assert.ok(journals.length > 0);
  const posted = await JournalEntry.find({ status: 'POSTED' }).lean();
  const expectedBalances = new Map();
  for (const journal of posted) if (mongoose.isValidObjectId(journal.rekening_id)) expectedBalances.set(journal.rekening_id, (expectedBalances.get(journal.rekening_id) || 0) + Number(journal.debet || 0) - Number(journal.kredit || 0));
  for (const [accountId, expected] of expectedBalances) assert.equal(await accountBalance(accountId), expected, `Saldo akun ${accountId} tidak sama dengan jurnal posted.`);

  console.log(JSON.stringify({ ok: true, database: 'finance_sambas_stage4a_test', scenarios: 16, journals: journals.length, postedJournals: posted.length, makerChecker: true, concurrency: true, idempotency: true, rollback: true, requestIdReconciliation: true, cashPositionHierarchy: true }, null, 2));
}

try {
  await run();
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error.message, stack: error.stack }, null, 2));
  if (serverProcess) serverProcess.kill('SIGTERM');
  await mongoose.disconnect();
  process.exitCode = 1;
} finally {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill('SIGTERM');
  if (sourceConnection) await sourceConnection.close();
  await mongoose.disconnect();
}
