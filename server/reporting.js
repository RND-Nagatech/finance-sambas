import { Account, BusinessType, CashType, FinanceMutation, JournalEntry, OpeningBalance, SyncState, SyncTransaction, TransferRequest } from './models.js';
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

export function normalizeReportFilters(input = {}) {
  const today = localDate();
  const filters = {
    dateFrom: cleanDate(input.dateFrom || input.tanggalDari, firstOfMonth()),
    dateTo: cleanDate(input.dateTo || input.tanggalSampai, today),
    postingDateFrom: cleanDate(input.postingDateFrom, ''),
    postingDateTo: cleanDate(input.postingDateTo, ''),
    kodeToko: String(input.kodeToko || input.kode_toko || '').trim().toUpperCase(),
    sourceType: String(input.sourceType || input.source_type || '').trim().toUpperCase(),
    jenisTransaksi: String(input.jenisTransaksi || input.jenis_transaksi || '').trim().toUpperCase(),
    bentukTransaksi: String(input.bentukTransaksi || input.bentuk_transaksi || '').trim().toUpperCase(),
    bentukSaldo: String(input.bentukSaldo || input.bentuk_saldo || input.jenisPenyimpanan || input.jenis_penyimpanan || '').trim().toUpperCase(),
    search: String(input.search || '').trim(),
    accountId: String(input.accountId || input.rekeningId || input.rekening_id || '').trim(),
    kategoriKeuangan: String(input.kategoriKeuangan || input.financialCategory || '').trim().toUpperCase(),
    groupBy: String(input.groupBy || 'ACCOUNT').trim().toUpperCase() === 'CATEGORY' ? 'CATEGORY' : 'ACCOUNT',
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
  if (nagagoldOnly) { query.isImported = true; query.$or = [{ jenis_bisnis: 'NAGAGOLD' }, { sourceSystem: 'nagagold' }]; }
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
  const rows = await Promise.all(models.map((model) => model.find(query).lean()));
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
    bentukSaldo: account.bentuk_saldo || '',
    unit: account.unit || '',
    kodeToko: account.kode_toko || '',
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
  const accountIds = [...new Set(transactions.flatMap((item) => [item.sourceAccountId, item.destinationAccountId, item.rekeningId]).map((value) => String(value || '')).filter(Boolean))];
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
    transactionCount({ ...transactionMongoQuery(filters), isImported: true, classification_status: { $in: ['REVIEW_REQUIRED', 'BLOCKED'] } }, { nagagoldOnly: true }),
    transactionCount({ ...transactionMongoQuery(filters), isImported: true, mappingStatus: { $in: ['PERLU_PEMETAAN', 'PEMETAAN_AMBIGU', 'GAGAL_MAPPING'] } }, { nagagoldOnly: true }),
    transactionCount({ ...transactionMongoQuery(filters), reconciliation_status: 'CONFLICT' }),
    SyncState.find({ sourceSystem: 'nagagold', ...(filters.kodeToko ? { kodeToko: filters.kodeToko } : {}) }).sort({ lastSuccessAt: -1 }).limit(20).lean(),
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

export async function reportIntegrated(input = {}) { return reportTransactions({ ...input, sourceType: 'SYNC' }, { nagagoldOnly: true }); }

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

function financialCategory(journal, transaction = {}) {
  const journalType = String(journal.tipe || journal.tipe_jurnal || journal.jenis_jurnal || '').trim().toUpperCase();
  if (journalType === 'SALDO_AWAL') return 'SALDO AWAL';
  if (journalType === 'PEMBALIKAN') return 'PEMBALIKAN';
  if (['MUTASI', 'PENJUALAN', 'PEMBELIAN', 'OPERASIONAL', 'TRANSAKSI'].includes(journalType)) return journalType;
  const raw = String(transaction.kategoriSumber || transaction.kategori_sistem || transaction.jenisTransaksi || transaction.jenisRequest || journal.kategori || journal.kategori_sistem || '').trim().toUpperCase();
  if (transaction.kategori_sistem === 'MUTASI' || transaction.bentukTransaksi === 'MUTASI_REKENING' || raw.includes('MUTASI')) return 'MUTASI';
  if (raw.includes('SALDO')) return 'SALDO AWAL';
  if (raw.includes('PENJUAL') || raw.includes('PENDAPATAN')) return 'PENJUALAN';
  if (raw.includes('PEMBELI') || raw.includes('BUYBACK')) return 'PEMBELIAN';
  if (raw.includes('OPERASIONAL')) return 'OPERASIONAL';
  if (raw.includes('SERVICE') || raw.includes('SERVIS')) return 'SERVICE';
  return raw.replaceAll('_', ' ') || 'LAINNYA';
}

function financialSearchText(row) {
  return [row.transactionNumber, row.accountNumber, row.accountName, row.category, row.reference, row.description, row.kodeToko, row.namaToko].filter(Boolean).join(' ').toLowerCase();
}

function financialRowFromEntry(journal, transaction, opening, account) {
  const accountDetails = account || {};
  const isOpening = journal.tipe === 'SALDO_AWAL';
  const transactionNumber = transaction?.transactionNumber || '-';
  const category = financialCategory(journal, transaction || {});
  const reference = transaction?.sourceNoReff || transaction?.requestId || (isOpening ? opening?.keterangan : '') || journal.no_keuangan || '-';
  const description = journal.keterangan || transaction?.note || opening?.keterangan || '-';
  const accountNumber = accountDetails.accountNumber || accountDetails.nomor_rekening || accountDetails.accountCode || accountDetails.kode_akun || journal.no_rekening || '-';
  const accountName = accountDetails.name || accountDetails.nama_rekening || journal.nama_rekening || '-';
  return {
    id: String(journal._id),
    journalNumber: journal.no_keuangan,
    journalType: journal.tipe,
    journalStatus: journal.status,
    date: journal.tanggal,
    transactionNumber,
    eventNumber: transaction?.transactionNumber || journal.no_transaksi || journal.no_keuangan,
    category,
    accountId: String(journal.rekening_id),
    accountNumber,
    accountName,
    accountLabel: `${accountNumber} - ${accountName}`,
    jenisKas: accountDetails.jenisKas || accountDetails.kelompok_rekening || accountDetails.jenis_akun || '-',
    unit: accountDetails.unit || '',
    kodeToko: transaction?.kodeToko || accountDetails.kodeToko || '',
    namaToko: transaction?.namaTokoSnapshot || '',
    reference,
    description,
    debit: Number(journal.debet || 0),
    credit: Number(journal.kredit || 0),
    source: transaction?.isImported ? 'NAGAGOLD' : 'FINANCE',
  };
}

export async function reportFinancial(input = {}) {
  const filters = normalizeReportFilters(input);
  const journalQuery = { ...dateQuery('tanggal', filters.dateFrom, filters.dateTo) };
  if (filters.accountId) journalQuery.rekening_id = filters.accountId;
  if (filters.journalStatus) journalQuery.status = filters.journalStatus;
  const journals = await JournalEntry.find(journalQuery).sort({ tanggal: -1, dibuat_pada: -1 }).limit(MAX_EXPORT_ROWS).lean();
  const transactionNumbers = [...new Set(journals.map((journal) => String(journal.no_transaksi || '').trim()).filter(Boolean))];
  const openingJournalNumbers = journals.filter((journal) => journal.tipe === 'SALDO_AWAL').map((journal) => String(journal.no_keuangan));
  const accountIds = [...new Set(journals.map((journal) => String(journal.rekening_id || '')).filter((value) => /^[a-f0-9]{24}$/i.test(value)))];
  const [transactions, openings, accounts] = await Promise.all([
    transactionDocuments({ transactionNumber: { $in: transactionNumbers } }),
    OpeningBalance.find({ jurnal_id: { $in: openingJournalNumbers } }).lean(),
    Account.find({ _id: { $in: accountIds } }).lean(),
  ]);
  const transactionMap = new Map(transactions.map((row) => [String(row.transactionNumber), row]));
  const openingMap = new Map(openings.map((row) => [String(row.jurnal_id), row]));
  const accountMap = new Map(accounts.map((row) => [String(row._id), row]));
  const details = [];
  for (const journal of journals) {
    const transactionNumber = String(journal.no_transaksi || '');
    const transaction = transactionMap.get(transactionNumber);
    const opening = openingMap.get(String(journal.no_keuangan));
    const account = accountMap.get(String(journal.rekening_id));
    if (!account) continue;
    const row = financialRowFromEntry(journal, transaction, opening, account);
    if (filters.kategoriKeuangan && row.category !== filters.kategoriKeuangan) continue;
    if (filters.search && !financialSearchText(row).includes(filters.search.toLowerCase())) continue;
    details.push(row);
  }
  const summaryMap = new Map();
  for (const row of details) {
    const key = filters.groupBy === 'CATEGORY' ? row.category : row.accountId;
    const current = summaryMap.get(key) || { key, groupBy: filters.groupBy, label: filters.groupBy === 'CATEGORY' ? row.category : row.accountLabel, accountNumber: filters.groupBy === 'CATEGORY' ? '' : row.accountNumber, accountName: filters.groupBy === 'CATEGORY' ? row.category : row.accountName, jumlahTransaksi: 0, totalDebit: 0, totalKredit: 0, net: 0, _eventKeys: new Set() };
    current.totalDebit += row.debit;
    current.totalKredit += row.credit;
    current.net += row.debit - row.credit;
    current._eventKeys.add(row.eventNumber);
    summaryMap.set(key, current);
  }
  const summaryRows = [...summaryMap.values()].map((row) => ({ ...row, jumlahTransaksi: row._eventKeys.size, _eventKeys: undefined })).sort((left, right) => (right.totalDebit + right.totalKredit) - (left.totalDebit + left.totalKredit));
  const detailRows = details.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
  const summaryTotal = new Set(details.map((row) => row.eventNumber)).size;
  return {
    filters,
    view: filters.view,
    groupBy: filters.groupBy,
    page: filters.page,
    pageSize: filters.pageSize,
    total: filters.view === 'summary' ? summaryRows.length : details.length,
    totalPages: filters.view === 'summary' ? Math.ceil(summaryRows.length / filters.pageSize) : Math.ceil(details.length / filters.pageSize),
    rows: filters.view === 'summary' ? summaryRows.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize) : detailRows,
    summaryRows,
    summary: {
      jumlahTransaksi: summaryTotal,
      totalDebit: details.reduce((sum, row) => sum + row.debit, 0),
      totalKredit: details.reduce((sum, row) => sum + row.credit, 0),
      net: details.reduce((sum, row) => sum + row.debit - row.credit, 0),
    },
  };
}

export function reportRowsForExport(report, payload) {
  if (report === 'financial') {
    const rows = payload.view === 'summary' ? (payload.summaryRows || []) : (payload.rows || []);
    if (payload.view === 'summary') return rows.map((row) => ({ 'Rekap berdasarkan': payload.groupBy === 'CATEGORY' ? 'Kategori' : 'No. rekening', 'No. rekening': row.accountNumber, 'Nama rekening / kategori': row.label, 'Jumlah transaksi': row.jumlahTransaksi, Debit: row.totalDebit, Kredit: row.totalKredit, 'Saldo bersih': row.net }));
    return rows.map((row) => ({ Tanggal: row.date, 'Nomor transaksi': row.transactionNumber, Kategori: row.category, 'No. rekening': row.accountNumber, 'Nama rekening': row.accountName, Referensi: row.reference, Keterangan: row.description, Debit: row.debit, Kredit: row.credit, 'Status pencatatan': row.journalStatus }));
  }
  if (['nagagold-source', 'nagagold-cash', 'nagagold-accounts'].includes(report)) return (payload.rows || []).map((row) => ({
    'Tanggal Sumber': row.sourceDate,
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
