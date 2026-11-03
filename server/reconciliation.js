export const RECONCILIATION_STATUSES = Object.freeze({
  UNMATCHED: 'UNMATCHED',
  MATCH_CANDIDATE: 'MATCH_CANDIDATE',
  MATCHED: 'MATCHED',
  CONFLICT: 'CONFLICT',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

export const MATCH_METHODS = Object.freeze({
  REQUEST_ID: 'REQUEST_ID',
  SOURCE_REFERENCE: 'SOURCE_REFERENCE',
  ACCOUNT_DATE_AMOUNT: 'ACCOUNT_DATE_AMOUNT',
  MANUAL_CONFIRMATION: 'MANUAL_CONFIRMATION',
  MANUAL_REJECT: 'MANUAL_REJECT',
});

const values = (object) => Object.values(object);

export function normalizeNagagoldValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || ['FALSE', 'NULL', 'UNDEFINED', '-'].includes(normalized.toUpperCase())) return '';
  return normalized;
}

export function isCashPayment(item = {}) {
  // Pada OPTIK, type_trx hanya berarti arah buku (D/K), bukan metode bayar.
  // Field `jenis` tetap merupakan metode pembayaran dan sudah didekripsi
  // sebelum mapping, sehingga nilai CASH/BANK harus tetap dipakai.
  const paymentValues = [
    item.jenis,
    item.jenis_pembayaran,
    item.jenisPembayaran,
    item.paymentMethod,
    item.metodePembayaran,
    item.source_payment_method,
  ]
    .map((value) => String(value || '').trim().toUpperCase());
  const noRekening = normalizeNagagoldValue(item.source_no_rekening || item.sourceNoRekening || item.no_rekening || item.noRekening);
  // QRIS dan GOPAY tidak membawa nomor rekening pada sumber Optik, tetapi
  // tetap harus diperlakukan sebagai pembayaran non-tunai. BPJS untuk sementara
  // dibukukan ke kas tunai sesuai aturan integrasi Finance.
  if (paymentValues.includes('QRIS') || paymentValues.includes('GOPAY')) return false;
  return paymentValues.includes('CASH') || paymentValues.includes('TUNAI') || paymentValues.includes('BPJS') || !noRekening;
}

export function sourcePaymentMethod(item = {}) {
  const value = [
    item.jenis,
    item.jenis_pembayaran,
    item.jenisPembayaran,
    item.paymentMethod,
    item.metodePembayaran,
    item.source_payment_method,
  ]
    .map((entry) => String(entry || '').trim().toUpperCase())
    .find(Boolean);
  if (value === 'BPJS') return 'BPJS';
  if (value === 'QRIS') return 'QRIS';
  if (value === 'GOPAY') return 'GOPAY';
  if (isCashPayment(item)) return 'CASH';
  if (value === 'TUNAI') return 'CASH';
  return value || 'BANK';
}

// `jenis=TRANSFER` pada tt_cash_daily adalah metode pembayaran, bukan bukti
// bahwa transaksi tersebut merupakan mutasi dana antar-sistem. Penjualan yang
// dibayar lewat transfer tetap merupakan transaksi operasional cabang dan tidak
// perlu dicari pasangan transaksi Finance.
export function isNagagoldInternalTransfer(transaction = {}) {
  if (!transaction.isImported && !['SYNC', 'SYNC_NAGAGOLD', 'SYNC_OPTIK'].includes(String(transaction.source_type || '').toUpperCase())) return false;
  // Hanya request_id dari Finance yang menjadi penanda resmi bahwa record
  // Nagagold adalah realisasi perpindahan yang sudah dicatat di Finance.
  // Nominal, tanggal, kategori, dan metode pembayaran bukan bukti duplikasi.
  return Boolean(String(transaction.requestId || transaction.request_id || '').trim());
}

export function isReconciliationStatus(value) {
  return values(RECONCILIATION_STATUSES).includes(value);
}

export function reconciliationApplicable(transaction = {}) {
  if (transaction.isImported || transaction.source_type === 'SYNC' || transaction.source_type === 'SYNC_NAGAGOLD' || transaction.source_type === 'SYNC_OPTIK') return isNagagoldInternalTransfer(transaction);
  if (transaction.source_type === 'BRANCH_REQUEST' || transaction.requestId) return true;
  return transaction.bentukTransaksi === 'TRANSFER_INTERNAL' || transaction.bentukTransaksi === 'MUTASI_REKENING';
}

export function reconciliationDirection(transaction = {}) {
  if (transaction.isImported || transaction.rekeningId) return String(transaction.arahDana || '').toUpperCase();
  if (transaction.destinationAccountId && !transaction.sourceAccountId) return 'MASUK';
  if (transaction.sourceAccountId && !transaction.destinationAccountId) return 'KELUAR';
  return '';
}

export function candidateEvidence(imported = {}, manual = {}) {
  const importedDate = String(imported.transactionDate || imported.tanggal || '').slice(0, 10);
  const manualDate = String(manual.transactionDate || manual.tanggal || '').slice(0, 10);
  const amountMatch = Number(imported.amount || imported.nilai || 0) === Number(manual.amount || manual.nilai || 0);
  const dateMatch = Boolean(importedDate && manualDate && importedDate === manualDate);
  const branchMatch = Boolean(imported.kodeToko && manual.kodeToko && String(imported.kodeToko).toUpperCase() === String(manual.kodeToko).toUpperCase());
  const importedDirection = reconciliationDirection(imported);
  const manualDirection = reconciliationDirection(manual);
  const directionMatch = Boolean(importedDirection && manualDirection && importedDirection === manualDirection);
  const importedAccount = String(imported.rekeningId || '');
  const manualAccount = importedDirection === 'MASUK'
    ? String(manual.destinationAccountId || '')
    : String(manual.sourceAccountId || '');
  const accountMatch = Boolean(importedAccount && manualAccount && importedAccount === manualAccount);
  const requestMatch = Boolean(imported.requestId && manual.requestId && imported.requestId === manual.requestId);
  const referenceMatch = Boolean(imported.sourceNoReff && manual.sourceNoReff && imported.sourceNoReff === manual.sourceNoReff);
  const score = (amountMatch ? 2 : 0) + (dateMatch ? 2 : 0) + (branchMatch ? 2 : 0) + (directionMatch ? 1 : 0) + (accountMatch ? 3 : 0) + (requestMatch ? 6 : 0) + (referenceMatch ? 5 : 0);
  return { amountMatch, dateMatch, branchMatch, directionMatch, accountMatch, requestMatch, referenceMatch, score };
}

export function candidateIsUseful(evidence = {}) {
  // request_id adalah identitas bisnis yang lebih kuat daripada tanggal. Tanggal
  // penerimaan di cabang dapat berbeda dari tanggal transfer Finance, sehingga
  // pasangan dengan request_id yang sama tetap valid selama nominalnya sama.
  return Boolean(evidence.amountMatch && (evidence.dateMatch || evidence.requestMatch) && (evidence.branchMatch || evidence.accountMatch || evidence.requestMatch || evidence.referenceMatch));
}

