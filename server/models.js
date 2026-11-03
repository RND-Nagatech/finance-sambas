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

const systemProfileSchema = new Schema({
  _id: { type: String, default: 'SYSTEM' },
  tgl_system: { type: String, required: true, trim: true },
  kode_toko: { type: String, default: 'FINANCE', trim: true, uppercase: true },
  nama_toko: { type: String, default: 'Finance Sambas', trim: true },
  no_telp: { type: String, default: '', trim: true },
  alamat: { type: String, default: '', trim: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tp_system'), versionKey: false });

const systemLogSchema = new Schema({
  type: { type: String, required: true, trim: true, uppercase: true },
  user: { type: String, required: true, trim: true, lowercase: true },
  waktu: { type: Date, required: true, default: Date.now },
  tanggal_dari: { type: String, required: true, trim: true },
  tanggal_sampai: { type: String, required: true, trim: true },
  keterangan: { type: String, default: '', trim: true },
  hasil: { type: Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('logs'), versionKey: false });
systemLogSchema.index({ type: 1, waktu: -1 }, { name: 'idx_logs_type_waktu' });

const balanceSnapshotSchema = new Schema({
  tanggal_tutup: { type: String, required: true, trim: true },
  rekening_id: { type: String, required: true, trim: true },
  saldo_akhir: { type: Number, required: true, default: 0 },
  total_debet: { type: Number, required: true, default: 0 },
  total_kredit: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['VALID', 'PERLU_HITUNG_ULANG', 'MENGHITUNG', 'GAGAL'], default: 'VALID' },
  ditutup_oleh: { type: String, default: '', trim: true, lowercase: true },
  ditutup_pada: { type: Date, default: null },
  dihitung_pada: { type: Date, default: null },
  versi: { type: Number, default: 1 },
  catatan: { type: String, default: '', trim: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tt_saldo_snapshot'), versionKey: false });
balanceSnapshotSchema.index({ rekening_id: 1, tanggal_tutup: -1 }, { name: 'idx_snapshot_rekening_tanggal' });
balanceSnapshotSchema.index({ tanggal_tutup: 1, status: 1 }, { name: 'idx_snapshot_tanggal_status' });
balanceSnapshotSchema.index({ rekening_id: 1, tanggal_tutup: 1 }, { unique: true, name: 'uniq_snapshot_rekening_tanggal' });

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
  // Saldo boleh negatif karena Finance juga mencatat transaksi sumber yang
  // keluar sebelum saldo awal atau penerimaan tercatat di sistem.
  saldo_akhir: { type: Number, default: 0 },
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
  tipe: { type: String, enum: ['SALDO_AWAL', 'PENYESUAIAN_SALDO', 'MUTASI', 'PENJUALAN', 'PEMBELIAN', 'OPERASIONAL', 'TRANSAKSI', 'PEMBALIKAN'], required: true },
  status: { type: String, enum: ['PROVISIONAL', 'POSTED', 'REVERSED'], default: 'PROVISIONAL' },
  rekening_id: { type: String, required: true },
  jenis_transaksi: { type: String, default: '', trim: true, uppercase: true },
  no_rekening: { type: String, default: '' },
  kode_bank: { type: String, default: '' },
  nama_rekening: { type: String, default: '' },
  debet: { type: Number, default: 0, min: 0 },
  kredit: { type: Number, default: 0, min: 0 },
  keterangan: { type: String, default: '' },
  // Finance hanya menyimpan nomor faktur sebagai referensi. Rincian sumber
  // tetap berada di tt_sinkronisasi.
  detail_faktur: { type: [String], default: [] },
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
}, { timestamps: true, collection: collectionName('tm_sync_state'), versionKey: false });
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
  role: { type: String, enum: ['SUPER_USER', 'ADMIN', 'OWNER', 'USER'], required: true },
  password_hash: { type: String, required: true },
  aktif: { type: Boolean, default: true },
  terakhir_login: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tm_user'), versionKey: false });

// Hak menu disimpan per level user, bukan per user. Dengan begitu perubahan
// akses berlaku konsisten untuk seluruh user pada level yang sama.
const userAccessSchema = new Schema({
  level: { type: String, enum: ['SUPER_USER', 'ADMIN', 'OWNER', 'USER'], required: true, unique: true, trim: true, uppercase: true },
  menu_ids: { type: [String], default: [] },
  versi_menu: { type: Number, default: 2 },
  updated_by: { type: String, default: '', trim: true, lowercase: true },
}, { timestamps: { createdAt: 'dibuat_pada', updatedAt: 'diubah_pada' }, collection: collectionName('tm_hak_akses'), versionKey: false });
userAccessSchema.index({ level: 1 }, { unique: true, name: 'uniq_hak_akses_level' });

export const Account = mongoose.model('FinanceCashAccount', accountSchema);
export const Bank = mongoose.model('FinanceBank', bankSchema);
export const CashType = mongoose.model('FinanceCashType', cashTypeSchema);
export const BusinessType = mongoose.model('FinanceBusinessType', businessTypeSchema);
export const RequestType = mongoose.model('FinanceRequestType', requestTypeSchema);
export const TransactionType = mongoose.model('FinanceTransactionType', transactionTypeSchema);
export const Branch = mongoose.model('FinanceBranch', branchSchema);
export const OpeningBalance = mongoose.model('FinanceOpeningBalance', openingBalanceSchema);
export const TransferRequest = mongoose.model('FinanceTransferRequest', requestSchema);
export const UserAccess = mongoose.model('FinanceUserAccess', userAccessSchema);
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
// tt_sinkronisasi menyimpan ringkasan sumber, snapshot detail transaksi
// Nagagold, dan hasil penghubungannya ke Finance. Snapshot detail sengaja
// tetap lengkap agar faktur dapat ditelusuri tanpa menyalinnya ke jurnal.
const syncSchema = new Schema({
  sumber: { type: String, default: 'NAGAGOLD', uppercase: true, trim: true },
  kode_toko: { type: String, default: '', uppercase: true, trim: true },
  nama_toko: { type: String, default: '', trim: true },
  id_sumber: { type: String, required: true, trim: true },
  referensi_sumber: { type: String, default: '', trim: true },
  tanggal: { type: String, required: true },
  kategori: { type: String, default: '', uppercase: true, trim: true },
  jenis_pembayaran: { type: String, default: '', uppercase: true, trim: true },
  no_rekening: { type: String, default: '', trim: true },
  kode_bank: { type: String, default: '', uppercase: true, trim: true },
  jumlah_in: { type: Number, default: 0, min: 0 },
  jumlah_out: { type: Number, default: 0, min: 0 },
  // Snapshot detail sumber disimpan utuh agar faktur dan rincian Nagagold
  // tetap dapat ditelusuri tanpa menyalinnya ke tt_keuangan.
  detail_transaction: { type: [Schema.Types.Mixed], default: [] },
  request_id: { type: String, default: '', trim: true, uppercase: true },
  rekening_id: { type: Schema.Types.ObjectId, default: null },
  status_sumber: { type: String, default: '', uppercase: true, trim: true },
  status: { type: String, default: 'PERLU_DIPERIKSA', uppercase: true, trim: true },
  catatan: { type: String, default: '', trim: true },
  no_keuangan: { type: String, default: '', trim: true },
  keterangan: { type: String, default: '', trim: true },
  created_by: { type: String, default: 'system', trim: true, lowercase: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, collection: collectionName('tt_sinkronisasi'), versionKey: false });

function syncDirection(document) {
  return Number(document.jumlah_in || 0) > 0 ? 'MASUK' : 'KELUAR';
}

function syncInvoiceLegacy(invoice = {}) {
  const nomorFaktur = invoice.no_faktur || invoice.no_faktur_jual || invoice.no_faktur_beli || invoice.nomorFaktur || '';
  return {
    nomorFaktur,
    jenisFaktur: invoice.jenis_faktur || '',
    nilaiFaktur: Number(invoice.nominal ?? invoice.harga_total ?? invoice.harga ?? invoice.harga_nota ?? invoice.nilaiFaktur ?? 0),
    isLm: Boolean(invoice.is_lm),
    isBerlian: Boolean(invoice.is_berlian),
    isAcc: Boolean(invoice.is_acc),
  };
}

function sourceDetailRows(document) {
  if (Array.isArray(document.detail_transaction) && document.detail_transaction.length) return document.detail_transaction;
  return [];
}

const syncVirtuals = {
  isImported: { get: () => true, set: () => {} },
  sourceSystem: { get: function get() { return String(this.sumber || '').toLowerCase(); }, set: () => {} },
  sourceDatabase: { get: () => '', set: () => {} },
  sourceDatabaseName: { get: () => '', set: () => {} },
  sourceCollection: { get: () => 'tt_cash_daily', set: () => {} },
  sourceId: { get: function get() { return this.id_sumber || ''; }, set: function set(value) { this.id_sumber = String(value || ''); } },
  sourceKey: { get: function get() { return `${String(this.sumber || 'NAGAGOLD').toLowerCase()}:${this.kode_toko || ''}:tt_cash_daily:${this.id_sumber || ''}`; }, set: () => {} },
  transactionNumber: { get: function get() { return this.referensi_sumber || this.id_sumber || ''; }, set: function set(value) { this.referensi_sumber = String(value || ''); } },
  transactionDate: { get: function get() { return this.tanggal || ''; }, set: function set(value) { this.tanggal = String(value || '').slice(0, 10); } },
  requestId: { get: function get() { return this.request_id || ''; }, set: function set(value) { this.request_id = String(value || ''); } },
  jenisTransaksi: { get: function get() { return this.kategori || 'TRANSAKSI'; }, set: () => {} },
  jenisRequest: { get: function get() { return this.kategori || 'TRANSAKSI'; }, set: () => {} },
  kategoriSumber: { get: function get() { return this.kategori || ''; }, set: function set(value) { this.kategori = String(value || ''); } },
  jenisSumber: { get: function get() { return this.jenis_pembayaran || ''; }, set: function set(value) { this.jenis_pembayaran = String(value || ''); } },
  source_payment_method: { get: function get() { return this.jenis_pembayaran || ''; }, set: function set(value) { this.jenis_pembayaran = String(value || ''); } },
  sourceNoReff: { get: function get() { return this.referensi_sumber || ''; }, set: function set(value) { this.referensi_sumber = String(value || ''); } },
  sourceTanggal: { get: function get() { return this.tanggal || ''; }, set: function set(value) { this.tanggal = String(value || '').slice(0, 10); } },
  sourceNoRekening: { get: function get() { return this.no_rekening || ''; }, set: function set(value) { this.no_rekening = String(value || ''); } },
  sourceKodeBank: { get: function get() { return this.kode_bank || ''; }, set: function set(value) { this.kode_bank = String(value || ''); } },
  sourceNamaBank: { get: () => '', set: () => {} },
  sourceAmountIn: { get: function get() { return Number(this.jumlah_in || 0); }, set: function set(value) { this.jumlah_in = Number(value || 0); } },
  sourceAmountOut: { get: function get() { return Number(this.jumlah_out || 0); }, set: function set(value) { this.jumlah_out = Number(value || 0); } },
  source_amount_in: { get: function get() { return Number(this.jumlah_in || 0); }, set: function set(value) { this.jumlah_in = Number(value || 0); } },
  source_amount_out: { get: function get() { return Number(this.jumlah_out || 0); }, set: function set(value) { this.jumlah_out = Number(value || 0); } },
  sourceInvoiceDetails: { get: function get() { return sourceDetailRows(this).map(syncInvoiceLegacy).filter((invoice) => invoice.nomorFaktur); }, set: function set(value) { this.detail_transaction = Array.isArray(value) ? value : []; } },
  sourceInvoiceNumbers: { get: function get() { return sourceDetailRows(this).map((invoice) => syncInvoiceLegacy(invoice).nomorFaktur).filter(Boolean); }, set: () => {} },
  sourceDetailTransaction: { get: function get() { return sourceDetailRows(this); }, set: function set(value) { this.detail_transaction = Array.isArray(value) ? value : []; } },
  sourceKeterangan: { get: function get() { return this.keterangan || ''; }, set: function set(value) { this.keterangan = String(value || ''); } },
  sourceDeskripsi: { get: function get() { return this.keterangan || ''; }, set: function set(value) { this.keterangan = String(value || ''); } },
  note: { get: function get() { return this.keterangan || ''; }, set: function set(value) { this.keterangan = String(value || ''); } },
  statusSumber: { get: function get() { return this.status_sumber || ''; }, set: function set(value) { this.status_sumber = String(value || ''); } },
  kodeToko: { get: function get() { return this.kode_toko || ''; }, set: function set(value) { this.kode_toko = String(value || ''); } },
  namaTokoSnapshot: { get: function get() { return this.nama_toko || ''; }, set: function set(value) { this.nama_toko = String(value || ''); } },
  rekeningId: { get: function get() { return this.rekening_id; }, set: function set(value) { this.rekening_id = value || null; } },
  amount: { get: function get() { return Math.max(Number(this.jumlah_in || 0), Number(this.jumlah_out || 0)); }, set: function set(value) { this.jumlah_out = Number(value || 0); } },
  arahDana: { get: function get() { return syncDirection(this); }, set: function set(value) { if (String(value || '').toUpperCase() === 'MASUK') this.jumlah_in = this.amount; else this.jumlah_out = this.amount; } },
  mappingStatus: { get: function get() { return this.rekening_id ? 'TERPETAKAN' : 'PERLU_PEMETAAN'; }, set: () => {} },
  mappingReason: { get: function get() { return this.catatan || ''; }, set: function set(value) { this.catatan = String(value || ''); } },
  sync_status: { get: function get() { return this.status === 'TERHUBUNG' ? SYNC_STATUSES.RECONCILED : this.status === 'TERCATAT' ? SYNC_STATUSES.RECORDED : this.status === 'GAGAL' ? SYNC_STATUSES.FAILED : SYNC_STATUSES.NEEDS_REVIEW; }, set: function set(value) { this.status = value === SYNC_STATUSES.RECORDED ? 'TERCATAT' : value === SYNC_STATUSES.RECONCILED ? 'TERHUBUNG' : value === SYNC_STATUSES.FAILED ? 'GAGAL' : 'PERLU_DIPERIKSA'; } },
  sync_message: { get: function get() { return this.catatan || ''; }, set: function set(value) { this.catatan = String(value || ''); } },
  source_type: { get: () => SOURCE_TYPES.SYNC, set: () => {} },
  jenis_bisnis: { get: () => 'NAGAGOLD', set: () => {} },
  statusValid: { get: function get() { return ['TERCATAT', 'TERHUBUNG'].includes(this.status); }, set: () => {} },
  approval_status: { get: () => APPROVAL_STATUSES.NOT_REQUIRED, set: () => {} },
  payment_status: { get: () => PAYMENT_STATUSES.NOT_APPLICABLE, set: () => {} },
  journal_status: { get: function get() { return this.status === 'TERCATAT' || this.status === 'TERHUBUNG' ? JOURNAL_STATUSES.POSTED : JOURNAL_STATUSES.NOT_CREATED; }, set: function set(value) { if (value === JOURNAL_STATUSES.POSTED) this.status = 'TERCATAT'; } },
  saldo_status: { get: function get() { return this.status === 'TERCATAT' || this.status === 'TERHUBUNG' ? BALANCE_STATUSES.APPLIED : BALANCE_STATUSES.NOT_APPLIED; }, set: function set(value) { if (value === BALANCE_STATUSES.APPLIED) this.status = 'TERCATAT'; } },
  source_transaction_id: { get: function get() { return this.id_sumber || ''; }, set: function set(value) { this.id_sumber = String(value || ''); } },
  finance_transaction_id: { get: function get() { return this.no_keuangan || ''; }, set: function set(value) { if (String(value || '').startsWith('KU-')) this.no_keuangan = String(value); } },
  reconciliation_status: { get: function get() { return this.request_id ? (this.no_keuangan ? RECONCILIATION_STATUSES.MATCHED : RECONCILIATION_STATUSES.UNMATCHED) : RECONCILIATION_STATUSES.NOT_APPLICABLE; }, set: () => {} },
  reconciliation_note: { get: function get() { return this.catatan || ''; }, set: function set(value) { this.catatan = String(value || ''); } },
  matched_transaction_id: { get: () => '', set: () => {} },
  classification_status: { get: function get() { return this.rekening_id ? 'AUTO_ELIGIBLE' : 'BLOCKED'; }, set: () => {} },
  classification_reason: { get: function get() { return this.catatan || ''; }, set: function set(value) { this.catatan = String(value || ''); } },
  classificationStatus: { get: function get() { return this.rekening_id ? 'AUTO_ELIGIBLE' : 'BLOCKED'; }, set: () => {} },
  classificationReason: { get: function get() { return this.catatan || ''; }, set: function set(value) { this.catatan = String(value || ''); } },
  sourceFinalityStatus: { get: function get() { return this.status_sumber === 'OPEN' ? 'FINAL_CONFIRMED' : 'FINALITY_UNPROVEN'; }, set: () => {} },
  sourceFinalityNote: { get: () => '', set: () => {} },
  sourceSnapshotAt: { get: function get() { return this.created_at || null; }, set: () => {} },
  sourceSnapshotProvenance: { get: () => null, set: () => {} },
  sourceSnapshotFingerprint: { get: () => '', set: () => {} },
  sourceSnapshotRecoveryStatus: { get: () => 'NOT_NEEDED', set: () => {} },
  sourceDecryptionStatus: { get: () => 'NOT_APPLICABLE', set: () => {} },
  sourceDecryptionNote: { get: () => '', set: () => {} },
  classification_proposal: { get: () => null, set: () => {} },
  classificationRuleVersion: { get: () => '', set: () => {} },
  mappingCandidateIds: { get: () => [], set: () => {} },
  mappingRuleKey: { get: () => '', set: () => {} },
};

Object.entries(syncVirtuals).forEach(([name, handlers]) => syncSchema.virtual(name).get(handlers.get).set(handlers.set));

function syncAliasValue(document, name, value) {
  if (document[name] === undefined) document[name] = value;
}

function copySyncAliases(document) {
  if (!document) return document;
  const raw = document.toObject ? document.toObject() : document;
  Object.entries(syncVirtuals).forEach(([name, handlers]) => {
    try { syncAliasValue(document, name, handlers.get.call(raw)); } catch { /* field is display-only */ }
  });
  return document;
}

function translateSyncPaths(value) {
  if (Array.isArray(value)) return value.map(translateSyncPaths);
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  const aliases = { isImported: 'sumber', kodeToko: 'kode_toko', namaTokoSnapshot: 'nama_toko', sourceId: 'id_sumber', source_transaction_id: 'id_sumber', sourceNoReff: 'referensi_sumber', transactionNumber: 'referensi_sumber', transactionDate: 'tanggal', requestId: 'request_id', kategoriSumber: 'kategori', kategori_sumber: 'kategori', jenisSumber: 'jenis_pembayaran', source_payment_method: 'jenis_pembayaran', sourceNoRekening: 'no_rekening', sourceKodeBank: 'kode_bank', source_amount_in: 'jumlah_in', source_amount_out: 'jumlah_out', sourceDetailTransaction: 'detail_transaction', statusSumber: 'status_sumber', rekeningId: 'rekening_id', mappingReason: 'catatan', sync_message: 'catatan', note: 'keterangan', sourceKeterangan: 'keterangan', sourceDeskripsi: 'keterangan' };
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    if (key === 'isImported') return ['sumber', 'NAGAGOLD'];
    if (key === 'source_type' || key === 'sourceSystem' || key === 'jenis_bisnis' || key === 'jenisBisnis') return ['sumber', 'NAGAGOLD'];
    if (key === 'sourceKey' && typeof nested === 'string') {
      const parts = nested.split(':');
      return parts.length >= 4 ? ['$and', [{ sumber: 'NAGAGOLD' }, { kode_toko: parts[1] }, { id_sumber: parts.slice(3).join(':') }]] : [key, nested];
    }
    if (key === 'status') {
      const statusMap = { APPROVED: 'TERCATAT', REJECTED: 'GAGAL', MENUNGGU_VALIDASI_ADMIN: 'PERLU_DIPERIKSA', PENDING_APPROVAL: 'PERLU_DIPERIKSA' };
      return [key, typeof nested === 'string' ? (statusMap[nested] || nested) : translateSyncPaths(nested)];
    }
    if (key === 'sync_status') {
      const statusMap = { [SYNC_STATUSES.RECORDED]: 'TERCATAT', [SYNC_STATUSES.RECONCILED]: 'TERHUBUNG', [SYNC_STATUSES.FAILED]: 'GAGAL', [SYNC_STATUSES.MAPPING_FAILED]: 'MENUNGGU_PEMETAAN', [SYNC_STATUSES.NEEDS_REVIEW]: 'PERLU_DIPERIKSA', PERLU_REVIEW: 'PERLU_DIPERIKSA' };
      return ['status', statusMap[nested] || 'PERLU_DIPERIKSA'];
    }
    if (key === 'reconciliation_status') {
      const statusMap = { [RECONCILIATION_STATUSES.MATCHED]: 'TERHUBUNG', [RECONCILIATION_STATUSES.UNMATCHED]: 'MENUNGGU_REQUEST', [RECONCILIATION_STATUSES.MATCH_CANDIDATE]: 'MENUNGGU_REQUEST', [RECONCILIATION_STATUSES.CONFLICT]: 'PERLU_DIPERIKSA', [RECONCILIATION_STATUSES.NOT_APPLICABLE]: 'PERLU_DIPERIKSA' };
      if (typeof nested === 'string') return ['status', statusMap[nested] || 'PERLU_DIPERIKSA'];
      if (nested?.$in) return ['status', { $in: nested.$in.map((value) => statusMap[value]).filter(Boolean) }];
      if (nested?.$ne) return ['status', { $ne: statusMap[nested.$ne] || nested.$ne }];
      return ['status', translateSyncPaths(nested)];
    }
    if (key === 'journal_status') {
      if (typeof nested === 'string') return ['status', nested === JOURNAL_STATUSES.POSTED ? 'TERCATAT' : nested === JOURNAL_STATUSES.REVERSED ? 'GAGAL' : 'PERLU_DIPERIKSA'];
      if (nested?.$ne === JOURNAL_STATUSES.POSTED) return ['status', { $ne: 'TERCATAT' }];
      if (nested?.$nin) return ['status', { $nin: nested.$nin.map((value) => value === JOURNAL_STATUSES.POSTED ? 'TERCATAT' : value === JOURNAL_STATUSES.REVERSED ? 'GAGAL' : 'PERLU_DIPERIKSA') }];
      if (nested?.$in) return ['status', { $in: nested.$in.map((value) => value === JOURNAL_STATUSES.POSTED ? 'TERCATAT' : value === JOURNAL_STATUSES.REVERSED ? 'GAGAL' : 'PERLU_DIPERIKSA') }];
    }
    if (key === 'saldo_status') {
      if (typeof nested === 'string' && nested === BALANCE_STATUSES.APPLIED) return ['status', 'TERCATAT'];
      if (nested?.$ne === BALANCE_STATUSES.APPLIED) return ['status', { $ne: 'TERCATAT' }];
    }
    if (key === 'mappingStatus') {
      if (nested === 'TERPETAKAN') return ['rekening_id', { $exists: true, $ne: null }];
      if (['PERLU_PEMETAAN', 'PEMETAAN_AMBIGU', 'GAGAL_MAPPING'].includes(nested)) return ['rekening_id', null];
      // `rekening_id` adalah ObjectId pada schema baru. String kosong tidak
      // boleh dimasukkan ke `$in` karena Mongoose akan gagal melakukan cast.
      if (nested?.$in) return ['rekening_id', { $in: [null] }];
    }
    if (['classification_status', 'classification_reason', 'classification_rule_version', 'classification_proposal', 'classification_flags', 'classified_at', 'classified_by', 'matched_transaction_id', 'matched_at', 'matched_by', 'match_method', 'match_reference', 'reconciliation_note', 'sourceDatabase', 'source_database_name', 'sourceCollection', 'sourceNamaBank', 'sourceDecryptionStatus', 'sourceDecryptionNote', 'sourceSnapshotAt', 'sourceSnapshotProvenance', 'sourceSnapshotFingerprint', 'sourceSnapshotRecoveryStatus', 'sourceFinalityStatus', 'sourceFinalityNote', 'sourceIsValidate', 'sourceStatusReceive', 'mappingStatus', 'mappingCheckedAt', 'mappingRuleKey', 'mappingCandidateIds', 'approval_status', 'payment_status', 'finance_transaction_id'].includes(key)) return [key, undefined];
    const target = aliases[key] || key;
    if (target === 'detail_transaction' && Array.isArray(nested)) return [target, nested];
    if (target === 'sumber' && key === 'isImported') return [target, 'NAGAGOLD'];
    return [target, translateSyncPaths(nested)];
  }));
}

function translateSyncSort(value) {
  if (!value || typeof value !== 'object') return value;
  const aliases = { transactionDate: 'tanggal', createdAt: 'created_at', updatedAt: 'updated_at', kodeToko: 'kode_toko', rekeningId: 'rekening_id' };
  return Object.fromEntries(Object.entries(value).map(([key, direction]) => [aliases[key] || key, direction]));
}

syncSchema.pre(['find', 'findOne', 'findOneAndUpdate', 'updateOne', 'updateMany', 'countDocuments', 'exists'], function translateSyncQuery(next) {
  this._conditions = translateSyncPaths(this._conditions);
  if (this._update) this._update = translateSyncPaths(this._update);
  if (this._fields) this._fields = translateSyncPaths(this._fields);
  if (this.options?.sort) this.options.sort = translateSyncSort(this.options.sort);
  next();
});
syncSchema.post('find', (documents) => documents.forEach(copySyncAliases));
syncSchema.post('findOne', copySyncAliases);
syncSchema.post('findOneAndUpdate', copySyncAliases);
syncSchema.set('toObject', { virtuals: true });
syncSchema.set('toJSON', { virtuals: true });
syncSchema.index({ sumber: 1, kode_toko: 1, id_sumber: 1 }, { unique: true, name: 'uniq_tt_sinkronisasi_sumber' });
syncSchema.index({ tanggal: -1, kode_toko: 1 });
syncSchema.index({ status: 1, tanggal: -1 });
syncSchema.index({ rekening_id: 1, tanggal: -1 });
export const FinanceMutation = mongoose.model('FinanceMutation', mutationSchema);
export const SyncTransaction = mongoose.model('FinanceSyncTransaction', syncSchema);
export const SystemProfile = mongoose.model('FinanceSystemProfile', systemProfileSchema);
export const SystemLog = mongoose.model('FinanceSystemLog', systemLogSchema);
export const BalanceSnapshot = mongoose.model('FinanceBalanceSnapshot', balanceSnapshotSchema);
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
