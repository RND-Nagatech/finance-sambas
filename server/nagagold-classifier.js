import { ACCOUNT_KINDS } from './models.js';
import { RECONCILIATION_STATUSES } from './reconciliation.js';

export const NAGAGOLD_CLASSIFICATION_STATUSES = Object.freeze({
  AUTO_ELIGIBLE: 'AUTO_ELIGIBLE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  BLOCKED: 'BLOCKED',
});

export const NAGAGOLD_CLASSIFICATION_RULE_VERSION = '5.0';

const finalStatuses = new Set(['FINAL', 'SETTLED', 'COMPLETED', 'CLOSED', 'POSTED', 'PAID']);

const normalize = (value) => String(value || '').trim().toUpperCase();
const isPrintable = (value) => !value || /^[ -~]+$/.test(String(value));
const hasUnreadableText = (value) => Boolean(value) && !isPrintable(value);
// Saldo awal adalah pembukaan saldo, bukan pergerakan kas harian. Record ini
// tetap boleh diaudit di sistem sumber, tetapi tidak boleh diimpor sebagai
// transaksi Finance karena pembukaan saldo Finance ditangani melalui
// tt_saldo_awal dan proses tutup toko.
export function isNagagoldOpeningBalance(transaction = {}) {
  return normalize(transaction.kategoriSumber || transaction.kategori_sumber || transaction.kategori) === 'SALDO AWAL';
}

export function nagagoldClassificationLabel(value) {
  return {
    [NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE]: 'Siap dibukukan',
    [NAGAGOLD_CLASSIFICATION_STATUSES.REVIEW_REQUIRED]: 'Perlu diperiksa',
    [NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED]: 'Perlu rekonsiliasi',
    [NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED]: 'Ditahan',
  }[value] || value || 'Belum diklasifikasikan';
}

function accountKind(account = {}) {
  if (account.jenis_akun) return normalize(account.jenis_akun);
  if (account.bentuk_saldo === 'KAS_TUNAI' && account.kode_toko) return ACCOUNT_KINDS.STORE_CASH;
  if (account.bentuk_saldo === 'KAS_TUNAI') return ACCOUNT_KINDS.CASH_ACCOUNT;
  if (account.bentuk_saldo === 'REKENING_BANK') return ACCOUNT_KINDS.BANK_ACCOUNT;
  return '';
}

function proposalFor(transaction, account, category) {
  if (!account || !transaction.amount) return null;
  const incoming = normalize(transaction.arahDana) === 'MASUK';
  const accountId = String(account._id || account.id || transaction.rekeningId || '');
  const accountName = account.nama_rekening || account.name || '';
  const text = String(category || '').toUpperCase();
  const journalType = text.includes('MUTASI') ? 'MUTASI' : text.includes('PENJUAL') ? 'PENJUALAN' : text.includes('PEMBELI') || text.includes('BUYBACK') ? 'PEMBELIAN' : text.includes('OPERASIONAL') ? 'OPERASIONAL' : 'TRANSAKSI';
  return {
    direction: incoming ? 'MASUK' : 'KELUAR',
    amount: Number(transaction.amount),
    rekeningId: accountId,
    rekeningName: accountName,
    debitAccountId: incoming ? accountId : '',
    debitAccountName: incoming ? accountName : '-',
    creditAccountId: incoming ? '' : accountId,
    creditAccountName: incoming ? '-' : accountName,
    tipe: journalType,
    audit: {
      mappingStatus: transaction.mappingStatus || 'PERLU_PEMETAAN',
      mappingReason: transaction.mappingReason || '',
      sourceDecryptionStatus: transaction.sourceDecryptionStatus || 'UNKNOWN',
      sourceDecryptionNote: transaction.sourceDecryptionNote || '',
      sourceFinalityStatus: transaction.sourceFinalityStatus || 'UNVERIFIED',
      sourceFinalityNote: transaction.sourceFinalityNote || '',
      sourceSnapshotRecoveryStatus: transaction.sourceSnapshotRecoveryStatus || 'UNKNOWN',
    },
  };
}

