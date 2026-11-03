import mongoose from 'mongoose';
import { Account, BalanceSnapshot, BusinessType, CashType, FinanceMutation, JournalEntry, OpeningBalance, SyncState, SyncTransaction, TransferRequest } from './models.js';
import { ACCOUNT_KINDS } from './models.js';
import { isCashPayment, isNagagoldInternalTransfer } from './reconciliation.js';

const REPORT_TIMEZONE = 'Asia/Jakarta';
const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 20000;
const SYNC_SOURCE_TYPES = ['SYNC', 'SYNC_NAGAGOLD', 'SYNC_OPTIK'];

function displayReconciliationStatus(transaction = {}) {
  if (transaction.isImported && !isNagagoldInternalTransfer(transaction) && !transaction.matched_transaction_id) return 'NOT_APPLICABLE';
  return transaction.reconciliation_status || 'NOT_APPLICABLE';
}

function localDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function firstOfMonth(value = new Date()) {
  return `${localDate(value).slice(0, 7)}-01`;
}

function cleanDate(value, fallback) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}

function booleanFilter(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'ya'].includes(String(value).trim().toLowerCase());
}

export function normalizeReportFilters(input = {}) {
  const today = localDate();
  const selectedBranch = String(input.kodeToko || input.kode_toko || '').trim().toUpperCase();
  const branchParts = selectedBranch.split('::');
  const branchBusiness = branchParts.length === 2 ? branchParts[0] : '';
  const branchCode = branchParts.length === 2 ? branchParts[1] : selectedBranch;
  const filters = {
    dateFrom: cleanDate(input.dateFrom || input.tanggalDari, firstOfMonth()),
    dateTo: cleanDate(input.dateTo || input.tanggalSampai, today),
    postingDateFrom: cleanDate(input.postingDateFrom, ''),
    postingDateTo: cleanDate(input.postingDateTo, ''),
    kodeToko: branchCode,
    sourceType: String(input.sourceType || input.source_type || '').trim().toUpperCase(),
    jenisTransaksi: String(input.jenisTransaksi || input.jenis_transaksi || '').trim().toUpperCase(),
    bentukTransaksi: String(input.bentukTransaksi || input.bentuk_transaksi || '').trim().toUpperCase(),
    bentukSaldo: String(input.bentukSaldo || input.bentuk_saldo || input.jenisPenyimpanan || input.jenis_penyimpanan || '').trim().toUpperCase(),
    search: String(input.search || '').trim(),
    accountId: String(input.accountId || input.rekeningId || input.rekening_id || '').trim(),
    unit: String(input.unit || input.unitBisnis || input.jenisBisnis || input.jenis_bisnis || branchBusiness).trim().toUpperCase(),
    kelompokKasId: String(input.kelompokKasId || input.kelompok_kas_id || input.cashGroupId || '').trim(),
    includeSubgroups: booleanFilter(input.includeSubgroups ?? input.sertakanSubkelompok, false),
    includeEmptyAccounts: booleanFilter(input.includeEmptyAccounts ?? input.tampilkanRekeningTanpaTransaksi, false),
    detailDirection: String(input.detailDirection || input.arah || '').trim().toUpperCase(),
    nomorKeuangan: String(input.nomorKeuangan || input.noKeuangan || '').trim(),
    nomorTransaksi: String(input.nomorTransaksi || input.noTransaksi || '').trim(),
    keterangan: String(input.keterangan || '').trim(),
    kategoriKeuangan: String(input.kategoriKeuangan || input.financialCategory || '').trim().toUpperCase(),
    groupBy: ['CASH_GROUP', 'ACCOUNT', 'UNIT', 'BRANCH', 'CATEGORY'].includes(String(input.groupBy || 'CASH_GROUP').trim().toUpperCase()) ? String(input.groupBy || 'CASH_GROUP').trim().toUpperCase() : 'CASH_GROUP',
    view: String(input.view || 'detail').trim().toLowerCase() === 'summary' ? 'summary' : 'detail',
    approvalStatus: String(input.approvalStatus || input.approval_status || '').trim().toUpperCase(),
    journalStatus: String(input.journalStatus || input.journal_status || '').trim().toUpperCase(),
    syncStatus: String(input.syncStatus || input.sync_status || '').trim().toUpperCase(),
    reconciliationStatus: String(input.reconciliationStatus || input.reconciliation_status || '').trim().toUpperCase(),
    mappingStatus: String(input.mappingStatus || input.mapping_status || '').trim().toUpperCase(),
    classificationStatus: String(input.classificationStatus || input.classification_status || '').trim().toUpperCase(),
    kategoriSumber: String(input.kategoriSumber || input.kategori_sumber || '').trim().toUpperCase(),
    metodePembayaran: String(input.metodePembayaran || input.metode_pembayaran || '').trim().toUpperCase(),
    statusSumber: String(input.statusSumber || input.status_sumber || '').trim().toUpperCase(),
    sourceFinalityStatus: String(input.sourceFinalityStatus || input.source_finality_status || '').trim().toUpperCase(),
    status: String(input.status || '').trim().toUpperCase(),
    page: Math.max(1, Number(input.page || 1)),
    pageSize: Math.min(input.export ? MAX_EXPORT_ROWS : MAX_PAGE_SIZE, Math.max(1, Number(input.pageSize || input.limit || 25))),
    sortBy: ['transactionDate', 'createdAt', 'amount', 'transactionNumber'].includes(input.sortBy) ? input.sortBy : 'transactionDate',
    sortDir: String(input.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1,
  };
  if (!['KAS_TUNAI', 'REKENING_BANK'].includes(filters.bentukSaldo)) filters.bentukSaldo = '';
  if (filters.dateFrom > filters.dateTo) [filters.dateFrom, filters.dateTo] = [filters.dateTo, filters.dateFrom];
  return filters;
}

function dateQuery(field, from, to) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } };
}

export function transactionMongoQuery(filters, { nagagoldOnly = false, mutationOnly = false } = {}) {
  const query = { ...dateQuery('transactionDate', filters.dateFrom, filters.dateTo) };
  if (nagagoldOnly) { query.sumber = { $in: ['NAGAGOLD', 'OPTIK'] }; }
  if (filters.kodeToko) query.kodeToko = filters.kodeToko;
  if (filters.sourceType) query.source_type = filters.sourceType === 'SYNC' ? { $in: SYNC_SOURCE_TYPES } : filters.sourceType;
  if (filters.jenisTransaksi) query.jenisTransaksi = filters.jenisTransaksi;
  if (filters.bentukTransaksi) query.bentukTransaksi = filters.bentukTransaksi;
  if (filters.approvalStatus) query.approval_status = filters.approvalStatus;
  if (filters.journalStatus) query.journal_status = filters.journalStatus;
  if (filters.syncStatus) query.sync_status = filters.syncStatus;
  if (filters.reconciliationStatus) query.reconciliation_status = filters.reconciliationStatus;
  if (filters.mappingStatus) query.mappingStatus = filters.mappingStatus;
  if (filters.classificationStatus) query.classification_status = filters.classificationStatus;
  if (filters.kategoriSumber) query.kategoriSumber = filters.kategoriSumber;
  if (filters.metodePembayaran) query.source_payment_method = filters.metodePembayaran;
  if (filters.statusSumber) query.statusSumber = filters.statusSumber;
  if (filters.sourceFinalityStatus) query.sourceFinalityStatus = filters.sourceFinalityStatus;
  if (filters.status) query.status = filters.status;
  const clauses = [];
  if (mutationOnly) {
    // `tt_mutasi` is already the dedicated Finance collection for money
    // movements. Older records created from a request can still carry
    // `kategori_sistem: TRANSAKSI`, so filtering that field here makes valid
    // mutations disappear from the mutation report. The model selection in
    // transactionDocuments/transactionCount keeps this query scoped to
    // FinanceMutation and excludes tt_sinkronisasi.
    query.isImported = { $ne: true };
  }
  if (filters.accountId) clauses.push({ $or: [{ sourceAccountId: filters.accountId }, { destinationAccountId: filters.accountId }, { rekeningId: filters.accountId }] });
  if (filters.search) clauses.push({ $or: [{ transactionNumber: { $regex: filters.search, $options: 'i' } }, { requestId: { $regex: filters.search, $options: 'i' } }, { source_transaction_id: { $regex: filters.search, $options: 'i' } }, { sourceNoReff: { $regex: filters.search, $options: 'i' } }, { sourceNoRekening: { $regex: filters.search, $options: 'i' } }, { sourceKodeBank: { $regex: filters.search, $options: 'i' } }, { sourceNamaBank: { $regex: filters.search, $options: 'i' } }, { kodeToko: { $regex: filters.search, $options: 'i' } }] });
  if (clauses.length) query.$and = [...(query.$and || []), ...clauses];
  return query;
}

async function transactionDocuments(query, options = {}) {
  const models = options.nagagoldOnly ? [SyncTransaction] : options.mutationOnly ? [FinanceMutation] : [FinanceMutation, SyncTransaction];
  // Jangan memakai lean() di sini. FinanceMutation dan SyncTransaction
  // menyediakan alias/virtual untuk menyamakan bentuk data laporan, misalnya
  // transactionDate, amount, rekeningId, dan sourceInvoiceNumbers.
  const rows = await Promise.all(models.map((model) => model.find(query)));
  return rows.flat();
}

async function transactionCount(query, options = {}) {
  const models = options.nagagoldOnly ? [SyncTransaction] : options.mutationOnly ? [FinanceMutation] : [FinanceMutation, SyncTransaction];
  const counts = await Promise.all(models.map((model) => model.countDocuments(query)));
  return counts.reduce((sum, count) => sum + count, 0);
}

function sortTransactionRows(rows, filters) {
  const direction = filters.sortDir;
  return [...rows].sort((left, right) => {
    const leftValue = left[filters.sortBy] || '';
    const rightValue = right[filters.sortBy] || '';
    if (leftValue < rightValue) return -1 * direction;
    if (leftValue > rightValue) return 1 * direction;
    return String(left._id).localeCompare(String(right._id)) * direction;
  });
}

function accountNameMap(accounts) {
  return new Map(accounts.map((account) => [String(account._id), account.nama_rekening]));
}

