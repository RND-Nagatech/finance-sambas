export const SOURCE_TYPES = Object.freeze({
  MANUAL_ADMIN: 'MANUAL_ADMIN',
  SYNC: 'SYNC',
  SYNC_NAGAGOLD: 'SYNC_NAGAGOLD',
  SYNC_OPTIK: 'SYNC_OPTIK',
  BRANCH_REQUEST: 'BRANCH_REQUEST',
});

export const SYNC_STATUSES = Object.freeze({
  NOT_APPLICABLE: 'TIDAK_BERLAKU',
  RECORDED: 'TERCATAT',
  RECONCILED: 'DIREKONSILIASI',
  NEEDS_REVIEW: 'PERLU_REVIEW',
  MAPPING_FAILED: 'GAGAL_MAPPING',
  FAILED: 'GAGAL_SINKRONISASI',
});

export const APPROVAL_STATUSES = Object.freeze({
  NOT_STARTED: 'BELUM_DIPERIKSA',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  NOT_REQUIRED: 'TIDAK_DIPERLUKAN',
});

export const PAYMENT_STATUSES = Object.freeze({
  NOT_APPLICABLE: 'TIDAK_BERLAKU',
  WAITING_TRANSFER: 'MENUNGGU_TRANSFER',
  PENDING_APPROVAL: 'MENUNGGU_APPROVAL',
  PAID: 'SUDAH_DIBAYAR',
  FAILED: 'GAGAL',
  CANCELLED: 'DIBATALKAN',
});

export const JOURNAL_STATUSES = Object.freeze({
  NOT_CREATED: 'BELUM_DIBUAT',
  PROVISIONAL: 'PROVISIONAL',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
});

export const BALANCE_STATUSES = Object.freeze({
  NOT_APPLIED: 'BELUM_DITERAPKAN',
  APPLIED: 'DITERAPKAN',
  REVERSED: 'DIBALIK',
});

const values = (object) => Object.values(object);

export function isSourceType(value) {
  return values(SOURCE_TYPES).includes(value);
}

export function inferSourceType(transaction = {}) {
  if (isSourceType(transaction.source_type)) return transaction.source_type;
  if (transaction.isImported) {
    if (String(transaction.jenis_bisnis || transaction.jenisBisnis || '').trim()) return SOURCE_TYPES.SYNC;
    return String(transaction.sourceSystem || '').toLowerCase() === 'optik'
      ? SOURCE_TYPES.SYNC_OPTIK
      : SOURCE_TYPES.SYNC_NAGAGOLD;
  }
  if (String(transaction.requestId || '').trim()) return SOURCE_TYPES.BRANCH_REQUEST;
  return SOURCE_TYPES.MANUAL_ADMIN;
}

export function inferApprovalStatus(transaction = {}) {
  if (transaction.approval_status && values(APPROVAL_STATUSES).includes(transaction.approval_status)) return transaction.approval_status;
  if (transaction.status === 'APPROVED') return APPROVAL_STATUSES.APPROVED;
  if (transaction.status === 'REJECTED') return APPROVAL_STATUSES.REJECTED;
  if (transaction.status === 'PENDING_APPROVAL') return APPROVAL_STATUSES.PENDING;
  if (transaction.status === 'MENUNGGU_VALIDASI_ADMIN') return APPROVAL_STATUSES.NOT_STARTED;
  return APPROVAL_STATUSES.NOT_STARTED;
}

export function inferSyncStatus(transaction = {}) {
  if (!transaction.isImported && !String(transaction.sourceSystem || '').trim()) return SYNC_STATUSES.NOT_APPLICABLE;
  if (transaction.sync_status && values(SYNC_STATUSES).includes(transaction.sync_status)) return transaction.sync_status;
  if (transaction.mappingStatus === 'PERLU_PEMETAAN' || !transaction.rekeningId) return SYNC_STATUSES.MAPPING_FAILED;
  if (transaction.status === 'APPROVED' || transaction.status === 'REJECTED' || transaction.validasiAdminPada) return SYNC_STATUSES.RECONCILED;
  if (String(transaction.statusSumber || '').toUpperCase() && String(transaction.statusSumber).toUpperCase() !== 'OPEN') return SYNC_STATUSES.NEEDS_REVIEW;
  return SYNC_STATUSES.RECORDED;
}

export function inferPaymentStatus(transaction = {}) {
  if (transaction.payment_status && values(PAYMENT_STATUSES).includes(transaction.payment_status)) return transaction.payment_status;
  if (!String(transaction.requestId || '').trim()) return PAYMENT_STATUSES.NOT_APPLICABLE;
  if (['COMPLETED', 'PAID'].includes(transaction.status)) return PAYMENT_STATUSES.PAID;
  return PAYMENT_STATUSES.WAITING_TRANSFER;
}

export function inferJournalStatus(transaction = {}, journal = null) {
  if (transaction.journal_status && values(JOURNAL_STATUSES).includes(transaction.journal_status)) return transaction.journal_status;
  if (journal?.status === 'POSTED') return JOURNAL_STATUSES.POSTED;
  if (journal?.status === 'REVERSED') return JOURNAL_STATUSES.REVERSED;
  if (journal?.status === 'PROVISIONAL') return JOURNAL_STATUSES.PROVISIONAL;
  return JOURNAL_STATUSES.NOT_CREATED;
}

export function sourceTypeLabel(value, business = '') {
  if (value === SOURCE_TYPES.SYNC) {
    const label = String(business || '').trim().toUpperCase();
    return label ? `Sinkronisasi ${label}` : 'Sinkronisasi';
  }
  return {
    [SOURCE_TYPES.MANUAL_ADMIN]: 'Input Admin',
    [SOURCE_TYPES.SYNC_NAGAGOLD]: 'Sync Nagagold',
    [SOURCE_TYPES.SYNC_OPTIK]: 'Sync Optik',
    [SOURCE_TYPES.BRANCH_REQUEST]: 'Request Cabang',
  }[value] || value || '-';
}

export function syncStatusLabel(value) {
  return {
    [SYNC_STATUSES.NOT_APPLICABLE]: 'Tidak berlaku',
    [SYNC_STATUSES.RECORDED]: 'Tercatat',
    [SYNC_STATUSES.RECONCILED]: 'Direkonsiliasi',
    [SYNC_STATUSES.NEEDS_REVIEW]: 'Perlu review',
    [SYNC_STATUSES.MAPPING_FAILED]: 'Gagal mapping',
    [SYNC_STATUSES.FAILED]: 'Gagal sinkronisasi',
  }[value] || value || '-';
}

export function approvalStatusLabel(value) {
  return {
    [APPROVAL_STATUSES.NOT_STARTED]: 'Belum diperiksa',
    [APPROVAL_STATUSES.PENDING]: 'Menunggu approval',
    [APPROVAL_STATUSES.APPROVED]: 'Approved',
    [APPROVAL_STATUSES.REJECTED]: 'Rejected',
    [APPROVAL_STATUSES.NOT_REQUIRED]: 'Tidak perlu approval',
  }[value] || value || '-';
}

export function journalStatusLabel(value) {
  return {
    [JOURNAL_STATUSES.NOT_CREATED]: 'Belum dibuat',
    [JOURNAL_STATUSES.PROVISIONAL]: 'Provisional',
    [JOURNAL_STATUSES.POSTED]: 'Posted',
    [JOURNAL_STATUSES.REVERSED]: 'Reversed',
  }[value] || value || '-';
}
