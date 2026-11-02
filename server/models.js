import mongoose from 'mongoose';
import {
  APPROVAL_STATUSES,
  JOURNAL_STATUSES,
  BALANCE_STATUSES,
  PAYMENT_STATUSES,
  SOURCE_TYPES,
  SYNC_STATUSES,
} from './transaction-status.js';
import { RECONCILIATION_STATUSES } from './reconciliation.js';

const { Schema } = mongoose;
const collectionName = (name) => name;

export const ACCOUNT_KINDS = Object.freeze({
  STORE_CASH: 'KAS_TUNAI_TOKO',
  CASH_ACCOUNT: 'KAS_TUNAI',
  OPERATING_CASH: 'KAS_KECIL_OPERASIONAL',
  BANK_ACCOUNT: 'REKENING_BANK',
  LARGE_CASH: 'KAS_BESAR',
});

const accountSchema = new Schema({
  kode_akun: { type: String, default: '', trim: true, uppercase: true },
  nama_rekening: { type: String, required: true, trim: true },
  kelompok_rekening: { type: String, required: true, trim: true, uppercase: true },
  pos_kas_id: { type: Schema.Types.ObjectId, ref: 'FinanceCashType' },
  jenis_bisnis_id: { type: Schema.Types.ObjectId, ref: 'FinanceBusinessType', default: null },
  unit: { type: String, trim: true, uppercase: true, default: 'PUSAT' },
  bank_id: { type: Schema.Types.ObjectId, ref: 'FinanceBank', default: null },
  nomor_rekening: { type: String, default: '' },
  atas_nama: { type: String, trim: true },
  bentuk_saldo: { type: String, enum: ['REKENING_BANK', 'KAS_TUNAI'], default: 'REKENING_BANK' },
  jenis_akun: { type: String, enum: ['', ...Object.values(ACCOUNT_KINDS)], default: '' },
  kode_toko: { type: String, trim: true, uppercase: true },
  cabang_id: { type: Schema.Types.ObjectId, ref: 'FinanceBranch' },
  lokasi_pengelolaan: { type: String, enum: ['PUSAT', 'TOKO_CABANG'] },
  penanggung_jawab: { type: String, default: '', trim: true },
  saldo_akhir: { type: Number, default: 0, min: 0 },
  aktif: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tm_rekening'), versionKey: false });
accountSchema.index({ bentuk_saldo: 1, unit: 1, kode_toko: 1, jenis_akun: 1 }, { unique: true, partialFilterExpression: { bentuk_saldo: 'KAS_TUNAI', aktif: true, jenis_akun: { $in: [ACCOUNT_KINDS.STORE_CASH, ACCOUNT_KINDS.OPERATING_CASH] } }, name: 'uniq_active_cash_account_kind' });
// Index unik kode akun dibuat oleh ensureSafeFinanceIndexes setelah pemeriksaan
// data lama agar startup tidak gagal pada database existing yang belum lengkap.

const bankSchema = new Schema({
  kode_bank: { type: String, required: true, unique: true, trim: true, uppercase: true },
  nama_bank: { type: String, required: true, trim: true },
  sistem: { type: Boolean, default: false },
  aktif: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tm_bank'), versionKey: false });

// Master referensi untuk kelompok kas. Kodenya dipertahankan stabil agar
// laporan dan transaksi lama tetap kompatibel; nama dan urutan ditampilkan
// dari collection ini, bukan dari hardcode form.
const cashTypeSchema = new Schema({
  kode_jenis: { type: String, required: true, unique: true, trim: true, uppercase: true },
  nama_jenis: { type: String, required: true, trim: true, uppercase: true },
  tipe_kas: { type: String, enum: ['KAS_UTAMA', 'KAS_BESAR', 'KAS_KECIL'], default: 'KAS_KECIL' },
  parent_id: { type: Schema.Types.ObjectId, default: null },
  unit: { type: String, enum: ['NAGAGOLD', 'OPTIK', 'PUSAT', 'BERSAMA'], default: 'PUSAT' },
  urutan: { type: Number, default: 0 },
  aktif: { type: Boolean, default: true },
  sistem: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'dibuat_pada', updatedAt: 'diubah_pada' }, collection: collectionName('tm_jenis_kas'), versionKey: false });
cashTypeSchema.index({ aktif: 1, urutan: 1 });

// Jenis bisnis adalah dimensi yang dipilih langsung pada Master Rekening.
// Kelompok kas lama tetap dipertahankan untuk membaca histori, tetapi tidak
// lagi menjadi pilihan wajib saat membuat rekening baru.
const businessTypeSchema = new Schema({
  kode_bisnis: { type: String, required: true, trim: true, uppercase: true },
  nama_bisnis: { type: String, required: true, trim: true, uppercase: true },
  aktif: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'dibuat_pada', updatedAt: 'diubah_pada' }, collection: collectionName('tm_jenis_bisnis'), versionKey: false });
businessTypeSchema.index({ kode_bisnis: 1 }, { unique: true, name: 'uniq_jenis_bisnis_kode' });
businessTypeSchema.index({ aktif: 1, nama_bisnis: 1 });

const masterOptionSchema = new Schema({
  kode_jenis: { type: String, required: true, unique: true, trim: true, uppercase: true },
  nama_jenis: { type: String, required: true, trim: true, uppercase: true },
  urutan: { type: Number, default: 0 },
  aktif: { type: Boolean, default: true },
  sistem: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'dibuat_pada', updatedAt: 'diubah_pada' }, versionKey: false });

const requestTypeSchema = masterOptionSchema.clone();
requestTypeSchema.set('collection', collectionName('tm_jenis_request'));
requestTypeSchema.index({ aktif: 1, urutan: 1 });

const transactionTypeSchema = masterOptionSchema.clone();
transactionTypeSchema.set('collection', collectionName('tm_jenis_transaksi'));
transactionTypeSchema.index({ aktif: 1, urutan: 1 });

const branchSchema = new Schema({
  kode_toko: { type: String, required: true, unique: true, trim: true, uppercase: true },
  nama_toko: { type: String, required: true, trim: true },
  jenis_bisnis: { type: String, default: 'NAGAGOLD', trim: true, uppercase: true },
  portal: { type: String, default: '', trim: true },
  tipe_toko: { type: String, default: '', trim: true, uppercase: true },
  database_name: { type: String, required: true, trim: true },
  aktif: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tm_cabang'), versionKey: false });
branchSchema.index({ aktif: 1, kode_toko: 1 });

const openingBalanceSchema = new Schema({
  rekening_id: { type: Schema.Types.ObjectId, required: true },
  kategori_sistem: { type: String, default: 'SALDO AWAL', trim: true, uppercase: true },
  kategori_transaksi: { type: String, default: 'SALDO AWAL', trim: true, uppercase: true },
  tanggal: { type: String, required: true },
  nilai: { type: Number, required: true, min: 1 },
  keterangan: { type: String, default: '' },
  status: { type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'], default: 'PENDING_APPROVAL' },
  status_valid: { type: Boolean, default: false },
  saldo_status: { type: String, enum: Object.values(BALANCE_STATUSES), default: BALANCE_STATUSES.NOT_APPLIED },
  created_by: { type: String, default: 'system', trim: true, lowercase: true },
  approved_by: { type: String, default: '', trim: true, lowercase: true },
  approved_at: { type: Date, default: null },
  rejected_by: { type: String, default: '', trim: true, lowercase: true },
  rejected_at: { type: Date, default: null },
  rejection_reason: { type: String, default: '' },
  jurnal_id: { type: String, default: '' },
  jurnal_balik_id: { type: String, default: '' },
  applied_by: { type: String, default: '', trim: true, lowercase: true },
  applied_at: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tt_saldo_awal'), versionKey: false });
openingBalanceSchema.index({ rekening_id: 1, tanggal: -1 });
openingBalanceSchema.index({ status: 1, tanggal: -1 });

const requestSchema = new Schema({
  requestId: { type: String, required: true, trim: true },
  sourceSystem: { type: String, required: true, trim: true, lowercase: true },
  asal_permintaan: { type: String, enum: ['CABANG', 'INTERNAL'], default: 'CABANG', uppercase: true, trim: true },
  unit_pemohon: { type: String, default: '', uppercase: true, trim: true },
  nama_pemohon: { type: String, default: '', uppercase: true, trim: true },
  source_account_id: { type: Schema.Types.ObjectId, ref: 'FinanceCashAccount', default: null },
  destination_account_id: { type: Schema.Types.ObjectId, ref: 'FinanceCashAccount', default: null },
  jenisRequest: { type: String, required: true, trim: true, uppercase: true },
  kodeToko: { type: String, default: '', trim: true, uppercase: true },
  namaTokoSnapshot: { type: String, default: '', trim: true },
  sourceBranchId: { type: String, default: '' },
  noRekening: { type: String, required: true, trim: true },
  nilaiRp: { type: Number, required: true, min: 1 },
  requestedAt: { type: Date, required: true },
  tujuan: { type: String, default: '' },
  created_by: { type: String, default: '', trim: true, lowercase: true },
  status: { type: String, enum: ['REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'WAITING_TRANSFER', 'WAITING_PAYMENT_APPROVAL', 'PAYMENT_REJECTED', 'PAID', 'COMPLETED', 'CANCELLED', 'REJECTED', 'ERROR'], default: 'REQUESTED' },
  approval_status: { type: String, enum: Object.values(APPROVAL_STATUSES), default: APPROVAL_STATUSES.NOT_STARTED },
  approved_by: { type: String, default: '', trim: true, lowercase: true },
  approved_at: { type: Date, default: null },
  rejected_by: { type: String, default: '', trim: true, lowercase: true },
  rejected_at: { type: Date, default: null },
  rejection_reason: { type: String, default: '' },
  payment_status: { type: String, enum: Object.values(PAYMENT_STATUSES), default: PAYMENT_STATUSES.WAITING_TRANSFER },
  transfer_date: { type: String, default: '' },
  transfer_reference: { type: String, default: '' },
  transfer_amount: { type: Number, default: 0, min: 0 },
  transfer_proof: { type: String, default: '' },
  payment_note: { type: String, default: '' },
  finance_transaction_id: { type: String, default: '' },
  rawReference: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: collectionName('tt_request_transfer') });
requestSchema.index({ sourceSystem: 1, requestId: 1 }, { unique: true });
requestSchema.index({ kodeToko: 1, status: 1, requestedAt: -1 });

const reversalSchema = new Schema({
  reversalDate: { type: String, required: true },
  amount: { type: Number, required: true },
  sourceAccountId: { type: String, required: true },
  destinationAccountId: { type: String, required: true },
  journalId: { type: String, default: '' },
}, { _id: false });

const sourceInvoiceSchema = new Schema({
  nomorFaktur: { type: String, required: true },
  jenisFaktur: { type: String, default: '' },
  nilaiFaktur: { type: Number, default: 0 },
  isLm: { type: Boolean, default: false },
  isBerlian: { type: Boolean, default: false },
  isAcc: { type: Boolean, default: false },
}, { _id: false });

const transactionSchema = new Schema({
  transactionNumber: { type: String, required: true, unique: true },
  bentukTransaksi: { type: String, enum: ['TRANSFER_INTERNAL', 'MUTASI_REKENING'], default: 'TRANSFER_INTERNAL' },
  kategori_sistem: { type: String, enum: ['SALDO AWAL', 'MUTASI', 'TRANSAKSI'], uppercase: true, trim: true },
  requestId: { type: String, default: '' },
  transactionDate: { type: String, required: true },
  jenisTransaksi: { type: String, required: true, uppercase: true },
  jenisRequest: { type: String, required: true, uppercase: true },
  arahDana: { type: String, enum: ['KELUAR', 'MASUK'], default: 'KELUAR' },
  kodeToko: { type: String, default: '', uppercase: true },
  namaTokoSnapshot: { type: String, default: '' },
  sourceAccountId: { type: Schema.Types.ObjectId, default: null },
  destinationAccountId: { type: Schema.Types.ObjectId, default: null },
  rekeningId: { type: Schema.Types.ObjectId, default: null },
  amount: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['MENUNGGU_VALIDASI_ADMIN', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'], default: 'PENDING_APPROVAL' },
  statusValid: { type: Boolean, default: false },
  note: { type: String, default: '' },
  created_by: { type: String, default: 'system', trim: true, lowercase: true },
  approved_by: { type: String, default: '', trim: true, lowercase: true },
  approved_at: { type: Date, default: null },
  rejected_by: { type: String, default: '', trim: true, lowercase: true },
  rejected_at: { type: Date, default: null },
  rejection_reason: { type: String, default: '' },
  isImported: { type: Boolean, default: false },
  sourceSystem: { type: String, default: '' },
  sourceDatabase: { type: String, default: '' },
  sourceCollection: { type: String, default: '' },
  sourceId: { type: String, default: '' },
  sourceKey: { type: String, default: undefined },
  sourceNoReff: { type: String, default: '' },
  sourceInvoiceNumbers: { type: [String], default: [] },
  sourceInvoiceDetails: { type: [sourceInvoiceSchema], default: [] },
  sourceNoRekening: { type: String, default: '' },
  sourceKodeBank: { type: String, default: '' },
  sourceNamaBank: { type: String, default: '' },
  sourceTanggal: { type: String, default: '' },
  sourceDeskripsi: { type: String, default: '' },
  sourceKeterangan: { type: String, default: '' },
  sourceDetailTransaction: { type: Schema.Types.Mixed, default: null },
  source_amount_in: { type: Number, default: 0, min: 0 },
  source_amount_out: { type: Number, default: 0, min: 0 },
  jenisSumber: { type: String, default: '' },
  kategoriSumber: { type: String, default: '' },
  statusSumber: { type: String, default: '' },
  sourceIsValidate: { type: Boolean, default: null },
  sourceStatusReceive: { type: Boolean, default: null },
  mappingStatus: { type: String, enum: ['TERPETAKAN', 'PERLU_PEMETAAN', 'PEMETAAN_AMBIGU', 'GAGAL_MAPPING', 'VALID'], default: 'TERPETAKAN' },
  mappingReason: { type: String, default: '' },
  mappingCheckedAt: { type: Date, default: null },
  mappingRuleKey: { type: String, default: '' },
  mappingCandidateIds: { type: [String], default: [] },
  sourceDecryptionStatus: { type: String, enum: ['READABLE', 'UNREADABLE', 'KEY_NOT_CONFIGURED', 'NOT_APPLICABLE', 'UNKNOWN'], default: 'UNKNOWN' },
  sourceDecryptionNote: { type: String, default: '' },
  sourceSnapshotAt: { type: Date, default: null },
  sourceSnapshotProvenance: { type: Schema.Types.Mixed, default: null },
  sourceSnapshotFingerprint: { type: String, default: '' },
  sourceSnapshotRecoveryStatus: { type: String, enum: ['NOT_NEEDED', 'PREVIEW_MATCH', 'PREVIEW_MISMATCH', 'SOURCE_NOT_FOUND', 'PENDING_APPLY', 'APPLIED', 'ERROR', 'UNKNOWN'], default: 'UNKNOWN' },
  sourceSnapshotRecoveredAt: { type: Date, default: null },
  sourceSnapshotRecoveryNote: { type: String, default: '' },
  sourceSnapshotRecoverySourceUpdatedAt: { type: Date, default: null },
  sourceFinalityStatus: { type: String, enum: ['UNVERIFIED', 'OPEN_UNVERIFIED', 'FINALITY_UNPROVEN', 'FINAL_CONFIRMED'], default: 'UNVERIFIED' },
  sourceFinalityNote: { type: String, default: '' },
  validasiAdminOleh: { type: String, default: '' },
  validasiAdminPada: { type: Date, default: null },
  validasiAdminCatatan: { type: String, default: '' },
  source_type: { type: String, enum: Object.values(SOURCE_TYPES), default: SOURCE_TYPES.MANUAL_ADMIN },
  jenis_bisnis: { type: String, default: '', trim: true, uppercase: true },
  sync_status: { type: String, enum: Object.values(SYNC_STATUSES), default: SYNC_STATUSES.NOT_APPLICABLE },
  sync_message: { type: String, default: '' },
  approval_status: { type: String, enum: Object.values(APPROVAL_STATUSES), default: APPROVAL_STATUSES.PENDING },
  payment_status: { type: String, enum: Object.values(PAYMENT_STATUSES), default: PAYMENT_STATUSES.NOT_APPLICABLE },
  payment_date: { type: String, default: '' },
  payment_reference: { type: String, default: '' },
  payment_proof: { type: String, default: '' },
  payment_note: { type: String, default: '' },
  journal_status: { type: String, enum: Object.values(JOURNAL_STATUSES), default: JOURNAL_STATUSES.NOT_CREATED },
  saldo_status: { type: String, enum: Object.values(BALANCE_STATUSES), default: BALANCE_STATUSES.NOT_APPLIED },
  source_transaction_id: { type: String, default: '' },
  finance_transaction_id: { type: String, default: '' },
  source_database_name: { type: String, default: '' },
  source_payment_method: { type: String, default: 'BANK' },
  matched_transaction_id: { type: String, default: '' },
  matched_at: { type: Date, default: null },
  matched_by: { type: String, default: '' },
  match_method: { type: String, default: '' },
  match_reference: { type: String, default: '' },
  reconciliation_status: { type: String, enum: Object.values(RECONCILIATION_STATUSES), default: RECONCILIATION_STATUSES.NOT_APPLICABLE },
  reconciliation_note: { type: String, default: '' },
  classification_status: { type: String, enum: ['AUTO_ELIGIBLE', 'REVIEW_REQUIRED', 'RECONCILIATION_REQUIRED', 'BLOCKED'], default: 'REVIEW_REQUIRED' },
  classification_reason: { type: String, default: '' },
  classification_rule_version: { type: String, default: '' },
  classification_proposal: { type: Schema.Types.Mixed, default: null },
  classification_flags: { type: [String], default: [] },
  classified_at: { type: Date, default: null },
  classified_by: { type: String, default: '' },
  reversal: { type: reversalSchema, default: null },
}, { timestamps: true, collection: collectionName('tt_mutasi') });
transactionSchema.index({ status: 1, transactionDate: -1 });
transactionSchema.index({ kodeToko: 1, transactionDate: -1 });
transactionSchema.index({ isImported: 1, status: 1, transactionDate: -1 });
transactionSchema.index({ source_type: 1, sync_status: 1, approval_status: 1, transactionDate: -1 });
transactionSchema.index({ reconciliation_status: 1, source_type: 1, transactionDate: -1 });
transactionSchema.index({ matched_transaction_id: 1 });
transactionSchema.index({ requestId: 1, isImported: 1, transactionDate: -1 });
transactionSchema.index({ classification_status: 1, kategoriSumber: 1, transactionDate: -1 });
transactionSchema.index({ finance_transaction_id: 1 }, { unique: true, sparse: true });
transactionSchema.index({ sourceKey: 1 }, { unique: true, sparse: true });

transactionSchema.pre('validate', function setFinanceTransactionId(next) {
  if (!this.finance_transaction_id && this._id) this.finance_transaction_id = String(this._id);
  next();
});

// Satu dokumen adalah satu pencatatan keuangan untuk satu rekening. Dengan
// bentuk flat ini, laporan cukup membaca satu collection tanpa unwind detail
// atau memahami pasangan jurnal akuntansi.
const journalSchema = new Schema({
  no_keuangan: { type: String, required: true },
  no_transaksi: { type: String, default: '' },
  tanggal: { type: String, required: true },
  tipe: { type: String, enum: ['SALDO_AWAL', 'MUTASI', 'PENJUALAN', 'PEMBELIAN', 'OPERASIONAL', 'TRANSAKSI', 'PEMBALIKAN'], required: true },
  status: { type: String, enum: ['PROVISIONAL', 'POSTED', 'REVERSED'], default: 'PROVISIONAL' },
  rekening_id: { type: String, required: true },
  no_rekening: { type: String, default: '' },
  kode_bank: { type: String, default: '' },
  nama_rekening: { type: String, default: '' },
  debet: { type: Number, default: 0, min: 0 },
  kredit: { type: Number, default: 0, min: 0 },
  keterangan: { type: String, default: '' },
  created_by: { type: String, default: 'system', trim: true, lowercase: true },
  approved_by: { type: String, default: '', trim: true, lowercase: true },
  approved_at: { type: Date, default: null },
}, { timestamps: { createdAt: 'dibuat_pada', updatedAt: 'diubah_pada' }, collection: collectionName('tt_keuangan'), versionKey: false, autoIndex: false });
journalSchema.index({ no_transaksi: 1, tipe: 1 }, { name: 'idx_tt_keuangan_transaksi_tipe' });
journalSchema.index({ rekening_id: 1, tanggal: 1 }, { name: 'idx_tt_keuangan_rekening_tanggal' });
journalSchema.index({ status: 1, tanggal: 1, rekening_id: 1 }, { name: 'idx_tt_keuangan_status_tanggal_rekening' });
journalSchema.index({ no_keuangan: 1 }, { unique: true, name: 'uniq_tt_keuangan_no_keuangan' });
journalSchema.pre('validate', function validateFinanceEntry(next) {
  const debit = Number(this.debet || 0);
  const credit = Number(this.kredit || 0);
  if (!this.rekening_id || debit + credit <= 0) return next(new Error('Pencatatan keuangan harus memiliki rekening dan nominal lebih dari nol.'));
  if (debit > 0 && credit > 0) return next(new Error('Satu pencatatan keuangan hanya boleh memiliki debet atau kredit.'));
  next();
});

const approvalSchema = new Schema({
  transactionId: { type: String, required: true },
  action: { type: String, enum: ['APPROVE', 'REJECT'], required: true },
  actor: { type: String, required: true },
  reason: { type: String, default: '' },
  batchId: { type: String, default: '' },
  actedAt: { type: Date, default: Date.now },
}, { timestamps: true, collection: collectionName('th_approval') });

const sequenceSchema = new Schema({
  _id: { type: String, required: true },
  jenis: { type: String, required: true, trim: true, uppercase: true },
  tanggal: { type: String, required: true, trim: true },
  nomor_terakhir: { type: Number, default: 0, min: 0 },
}, { collection: collectionName('tm_sequence'), versionKey: false });

const auditSchema = new Schema({
  actor: { type: String, required: true },
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, default: null },
  correlationId: { type: String, default: '' },
}, { timestamps: true, collection: collectionName('th_audit') });

const notificationSchema = new Schema({
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  referenceType: { type: String, default: '' },
  referenceId: { type: String, default: '' },
  readAt: { type: Date, default: null },
}, { timestamps: true, collection: collectionName('th_notifikasi') });

const syncStateSchema = new Schema({
  sourceSystem: { type: String, required: true, lowercase: true },
  kodeToko: { type: String, required: true, uppercase: true },
  sourceCollection: { type: String, required: true },
  cursorInputDate: { type: Date, default: null },
  cursorSourceId: { type: String, default: '' },
  initialSyncCompleted: { type: Boolean, default: false },
  lastStartedAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  lastFetchedAt: { type: Date, default: null },
  lastFetchedCount: { type: Number, default: 0 },
  lastInsertedCount: { type: Number, default: 0 },
  lastUpdatedCount: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
}, { timestamps: true, collection: collectionName('th_sinkronisasi'), versionKey: false });
syncStateSchema.index({ sourceSystem: 1, kodeToko: 1, sourceCollection: 1 }, { unique: true });

const nagagoldMappingSchema = new Schema({
  source_system: { type: String, required: true, lowercase: true, default: 'nagagold' },
  kode_toko: { type: String, required: true, uppercase: true, trim: true },
  unit: { type: String, required: true, uppercase: true, default: 'NAGAGOLD' },
  metode_pembayaran: { type: String, required: true, uppercase: true },
  kode_bank: { type: String, default: '', uppercase: true, trim: true },
  nomor_rekening: { type: String, default: '', trim: true },
  jenis_akun: { type: String, required: true, enum: Object.values(ACCOUNT_KINDS) },
  rekening_id: { type: Schema.Types.ObjectId, required: true },
  aktif: { type: Boolean, default: true },
  keterangan: { type: String, default: '' },
  created_by: { type: String, default: '', trim: true, lowercase: true },
  updated_by: { type: String, default: '', trim: true, lowercase: true },
}, { timestamps: { createdAt: 'dibuat_pada', updatedAt: 'diubah_pada' }, collection: collectionName('tm_pemetaan_rekening'), versionKey: false });
nagagoldMappingSchema.index({ source_system: 1, kode_toko: 1, metode_pembayaran: 1, kode_bank: 1, nomor_rekening: 1 }, { unique: true, name: 'uniq_nagagold_mapping_context' });
nagagoldMappingSchema.index({ source_system: 1, kode_toko: 1, aktif: 1 });

// Whitelist ini sengaja dipisahkan dari pemetaan rekening. Pemetaan menjawab
// "transaksi masuk ke akun mana", sedangkan whitelist menjawab "kategori mana
// yang boleh dipertimbangkan untuk auto-posting". Semua aturan baru nonaktif.
const nagagoldAutoPostingSchema = new Schema({
  source_system: { type: String, required: true, lowercase: true, default: 'nagagold' },
  unit: { type: String, required: true, uppercase: true, default: 'NAGAGOLD' },
  kode_toko: { type: String, required: true, uppercase: true, trim: true, default: '*' },
  jenis_transaksi: { type: String, required: true, uppercase: true, trim: true },
  kategori_transaksi: { type: String, required: true, uppercase: true, trim: true },
  metode_pembayaran: { type: String, required: true, uppercase: true, trim: true },
  status_finalitas: { type: String, required: true, uppercase: true, default: 'FINAL_CONFIRMED' },
  aktif: { type: Boolean, default: false },
  approved_by: { type: String, default: '', trim: true, lowercase: true },
  approved_at: { type: Date, default: null },
  alasan_persetujuan: { type: String, default: '' },
  versi_aturan: { type: String, default: '' },
  keterangan: { type: String, default: '' },
  created_by: { type: String, default: '', trim: true, lowercase: true },
  updated_by: { type: String, default: '', trim: true, lowercase: true },
}, { timestamps: { createdAt: 'dibuat_pada', updatedAt: 'diubah_pada' }, collection: collectionName('tm_auto_posting'), versionKey: false });
nagagoldAutoPostingSchema.index({ source_system: 1, unit: 1, kode_toko: 1, jenis_transaksi: 1, kategori_transaksi: 1, metode_pembayaran: 1, status_finalitas: 1 }, { unique: true, name: 'uniq_nagagold_auto_posting_rule' });
nagagoldAutoPostingSchema.index({ source_system: 1, aktif: 1 });

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, immutable: true },
  nama_user: { type: String, required: true, trim: true },
  role: { type: String, enum: ['SUPER_USER', 'ADMIN', 'OWNER'], required: true },
  password_hash: { type: String, required: true },
  aktif: { type: Boolean, default: true },
  terakhir_login: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tm_user'), versionKey: false });

export const Account = mongoose.model('FinanceCashAccount', accountSchema);
export const Bank = mongoose.model('FinanceBank', bankSchema);
export const CashType = mongoose.model('FinanceCashType', cashTypeSchema);
export const BusinessType = mongoose.model('FinanceBusinessType', businessTypeSchema);
export const RequestType = mongoose.model('FinanceRequestType', requestTypeSchema);
export const TransactionType = mongoose.model('FinanceTransactionType', transactionTypeSchema);
export const Branch = mongoose.model('FinanceBranch', branchSchema);
export const OpeningBalance = mongoose.model('FinanceOpeningBalance', openingBalanceSchema);
export const TransferRequest = mongoose.model('FinanceTransferRequest', requestSchema);
// Data yang dibuat langsung di Finance adalah mutasi kas/rekening. Jangan
// memakai schema transaksi sinkronisasi untuk collection ini: field sumber,
// mapping, snapshot, dan klasifikasi Nagagold tidak relevan untuk mutasi
// manual. Alias virtual dipakai supaya service lama tetap dapat membaca nama
// internalnya, tetapi MongoDB hanya menyimpan bentuk data mutasi yang ringkas.
const mutationAliasPaths = Object.freeze({
  transactionNumber: 'no_mutasi',
  requestId: 'no_request',
  transactionDate: 'tanggal',
  sourceAccountId: 'rekening_asal',
  destinationAccountId: 'rekening_tujuan',
  rekeningId: 'rekening_asal',
  amount: 'nominal',
  note: 'keterangan',
  bentukTransaksi: 'bentuk_transaksi',
  jenisTransaksi: 'jenis_transaksi',
  jenisRequest: 'jenis_request',
  arahDana: 'arah_dana',
  kodeToko: 'kode_toko',
  namaTokoSnapshot: 'nama_toko_snapshot',
  statusValid: 'status_valid',
  saldoStatus: 'saldo_status',
  journalStatus: 'journal_status',
  approvalStatus: 'approval_status',
  paymentStatus: 'payment_status',
  sourcePaymentMethod: 'source_payment_method',
  createdBy: 'created_by',
  approvedBy: 'approved_by',
  approvedAt: 'approved_at',
  rejectedBy: 'rejected_by',
  rejectedAt: 'rejected_at',
  rejectionReason: 'rejection_reason',
  matchedTransactionId: 'matched_transaction_id',
});

const mutationSchema = new Schema({
  no_mutasi: { type: String, required: true, unique: true, trim: true },
  no_request: { type: String, default: '', trim: true },
  tanggal: { type: String, required: true, trim: true },
  rekening_asal: { type: Schema.Types.ObjectId, required: true },
  rekening_tujuan: { type: Schema.Types.ObjectId, required: true },
  bank_asal: { type: String, default: '', trim: true, uppercase: true },
  bank_tujuan: { type: String, default: '', trim: true, uppercase: true },
  jenis_kas_asal: { type: String, default: '', trim: true, uppercase: true },
  jenis_kas_tujuan: { type: String, default: '', trim: true, uppercase: true },
  nominal: { type: Number, required: true, min: 1 },
  keterangan: { type: String, default: '-', trim: true },
  bentuk_transaksi: { type: String, default: 'TRANSFER_INTERNAL', trim: true, uppercase: true },
  kategori_sistem: { type: String, default: 'MUTASI', trim: true, uppercase: true },
  jenis_transaksi: { type: String, default: 'MUTASI', trim: true, uppercase: true },
  jenis_request: { type: String, default: 'MUTASI_REKENING', trim: true, uppercase: true },
  arah_dana: { type: String, enum: ['KELUAR', 'MASUK'], default: 'KELUAR' },
  kode_toko: { type: String, default: '', trim: true, uppercase: true },
  nama_toko_snapshot: { type: String, default: '', trim: true },
  status: { type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'], default: 'PENDING_APPROVAL' },
  status_valid: { type: Boolean, default: false },
  created_by: { type: String, default: 'system', trim: true, lowercase: true },
  approved_by: { type: String, default: '', trim: true, lowercase: true },
  approved_at: { type: Date, default: null },
  rejected_by: { type: String, default: '', trim: true, lowercase: true },
  rejected_at: { type: Date, default: null },
  rejection_reason: { type: String, default: '', trim: true },
  source_type: { type: String, enum: Object.values(SOURCE_TYPES), default: SOURCE_TYPES.MANUAL_ADMIN },
  source_payment_method: { type: String, default: 'INTERNAL', trim: true, uppercase: true },
  approval_status: { type: String, enum: Object.values(APPROVAL_STATUSES), default: APPROVAL_STATUSES.PENDING },
  payment_status: { type: String, enum: Object.values(PAYMENT_STATUSES), default: PAYMENT_STATUSES.NOT_APPLICABLE },
  payment_date: { type: String, default: '' },
  payment_reference: { type: String, default: '' },
  payment_proof: { type: String, default: '' },
  payment_note: { type: String, default: '-' },
  journal_status: { type: String, enum: Object.values(JOURNAL_STATUSES), default: JOURNAL_STATUSES.PROVISIONAL },
  saldo_status: { type: String, enum: Object.values(BALANCE_STATUSES), default: BALANCE_STATUSES.NOT_APPLIED },
  matched_transaction_id: { type: String, default: '' },
  matched_at: { type: Date, default: null },
  matched_by: { type: String, default: '' },
  match_method: { type: String, default: '' },
  match_reference: { type: String, default: '' },
  reconciliation_note: { type: String, default: '' },
  reversal: { type: reversalSchema, default: null },
}, { timestamps: true, collection: collectionName('tt_mutasi'), versionKey: false });

Object.entries(mutationAliasPaths).forEach(([alias, path]) => {
  mutationSchema.virtual(alias).get(function getMutationAlias() { return this[path]; }).set(function setMutationAlias(value) { this[path] = value; });
});
mutationSchema.set('toObject', { virtuals: true });
mutationSchema.set('toJSON', { virtuals: true });
mutationSchema.pre('validate', function normalizeMutationDescription(next) {
  if (!String(this.keterangan || '').trim()) this.keterangan = '-';
  if (!String(this.payment_note || '').trim()) this.payment_note = '-';
  next();
});

function copyMutationAliases(value) {
  if (!value || typeof value !== 'object') return value;
  Object.entries(mutationAliasPaths).forEach(([alias, path]) => {
    if (value[alias] === undefined && value[path] !== undefined) value[alias] = value[path];
  });
  return value;
}

function translateMutationPaths(value) {
  if (Array.isArray(value)) return value.map(translateMutationPaths);
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key.startsWith('$') ? key : (mutationAliasPaths[key] || key), translateMutationPaths(nested)]));
}

mutationSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany', 'countDocuments', 'exists'], function translateMutationQuery(next) {
  this._conditions = translateMutationPaths(this._conditions);
  if (this._update) this._update = translateMutationPaths(this._update);
  if (this._fields) this._fields = translateMutationPaths(this._fields);
  next();
});
mutationSchema.post('find', (documents) => documents.forEach(copyMutationAliases));
mutationSchema.post('findOne', copyMutationAliases);
mutationSchema.post('findOneAndUpdate', copyMutationAliases);
mutationSchema.index({ status: 1, tanggal: -1 });
mutationSchema.index({ rekening_asal: 1, tanggal: -1 });
mutationSchema.index({ no_request: 1, tanggal: -1 });
mutationSchema.index({ source_type: 1, approval_status: 1, tanggal: -1 });
mutationSchema.index({ matched_transaction_id: 1 });
const syncSchema = transactionSchema.clone();
syncSchema.set('collection', collectionName('tt_sinkronisasi'));
export const FinanceMutation = mongoose.model('FinanceMutation', mutationSchema);
export const SyncTransaction = mongoose.model('FinanceSyncTransaction', syncSchema);
// Alias sementara untuk modul lama dan pengujian yang masih memakai nama
// FinanceTransaction. Dokumen baru tetap masuk ke tt_mutasi.
export const FinanceTransaction = FinanceMutation;
export const JournalEntry = mongoose.model('FinanceJournalEntry', journalSchema);
export const FinanceSequence = mongoose.model('FinanceSequence', sequenceSchema);
export const ApprovalAction = mongoose.model('FinanceApprovalAction', approvalSchema);
export const AuditLog = mongoose.model('FinanceAuditLog', auditSchema);
export const Notification = mongoose.model('FinanceNotification', notificationSchema);
export const SyncState = mongoose.model('FinanceSyncState', syncStateSchema);
export const NagagoldAccountMapping = mongoose.model('FinanceNagagoldAccountMapping', nagagoldMappingSchema);
export const NagagoldAutoPostingRule = mongoose.model('FinanceNagagoldAutoPostingRule', nagagoldAutoPostingSchema);
export const User = mongoose.model('FinanceUser', userSchema);
