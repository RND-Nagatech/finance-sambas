import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_STATUSES,
  JOURNAL_STATUSES,
  PAYMENT_STATUSES,
  SOURCE_TYPES,
  SYNC_STATUSES,
  inferApprovalStatus,
  inferJournalStatus,
  inferPaymentStatus,
  inferSourceType,
  inferSyncStatus,
  sourceTypeLabel,
} from '../transaction-status.js';

test('mengelompokkan transaksi manual, request, dan hasil sync', () => {
  assert.equal(inferSourceType({}), SOURCE_TYPES.MANUAL_ADMIN);
  assert.equal(inferSourceType({ requestId: 'RQS-1' }), SOURCE_TYPES.BRANCH_REQUEST);
  assert.equal(inferSourceType({ isImported: true, sourceSystem: 'nagagold' }), SOURCE_TYPES.SYNC_NAGAGOLD);
  assert.equal(inferSourceType({ isImported: true, sourceSystem: 'optik' }), SOURCE_TYPES.SYNC_OPTIK);
  assert.equal(inferSourceType({ isImported: true, jenis_bisnis: 'VAPE' }), SOURCE_TYPES.SYNC);
  assert.equal(sourceTypeLabel(SOURCE_TYPES.SYNC, 'VAPE'), 'Sinkronisasi VAPE');
});

test('memisahkan status pemrosesan sync dari approval', () => {
  assert.equal(inferSyncStatus({ isImported: true, mappingStatus: 'PERLU_PEMETAAN' }), SYNC_STATUSES.MAPPING_FAILED);
  assert.equal(inferSyncStatus({ isImported: true, mappingStatus: 'TERPETAKAN', rekeningId: 'r-1', statusSumber: 'OPEN', status: 'MENUNGGU_VALIDASI_ADMIN' }), SYNC_STATUSES.RECORDED);
  assert.equal(inferSyncStatus({ isImported: true, mappingStatus: 'TERPETAKAN', rekeningId: 'r-1', statusSumber: 'CLOS', status: 'MENUNGGU_VALIDASI_ADMIN' }), SYNC_STATUSES.NEEDS_REVIEW);
  assert.equal(inferApprovalStatus({ status: 'MENUNGGU_VALIDASI_ADMIN' }), APPROVAL_STATUSES.NOT_STARTED);
  assert.equal(inferApprovalStatus({ status: 'PENDING_APPROVAL' }), APPROVAL_STATUSES.PENDING);
});

test('status payment dan jurnal tidak mengubah status_valid lama', () => {
  assert.equal(inferPaymentStatus({ requestId: 'RQS-1' }), PAYMENT_STATUSES.WAITING_TRANSFER);
  assert.equal(inferPaymentStatus({ requestId: 'RQS-1', status: 'PAID' }), PAYMENT_STATUSES.PAID);
  assert.equal(inferPaymentStatus({}), PAYMENT_STATUSES.NOT_APPLICABLE);
  assert.equal(inferJournalStatus({}, { status: 'PROVISIONAL' }), JOURNAL_STATUSES.PROVISIONAL);
  assert.equal(inferJournalStatus({}, { status: 'POSTED' }), JOURNAL_STATUSES.POSTED);
  assert.equal(inferJournalStatus({}, null), JOURNAL_STATUSES.NOT_CREATED);
});