function accountDetailsMap(accounts) {
  return new Map(accounts.map((account) => [String(account._id), {
    name: account.nama_rekening || '',
    accountNumber: account.nomor_rekening || '',
    accountCode: account.kode_akun || '',
    accountLabel: `${account.nomor_rekening || account.kode_akun || 'Tanpa nomor rekening'} - ${account.nama_rekening || '-'}`,
    jenisKas: account.kelompok_rekening || account.jenis_akun || '',
    cashGroupId: String(account.pos_kas_id || ''),
    bentukSaldo: account.bentuk_saldo || '',
    unit: account.unit || '',
    kodeToko: account.kode_toko || '',
    cabangId: String(account.cabang_id || ''),
  }]));
}

function accountCode(account) {
  return account.kode_akun || account.nomor_rekening || String(account._id);
}

function isConfirmed(transaction) {
  return transaction.status === 'APPROVED' && transaction.journal_status === 'POSTED';
}

function serializeReportTransaction(transaction, accountsById, journalsByTransaction, accountDetailsById = new Map()) {
  const sourceId = String(transaction.sourceAccountId || '');
  const destinationId = String(transaction.destinationAccountId || '');
  const rekeningId = String(transaction.rekeningId || '');
  const sourceAccount = accountDetailsById.get(sourceId) || {};
  const destinationAccount = accountDetailsById.get(destinationId) || {};
  const journals = journalsByTransaction.get(String(transaction.transactionNumber || '')) || [];
  const postedJournals = journals.filter((journal) => journal.status === 'POSTED').sort((left, right) => String(right.tanggal).localeCompare(String(left.tanggal)));
  const confirmed = isConfirmed(transaction);
  return {
    id: String(transaction._id),
    transactionNumber: transaction.transactionNumber,
    sourceType: transaction.source_type || (transaction.isImported ? 'SYNC' : transaction.requestId ? 'BRANCH_REQUEST' : 'MANUAL_ADMIN'),
    jenisBisnis: String(transaction.jenis_bisnis || transaction.jenisBisnis || (transaction.isImported ? transaction.sourceSystem : '') || '').trim().toUpperCase(),
    sourceSystem: transaction.sourceSystem || '',
    sourceTransactionId: transaction.source_transaction_id || transaction.sourceId || '',
    requestId: transaction.requestId || '',
    transactionDate: transaction.transactionDate,
    postedDate: postedJournals[0]?.tanggal || '',
    kodeToko: transaction.kodeToko || '',
    namaToko: transaction.namaTokoSnapshot || '',
    jenisTransaksi: transaction.jenisTransaksi || '',
    jenisRequest: transaction.jenisRequest || '',
    arahDana: transaction.arahDana || '',
    amount: Number(transaction.amount || 0),
    confirmedAmount: confirmed ? Number(transaction.amount || 0) : 0,
    confirmed,
    status: transaction.status || '',
    approvalStatus: transaction.approval_status || '',
    journalStatus: transaction.journal_status || '',
    syncStatus: transaction.sync_status || '',
    reconciliationStatus: displayReconciliationStatus(transaction),
    sourcePaymentMethod: transaction.source_payment_method || '',
    kategoriSumber: transaction.kategoriSumber || '',
    statusSumber: transaction.statusSumber || '',
    mappingStatus: transaction.mappingStatus || '',
    classificationStatus: transaction.classification_status || '',
    classificationReason: transaction.classification_reason || '',
    sourceNoReff: transaction.sourceNoReff || '',
    sourceInvoiceNumbers: transaction.sourceInvoiceNumbers || [],
    sourceNoRekening: transaction.sourceNoRekening || '',
    sourceKodeBank: transaction.sourceKodeBank || '',
    sourceAccountId: sourceId,
    sourceAccountName: accountsById.get(sourceId) || sourceId,
    destinationAccountId: destinationId,
    destinationAccountName: accountsById.get(destinationId) || destinationId,
    jenisKasAsal: sourceAccount.jenisKas || '',
    jenisKasTujuan: destinationAccount.jenisKas || '',
    rekeningAsal: sourceAccount.accountLabel || sourceAccount.name || accountsById.get(sourceId) || sourceId,
    rekeningTujuan: destinationAccount.accountLabel || destinationAccount.name || accountsById.get(destinationId) || destinationId,
    jumlahMutasi: Number(transaction.amount || 0),
    rekeningId,
    rekeningName: accountsById.get(rekeningId) || rekeningId,
    journalNumbers: postedJournals.map((journal) => journal.no_keuangan),
    isMonitoring: !confirmed,
  };
}

async function postingTransactionIds(filters) {
  if (!filters.postingDateFrom && !filters.postingDateTo) return null;
  const journals = await JournalEntry.find({ ...dateQuery('tanggal', filters.postingDateFrom, filters.postingDateTo) }).select('no_transaksi').lean();
  const transactionNumbers = [...new Set(journals.map((journal) => String(journal.no_transaksi || '').trim()).filter(Boolean))];
  if (!transactionNumbers.length) return [];
  const transactions = await transactionDocuments({ transactionNumber: { $in: transactionNumbers } });
  return transactions.map((transaction) => String(transaction._id));
}

export async function reportTransactions(input = {}, options = {}) {
  const filters = normalizeReportFilters(input);
  const query = transactionMongoQuery(filters, options);
  const postingIds = await postingTransactionIds(filters);
  if (postingIds) query._id = { $in: postingIds };
  const allTransactions = sortTransactionRows(await transactionDocuments(query, options), filters);
  const total = allTransactions.length;
  const transactions = allTransactions.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
  const accountIds = [...new Set(transactions
    .flatMap((item) => [item.sourceAccountId, item.destinationAccountId, item.rekeningId])
    .map((value) => String(value || ''))
    .filter((value) => mongoose.isValidObjectId(value)))];
  const [accounts, journals] = await Promise.all([
    Account.find({ _id: { $in: accountIds } }).lean(),
    JournalEntry.find({ no_transaksi: { $in: transactions.map((item) => String(item.transactionNumber || '')) } }).sort({ tanggal: -1 }).lean(),
  ]);
  const journalsByTransaction = new Map();
  for (const journal of journals) { const key = String(journal.no_transaksi); journalsByTransaction.set(key, [...(journalsByTransaction.get(key) || []), journal]); }
  const accountsById = accountNameMap(accounts);
  const accountDetailsById = accountDetailsMap(accounts);
  const rows = transactions.map((transaction) => serializeReportTransaction(transaction, accountsById, journalsByTransaction, accountDetailsById));
  return { filters, page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize), rows };
}

function periodExpression(filters) {
  const start = filters.dateFrom;
  const end = filters.dateTo;
  return { $and: [{ $gte: ['$tanggal', start] }, { $lte: ['$tanggal', end] }] };
}

function openingExpression(filters) {
  return { $or: [
    { $and: [{ $eq: ['$tipe', 'SALDO_AWAL'] }, { $lte: ['$tanggal', filters.dateFrom] }] },
    { $and: [{ $ne: ['$tipe', 'SALDO_AWAL'] }, { $lt: ['$tanggal', filters.dateFrom] }] },
  ] };
}

export async function reportBalances(input = {}) {
  const filters = normalizeReportFilters(input);
  // Ringkasan saldo harus mencakup seluruh rekening yang terdaftar. Unit bisnis
  // adalah data master yang dapat bertambah, jadi jangan membatasi laporan pada
  // daftar unit yang di-hardcode.
  const accountQuery = {};
  if (filters.kodeToko) accountQuery.kode_toko = filters.kodeToko;
  if (filters.accountId) accountQuery._id = filters.accountId;
  if (filters.bentukSaldo === 'KAS_TUNAI') {
    accountQuery.$or = [
      { bentuk_saldo: 'KAS_TUNAI' },
      { jenis_akun: { $in: [ACCOUNT_KINDS.STORE_CASH, ACCOUNT_KINDS.CASH_ACCOUNT, ACCOUNT_KINDS.OPERATING_CASH] } },
    ];
  }
  if (filters.bentukSaldo === 'REKENING_BANK') {
    accountQuery.$or = [
      { bentuk_saldo: 'REKENING_BANK' },
      { jenis_akun: ACCOUNT_KINDS.BANK_ACCOUNT },
    ];
  }
  const accounts = await Account.find(accountQuery).sort({ jenis_akun: 1, kode_toko: 1, nama_rekening: 1 }).lean();
  const aggregates = await JournalEntry.aggregate([
    // PROVISIONAL tetap dihitung sebagai uang tercatat. Approval hanya
    // menentukan status proses; jika ditolak, record asli menjadi REVERSED
    // dan record pembaliknya yang menjaga saldo kembali netral.
    { $match: { status: { $in: ['PROVISIONAL', 'POSTED'] }, tanggal: { $lte: filters.dateTo } } },
    { $group: {
      _id: '$rekening_id',
      saldoAwal: { $sum: { $cond: [openingExpression(filters), { $subtract: ['$debet', '$kredit'] }, 0] } },
      debit: { $sum: { $cond: [{ $and: [periodExpression(filters), { $ne: ['$tipe', 'SALDO_AWAL'] }] }, '$debet', 0] } },
      kredit: { $sum: { $cond: [{ $and: [periodExpression(filters), { $ne: ['$tipe', 'SALDO_AWAL'] }] }, '$kredit', 0] } },
      terhitungSampaiAkhir: { $sum: { $subtract: ['$debet', '$kredit'] } },
    } },
  ]);
  const aggregateByAccount = new Map(aggregates.map((item) => [String(item._id), item]));
  const rows = accounts.map((account) => {
    const item = aggregateByAccount.get(String(account._id)) || { saldoAwal: 0, debit: 0, kredit: 0, terhitungSampaiAkhir: 0 };
    const saldoAkhir = Number(item.saldoAwal || 0) + Number(item.debit || 0) - Number(item.kredit || 0);
    const storedSaldo = Number(account.saldo_akhir || 0);
    const calculatedCurrent = Number(item.terhitungSampaiAkhir || 0);
    return {
      unit: account.unit,
      kodeToko: account.kode_toko || '',
      kodeAkun: accountCode(account),
      rekeningId: String(account._id),
      namaRekening: account.nama_rekening,
      jenisAkun: account.jenis_akun || account.kelompok_rekening,
      kelompokRekening: account.kelompok_rekening,
      jenisKas: account.kelompok_rekening,
      jenisBisnisId: String(account.jenis_bisnis_id || ''),
      jenisBisnisCode: account.unit || '',
      saldoAwal: Number(item.saldoAwal || 0),
      totalDebit: Number(item.debit || 0),
      totalKredit: Number(item.kredit || 0),
      saldoAkhir,
      saldoTersimpan: storedSaldo,
      saldoTerhitungSampaiAkhir: calculatedCurrent,
      selisihSaldoTersimpan: storedSaldo - calculatedCurrent,
      rekonsiliasiSaldo: Math.abs(storedSaldo - calculatedCurrent) < 0.005 ? 'SESUAI' : 'SELISIH',
      saldoTersedia: true,
      posKasId: String(account.pos_kas_id || ''),
      kodeKelompokKas: account.kelompok_rekening || '',
      bentukSaldo: account.bentuk_saldo || '',
    };
  });
  const groups = await CashType.find({}).sort({ urutan: 1, kode_jenis: 1 }).lean();
  const groupById = new Map(groups.map((group) => [String(group._id), group]));
  const directRows = new Map();
  for (const row of rows) directRows.set(row.posKasId, [...(directRows.get(row.posKasId) || []), row]);
  const childrenByParent = new Map();
  for (const group of groups) childrenByParent.set(String(group.parent_id || ''), [...(childrenByParent.get(String(group.parent_id || '')) || []), group]);
  const collectGroupIds = (groupId, visited = new Set()) => {
    if (visited.has(groupId)) return [];
    visited.add(groupId);
    const result = [groupId];
    for (const child of childrenByParent.get(groupId) || []) result.push(...collectGroupIds(String(child._id), visited));
    return result;
  };
  const groupRows = groups.map((group) => {
    const groupId = String(group._id);
    const direct = directRows.get(groupId) || [];
    const descendants = collectGroupIds(groupId).flatMap((idValue) => directRows.get(idValue) || []);
    return {
      id: groupId,
      kodeKelompokKas: group.kode_jenis,
      namaKelompokKas: group.nama_jenis,
      tipeKas: group.tipe_kas,
      unit: group.unit,
      parentId: String(group.parent_id || ''),
      parentName: groupById.get(String(group.parent_id || ''))?.nama_jenis || '',
      jumlahAkun: direct.length,
      saldoLangsung: direct.reduce((sum, row) => sum + Number(row.saldoAkhir || 0), 0),
      saldoKonsolidasi: descendants.reduce((sum, row) => sum + Number(row.saldoAkhir || 0), 0),
      saldoTersimpanLangsung: direct.reduce((sum, row) => sum + Number(row.saldoTersimpan || 0), 0),
      aktif: group.aktif !== false,
    };
  });
  const virtualGroups = new Map();
  for (const row of rows) {
    if (row.posKasId && groupById.has(row.posKasId)) continue;
    const key = `${row.kelompokRekening || 'KAS_LAINNYA'}:${row.unit || 'PUSAT'}`;
    const current = virtualGroups.get(key) || { id: `virtual-${key}`, kodeKelompokKas: key, namaKelompokKas: `${String(row.kelompokRekening || 'KAS LAINNYA').replace('KAS_', 'KAS ')}${['PUSAT', 'BERSAMA'].includes(row.unit) ? '' : ` ${row.unit}`}`, tipeKas: row.kelompokRekening || 'KAS_LAINNYA', unit: row.unit || 'PUSAT', parentId: '', parentName: '', jumlahAkun: 0, saldoLangsung: 0, saldoKonsolidasi: 0, saldoTersimpanLangsung: 0, aktif: true };
    current.jumlahAkun += 1;
    current.saldoLangsung += Number(row.saldoAkhir || 0);
    current.saldoKonsolidasi += Number(row.saldoAkhir || 0);
    current.saldoTersimpanLangsung += Number(row.saldoTersimpan || 0);
    virtualGroups.set(key, current);
  }
  return { filters, rows, groupRows: [...groupRows, ...virtualGroups.values()], summary: { totalAccounts: rows.length, saldoAkhir: rows.reduce((sum, row) => sum + row.saldoAkhir, 0), selisih: rows.filter((row) => row.rekonsiliasiSaldo === 'SELISIH').length } };
}