export function classifyNagagoldTransaction(transaction = {}, context = {}) {
  const category = normalize(transaction.kategoriSumber || transaction.kategori || transaction.jenisRequest);
  const jenis = normalize(transaction.jenisSumber || transaction.jenis);
  const sourceStatus = normalize(transaction.statusSumber || transaction.status);
  const paymentMethod = normalize(transaction.source_payment_method || transaction.sourcePaymentMethod || (jenis === 'CASH' ? 'CASH' : 'BANK'));
  const amount = Number(transaction.amount || 0);
  const amountIn = Number(transaction.source_amount_in || transaction.sourceAmountIn || 0);
  const amountOut = Number(transaction.source_amount_out || transaction.sourceAmountOut || 0);
  const sourceDirectionAvailable = transaction.source_amount_in !== undefined || transaction.sourceAmountIn !== undefined || transaction.source_amount_out !== undefined || transaction.sourceAmountOut !== undefined;
  const account = context.account || null;
  const mappedAccountKind = accountKind(account || {});
  const reasons = [];
  const flags = [];
  let status = NAGAGOLD_CLASSIFICATION_STATUSES.REVIEW_REQUIRED;

  if (!transaction.isImported && !['SYNC', 'SYNC_NAGAGOLD', 'SYNC_OPTIK'].includes(transaction.source_type)) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('Data bukan transaksi hasil sinkronisasi Nagagold.');
  }
  if (!String(transaction.sourceKey || '').trim() || !String(transaction.source_transaction_id || transaction.sourceId || '').trim()) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('sourceKey atau ID transaksi sumber belum tersedia.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('Nominal transaksi tidak valid atau nol.');
  }
  if (amountIn > 0 && amountOut > 0) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('jumlah_in dan jumlah_out sama-sama terisi.');
  }
  if (!sourceDirectionAvailable) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('jumlah_in/jumlah_out sumber belum tersimpan; arah dana tidak boleh ditebak.');
    flags.push('SOURCE_DIRECTION_UNAVAILABLE');
  } else if (amountIn <= 0 && amountOut <= 0) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('jumlah_in dan jumlah_out sumber sama-sama nol.');
    flags.push('SOURCE_DIRECTION_ZERO');
  }
  if (hasUnreadableText(jenis) || hasUnreadableText(category)) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('Jenis atau kategori terenkripsi belum dapat dibaca dengan aman.');
  }

  const reconciliationStatus = normalize(transaction.reconciliation_status || transaction.reconciliationStatus);
  const hasMatchedPair = reconciliationStatus === RECONCILIATION_STATUSES.MATCHED || Boolean(String(transaction.matched_transaction_id || transaction.matchedTransactionId || '').trim());
  const hasReconciliationCandidate = [RECONCILIATION_STATUSES.MATCH_CANDIDATE, RECONCILIATION_STATUSES.CONFLICT].includes(reconciliationStatus) || Number(context.reconciliationCandidateCount || 0) > 0;
  const hasExistingPosted = normalize(transaction.journal_status || transaction.journalStatus) === 'POSTED' && normalize(transaction.saldo_status || transaction.saldoStatus) === 'DITERAPKAN';
  const hasExistingJournal = !hasExistingPosted && Boolean(context.existingJournal || ['PROVISIONAL', 'POSTED', 'REVERSED'].includes(normalize(transaction.journal_status || transaction.journalStatus)));
  const hasLinkedRequest = Boolean(context.request || String(transaction.requestId || '').trim());
  const hasReconciliationPriority = hasMatchedPair || hasReconciliationCandidate || hasExistingJournal || hasLinkedRequest;
  if (String(transaction.requestId || '').trim() && !context.request) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push(`request_id ${String(transaction.requestId).trim()} tidak ditemukan di Finance; transaksi tidak boleh diposting.`);
    flags.push('REQUEST_NOT_FOUND');
  }
  if (context.request && !String(context.request.finance_transaction_id || '').trim() && status !== NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED;
    reasons.push(`request_id ${String(transaction.requestId || context.request.requestId).trim()} belum memiliki realisasi transfer Finance.`);
    flags.push('REQUEST_PAYMENT_NOT_RECORDED');
  }
  if (hasMatchedPair) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED;
    reasons.push('Sudah memiliki pasangan transaksi Finance; jangan membuat jurnal kedua.');
    flags.push('MATCHED_EXISTING');
  } else if (hasReconciliationCandidate) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED;
    reasons.push('Memiliki kandidat atau konflik rekonsiliasi dengan transaksi Finance.');
    flags.push('RECONCILIATION_CANDIDATE');
  } else if (hasExistingJournal) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED;
    reasons.push('Transaksi sudah memiliki jurnal Finance; perlu dipastikan tidak ada posting ganda.');
    flags.push('EXISTING_JOURNAL');
  }
  if (hasLinkedRequest && status !== NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED;
    reasons.push('Transaksi memiliki hubungan dengan request cabang; periksa realisasi request sebelum posting.');
    flags.push('BRANCH_REQUEST_LINKED');
  }
  if (hasExistingPosted && status !== NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED && status !== NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE;
    reasons.push('Transaksi sumber sudah dibukukan sebelumnya; tidak ada posting tambahan.');
    flags.push('ALREADY_POSTED');
  }

  if (!account || !String(transaction.rekeningId || '').trim() || (transaction.mappingStatus && normalize(transaction.mappingStatus) !== 'TERPETAKAN')) {
    if (!hasReconciliationPriority) status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('Akun kas/rekening belum berhasil dipetakan secara unik.');
    flags.push('ACCOUNT_MAPPING_MISSING');
  } else {
    const accountNumber = String(account.nomor_rekening || account.accountNumber || '').trim();
    const sourceAccountNumber = String(transaction.sourceNoRekening || transaction.source_no_rekening || '').trim();
    const bankCode = normalize(transaction.sourceKodeBank || transaction.source_kode_bank);
    const accountBankCode = normalize(context.accountBankCode || account.kode_bank || account.bankCode);
    if (paymentMethod === 'CASH' || jenis === 'CASH') {
      const sourceUnit = normalize(transaction.jenis_bisnis || transaction.jenisBisnis || transaction.unit || transaction.unitType);
      const cashKindValid = [ACCOUNT_KINDS.STORE_CASH, ACCOUNT_KINDS.CASH_ACCOUNT, ACCOUNT_KINDS.OPERATING_CASH].includes(mappedAccountKind);
      const cashUnitValid = !sourceUnit || !account.unit || sourceUnit === normalize(account.unit);
      if (!cashKindValid || account.bentuk_saldo !== 'KAS_TUNAI' || !cashUnitValid) {
        if (!hasReconciliationPriority) status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
        reasons.push('CASH harus dipetakan ke penyimpanan TUNAI pada unit bisnis sumber yang sama.');
        flags.push('CASH_ACCOUNT_KIND_INVALID');
      }
    } else {
      if (mappedAccountKind !== ACCOUNT_KINDS.BANK_ACCOUNT || account.bentuk_saldo !== 'REKENING_BANK') {
        if (!hasReconciliationPriority) status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
        reasons.push('Transaksi non-CASH harus dipetakan ke Rekening Bank.');
        flags.push('BANK_ACCOUNT_KIND_INVALID');
      }
      if (!sourceAccountNumber || sourceAccountNumber === '-') {
        if (!hasReconciliationPriority) status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
        reasons.push('Nomor rekening sumber belum tersedia untuk transaksi non-CASH.');
        flags.push('BANK_NUMBER_MISSING');
      } else if (accountNumber && sourceAccountNumber !== accountNumber) {
        if (!hasReconciliationPriority) status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
        reasons.push('Nomor rekening sumber tidak sama dengan rekening hasil mapping.');
        flags.push('BANK_NUMBER_MISMATCH');
      }
      if (bankCode && accountBankCode && bankCode !== accountBankCode) {
        if (!hasReconciliationPriority) status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
        reasons.push('Kode bank sumber tidak sama dengan bank rekening hasil mapping.');
        flags.push('BANK_CODE_MISMATCH');
      }
    }
  }

  if (status !== NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED && status !== NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED && category === 'SALDO AWAL') {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED;
    reasons.push('Saldo awal diproses melalui jurnal pembukaan Finance, bukan transaksi harian Nagagold.');
    flags.push('OPENING_BALANCE');
  }
  if (status !== NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED && status !== NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED && sourceStatus !== 'OPEN') {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.REVIEW_REQUIRED;
    reasons.push(`Status sumber ${sourceStatus || 'KOSONG'} perlu dikonfirmasi sebagai status final.`);
    flags.push('SOURCE_STATUS_REVIEW');
  } else if (status !== NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED && status !== NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED && !context.sourceStatusFinal) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.REVIEW_REQUIRED;
    reasons.push('Status OPEN belum terbukti sebagai status final untuk posting.');
    flags.push('SOURCE_FINALITY_UNPROVEN');
  }
  const sourceStatusKnownFinal = (finalStatuses.has(sourceStatus) || sourceStatus === 'OPEN') && context.sourceStatusFinal === true;
  const safeForFutureAutoPost = sourceStatusKnownFinal && Boolean(category) && !hasMatchedPair && !hasReconciliationCandidate && !hasExistingJournal && !hasLinkedRequest && !hasUnreadableText(category) && !hasUnreadableText(jenis) && status !== NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED && status !== NAGAGOLD_CLASSIFICATION_STATUSES.RECONCILIATION_REQUIRED;
  if (safeForFutureAutoPost) {
    status = NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE;
    reasons.push('Sumber sudah divalidasi kasir dan mapping Finance unik; transaksi siap dibukukan tanpa approval Finance kedua.');
    flags.push('FUTURE_AUTO_POST_CANDIDATE');
  }
  if (!reasons.length) reasons.push('Belum ada aturan klasifikasi yang cukup untuk transaksi ini.');

  return {
    status,
    statusLabel: nagagoldClassificationLabel(status),
    reason: reasons.join(' '),
    flags: [...new Set(flags)],
    ruleVersion: NAGAGOLD_CLASSIFICATION_RULE_VERSION,
    proposedJournal: proposalFor(transaction, account, category),
    metadata: {
      jenis,
      kategori: category,
      statusSumber: sourceStatus,
      metodePembayaran: paymentMethod,
      arahDana: normalize(transaction.arahDana),
      rekeningKind: mappedAccountKind,
      sourceStatusFinal: Boolean(context.sourceStatusFinal),
      existingJournal: hasExistingJournal,
      reconciliationStatus,
    },
  };
}