function confirmedQuery(filters) {
  return { ...transactionMongoQuery(filters), status: 'APPROVED', journal_status: 'POSTED' };
}

function dashboardCategoryLabel(transaction) {
  const raw = String(transaction.kategoriSumber || transaction.jenisRequest || transaction.jenisTransaksi || 'LAINNYA').toUpperCase();
  if (raw.includes('PENJUAL') || raw.includes('PENDAPATAN')) return 'Penjualan';
  if (raw.includes('PEMBELI') || raw.includes('BUYBACK')) return 'Pembelian / Buyback';
  if (raw.includes('SERVICE') || raw.includes('SERVIS')) return 'Service';
  if (raw.includes('OPERASIONAL')) return 'Operasional';
  return raw.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Lainnya';
}

function dashboardPeriodRows(filters, transactions) {
  const start = new Date(`${filters.dateFrom}T00:00:00Z`);
  const end = new Date(`${filters.dateTo}T00:00:00Z`);
  // Dashboard Finance menggunakan tren bulanan agar perubahan saldo lebih
  // mudah dibaca dan tidak penuh oleh titik harian.
  const monthly = true;
  const keyFor = (value) => monthly ? String(value || '').slice(0, 7) : String(value || '').slice(0, 10);
  const labels = [];
  if (monthly) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= last) { labels.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  } else {
    for (let offset = 0; offset < dayCount; offset += 1) { const cursor = new Date(start); cursor.setUTCDate(cursor.getUTCDate() + offset); labels.push(cursor.toISOString().slice(0, 10)); }
  }
  const grouped = new Map(labels.map((label) => [label, { date: label, masuk: 0, keluar: 0 }]));
  const categories = new Map();
  for (const transaction of transactions) {
    const key = keyFor(transaction.transactionDate);
    if (!grouped.has(key)) continue;
    const amount = Number(transaction.amount || 0);
    const isInternal = transaction.bentukTransaksi === 'TRANSFER_INTERNAL';
    if (!isInternal) {
      const row = grouped.get(key);
      if (transaction.arahDana === 'MASUK') row.masuk += amount;
      if (transaction.arahDana === 'KELUAR') row.keluar += amount;
      const category = dashboardCategoryLabel(transaction);
      categories.set(category, (categories.get(category) || 0) + amount);
    }
  }
  const colors = ['#087c75', '#d4932f', '#2f7fb8', '#8a6bbd', '#d46a5c'];
  return { rows: [...grouped.values()], granularity: monthly ? 'BULANAN' : 'HARIAN', categories: [...categories.entries()].sort(([, left], [, right]) => right - left).map(([label, value], index) => ({ label, value, color: colors[index % colors.length] })) };
}

export async function reportDashboard(input = {}) {
  const filters = normalizeReportFilters(input);
  const [balances, confirmedTransactions, pendingRequests, approvedRequests, pendingManual, needsReview, mappingFailed, conflicts, sync] = await Promise.all([
    reportBalances(filters),
    transactionDocuments(confirmedQuery(filters)),
    TransferRequest.countDocuments({ status: 'PENDING_APPROVAL', ...dateQuery('requestedAt', `${filters.dateFrom}T00:00:00.000+07:00`, `${filters.dateTo}T23:59:59.999+07:00`), ...(filters.kodeToko ? { kodeToko: filters.kodeToko } : {}) }),
    TransferRequest.countDocuments({ approval_status: 'APPROVED', payment_status: { $ne: 'SUDAH_DIBAYAR' }, ...(filters.kodeToko ? { kodeToko: filters.kodeToko } : {}) }),
    transactionCount({ ...transactionMongoQuery(filters), source_type: 'MANUAL_ADMIN', approval_status: 'PENDING' }, { mutationOnly: true }),
    // Transaksi yang sudah tercatat/terhubung tidak lagi menjadi pekerjaan
    // review, meskipun metadata klasifikasi lama masih menyimpan
    // REVIEW_REQUIRED atau BLOCKED.
    transactionCount({ ...transactionMongoQuery(filters), isImported: true, classification_status: { $in: ['REVIEW_REQUIRED', 'BLOCKED'] }, status: { $nin: ['TERCATAT', 'TERHUBUNG', 'GAGAL'] } }, { nagagoldOnly: true }),
    transactionCount({ ...transactionMongoQuery(filters), isImported: true, mappingStatus: { $in: ['PERLU_PEMETAAN', 'PEMETAAN_AMBIGU', 'GAGAL_MAPPING'] } }, { nagagoldOnly: true }),
    transactionCount({ ...transactionMongoQuery(filters), reconciliation_status: 'CONFLICT' }),
    SyncState.find({ sourceSystem: { $in: ['nagagold', 'optik'] }, ...(filters.kodeToko ? { kodeToko: filters.kodeToko } : {}) }).sort({ lastSuccessAt: -1 }).limit(20).lean(),
  ]);
  const accounts = balances.rows;
  const selectedAccountIds = new Set(accounts.map((row) => String(row.rekeningId || '')));
  const filteredConfirmedTransactions = filters.bentukSaldo
    ? confirmedTransactions.filter((transaction) => [transaction.sourceAccountId, transaction.destinationAccountId, transaction.rekeningId].some((accountId) => selectedAccountIds.has(String(accountId || ''))))
    : confirmedTransactions;
  // Dashboard menampilkan saldo terkini setiap rekening, sehingga agregasinya
  // harus memakai saldo yang tersimpan pada master rekening. Jurnal tetap
  // dipakai untuk laporan rekonstruksi dan pemeriksaan selisih.
  const currentBalance = (row) => Number(row.saldoTersimpan || 0);
  const totalByKind = (kinds) => accounts.filter((row) => kinds.includes(row.jenisAkun)).reduce((sum, row) => sum + currentBalance(row), 0);
  const totalByGroup = (groups, unit = '') => accounts.filter((row) => groups.includes(row.kelompokRekening) && (!unit || row.jenisBisnisCode === unit || row.unit === unit)).reduce((sum, row) => sum + currentBalance(row), 0);
  const dashboardRows = accounts.map((row) => ({ ...row, saldoDashboard: currentBalance(row) }));
  const periodReceipts = filteredConfirmedTransactions.filter((item) => item.bentukTransaksi === 'MUTASI_REKENING' && item.arahDana === 'MASUK').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const periodPayments = filteredConfirmedTransactions.filter((item) => item.bentukTransaksi === 'MUTASI_REKENING' && item.arahDana === 'KELUAR').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const internalMutations = filteredConfirmedTransactions.filter((item) => item.bentukTransaksi === 'TRANSFER_INTERNAL').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const dashboardFlow = dashboardPeriodRows(filters, filteredConfirmedTransactions);
  const businessTypes = await BusinessType.find({ aktif: true }).sort({ nama_bisnis: 1, kode_bisnis: 1 }).lean();
  const configuredBusinesses = businessTypes.map((item) => ({ code: String(item.kode_bisnis || '').toUpperCase(), name: item.nama_bisnis || item.kode_bisnis || '' }));
  const configuredCodes = new Set(configuredBusinesses.map((item) => item.code));
  const legacyBusinesses = [...new Set(accounts.map((row) => String(row.jenisBisnisCode || row.unit || '').trim().toUpperCase()).filter((code) => code && !['PUSAT', 'BERSAMA'].includes(code) && !configuredCodes.has(code)))]
    .map((code) => ({ code, name: code }));
  const businessGroups = [...configuredBusinesses, ...legacyBusinesses]
    .filter((business) => business.code && !['PUSAT', 'BERSAMA'].includes(business.code))
    .map((business) => ({
      code: business.code,
      name: business.name,
      kasBesar: totalByGroup(['KAS_BESAR'], business.code),
      kasKecil: totalByGroup(['KAS_KECIL'], business.code),
    }));
  return {
    generatedAt: new Date().toISOString(), timezone: REPORT_TIMEZONE, filters,
    balances: {
      total: accounts.reduce((sum, row) => sum + currentBalance(row), 0),
      kasUtama: totalByGroup(['KAS_UTAMA']),
      kasBesar: totalByGroup(['KAS_BESAR']),
      kasKecil: totalByGroup(['KAS_KECIL']),
      kasBesarNagagold: totalByGroup(['KAS_BESAR'], 'NAGAGOLD'),
      kasBesarOptik: totalByGroup(['KAS_BESAR'], 'OPTIK'),
      kasTunai: accounts.filter((row) => row.bentukSaldo === 'KAS_TUNAI' || [ACCOUNT_KINDS.STORE_CASH, ACCOUNT_KINDS.CASH_ACCOUNT, ACCOUNT_KINDS.OPERATING_CASH].includes(row.jenisAkun)).reduce((sum, row) => sum + currentBalance(row), 0),
      kasTunaiToko: totalByKind([ACCOUNT_KINDS.STORE_CASH]),
      kasKecilNagagold: totalByGroup(['KAS_KECIL'], 'NAGAGOLD'),
      kasKecilOptik: totalByGroup(['KAS_KECIL'], 'OPTIK'),
      kasKecilOperasional: accounts.filter((row) => row.kelompokRekening === 'KAS_KECIL' && row.jenisAkun !== ACCOUNT_KINDS.STORE_CASH).reduce((sum, row) => sum + currentBalance(row), 0),
      rekeningBank: totalByKind([ACCOUNT_KINDS.BANK_ACCOUNT]),
      discrepancyAccounts: accounts.filter((row) => row.rekonsiliasiSaldo === 'SELISIH').length,
    },
    businessGroups,
    balanceRows: dashboardRows,
    period: { totalPenerimaan: periodReceipts, totalPengeluaran: periodPayments, totalMutasiAntarKas: internalMutations, confirmedTransactions: filteredConfirmedTransactions.length },
    flow: dashboardFlow.rows,
    flowGranularity: dashboardFlow.granularity,
    categories: dashboardFlow.categories,
    operations: { pendingRequests, approvedUnpaidRequests: approvedRequests, pendingManual, needsReview, mappingFailed, reconciliationConflicts: conflicts, sync: sync.map((item) => ({ kodeToko: item.kodeToko, lastSuccessAt: item.lastSuccessAt || null, lastError: item.lastError || '', lastFetchedCount: item.lastFetchedCount || 0 })) },
  };
}

export async function reportRequests(input = {}) {
  const filters = normalizeReportFilters(input);
  const query = { ...dateQuery('requestedAt', `${filters.dateFrom}T00:00:00.000+07:00`, `${filters.dateTo}T23:59:59.999+07:00`), ...(filters.kodeToko ? { kodeToko: filters.kodeToko } : {}) };
  if (input.status) query.status = String(input.status).toUpperCase();
  if (input.paymentStatus) query.payment_status = String(input.paymentStatus).toUpperCase();
  if (input.approvalStatus) query.approval_status = String(input.approvalStatus).toUpperCase();
  if (filters.search) query.$or = [{ requestId: { $regex: filters.search, $options: 'i' } }, { kodeToko: { $regex: filters.search, $options: 'i' } }, { noRekening: { $regex: filters.search, $options: 'i' } }, { jenisRequest: { $regex: filters.search, $options: 'i' } }];
  const total = await TransferRequest.countDocuments(query);
  const rows = await TransferRequest.find(query).sort({ requestedAt: -1 }).skip((filters.page - 1) * filters.pageSize).limit(filters.pageSize).lean();
  return { filters, page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize), rows: rows.map((row) => ({ id: String(row._id), requestId: row.requestId, kodeToko: row.kodeToko, namaToko: row.namaTokoSnapshot || '', jenisRequest: row.jenisRequest, nilaiRp: Number(row.nilaiRp || 0), status: row.status, approvalStatus: row.approval_status, paymentStatus: row.payment_status, requestedAt: row.requestedAt, approvedAt: row.approved_at, transferDate: row.transfer_date, transferReference: row.transfer_reference, noRekening: row.noRekening, financeTransactionId: row.finance_transaction_id || '' })) };
}

export async function reportJournals(input = {}) {
  const filters = normalizeReportFilters(input);
  const query = { ...dateQuery('tanggal', filters.dateFrom, filters.dateTo) };
  if (filters.journalStatus) query.status = filters.journalStatus;
  if (input.journalType) query.tipe = String(input.journalType).toUpperCase();
  if (filters.accountId) query.rekening_id = filters.accountId;
  const total = await JournalEntry.countDocuments(query);
  const rows = await JournalEntry.find(query).sort({ tanggal: -1, dibuat_pada: -1 }).skip((filters.page - 1) * filters.pageSize).limit(filters.pageSize).lean();
  const transactionNumbers = [...new Set(rows.map((row) => String(row.no_transaksi || '').trim()).filter(Boolean))];
  const transactions = await transactionDocuments({ transactionNumber: { $in: transactionNumbers } });
  const transactionMap = new Map(transactions.map((row) => [String(row.transactionNumber), row]));
  return { filters, page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize), rows: rows.map((row) => ({ ...row, id: String(row._id), transaction: transactionMap.get(String(row.no_transaksi)) || null })) };
}

export async function reportReconciliation(input = {}) {
  const filters = normalizeReportFilters(input);
  const query = { ...transactionMongoQuery(filters, { nagagoldOnly: true }) };
  const rows = (await transactionDocuments(query, { nagagoldOnly: true })).sort((left, right) => String(right.transactionDate || '').localeCompare(String(left.transactionDate || ''))).slice(0, 1000);
  const summary = rows.reduce((result, row) => { const reconciliation = displayReconciliationStatus(row); const mapping = row.mappingStatus || 'PERLU_PEMETAAN'; result.byReconciliation[reconciliation] = (result.byReconciliation[reconciliation] || 0) + 1; result.byMapping[mapping] = (result.byMapping[mapping] || 0) + 1; if (row.classification_status === 'BLOCKED') result.blocked += 1; return result; }, { byReconciliation: {}, byMapping: {}, blocked: 0 });
  return { filters, total: rows.length, summary, rows: rows.map((row) => ({ id: String(row._id), transactionNumber: row.transactionNumber, kodeToko: row.kodeToko, sourceNoReff: row.sourceNoReff || '', amount: Number(row.amount || 0), sourceInvoiceNumbers: row.sourceInvoiceNumbers || [], mappingStatus: row.mappingStatus || '', mappingReason: row.mappingReason || '', reconciliationStatus: displayReconciliationStatus(row), matchedTransactionId: row.matched_transaction_id || '', classificationStatus: row.classification_status || '', classificationReason: row.classification_reason || '', journalStatus: row.journal_status || '' })) };
}

export async function reportIntegrated(input = {}) {
  const requestedSource = String(input.sourceType || input.source_type || '').trim().toUpperCase();
  const sourceType = ['SYNC_NAGAGOLD', 'SYNC_OPTIK'].includes(requestedSource) ? requestedSource : 'SYNC';
  return reportTransactions({ ...input, sourceType }, { nagagoldOnly: true });
}

export function sourceMovement(transaction) {
  const snapshotIn = Number(transaction.source_amount_in || 0);
  const snapshotOut = Number(transaction.source_amount_out || 0);
  if (snapshotIn > 0 || snapshotOut > 0) return { masuk: snapshotIn, keluar: snapshotOut };
  return transaction.arahDana === 'MASUK'
    ? { masuk: Number(transaction.amount || 0), keluar: 0 }
    : { masuk: 0, keluar: Number(transaction.amount || 0) };
}

export function reportSourceRow(transaction) {
  const movement = sourceMovement(transaction);
  const matched = displayReconciliationStatus(transaction) === 'MATCHED' || Boolean(String(transaction.matched_transaction_id || '').trim());
  const confirmed = transaction.status === 'APPROVED'
    && transaction.journal_status === 'POSTED'
    && !matched;
  return {
    id: String(transaction._id),
    sumber: String(transaction.sumber || transaction.jenis_bisnis || transaction.jenisBisnis || transaction.sourceSystem || 'NAGAGOLD').trim().toUpperCase(),
    transactionNumber: transaction.transactionNumber,
    sourceTransactionId: transaction.source_transaction_id || transaction.sourceId || '',
    sourceKey: transaction.sourceKey || '',
    sourceDatabaseName: transaction.source_database_name || transaction.sourceDatabase || '',
    kodeToko: transaction.kodeToko || '',
    transactionDate: transaction.transactionDate,
    sourceDate: transaction.sourceTanggal || transaction.transactionDate,
    noReff: transaction.sourceNoReff || '',
    noRekening: transaction.sourceNoRekening || '',
    kodeBank: transaction.sourceKodeBank || '',
    namaBank: transaction.sourceNamaBank || '',
    jenis: transaction.jenisSumber || '',
    kategori: transaction.kategoriSumber || '',
    metodePembayaran: transaction.source_payment_method || '',
    deskripsi: transaction.sourceDeskripsi || '',
    keterangan: transaction.sourceKeterangan || transaction.note || '',
    jumlahIn: movement.masuk,
    jumlahOut: movement.keluar,
    amount: Number(transaction.amount || 0),
    statusSumber: transaction.statusSumber || '',
    finalitas: transaction.sourceFinalityStatus || 'UNVERIFIED',
    mappingStatus: transaction.mappingStatus || 'PERLU_PEMETAAN',
    rekonsiliasiStatus: displayReconciliationStatus(transaction),
    approvalStatus: transaction.approval_status || '',
    journalStatus: transaction.journal_status || '',
    classificationStatus: transaction.classification_status || '',
    classificationReason: transaction.classification_reason || '',
    sourceInvoiceNumbers: transaction.sourceInvoiceNumbers || [],
    matchedTransactionId: transaction.matched_transaction_id || '',
    monitoring: true,
    confirmed,
    confirmedIn: confirmed ? movement.masuk : 0,
    confirmedOut: confirmed ? movement.keluar : 0,
    excludedFromConfirmed: matched,
  };
}

function appendSourceKindFilter(query, kind) {
  if (!kind) return query;
  const cashQuery = { $or: [{ source_payment_method: 'CASH' }, { sourceNoRekening: '-' }] };
  const clauses = query.$and || [];
  if (kind === 'CASH') clauses.push(cashQuery);
  if (kind === 'BANK') clauses.push({ $nor: cashQuery.$or });
  query.$and = clauses;
  return query;
}

function sourceReportSummary(transactions) {
  const summary = {
    totalEvents: transactions.length,
    totalMonitoringIn: 0,
    totalMonitoringOut: 0,
    totalConfirmedIn: 0,
    totalConfirmedOut: 0,
    matchedExcluded: 0,
    byCategory: {},
    byMethod: {},
    byBranch: {},
    byAccount: {},
  };
  for (const transaction of transactions) {
    const movement = sourceMovement(transaction);
    const matched = displayReconciliationStatus(transaction) === 'MATCHED' || Boolean(String(transaction.matched_transaction_id || '').trim());
    const confirmed = transaction.status === 'APPROVED' && transaction.journal_status === 'POSTED' && !matched;
    summary.totalMonitoringIn += movement.masuk;
    summary.totalMonitoringOut += movement.keluar;
    if (confirmed) {
      summary.totalConfirmedIn += movement.masuk;
      summary.totalConfirmedOut += movement.keluar;
    }
    if (matched) summary.matchedExcluded += 1;
    const category = String(transaction.kategoriSumber || 'LAINNYA').toUpperCase();
    const method = String(transaction.source_payment_method || (isCashPayment(transaction) ? 'CASH' : 'BANK')).toUpperCase();
    const branch = String(transaction.kodeToko || '-').toUpperCase();
    const account = String(transaction.sourceNoRekening || 'KAS TUNAI').trim() || 'KAS TUNAI';
    for (const [bucket, key] of [['byCategory', category], ['byMethod', method], ['byBranch', branch], ['byAccount', account]]) {
      const current = summary[bucket][key] || { key, count: 0, masuk: 0, keluar: 0, confirmedIn: 0, confirmedOut: 0 };
      current.count += 1;
      current.masuk += movement.masuk;
      current.keluar += movement.keluar;
      if (confirmed) { current.confirmedIn += movement.masuk; current.confirmedOut += movement.keluar; }
      summary[bucket][key] = current;
    }
  }
  summary.netMonitoring = summary.totalMonitoringIn - summary.totalMonitoringOut;
  summary.netConfirmed = summary.totalConfirmedIn - summary.totalConfirmedOut;
  for (const bucket of ['byCategory', 'byMethod', 'byBranch', 'byAccount']) {
    summary[bucket] = Object.values(summary[bucket]).sort((left, right) => (right.masuk + right.keluar) - (left.masuk + left.keluar));
  }
  return summary;
}

/**
 * Laporan pergerakan sumber Nagagold.
 *
 * `tt_sinkronisasi` menjadi cache Finance untuk satu dokumen
 * `tt_cash_daily`. Laporan ini tidak membaca payment array dari koleksi
 * penjualan/pembelian, sehingga satu pembayaran tidak dihitung dua kali.
 * Nilai monitoring dan confirmed sengaja dipisahkan.
 */
async function reportNagagoldLedger(input = {}, kind = '') {
  const filters = normalizeReportFilters(input);
  const query = appendSourceKindFilter(transactionMongoQuery(filters, { nagagoldOnly: true }), kind);
  const allTransactions = (await transactionDocuments(query, { nagagoldOnly: true }))
    .sort((left, right) => `${right.transactionDate || ''}${right.createdAt || ''}`.localeCompare(`${left.transactionDate || ''}${left.createdAt || ''}`));
  const total = allTransactions.length;
  const transactions = allTransactions.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
  const rows = transactions.map(reportSourceRow);

  const summaryTransactions = await transactionDocuments(query, { nagagoldOnly: true });
  const summary = sourceReportSummary(summaryTransactions);
  return { filters, page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize), kind, summary, rows };
}

export async function reportNagagoldSource(input = {}) { return reportNagagoldLedger(input); }

export async function reportNagagoldCash(input = {}) { return reportNagagoldLedger(input, 'CASH'); }

export async function reportNagagoldAccounts(input = {}) { return reportNagagoldLedger(input, 'BANK'); }

export async function reportMutations(input = {}) { return reportTransactions(input, { mutationOnly: true }); }

function journalDate(journal = {}) {
  return String(journal.tanggal || journal.tgl_jurnal || '').slice(0, 10);
}

function journalType(journal = {}) {
  return String(journal.tipe || journal.tipe_jurnal || journal.jenis_jurnal || '').trim().toUpperCase();
}

export function classifyFinancialEntry(journal = {}, transaction = {}) {
  const type = journalType(journal);
  const selectedTransactionType = String(journal.jenis_transaksi || journal.jenisTransaksi || transaction.jenisTransaksi || transaction.jenisRequest || '').trim().toUpperCase();
  const raw = String(transaction.kategoriSumber || transaction.kategori_sistem || selectedTransactionType || journal.kategori || journal.kategori_sistem || '').trim().toUpperCase();
  const debit = Number(journal.debet || 0);
  const credit = Number(journal.kredit || 0);
  const internal = type === 'MUTASI'
    || transaction.bentukTransaksi === 'TRANSFER_INTERNAL'
    || transaction.bentukTransaksi === 'MUTASI_REKENING'
    || ['TRANSFER_INTERNAL', 'MUTASI', 'MUTASI_REKENING'].includes(String(transaction.jenisTransaksi || '').toUpperCase())
    || raw.includes('MUTASI');

  if (type === 'SALDO_AWAL' || raw.includes('SALDO_AWAL') || raw === 'SALDO AWAL') return { code: 'SALDO_AWAL', label: 'SALDO AWAL' };
  if (type === 'PENYESUAIAN_SALDO' && selectedTransactionType) {
    if (selectedTransactionType.includes('PENJUAL') || selectedTransactionType.includes('PENDAPATAN') || selectedTransactionType.includes('PENERIMAAN')) return { code: 'PENERIMAAN', label: 'PENERIMAAN' };
    if (selectedTransactionType.includes('PEMBELI') || selectedTransactionType.includes('PEMBAYARAN') || selectedTransactionType.includes('OPERASIONAL') || selectedTransactionType.includes('PENGELUARAN') || selectedTransactionType.includes('SERVICE') || selectedTransactionType.includes('SERVIS')) return { code: 'PENGELUARAN', label: 'PENGELUARAN' };
    return { code: selectedTransactionType, label: selectedTransactionType.replaceAll('_', ' ') };
  }
  if (type === 'PENYESUAIAN_SALDO') return { code: 'PENYESUAIAN_SALDO', label: 'PENYESUAIAN SALDO' };
  if (type === 'PEMBALIKAN' || raw.includes('PEMBALIKAN') || raw.includes('REVERSAL')) return { code: 'KOREKSI', label: 'KOREKSI' };
  if (internal) return debit > 0 ? { code: 'MUTASI_MASUK', label: 'MUTASI MASUK' } : { code: 'MUTASI_KELUAR', label: 'MUTASI KELUAR' };

  const incoming = type.includes('PENJUAL') || type.includes('PENDAPATAN') || type.includes('PENERIMAAN') || raw.includes('PENJUAL') || raw.includes('PENDAPATAN') || raw.includes('PENERIMAAN');
  const outgoing = type.includes('PEMBELI') || type.includes('PEMBAYARAN') || type.includes('OPERASIONAL') || type.includes('PENGELUARAN') || type.includes('SERVICE') || type.includes('SERVIS') || raw.includes('PEMBELI') || raw.includes('BUYBACK') || raw.includes('OPERASIONAL') || raw.includes('PENGELUARAN');
  if (incoming || outgoing || type === 'TRANSAKSI') return debit > 0 ? { code: 'PENERIMAAN', label: 'PENERIMAAN' } : { code: 'PENGELUARAN', label: 'PENGELUARAN' };
  return { code: 'LAINNYA', label: 'LAINNYA / BELUM TERKLASIFIKASI' };
}

function financialCategory(journal, transaction = {}) {
  return classifyFinancialEntry(journal, transaction).label;
}

function financialSearchText(row) {
  return [row.source, row.transactionNumber, row.journalNumber, row.accountNumber, row.accountName, row.category, row.reference, row.description, row.kodeToko, row.namaToko].filter(Boolean).join(' ').toLowerCase();
}

export function financialSource(transaction = {}) {
  const sourceType = String(transaction.source_type || transaction.sourceType || '').trim().toUpperCase();
  const business = String(transaction.sumber || transaction.jenis_bisnis || transaction.jenisBisnis || transaction.sourceSystem || '').trim().toUpperCase();
  if (sourceType === 'SYNC_OPTIK' || business === 'OPTIK' || String(transaction.sourceSystem || '').trim().toLowerCase() === 'optik') return 'OPTIK';
  if (sourceType === 'SYNC_NAGAGOLD' || business === 'NAGAGOLD' || transaction.isImported) return 'NAGAGOLD';
  return 'FINANCE';
}

function financialRowFromEntry(journal, transaction, opening, account) {
  const accountDetails = account || {};
  const type = journalType(journal);
  const classification = classifyFinancialEntry(journal, transaction || {});
  const isOpening = classification.code === 'SALDO_AWAL';
  const accountId = String(journal.rekening_id || '');
  const transactionNumber = transaction?.transactionNumber || journal.no_transaksi || (isOpening ? 'SALDO AWAL' : '-');
  const reference = transaction?.sourceNoReff || transaction?.requestId || (isOpening ? opening?.keterangan : '') || journal.no_keuangan || '-';
  const description = journal.keterangan || transaction?.note || opening?.keterangan || '-';
  const accountNumber = accountDetails.accountNumber || accountDetails.nomor_rekening || accountDetails.accountCode || accountDetails.kode_akun || journal.no_rekening || '-';
  const accountName = accountDetails.name || accountDetails.nama_rekening || journal.nama_rekening || '-';
  const debit = Number(journal.debet || 0);
  const credit = Number(journal.kredit || 0);
  return {
    id: String(journal._id),
    transactionId: transaction?._id ? String(transaction._id) : '',
    openingBalanceId: opening?._id ? String(opening._id) : '',
    isOpeningBalance: isOpening,
    journalNumber: journal.no_keuangan || journal.no_jurnal || '-',
    journalType: type,
    journalStatus: journal.status || '',
    date: journalDate(journal),
    transactionNumber,
    transactionType: journal.jenis_transaksi || transaction?.jenisTransaksi || type,
    eventNumber: transaction?.transactionNumber || journal.no_transaksi || journal.no_keuangan || journal.no_jurnal,
    category: classification.label,
    categoryCode: classification.code,
    accountId,
    accountNumber,
    accountName,
    accountLabel: `${accountNumber} - ${accountName}`,
    cashGroupId: accountDetails.cashGroupId || '',
    cashGroupName: accountDetails.cashGroupName || '',
    jenisKas: accountDetails.jenisKas || accountDetails.kelompok_rekening || accountDetails.jenis_akun || '-',
    unit: journal.jenis_bisnis || transaction?.jenisBisnis || transaction?.jenis_bisnis || accountDetails.unit || '',
    kodeToko: journal.kode_toko || transaction?.kodeToko || accountDetails.kodeToko || '',
    namaToko: journal.nama_toko || transaction?.namaTokoSnapshot || '',
    bankCode: accountDetails.bankCode || journal.kode_bank || '',
    reference,
    description,
    debit,
    credit,
    reportDebit: isOpening ? 0 : debit,
    reportCredit: isOpening ? 0 : credit,
    effect: debit - credit,
    direction: debit > 0 ? 'DEBET' : credit > 0 ? 'KREDIT' : '',
    createdBy: journal.created_by || '',
    approvedBy: journal.approved_by || '',
    createdAt: journal.dibuat_pada || journal.created_at || null,
    approvedAt: journal.approved_at || null,
    // Jurnal baru menyimpan sumber secara langsung. Fallback tetap dipakai
    // untuk dokumen lama agar laporan tidak kehilangan klasifikasi sebelum
    // data uji lama dibersihkan atau disinkronkan ulang.
    source: String(journal.sumber || financialSource(transaction || {})).trim().toUpperCase(),
  };
}

function emptyFinancialStats() {
  return { saldoAwal: 0, pembukaan: 0, penerimaan: 0, mutasiMasuk: 0, pengeluaran: 0, mutasiKeluar: 0, koreksi: 0, debet: 0, kredit: 0, totalDebit: 0, totalKredit: 0, saldoAkhir: 0, jumlahTransaksi: 0, unclassifiedCount: 0, _eventKeys: new Set() };
}

function addFinancialEntry(stats, row, { opening = false } = {}) {
  if (opening || row.categoryCode === 'SALDO_AWAL') {
    stats.saldoAwal += row.effect;
    if (!opening) stats.pembukaan += row.effect;
  }
  else {
    stats.debet += row.debit;
    stats.kredit += row.credit;
    stats.totalDebit += row.debit;
    stats.totalKredit += row.credit;
    if (row.categoryCode === 'PENERIMAAN') stats.penerimaan += row.debit;
    else if (row.categoryCode === 'MUTASI_MASUK') stats.mutasiMasuk += row.debit;
    else if (row.categoryCode === 'PENGELUARAN') stats.pengeluaran += row.credit;
    else if (row.categoryCode === 'MUTASI_KELUAR') stats.mutasiKeluar += row.credit;
    else {
      stats.koreksi += row.effect;
      if (row.categoryCode === 'LAINNYA') stats.unclassifiedCount += 1;
    }
    stats._eventKeys.add(String(row.eventNumber || row.journalNumber || row.id));
  }
  stats.saldoAkhir = stats.saldoAwal + stats.debet - stats.kredit;
}

function publicFinancialStats(stats) {
  return { ...stats, jumlahTransaksi: stats._eventKeys.size, _eventKeys: undefined };
}

function sumFinancialStats(rows) {
  const stats = emptyFinancialStats();
  for (const row of rows) {
    stats.saldoAwal += Number(row.saldoAwal || 0);
    stats.pembukaan += Number(row.pembukaan || 0);
    stats.penerimaan += Number(row.penerimaan || 0);
    stats.mutasiMasuk += Number(row.mutasiMasuk || 0);
    stats.pengeluaran += Number(row.pengeluaran || 0);
    stats.mutasiKeluar += Number(row.mutasiKeluar || 0);
    stats.koreksi += Number(row.koreksi || 0);
    stats.debet += Number(row.debet ?? row.totalDebit ?? 0);
    stats.kredit += Number(row.kredit ?? row.totalKredit ?? 0);
    stats.totalDebit += Number(row.totalDebit || 0);
    stats.totalKredit += Number(row.totalKredit || 0);
    stats.unclassifiedCount += Number(row.unclassifiedCount || 0);
    for (const key of row._eventKeys || []) stats._eventKeys.add(key);
  }
  stats.saldoAkhir = stats.saldoAwal + stats.debet - stats.kredit;
  return publicFinancialStats(stats);
}

function financialDetailMatches(row, filters) {
  if (filters.sourceType === 'FINANCE' && row.source !== 'FINANCE') return false;
  if (filters.sourceType === 'NAGAGOLD' && row.source !== 'NAGAGOLD') return false;
  if (filters.sourceType === 'OPTIK' && row.source !== 'OPTIK') return false;
  if (filters.kategoriKeuangan && row.categoryCode !== filters.kategoriKeuangan && row.category !== filters.kategoriKeuangan) return false;
  if (filters.jenisTransaksi && row.journalType !== filters.jenisTransaksi && String(row.transactionType || '').toUpperCase() !== filters.jenisTransaksi) return false;
  if (filters.nomorKeuangan && !String(row.journalNumber).toLowerCase().includes(filters.nomorKeuangan.toLowerCase())) return false;
  if (filters.nomorTransaksi && !String(row.transactionNumber).toLowerCase().includes(filters.nomorTransaksi.toLowerCase())) return false;
  if (filters.keterangan && !String(row.description).toLowerCase().includes(filters.keterangan.toLowerCase())) return false;
  if (filters.detailDirection && row.direction !== filters.detailDirection) return false;
  if (filters.search && !financialSearchText(row).includes(filters.search.toLowerCase())) return false;
  return true;
}

function financialGroupStats(row) {
  const stats = emptyFinancialStats();
  stats.saldoAwal = row.saldoAwal;
  stats.pembukaan = row.pembukaan;
  stats.penerimaan = row.penerimaan;
  stats.mutasiMasuk = row.mutasiMasuk;
  stats.pengeluaran = row.pengeluaran;
  stats.mutasiKeluar = row.mutasiKeluar;
  stats.koreksi = row.koreksi;
  stats.debet = Number(row.debet ?? row.totalDebit ?? 0);
  stats.kredit = Number(row.kredit ?? row.totalKredit ?? 0);
  stats.totalDebit = row.totalDebit;
  stats.totalKredit = row.totalKredit;
  stats.unclassifiedCount = row.unclassifiedCount;
  for (const key of row._eventKeys || []) stats._eventKeys.add(key);
  return stats;
}

function buildFinancialGroupTree(groups, accountRows, selectedGroupId = '', includeSubgroups = false) {
  const groupMap = new Map(groups.map((group) => [String(group._id), group]));
  const childrenByParent = new Map();
  for (const group of groups) {
    const parent = String(group.parent_id || '');
    childrenByParent.set(parent, [...(childrenByParent.get(parent) || []), group]);
  }
  const descendants = (groupId) => {
    const ids = [groupId];
    for (const child of childrenByParent.get(groupId) || []) ids.push(...descendants(String(child._id)));
    return ids;
  };
  const allowed = selectedGroupId ? new Set(includeSubgroups ? descendants(selectedGroupId) : [selectedGroupId]) : null;
  const accountsByGroup = new Map();
  for (const row of accountRows) accountsByGroup.set(row.cashGroupId, [...(accountsByGroup.get(row.cashGroupId) || []), row]);
  const makeAccount = (row, level) => ({ ...row, rowType: 'ACCOUNT', level });
  const makeGroup = (group, level) => {
    const groupId = String(group._id);
    if (allowed && !allowed.has(groupId)) return null;
    const childGroups = (childrenByParent.get(groupId) || []).map((child) => makeGroup(child, level + 1)).filter(Boolean);
    const directAccounts = (accountsByGroup.get(groupId) || []).map((row) => makeAccount(row, level + 1));
    // Rekap per kelompok hanya memakai rekening yang langsung berada pada
    // kelompok tersebut. Rekening anak ditampilkan pada baris kelompok anak;
    // memakai seluruh descendants di sini akan membuat mutasi anak ikut
    // terhitung lagi pada kelompok induk.
    const directRows = accountRows.filter((row) => row.cashGroupId === groupId);
    if (!directRows.length && !childGroups.length) return null;
    const stats = sumFinancialStats(directRows.map(financialGroupStats));
    return { ...stats, id: `group-${groupId}`, rowType: 'GROUP', groupId, parentId: String(group.parent_id || ''), code: group.kode_jenis || '', label: group.nama_jenis || group.kode_jenis || '-', level, children: childGroups, accounts: directAccounts };
  };
  const rootGroups = selectedGroupId
    ? groups.filter((group) => String(group._id) === String(selectedGroupId))
    : groups.filter((group) => !group.parent_id || !groupMap.has(String(group.parent_id)));
  const roots = rootGroups.map((group) => makeGroup(group, 0)).filter(Boolean);
  const ungrouped = accountRows.filter((row) => !row.cashGroupId || !groupMap.has(row.cashGroupId));
  if (ungrouped.length) roots.push({ ...sumFinancialStats(ungrouped.map(financialGroupStats)), id: 'group-ungrouped', rowType: 'GROUP', groupId: '', parentId: '', code: '', label: 'Tanpa kelompok kas', level: 0, children: [], accounts: ungrouped.map((row) => makeAccount(row, 1)) });
  return roots;
}

function flattenFinancialTree(nodes, result = []) {
  for (const node of nodes || []) {
    result.push(node);
    flattenFinancialTree(node.children, result);
    flattenFinancialTree(node.accounts, result);
  }
  return result;
}

// Data master lama menyimpan kelompok kas langsung pada rekening dan belum
// selalu mempunyai `pos_kas_id`. Bentuk ini tetap dibaca sebagai fallback
// kompatibilitas agar laporan tidak kehilangan rekening historis. Jika master
// kelompok kas sudah terhubung, relasi `pos_kas_id` tetap menjadi sumber utama.
function legacyCashGroupId(account = {}) {
  return `LEGACY:${String(account.kelompok_rekening || 'LAINNYA').trim().toUpperCase()}:${String(account.unit || 'PUSAT').trim().toUpperCase()}`;
}

function legacyCashGroups(accounts = []) {
  const keys = new Set(accounts.filter((account) => !account.pos_kas_id).map((account) => legacyCashGroupId(account)));
  const result = [];
  const ensure = (type, unit) => {
    const id = `LEGACY:${type}:${unit}`;
    if (!keys.has(id) && !result.some((item) => String(item._id) === id)) return;
    if (result.some((item) => String(item._id) === id)) return;
    const parentId = type === 'KAS_UTAMA' ? null : type === 'KAS_BESAR' ? (keys.has(`LEGACY:KAS_UTAMA:PUSAT`) ? 'LEGACY:KAS_UTAMA:PUSAT' : null) : (keys.has(`LEGACY:KAS_BESAR:${unit}`) ? `LEGACY:KAS_BESAR:${unit}` : null);
    result.push({ _id: id, kode_jenis: `${type}_${unit}`, nama_jenis: `${type.replaceAll('_', ' ')} ${unit}`.trim(), parent_id: parentId, unit, urutan: result.length, aktif: true });
  };
  for (const account of accounts) {
    const type = String(account.kelompok_rekening || 'LAINNYA').trim().toUpperCase();
    const unit = String(account.unit || 'PUSAT').trim().toUpperCase();
    if (type === 'KAS_KECIL' && keys.has(`LEGACY:KAS_BESAR:${unit}`)) ensure('KAS_BESAR', unit);
    ensure(type, unit);
  }
  if (keys.has('LEGACY:KAS_UTAMA:PUSAT') && !result.some((item) => String(item._id) === 'LEGACY:KAS_UTAMA:PUSAT')) ensure('KAS_UTAMA', 'PUSAT');
  return result;
}

export async function reportFinancial(input = {}) {
  const filters = normalizeReportFilters(input);
  // Laporan kas membaca seluruh pencatatan yang pernah masuk: POSTED,
  // PROVISIONAL, dan REVERSED. Pencatatan awal yang REVERSED tetap tampil
  // sebagai histori, sedangkan jurnal pembaliknya tampil pada tanggal reject.
  // Nilai ALL dari UI tidak berarti ada status jurnal bernama ALL.
  const status = filters.journalStatus && filters.journalStatus !== 'ALL' ? filters.journalStatus : 'POSTED';
  const journalStatusQuery = status === 'POSTED'
    ? { status: { $in: ['POSTED', 'PROVISIONAL', 'REVERSED'] } }
    : { status };
  const [masterGroups, allAccounts] = await Promise.all([
    CashType.find({ aktif: { $ne: false } }).sort({ urutan: 1, kode_jenis: 1 }).lean(),
    Account.find({}).sort({ unit: 1, kode_toko: 1, nama_rekening: 1 }).lean(),
  ]);
  const groups = [...masterGroups, ...legacyCashGroups(allAccounts).filter((legacy) => !masterGroups.some((group) => String(group.kode_jenis || '').toUpperCase() === String(legacy.kode_jenis || '').toUpperCase()))];
  const groupMap = new Map(groups.map((group) => [String(group._id), group]));
  const childrenByParent = new Map();
  for (const group of groups) {
    const parent = String(group.parent_id || '');
    childrenByParent.set(parent, [...(childrenByParent.get(parent) || []), group]);
  }
  const descendants = (groupId) => {
    const ids = [groupId];
    for (const child of childrenByParent.get(groupId) || []) ids.push(...descendants(String(child._id)));
    return ids;
  };
  const selectedGroupIds = filters.kelompokKasId
    ? new Set(filters.includeSubgroups ? descendants(filters.kelompokKasId) : [filters.kelompokKasId])
    : null;
  const accounts = allAccounts.filter((account) => {
    if (filters.accountId && String(account._id) !== filters.accountId) return false;
    if (filters.unit && String(account.unit || '').toUpperCase() !== filters.unit) return false;
    // Satu rekening dapat dipakai beberapa cabang. Untuk filter cabang,
    // sumber kebenaran adalah snapshot pada tt_keuangan, bukan kode toko
    // yang kebetulan tersimpan di master rekening.
    if (selectedGroupIds && !selectedGroupIds.has(String(account.pos_kas_id || legacyCashGroupId(account)))) return false;
    return true;
  });
  const accountIds = accounts.map((account) => String(account._id));
  const useSnapshots = status === 'POSTED' && !filters.sourceType;
  const snapshotByAccount = new Map();
  if (useSnapshots && accountIds.length && filters.dateFrom) {
    const snapshots = await BalanceSnapshot.find({ rekening_id: { $in: accountIds }, tanggal_tutup: { $lt: filters.dateFrom } })
      .sort({ rekening_id: 1, tanggal_tutup: -1 })
      .lean();
    for (const snapshot of snapshots) {
      const accountId = String(snapshot.rekening_id);
      if (!snapshotByAccount.has(accountId)) snapshotByAccount.set(accountId, snapshot);
    }
    for (const [accountId, snapshot] of snapshotByAccount) {
      if (snapshot.status !== 'VALID') snapshotByAccount.delete(accountId);
    }
  }
  const snapshotAccountIds = [...snapshotByAccount.keys()];
  const unsnapshottedAccountIds = accountIds.filter((accountId) => !snapshotByAccount.has(accountId));
  const journalScopes = [];
  if (snapshotAccountIds.length) {
    const earliestSnapshot = [...snapshotByAccount.values()].map((snapshot) => snapshot.tanggal_tutup).sort()[0];
    journalScopes.push({ rekening_id: { $in: snapshotAccountIds }, tanggal: { $gt: earliestSnapshot, $lte: filters.dateTo } });
  }
  if (unsnapshottedAccountIds.length) journalScopes.push({ rekening_id: { $in: unsnapshottedAccountIds }, tanggal: { $lte: filters.dateTo } });
  const journalQuery = {
    ...journalStatusQuery,
    ...(['FINANCE', 'NAGAGOLD', 'OPTIK'].includes(filters.sourceType) ? { sumber: filters.sourceType } : {}),
    ...(filters.unit ? { jenis_bisnis: filters.unit } : {}),
    ...(filters.kodeToko ? { kode_toko: filters.kodeToko } : {}),
    ...(journalScopes.length ? { $or: journalScopes } : { rekening_id: { $in: accountIds }, tanggal: { $lte: filters.dateTo } }),
  };
  // Saldo berjalan dan saldo awal harus dihitung dari seluruh jurnal sampai
  // tanggal akhir. Pagination baru diterapkan setelah saldo per rekening
  // selesai dihitung, supaya halaman kedua tidak memulai saldo dari nol.
  const loadedJournals = accountIds.length ? await JournalEntry.find(journalQuery).sort({ tanggal: 1, dibuat_pada: 1, _id: 1 }).lean() : [];
  const journals = loadedJournals.filter((journal) => {
    const snapshot = snapshotByAccount.get(String(journal.rekening_id));
    return !snapshot || String(journal.tanggal) > String(snapshot.tanggal_tutup);
  });
  const transactionNumbers = [...new Set(journals.map((journal) => String(journal.no_transaksi || '').trim()).filter(Boolean))];
  const openingJournalNumbers = journals.filter((journal) => journalType(journal) === 'SALDO_AWAL').map((journal) => String(journal.no_keuangan || journal.no_jurnal));
  const [transactions, openings] = await Promise.all([
    transactionNumbers.length ? transactionDocuments({ transactionNumber: { $in: transactionNumbers } }) : [],
    openingJournalNumbers.length ? OpeningBalance.find({ jurnal_id: { $in: openingJournalNumbers } }).lean() : [],
  ]);
  const transactionMap = new Map(transactions.map((row) => [String(row.transactionNumber), row]));
  const openingMap = new Map(openings.map((row) => [String(row.jurnal_id), row]));
  const accountDetails = accountDetailsMap(accounts);
  for (const account of accounts) {
    const key = String(account._id);
    const details = accountDetails.get(key);
    const group = groupMap.get(String(account.pos_kas_id || legacyCashGroupId(account)));
    if (details) {
      details.cashGroupId = String(account.pos_kas_id || legacyCashGroupId(account));
      details.cashGroupName = group?.nama_jenis || group?.kode_jenis || '';
      details.bankCode = account.bentuk_saldo === 'KAS_TUNAI' ? 'TUNAI' : '';
    }
  }
  const entries = journals.map((journal) => {
    const transaction = transactionMap.get(String(journal.no_transaksi || ''));
    const opening = openingMap.get(String(journal.no_keuangan || journal.no_jurnal));
    return financialRowFromEntry(journal, transaction, opening, accountDetails.get(String(journal.rekening_id)) || { name: journal.nama_rekening, accountNumber: journal.no_rekening, accountCode: journal.no_rekening, cashGroupId: '' });
  });
  const sourceFilteredEntries = ['FINANCE', 'NAGAGOLD', 'OPTIK'].includes(filters.sourceType)
    ? entries.filter((row) => row.source === filters.sourceType)
    : entries;
  const accountEntries = new Map();
  for (const row of sourceFilteredEntries) accountEntries.set(row.accountId, [...(accountEntries.get(row.accountId) || []), row]);
  const accountRows = accounts.map((account) => {
    const accountId = String(account._id);
    const details = accountDetails.get(accountId) || {};
    const accountHistory = accountEntries.get(accountId) || [];
    const before = accountHistory.filter((row) => row.date < filters.dateFrom);
    const period = accountHistory.filter((row) => row.date >= filters.dateFrom && row.date <= filters.dateTo);
    const stats = emptyFinancialStats();
    const snapshot = snapshotByAccount.get(accountId);
    stats.saldoAwal = Number(snapshot?.saldo_akhir || 0);
    for (const row of before) stats.saldoAwal += row.effect;
    for (const row of period) addFinancialEntry(stats, row);
    const publicStats = publicFinancialStats(stats);
    const saldoSebelumPeriode = Number(snapshot?.saldo_akhir || 0) + before.reduce((sum, row) => sum + row.effect, 0);
    return {
      ...publicStats,
      _eventKeys: stats._eventKeys,
      saldoSebelumPeriode,
      id: `account-${accountId}`,
      rowType: 'ACCOUNT',
      accountId,
      accountNumber: account.nomor_rekening || account.kode_akun || '-',
      accountName: account.nama_rekening || '-',
      accountLabel: `${account.nomor_rekening || account.kode_akun || 'Tanpa nomor rekening'} - ${account.nama_rekening || '-'}`,
      label: account.nama_rekening || '-',
      cashGroupId: details.cashGroupId || String(account.pos_kas_id || legacyCashGroupId(account)),
      cashGroupName: details.cashGroupName || '',
      unit: account.unit || '',
      kodeToko: account.kode_toko || '',
      bankCode: account.bentuk_saldo === 'KAS_TUNAI' ? 'TUNAI' : details.bankCode || '',
      hasTransactions: accountHistory.length > 0,
      hasPeriodTransactions: period.length > 0,
    };
  }).filter((row) => {
    if (filters.includeEmptyAccounts && !filters.kodeToko) return true;
    return row.hasPeriodTransactions || (Boolean(filters.kodeToko) && row.hasTransactions);
  });
  const accountRowMap = new Map(accountRows.map((row) => [row.accountId, row]));
  const periodEntries = sourceFilteredEntries.filter((row) => row.date >= filters.dateFrom && row.date <= filters.dateTo);
  const runningByAccount = new Map(accountRows.map((row) => [row.accountId, row.saldoSebelumPeriode || 0]));
  const detailWithBalance = periodEntries.map((row) => {
    const previous = Number(runningByAccount.get(row.accountId) || 0);
    const balance = previous + row.effect;
    runningByAccount.set(row.accountId, balance);
    return { ...row, saldoSebelum: previous, saldoBerjalan: balance, transactionType: transactionMap.get(String(row.transactionNumber))?.jenisTransaksi || row.journalType };
  });
  const detailRows = detailWithBalance.filter((row) => financialDetailMatches(row, filters));
  const detailPage = detailRows.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
  const totalStats = sumFinancialStats(accountRows);
  const toFlatGroupRow = (key, label, rows, extra = {}) => ({ ...sumFinancialStats(rows.map(financialGroupStats)), id: `summary-${key}`, rowType: 'GROUP', key, label, groupBy: filters.groupBy, accountNumber: filters.groupBy === 'ACCOUNT' ? rows[0]?.accountNumber || '' : '', accountName: filters.groupBy === 'ACCOUNT' ? rows[0]?.accountName || label : label, ...extra });
  let summaryRows = [];
  let groupTree = [];
  if (filters.groupBy === 'CASH_GROUP') groupTree = buildFinancialGroupTree(groups, accountRows, filters.kelompokKasId, filters.includeSubgroups);
  else if (filters.groupBy === 'ACCOUNT') summaryRows = accountRows;
  else {
    const grouped = new Map();
    for (const row of accountRows) {
      const key = filters.groupBy === 'UNIT' ? row.unit || 'PUSAT' : filters.groupBy === 'BRANCH' ? row.kodeToko || 'PUSAT' : row.category || 'LAINNYA';
      grouped.set(key, [...(grouped.get(key) || []), row]);
    }
    summaryRows = [...grouped.entries()].map(([key, rows]) => toFlatGroupRow(key, key, rows, { unit: filters.groupBy === 'UNIT' ? key : '', kodeToko: filters.groupBy === 'BRANCH' ? key : '' }));
  }
  const displaySummaryRows = filters.groupBy === 'CASH_GROUP' ? flattenFinancialTree(groupTree) : summaryRows;
  const summary = { ...totalStats, status: status || 'POSTED', periodeAwal: filters.dateFrom, periodeAkhir: filters.dateTo, rekeningCount: accountRows.length, unclassifiedCount: totalStats.unclassifiedCount };
  return {
    filters: { ...filters, journalStatus: status, saldoAwalProvisional: status === 'POSTED' },
    snapshot: { digunakan: useSnapshots && snapshotByAccount.size > 0, rekening: snapshotByAccount.size },
    view: filters.view,
    groupBy: filters.groupBy,
    page: filters.page,
    pageSize: filters.pageSize,
    total: filters.view === 'summary' ? displaySummaryRows.length : detailRows.length,
    totalPages: filters.view === 'summary' ? 1 : Math.ceil(detailRows.length / filters.pageSize),
    rows: filters.view === 'summary' ? displaySummaryRows : detailPage,
    summaryRows: displaySummaryRows,
    groupTree,
    summary,
    detailSummary: {
      totalDebit: detailRows.reduce((sum, row) => sum + (row.reportDebit ?? row.debit), 0),
      totalKredit: detailRows.reduce((sum, row) => sum + (row.reportCredit ?? row.credit), 0),
      jumlahBaris: detailRows.length,
    },
    accountRows,
  };
}

export function reportRowsForExport(report, payload) {
  if (report === 'financial') {
    const rows = payload.view === 'summary' ? (payload.summaryRows || []) : (payload.rows || []);
    if (payload.view === 'summary') return rows.map((row) => ({
      'Jenis baris': row.rowType === 'GROUP' ? 'Kelompok kas' : 'Rekening',
      'Kelompok kas': row.rowType === 'GROUP' ? row.label : (row.cashGroupName || '-'),
      'Unit bisnis': row.unit || '-',
      'Toko / cabang': row.kodeToko || '-',
      'Rekening / kas': row.rowType === 'GROUP' ? row.label : row.accountLabel,
      'Saldo awal': Number(row.saldoAwal || 0),
      Debet: Number(row.debet ?? row.totalDebit ?? 0),
      Kredit: Number(row.kredit ?? row.totalKredit ?? 0),
      'Saldo akhir': Number(row.saldoAkhir || 0),
    }));
    return rows.map((row) => ({
      Tanggal: row.date,
      'No. Keuangan': row.journalNumber,
      'No. Transaksi': row.transactionNumber,
      Rekening: row.accountLabel,
      Sumber: row.source,
      Jenis: row.category,
      Keterangan: row.description,
      Debet: Number((row.reportDebit ?? row.debit) || 0),
      Kredit: Number((row.reportCredit ?? row.credit) || 0),
      'Saldo berjalan': Number(row.saldoBerjalan || 0),
    }));
  }
  if (['nagagold-source', 'nagagold-cash', 'nagagold-accounts'].includes(report)) return (payload.rows || []).map((row) => ({
    'Tanggal Sumber': row.sourceDate,
    Sumber: row.sumber,
    'ID Sumber': row.sourceTransactionId,
    'No Reff': row.noReff,
    Cabang: row.kodeToko,
    'No Rekening': row.noRekening,
    'Kode Bank': row.kodeBank,
    'Nama Bank': row.namaBank,
    Jenis: row.jenis,
    Kategori: row.kategori,
    'Metode Pembayaran': row.metodePembayaran,
    Deskripsi: row.deskripsi,
    Keterangan: row.keterangan,
    'Uang Masuk': row.jumlahIn,
    'Uang Keluar': row.jumlahOut,
    'Status Sumber': row.statusSumber,
    Finalitas: row.finalitas,
    Mapping: row.mappingStatus,
    Rekonsiliasi: row.rekonsiliasiStatus,
    Approval: row.approvalStatus,
    Jurnal: row.journalStatus,
    'Nominal Confirmed Masuk': row.confirmedIn,
    'Nominal Confirmed Keluar': row.confirmedOut,
  }));
  if (report === 'balances') return (payload.rows || []).map((row) => ({ Unit: row.unit, Cabang: row.kodeToko, 'Kode Akun': row.kodeAkun, 'Nama Kas/Rekening': row.namaRekening, 'Jenis Akun': row.jenisAkun, 'Saldo Awal': row.saldoAwal, Debit: row.totalDebit, Kredit: row.totalKredit, 'Saldo Akhir': row.saldoAkhir, 'Saldo Tersimpan': row.saldoTersimpan, Selisih: row.selisihSaldoTersimpan }));
  if (report === 'requests') return (payload.rows || []).map((row) => ({ 'Request ID': row.requestId, Cabang: row.kodeToko, 'Jenis Request': row.jenisRequest, Nominal: row.nilaiRp, Approval: row.approvalStatus, Pembayaran: row.paymentStatus, 'Tanggal Pengajuan': row.requestedAt, 'Tanggal Approval': row.approvedAt || '', 'Tanggal Transfer': row.transferDate || '', 'Referensi Transfer': row.transferReference || '' }));
  if (report === 'journals') return (payload.rows || []).map((row) => ({ Nomor: row.no_keuangan, Tanggal: row.tanggal, Jenis: row.tipe, Status: row.status, Transaksi: row.transaction?.transactionNumber || row.no_transaksi, 'No. rekening': row.no_rekening, 'Nama rekening': row.nama_rekening, Nominal: Math.max(Number(row.debet || 0), Number(row.kredit || 0)), Debit: Number(row.debet || 0), Kredit: Number(row.kredit || 0) }));
  if (report === 'reconciliation') return (payload.rows || []).map((row) => ({ Tanggal: row.transactionDate, Nomor: row.transactionNumber, Cabang: row.kodeToko, Referensi: row.sourceNoReff, Nominal: row.amount, Mapping: row.mappingStatus, 'Alasan Mapping': row.mappingReason, Rekonsiliasi: row.reconciliationStatus, 'Pasangan Transaksi': row.matchedTransactionId, Klasifikasi: row.classificationStatus, 'Alasan Klasifikasi': row.classificationReason, Jurnal: row.journalStatus }));
  if (report === 'mutations') return (payload.rows || []).map((row) => ({ 'Jenis Kas Asal': row.jenisKasAsal, 'Jenis Kas Tujuan': row.jenisKasTujuan, 'Rekening Asal': row.rekeningAsal, 'Rekening Tujuan': row.rekeningTujuan, 'Jumlah Mutasi (Rp)': row.jumlahMutasi }));
  return (payload.rows || []).map((row) => ({ Tanggal: row.transactionDate, 'Tanggal Posting': row.postedDate, Nomor: row.transactionNumber, Sumber: row.sourceType, Cabang: row.kodeToko, Jenis: row.jenisTransaksi, Referensi: row.sourceNoReff || row.requestId, 'Nominal Monitoring': row.amount, 'Nominal Confirmed': row.confirmedAmount, Arah: row.arahDana, Approval: row.approvalStatus, Jurnal: row.journalStatus, Sinkronisasi: row.syncStatus, Rekonsiliasi: row.reconciliationStatus }));
}

export const reportExportLimit = MAX_EXPORT_ROWS;
