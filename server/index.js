import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  Account,
  ACCOUNT_KINDS,
  ApprovalAction,
  AuditLog,
  Bank,
  BalanceSnapshot,
  Branch,
  BusinessType,
  CashType,
  FinanceSequence,
  FinanceMutation,
  JournalEntry,
  NagagoldAccountMapping,
  NagagoldAutoPostingRule,
  Notification,
  OpeningBalance,
  RequestType,
  SyncState,
  SyncTransaction,
  SystemLog,
  SystemProfile,
  TransactionType,
  TransferRequest,
  User,
  UserAccess,
} from './models.js';
import { hashPassword, publicUser, verifyPassword } from './auth.js';
import { USER_LEVELS, defaultMenuIds, menuGroupsPayload, normalizeMenuIds } from './access-control.js';
import {
  APPROVAL_STATUSES,
  BALANCE_STATUSES,
  JOURNAL_STATUSES,
  PAYMENT_STATUSES,
  SOURCE_TYPES,
  SYNC_STATUSES,
  approvalStatusLabel,
  inferApprovalStatus,
  inferJournalStatus,
  inferPaymentStatus,
  inferSourceType,
  inferSyncStatus,
  journalStatusLabel,
  sourceTypeLabel,
  syncStatusLabel,
} from './transaction-status.js';
import {
  MATCH_METHODS,
  RECONCILIATION_STATUSES,
  candidateEvidence,
  candidateIsUseful,
  isCashPayment,
  isNagagoldInternalTransfer,
  normalizeNagagoldValue,
  reconciliationApplicable,
  sourcePaymentMethod,
} from './reconciliation.js';
import { computeSyncWindowStart } from './sync-window.js';
import {
  NAGAGOLD_CLASSIFICATION_RULE_VERSION,
  NAGAGOLD_CLASSIFICATION_STATUSES,
  classifyNagagoldTransaction,
  isNagagoldOpeningBalance,
  nagagoldClassificationLabel,
} from './nagagold-classifier.js';
import {
  normalizeReportFilters,
  reportBalances,
  reportDashboard,
  reportExportLimit,
  reportFinancial,
  reportIntegrated,
  reportNagagoldAccounts,
  reportNagagoldCash,
  reportNagagoldSource,
  reportJournals,
  reportMutations,
  reportReconciliation,
  reportRequests,
  reportRowsForExport,
  reportTransactions,
} from './reporting.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
const allowedOrigins = corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
const authEnabled = String(process.env.AUTH_ENABLED ?? 'true').toLowerCase() !== 'false';
const sessionTtlMs = Math.max(1, Number(process.env.AUTH_SESSION_TTL_HOURS || 12)) * 60 * 60 * 1000;
const sessions = new Map();

app.use(cors({ origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins }));
app.use(express.json({ type: ['application/json', 'application/*+json', 'text/plain'], limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    Object.assign(this, details);
  }
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const now = () => new Date();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const id = (value) => value ? value.toString() : '';
const SYSTEM_PROFILE_ID = 'SYSTEM';
const SNAPSHOT_JOURNAL_STATUSES = ['PROVISIONAL', 'POSTED', 'REVERSED'];
// Audit fields menyimpan username yang stabil, bukan nama tampilan user.
// Proses sinkronisasi tanpa sesi memakai username sistem.
const actor = (req) => String(req.user?.username || req.header('x-actor-username') || 'system').trim().toLowerCase();
const createNumber = (prefixValue) => `${prefixValue}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
async function nextFinanceNumber(tanggal, session) {
  return nextSequentialNumber('KU', tanggal, session);
}
async function nextSequentialNumber(prefix, tanggal, session) {
  const date = String(tanggal || today()).slice(0, 10).replaceAll('-', '');
  const key = `${prefix}-${date}`;
  const options = { new: true, upsert: true, setDefaultsOnInsert: true };
  if (session) options.session = session;
  const sequence = await FinanceSequence.findOneAndUpdate({ _id: key }, { $inc: { nomor_terakhir: 1 }, $setOnInsert: { jenis: prefix, tanggal: date } }, options);
  return `${key}-${String(sequence.nomor_terakhir).padStart(4, '0')}`;
}
const nextMutationNumber = (tanggal, session) => nextSequentialNumber('MTS', tanggal, session);
const nextSyncNumber = (tanggal, session) => nextSequentialNumber('SYN', tanggal, session);
const nextRequestNumber = (tanggal, session) => nextSequentialNumber('RQS', tanggal, session);
const nextManualTransactionNumber = (tanggal, session) => nextSequentialNumber('TRX', tanggal, session);
const mask = (value) => value ? `${'•'.repeat(Math.max(0, String(value).length - 4))}${String(value).slice(-4)}` : '';
const NAGAGOLD_COLLECTION = 'tt_cash_daily';
const SOURCE_CONFIGS = Object.freeze({
  NAGAGOLD: Object.freeze({ code: 'NAGAGOLD', key: 'nagagold', collection: NAGAGOLD_COLLECTION, uriEnv: 'NAGAGOLD_MONGODB_URI', keyEnv: 'NAGAGOLD_DECRYPTION_KEY', modeEnv: 'NAGAGOLD_ENCRYPTION_MODE', limitEnv: 'NAGAGOLD_SYNC_LIMIT' }),
  OPTIK: Object.freeze({ code: 'OPTIK', key: 'optik', collection: NAGAGOLD_COLLECTION, uriEnv: 'OPTIK_MONGODB_URI', keyEnv: 'OPTIK_DECRYPTION_KEY', modeEnv: 'OPTIK_ENCRYPTION_MODE', limitEnv: 'OPTIK_SYNC_LIMIT' }),
});
const NAGAGOLD_AUTO_POSTING_ENABLED = String(process.env.NAGAGOLD_AUTO_POSTING_ENABLED || 'false').toLowerCase() === 'true';
// Transaksi sumber Nagagold sudah divalidasi di toko. Jika mapping rekening
// Finance unik, transaksi boleh langsung dibukukan tanpa validasi kedua oleh
// Admin Finance. Tetap dapat dimatikan untuk emergency melalui env.
const NAGAGOLD_SOURCE_POSTING_ENABLED = String(process.env.NAGAGOLD_SOURCE_POSTING_ENABLED ?? 'true').toLowerCase() === 'true';
// Migrasi dari struktur prototype lama hanya dijalankan bila diminta eksplisit.
// Jika tidak, data lama di tm_akun tidak boleh menghidupkan kembali tm_rekening.
const LEGACY_MASTER_MIGRATION_ENABLED = String(process.env.LEGACY_MASTER_MIGRATION_ENABLED || 'false').toLowerCase() === 'true';
const SNAPSHOT_RECOVERY_CONFIRMATION = 'APPLY_NAGAGOLD_SNAPSHOT_RECOVERY';
let nagagoldSyncRunning = false;

function sourceConfigForBranch(branch = {}) {
  const code = String(branch.jenisBisnis || branch.jenis_bisnis || branch.unit || 'NAGAGOLD').trim().toUpperCase();
  return SOURCE_CONFIGS[code] || SOURCE_CONFIGS.NAGAGOLD;
}

function sourceConfigForTransaction(transaction = {}) {
  const code = String(transaction.sumber || transaction.jenis_bisnis || transaction.jenisBisnis || transaction.sourceSystem || 'NAGAGOLD').trim().toUpperCase();
  return SOURCE_CONFIGS[code] || SOURCE_CONFIGS.NAGAGOLD;
}

function normalizeSourceBusiness(value, fallback = 'NAGAGOLD') {
  const normalized = String(value || '').trim().toUpperCase();
  return SOURCE_CONFIGS[normalized] ? normalized : fallback;
}

function branchBusinessQuery(jenisBisnis) {
  const source = normalizeSourceBusiness(jenisBisnis);
  // Data cabang lama yang belum memiliki jenis bisnis diperlakukan sebagai
  // Nagagold agar tetap dapat dibaca tanpa membuat identitas Optik ambigu.
  return source === 'NAGAGOLD'
    ? { $or: [{ jenis_bisnis: 'NAGAGOLD' }, { jenis_bisnis: { $exists: false } }, { jenis_bisnis: '' }] }
    : { jenis_bisnis: source };
}

function branchIdentityQuery({ kodeToko = '', jenisBisnis = '', databaseName = '' } = {}) {
  const query = { ...branchBusinessQuery(jenisBisnis), kode_toko: String(kodeToko || '').trim().toUpperCase() };
  if (databaseName) query.database_name = String(databaseName).trim();
  return query;
}

function journalSourceForTransaction(transaction = {}) {
  const explicit = String(transaction.sumber || '').trim().toUpperCase();
  if (['FINANCE', 'NAGAGOLD', 'OPTIK'].includes(explicit)) return explicit;
  const sourceType = String(transaction.source_type || transaction.sourceType || '').trim().toUpperCase();
  if (transaction.isImported || sourceType === 'SYNC' || sourceType === 'SYNC_NAGAGOLD' || sourceType === 'SYNC_OPTIK') return sourceConfigForTransaction(transaction).code;
  return 'FINANCE';
}

function systemProfilePayload(raw = {}) {
  return {
    id: id(raw._id) || SYSTEM_PROFILE_ID,
    tglSystem: String(raw.tgl_system || today()).slice(0, 10),
    kodeToko: String(raw.kode_toko || 'FINANCE').trim().toUpperCase(),
    namaToko: String(raw.nama_toko || 'Finance Sambas').trim(),
    noTelp: String(raw.no_telp || '').trim(),
    alamat: String(raw.alamat || '').trim(),
  };
}

async function ensureSystemProfile() {
  return SystemProfile.findOneAndUpdate(
    { _id: SYSTEM_PROFILE_ID },
    { $setOnInsert: { _id: SYSTEM_PROFILE_ID, tgl_system: today(), kode_toko: 'FINANCE', nama_toko: 'Finance Sambas', no_telp: '', alamat: '' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

// Tanggal bisnis Finance berasal dari profil sistem. Tanggal server hanya
// dipakai untuk timestamp teknis dan memvalidasi agar tanggal bisnis tidak
// berjalan melewati hari nyata.
async function currentBusinessDate(session = null) {
  const query = SystemProfile.findOne({ _id: SYSTEM_PROFILE_ID });
  if (session) query.session(session);
  const profile = await query.lean();
  return normalizeBusinessDate(profile?.tgl_system, today());
}

async function periodStatusPayload() {
  const profile = await ensureSystemProfile();
  const actualDate = today();
  const systemDate = normalizeBusinessDate(profile.tgl_system, actualDate);
  const lastClose = await SystemLog.findOne({ type: 'TUTUP_PERIODE' }).sort({ tanggal_sampai: -1, waktu: -1 }).lean();
  const requiresClose = systemDate < actualDate;
  return {
    systemDate,
    actualDate,
    closeDate: systemDate,
    nextDate: addBusinessDate(systemDate),
    lastClosedDate: String(lastClose?.tanggal_sampai || ''),
    requiresClose,
    lockedViews: ['requests', 'mutations', 'manual-transactions', 'nagagold-transactions'],
  };
}

function syncStateNeedsAttention(state = {}) {
  const lastStartedAt = state.lastStartedAt ? new Date(state.lastStartedAt).getTime() : 0;
  const lastSuccessAt = state.lastSuccessAt ? new Date(state.lastSuccessAt).getTime() : 0;
  return Boolean(
    state.lastError
    || (lastStartedAt && (!lastSuccessAt || lastStartedAt > lastSuccessAt)),
  );
}

async function periodIntegrationStatus() {
  const states = await SyncState.find({
    sourceSystem: { $in: ['nagagold', 'optik'] },
    sourceCollection: NAGAGOLD_COLLECTION,
  }).sort({ sourceSystem: 1, kodeToko: 1 }).lean();
  const pendingStates = states.filter(syncStateNeedsAttention).map((state) => ({
    sourceSystem: String(state.sourceSystem || '').toUpperCase(),
    kodeToko: String(state.kodeToko || ''),
    sourceDatabase: String(state.sourceDatabase || ''),
    lastError: String(state.lastError || ''),
    lastStartedAt: state.lastStartedAt || null,
    lastSuccessAt: state.lastSuccessAt || null,
  }));
  return {
    running: nagagoldSyncRunning,
    hasUnfinished: nagagoldSyncRunning || pendingStates.length > 0,
    pendingStates,
  };
}

async function assertPeriodOpen() {
  const status = await periodStatusPayload();
  if (status.requiresClose) {
    throw new HttpError(423, `Periode ${status.closeDate} belum ditutup. Tutup periode terlebih dahulu sebelum mencatat transaksi baru.`);
  }
  return status;
}

function normalizeBusinessDate(value, fallback = today()) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}

function addBusinessDate(date, days = 1) {
  const value = new Date(`${normalizeBusinessDate(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function systemLogPayload(raw = {}) {
  return {
    id: id(raw._id),
    type: raw.type || '',
    user: raw.user || '',
    waktu: raw.waktu || raw.created_at || null,
    tanggalDari: raw.tanggal_dari || '',
    tanggalSampai: raw.tanggal_sampai || '',
    keterangan: raw.keterangan || '',
    hasil: raw.hasil || null,
  };
}

async function markBalanceSnapshotsStale(rekeningIds = [], tanggal, session = null) {
  const ids = [...new Set(rekeningIds.map((value) => id(value)).filter((value) => mongoose.isValidObjectId(value)))];
  if (!ids.length) return 0;
  const options = session ? { session } : {};
  const result = await BalanceSnapshot.updateMany(
    { rekening_id: { $in: ids }, tanggal_tutup: { $gte: normalizeBusinessDate(tanggal) }, status: { $in: ['VALID', 'MENGHITUNG'] } },
    { $set: { status: 'PERLU_HITUNG_ULANG', catatan: 'Ada pencatatan dengan tanggal bisnis yang memengaruhi periode ini.' } },
    options,
  );
  return result.modifiedCount || 0;
}

async function recalculateBalanceSnapshots(tanggal, rekeningIds = [], actorName = 'system', session = null) {
  const date = normalizeBusinessDate(tanggal);
  const requestedIds = [...new Set(rekeningIds.map((value) => id(value)).filter((value) => mongoose.isValidObjectId(value)))];
  const accounts = requestedIds.length
    ? requestedIds
    : (await Account.find({ aktif: { $ne: false } }).select('_id').lean()).map((account) => id(account._id));
  if (!accounts.length) return { tanggalTutup: date, rekening: 0, status: 'VALID' };
  const aggregateQuery = JournalEntry.aggregate([
    { $match: { rekening_id: { $in: accounts }, status: { $in: SNAPSHOT_JOURNAL_STATUSES }, tanggal: { $lte: date } } },
    { $group: { _id: '$rekening_id', totalDebet: { $sum: '$debet' }, totalKredit: { $sum: '$kredit' } } },
  ]);
  if (session) aggregateQuery.session(session);
  const aggregate = await aggregateQuery;
  const totals = new Map(aggregate.map((row) => [String(row._id), { debet: Number(row.totalDebet || 0), kredit: Number(row.totalKredit || 0) }]));
  const operations = accounts.map((rekeningId) => {
    const total = totals.get(rekeningId) || { debet: 0, kredit: 0 };
    return {
      updateOne: {
        filter: { rekening_id: rekeningId, tanggal_tutup: date },
        update: {
          $set: {
            saldo_akhir: total.debet - total.kredit,
            total_debet: total.debet,
            total_kredit: total.kredit,
            status: 'VALID',
            ditutup_oleh: actorName,
            ditutup_pada: now(),
            dihitung_pada: now(),
            catatan: '',
          },
          $setOnInsert: { rekening_id: rekeningId, tanggal_tutup: date, versi: 0 },
          $inc: { versi: 1 },
        },
        upsert: true,
      },
    };
  });
  await BalanceSnapshot.bulkWrite(operations, { ordered: false, ...(session ? { session } : {}) });
  return { tanggalTutup: date, rekening: accounts.length, status: 'VALID' };
}

function bearerToken(req) {
  const header = String(req.header('authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function authMiddleware(req, res, next) {
  if (!authEnabled || req.path === '/api/health' || req.path === '/api/auth/login') return next();
  const token = bearerToken(req);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ message: 'Sesi login tidak ditemukan atau sudah berakhir.' });
  }
  req.user = session.user;
  req.authToken = token;
  return next();
}

app.use(authMiddleware);

function requireRole(...roles) {
  return (req, res, next) => {
    // USER adalah level baca. Hak menu tetap disaring di frontend, sedangkan
    // endpoint GET boleh dibaca agar user dapat melihat laporan dan master
    // yang memang diberikan melalui pengaturan menu.
    if (!authEnabled || roles.includes(req.user?.role) || (req.method === 'GET' && req.user?.role === 'USER')) return next();
    return res.status(403).json({ message: 'Role pengguna tidak memiliki akses untuk aksi ini.' });
  };
}

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  if (!authEnabled) return res.json({ token: '', user: { username: 'system', name: 'Super User Finance', role: 'SUPER_USER' } });
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = await User.findOne({ username: username.toLowerCase(), aktif: true });
  if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Username atau password salah.');
  const token = crypto.randomBytes(32).toString('hex');
  const userData = publicUser(user);
  sessions.set(token, { user: userData, expiresAt: Date.now() + sessionTtlMs });
  await User.updateOne({ _id: user._id }, { $set: { terakhir_login: now() } });
  return res.json({ token, user: userData, expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  if (!authEnabled) return res.json({ user: { username: 'system', name: 'Super User Finance', role: 'SUPER_USER' } });
  return res.json({ user: req.user });
}));

app.get('/api/users', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const users = await User.find({}).sort({ username: 1 }).lean();
  return res.json(users.map(publicUser));
}));

app.post('/api/users', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const name = String(req.body?.nama_user ?? req.body?.name ?? '').trim();
  const role = String(req.body?.role || '').trim().toUpperCase();
  const password = String(req.body?.password || '');
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username)) throw new HttpError(422, 'Username harus 3-50 karakter dan hanya boleh berisi huruf kecil, angka, titik, garis bawah, atau tanda hubung.');
  if (!name) throw new HttpError(422, 'Nama lengkap wajib diisi.');
  if (!USER_LEVELS.some((item) => item.code === role)) throw new HttpError(422, 'Level user tidak valid.');
  if (role === 'SUPER_USER') throw new HttpError(403, 'Level Super User hanya dapat dibuat melalui seed script.');
  if (password.length < 8) throw new HttpError(422, 'Password minimal 8 karakter.');
  if (await User.exists({ username })) throw new HttpError(409, 'Username sudah digunakan.');
  const created = await User.create({ username, nama_user: name, role, password_hash: hashPassword(password), aktif: true });
  return res.status(201).json(publicUser(created));
}));

app.patch('/api/users/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(422, 'ID user tidak valid.');
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'username')) throw new HttpError(422, 'Username tidak dapat diubah.');
  const update = {};
  const name = req.body?.nama_user ?? req.body?.name;
  const password = req.body?.password;
  const role = req.body?.role;
  if (name !== undefined) {
    const normalizedName = String(name).trim();
    if (!normalizedName) throw new HttpError(422, 'Nama lengkap wajib diisi.');
    update.nama_user = normalizedName;
  }
  if (password !== undefined) {
    if (String(password).length < 8) throw new HttpError(422, 'Password minimal 8 karakter.');
    update.password_hash = hashPassword(password);
  }
  if (role !== undefined) {
    const normalizedRole = String(role).trim().toUpperCase();
    if (!['USER', 'ADMIN', 'OWNER'].includes(normalizedRole)) throw new HttpError(403, 'Level Super User hanya dapat dikelola melalui seed script.');
    const existing = await User.findById(req.params.id).select('role');
    if (!existing) throw new HttpError(404, 'User tidak ditemukan.');
    if (existing.role === 'SUPER_USER') throw new HttpError(403, 'Level Super User hanya dapat dikelola melalui seed script.');
    update.role = normalizedRole;
  }
  if (!Object.keys(update).length) throw new HttpError(422, 'Hanya nama lengkap dan password yang dapat diubah.');
  const updated = await User.findOneAndUpdate({ _id: req.params.id, aktif: true }, { $set: update }, { new: true, runValidators: true });
  if (!updated) throw new HttpError(404, 'User tidak ditemukan atau tidak aktif.');
  return res.json(publicUser(updated));
}));

app.delete('/api/users/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(422, 'ID user tidak valid.');
  if (String(req.user?.id || '') === String(req.params.id)) throw new HttpError(409, 'User yang sedang login tidak dapat dinonaktifkan.');
  const target = await User.findById(req.params.id);
  if (!target) throw new HttpError(404, 'User tidak ditemukan.');
  if (target.aktif && target.role === 'SUPER_USER' && await User.countDocuments({ role: 'SUPER_USER', aktif: true }) <= 1) throw new HttpError(409, 'Minimal satu Super User aktif harus dipertahankan.');
  target.aktif = false;
  await target.save();
  return res.json(publicUser(target));
}));

app.post('/api/users/:id/restore', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(422, 'ID user tidak valid.');
  const restored = await User.findByIdAndUpdate(req.params.id, { $set: { aktif: true } }, { new: true, runValidators: true });
  if (!restored) throw new HttpError(404, 'User tidak ditemukan.');
  return res.json(publicUser(restored));
}));

async function userAccessPayload() {
  const saved = await UserAccess.find({}).lean();
  const savedByLevel = new Map(saved.map((item) => [String(item.level).toUpperCase(), item]));
  // Super User adalah akun bawaan program dengan seluruh akses. Level ini
  // tidak perlu dan tidak boleh dikonfigurasi melalui halaman Manage User.
  const managedLevels = USER_LEVELS.filter((level) => level.code !== 'SUPER_USER');
  return {
    menuGroups: menuGroupsPayload(),
    levels: managedLevels.map((level) => ({
      code: level.code,
      name: level.name,
      menuIds: (() => {
        const savedItem = savedByLevel.get(level.code);
        const stored = savedItem?.menu_ids;
        if (!Array.isArray(stored)) return defaultMenuIds();
        const normalized = normalizeMenuIds(stored);
        // Konfigurasi lama tetap mendapatkan menu baru ini. Saat level
        // disimpan dari Manage User, versi menu akan ikut diperbarui.
        if (Number(savedItem?.versi_menu || 0) < 2 && !normalized.includes('period-close')) normalized.push('period-close');
        // Akses menu Saldo Awal lama dipindahkan ke Transaksi Manual agar
        // pengaturan level user tidak membuat menu baru ini ikut tersembunyi.
        if (stored.includes('opening-balances') && !normalized.includes('manual-transactions')) normalized.push('manual-transactions');
        return normalized;
      })(),
    })),
  };
}

app.get('/api/user-access', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await userAccessPayload())));

app.patch('/api/user-access/:level', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const level = String(req.params.level || '').trim().toUpperCase();
  if (level === 'SUPER_USER') throw new HttpError(403, 'Hak akses Super User sudah ditetapkan penuh oleh sistem.');
  if (!USER_LEVELS.some((item) => item.code === level)) throw new HttpError(422, 'Level user tidak valid.');
  if (!Array.isArray(req.body?.menuIds)) throw new HttpError(422, 'Daftar menu harus berupa array.');
  const menuIds = normalizeMenuIds(req.body.menuIds);
  await UserAccess.findOneAndUpdate(
    { level },
    { $set: { menu_ids: menuIds, versi_menu: 2, updated_by: actor(req) } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return res.json(await userAccessPayload());
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const token = bearerToken(req);
  if (token) sessions.delete(token);
  return res.json({ ok: true });
}));

async function getNagagoldBranches() {
  const branches = await Branch.find({ aktif: { $ne: false }, $or: [{ jenis_bisnis: { $in: ['NAGAGOLD', 'OPTIK'] } }, { jenis_bisnis: { $exists: false } }, { jenis_bisnis: '' }] }).sort({ kode_toko: 1 }).lean();
  return branches.map((branch) => ({
    id: id(branch._id),
    kodeToko: branch.kode_toko,
    namaToko: branch.nama_toko,
    jenisBisnis: String(branch.jenis_bisnis || 'NAGAGOLD').trim().toUpperCase(),
    portal: branch.portal || '',
    tipeToko: branch.tipe_toko || '',
    mongodbUri: String(process.env[SOURCE_CONFIGS[String(branch.jenis_bisnis || 'NAGAGOLD').trim().toUpperCase()]?.uriEnv || 'NAGAGOLD_MONGODB_URI'] || process.env.NAGAGOLD_MONGODB_URI || '').trim(),
    databaseName: branch.database_name,
  })).filter((branch) => {
    const config = sourceConfigForBranch(branch);
    if (!branch.kodeToko || !branch.databaseName) return false;
    if (!branch.mongodbUri) throw new HttpError(500, `${config.code === 'OPTIK' ? 'OPTIK_MONGODB_URI atau NAGAGOLD_MONGODB_URI' : 'NAGAGOLD_MONGODB_URI'} belum diisi.`);
    return true;
  });
}

function sourceBusinessUnit(branch) {
  return sourceConfigForBranch(branch).code;
}

function serializeAccount(item) {
  const raw = item.toObject ? item.toObject() : item;
  const bank = raw.bank_id && typeof raw.bank_id === 'object' ? raw.bank_id : null;
  const posKas = raw.pos_kas_id && typeof raw.pos_kas_id === 'object' ? raw.pos_kas_id : null;
  const business = raw.jenis_bisnis_id && typeof raw.jenis_bisnis_id === 'object' ? raw.jenis_bisnis_id : null;
  const cabang = raw.cabang_id && typeof raw.cabang_id === 'object' ? raw.cabang_id : null;
  const bankId = bank?._id || raw.bank_id;
  const jenisAkun = inferAccountKind(raw);
  const cabangId = cabang?._id || raw.cabang_id;
  return {
    ...raw,
    id: id(raw._id),
    kodeAkun: raw.kode_akun || '',
    name: raw.nama_rekening,
    accountType: raw.kelompok_rekening,
    parentId: '',
    posKasId: id(posKas?._id || raw.pos_kas_id),
    posKasCode: posKas?.kode_jenis || '',
    posKasName: posKas?.nama_jenis || '',
    posKasType: posKas?.tipe_kas || raw.kelompok_rekening || '',
    jenisKas: raw.kelompok_rekening || posKas?.tipe_kas || '',
    jenisBisnisId: id(business?._id || raw.jenis_bisnis_id),
    jenisBisnisCode: business?.kode_bisnis || raw.unit || '',
    jenisBisnisName: business?.nama_bisnis || raw.unit || '',
    unitType: raw.unit,
    bankId: id(bankId),
    bankCode: raw.bentuk_saldo === 'KAS_TUNAI' ? 'TUNAI' : (bank?.kode_bank || ''),
    bankName: raw.bentuk_saldo === 'KAS_TUNAI' ? 'TUNAI' : (bank?.nama_bank || ''),
    accountNumber: raw.nomor_rekening || '',
    atasNama: raw.atas_nama || '',
    bentukSaldo: raw.bentuk_saldo || 'REKENING_BANK',
    jenisAkun,
    jenis_akun: jenisAkun,
    kodeToko: raw.kode_toko || '',
    cabangId: id(cabangId),
    cabangName: cabang?.nama_toko || '',
    lokasiPengelolaan: raw.lokasi_pengelolaan || (raw.kode_toko ? 'TOKO_CABANG' : 'PUSAT'),
    penanggungJawab: raw.penanggung_jawab || '',
    saldoAkhir: Number(raw.saldo_akhir || 0),
    isActive: raw.aktif,
  };
}

function inferAccountKind(account = {}) {
  if (Object.values(ACCOUNT_KINDS).includes(account.jenis_akun)) return account.jenis_akun;
  if (account.bentuk_saldo === 'KAS_TUNAI' && account.kode_toko) return ACCOUNT_KINDS.STORE_CASH;
  if (account.kelompok_rekening === 'KAS_BESAR') return ACCOUNT_KINDS.LARGE_CASH;
  if (account.kelompok_rekening === 'KAS_KECIL') return ACCOUNT_KINDS.OPERATING_CASH;
  return ACCOUNT_KINDS.BANK_ACCOUNT;
}

function serializeBank(item) {
  const raw = item.toObject ? item.toObject() : item;
  const code = raw.kode_bank || raw.code || '';
  return { ...raw, id: id(raw._id), code, name: raw.nama_bank || raw.name || '', isActive: raw.aktif ?? raw.isActive !== false, isSystem: raw.sistem === true || code === 'TUNAI' };
}

function serializeBusinessType(item) {
  const raw = item.toObject ? item.toObject() : item;
  return { ...raw, id: id(raw._id), code: raw.kode_bisnis || '', name: raw.nama_bisnis || '', isActive: raw.aktif !== false };
}

function serializeCashType(item) {
  const raw = item.toObject ? item.toObject() : item;
  const legacyType = ['KAS_UTAMA', 'KAS_BESAR', 'KAS_KECIL'].includes(raw.kode_jenis) ? raw.kode_jenis : '';
  const type = raw.tipe_kas || legacyType || 'KAS_KECIL';
  const legacy = ['KAS_BESAR', 'KAS_KECIL'].includes(raw.kode_jenis);
  return {
    id: id(raw._id),
    code: raw.kode_jenis,
    name: raw.nama_jenis,
    type,
    parentId: id(raw.parent_id),
    parentName: raw.parent_name || '',
    unit: raw.unit || 'PUSAT',
    order: raw.urutan,
    accountCount: Number(raw.account_count || 0),
    childCount: Number(raw.child_count || 0),
    isActive: raw.aktif,
    system: raw.sistem !== false,
    legacy,
    selectable: !legacy,
  };
}

const serializeMasterOption = serializeCashType;

function serializeBranch(item) {
  const raw = item.toObject ? item.toObject() : item;
  return { id: id(raw._id), kodeToko: raw.kode_toko, namaToko: raw.nama_toko, jenisBisnis: String(raw.jenis_bisnis || 'NAGAGOLD').trim().toUpperCase(), portal: raw.portal || '', tipeToko: raw.tipe_toko || '', databaseName: raw.database_name || '', isActive: raw.aktif, createdAt: raw.created_at, updatedAt: raw.updated_at };
}

function serializeRequest(item) {
  const raw = item.toObject ? item.toObject() : item;
  const asalPermintaan = String(raw.asal_permintaan || (raw.kodeToko ? 'CABANG' : 'INTERNAL')).trim().toUpperCase();
  const unitPemohon = String(raw.unit_pemohon || '').trim().toUpperCase();
  const namaPemohon = String(raw.nama_pemohon || '').trim().toUpperCase();
  const paymentStatus = raw.payment_status || (['COMPLETED', 'PAID'].includes(raw.status) ? PAYMENT_STATUSES.PAID : PAYMENT_STATUSES.WAITING_TRANSFER);
  const approvalStatus = raw.approval_status || (raw.status === 'APPROVED' || ['COMPLETED', 'PAID'].includes(raw.status) ? APPROVAL_STATUSES.APPROVED : raw.status === 'PENDING_APPROVAL' ? APPROVAL_STATUSES.PENDING : raw.status === 'REJECTED' ? APPROVAL_STATUSES.REJECTED : APPROVAL_STATUSES.NOT_STARTED);
  const jenisTransaksi = String(raw.jenisTransaksi || raw.jenisRequest || '').trim().toUpperCase();
  return { ...raw, id: id(raw._id), asal_permintaan: asalPermintaan, asalPermintaan, unit_pemohon: unitPemohon, unitPemohon, nama_pemohon: namaPemohon, namaPemohon, jenisTransaksi, sourceAccountId: id(raw.source_account_id), destinationAccountId: id(raw.destination_account_id), pemohonLabel: asalPermintaan === 'CABANG' ? (raw.kodeToko || 'CABANG') : (namaPemohon || unitPemohon || 'INTERNAL FINANCE'), namaToko: raw.namaTokoSnapshot, noRekening: raw.noRekening || '', accountNumber: raw.noRekening || '', approval_status: approvalStatus, approvalStatus, payment_status: paymentStatus, paymentStatus };
}

function reconciliationStatusLabel(value) {
  return {
    [RECONCILIATION_STATUSES.NOT_APPLICABLE]: 'Tidak perlu rekonsiliasi',
    [RECONCILIATION_STATUSES.UNMATCHED]: 'Belum terhubung request',
    [RECONCILIATION_STATUSES.MATCH_CANDIDATE]: 'Ada kandidat request',
    [RECONCILIATION_STATUSES.MATCHED]: 'Terhubung ke request',
    [RECONCILIATION_STATUSES.CONFLICT]: 'Konflik pasangan',
  }[value] || value || '-';
}

function integrationStatus(raw = {}, { isImported = Boolean(raw.isImported) } = {}) {
  if (!isImported) return { code: 'FINANCE', label: 'Finance', reason: '' };
  const category = String(raw.kategoriSumber || raw.kategori_sistem || '').trim().toUpperCase();
  const journalStatus = inferJournalStatus(raw);
  const saldoStatus = raw.saldo_status || '';
  const reconciliation = raw.reconciliation_status || '';
  const mapping = raw.mappingStatus || '';
  const requestId = String(raw.requestId || '').trim();
  if (category === 'SALDO AWAL' || category === 'SALDO_AWAL') return { code: 'NOT_PROCESSED', label: 'Tidak diproses', reason: 'Saldo awal sumber dicatat melalui menu saldo awal Finance.' };
  if (journalStatus === JOURNAL_STATUSES.POSTED && (saldoStatus === BALANCE_STATUSES.APPLIED || !saldoStatus) || reconciliation === RECONCILIATION_STATUSES.MATCHED) {
    return { code: 'RECORDED', label: 'Tercatat', reason: raw.sync_message || 'Sudah tercatat di saldo Finance.' };
  }
  if ([SYNC_STATUSES.FAILED, SYNC_STATUSES.MAPPING_FAILED].includes(raw.sync_status) || raw.status === 'REJECTED') return { code: 'FAILED', label: 'Gagal', reason: raw.sync_message || raw.mappingReason || raw.rejection_reason || 'Transaksi tidak dapat dicatat.' };
  if (requestId && reconciliation !== RECONCILIATION_STATUSES.MATCHED) return { code: 'WAITING_REQUEST', label: 'Menunggu pencocokan request', reason: raw.reconciliation_note || 'Menunggu mutasi Finance yang sesuai.' };
  if (mapping !== 'TERPETAKAN' || !raw.rekeningId) return { code: 'WAITING_MAPPING', label: 'Menunggu pemetaan rekening', reason: raw.mappingReason || 'Rekening Finance belum ditemukan.' };
  if (String(raw.statusSumber || '').toUpperCase() && String(raw.statusSumber).toUpperCase() !== 'OPEN') return { code: 'NEEDS_REVIEW', label: 'Perlu diperiksa', reason: raw.sync_message || `Status sumber ${String(raw.statusSumber).toUpperCase()} belum dapat diproses.` };
  return { code: 'NEEDS_REVIEW', label: 'Perlu diperiksa', reason: raw.sync_message || raw.classification_reason || 'Transaksi menunggu pemeriksaan.' };
}

function serializeTransaction(item, accountsById = new Map()) {
  const raw = item.toObject ? item.toObject() : item;
  const sourceId = id(raw.sourceAccountId);
  const destinationId = id(raw.destinationAccountId);
  const rekeningId = id(raw.rekeningId);
  const sourceType = inferSourceType(raw);
  const syncStatus = inferSyncStatus(raw);
  const approvalStatus = inferApprovalStatus(raw);
  const paymentStatus = inferPaymentStatus(raw);
  const journalStatus = inferJournalStatus(raw);
  const classificationStatus = raw.classification_status || (raw.isImported ? NAGAGOLD_CLASSIFICATION_STATUSES.REVIEW_REQUIRED : '');
  const isImported = Boolean(raw.isImported || sourceType === SOURCE_TYPES.SYNC || sourceType === SOURCE_TYPES.SYNC_NAGAGOLD || sourceType === SOURCE_TYPES.SYNC_OPTIK);
  const integration = integrationStatus(raw, { isImported });
  const displayReconciliationStatus = isImported && !isNagagoldInternalTransfer(raw) && !raw.matched_transaction_id
    ? RECONCILIATION_STATUSES.NOT_APPLICABLE
    : (raw.reconciliation_status || (raw.matched_transaction_id ? RECONCILIATION_STATUSES.MATCHED : RECONCILIATION_STATUSES.NOT_APPLICABLE));
  const jenisBisnis = String(raw.jenis_bisnis || raw.jenisBisnis || (raw.isImported ? raw.sourceSystem : '') || '').trim().toUpperCase();
  const mutationRecord = !isImported && (
    String(raw.kategori_sistem || '').toUpperCase() === 'MUTASI'
    || String(raw.jenis_transaksi || raw.jenisTransaksi || '').toUpperCase() === 'MUTASI'
    || String(raw.jenis_request || raw.jenisRequest || '').toUpperCase() === 'MUTASI_REKENING'
    || String(raw.bentuk_transaksi || raw.bentukTransaksi || '').toUpperCase() === 'MUTASI_REKENING'
    || String(raw.no_mutasi || raw.transactionNumber || '').toUpperCase().startsWith('MTS-')
  );
  const kategoriSistem = mutationRecord ? 'MUTASI' : (raw.kategori_sistem || 'TRANSAKSI');
  const createdBy = raw.created_by || raw.createdBy || 'system';
  const approvedBy = raw.approved_by || raw.approvedBy || '';
  const approvedAt = raw.approved_at || raw.approvedAt || null;
  return {
    ...raw,
    id: id(raw._id),
    created_by: createdBy,
    createdBy,
    approved_by: approvedBy,
    approvedBy,
    approved_at: approvedAt,
    approvedAt,
    rejected_by: raw.rejected_by || raw.rejectedBy || '',
    rejected_at: raw.rejected_at || raw.rejectedAt || null,
    rejection_reason: raw.rejection_reason || raw.rejectionReason || '',
    sourceAccountId: sourceId,
    destinationAccountId: destinationId,
    rekeningId,
    namaToko: raw.namaTokoSnapshot,
    source_type: sourceType,
    sourceType,
    sourceTypeLabel: sourceTypeLabel(sourceType, jenisBisnis),
    jenis_bisnis: jenisBisnis,
    jenisBisnis,
    sync_status: syncStatus,
    syncStatus,
    syncStatusLabel: syncStatusLabel(syncStatus),
    sourceProcessingStatus: journalStatus === JOURNAL_STATUSES.POSTED ? 'POSTED' : syncStatus,
    sourceProcessingStatusLabel: journalStatus === JOURNAL_STATUSES.POSTED ? 'Tercatat' : syncStatusLabel(syncStatus),
    approval_status: approvalStatus,
    approvalStatus,
    approvalStatusLabel: approvalStatusLabel(approvalStatus),
    payment_status: paymentStatus,
    paymentStatus,
    journal_status: journalStatus,
    journalStatus,
    journalStatusLabel: journalStatusLabel(journalStatus),
    saldo_status: raw.saldo_status || BALANCE_STATUSES.NOT_APPLIED,
    saldoStatus: raw.saldo_status || BALANCE_STATUSES.NOT_APPLIED,
    kategori_sistem: kategoriSistem,
    kategoriSistem,
    kategoriTransaksi: kategoriSistem,
    kategori_sumber: raw.kategoriSumber || '',
    kategoriSumber: raw.kategoriSumber || '',
    source_transaction_id: raw.source_transaction_id || raw.sourceId || '',
    finance_transaction_id: raw.finance_transaction_id || id(raw._id),
    sourceDatabaseName: raw.source_database_name || (raw.isImported ? raw.sourceDatabase || '' : ''),
    source_payment_method: raw.source_payment_method || (raw.isImported ? sourcePaymentMethod(raw) : 'BANK'),
    sourcePaymentMethod: raw.source_payment_method || (raw.isImported ? sourcePaymentMethod(raw) : 'BANK'),
    sourceAmountIn: Number(raw.source_amount_in || 0),
    sourceAmountOut: Number(raw.source_amount_out || 0),
    sourceTanggal: raw.sourceTanggal || raw.transactionDate || '',
    sourceDeskripsi: raw.sourceDeskripsi || '',
    sourceKeterangan: raw.sourceKeterangan || raw.note || '',
    sourceDetailTransaction: raw.sourceDetailTransaction || null,
    mappingStatus: raw.mappingStatus || '',
    mappingReason: raw.mappingReason || '',
    mappingCheckedAt: raw.mappingCheckedAt || null,
    mappingRuleKey: raw.mappingRuleKey || '',
    mappingCandidateIds: raw.mappingCandidateIds || [],
    sourceDecryptionStatus: raw.sourceDecryptionStatus || 'UNKNOWN',
    sourceDecryptionNote: raw.sourceDecryptionNote || '',
    sourceSnapshotAt: raw.sourceSnapshotAt || null,
    sourceSnapshotProvenance: raw.sourceSnapshotProvenance || null,
    sourceSnapshotFingerprint: raw.sourceSnapshotFingerprint || '',
    sourceSnapshotRecoveryStatus: raw.sourceSnapshotRecoveryStatus || 'UNKNOWN',
    sourceSnapshotRecoveredAt: raw.sourceSnapshotRecoveredAt || null,
    sourceSnapshotRecoveryNote: raw.sourceSnapshotRecoveryNote || '',
    sourceSnapshotRecoverySourceUpdatedAt: raw.sourceSnapshotRecoverySourceUpdatedAt || null,
    sourceFinalityStatus: raw.sourceFinalityStatus || 'UNVERIFIED',
    sourceFinalityNote: raw.sourceFinalityNote || '',
    sourceIsValidate: raw.sourceIsValidate ?? null,
    sourceStatusReceive: raw.sourceStatusReceive ?? null,
    classification_status: classificationStatus,
    classificationStatus,
    classificationStatusLabel: classificationStatus ? nagagoldClassificationLabel(classificationStatus) : '',
    classification_reason: raw.classification_reason || '',
    classificationReason: raw.classification_reason || '',
    classification_rule_version: raw.classification_rule_version || '',
    classificationRuleVersion: raw.classification_rule_version || '',
    classification_proposal: raw.classification_proposal || null,
    classificationProposal: raw.classification_proposal || null,
    classification_flags: raw.classification_flags || [],
    classificationFlags: raw.classification_flags || [],
    classified_at: raw.classified_at || null,
    classifiedAt: raw.classified_at || null,
    classified_by: raw.classified_by || '',
    classifiedBy: raw.classified_by || '',
    reconciliation_status: displayReconciliationStatus,
    reconciliationStatus: displayReconciliationStatus,
    reconciliationStatusLabel: reconciliationStatusLabel(displayReconciliationStatus),
    matched_transaction_id: raw.matched_transaction_id || '',
    matchedTransactionId: raw.matched_transaction_id || '',
    matched_at: raw.matched_at || null,
    matched_by: raw.matched_by || '',
    match_method: raw.match_method || '',
    match_reference: raw.match_reference || '',
    reconciliation_note: raw.reconciliation_note || '',
    sourceAccountName: accountsById.get(sourceId) || sourceId,
    destinationAccountName: accountsById.get(destinationId) || destinationId,
    rekeningName: accountsById.get(rekeningId) || rekeningId,
    integrationStatus: integration.code,
    integrationStatusLabel: integration.label,
    integrationReason: integration.reason,
  };
}

function serializeManualJournal(item, accountsById = new Map()) {
  const raw = item.toObject ? item.toObject() : item;
  const rekeningId = id(raw.rekening_id);
  const debit = Number(raw.debet || 0);
  const kredit = Number(raw.kredit || 0);
  const status = raw.status === 'PROVISIONAL' ? 'PENDING_APPROVAL' : raw.status === 'POSTED' ? 'APPROVED' : 'REJECTED';
  const account = accountsById.get(rekeningId) || {};
  return {
    ...raw,
    id: id(raw._id),
    noKeuangan: raw.no_keuangan,
    noTransaksi: raw.no_transaksi || raw.no_keuangan,
    transactionNumber: raw.no_transaksi || raw.no_keuangan,
    transactionDate: raw.tanggal,
    tanggal: raw.tanggal,
    tipe: raw.tipe,
    jenisTransaksi: raw.jenis_transaksi || raw.tipe,
    jenisRequest: raw.jenis_transaksi || raw.tipe,
    kategoriSistem: 'TRANSAKSI',
    kategoriTransaksi: 'PENYESUAIAN SALDO',
    status,
    approvalStatus: status,
    journalStatus: raw.status,
    journal_status: raw.status,
    amount: debit + kredit,
    arahDana: debit > 0 ? 'MASUK' : 'KELUAR',
    rekeningId,
    sourceAccountId: rekeningId,
    destinationAccountId: '',
    rekeningName: account.nama_rekening || raw.nama_rekening || '',
    accountNumber: account.nomor_rekening || raw.no_rekening || '',
    accountName: account.nama_rekening || raw.nama_rekening || '',
    bankCode: account.bank_id?.kode_bank || raw.kode_bank || '',
    debet: debit,
    kredit,
    note: raw.keterangan || '-',
    sourceType: 'MANUAL_ADMIN',
    source_type: 'MANUAL_ADMIN',
    isManualTransaction: true,
    createdBy: raw.created_by || 'system',
    approvedBy: raw.approved_by || '',
    approvedAt: raw.approved_at || null,
  };
}

async function manualJournalAccounts(items) {
  const ids = [...new Set(items.map((item) => id(item.rekening_id)).filter((value) => mongoose.isValidObjectId(value)))];
  if (!ids.length) return new Map();
  const accounts = await Account.find({ _id: { $in: ids } }).populate({ path: 'bank_id', select: 'kode_bank' }).lean();
  return new Map(accounts.map((account) => [id(account._id), account]));
}

function nagagoldTransactionQuery(extra = {}) {
  return {
    sumber: { $in: ['NAGAGOLD', 'OPTIK'] },
    $and: [
      { kategori: { $ne: 'SALDO AWAL' } },
      extra,
    ],
  };
}

function serializeSyncState(item) {
  const raw = item.toObject ? item.toObject() : item;
  return { ...raw, id: id(raw._id), cursorInputDate: raw.cursorInputDate || null, initialSyncCompleted: raw.initialSyncCompleted === true };
}

function serializeNagagoldMapping(item, accountsById = new Map()) {
  const raw = item.toObject ? item.toObject() : item;
  const rekeningId = id(raw.rekening_id);
  return {
    ...raw,
    id: id(raw._id),
    sourceSystem: raw.source_system,
    kodeToko: raw.kode_toko,
    unit: raw.unit,
    jenisBisnis: raw.unit,
    metodePembayaran: raw.metode_pembayaran,
    jenisPembayaran: raw.metode_pembayaran,
    kodeBank: raw.kode_bank || '',
    nomorRekening: raw.nomor_rekening || '',
    jenisAkun: raw.jenis_akun,
    rekeningId,
    rekeningName: accountsById.get(rekeningId) || rekeningId,
    isActive: raw.aktif,
  };
}

function serializeNagagoldAutoPostingRule(item) {
  const raw = item.toObject ? item.toObject() : item;
  return {
    ...raw,
    id: id(raw._id),
    sourceSystem: raw.source_system,
    kodeToko: raw.kode_toko,
    jenisTransaksi: raw.jenis_transaksi,
    kategoriTransaksi: raw.kategori_transaksi,
    metodePembayaran: raw.metode_pembayaran,
    statusFinalitas: raw.status_finalitas,
    isActive: raw.aktif === true,
    created_by: raw.created_by || raw.dibuat_oleh || '',
    createdBy: raw.created_by || raw.dibuat_oleh || '',
    approved_by: raw.approved_by || raw.disetujui_oleh || '',
    approvedBy: raw.approved_by || raw.disetujui_oleh || '',
    approved_at: raw.approved_at || raw.disetujui_pada || null,
    approvedAt: raw.approved_at || raw.disetujui_pada || null,
    ruleVersion: raw.versi_aturan || '',
  };
}

function normalizeAutoPostingValue(value, fallback = '*') {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || fallback;
}

function autoPostingContext(transaction) {
  const method = sourcePaymentMethod(transaction);
  const unit = String(transaction.jenis_bisnis || transaction.jenisBisnis || transaction.sourceSystem || 'NAGAGOLD').trim().toUpperCase() || 'NAGAGOLD';
  return {
    sourceSystem: String(transaction.sourceSystem || 'nagagold').toLowerCase(),
    unit,
    kodeToko: normalizeAutoPostingValue(transaction.kodeToko, ''),
    jenisTransaksi: normalizeAutoPostingValue(transaction.jenisSumber, ''),
    kategoriTransaksi: normalizeAutoPostingValue(transaction.kategoriSumber, ''),
    metodePembayaran: method === 'TUNAI' ? 'CASH' : normalizeAutoPostingValue(method, ''),
  };
}

function evaluateAutoPostingWhitelist(transaction, rules = []) {
  const context = autoPostingContext(transaction);
  const matchingRules = rules.filter((rule) => {
    const raw = rule.toObject ? rule.toObject() : rule;
    return raw.source_system === context.sourceSystem
      && raw.unit === context.unit
      && (raw.kode_toko === '*' || raw.kode_toko === context.kodeToko)
      && (raw.jenis_transaksi === '*' || raw.jenis_transaksi === context.jenisTransaksi)
      && (raw.kategori_transaksi === '*' || raw.kategori_transaksi === context.kategoriTransaksi)
      && (raw.metode_pembayaran === '*' || raw.metode_pembayaran === context.metodePembayaran);
  }).sort((left, right) => {
    const a = left.toObject ? left.toObject() : left;
    const b = right.toObject ? right.toObject() : right;
    const specificity = (item) => [item.kode_toko, item.jenis_transaksi, item.kategori_transaksi, item.metode_pembayaran].filter((value) => value !== '*').length;
    return specificity(b) - specificity(a);
  });
  const activeRule = matchingRules.find((rule) => (rule.aktif === true));
  const classificationReady = transaction.classification_status === NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE
    && transaction.sourceFinalityStatus === 'FINAL_CONFIRMED'
    && transaction.mappingStatus === 'TERPETAKAN'
    && ![RECONCILIATION_STATUSES.MATCHED, RECONCILIATION_STATUSES.MATCH_CANDIDATE, RECONCILIATION_STATUSES.CONFLICT].includes(transaction.reconciliation_status)
    && ![JOURNAL_STATUSES.POSTED, JOURNAL_STATUSES.REVERSED].includes(transaction.journal_status)
    && (!transaction.journal_status || transaction.journal_status === JOURNAL_STATUSES.NOT_CREATED);
  let reason = 'Belum ada aturan whitelist yang cocok.';
  if (matchingRules.length && !activeRule) reason = 'Aturan whitelist tersedia tetapi masih nonaktif.';
  else if (activeRule && !NAGAGOLD_AUTO_POSTING_ENABLED) reason = 'Fitur auto-posting production masih dinonaktifkan oleh konfigurasi sistem.';
  else if (activeRule && !classificationReady) reason = 'Transaksi belum memenuhi seluruh pemeriksaan klasifikasi, finalitas, mapping, rekonsiliasi, dan jurnal.';
  else if (activeRule) reason = 'Memenuhi aturan whitelist dan siap menjadi kandidat posting setelah fitur diaktifkan.';
  return {
    eligible: Boolean(activeRule && NAGAGOLD_AUTO_POSTING_ENABLED && classificationReady),
    reason,
    context,
    matchedRuleId: activeRule ? id(activeRule._id) : '',
    matchedRuleActive: Boolean(activeRule),
  };
}

function serializeOpeningBalance(item, accountsById = new Map()) {
  const raw = item.toObject ? item.toObject() : item;
  const rekeningId = id(raw.rekening_id);
  const kategoriSistem = raw.kategori_sistem || raw.kategori_transaksi || 'SALDO AWAL';
  const createdBy = raw.created_by || raw.dibuat_oleh || 'system';
  const approvedBy = raw.approved_by || raw.disetujui_oleh || '';
  const approvedAt = raw.approved_at || raw.disetujui_pada || null;
  return { ...raw, id: id(raw._id), rekeningId, rekeningName: accountsById.get(rekeningId) || rekeningId, date: raw.tanggal, amount: raw.nilai, note: raw.keterangan, kategoriSistem, kategori_sistem: kategoriSistem, kategoriTransaksi: kategoriSistem, kategori_transaksi: kategoriSistem, statusValid: raw.status_valid, saldo_status: raw.saldo_status || BALANCE_STATUSES.NOT_APPLIED, saldoStatus: raw.saldo_status || BALANCE_STATUSES.NOT_APPLIED, created_by: createdBy, createdBy, approved_by: approvedBy, approvedBy, approved_at: approvedAt, approvedAt, rejected_by: raw.rejected_by || raw.ditolak_oleh || '', rejected_at: raw.rejected_at || raw.ditolak_pada || null, rejection_reason: raw.rejection_reason || raw.alasan_penolakan || '', applied_by: raw.applied_by || raw.diterapkan_oleh || '', applied_at: raw.applied_at || raw.diterapkan_pada || null };
}

async function accountById(value, session) {
  if (!mongoose.isValidObjectId(value)) throw new HttpError(422, 'ID akun kas tidak valid.');
  const account = await Account.findOne({ _id: value, aktif: true })
    .populate({ path: 'bank_id', select: 'kode_bank nama_bank' })
    .populate({ path: 'pos_kas_id', select: 'kode_jenis nama_jenis tipe_kas' })
    .session(session || null);
  if (!account) throw new HttpError(422, `Akun kas ${value} tidak ditemukan atau tidak aktif.`);
  return account;
}

function mutationAccountSnapshot(account) {
  const bank = account?.bank_id && typeof account.bank_id === 'object' ? account.bank_id : null;
  const cashType = account?.pos_kas_id && typeof account.pos_kas_id === 'object' ? account.pos_kas_id : null;
  return {
    bank: account?.bentuk_saldo === 'KAS_TUNAI' ? 'TUNAI' : String(bank?.kode_bank || '').trim().toUpperCase(),
    cashType: String(cashType?.nama_jenis || account?.kelompok_rekening || '').trim().toUpperCase(),
  };
}

async function withMongoTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    if (error?.message?.includes('Transaction numbers are only allowed') || error?.codeName === 'IllegalOperation') {
      throw new HttpError(503, 'MongoDB harus berjalan sebagai replica set/Atlas agar approval dan jurnal atomik dapat digunakan.');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function transactionNumber(transaction) {
  return String(transaction?.transactionNumber || transaction?.transaction_number || '').trim();
}

async function findFinanceTransactionById(transactionId, session) {
  const mutationQuery = FinanceMutation.findById(transactionId);
  if (session) mutationQuery.session(session);
  const mutation = await mutationQuery;
  if (mutation) return mutation;
  const syncQuery = SyncTransaction.findById(transactionId);
  if (session) syncQuery.session(session);
  return syncQuery;
}

async function listFinanceTransactions(query = {}, sort = { createdAt: -1 }) {
  const [mutations, syncs] = await Promise.all([
    FinanceMutation.find(query).sort(sort).lean(),
    SyncTransaction.find(query).sort(sort).lean(),
  ]);
  return [...mutations, ...syncs].sort((left, right) => {
    const leftDate = new Date(left.createdAt || left.transactionDate || 0).getTime();
    const rightDate = new Date(right.createdAt || right.transactionDate || 0).getTime();
    return rightDate - leftDate;
  });
}

function financeType(transaction = {}) {
  const text = [transaction.kategoriSumber, transaction.jenisSumber, transaction.jenisTransaksi, transaction.jenisRequest].filter(Boolean).join(' ').toUpperCase();
  if (transaction.kategori_sistem === 'MUTASI' || transaction.bentukTransaksi === 'MUTASI_REKENING' || text.includes('MUTASI')) return 'MUTASI';
  if (text.includes('PENJUAL') || text.includes('PENDAPATAN')) return 'PENJUALAN';
  if (text.includes('PEMBELI') || text.includes('BUYBACK')) return 'PEMBELIAN';
  if (text.includes('OPERASIONAL')) return 'OPERASIONAL';
  return 'TRANSAKSI';
}

async function findTransactionJournal(transaction, session) {
  return JournalEntry.findOne({ no_transaksi: transactionNumber(transaction), tipe: { $ne: 'PEMBALIKAN' } }).sort({ dibuat_pada: 1 }).session(session || null);
}

async function findReversalJournal(transaction, session) {
  return JournalEntry.findOne({ no_transaksi: transactionNumber(transaction), tipe: 'PEMBALIKAN' }).sort({ dibuat_pada: 1 }).session(session || null);
}

async function financeEntries(entries, session) {
  const accountIds = [...new Set(entries.map((entry) => id(entry.rekeningId)).filter((value) => mongoose.isValidObjectId(value)))];
  const accounts = await Account.find({ _id: { $in: accountIds } }).populate({ path: 'bank_id', select: 'kode_bank nama_bank' }).session(session || null).lean();
  const accountMap = new Map(accounts.map((account) => [id(account._id), account]));
  return entries.map((entry) => {
    const rekeningId = id(entry.rekeningId);
    const account = accountMap.get(rekeningId);
    const bank = account?.bank_id && typeof account.bank_id === 'object' ? account.bank_id : null;
    const cash = account?.bentuk_saldo === 'KAS_TUNAI';
    const cabangId = entry.cabang_id || entry.cabangId || account?.cabang_id || null;
    return {
      rekening_id: rekeningId,
      no_rekening: account?.nomor_rekening || account?.kode_akun || '',
      kode_bank: cash ? 'TUNAI' : (bank?.kode_bank || ''),
      nama_rekening: account?.nama_rekening || '',
      nama_bank: cash ? 'TUNAI' : (bank?.nama_bank || ''),
      bank_id: bank?._id || account?.bank_id || null,
      cabang_id: mongoose.isValidObjectId(cabangId) ? cabangId : null,
      kode_toko: String(entry.kode_toko || entry.kodeToko || account?.kode_toko || '').trim().toUpperCase(),
      nama_toko: String(entry.nama_toko || entry.namaToko || '').trim(),
      jenis_bisnis: String(entry.jenis_bisnis || entry.jenisBisnis || account?.unit || '').trim().toUpperCase(),
      debet: Number(entry.debet || 0),
      kredit: Number(entry.kredit || 0),
      detail_faktur: Array.isArray(entry.detail_faktur) ? entry.detail_faktur : [],
      keterangan: entry.keterangan || '',
    };
  });
}

function financeAccountSnapshot(account = null) {
  if (!account) return {
    no_rekening: '',
    kode_bank: '',
    nama_bank: '',
    nama_rekening: '',
    bank_id: null,
  };
  const bank = account.bank_id && typeof account.bank_id === 'object' ? account.bank_id : null;
  const cash = account.bentuk_saldo === 'KAS_TUNAI';
  return {
    no_rekening: account.nomor_rekening || account.kode_akun || '',
    kode_bank: cash ? 'TUNAI' : (bank?.kode_bank || ''),
    nama_bank: cash ? 'TUNAI' : (bank?.nama_bank || ''),
    nama_rekening: account.nama_rekening || '',
    bank_id: bank?._id || account.bank_id || null,
  };
}

function financePayload({ noKeuangan, noTransaksi = '', tanggal, tipe, jenisTransaksi = '', status = 'PROVISIONAL', sumber = 'FINANCE', entry, createdBy = 'system', approvedBy = '', approvedAt = null }) {
  return {
    no_keuangan: noKeuangan,
    no_transaksi: noTransaksi,
    tanggal,
    tipe,
    status,
    sumber: ['FINANCE', 'NAGAGOLD', 'OPTIK'].includes(String(sumber || '').trim().toUpperCase()) ? String(sumber).trim().toUpperCase() : 'FINANCE',
    jenis_transaksi: jenisTransaksi || entry?.jenis_transaksi || '',
    ...entry,
    created_by: createdBy,
    approved_by: approvedBy,
    approved_at: approvedAt,
  };
}

async function createInitialJournal(transaction, session) {
  const entries = await financeEntries([
    { rekeningId: transaction.destinationAccountId, debet: transaction.amount, kredit: 0, keterangan: 'Dana masuk ke akun tujuan' },
    { rekeningId: transaction.sourceAccountId, debet: 0, kredit: transaction.amount, keterangan: 'Dana keluar dari akun sumber' },
  ], session);
  const created = [];
  const tipe = financeType(transaction);
  const noTransaksi = transactionNumber(transaction);
  for (const entry of entries) {
    created.push(...await JournalEntry.create([financePayload({
      noKeuangan: await nextFinanceNumber(transaction.transactionDate, session),
      noTransaksi,
      tanggal: transaction.transactionDate,
      tipe,
      sumber: 'FINANCE',
      createdBy: transaction.created_by || transaction.createdBy || 'system',
      entry,
    })], { session }));
  }
  await markBalanceSnapshotsStale(created.map((entry) => entry.rekening_id), transaction.transactionDate, session);
  return created;
}

async function ensureInitialJournal(transaction, session) {
  const existing = await JournalEntry.find({ no_transaksi: transactionNumber(transaction), tipe: { $ne: 'PEMBALIKAN' } }).sort({ dibuat_pada: 1 }).session(session || null);
  if (existing.length) { existing[0]._allEntries = existing; return existing[0]; }
  const created = await createInitialJournal(transaction, session);
  created[0]._allEntries = created;
  return created[0];
}

function financeInvoiceNumbers(transaction) {
  const rawDetails = Array.isArray(transaction?.sourceDetailTransaction) ? transaction.sourceDetailTransaction : [];
  const summaryDetails = Array.isArray(transaction?.sourceInvoiceDetails) ? transaction.sourceInvoiceDetails : [];
  const directNumbers = Array.isArray(transaction?.sourceInvoiceNumbers) ? transaction.sourceInvoiceNumbers : [];
  const numbers = [
    ...directNumbers,
    ...summaryDetails.map((invoice) => invoice?.nomorFaktur || invoice?.no_faktur),
    ...rawDetails.map((detail) => detail?.no_faktur || detail?.no_faktur_jual || detail?.no_faktur_beli),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return [...new Set(numbers)];
}

async function createMutationJournal(transaction, session) {
  const incoming = transaction.arahDana === 'MASUK';
  const accountId = id(transaction.rekeningId);
  const detailFaktur = financeInvoiceNumbers(transaction);
  const source = sourceConfigForTransaction(transaction);
  const keterangan = String(transaction.sourceKeterangan || transaction.sourceDeskripsi || transaction.note || '').trim()
    || `${incoming ? 'Dana masuk' : 'Dana keluar'} dari transaksi ${source.code}`;
  const [entry] = await financeEntries([
    {
      rekeningId: accountId,
      debet: incoming ? transaction.amount : 0,
      kredit: incoming ? 0 : transaction.amount,
      detail_faktur: detailFaktur,
      keterangan,
      cabang_id: transaction.cabang_id,
      kode_toko: transaction.kodeToko || transaction.kode_toko,
      nama_toko: transaction.namaTokoSnapshot || transaction.nama_toko,
      jenis_bisnis: transaction.jenis_bisnis || transaction.jenisBisnis || transaction.sumber,
    },
  ], session);
  const created = await JournalEntry.create([{
    ...financePayload({ noKeuangan: await nextFinanceNumber(transaction.transactionDate, session), noTransaksi: transactionNumber(transaction), tanggal: transaction.transactionDate, tipe: financeType(transaction), sumber: journalSourceForTransaction(transaction), entry }),
  }], { session });
  await markBalanceSnapshotsStale(created.map((item) => item.rekening_id), transaction.transactionDate, session);
  return created;
}

async function ensureMutationJournal(transaction, session) {
  const existing = await findTransactionJournal(transaction, session);
  if (existing) return existing;
  const created = await createMutationJournal(transaction, session);
  return created[0];
}

async function ensureReversalJournal(transaction, originalJournal, session, createdBy = 'system') {
  const existing = await findReversalJournal(transaction, session);
  if (existing) {
    existing._allEntries = await JournalEntry.find({ no_transaksi: transactionNumber(transaction), tipe: 'PEMBALIKAN' }).sort({ dibuat_pada: 1 }).session(session || null);
    return existing;
  }
  if (!originalJournal || !['PROVISIONAL', 'POSTED'].includes(originalJournal.status)) return null;
  const reversalDate = await currentBusinessDate(session);
  const snapshot = {
    cabang_id: transaction.cabang_id || transaction.cabangId || originalJournal.cabang_id || null,
    kode_toko: transaction.kodeToko || transaction.kode_toko || originalJournal.kode_toko || '',
    nama_toko: transaction.namaTokoSnapshot || transaction.nama_toko || originalJournal.nama_toko || '',
    jenis_bisnis: transaction.jenis_bisnis || transaction.jenisBisnis || originalJournal.jenis_bisnis || '',
  };
  const entries = transaction.bentukTransaksi === 'MUTASI_REKENING'
    ? [
      { rekeningId: transaction.rekeningId, ...snapshot, debet: transaction.arahDana === 'KELUAR' ? transaction.amount : 0, kredit: transaction.arahDana === 'MASUK' ? transaction.amount : 0, keterangan: 'Pembalikan mutasi rekening' },
    ]
    : [
      { rekeningId: transaction.sourceAccountId, ...snapshot, debet: transaction.amount, kredit: 0, keterangan: 'Jurnal balik ke akun sumber' },
      { rekeningId: transaction.destinationAccountId, ...snapshot, debet: 0, kredit: transaction.amount, keterangan: 'Jurnal balik dari akun tujuan' },
    ];
  const details = await financeEntries(entries, session);
  const created = [];
  for (const entry of details) {
    created.push(...await JournalEntry.create([financePayload({
      noKeuangan: await nextFinanceNumber(reversalDate, session),
      noTransaksi: transactionNumber(transaction),
      tanggal: reversalDate,
      tipe: 'PEMBALIKAN',
      sumber: journalSourceForTransaction(originalJournal),
      createdBy,
      status: 'POSTED',
      entry,
    })], { session }));
  }
  await markBalanceSnapshotsStale(created.map((entry) => entry.rekening_id), reversalDate, session);
  created[0]._allEntries = created;
  return created[0];
}

async function ensureOpeningJournal(item, session, createdBy = 'system', status = 'POSTED') {
  const existing = item.jurnal_id ? await JournalEntry.findOne({ no_keuangan: item.jurnal_id }).session(session || null) : null;
  if (existing) return existing;
  const [entry] = await financeEntries([
    { rekeningId: item.rekening_id, debet: item.nilai, kredit: 0, keterangan: 'Saldo awal rekening' },
  ], session);
  const created = await JournalEntry.create([{
    ...financePayload({ noKeuangan: await nextFinanceNumber(item.tanggal, session), tanggal: item.tanggal, tipe: 'SALDO_AWAL', sumber: 'FINANCE', createdBy, status, entry }),
  }], { session });
  await markBalanceSnapshotsStale(created.map((journal) => journal.rekening_id), item.tanggal, session);
  return created[0];
}

async function ensureOpeningReversalJournal(item, openingJournal, session, createdBy = 'system') {
  const existing = item.jurnal_balik_id ? await JournalEntry.findOne({ no_keuangan: item.jurnal_balik_id }).session(session || null) : null;
  if (existing) return existing;
  if (!openingJournal) return null;
  const reversalDate = await currentBusinessDate(session);
  const [entry] = await financeEntries([
    { rekeningId: item.rekening_id, debet: 0, kredit: item.nilai, keterangan: 'Saldo awal dibalik' },
  ], session);
  const created = await JournalEntry.create([{
    ...financePayload({ noKeuangan: await nextFinanceNumber(reversalDate, session), tanggal: reversalDate, tipe: 'PEMBALIKAN', sumber: journalSourceForTransaction(openingJournal), createdBy, status: 'POSTED', entry }),
  }], { session });
  return created[0];
}

async function transactionFinanceEntries(transaction, primary, session) {
  if (!primary) return [];
  if (Array.isArray(primary._allEntries) && primary._allEntries.length) return primary._allEntries;
  const entries = await JournalEntry.find({ no_transaksi: transactionNumber(transaction), tipe: { $ne: 'PEMBALIKAN' } }).sort({ dibuat_pada: 1 }).session(session || null);
  return entries.length ? entries : [primary];
}

async function setFinanceEntriesStatus(entries, status, session, approvedBy = '') {
  for (const entry of entries || []) {
    if (!entry) continue;
    entry.status = status;
    if (status === 'POSTED' && approvedBy) {
      entry.approved_by = approvedBy;
      entry.approved_at = entry.approved_at || now();
    }
    await entry.save({ session });
  }
}

function importedSyncState(item, mappingResult, branch) {
  const mapped = Boolean(mappingResult?.account);
  if (!mapped) {
    const reason = mappingResult?.reason || (isCashPayment(item)
      ? `Kas tunai untuk cabang ${branch?.kodeToko || '-'} belum tersedia di Master Rekening.`
      : 'Rekening sumber belum ditemukan, atau nomor rekening dan bank tidak unik di Master Rekening.');
    return { status: SYNC_STATUSES.MAPPING_FAILED, message: reason };
  }
  const finality = sourceFinalityAudit(item, branch);
  if (finality.status !== 'FINAL_CONFIRMED') return { status: SYNC_STATUSES.NEEDS_REVIEW, message: finality.note };
  return { status: SYNC_STATUSES.RECORDED, message: 'Data dari sumber sudah tervalidasi dan siap dibukukan ke Finance.' };
}

function reconciliationMessage(status, count = 0) {
  if (status === RECONCILIATION_STATUSES.MATCH_CANDIDATE) return `${count} kandidat transfer Finance ditemukan. Konfirmasi pasangan secara manual.`;
  if (status === RECONCILIATION_STATUSES.UNMATCHED) return 'Belum ditemukan transfer Finance yang dapat dipasangkan.';
  return '';
}

async function reconcileImportedByRequestId(transactionId) {
  const imported = await SyncTransaction.findOne(nagagoldTransactionQuery({ _id: transactionId })).lean();
  const requestId = String(imported?.requestId || '').trim();
  if (!imported || !requestId) return null;
  if (imported.matched_transaction_id || imported.reconciliation_status === RECONCILIATION_STATUSES.MATCHED) {
    return { status: imported.reconciliation_status || RECONCILIATION_STATUSES.MATCHED, candidates: 0 };
  }

  // request_id adalah foreign reference dari Nagagold ke Finance. Jangan
  // membatasi sourceSystem karena request dapat dibuat oleh cabang Nagagold
  // maupun oleh Finance untuk mutasi internal.
  const request = await TransferRequest.findOne({ requestId }).lean();
  if (!request) {
    const note = `request_id ${requestId} belum ditemukan di Finance; transaksi Nagagold ditahan dan tidak diposting.`;
    await SyncTransaction.updateOne({ _id: imported._id, matched_transaction_id: { $in: ['', null] } }, { $set: { reconciliation_status: RECONCILIATION_STATUSES.UNMATCHED, reconciliation_note: note } });
    return { status: RECONCILIATION_STATUSES.UNMATCHED, candidates: 0, note };
  }

  const sameBranch = String(request.kodeToko || '').toUpperCase() === String(imported.kodeToko || '').toUpperCase();
  const sameAmount = Number(request.nilaiRp || 0) === Number(imported.amount || 0);
  const incoming = String(imported.arahDana || '').toUpperCase() === 'MASUK';
  if (!sameBranch || !sameAmount || !incoming) {
    const mismatch = [
      !sameBranch ? 'cabang berbeda' : '',
      !sameAmount ? 'nominal berbeda' : '',
      !incoming ? 'arah transaksi bukan penerimaan cabang' : '',
    ].filter(Boolean).join(', ');
    const note = `request_id ${requestId} ditemukan, tetapi ${mismatch}. Perlu pemeriksaan Admin.`;
    await SyncTransaction.updateOne({ _id: imported._id, matched_transaction_id: { $in: ['', null] } }, { $set: { reconciliation_status: RECONCILIATION_STATUSES.CONFLICT, reconciliation_note: note } });
    return { status: RECONCILIATION_STATUSES.CONFLICT, candidates: 0, note };
  }

  if (!request.finance_transaction_id) {
    const note = `request_id ${requestId} sudah dikenal, tetapi realisasi transfer Finance belum tercatat. Transaksi Nagagold tidak diposting.`;
    await SyncTransaction.updateOne({ _id: imported._id, matched_transaction_id: { $in: ['', null] } }, { $set: { reconciliation_status: RECONCILIATION_STATUSES.UNMATCHED, reconciliation_note: note } });
    return { status: RECONCILIATION_STATUSES.UNMATCHED, candidates: 0, note };
  }

  const manual = await FinanceMutation.findOne({ _id: request.finance_transaction_id, isImported: { $ne: true }, requestId }).lean();
  if (!manual) {
    const note = `Realisasi Finance untuk request_id ${requestId} tidak ditemukan atau tidak cocok. Transaksi Nagagold ditahan.`;
    await SyncTransaction.updateOne({ _id: imported._id, matched_transaction_id: { $in: ['', null] } }, { $set: { reconciliation_status: RECONCILIATION_STATUSES.CONFLICT, reconciliation_note: note } });
    return { status: RECONCILIATION_STATUSES.CONFLICT, candidates: 0, note };
  }

  const manualPosted = manual.status === 'APPROVED'
    && manual.journal_status === JOURNAL_STATUSES.POSTED
    && (manual.saldo_status === BALANCE_STATUSES.APPLIED || !manual.saldo_status);
  if (!manualPosted) {
    const note = `Realisasi Finance untuk request_id ${requestId} belum terposting. Transaksi Nagagold tidak menambah saldo Finance.`;
    await SyncTransaction.updateOne(
      { _id: imported._id, matched_transaction_id: { $in: ['', null] } },
      { $set: { reconciliation_status: RECONCILIATION_STATUSES.UNMATCHED, reconciliation_note: note, sync_status: SYNC_STATUSES.NEEDS_REVIEW, sync_message: note } },
    );
    return { status: RECONCILIATION_STATUSES.UNMATCHED, candidates: 0, note };
  }

  const importedJournal = await findTransactionJournal(imported);
  if (importedJournal) {
    const note = 'Transaksi Nagagold sudah memiliki jurnal; pasangan request_id tidak diubah otomatis untuk mencegah perubahan saldo historical.';
    await SyncTransaction.updateOne({ _id: imported._id }, { $set: { reconciliation_status: RECONCILIATION_STATUSES.CONFLICT, reconciliation_note: note } });
    return { status: RECONCILIATION_STATUSES.CONFLICT, candidates: 0, note };
  }

  try {
    await withMongoTransaction(async (session) => {
      const currentImported = await SyncTransaction.findOne(nagagoldTransactionQuery({ _id: imported._id })).session(session);
      const currentManual = await FinanceMutation.findOne({ _id: manual._id, isImported: { $ne: true }, requestId }).session(session);
      if (!currentImported || !currentManual) throw new HttpError(409, 'Transaksi request berubah saat rekonsiliasi.');
      if (currentImported.matched_transaction_id || currentManual.matched_transaction_id) throw new HttpError(409, 'Transaksi request sudah memiliki pasangan.');
      const matchedAt = now();
      const matchReference = `REQUEST:${requestId}`;
      const common = {
        reconciliation_status: RECONCILIATION_STATUSES.MATCHED,
        // tt_sinkronisasi menyimpan nomor keuangan sebagai referensi bisnis
        // yang mudah dibaca; tidak perlu menyimpan object id pasangan lama.
        no_keuangan: String(currentManual.transactionNumber || currentManual.no_transaksi || request.finance_transaction_id || '').trim(),
        matched_at: matchedAt,
        matched_by: 'Sync Nagagold',
        match_method: MATCH_METHODS.REQUEST_ID,
        match_reference: matchReference,
        reconciliation_note: `Otomatis dicocokkan berdasarkan ${matchReference}. Data Nagagold adalah penerimaan pasangan transfer Finance dan tidak membuat jurnal tambahan.`,
      };
      const importedResult = await SyncTransaction.updateOne(
        { _id: currentImported._id, matched_transaction_id: { $in: ['', null] }, reconciliation_status: { $ne: RECONCILIATION_STATUSES.MATCHED } },
        { $set: { ...common, matched_transaction_id: id(currentManual._id), approval_status: APPROVAL_STATUSES.NOT_REQUIRED, journal_status: JOURNAL_STATUSES.NOT_CREATED, sync_status: SYNC_STATUSES.RECONCILED, sync_message: `request_id ${requestId} sudah terhubung ke realisasi Finance; tidak dibuat jurnal kedua.` } },
        { session },
      );
      const manualResult = await FinanceMutation.updateOne(
        { _id: currentManual._id, matched_transaction_id: { $in: ['', null] } },
        { $set: { ...common, matched_transaction_id: id(currentImported._id) } },
        { session },
      );
      if (importedResult.modifiedCount !== 1 || manualResult.modifiedCount !== 1) throw new HttpError(409, 'Pasangan request baru saja diproses oleh proses lain.');
      const correlationId = createNumber('REQUEST-RECON');
      await AuditLog.create([
        { actor: 'Sync Nagagold', action: 'RECONCILIATION_MATCH_CONFIRMED', entityType: 'FINANCE_TRANSACTION', entityId: id(currentImported._id), after: { matchedTransactionId: id(currentManual._id), method: MATCH_METHODS.REQUEST_ID, reference: matchReference }, correlationId },
        { actor: 'Sync Nagagold', action: 'RECONCILIATION_MATCH_CONFIRMED', entityType: 'FINANCE_TRANSACTION', entityId: id(currentManual._id), after: { matchedTransactionId: id(currentImported._id), method: MATCH_METHODS.REQUEST_ID, reference: matchReference }, correlationId },
      ], { session, ordered: true });
    });
    return { status: RECONCILIATION_STATUSES.MATCHED, candidates: 0, matched: true };
  } catch (error) {
    const note = `Pencocokan request_id ${requestId} belum selesai: ${error.message || 'proses paralel atau database transaction gagal'}.`;
    await SyncTransaction.updateOne({ _id: imported._id, matched_transaction_id: { $in: ['', null] } }, { $set: { reconciliation_status: RECONCILIATION_STATUSES.CONFLICT, reconciliation_note: note } });
    return { status: RECONCILIATION_STATUSES.CONFLICT, candidates: 0, note };
  }
}

async function findReconciliationCandidates(imported, session) {
  if (!imported?.isImported || !isNagagoldInternalTransfer(imported) || !imported.rekeningId || !imported.kodeToko) return [];
  const direction = String(imported.arahDana || '').toUpperCase();
  const accountCondition = direction === 'MASUK'
    ? { destinationAccountId: imported.rekeningId }
    : { sourceAccountId: imported.rekeningId };
  const query = {
    _id: { $ne: imported._id },
    isImported: { $ne: true },
    kodeToko: String(imported.kodeToko).toUpperCase(),
    transactionDate: String(imported.transactionDate).slice(0, 10),
    amount: Number(imported.amount),
    status: { $in: ['PENDING_APPROVAL', 'APPROVED'] },
    matched_transaction_id: { $in: ['', null] },
    $or: [accountCondition, { kodeToko: String(imported.kodeToko).toUpperCase() }],
  };
  const candidates = await FinanceMutation.find(query).sort({ createdAt: 1 }).session(session || null).lean();
  return candidates.map((candidate) => ({ transaction: candidate, evidence: candidateEvidence(imported, candidate) })).filter((candidate) => candidateIsUseful(candidate.evidence));
}

async function refreshImportedReconciliation(transactionId) {
  const imported = await SyncTransaction.findOne({ _id: transactionId, isImported: true });
  if (!imported || imported.matched_transaction_id || imported.reconciliation_status === RECONCILIATION_STATUSES.MATCHED) return { status: imported?.reconciliation_status || RECONCILIATION_STATUSES.NOT_APPLICABLE, candidates: 0 };
  if (!isNagagoldInternalTransfer(imported)) {
    const note = 'Transaksi operasional Nagagold tidak memerlukan pasangan transaksi Finance.';
    await SyncTransaction.updateOne(
      { _id: imported._id, matched_transaction_id: { $in: ['', null] }, reconciliation_status: { $ne: RECONCILIATION_STATUSES.MATCHED } },
      { $set: { reconciliation_status: RECONCILIATION_STATUSES.NOT_APPLICABLE, reconciliation_note: note } },
    );
    return { status: RECONCILIATION_STATUSES.NOT_APPLICABLE, candidates: 0 };
  }
  if (String(imported.requestId || '').trim()) return reconcileImportedByRequestId(transactionId);
  if (!imported.rekeningId) return { status: imported.reconciliation_status, candidates: 0 };
  const candidates = await findReconciliationCandidates(imported);
  const nextStatus = candidates.length ? RECONCILIATION_STATUSES.MATCH_CANDIDATE : RECONCILIATION_STATUSES.UNMATCHED;
  const message = candidates.length ? reconciliationMessage(nextStatus, candidates.length) : (imported.reconciliation_status === RECONCILIATION_STATUSES.MATCH_CANDIDATE ? reconciliationMessage(nextStatus) : imported.reconciliation_note || '');
  await SyncTransaction.updateOne(
    { _id: imported._id, matched_transaction_id: { $in: ['', null] }, reconciliation_status: { $ne: RECONCILIATION_STATUSES.MATCHED } },
    { $set: { reconciliation_status: nextStatus, reconciliation_note: message } },
  );
  return { status: nextStatus, candidates: candidates.length };
}

async function refreshReconciliationForManual(transactionId) {
  const manual = await FinanceMutation.findById(transactionId).lean();
  if (!manual || manual.isImported || !reconciliationApplicable(manual)) return { refreshed: 0 };
  const imported = await SyncTransaction.find({
    isImported: true,
    kodeToko: String(manual.kodeToko || '').toUpperCase(),
    transactionDate: String(manual.transactionDate || '').slice(0, 10),
    amount: Number(manual.amount),
    reconciliation_status: { $in: [RECONCILIATION_STATUSES.UNMATCHED, RECONCILIATION_STATUSES.MATCH_CANDIDATE, RECONCILIATION_STATUSES.NOT_APPLICABLE, null] },
    matched_transaction_id: { $in: ['', null] },
  }).select('_id').lean();
  for (const item of imported) await refreshImportedReconciliation(item._id);
  return { refreshed: imported.length };
}

async function reconciliationPayload(transaction) {
  const imported = transaction?.isImported ? transaction : (transaction?.matched_transaction_id ? await SyncTransaction.findById(transaction.matched_transaction_id) : null);
  const candidates = imported ? await findReconciliationCandidates(imported) : [];
  const matched = transaction?.matched_transaction_id ? await FinanceMutation.findById(transaction.matched_transaction_id) : null;
  const accounts = await resolveAccountsMap();
  const status = transaction?.isImported && !isNagagoldInternalTransfer(transaction) && !transaction.matched_transaction_id
    ? RECONCILIATION_STATUSES.NOT_APPLICABLE
    : (transaction?.reconciliation_status || (transaction?.matched_transaction_id ? RECONCILIATION_STATUSES.MATCHED : RECONCILIATION_STATUSES.NOT_APPLICABLE));
  return {
    status,
    note: transaction?.reconciliation_note || '',
    candidates: candidates.map(({ transaction: item, evidence }) => ({ transaction: serializeTransaction(item, accounts), evidence })),
    matchedTransaction: matched ? serializeTransaction(matched, accounts) : null,
  };
}

async function nagagoldClassificationContext(transaction, options = {}) {
  const [account, journal, candidates, request] = await Promise.all([
    transaction.rekeningId ? Account.findOne({ _id: transaction.rekeningId, aktif: true }).lean() : null,
    options.existingJournal === undefined ? findTransactionJournal(transaction) : options.existingJournal,
    options.reconciliationCandidateCount === undefined ? findReconciliationCandidates(transaction) : null,
    transaction.requestId ? TransferRequest.findOne({ requestId: transaction.requestId }).lean() : null,
  ]);
  let accountBankCode = '';
  if (account?.bank_id) {
    const bank = await Bank.findById(account.bank_id).select('kode_bank').lean();
    accountBankCode = bank?.kode_bank || '';
  }
  return {
    account,
    accountBankCode,
    existingJournal: journal,
    reconciliationCandidateCount: options.reconciliationCandidateCount ?? candidates.length,
    request,
    // OPEN adalah status transaksi yang sudah divalidasi kasir Nagagold
    // menurut aturan bisnis yang telah disepakati.
    sourceStatusFinal: String(transaction.statusSumber || '').toUpperCase() === 'OPEN'
      || transaction.sourceFinalityStatus === 'FINAL_CONFIRMED',
  };
}

async function classifyStoredNagagoldTransaction(transaction, options = {}) {
  const raw = transaction.toObject ? transaction.toObject() : transaction;
  const context = await nagagoldClassificationContext(raw, options);
  const classification = classifyNagagoldTransaction(raw, context);
  if (options.persist !== false) {
    await SyncTransaction.updateOne(
      nagagoldTransactionQuery({ _id: raw._id }),
      { $set: {
        classification_status: classification.status,
        classification_reason: classification.reason,
        classification_rule_version: classification.ruleVersion,
        classification_proposal: classification.proposedJournal,
        classification_flags: classification.flags,
        classified_at: now(),
        classified_by: options.classifiedBy || 'System',
      } },
    );
  }
  return { transaction: raw, classification };
}

async function classifyNagagoldTransactions(transactions, options = {}) {
  const rows = [];
  for (const transaction of transactions) rows.push(await classifyStoredNagagoldTransaction(transaction, options));
  return rows;
}

async function postImportedNagagoldTransaction(transactionId) {
  if (!NAGAGOLD_SOURCE_POSTING_ENABLED) return { posted: false, skipped: true, reason: 'Posting transaksi sumber dinonaktifkan oleh konfigurasi.' };
  try {
    return await withMongoTransaction(async (session) => {
      const current = await SyncTransaction.findOne(nagagoldTransactionQuery({ _id: transactionId })).session(session);
      if (!current) return { posted: false, skipped: true, reason: 'Transaksi sumber tidak ditemukan.' };
      // Status TERCATAT/TERHUBUNG adalah tanda final pada tt_sinkronisasi.
      // Jangan pernah mengubah saldo rekening lagi hanya karena worker
      // membaca ulang transaksi saat restart atau sinkronisasi berikutnya.
      if (['TERCATAT', 'TERHUBUNG'].includes(String(current.status || '').toUpperCase())) {
        return { posted: false, skipped: true, idempotent: true };
      }
      if (current.matched_transaction_id || current.reconciliation_status === RECONCILIATION_STATUSES.MATCHED || String(current.requestId || '').trim()) {
        if (current.matched_transaction_id || current.reconciliation_status === RECONCILIATION_STATUSES.MATCHED) {
          current.approval_status = APPROVAL_STATUSES.NOT_REQUIRED;
          current.journal_status = JOURNAL_STATUSES.NOT_CREATED;
          current.sync_status = SYNC_STATUSES.RECONCILED;
          current.sync_message = 'Sudah terhubung ke realisasi Finance; tidak dibuat jurnal kedua.';
          await current.save({ session });
        }
        return { posted: false, skipped: true, reason: 'Transaksi memiliki request atau sudah terhubung ke pencatatan Finance.' };
      }
      const sourceValidated = current.sourceFinalityStatus === 'FINAL_CONFIRMED' || String(current.statusSumber || '').toUpperCase() === 'OPEN';
      if (current.mappingStatus !== 'TERPETAKAN' || !current.rekeningId || !sourceValidated || current.classification_status !== NAGAGOLD_CLASSIFICATION_STATUSES.AUTO_ELIGIBLE) {
        return { posted: false, skipped: true, reason: 'Transaksi belum memenuhi mapping atau validasi sumber.' };
      }
      if (current.journal_status === JOURNAL_STATUSES.POSTED || current.saldo_status === BALANCE_STATUSES.APPLIED) return { posted: false, skipped: true, idempotent: true };

      // Claim atomik sebelum membuat jurnal. Proses kedua akan melihat status
      // PROVISIONAL dan tidak boleh mengubah saldo atau membuat jurnal kedua.
      const claim = await SyncTransaction.updateOne(
        { _id: current._id, journal_status: { $in: [JOURNAL_STATUSES.NOT_CREATED, '', null] }, saldo_status: { $ne: BALANCE_STATUSES.APPLIED } },
        { $set: { journal_status: JOURNAL_STATUSES.PROVISIONAL } },
        { session },
      );
      if (claim.modifiedCount !== 1) return { posted: false, skipped: true, reason: 'Transaksi sedang diproses oleh worker lain.' };

      // Jurnal Finance adalah sumber kebenaran. Bila jurnal sudah ada,
      // proses pemulihan cukup menyelesaikan status transaksi sumber tanpa
      // mengurangi/menambah saldo rekening untuk kedua kalinya. Dalam satu
      // transaksi Mongo, jurnal baru selalu dibuat sebelum status sumber
      // menjadi final, sehingga journalWasExisting menjadi penanda aman untuk
      // mencegah pengulangan update saldo setelah restart.
      const existingJournal = await findTransactionJournal(current, session);
      if (existingJournal?.status === JOURNAL_STATUSES.POSTED) {
        current.status = 'TERCATAT';
        current.no_keuangan = existingJournal.no_keuangan || current.no_keuangan;
        current.statusValid = true;
        current.approval_status = APPROVAL_STATUSES.NOT_REQUIRED;
        current.approved_by = current.approved_by || 'system';
        current.approved_at = current.approved_at || now();
        current.journal_status = JOURNAL_STATUSES.POSTED;
        current.saldo_status = BALANCE_STATUSES.APPLIED;
        current.sync_status = SYNC_STATUSES.RECORDED;
        await current.save({ session });
        return { posted: false, skipped: true, idempotent: true, journalId: id(existingJournal._id) };
      }
      const journal = existingJournal || (await createMutationJournal(current, session))[0];
      const amount = Number(current.amount || 0);
      // Transaksi Nagagold tetap harus dibukukan walaupun saldo Finance saat
      // ini nol atau menjadi negatif. Saldo aktual mengikuti urutan transaksi;
      // saldo awal yang dicatat belakangan tidak boleh menghilangkan transaksi
      // keluar yang sudah terjadi.
      if (!existingJournal) {
        const accountQuery = { _id: current.rekeningId, aktif: true };
        const accountUpdate = await Account.updateOne(accountQuery, { $inc: { saldo_akhir: current.arahDana === 'MASUK' ? amount : -amount } }, { session });
        if (accountUpdate.modifiedCount !== 1) throw new HttpError(422, `Rekening tidak ditemukan atau tidak aktif untuk ${current.transactionNumber}.`);
      }
      journal.status = JOURNAL_STATUSES.POSTED;
      journal.approved_by = 'system';
      journal.approved_at = journal.approved_at || now();
      await journal.save({ session });
      current.status = 'TERCATAT';
      // Nomor KU dibuat sekali untuk tt_keuangan dan disalin pada transaksi
      // sinkronisasi dalam transaksi Mongo yang sama. Dengan begitu data
      // sumber tidak pernah berstatus tercatat tetapi kehilangan referensi KU.
      current.no_keuangan = journal.no_keuangan;
      current.statusValid = true;
      current.approval_status = APPROVAL_STATUSES.NOT_REQUIRED;
      current.approved_by = 'system';
      current.approved_at = current.approved_at || now();
      current.journal_status = JOURNAL_STATUSES.POSTED;
      current.saldo_status = BALANCE_STATUSES.APPLIED;
      current.sync_status = SYNC_STATUSES.RECORDED;
      const sourceCode = sourceConfigForTransaction(current).code;
      current.sync_message = `Transaksi ${sourceCode} sudah tervalidasi di sumber, terpetakan, dan dibukukan otomatis ke saldo Finance.`;
      current.sourceFinalityStatus = 'FINAL_CONFIRMED';
      current.sourceFinalityNote = sourceCode === 'OPTIK' ? 'status_valid OPTIK bernilai true.' : 'OPEN diperlakukan sebagai transaksi tervalidasi kasir Nagagold.';
      await current.save({ session });
      await AuditLog.create([{ actor: 'Sync Nagagold', action: 'NAGAGOLD_TRANSACTION_POSTED', entityType: 'FINANCE_TRANSACTION', entityId: id(current._id), after: { status: current.status, journalStatus: current.journal_status, saldoStatus: current.saldo_status, journalId: id(journal._id) }, correlationId: createNumber('NG-POST') }], { session });
      return { posted: true, journalId: id(journal._id) };
    });
  } catch (error) {
    await SyncTransaction.updateOne(
      nagagoldTransactionQuery({ _id: transactionId, journal_status: { $ne: JOURNAL_STATUSES.POSTED } }),
      { $set: { sync_status: SYNC_STATUSES.NEEDS_REVIEW, sync_message: `Posting otomatis ditahan: ${error.message || 'saldo atau jurnal tidak dapat diproses.'}`, classification_status: NAGAGOLD_CLASSIFICATION_STATUSES.BLOCKED, classification_reason: error.message || 'Posting otomatis gagal.' } },
    );
    return { posted: false, skipped: true, reason: error.message || 'Posting otomatis gagal.' };
  }
}

function dryRunSummary(rows) {
  const summary = {
    total: rows.length,
    byClassification: {},
    byJenis: {},
    proposedAccounts: {},
    totalAmount: 0,
    projectedAmountByClassification: {},
  };
  for (const row of rows) {
    const transaction = row.transaction;
    const classification = row.classification;
    const amount = Number(transaction.amount || 0);
    const jenis = String(transaction.jenisSumber || '-').toUpperCase();
    const status = classification.status;
    summary.totalAmount += amount;
    summary.byClassification[status] = summary.byClassification[status] || { status, label: classification.statusLabel, count: 0, amount: 0 };
    summary.byClassification[status].count += 1;
    summary.byClassification[status].amount += amount;
    summary.projectedAmountByClassification[status] = (summary.projectedAmountByClassification[status] || 0) + amount;
    summary.byJenis[jenis] = summary.byJenis[jenis] || { jenis, count: 0, amount: 0 };
    summary.byJenis[jenis].count += 1;
    summary.byJenis[jenis].amount += amount;
    if (classification.proposedJournal) {
      const proposal = classification.proposedJournal;
      const key = `${proposal.debitAccountId}|${proposal.creditAccountId}`;
      summary.proposedAccounts[key] = summary.proposedAccounts[key] || {
        debitAccountId: proposal.debitAccountId,
        debitAccountName: proposal.debitAccountName,
        creditAccountId: proposal.creditAccountId,
        creditAccountName: proposal.creditAccountName,
        count: 0,
        amount: 0,
      };
      summary.proposedAccounts[key].count += 1;
      summary.proposedAccounts[key].amount += amount;
    }
  }
  return {
    ...summary,
    byClassification: Object.values(summary.byClassification),
    byJenis: Object.values(summary.byJenis).sort((a, b) => b.count - a.count),
    proposedAccounts: Object.values(summary.proposedAccounts),
  };
}

async function confirmReconciliation(importedId, matchedTransactionId, req) {
  if (!mongoose.isValidObjectId(importedId) || !mongoose.isValidObjectId(matchedTransactionId) || importedId === matchedTransactionId) throw new HttpError(422, 'Pasangan transaksi tidak valid.');
  const result = await withMongoTransaction(async (session) => {
    const imported = await SyncTransaction.findOne({ _id: importedId, isImported: true }).session(session);
    const manual = await FinanceMutation.findOne({ _id: matchedTransactionId, isImported: { $ne: true } }).session(session);
    if (!imported || !manual) throw new HttpError(404, 'Transaksi sumber atau transaksi Finance tidak ditemukan.');
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(manual.status)) throw new HttpError(409, 'Transaksi Finance belum berada pada status yang dapat direkonsiliasi.');
    if (imported.matched_transaction_id || manual.matched_transaction_id) throw new HttpError(409, 'Salah satu transaksi sudah memiliki pasangan.');
    const evidence = candidateEvidence(imported, manual);
    if (!candidateIsUseful(evidence)) throw new HttpError(422, 'Pasangan tidak memenuhi bukti minimum nominal, tanggal, dan cabang atau rekening.');
    const existingJournal = await findTransactionJournal(imported, session);
    if (existingJournal) {
      imported.reconciliation_status = RECONCILIATION_STATUSES.CONFLICT;
      imported.reconciliation_note = 'Transaksi sumber sudah memiliki jurnal. Koreksi/reversal harus dilakukan melalui prosedur terpisah.';
      await imported.save({ session });
      await AuditLog.create([{ actor: actor(req), action: 'RECONCILIATION_CONFLICT', entityType: 'FINANCE_TRANSACTION', entityId: id(imported._id), after: { reason: imported.reconciliation_note }, correlationId: createNumber('RECON') }], { session });
      throw new HttpError(409, 'Transaksi hasil fetch sudah memiliki jurnal sehingga tidak dipasangkan otomatis. Periksa prosedur koreksi terlebih dahulu.');
    }
    const method = String(req.body?.matchMethod || '').trim().toUpperCase() || (evidence.requestMatch ? MATCH_METHODS.REQUEST_ID : evidence.referenceMatch ? MATCH_METHODS.SOURCE_REFERENCE : evidence.accountMatch ? MATCH_METHODS.ACCOUNT_DATE_AMOUNT : MATCH_METHODS.MANUAL_CONFIRMATION);
    const reference = String(req.body?.matchReference || '').trim() || `FINANCE:${id(manual._id)}|SOURCE:${imported.source_transaction_id || imported.sourceId}`;
    const note = String(req.body?.note || '').trim();
    const matchedAt = now();
    const update = { reconciliation_status: RECONCILIATION_STATUSES.MATCHED, matched_transaction_id: id(manual._id), matched_at: matchedAt, matched_by: actor(req), match_method: method, match_reference: reference, reconciliation_note: note || 'Pasangan transaksi dikonfirmasi Admin.' };
    const importedResult = await SyncTransaction.updateOne({ _id: imported._id, matched_transaction_id: { $in: ['', null] }, reconciliation_status: { $in: [RECONCILIATION_STATUSES.UNMATCHED, RECONCILIATION_STATUSES.MATCH_CANDIDATE, RECONCILIATION_STATUSES.NOT_APPLICABLE, null] } }, { $set: { ...update, approval_status: APPROVAL_STATUSES.NOT_REQUIRED, journal_status: JOURNAL_STATUSES.NOT_CREATED } }, { session });
    const manualResult = await FinanceMutation.updateOne({ _id: manual._id, matched_transaction_id: { $in: ['', null] } }, { $set: { ...update, matched_transaction_id: id(imported._id) } }, { session });
    if (importedResult.modifiedCount !== 1 || manualResult.modifiedCount !== 1) throw new HttpError(409, 'Pasangan baru saja diproses oleh Admin lain. Muat ulang data.');
    const correlationId = createNumber('RECON');
    await AuditLog.create([
      { actor: actor(req), action: 'RECONCILIATION_MATCH_CONFIRMED', entityType: 'FINANCE_TRANSACTION', entityId: id(imported._id), after: { matchedTransactionId: id(manual._id), method, reference }, correlationId },
      { actor: actor(req), action: 'RECONCILIATION_MATCH_CONFIRMED', entityType: 'FINANCE_TRANSACTION', entityId: id(manual._id), after: { matchedTransactionId: id(imported._id), method, reference }, correlationId },
    ], { session, ordered: true });
    return { imported, manual };
  });
  await refreshReconciliationForManual(result.manual._id);
  return result;
}

async function rejectReconciliation(importedId, candidateId, req) {
  const imported = await SyncTransaction.findOne({ _id: importedId, isImported: true });
  if (!imported) throw new HttpError(404, 'Transaksi hasil fetch tidak ditemukan.');
  if (imported.matched_transaction_id) throw new HttpError(409, 'Transaksi ini sudah memiliki pasangan.');
  if (candidateId && !mongoose.isValidObjectId(candidateId)) throw new HttpError(422, 'Kandidat transaksi tidak valid.');
  const note = String(req.body?.note || '').trim();
  const reconciliationNote = note || 'Kandidat pasangan ditolak Admin; transaksi tetap tidak diposting ulang.';
  const result = await SyncTransaction.updateOne(
    { _id: imported._id, matched_transaction_id: { $in: ['', null] }, reconciliation_status: { $in: [RECONCILIATION_STATUSES.UNMATCHED, RECONCILIATION_STATUSES.MATCH_CANDIDATE, RECONCILIATION_STATUSES.NOT_APPLICABLE, null] } },
    { $set: { reconciliation_status: RECONCILIATION_STATUSES.UNMATCHED, match_method: MATCH_METHODS.MANUAL_REJECT, match_reference: candidateId || '', reconciliation_note: reconciliationNote } },
  );
  if (result.modifiedCount !== 1) throw new HttpError(409, 'Transaksi baru saja dipasangkan oleh Admin lain. Muat ulang data.');
  await AuditLog.create({ actor: actor(req), action: 'RECONCILIATION_MATCH_REJECTED', entityType: 'FINANCE_TRANSACTION', entityId: id(imported._id), after: { candidateId: candidateId || '', note: reconciliationNote }, correlationId: createNumber('RECON') });
  return SyncTransaction.findById(imported._id);
}

async function backfillTransactionStatusMetadata() {
  let updated = 0;
  for (const model of [FinanceMutation, SyncTransaction]) {
    const transactions = await model.find({
      $or: [
        { source_type: { $exists: false } },
        { sync_status: { $exists: false } },
        { approval_status: { $exists: false } },
        { payment_status: { $exists: false } },
        { journal_status: { $exists: false } },
        { source_transaction_id: { $exists: false } },
        { finance_transaction_id: { $exists: false } },
        { source_database_name: { $exists: false } },
        { source_payment_method: { $exists: false } },
        { reconciliation_status: { $exists: false } },
      ],
    }).lean();
    if (!transactions.length) continue;
    const journals = await JournalEntry.find({ no_transaksi: { $in: transactions.map((item) => transactionNumber(item)) }, tipe: { $ne: 'PEMBALIKAN' } }).sort({ dibuat_pada: 1 }).lean();
    const journalByTransaction = new Map();
    for (const journal of journals) if (!journalByTransaction.has(journal.no_transaksi)) journalByTransaction.set(journal.no_transaksi, journal);
    const operations = transactions.map((item) => {
      const journal = journalByTransaction.get(transactionNumber(item));
      const update = {
        source_type: inferSourceType(item),
        sync_status: inferSyncStatus(item),
        approval_status: inferApprovalStatus(item),
        payment_status: inferPaymentStatus(item),
        journal_status: inferJournalStatus(item, journal),
        source_transaction_id: item.source_transaction_id || item.sourceId || '',
        finance_transaction_id: item.finance_transaction_id || id(item._id),
        source_database_name: item.source_database_name || (item.isImported ? item.sourceDatabase || '' : ''),
        source_payment_method: item.source_payment_method || (item.isImported ? sourcePaymentMethod(item) : 'BANK'),
        reconciliation_status: item.reconciliation_status || (reconciliationApplicable(item) ? RECONCILIATION_STATUSES.UNMATCHED : RECONCILIATION_STATUSES.NOT_APPLICABLE),
        matched_transaction_id: item.matched_transaction_id || '',
        matched_at: item.matched_at || null,
        matched_by: item.matched_by || '',
        match_method: item.match_method || '',
        match_reference: item.match_reference || '',
        reconciliation_note: item.reconciliation_note || '',
      };
      return { updateOne: { filter: { _id: item._id }, update: { $set: update } } };
    });
    const result = await model.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount || 0;
  }
  return { updated };
}

async function backfillRequestPaymentStatus() {
  const result = await TransferRequest.updateMany(
    { $or: [{ payment_status: { $exists: false } }, { approval_status: { $exists: false } }] },
    [{ $set: {
      payment_status: { $cond: [{ $in: ['$status', ['COMPLETED', 'PAID']] }, PAYMENT_STATUSES.PAID, PAYMENT_STATUSES.WAITING_TRANSFER] },
      approval_status: { $cond: [{ $in: ['$status', ['APPROVED', 'COMPLETED', 'PAID']] }, APPROVAL_STATUSES.APPROVED, { $cond: [{ $eq: ['$status', 'PENDING_APPROVAL'] }, APPROVAL_STATUSES.PENDING, { $cond: [{ $eq: ['$status', 'REJECTED'] }, APPROVAL_STATUSES.REJECTED, APPROVAL_STATUSES.NOT_STARTED] }] }] },
    } }],
  );
  return { updated: result.modifiedCount || 0 };
}

async function removeMutationReconciliationStatus() {
  const exists = await mongoose.connection.db.listCollections({ name: 'tt_mutasi' }).hasNext();
  if (!exists) return 0;
  const result = await mongoose.connection.db.collection('tt_mutasi').updateMany(
    { reconciliation_status: { $exists: true } },
    { $unset: { reconciliation_status: '' } },
  );
  return result.modifiedCount || 0;
}

async function resolveAccountsMap() {
  const accounts = await Account.find({}).lean();
  return new Map(accounts.map((account) => [id(account._id), account.nama_rekening]));
}

async function availableBalance(rekeningId, session) {
  const [account, pendingMutationOutflows, pendingSyncOutflows] = await Promise.all([
    Account.findOne({ _id: rekeningId, aktif: true }).session(session || null).lean(),
    FinanceMutation.find({
      status: { $in: ['PENDING_APPROVAL', 'MENUNGGU_VALIDASI_ADMIN'] },
      saldo_status: { $ne: BALANCE_STATUSES.APPLIED },
      $or: [
        { sourceAccountId: rekeningId },
        { bentukTransaksi: 'MUTASI_REKENING', rekeningId, arahDana: 'KELUAR' },
      ],
    }).session(session || null).lean(),
    SyncTransaction.find({
      status: { $in: ['PENDING_APPROVAL', 'MENUNGGU_VALIDASI_ADMIN'] },
      saldo_status: { $ne: BALANCE_STATUSES.APPLIED },
      $or: [
        { sourceAccountId: rekeningId },
        { bentukTransaksi: 'MUTASI_REKENING', rekeningId, arahDana: 'KELUAR' },
      ],
    }).session(session || null).lean(),
  ]);
  if (!account) return 0;
  const pendingOutflows = [...pendingMutationOutflows, ...pendingSyncOutflows];
  return Number(account.saldo_akhir || 0) - pendingOutflows.reduce((total, item) => total + Number(item.amount || 0), 0);
}

async function applyTransferBalance(transaction, session) {
  if (transaction.saldo_status === BALANCE_STATUSES.APPLIED) return false;
  const amount = Number(transaction.amount || 0);
  const sourceResult = await Account.updateOne(
    { _id: transaction.sourceAccountId, aktif: true, saldo_akhir: { $gte: amount } },
    { $inc: { saldo_akhir: -amount } },
    { session },
  );
  if (sourceResult.modifiedCount !== 1) throw new HttpError(422, `Saldo rekening sumber tidak cukup untuk ${transaction.transactionNumber}.`);
  const destinationResult = await Account.updateOne(
    { _id: transaction.destinationAccountId, aktif: true },
    { $inc: { saldo_akhir: amount } },
    { session },
  );
  if (destinationResult.modifiedCount !== 1) throw new HttpError(422, `Rekening tujuan tidak tersedia untuk ${transaction.transactionNumber}.`);
  transaction.saldo_status = BALANCE_STATUSES.APPLIED;
  await transaction.save({ session });
  return true;
}

async function reverseTransferBalance(transaction, session) {
  if (transaction.saldo_status !== BALANCE_STATUSES.APPLIED) return false;
  const amount = Number(transaction.amount || 0);
  const destinationResult = await Account.updateOne(
    { _id: transaction.destinationAccountId, aktif: true, saldo_akhir: { $gte: amount } },
    { $inc: { saldo_akhir: -amount } },
    { session },
  );
  if (destinationResult.modifiedCount !== 1) throw new HttpError(422, `Saldo rekening tujuan tidak cukup untuk membalik ${transaction.transactionNumber}.`);
  const sourceResult = await Account.updateOne(
    { _id: transaction.sourceAccountId, aktif: true },
    { $inc: { saldo_akhir: amount } },
    { session },
  );
  if (sourceResult.modifiedCount !== 1) throw new HttpError(422, `Rekening sumber tidak tersedia untuk membalik ${transaction.transactionNumber}.`);
  transaction.saldo_status = BALANCE_STATUSES.REVERSED;
  await transaction.save({ session });
  return true;
}

async function syncAccountBalances() {
  const [accounts, journals] = await Promise.all([
    Account.find({}).select('_id').lean(),
    // tt_keuangan adalah ledger resmi. Saldo master tidak lagi dihitung dari
    // $inc transaksi sumber, karena cara itu dapat menggandakan saldo ketika
    // worker restart. Semua jurnal aktif dihitung, termasuk PROVISIONAL yang
    // sudah tercatat sebagai uang; jurnal REVERSED dikeluarkan karena dampak
    // pembaliknya disimpan sebagai jurnal POSTED tersendiri.
    JournalEntry.find({ status: { $in: ['POSTED', 'PROVISIONAL'] } }).select('rekening_id debet kredit').lean(),
  ]);
  const balances = new Map(accounts
    .map((account) => id(account._id))
    .filter((accountId) => mongoose.isValidObjectId(accountId))
    .map((accountId) => [accountId, 0]));
  for (const item of journals) {
    const rekeningId = id(item.rekening_id);
    if (!mongoose.isValidObjectId(rekeningId) || !balances.has(rekeningId)) continue;
    balances.set(rekeningId, balances.get(rekeningId) + Number(item.debet || 0) - Number(item.kredit || 0));
  }
  for (const [accountId, balance] of balances) {
    if (!mongoose.isValidObjectId(accountId)) continue;
    await Account.updateOne({ _id: accountId }, { $set: { saldo_akhir: balance } });
  }
}

async function migrateLegacyMasterData() {
  const database = mongoose.connection.db;
  const legacyBanks = await database.collection('tm_bank').find({ $or: [{ code: { $exists: true } }, { name: { $exists: true } }] }).toArray();
  for (const bank of legacyBanks) {
    await database.collection('tm_bank').updateOne({ _id: bank._id }, { $set: { kode_bank: bank.kode_bank || bank.code, nama_bank: bank.nama_bank || bank.name, aktif: bank.aktif ?? bank.isActive !== false }, $unset: { code: '', name: '', isActive: '' } });
  }
  const legacyAccounts = await database.collection('tm_akun').find({}).toArray();
  for (const account of legacyAccounts) {
    const legacyType = account.accountType === 'REKENING' ? 'KAS_KECIL' : account.accountType;
    if (!['KAS_UTAMA', 'KAS_BESAR', 'KAS_KECIL'].includes(legacyType)) continue;
    await database.collection('tm_rekening').updateOne({ _id: account._id }, { $setOnInsert: { nama_rekening: account.name || 'Rekening Lama', kelompok_rekening: legacyType, unit: account.unitType || 'PUSAT', bank_id: account.bankId || null, nomor_rekening: account.nomorRekening || account.accountNumberMasked || '', saldo_akhir: 0, aktif: account.aktif ?? account.isActive !== false, created_at: account.createdAt || new Date(), updated_at: account.updatedAt || new Date() } }, { upsert: true });
  }
  await database.collection('tm_rekening').updateMany({}, { $unset: { induk_id: '' } });
}

async function ensureSystemCashBank() {
  const existing = await Bank.collection.findOne({ $or: [{ kode_bank: 'TUNAI' }, { code: 'TUNAI' }] });
  let bank;
  if (existing) {
    await Bank.collection.updateOne({ _id: existing._id }, { $set: { kode_bank: 'TUNAI', nama_bank: 'TUNAI', sistem: true, aktif: true }, $unset: { code: '', name: '', isActive: '' } });
    bank = await Bank.findById(existing._id);
  } else {
    bank = await Bank.create({ kode_bank: 'TUNAI', nama_bank: 'TUNAI', sistem: true, aktif: true });
  }
  const result = await Account.updateMany({ bentuk_saldo: 'KAS_TUNAI', $or: [{ bank_id: null }, { bank_id: { $exists: false } }] }, { $set: { bank_id: bank._id } });
  if (result.modifiedCount) console.info(`Referensi bank TUNAI diperbarui pada ${result.modifiedCount} akun kas; saldo dan jurnal tidak diubah.`);
  return bank;
}

async function ensureSafeFinanceIndexes() {
  await Branch.collection.updateMany(
    { $or: [{ jenis_bisnis: { $exists: false } }, { jenis_bisnis: '' }, { jenis_bisnis: null }] },
    { $set: { jenis_bisnis: 'NAGAGOLD' } },
  );
  const branchIndexes = await Branch.collection.indexes();
  // Index lama membuat kode toko global-unik. Itu tidak sesuai karena kode
  // cabang Nagagold dan Optik boleh sama; identitasnya dibedakan oleh sumber.
  for (const legacyIndex of branchIndexes) {
    const key = JSON.stringify(legacyIndex.key || {});
    const isGlobalKodeIndex = key === JSON.stringify({ kode_toko: 1 }) && legacyIndex.name !== 'uniq_cabang_sumber_kode';
    if (isGlobalKodeIndex && legacyIndex.name !== '_id_') {
      await Branch.collection.dropIndex(legacyIndex.name);
      console.info(`Index global kode toko ${legacyIndex.name} dihapus; identitas cabang kini memakai jenis bisnis + kode toko.`);
    }
  }
  let currentBranchIndexes = await Branch.collection.indexes();
  const duplicateScopedBranches = await Branch.collection.aggregate([
    { $group: { _id: { jenis_bisnis: { $ifNull: ['$jenis_bisnis', 'NAGAGOLD'] }, kode_toko: '$kode_toko' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).hasNext();
  if (!currentBranchIndexes.some((index) => index.name === 'uniq_cabang_sumber_kode')) {
    if (!duplicateScopedBranches) await Branch.collection.createIndex({ jenis_bisnis: 1, kode_toko: 1 }, { unique: true, name: 'uniq_cabang_sumber_kode' });
    else console.warn('Index cabang sumber + kode ditunda karena masih ada duplikasi pada sumber yang sama.');
  }
  currentBranchIndexes = await Branch.collection.indexes();
  const duplicateSourceDatabases = await Branch.collection.aggregate([
    { $match: { database_name: { $exists: true, $nin: ['', null] } } },
    { $group: { _id: { jenis_bisnis: { $ifNull: ['$jenis_bisnis', 'NAGAGOLD'] }, database_name: '$database_name' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).hasNext();
  if (!currentBranchIndexes.some((index) => index.name === 'uniq_cabang_sumber_database')) {
    if (!duplicateSourceDatabases) await Branch.collection.createIndex({ jenis_bisnis: 1, database_name: 1 }, { unique: true, name: 'uniq_cabang_sumber_database' });
    else console.warn('Index cabang sumber + database ditunda karena masih ada duplikasi pada sumber yang sama.');
  }

  const syncStateIndexes = await SyncState.collection.indexes();
  for (const legacyIndex of syncStateIndexes) {
    const key = JSON.stringify(legacyIndex.key || {});
    if (key === JSON.stringify({ sourceSystem: 1, kodeToko: 1, sourceCollection: 1 }) && legacyIndex.name !== '_id_') {
      await SyncState.collection.dropIndex(legacyIndex.name);
    }
  }
  const currentSyncStateIndexes = await SyncState.collection.indexes();
  if (!currentSyncStateIndexes.some((index) => index.name === 'uniq_sync_state_source_database')) {
    const duplicateStates = await SyncState.collection.aggregate([
      { $group: { _id: { sourceSystem: '$sourceSystem', sourceDatabase: { $ifNull: ['$sourceDatabase', ''] }, kodeToko: '$kodeToko', sourceCollection: '$sourceCollection' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateStates) await SyncState.collection.createIndex({ sourceSystem: 1, sourceDatabase: 1, kodeToko: 1, sourceCollection: 1 }, { unique: true, name: 'uniq_sync_state_source_database' });
    else console.warn('Index cursor sinkronisasi ditunda karena ada state sumber duplikat.');
  }

  const syncIndexes = await SyncTransaction.collection.indexes();
  for (const legacyIndex of syncIndexes) {
    const key = JSON.stringify(legacyIndex.key || {});
    const isLegacyTransactionNumberIndex = Object.prototype.hasOwnProperty.call(legacyIndex.key || {}, 'transactionNumber');
    if ((key === JSON.stringify({ sumber: 1, kode_toko: 1, id_sumber: 1 }) || isLegacyTransactionNumberIndex) && legacyIndex.name !== '_id_') {
      await SyncTransaction.collection.dropIndex(legacyIndex.name);
      if (isLegacyTransactionNumberIndex) console.info(`Index sinkronisasi lama ${legacyIndex.name} dihapus; identitas transaksi kini memakai sumber + database + toko + ID sumber.`);
    }
  }
  const currentSyncIndexes = await SyncTransaction.collection.indexes();
  if (!currentSyncIndexes.some((index) => index.name === 'uniq_tt_sinkronisasi_sumber_database')) {
    const duplicateSyncRows = await SyncTransaction.collection.aggregate([
      { $group: { _id: { sumber: '$sumber', database_name: { $ifNull: ['$database_name', ''] }, kode_toko: '$kode_toko', id_sumber: '$id_sumber' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateSyncRows) await SyncTransaction.collection.createIndex({ sumber: 1, database_name: 1, kode_toko: 1, id_sumber: 1 }, { unique: true, name: 'uniq_tt_sinkronisasi_sumber_database' });
    else console.warn('Index sinkronisasi sumber ditunda karena ada dokumen duplikat yang perlu direkonsiliasi.');
  }

  // Mapping rekening sekarang berlaku per jenis bisnis + rekening sumber,
  // bukan per cabang. Hapus index lama yang masih memaksa setiap cabang
  // memiliki mapping terpisah.
  let mappingIndexes = await NagagoldAccountMapping.collection.indexes();
  for (const legacyIndex of mappingIndexes) {
    const fields = Object.keys(legacyIndex.key || {});
    const obsolete = ['uniq_nagagold_mapping_context', 'uniq_nagagold_mapping_source_account'].includes(legacyIndex.name)
      || (fields.includes('kode_toko') && fields.includes('metode_pembayaran'))
      || (fields.includes('kode_bank') && fields.includes('nomor_rekening'));
    if (obsolete && legacyIndex.name !== '_id_') {
      await NagagoldAccountMapping.collection.dropIndex(legacyIndex.name);
      console.info(`Index mapping lama ${legacyIndex.name} dihapus; mapping kini berlaku per jenis bisnis dan rekening sumber.`);
    }
  }
  mappingIndexes = await NagagoldAccountMapping.collection.indexes();
  if (!mappingIndexes.some((index) => index.name === 'uniq_nagagold_mapping_source_account_number')) {
    const duplicateMappings = await NagagoldAccountMapping.collection.aggregate([
      { $group: { _id: { source_system: '$source_system', unit: '$unit', nomor_rekening: { $ifNull: ['$nomor_rekening', ''] } }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateMappings) await NagagoldAccountMapping.collection.createIndex({ source_system: 1, unit: 1, nomor_rekening: 1 }, { unique: true, name: 'uniq_nagagold_mapping_source_account_number' });
    else console.warn('Index mapping rekening sumber ditunda karena masih ada mapping duplikat yang perlu direkonsiliasi.');
  }

  const bankIndexes = await Bank.collection.indexes();
  for (const legacyIndex of bankIndexes.filter((index) => ['code', 'kodeBank'].some((field) => index.key?.[field]))) {
    const legacyField = Object.keys(legacyIndex.key).find((field) => ['code', 'kodeBank'].includes(field));
    const duplicateLegacyValues = await Bank.collection.aggregate([
      { $match: { [legacyField]: { $exists: true, $nin: ['', null] } } },
      { $group: { _id: `$${legacyField}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateLegacyValues) {
      await Bank.collection.dropIndex(legacyIndex.name);
      console.info(`Index legacy tm_bank ${legacyIndex.name} dihapus; index canonical kode_bank tetap digunakan.`);
    } else {
      console.warn(`Index legacy tm_bank ${legacyIndex.name} dipertahankan karena masih ada nilai ${legacyField} duplikat.`);
    }
  }
  const accountIndexes = await Account.collection.indexes();
  const legacyAccountIndex = accountIndexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ bentuk_saldo: 1, unit: 1, kode_toko: 1 }));
  if (legacyAccountIndex) await Account.collection.dropIndex(legacyAccountIndex.name);
  if (!accountIndexes.some((index) => index.name === 'uniq_active_cash_account_kind')) {
    const duplicateCash = await Account.collection.aggregate([
      { $match: { bentuk_saldo: 'KAS_TUNAI', aktif: true, jenis_akun: { $in: [ACCOUNT_KINDS.STORE_CASH, ACCOUNT_KINDS.OPERATING_CASH] } } },
      { $group: { _id: { unit: '$unit', kode_toko: '$kode_toko', jenis_akun: '$jenis_akun' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateCash) await Account.collection.createIndex({ bentuk_saldo: 1, unit: 1, kode_toko: 1, jenis_akun: 1 }, { unique: true, partialFilterExpression: { bentuk_saldo: 'KAS_TUNAI', aktif: true, jenis_akun: { $in: [ACCOUNT_KINDS.STORE_CASH, ACCOUNT_KINDS.OPERATING_CASH] } }, name: 'uniq_active_cash_account_kind' });
    else console.warn('Index akun kas tunai ditunda karena ditemukan duplikasi existing.');
  }
  if (!accountIndexes.some((index) => index.name === 'uniq_account_code')) {
    const duplicateCodes = await Account.collection.aggregate([
      { $match: { kode_akun: { $exists: true, $nin: ['', null] } } },
      { $group: { _id: '$kode_akun', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    const emptyCodeCount = await Account.countDocuments({ kode_akun: '' });
    if (!duplicateCodes && !emptyCodeCount) await Account.collection.createIndex({ kode_akun: 1 }, { unique: true, sparse: true, name: 'uniq_account_code' });
    else console.warn('Index kode akun unik ditunda karena ditemukan kode duplikat atau akun lama tanpa kode.');
  }
  if (!accountIndexes.some((index) => index.name === 'uniq_active_bank_account')) {
    const duplicateBankAccounts = await Account.collection.aggregate([
      { $match: { aktif: true, bentuk_saldo: 'REKENING_BANK', bank_id: { $ne: null }, nomor_rekening: { $nin: ['', null] } } },
      { $group: { _id: { bank_id: '$bank_id', nomor_rekening: '$nomor_rekening' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateBankAccounts) await Account.collection.createIndex({ bank_id: 1, nomor_rekening: 1 }, { unique: true, partialFilterExpression: { aktif: true, bentuk_saldo: 'REKENING_BANK' }, name: 'uniq_active_bank_account' });
    else console.warn('Index rekening bank unik ditunda karena ditemukan rekening fisik duplikat existing.');
  }
  const duplicateLogicalJournals = await JournalEntry.collection.aggregate([
    { $match: { no_transaksi: { $exists: true, $ne: '' } } },
    { $group: { _id: { no_transaksi: '$no_transaksi', tipe: '$tipe' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 },
  ]).toArray();
  if (duplicateLogicalJournals.length) console.warn(`Pemeriksaan jurnal menemukan ${duplicateLogicalJournals.length} kelompok jurnal duplikat; index unik tidak boleh dipaksakan sebelum rekonsiliasi.`);
  let currentJournalIndexes = await JournalEntry.collection.indexes();
  // Struktur lama memakai index unik no_jurnal dan pasangan no_transaksi +
  // tipe_jurnal. Keduanya tidak boleh dibiarkan karena dokumen flat baru
  // memang boleh memiliki no_transaksi yang sama pada dua rekening mutasi.
  for (const index of currentJournalIndexes) {
    const key = JSON.stringify(index.key || {});
    const obsolete = ['uniq_tt_keuangan_no_jurnal', 'uniq_tt_keuangan_transaksi_tipe', 'idx_tt_keuangan_mutasi_tipe'].includes(index.name)
      || key.includes('no_jurnal')
      || key.includes('tipe_jurnal')
      || key.includes('no_mutasi');
    if (obsolete && index.name !== '_id_') {
      await JournalEntry.collection.dropIndex(index.name);
    }
  }
  currentJournalIndexes = await JournalEntry.collection.indexes();
  if (!currentJournalIndexes.some((index) => index.name === 'uniq_tt_keuangan_no_keuangan')) {
    await JournalEntry.collection.createIndex({ no_keuangan: 1 }, { unique: true, name: 'uniq_tt_keuangan_no_keuangan' });
  }
  if (!currentJournalIndexes.some((index) => ['idx_tt_keuangan_transaksi_tipe', 'uniq_tt_keuangan_transaksi_tipe'].includes(index.name))) {
    // MongoDB yang dipakai tidak mendukung $ne di partial index. Karena
    // no_transaksi selalu string, $gt: '' mengecualikan saldo awal yang kosong.
    const indexOptions = { name: 'idx_tt_keuangan_transaksi_tipe', partialFilterExpression: { no_transaksi: { $gt: '' } } };
    await JournalEntry.collection.createIndex({ no_transaksi: 1, tipe: 1 }, indexOptions);
  }
  if (!currentJournalIndexes.some((index) => index.name === 'idx_tt_keuangan_status_tanggal_rekening')) {
    await JournalEntry.collection.createIndex(
      { status: 1, tanggal: 1, rekening_id: 1 },
      { name: 'idx_tt_keuangan_status_tanggal_rekening' },
    );
  }
  const openingIndexes = await OpeningBalance.collection.indexes();
  if (!openingIndexes.some((index) => index.name === 'uniq_active_opening_balance')) {
    const duplicateActiveOpening = await OpeningBalance.collection.aggregate([
      { $match: { status: { $in: ['PENDING_APPROVAL', 'APPROVED'] } } },
      { $group: { _id: '$rekening_id', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateActiveOpening) {
      await OpeningBalance.collection.createIndex(
        { rekening_id: 1 },
        { unique: true, partialFilterExpression: { status: { $in: ['PENDING_APPROVAL', 'APPROVED'] } }, name: 'uniq_active_opening_balance' },
      );
    } else console.warn('Index saldo awal unik per rekening ditunda karena ditemukan saldo awal aktif duplikat existing.');
  }
  if (!openingIndexes.some((index) => index.name === 'uniq_applied_opening_balance')) {
    const duplicateOpening = await OpeningBalance.collection.aggregate([
      { $match: { status: 'APPROVED', status_valid: true } },
      { $group: { _id: { rekening_id: '$rekening_id', tanggal: '$tanggal' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]).hasNext();
    if (!duplicateOpening) await OpeningBalance.collection.createIndex({ rekening_id: 1, tanggal: 1 }, { unique: true, partialFilterExpression: { status: 'APPROVED', status_valid: true }, name: 'uniq_applied_opening_balance' });
    else console.warn('Index saldo awal unik ditunda karena ditemukan saldo awal approved duplikat existing.');
  }
}

function sourceDate(value, fallback = now()) {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function sourceBusinessDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(sourceDate(value));
}

function sourceIdOf(item) {
  return String(item._id || item.source_id || item.sourceId || item.no_reff || item.no_ref || '').trim();
}

function sourceReferenceOf(item) {
  return String(item.no_reff || item.no_ref || item.source_no_reff || item.sourceNoReff || '').trim();
}

function sourceRequestIdOf(item) {
  return String(item.request_id || item.requestId || '').trim();
}

function sourceDirection(item) {
  const incoming = Number(item.jumlah_in || item.amount_in || item.nilai_masuk_rp || 0);
  const outgoing = Number(item.jumlah_out || item.amount_out || item.nilai_keluar_rp || 0);
  if (incoming > 0 && outgoing > 0) throw new HttpError(422, `Transaksi sumber ${sourceIdOf(item)} memiliki jumlah masuk dan keluar sekaligus.`);
  if (incoming > 0) return { amount: incoming, direction: 'MASUK' };
  if (outgoing > 0) return { amount: outgoing, direction: 'KELUAR' };
  // OPTIK menyimpan arah buku pada type_trx (D = masuk/debet, K =
  // keluar/kredit). Jumlah masuk/keluar tetap menjadi sumber nominal utama;
  // fallback ini hanya dipakai bila sumber mengirim total_rp tanpa mengisi
  // salah satu kolom jumlah tersebut.
  const total = Number(item.total_rp || item.totalRp || item.nominal || 0);
  const type = String(item.type_trx || '').trim().toUpperCase();
  if (total > 0 && type === 'D') return { amount: total, direction: 'MASUK' };
  if (total > 0 && type === 'K') return { amount: total, direction: 'KELUAR' };
  return { amount: 0, direction: 'MASUK' };
}

async function findSourceAccountCandidates(item, branch) {
  const noRekening = normalizeNagagoldValue(item.source_no_rekening || item.sourceNoRekening || item.no_rekening || item.noRekening);
  const unit = sourceBusinessUnit(branch);
  const metodePembayaran = sourcePaymentMethod(item).toUpperCase();
  if (branch.jenisBisnis === 'OPTIK' && metodePembayaran === 'BPJS') {
    return Account.find({
      aktif: true,
      unit,
      kelompok_rekening: 'KAS_KECIL',
      bentuk_saldo: 'KAS_TUNAI',
    }).populate({ path: 'bank_id', select: 'kode_bank nama_bank' }).sort({ created_at: 1, _id: 1 }).limit(1).lean();
  }
  if (branch.jenisBisnis === 'OPTIK' && ['QRIS', 'GOPAY'].includes(metodePembayaran)) {
    const bank = await Bank.findOne({ kode_bank: 'BCA', aktif: true }).select('_id').lean();
    if (!bank) return [];
    return Account.find({
      aktif: true,
      unit,
      kelompok_rekening: 'KAS_KECIL',
      bentuk_saldo: 'REKENING_BANK',
      bank_id: bank._id,
    }).populate({ path: 'bank_id', select: 'kode_bank nama_bank' }).sort({ created_at: 1, _id: 1 }).limit(1).lean();
  }
  if (isCashPayment(item)) {
    return Account.find({
      aktif: true,
      unit,
      // Semua transaksi yang datang dari sumber operasional (Nagagold/Optik)
      // wajib masuk ke penyimpanan operasional Kas Kecil. Jangan memilih akun
      // tunai Kas Besar/Kas Utama hanya karena akun itu kebetulan satu-satunya
      // kandidat yang tersedia.
      kelompok_rekening: 'KAS_KECIL',
      bentuk_saldo: 'KAS_TUNAI',
    }).populate({ path: 'bank_id', select: 'kode_bank nama_bank' }).sort({ created_at: 1 }).lean();
  }
  if (!noRekening) return [];
  // Nomor rekening adalah identitas rekening sumber untuk seluruh sistem
  // sinkronisasi. Format kode bank pada sumber dapat berbeda dari Finance,
  // sedangkan nama bank hanya informasi tampilan. Jika nomor rekening sama
  // pada lebih dari satu rekening Finance, hasilnya tetap ambigu dan harus
  // dipetakan secara eksplisit.
  return Account.find({
    nomor_rekening: noRekening,
    aktif: true,
    unit,
    kelompok_rekening: 'KAS_KECIL',
    bentuk_saldo: 'REKENING_BANK',
  }).populate({ path: 'bank_id', select: 'kode_bank nama_bank' }).lean();
}

function mappingContextFor(item, branch) {
  const source = sourceConfigForBranch(branch);
  const metodePembayaran = sourcePaymentMethod(item).toUpperCase();
  const cash = isCashPayment(item);
  return {
    source_system: source.key,
    // Mapping berlaku untuk seluruh cabang dalam unit bisnis yang sama. Kode
    // toko tetap disimpan sebagai metadata pada transaksi sumber, bukan kunci
    // pemetaan rekening.
    kode_toko: '*',
    unit: sourceBusinessUnit(branch),
    metode_pembayaran: metodePembayaran,
    kode_bank: cash ? '' : normalizeNagagoldValue(item.source_kode_bank || item.sourceKodeBank || item.kode_bank || item.kodeBank).toUpperCase(),
    nomor_rekening: cash ? '' : normalizeNagagoldValue(item.source_no_rekening || item.sourceNoRekening || item.no_rekening || item.noRekening),
  };
}

async function resolveNagagoldAccount(item, branch) {
  const context = mappingContextFor(item, branch);
  const sourceIsCash = isCashPayment(item);
  const metodePembayaran = sourcePaymentMethod(item).toUpperCase();
  const isOptikBpjs = branch.jenisBisnis === 'OPTIK' && metodePembayaran === 'BPJS';
  const isOptikDigitalPayment = branch.jenisBisnis === 'OPTIK' && ['QRIS', 'GOPAY'].includes(metodePembayaran);
  const mappingKey = {
    source_system: context.source_system,
    unit: context.unit,
    nomor_rekening: context.nomor_rekening,
  };
  // Untuk sementara Finance memakai aturan tetap pada metode khusus Optik:
  // BPJS ke kas tunai Kas Kecil pertama, sedangkan QRIS/GOPAY ke rekening BCA
  // Kas Kecil pertama. Tidak ada lookup ke collection klaim BPJS dan tidak ada
  // pembuatan rekening otomatis jika master belum tersedia.
  if (isOptikBpjs || isOptikDigitalPayment) {
    const candidates = await findSourceAccountCandidates(item, branch);
    if (candidates.length === 1) {
      return {
        account: candidates[0],
        status: 'TERPETAKAN',
        reason: isOptikBpjs
          ? 'BPJS Optik sementara dibukukan ke kas tunai Kas Kecil pertama.'
          : `Pembayaran ${metodePembayaran} Optik sementara dibukukan ke rekening BCA Kas Kecil pertama.`,
        candidateIds: [id(candidates[0]._id)],
        ruleKey: isOptikBpjs ? 'OPTIK_BPJS_DEFAULT_CASH' : 'OPTIK_DIGITAL_DEFAULT_BCA',
      };
    }
    return {
      account: null,
      status: 'PERLU_PEMETAAN',
      reason: isOptikBpjs
        ? 'Kas tunai Kas Kecil Optik belum tersedia.'
        : 'Rekening BCA Kas Kecil Optik belum tersedia.',
      candidateIds: candidates.map((account) => id(account._id)),
      ruleKey: isOptikBpjs ? 'OPTIK_BPJS_DEFAULT_CASH' : 'OPTIK_DIGITAL_DEFAULT_BCA',
    };
  }
  const configured = await NagagoldAccountMapping.find({ ...mappingKey, aktif: true }).sort({ dibuat_pada: 1 }).lean();
  if (configured.length > 1) {
    return { account: null, status: 'PEMETAAN_AMBIGU', reason: 'Terdapat lebih dari satu konfigurasi mapping aktif untuk jenis bisnis, bank, dan rekening sumber ini.', candidateIds: configured.map((mapping) => id(mapping.rekening_id)), ruleKey: 'CONFIGURED_MAPPING' };
  }
  if (configured.length === 1) {
    const account = await Account.findOne({ _id: configured[0].rekening_id, aktif: true }).populate({ path: 'bank_id', select: 'kode_bank nama_bank' }).lean();
    if (!account) return { account: null, status: 'GAGAL_MAPPING', reason: 'Konfigurasi mapping menunjuk ke rekening yang sudah tidak aktif atau tidak ditemukan.', candidateIds: [id(configured[0].rekening_id)], ruleKey: 'CONFIGURED_MAPPING' };
    if (account.unit !== context.unit || account.kelompok_rekening !== 'KAS_KECIL' || (sourceIsCash ? account.bentuk_saldo !== 'KAS_TUNAI' : account.bentuk_saldo !== 'REKENING_BANK')) {
      return {
        account: null,
        status: 'GAGAL_MAPPING',
        reason: sourceIsCash
          ? 'Mapping transaksi CASH sumber hanya boleh menuju akun TUNAI pada Kas Kecil dengan jenis bisnis yang sama.'
          : 'Mapping transaksi rekening sumber hanya boleh menuju rekening bank pada Kas Kecil dengan jenis bisnis yang sama.',
        candidateIds: [id(account._id)],
        ruleKey: 'CONFIGURED_MAPPING_INVALID_LEVEL',
      };
    }
    return { account, status: 'TERPETAKAN', reason: 'Mapping jenis bisnis dan rekening sumber digunakan.', candidateIds: [id(account._id)], ruleKey: 'CONFIGURED_MAPPING' };
  }
  const candidates = await findSourceAccountCandidates(item, branch);
  if (candidates.length === 1) return { account: candidates[0], status: 'TERPETAKAN', reason: 'Mapping unik ditemukan dari Master Rekening berdasarkan konteks sumber.', candidateIds: [id(candidates[0]._id)], ruleKey: 'DIRECT_MASTER_UNIQUE' };
  if (candidates.length > 1) return { account: null, status: 'PEMETAAN_AMBIGU', reason: 'Lebih dari satu rekening cocok; Admin harus memilih mapping yang benar.', candidateIds: candidates.map((account) => id(account._id)), ruleKey: 'DIRECT_MASTER_AMBIGUOUS' };
  return { account: null, status: 'PERLU_PEMETAAN', reason: isCashPayment(item)
    ? `Kas tunai unit ${context.unit} belum memiliki rekening penyimpanan TUNAI yang cocok.`
    : 'Rekening sumber belum ditemukan berdasarkan jenis bisnis dan nomor rekening.', candidateIds: [], ruleKey: 'DIRECT_MASTER_NOT_FOUND' };
}

function invoiceType(invoiceNumber, category = '') {
  const value = String(invoiceNumber || '').toUpperCase();
  if (value.includes('-FJ-') || value.startsWith('FJ')) return 'FJ';
  if (value.includes('-FB-') || value.startsWith('FB')) return 'FB';
  const sourceCategory = String(category || '').toUpperCase();
  if (sourceCategory.includes('BELI') || sourceCategory === 'PEMBELIAN') return 'FB';
  if (sourceCategory.includes('JUAL') || sourceCategory === 'PENJUALAN') return 'FJ';
  return '';
}

function sourceInvoiceDetails(item) {
  const category = String(item.kategori || item.kategori_sumber || '').toUpperCase();
  const rawDetails = Array.isArray(item.detail_transaction) ? item.detail_transaction : [];
  const details = rawDetails.map((detail) => ({
    nomorFaktur: String(detail.no_faktur || detail.no_faktur_jual || detail.no_faktur_beli || '').trim(),
    jenisFaktur: invoiceType(detail.no_faktur || detail.no_faktur_jual || detail.no_faktur_beli, category),
    nilaiFaktur: Number(detail.harga_total || detail.harga || detail.harga_nota || 0),
    isLm: Boolean(detail.is_lm),
    isBerlian: Boolean(detail.is_berlian),
    isAcc: Boolean(detail.is_acc),
  })).filter((detail) => detail.nomorFaktur);
  const fallbackNumbers = Array.isArray(item.no_faktur_list) ? item.no_faktur_list : (Array.isArray(item.no_faktur) ? item.no_faktur : []);
  for (const number of fallbackNumbers) {
    const nomorFaktur = String(number || '').trim();
    if (nomorFaktur && !details.some((detail) => detail.nomorFaktur === nomorFaktur)) details.push({ nomorFaktur, jenisFaktur: invoiceType(nomorFaktur, category), nilaiFaktur: 0, isLm: false, isBerlian: false, isAcc: false });
  }
  // OPTIK tidak mempunyai detail_transaction pada tt_cash_daily. Referensi
  // faktur tetap tercatat di deskripsi, misalnya:
  // "KTJ-FJ-261015-0001 REFUND REVISI FJ-260613-0002".
  const description = String(item.deskripsi || item.keterangan || '').toUpperCase();
  const descriptionNumbers = description.match(/\b(?:[A-Z0-9]+-)?F[JB]-\d{6}-\d{4}\b/g) || [];
  for (const number of descriptionNumbers) {
    const nomorFaktur = String(number || '').trim();
    if (nomorFaktur && !details.some((detail) => detail.nomorFaktur === nomorFaktur)) details.push({ nomorFaktur, jenisFaktur: invoiceType(nomorFaktur, category), nilaiFaktur: 0, isLm: false, isBerlian: false, isAcc: false });
  }
  return details;
}

function likelyEncryptedSourceText(value) {
  const text = String(value || '').trim();
  return text.length >= 8 && text.length % 2 === 0 && /^[0-9a-f]+$/i.test(text);
}

function sourceDecryptionAudit(item, branch) {
  const keyConfigured = Boolean(getNagagoldDecryptionKey(branch));
  const fields = { jenis: item.jenis, kategori: item.kategori || item.kategori_sumber, deskripsi: item.deskripsi, keterangan: item.keterangan };
  const unreadableFields = Object.entries(fields).filter(([, value]) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(String(value || ''))).map(([field]) => field);
  const likelyEncryptedFields = Object.entries(fields).filter(([, value]) => likelyEncryptedSourceText(value)).map(([field]) => field);
  if (unreadableFields.length) return { status: 'UNREADABLE', note: `Nilai sumber tidak printable pada field: ${unreadableFields.join(', ')}.` };
  if (likelyEncryptedFields.length) return { status: keyConfigured ? 'UNREADABLE' : 'KEY_NOT_CONFIGURED', note: keyConfigured ? `Hasil dekripsi belum dapat dibaca pada field: ${likelyEncryptedFields.join(', ')}.` : `Key dekripsi belum tersedia untuk field: ${likelyEncryptedFields.join(', ')}.` };
  return { status: keyConfigured ? 'READABLE' : 'NOT_APPLICABLE', note: keyConfigured ? 'Field sumber berhasil melewati pemeriksaan keterbacaan.' : 'Respons sumber diasumsikan sudah plaintext; key dekripsi tidak digunakan.' };
}

function sourceFinalityAudit(item, branch = {}) {
  const source = sourceConfigForBranch(branch);
  if (source.code === 'OPTIK') {
    if (item.status_valid === true) return { status: 'FINAL_CONFIRMED', note: 'status_valid OPTIK bernilai true.' };
    return { status: 'FINALITY_UNPROVEN', note: 'Transaksi OPTIK hanya dapat diproses jika status_valid bernilai true.' };
  }
  const status = String(item.status || '').trim().toUpperCase();
  if (status === 'OPEN') return { status: 'FINAL_CONFIRMED', note: 'Status OPEN diperlakukan sebagai transaksi yang sudah divalidasi kasir Nagagold sesuai aturan bisnis Finance.' };
  if (status === 'DONE') return { status: 'FINALITY_UNPROVEN', note: 'Kode Nagagold mengubah status DONE menjadi OPEN saat validasi cash; DONE tidak dianggap final tanpa aturan bisnis tambahan.' };
  return { status: 'FINALITY_UNPROVEN', note: `Status sumber ${status || 'KOSONG'} belum dianggap final sebelum aturan finalitas Nagagold disahkan.` };
}

function sourceSnapshotFingerprint(snapshot) {
  const canonical = JSON.stringify({
    sourceRequestId: snapshot.sourceRequestId || '',
    sourceNoReff: snapshot.sourceNoReff || '',
    sourceTanggal: snapshot.sourceTanggal || '',
    sourceNoRekening: snapshot.sourceNoRekening || '',
    sourceKodeBank: snapshot.sourceKodeBank || '',
    sourceAmountIn: Number(snapshot.sourceAmountIn || 0),
    sourceAmountOut: Number(snapshot.sourceAmountOut || 0),
    jenisSumber: snapshot.jenisSumber || '',
    kategoriSumber: snapshot.kategoriSumber || '',
    statusSumber: snapshot.statusSumber || '',
    sourceDeskripsi: snapshot.sourceDeskripsi || '',
    sourceKeterangan: snapshot.sourceKeterangan || '',
    sourceInvoiceNumbers: snapshot.sourceInvoiceNumbers || [],
    sourceDetailTransaction: snapshot.sourceDetailTransaction || [],
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function buildSourceSnapshot(item, branch) {
  const source = sourceConfigForBranch(branch);
  const invoiceDetails = sourceInvoiceDetails(item);
  const snapshot = {
    sourceRequestId: sourceRequestIdOf(item),
    sourceNoReff: sourceReferenceOf(item),
    sourceTanggal: String(item.tanggal || sourceDate(item.input_date).toISOString().slice(0, 10)).slice(0, 10),
    sourceNoRekening: normalizeNagagoldValue(item.no_rekening || item.noRekening),
    sourceKodeBank: normalizeNagagoldValue(item.kode_bank || item.kodeBank).toUpperCase(),
    sourceNamaBank: normalizeNagagoldValue(item.nama_bank || item.namaBank),
    sourceAmountIn: Number(item.jumlah_in || item.amount_in || item.nilai_masuk_rp || 0),
    sourceAmountOut: Number(item.jumlah_out || item.amount_out || item.nilai_keluar_rp || 0),
    jenisSumber: String(item.jenis || item.jenis_sumber || '').toUpperCase(),
    kategoriSumber: String(item.kategori || item.kategori_sumber || '').toUpperCase(),
    statusSumber: String(item.status || '').toUpperCase(),
    sourceIsValidate: typeof item.status_valid === 'boolean' ? item.status_valid : (typeof item.is_validate === 'boolean' ? item.is_validate : null),
    sourceStatusReceive: typeof item.status_receive === 'boolean' ? item.status_receive : null,
    sourceInputDate: item.input_date || item.inputDate || null,
    sourceDeskripsi: String(item.deskripsi || '').trim(),
    sourceKeterangan: String(item.keterangan || item.notes || item.note || '').trim(),
    sourceDetailTransaction: Array.isArray(item.detail_transaction) ? item.detail_transaction : [],
    sourceInvoiceNumbers: invoiceDetails.map((detail) => detail.nomorFaktur),
    detailFaktur: invoiceDetails.map((detail) => detail.nomorFaktur),
    sourceInvoiceDetails: invoiceDetails,
  };
  const decryption = sourceDecryptionAudit(item, branch);
  const finality = sourceFinalityAudit(item, branch);
  return {
    ...snapshot,
    sourceSnapshotAt: now(),
    sourceSnapshotProvenance: { sourceSystem: source.key, jenisBisnis: branch.jenisBisnis || source.code, sourceCollection: source.collection, kodeToko: branch.kodeToko, databaseName: branch.databaseName, readMode: 'DIRECT_MONGODB', capturedAt: now().toISOString() },
    sourceSnapshotFingerprint: sourceSnapshotFingerprint(snapshot),
    sourceSnapshotRecoveryStatus: 'NOT_NEEDED',
    sourceDecryptionStatus: decryption.status,
    sourceDecryptionNote: decryption.note,
    sourceFinalityStatus: finality.status,
    sourceFinalityNote: finality.note,
  };
}

function buildNagagoldSourceSnapshot(item, branch) {
  return buildSourceSnapshot(item, branch);
}

async function ingestNagagoldItems(branch, items) {
  const source = sourceConfigForBranch(branch);
  let inserted = 0;
  let updated = 0;
  let posted = 0;
  let skippedOpeningBalances = 0;
  for (const item of items) {
    if (isNagagoldOpeningBalance(item)) {
      skippedOpeningBalances += 1;
      continue;
    }
    // OPTIK hanya mengirim transaksi yang sudah dinyatakan valid. Record
    // draft, batal, atau belum tervalidasi tidak boleh masuk ke Finance.
    if (source.code === 'OPTIK' && item.status_valid !== true) continue;
    const sourceId = sourceIdOf(item);
    if (!sourceId) continue;
    const sourceKey = `${source.key}:${branch.databaseName}:${branch.kodeToko}:${source.collection}:${sourceId}`;
    const direction = sourceDirection(item);
    if (!direction.amount) continue;
    const requestId = sourceRequestIdOf(item);
    const existing = await SyncTransaction.findOne({
      sumber: source.code,
      database_name: branch.databaseName,
      kode_toko: branch.kodeToko,
      id_sumber: sourceId,
    });
    const mapping = await resolveNagagoldAccount(item, branch);
    const account = mapping.account;
    const financeAccount = financeAccountSnapshot(account);
    const sourceSnapshot = buildSourceSnapshot(item, branch);
    const sourceStatus = String(item.status || '').toUpperCase();
    const mapped = Boolean(account);
    const importedState = importedSyncState(item, mapping, branch);
    const existingJournal = existing ? await findTransactionJournal(existing) : null;
    const transactionData = {
      bentukTransaksi: 'MUTASI_REKENING',
      kategori_sistem: 'TRANSAKSI',
      transactionDate: sourceSnapshot.sourceTanggal,
      jenisTransaksi: 'MUTASI_REKENING',
      jenisRequest: String(item.kategori || item.kategori_sumber || item.jenis || 'TRANSAKSI_NAGAGOLD').toUpperCase(),
      requestId,
      arahDana: direction.direction,
      kodeToko: branch.kodeToko,
      namaTokoSnapshot: branch.namaToko,
      cabang_id: branch.id || null,
      sourceAccountId: null,
      destinationAccountId: null,
      rekeningId: account?._id || null,
      // Field rekening/bank pada tt_sinkronisasi selalu snapshot dari master
      // Finance hasil mapping. Nilai mentah sumber ada di source_*.
      no_rekening: financeAccount.no_rekening,
      kode_bank: financeAccount.kode_bank,
      nama_bank: financeAccount.nama_bank,
      nama_rekening: financeAccount.nama_rekening,
      bank_id: financeAccount.bank_id,
      amount: direction.amount,
      note: sourceSnapshot.sourceKeterangan || sourceSnapshot.sourceDeskripsi,
      isImported: true,
      jenis_bisnis: String(branch.jenisBisnis || 'NAGAGOLD').trim().toUpperCase(),
      // Simpan identitas database sumber yang sebenarnya. Kode toko tetap
      // disimpan pada `kodeToko`; kedua nilai ini berbeda dan diperlukan untuk
      // audit, recovery snapshot, serta rekonsiliasi lintas cabang.
      sourceDatabase: branch.databaseName,
      source_database_name: branch.databaseName,
      database_name: branch.databaseName,
      sourceCollection: NAGAGOLD_COLLECTION,
      sourceId,
      sourceKey,
      source_transaction_id: sourceId,
      sourceNoReff: sourceSnapshot.sourceNoReff,
      source_no_rekening: sourceSnapshot.sourceNoRekening,
      source_kode_bank: sourceSnapshot.sourceKodeBank,
      source_nama_bank: sourceSnapshot.sourceNamaBank,
      sourceTanggal: sourceSnapshot.sourceTanggal,
      sourceDeskripsi: sourceSnapshot.sourceDeskripsi,
      sourceKeterangan: sourceSnapshot.sourceKeterangan,
      sourceDetailTransaction: sourceSnapshot.sourceDetailTransaction,
      source_amount_in: sourceSnapshot.sourceAmountIn,
      source_amount_out: sourceSnapshot.sourceAmountOut,
      jenisSumber: sourceSnapshot.jenisSumber,
      kategoriSumber: sourceSnapshot.kategoriSumber,
      statusSumber: sourceStatus,
      sourceIsValidate: sourceSnapshot.sourceIsValidate,
      sourceStatusReceive: sourceSnapshot.sourceStatusReceive,
      mappingStatus: mapping.status,
      mappingReason: mapping.reason,
      mappingCheckedAt: now(),
      mappingRuleKey: mapping.ruleKey,
      mappingCandidateIds: mapping.candidateIds,
      sourceDecryptionStatus: sourceSnapshot.sourceDecryptionStatus,
      sourceDecryptionNote: sourceSnapshot.sourceDecryptionNote,
      sourceSnapshotAt: sourceSnapshot.sourceSnapshotAt,
      sourceSnapshotProvenance: sourceSnapshot.sourceSnapshotProvenance,
      sourceSnapshotFingerprint: sourceSnapshot.sourceSnapshotFingerprint,
      sourceSnapshotRecoveryStatus: sourceSnapshot.sourceSnapshotRecoveryStatus,
      sourceFinalityStatus: sourceSnapshot.sourceFinalityStatus,
      sourceFinalityNote: sourceSnapshot.sourceFinalityNote,
      source_payment_method: sourcePaymentMethod(item),
      detailFaktur: sourceSnapshot.detailFaktur,
      sourceIsValidate: sourceSnapshot.sourceIsValidate,
      status: existing?.status === 'APPROVED' || existing?.status === 'REJECTED' ? existing.status : 'MENUNGGU_VALIDASI_ADMIN',
      source_type: SOURCE_TYPES.SYNC,
      sync_status: existing?.status === 'APPROVED' || existing?.status === 'REJECTED' ? (existing?.sync_status || importedState.status) : importedState.status,
      sync_message: existing?.status === 'APPROVED' || existing?.status === 'REJECTED' ? (existing?.sync_message || importedState.message) : importedState.message,
      approval_status: existing?.approval_status || (existing?.status === 'APPROVED' ? APPROVAL_STATUSES.APPROVED : existing?.status === 'REJECTED' ? APPROVAL_STATUSES.REJECTED : APPROVAL_STATUSES.NOT_STARTED),
      payment_status: PAYMENT_STATUSES.NOT_APPLICABLE,
      journal_status: existing?.journal_status || inferJournalStatus(existing || {}, existingJournal),
      finance_transaction_id: existing?.finance_transaction_id || id(existing?._id),
      reconciliation_status: existing?.reconciliation_status || RECONCILIATION_STATUSES.UNMATCHED,
      matched_transaction_id: existing?.matched_transaction_id || '',
      matched_at: existing?.matched_at || null,
      matched_by: existing?.matched_by || '',
      match_method: existing?.match_method || '',
      match_reference: existing?.match_reference || '',
      reconciliation_note: existing?.reconciliation_note || '',
    };
    if (existing) {
      const refreshData = existing.status === 'APPROVED' || existing.status === 'REJECTED'
        ? { requestId: transactionData.requestId, statusSumber: transactionData.statusSumber, sourceIsValidate: transactionData.sourceIsValidate, sourceStatusReceive: transactionData.sourceStatusReceive, sourceNoReff: transactionData.sourceNoReff, source_no_rekening: transactionData.source_no_rekening, source_kode_bank: transactionData.source_kode_bank, source_nama_bank: transactionData.source_nama_bank, sourceTanggal: transactionData.sourceTanggal, sourceDeskripsi: transactionData.sourceDeskripsi, sourceKeterangan: transactionData.sourceKeterangan, sourceDetailTransaction: transactionData.sourceDetailTransaction, detailFaktur: transactionData.detailFaktur, source_amount_in: transactionData.source_amount_in, source_amount_out: transactionData.source_amount_out, jenisSumber: transactionData.jenisSumber, kategoriSumber: transactionData.kategoriSumber, source_database_name: transactionData.source_database_name, source_transaction_id: transactionData.source_transaction_id, source_payment_method: transactionData.source_payment_method, sourceDecryptionStatus: transactionData.sourceDecryptionStatus, sourceDecryptionNote: transactionData.sourceDecryptionNote, sourceSnapshotAt: transactionData.sourceSnapshotAt, sourceSnapshotProvenance: transactionData.sourceSnapshotProvenance, sourceSnapshotFingerprint: transactionData.sourceSnapshotFingerprint, sourceSnapshotRecoveryStatus: transactionData.sourceSnapshotRecoveryStatus, sourceFinalityStatus: transactionData.sourceFinalityStatus, sourceFinalityNote: transactionData.sourceFinalityNote, mappingReason: transactionData.mappingReason, mappingCheckedAt: transactionData.mappingCheckedAt, mappingRuleKey: transactionData.mappingRuleKey, mappingCandidateIds: transactionData.mappingCandidateIds, no_rekening: transactionData.no_rekening, kode_bank: transactionData.kode_bank, nama_bank: transactionData.nama_bank, nama_rekening: transactionData.nama_rekening, bank_id: transactionData.bank_id }
        : transactionData;
      await SyncTransaction.updateOne({ _id: existing._id }, { $set: { ...refreshData, status: existing.status } });
      const reconciliation = await refreshImportedReconciliation(existing._id);
      await classifyStoredNagagoldTransaction(await SyncTransaction.findById(existing._id), { classifiedBy: 'Sync Nagagold', reconciliationCandidateCount: reconciliation.candidates });
      const posting = await postImportedNagagoldTransaction(existing._id);
      if (posting.posted) posted += 1;
      updated += 1;
      continue;
    }
    const created = await SyncTransaction.create({ transactionNumber: await nextSyncNumber(sourceSnapshot.sourceTanggal), created_by: 'system', ...transactionData });
    const reconciliation = await refreshImportedReconciliation(created._id);
    await classifyStoredNagagoldTransaction(created, { classifiedBy: 'Sync Nagagold', reconciliationCandidateCount: reconciliation.candidates });
    const posting = await postImportedNagagoldTransaction(created._id);
    if (posting.posted) posted += 1;
    await Notification.create({ type: 'SOURCE_TRANSACTION', title: `Transaksi ${source.code} baru`, message: `${branch.kodeToko} memiliki transaksi ${created.kategoriSumber || created.jenisSumber} sebesar ${created.amount}.`, referenceType: 'SOURCE_TRANSACTION', referenceId: id(created._id) });
    inserted += 1;
  }
  return { inserted, updated, posted, skippedOpeningBalances };
}

async function reprocessNagagoldTransactions(branch) {
  const source = sourceConfigForBranch(branch);
  const limit = Math.min(5000, Math.max(1, Number(process.env.NAGAGOLD_SYNC_LIMIT || 1000)));
  const rows = await SyncTransaction.find(nagagoldTransactionQuery({
    sumber: source.code,
    database_name: branch.databaseName,
    kodeToko: branch.kodeToko,
    $or: [{ journal_status: { $ne: JOURNAL_STATUSES.POSTED } }, { saldo_status: { $ne: BALANCE_STATUSES.APPLIED } }],
  })).sort({ transactionDate: 1, createdAt: 1 }).limit(limit);
  let classified = 0;
  let posted = 0;
  for (const row of rows) {
    const reconciliation = await refreshImportedReconciliation(row._id);
    await classifyStoredNagagoldTransaction(await SyncTransaction.findById(row._id), { classifiedBy: 'Sync Nagagold', reconciliationCandidateCount: reconciliation.candidates });
    const result = await postImportedNagagoldTransaction(row._id);
    if (result.posted) posted += 1;
    classified += 1;
  }
  return { source: source.code, scanned: rows.length, classified, posted, perluDiperiksa: Math.max(rows.length - posted, 0) };
}

async function reprocessNagagoldTransactionsForBusiness(jenisBisnis) {
  const source = SOURCE_CONFIGS[normalizeSourceBusiness(jenisBisnis)];
  const limit = Math.min(50000, Math.max(1, Number(process.env.NAGAGOLD_SYNC_LIMIT || 1000)));
  const rows = await SyncTransaction.find(nagagoldTransactionQuery({
    sumber: source.code,
    $or: [{ journal_status: { $ne: JOURNAL_STATUSES.POSTED } }, { saldo_status: { $ne: BALANCE_STATUSES.APPLIED } }],
  })).sort({ transactionDate: 1, createdAt: 1 }).limit(limit);
  let classified = 0;
  let posted = 0;
  for (const row of rows) {
    const branch = await mappingBranch(row.kode_toko, source.code, row.cabang_id);
    const mapping = await resolveNagagoldAccount(row, branch);
    const financeAccount = financeAccountSnapshot(mapping.account);
    await SyncTransaction.updateOne(
      { _id: row._id },
      { $set: {
        rekening_id: mapping.account?._id || null,
        no_rekening: financeAccount.no_rekening,
        kode_bank: financeAccount.kode_bank,
        nama_bank: financeAccount.nama_bank,
        nama_rekening: financeAccount.nama_rekening,
        bank_id: financeAccount.bank_id,
        mappingStatus: mapping.status,
        mappingReason: mapping.reason,
        mappingCheckedAt: now(),
        mappingRuleKey: mapping.ruleKey,
        mappingCandidateIds: mapping.candidateIds || [],
      } },
    );
    const reconciliation = await refreshImportedReconciliation(row._id);
    await classifyStoredNagagoldTransaction(await SyncTransaction.findById(row._id), { classifiedBy: 'Finance Mapping', reconciliationCandidateCount: reconciliation.candidates });
    const result = await postImportedNagagoldTransaction(row._id);
    if (result.posted) posted += 1;
    classified += 1;
  }
  return { source: source.code, scanned: rows.length, classified, posted, perluDiperiksa: Math.max(rows.length - posted, 0) };
}

const nagagoldCashIgnoreFields = new Set(['no_reff', 'tanggal', 'deskripsi', 'deskripsi_bak', 'input_date', 'no_faktur', 'kode_bank', '_id', 'status', 'no_faktur_list']);
const optikCashIgnoreFields = new Set(['no_ref', 'tanggal', 'jam', 'type_trx', 'deskripsi', 'notes', 'input_date', 'kode_bank', 'no_rekening', 'status_valid', 'status', 'source_type', 'adjustment_parent_ref', '_id']);
const nagagoldAccountIgnoreFields = new Set(['kode_bank', '_id']);

function decryptNagagoldString(value, key) {
  if (!value || !key) return value;
  let result = '';
  let keyIndex = 0;
  for (let index = 0; index < value.length; index += 2) {
    const code = Number.parseInt(value.slice(index, index + 2), 16);
    if (Number.isNaN(code)) return value;
    result += String.fromCharCode(code - key.charCodeAt(keyIndex));
    // Ikuti Encryptor.decryptascii NAGAGOLD persis. Setelah key terakhir,
    // implementasi sumber mengatur index ke 0 lalu langsung menambah 1,
    // sehingga siklus berikutnya dimulai dari karakter kedua (bukan pertama).
    if (keyIndex === key.length - 1) keyIndex = 0;
    keyIndex += 1;
  }
  return result;
}

function decryptNagagoldValue(value, key, fieldName = '', ignoreFields = nagagoldCashIgnoreFields, encryptionMode = process.env.NAGAGOLD_ENCRYPTION_MODE) {
  if (!key || String(encryptionMode ?? '1') === '0') return value;
  if (fieldName && ignoreFields.has(fieldName)) return value;
  if (value instanceof Date || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => decryptNagagoldValue(item, key, '', ignoreFields, encryptionMode));
  if (typeof value === 'string') return decryptNagagoldString(value, key);
  if (typeof value !== 'object') return value;
  if (value._bsontype || value._bsontype === 'ObjectID') return value;
  return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, decryptNagagoldValue(item, key, field, ignoreFields, encryptionMode)]));
}

function getNagagoldDecryptionKey(branch) {
  const config = sourceConfigForBranch(branch);
  return String(process.env[config.keyEnv] || (config.code === 'OPTIK' ? process.env.NAGAGOLD_DECRYPTION_KEY : '') || '').trim();
}

function sourceEncryptionMode(branch) {
  const config = sourceConfigForBranch(branch);
  return process.env[config.modeEnv] ?? (config.code === 'OPTIK' ? process.env.NAGAGOLD_ENCRYPTION_MODE : '1') ?? '1';
}

function sourceIgnoreFields(branch, account = false) {
  const config = sourceConfigForBranch(branch);
  if (config.code === 'OPTIK') return account ? new Set(['_id', 'no_rekening', 'kode_bank']) : optikCashIgnoreFields;
  return account ? nagagoldAccountIgnoreFields : nagagoldCashIgnoreFields;
}

function sourceCursorQuery(from, to, afterCursor = null, { includeBusinessDate = false } = {}) {
  const businessDateClause = includeBusinessDate ? { tanggal: { $gte: sourceBusinessDate(from), $lte: sourceBusinessDate(to) } } : null;
  if (!afterCursor?.date) {
    const clauses = [{ input_date: { $gte: from, $lte: to } }];
    if (businessDateClause) clauses.push(businessDateClause);
    return clauses.length === 1 ? clauses[0] : { $or: clauses };
  }
  const cursorDate = new Date(afterCursor.date);
  if (Number.isNaN(cursorDate.getTime())) return sourceCursorQuery(from, to, null, { includeBusinessDate });
  const cursorObjectId = mongoose.isValidObjectId(afterCursor.id) ? new mongoose.Types.ObjectId(afterCursor.id) : null;
  const clauses = [{ input_date: { $gt: cursorDate, $lte: to } }];
  if (cursorObjectId) clauses.push({ input_date: cursorDate, _id: { $gt: cursorObjectId } });
  if (businessDateClause) clauses.push(businessDateClause);
  return { $or: clauses };
}

async function readNagagoldDirectly(branch, from, to, afterCursor = null, options = {}) {
  const source = sourceConfigForBranch(branch);
  const connection = await mongoose.createConnection(branch.mongodbUri, { dbName: branch.databaseName || undefined, serverSelectionTimeoutMS: 10000, maxPoolSize: 2 }).asPromise();
  try {
    const dateQuery = sourceCursorQuery(from, to, afterCursor, options);
    const query = source.code === 'OPTIK' ? { $and: [dateQuery, { status_valid: true }] } : dateQuery;
    const documents = await connection.db.collection(source.collection).find(query).sort({ input_date: 1, _id: 1 }).limit(Number(process.env[source.limitEnv] || process.env.NAGAGOLD_SYNC_LIMIT || 1000)).toArray();
    const key = String(sourceEncryptionMode(branch)) === '0' ? '' : getNagagoldDecryptionKey(branch);
    return documents.map((document) => decryptNagagoldValue(document, key, '', sourceIgnoreFields(branch), sourceEncryptionMode(branch)));
  } finally {
    await connection.close();
  }
}

async function readNagagoldAccountsDirectly(branch) {
  const source = sourceConfigForBranch(branch);
  const connection = await mongoose.createConnection(branch.mongodbUri, { dbName: branch.databaseName || undefined, serverSelectionTimeoutMS: 10000, maxPoolSize: 2 }).asPromise();
  try {
    const documents = await connection.db.collection('tm_rekening').find({}).sort({ no_rekening: 1 }).limit(Number(process.env.NAGAGOLD_ACCOUNT_LIMIT || 5000)).toArray();
    const key = String(sourceEncryptionMode(branch)) === '0' ? '' : getNagagoldDecryptionKey(branch);
    return documents.map((document) => decryptNagagoldValue(document, key, '', sourceIgnoreFields(branch, true), sourceEncryptionMode(branch)));
  } finally {
    await connection.close();
  }
}

function sourceIdCandidates(sourceIds = []) {
  const values = [...new Set(sourceIds.map((value) => String(value || '').trim()).filter(Boolean))];
  const candidates = [];
  for (const value of values) {
    candidates.push(value);
    if (mongoose.isValidObjectId(value)) candidates.push(new mongoose.Types.ObjectId(value));
  }
  return candidates;
}

async function readNagagoldDocumentsByIds(branch, sourceIds) {
  const source = sourceConfigForBranch(branch);
  const ids = sourceIdCandidates(sourceIds);
  if (!ids.length) return new Map();
  const connection = await mongoose.createConnection(branch.mongodbUri, { dbName: branch.databaseName || undefined, serverSelectionTimeoutMS: 10000, maxPoolSize: 2 }).asPromise();
  try {
    const documents = await connection.db.collection(source.collection).find({ _id: { $in: ids } }).limit(ids.length).toArray();
    const key = String(sourceEncryptionMode(branch)) === '0' ? '' : getNagagoldDecryptionKey(branch);
    return new Map(documents.map((document) => [sourceIdOf(document), decryptNagagoldValue(document, key, '', sourceIgnoreFields(branch), sourceEncryptionMode(branch))]));
  } finally {
    await connection.close();
  }
}

function snapshotMissingFields(transaction) {
  const missing = [];
  const cashSource = String(transaction.source_payment_method || transaction.sourcePaymentMethod || '').toUpperCase() === 'CASH' || String(transaction.sourceNoRekening || '').trim() === '-';
  const fields = [
    ['sourceKey', transaction.sourceKey],
    ['source_transaction_id', transaction.source_transaction_id || transaction.sourceId],
    ['source_database_name', transaction.source_database_name || transaction.sourceDatabase],
    ['kode_toko', transaction.kodeToko],
    ['sourceNoReff', transaction.sourceNoReff],
    ['jenisSumber', transaction.jenisSumber],
    ['sourceTanggal', transaction.sourceTanggal || transaction.transactionDate],
    ...(!cashSource ? [['sourceKodeBank', transaction.sourceKodeBank], ['sourceNoRekening', transaction.sourceNoRekening]] : []),
    ['source_amount_in/out', transaction.sourceSnapshotAt ? `${Number(transaction.source_amount_in || 0)}|${Number(transaction.source_amount_out || 0)}` : ''],
    ['statusSumber', transaction.statusSumber],
    ['sourceDeskripsi', transaction.sourceDeskripsi],
    ['sourceKeterangan', transaction.sourceKeterangan || transaction.note],
    ['sourceDetailTransaction', transaction.sourceDetailTransaction || transaction.sourceInvoiceDetails],
    ['sourceSnapshotAt', transaction.sourceSnapshotAt],
  ];
  for (const [field, value] of fields) if (value === undefined || value === null || value === '') missing.push(field);
  if (!transaction.sourceSnapshotAt) return [...new Set([...missing, 'snapshot sumber lengkap'])];
  return [...new Set(missing)];
}

function sourcePreviewPayload(snapshot, sourceId) {
  return {
    sourceId,
    noReff: snapshot.sourceNoReff,
    tanggal: snapshot.sourceTanggal,
    jenis: snapshot.jenisSumber,
    kategori: snapshot.kategoriSumber,
    noRekening: snapshot.sourceNoRekening,
    kodeBank: snapshot.sourceKodeBank,
    jumlahIn: snapshot.sourceAmountIn,
    jumlahOut: snapshot.sourceAmountOut,
    status: snapshot.statusSumber,
    isValidate: snapshot.sourceIsValidate,
    statusReceive: snapshot.sourceStatusReceive,
    deskripsi: snapshot.sourceDeskripsi,
    keterangan: snapshot.sourceKeterangan,
    noFakturList: snapshot.sourceInvoiceNumbers,
    decryptionStatus: snapshot.sourceDecryptionStatus,
    decryptionNote: snapshot.sourceDecryptionNote,
    finalityStatus: snapshot.sourceFinalityStatus,
    finalityNote: snapshot.sourceFinalityNote,
  };
}

function compareRecoverySource(transaction, snapshot, branch) {
  const sourceId = String(transaction.source_transaction_id || transaction.sourceId || '').trim();
  const source = sourceConfigForBranch(branch);
  const expectedKey = `${source.key}:${branch.databaseName}:${String(branch.kodeToko || '').toUpperCase()}:${source.collection}:${sourceId}`;
  const identityVerified = Boolean(sourceId && transaction.sourceKey === expectedKey);
  const sourceAmount = Number(snapshot.sourceAmountIn || snapshot.sourceAmountOut || 0);
  const amountConsistent = sourceAmount > 0 && sourceAmount === Number(transaction.amount || 0) && ((snapshot.sourceAmountIn > 0 && transaction.arahDana === 'MASUK') || (snapshot.sourceAmountOut > 0 && transaction.arahDana === 'KELUAR'));
  const storedFingerprint = String(transaction.sourceSnapshotFingerprint || '').trim();
  const sourceChangedSinceSnapshot = Boolean(storedFingerprint && storedFingerprint !== snapshot.sourceSnapshotFingerprint);
  const statusChangedSinceSnapshot = Boolean(transaction.statusSumber && snapshot.statusSumber && String(transaction.statusSumber).toUpperCase() !== String(snapshot.statusSumber).toUpperCase());
  const missingFields = snapshotMissingFields(transaction);
  const mismatchReasons = [];
  if (!identityVerified) mismatchReasons.push('sourceKey tidak sesuai dengan cabang dan ID sumber yang diminta.');
  if (!amountConsistent) mismatchReasons.push('Nominal atau arah dana sumber tidak konsisten dengan transaksi Finance.');
  if (sourceChangedSinceSnapshot) mismatchReasons.push('Fingerprint sumber berbeda dari snapshot Finance yang tersimpan.');
  const canPrepareRecovery = identityVerified && amountConsistent && !sourceChangedSinceSnapshot;
  return {
    sourceFound: true,
    identityVerified,
    amountConsistent,
    sourceChangedSinceSnapshot,
    statusChangedSinceSnapshot,
    missingFields,
    mismatchReasons,
    recoveryStatus: canPrepareRecovery ? (missingFields.length ? 'PENDING_APPLY' : 'PREVIEW_MATCH') : 'PREVIEW_MISMATCH',
    canPrepareRecovery,
  };
}

async function getRecoveryBranch(transaction) {
  const kodeToko = String(transaction.kodeToko || '').trim().toUpperCase();
  const storedDatabase = String(transaction.source_database_name || transaction.sourceDatabase || '').trim();
  const source = sourceConfigForTransaction(transaction);
  const branch = storedDatabase
    ? await Branch.findOne({ ...branchBusinessQuery(source.code), database_name: storedDatabase }).lean()
    : await Branch.findOne(branchIdentityQuery({ kodeToko, jenisBisnis: source.code })).lean();
  const databaseName = storedDatabase || String(branch?.database_name || '').trim();
  const mongodbUri = String(process.env[source.uriEnv] || process.env.NAGAGOLD_MONGODB_URI || '').trim();
  if (!kodeToko || !databaseName || !mongodbUri) return null;
  return { kodeToko, namaToko: branch?.nama_toko || transaction.namaTokoSnapshot || '', databaseName, mongodbUri, jenisBisnis: source.code, unit: source.code, encryptionMode: process.env[source.modeEnv] || process.env.NAGAGOLD_ENCRYPTION_MODE || '1' };
}

async function previewNagagoldSnapshotRecovery(transactions) {
  const grouped = new Map();
  for (const transaction of transactions) {
    const branch = await getRecoveryBranch(transaction);
    const groupKey = branch ? `${branch.kodeToko}|${branch.databaseName}` : `MISSING|${transaction.kodeToko || ''}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, { branch, transactions: [] });
    grouped.get(groupKey).transactions.push(transaction);
  }
  const result = [];
  for (const group of grouped.values()) {
    const sourceIds = group.transactions.map((transaction) => transaction.source_transaction_id || transaction.sourceId);
    let sourceDocuments = new Map();
    let sourceError = '';
    if (group.branch) {
      try { sourceDocuments = await readNagagoldDocumentsByIds(group.branch, sourceIds); } catch (error) { sourceError = 'Database sumber tidak dapat dibaca dalam mode read-only.'; }
    }
    for (const transaction of group.transactions) {
      const sourceId = String(transaction.source_transaction_id || transaction.sourceId || '').trim();
      const sourceDocument = sourceDocuments.get(sourceId);
      const base = { transactionId: id(transaction._id), transactionNumber: transaction.transactionNumber, kodeToko: transaction.kodeToko, sourceId, sourceDatabaseName: transaction.source_database_name || transaction.sourceDatabase || '', financeAmount: Number(transaction.amount || 0), financeDirection: transaction.arahDana, currentSnapshotAt: transaction.sourceSnapshotAt || null, currentRecoveryStatus: transaction.sourceSnapshotRecoveryStatus || 'UNKNOWN', missingFields: snapshotMissingFields(transaction), sourceFound: Boolean(sourceDocument), sourceError, action: 'PERLU_DIPERIKSA' };
      if (!group.branch) { result.push({ ...base, recoveryStatus: 'SOURCE_NOT_FOUND', reason: 'Konfigurasi cabang atau nama database sumber tidak ditemukan.' }); continue; }
      if (sourceError) { result.push({ ...base, recoveryStatus: 'ERROR', reason: sourceError }); continue; }
      if (!sourceDocument) { result.push({ ...base, recoveryStatus: 'SOURCE_NOT_FOUND', reason: 'Dokumen tt_cash_daily dengan ID sumber tersebut tidak ditemukan.' }); continue; }
      const snapshot = buildNagagoldSourceSnapshot(sourceDocument, group.branch);
      const comparison = compareRecoverySource(transaction, snapshot, group.branch);
      result.push({ ...base, ...comparison, currentSource: sourcePreviewPayload(snapshot, sourceId), sourceSnapshotProvenance: snapshot.sourceSnapshotProvenance, candidateMetadata: comparison.canPrepareRecovery ? snapshot : null, action: comparison.canPrepareRecovery && comparison.missingFields.length ? 'SIAP_PREVIEW_PULIHKAN' : comparison.canPrepareRecovery ? 'TIDAK_ADA_FIELD_HILANG' : 'JANGAN_PULIHKAN' });
    }
  }
  return result;
}

function snapshotRecoveryPreviewToken(rows) {
  const proof = rows.map((row) => ({
    transactionId: row.transactionId,
    sourceId: row.sourceId,
    identityVerified: row.identityVerified,
    amountConsistent: row.amountConsistent,
    sourceChangedSinceSnapshot: row.sourceChangedSinceSnapshot,
    sourceFingerprint: row.candidateMetadata?.sourceSnapshotFingerprint || '',
  })).sort((left, right) => left.transactionId.localeCompare(right.transactionId));
  return crypto.createHash('sha256').update(JSON.stringify(proof)).digest('hex');
}

function nagagoldMappingSummary(transactions) {
  const summary = { total: transactions.length, mappingUnique: 0, mappingMissing: 0, mappingAmbiguous: 0, mappingFailed: 0, decryptionFailed: 0, finalityUnverified: 0, snapshotComplete: 0, snapshotMissing: 0, recoveryApplied: 0, recoveryPending: 0, byReason: {} };
  for (const transaction of transactions) {
    const mappingStatus = String(transaction.mappingStatus || '').toUpperCase();
    if (mappingStatus === 'TERPETAKAN') summary.mappingUnique += 1;
    else if (mappingStatus === 'PEMETAAN_AMBIGU') summary.mappingAmbiguous += 1;
    else if (mappingStatus === 'GAGAL_MAPPING') summary.mappingFailed += 1;
    else summary.mappingMissing += 1;
    if (['UNREADABLE', 'KEY_NOT_CONFIGURED'].includes(String(transaction.sourceDecryptionStatus || '').toUpperCase())) summary.decryptionFailed += 1;
    if (['OPEN_UNVERIFIED', 'FINALITY_UNPROVEN', 'UNVERIFIED'].includes(String(transaction.sourceFinalityStatus || '').toUpperCase())) summary.finalityUnverified += 1;
    const missing = snapshotMissingFields(transaction);
    if (missing.length) summary.snapshotMissing += 1; else summary.snapshotComplete += 1;
    if (transaction.sourceSnapshotRecoveryStatus === 'APPLIED') summary.recoveryApplied += 1;
    if (transaction.sourceSnapshotRecoveryStatus === 'PENDING_APPLY') summary.recoveryPending += 1;
    const reason = transaction.mappingReason || transaction.sync_message || 'Belum ada alasan pemetaan.';
    summary.byReason[reason] = (summary.byReason[reason] || 0) + 1;
  }
  return { ...summary, byReason: Object.entries(summary.byReason).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
}

function mappingSourceItem(body) {
  const requestedNumber = normalizeNagagoldValue(body.nomorRekening || body.nomor_rekening);
  const requestedMethod = String(body.metodePembayaran || body.metode_pembayaran || body.jenisPembayaran || body.jenis_pembayaran || '').trim().toUpperCase();
  const isCash = requestedMethod === 'CASH' || requestedMethod === 'TUNAI' || !requestedNumber;
  const method = isCash ? 'CASH' : requestedMethod || 'BANK';
  return {
    jenis: isCash ? 'CASH' : method || 'BANK',
    no_rekening: isCash ? '-' : requestedNumber,
    kode_bank: isCash ? '' : String(body.kodeBank || body.kode_bank || '').trim().toUpperCase(),
    paymentMethod: method,
  };
}

function mappingBusiness(jenisBisnis = '') {
  const requestedSource = normalizeSourceBusiness(jenisBisnis);
  const source = SOURCE_CONFIGS[requestedSource];
  return {
    unit: requestedSource,
    jenisBisnis: requestedSource,
    sourceSystem: source.key,
  };
}

async function mappingBranch(kodeToko, sourceSystem = '', cabangId = '') {
  const requestedSource = normalizeSourceBusiness(sourceSystem);
  let branch = null;
  if (cabangId && mongoose.isValidObjectId(cabangId)) {
    branch = await Branch.findOne({ _id: cabangId, aktif: { $ne: false } }).lean();
    if (branch && normalizeSourceBusiness(branch.jenis_bisnis) !== requestedSource) throw new HttpError(422, 'Jenis sumber dan cabang tidak sesuai.');
  }
  if (!branch) branch = await Branch.findOne({ ...branchIdentityQuery({ kodeToko, jenisBisnis: requestedSource }), aktif: { $ne: false } }).lean();
  if (!branch) throw new HttpError(422, 'Kode toko tidak ditemukan di tm_cabang.');
  const jenisBisnis = String(branch.jenis_bisnis || 'NAGAGOLD').trim().toUpperCase();
  return { id: id(branch._id), kodeToko: branch.kode_toko, namaToko: branch.nama_toko, databaseName: branch.database_name, unit: jenisBisnis, jenisBisnis, sourceSystem: sourceConfigForBranch({ jenisBisnis }).key };
}

async function validateNagagoldMappingAccount({ branch, body }) {
  const accountId = body.rekeningId || body.rekening_id || body.accountId;
  if (!mongoose.isValidObjectId(accountId)) throw new HttpError(422, 'Rekening Finance untuk mapping tidak valid.');
  const account = await Account.findOne({ _id: accountId, aktif: true }).lean();
  if (!account) throw new HttpError(422, 'Rekening Finance tidak ditemukan atau tidak aktif.');
  const sourceItem = mappingSourceItem(body);
  const method = sourcePaymentMethod(sourceItem);
  const cash = method === 'CASH' || method === 'BPJS';
  if (cash) {
    if (account.bentuk_saldo !== 'KAS_TUNAI' || account.kelompok_rekening !== 'KAS_KECIL' || account.unit !== branch.unit) throw new HttpError(422, 'Mapping kas tunai sumber hanya boleh ke akun TUNAI pada Kas Kecil dengan jenis bisnis sumber yang sama.');
  } else {
    // Kode bank sumber tidak selalu memakai format kode yang sama dengan
    // master Finance (contoh: sumber dapat mengirim 014, sedangkan Finance
    // menyimpan kode internal/nama bank). Rekening tujuan dipilih eksplisit
    // oleh Admin, jadi cukup pastikan bentuk akun dan jenis bisnisnya sesuai.
    if (account.bentuk_saldo !== 'REKENING_BANK' || account.kelompok_rekening !== 'KAS_KECIL' || account.unit !== branch.unit) throw new HttpError(422, 'Mapping rekening bank sumber harus memakai rekening bank aktif pada Kas Kecil dengan jenis bisnis sumber yang sama.');
  }
  return { account, method, sourceItem };
}

async function readNagagoldFromEndpoint(branch, from, to) {
  const source = sourceConfigForBranch(branch);
  const url = new URL(branch.syncUrl);
  url.searchParams.set('from', from.toISOString());
  url.searchParams.set('to', to.toISOString());
  url.searchParams.set('collection', source.collection);
  url.searchParams.set('limit', String(Number(process.env[source.limitEnv] || process.env.NAGAGOLD_SYNC_LIMIT || 1000)));
  const response = await fetch(url, { headers: { Accept: 'application/json', ...(branch.token ? { Authorization: `Bearer ${branch.token}` } : {}) } });
  if (!response.ok) throw new Error(`Cabang ${branch.kodeToko} mengembalikan HTTP ${response.status}.`);
  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : (payload.items || payload.data || payload.transactions || []);
  if (!Array.isArray(items)) throw new Error(`Respons sync cabang ${branch.kodeToko} tidak memiliki array items/data/transactions.`);
  return source.code === 'OPTIK' ? items.filter((item) => item.status_valid === true) : items;
}

async function fetchNagagoldBranch(branch) {
  const source = sourceConfigForBranch(branch);
  const state = await SyncState.findOneAndUpdate(
    { sourceSystem: source.key, sourceDatabase: branch.databaseName, kodeToko: branch.kodeToko, sourceCollection: source.collection },
    { $setOnInsert: { sourceSystem: source.key, sourceDatabase: branch.databaseName, kodeToko: branch.kodeToko, sourceCollection: source.collection } },
    { upsert: true, new: true }
  );
  const startedAt = now();
  await SyncState.updateOne({ _id: state._id }, { $set: { lastStartedAt: startedAt, lastError: '' } });
  try {
    const intervalMinutes = Number(process.env.NAGAGOLD_SYNC_INTERVAL_MINUTES || 10);
    const lookbackMinutes = Number(process.env.NAGAGOLD_SYNC_LOOKBACK_MINUTES || 2);
    const initialMinutes = Number(process.env.NAGAGOLD_SYNC_INITIAL_LOOKBACK_MINUTES || 60);
    const until = now();
    const rollingDays = Number(process.env.NAGAGOLD_SYNC_RECONCILE_DAYS || 3);
    const rollingDate = new Date(until.getTime() - rollingDays * 24 * 60 * 60 * 1000);
    const configuredInitialFrom = process.env.NAGAGOLD_SYNC_INITIAL_FROM ? sourceDate(process.env.NAGAGOLD_SYNC_INITIAL_FROM, new Date(Date.now() - initialMinutes * 60 * 1000)) : new Date(Date.now() - initialMinutes * 60 * 1000);
    const limit = Number(process.env[source.limitEnv] || process.env.NAGAGOLD_SYNC_LIMIT || 1000);
    const importedExists = Boolean(await SyncTransaction.exists({ sumber: source.code, database_name: branch.databaseName, kode_toko: branch.kodeToko }));
    // Jika seluruh dokumen sinkronisasi hasil uji dihapus, cursor lama tidak
    // boleh membuat worker melewati transaksi sumber. Reset hanya ketika
    // sebelumnya memang pernah mengambil data; state kosong tanpa data sumber
    // tetap tidak dipaksa fetch berulang tanpa batas.
    const resetInitialCursor = !importedExists && (
      state.initialSyncCompleted !== true
      || Number(state.lastFetchedCount || 0) > 0
      || Boolean(state.cursorInputDate)
      || Boolean(state.cursorSourceId)
    );
    const initialSync = state.initialSyncCompleted !== true || resetInitialCursor;
    const afterCursor = initialSync && !resetInitialCursor && state.cursorInputDate
      ? { date: state.cursorInputDate, id: state.cursorSourceId }
      : null;
    const cursorDate = initialSync
      ? (afterCursor?.date ? new Date(afterCursor.date) : configuredInitialFrom)
      : computeSyncWindowStart(state.cursorInputDate, rollingDate, lookbackMinutes, configuredInitialFrom);
    // `input_date` dapat lebih lama daripada `tanggal` ketika data sumber
    // dipatch, dipulihkan, atau dibuat ulang. Tetap gunakan cursor input_date
    // untuk incremental fetch, tetapi sertakan rentang tanggal bisnis yang
    // terbatas agar transaksi tanggal 3 yang baru masuk tidak terlewat hanya
    // karena cursor sudah bergerak melewati input_date-nya.
    const items = branch.mongodbUri ? await readNagagoldDirectly(branch, cursorDate, until, afterCursor, { includeBusinessDate: true }) : await readNagagoldFromEndpoint(branch, cursorDate, until);
    const result = await ingestNagagoldItems(branch, items);
    const reprocessed = await reprocessNagagoldTransactions(branch);
    const latestItem = items[items.length - 1] || null;
    const latest = latestItem ? sourceDate(latestItem.input_date || latestItem.inputDate || latestItem.tanggal, until) : cursorDate;
    const previousCursor = state.cursorInputDate ? state.cursorInputDate.getTime() : 0;
    const nextCursor = initialSync
      ? new Date(Math.min(until.getTime(), Math.max(resetInitialCursor ? 0 : previousCursor, latest.getTime())))
      : new Date(Math.min(until.getTime(), Math.max(previousCursor, latest.getTime())));
    const initialSyncCompleted = initialSync ? items.length < limit : true;
    await SyncState.updateOne({ _id: state._id }, { $set: { cursorInputDate: nextCursor, cursorSourceId: sourceIdOf(latestItem || {}), initialSyncCompleted, lastSuccessAt: now(), lastFetchedAt: now(), lastFetchedCount: items.length, lastInsertedCount: result.inserted, lastUpdatedCount: result.updated, lastError: '' } });
    return { kodeToko: branch.kodeToko, sumber: source.code, fetched: items.length, initialSync, initialSyncCompleted, ...result, reprocessed, intervalMinutes };
  } catch (error) {
    await SyncState.updateOne({ _id: state._id }, { $set: { lastError: error.message, lastFetchedAt: now() } });
    throw error;
  }
}

async function runNagagoldSync() {
  if (nagagoldSyncRunning) return { skipped: true, reason: 'Sinkronisasi transaksi terintegrasi masih berjalan.' };
  // Sinkronisasi dapat dipanggil dari scheduler maupun tombol UI. Keduanya
  // harus mengikuti aturan tutup periode agar transaksi baru tidak masuk di
  // belakang tanggal sistem yang belum ditutup. Gunakan hasil skipped agar
  // scheduler tidak mengisi log error setiap interval.
  const periodStatus = await periodStatusPayload();
  if (periodStatus.requiresClose) return { skipped: true, reason: `Periode ${periodStatus.closeDate} belum ditutup.` };
  nagagoldSyncRunning = true;
  try {
  const branches = await getNagagoldBranches();
  if (!branches.length) return { skipped: true, reason: 'Belum ada cabang aktif di tm_cabang.' };
  const results = [];
  for (const branch of branches) {
    try { results.push(await fetchNagagoldBranch(branch)); } catch (error) { results.push({ kodeToko: branch.kodeToko, error: error.message }); }
  }
  return { skipped: false, results };
  } finally {
    nagagoldSyncRunning = false;
  }
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'finance-sambas-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.get('/api/system', asyncRoute(async (req, res) => {
  const profile = await ensureSystemProfile();
  res.json(systemProfilePayload(profile));
}));

app.get('/api/period-status', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  res.json(await periodStatusPayload());
}));

app.patch('/api/system', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const update = {};
  if (body.tglSystem !== undefined || body.tgl_system !== undefined) {
    const date = normalizeBusinessDate(body.tglSystem ?? body.tgl_system, '');
    if (!date) throw new HttpError(422, 'Tanggal sistem harus berformat YYYY-MM-DD.');
    update.tgl_system = date;
  }
  if (body.kodeToko !== undefined || body.kode_toko !== undefined) update.kode_toko = String(body.kodeToko ?? body.kode_toko).trim().toUpperCase();
  if (body.namaToko !== undefined || body.nama_toko !== undefined) update.nama_toko = String(body.namaToko ?? body.nama_toko).trim();
  if (body.noTelp !== undefined || body.no_telp !== undefined) update.no_telp = String(body.noTelp ?? body.no_telp).trim();
  if (body.alamat !== undefined) update.alamat = String(body.alamat).trim();
  if (!Object.keys(update).length) throw new HttpError(422, 'Tidak ada data profil sistem yang diubah.');
  const profile = await SystemProfile.findOneAndUpdate({ _id: SYSTEM_PROFILE_ID }, { $set: update, $setOnInsert: { _id: SYSTEM_PROFILE_ID, tgl_system: today(), kode_toko: 'FINANCE', nama_toko: 'Finance Sambas' } }, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
  res.json(systemProfilePayload(profile));
}));

app.get('/api/logs', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const type = String(req.query?.type || '').trim().toUpperCase();
  const query = type ? { type } : {};
  const logs = await SystemLog.find(query).sort({ waktu: -1, _id: -1 }).limit(100).lean();
  res.json(logs.map(systemLogPayload));
}));

app.get('/api/banks', asyncRoute(async (req, res) => {
  const banks = await Bank.collection.find({ $or: [{ aktif: true }, { isActive: true }, { aktif: { $exists: false }, isActive: { $exists: false } }] }).sort({ nama_bank: 1, name: 1 }).toArray();
  res.json(banks.map(serializeBank));
}));

app.get('/api/business-types', asyncRoute(async (req, res) => {
  const items = await BusinessType.find({ aktif: true }).sort({ nama_bisnis: 1, kode_bisnis: 1 }).lean();
  res.json(items.map(serializeBusinessType));
}));

app.post('/api/business-types', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const code = String(body.code || body.kodeBisnis || body.kode_bisnis || '').trim().toUpperCase();
  const name = String(body.name || body.namaBisnis || body.nama_bisnis || '').trim().toUpperCase();
  if (!code || !name) throw new HttpError(422, 'Kode dan nama jenis bisnis wajib diisi.');
  const activeDuplicate = await BusinessType.findOne({ aktif: true, $or: [{ kode_bisnis: code }, { nama_bisnis: name }] });
  if (activeDuplicate) throw new HttpError(409, 'Kode atau nama jenis bisnis sudah digunakan.');
  const reusable = await BusinessType.findOne({ aktif: false, $or: [{ kode_bisnis: code }, { nama_bisnis: name }] });
  if (reusable) {
    const updated = await BusinessType.findByIdAndUpdate(reusable._id, { $set: { kode_bisnis: code, nama_bisnis: name, aktif: true } }, { new: true, runValidators: true });
    await AuditLog.create({ actor: actor(req), action: 'BUSINESS_TYPE_REACTIVATED', entityType: 'BUSINESS_TYPE', entityId: id(updated._id), before: serializeBusinessType(reusable), after: serializeBusinessType(updated), correlationId: createNumber('BISNIS') });
    return res.status(200).json(serializeBusinessType(updated));
  }
  const item = await BusinessType.create({ kode_bisnis: code, nama_bisnis: name, aktif: true });
  await AuditLog.create({ actor: actor(req), action: 'BUSINESS_TYPE_CREATED', entityType: 'BUSINESS_TYPE', entityId: id(item._id), after: serializeBusinessType(item), correlationId: createNumber('BISNIS') });
  res.status(201).json(serializeBusinessType(item));
}));

app.patch('/api/business-types/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const item = await BusinessType.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Jenis bisnis tidak ditemukan.');
  const update = {};
  if (req.body.name !== undefined || req.body.namaBisnis !== undefined || req.body.nama_bisnis !== undefined) {
    const name = String(req.body.name ?? req.body.namaBisnis ?? req.body.nama_bisnis ?? '').trim().toUpperCase();
    if (!name) throw new HttpError(422, 'Nama jenis bisnis wajib diisi.');
    update.nama_bisnis = name;
  }
  if (req.body.aktif !== undefined) update.aktif = Boolean(req.body.aktif);
  const updated = await BusinessType.findByIdAndUpdate(item._id, { $set: update }, { new: true, runValidators: true });
  await AuditLog.create({ actor: actor(req), action: 'BUSINESS_TYPE_UPDATED', entityType: 'BUSINESS_TYPE', entityId: id(updated._id), before: serializeBusinessType(item), after: serializeBusinessType(updated), correlationId: createNumber('BISNIS') });
  res.json(serializeBusinessType(updated));
}));

app.delete('/api/business-types/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const item = await BusinessType.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Jenis bisnis tidak ditemukan.');
  const updated = await BusinessType.findByIdAndUpdate(item._id, { $set: { aktif: false } }, { new: true });
  await AuditLog.create({ actor: actor(req), action: 'BUSINESS_TYPE_DEACTIVATED', entityType: 'BUSINESS_TYPE', entityId: id(updated._id), before: serializeBusinessType(item), after: serializeBusinessType(updated), correlationId: createNumber('BISNIS') });
  res.json(serializeBusinessType(updated));
}));

const CASH_LEVEL_ALIASES = Object.freeze({ UTAMA: 'KAS_UTAMA', KAS_UTAMA: 'KAS_UTAMA', BESAR: 'KAS_BESAR', KAS_BESAR: 'KAS_BESAR', KECIL: 'KAS_KECIL', KAS_KECIL: 'KAS_KECIL' });
const CASH_UNITS = ['NAGAGOLD', 'OPTIK', 'PUSAT', 'BERSAMA'];

function normalizeCashLevel(value) {
  return CASH_LEVEL_ALIASES[String(value || '').trim().toUpperCase()] || '';
}

function normalizeCashUnit(value) {
  return String(value || '').trim().toUpperCase() || 'PUSAT';
}

function cashCodeToken(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42) || 'KELOMPOK';
}

async function generateCashTypeCode() {
  const existing = await CashType.find({ kode_jenis: /^KS[0-9]+$/ }).select('kode_jenis').lean();
  const used = new Set(existing.map((item) => Number(String(item.kode_jenis).slice(2))).filter(Number.isFinite));
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return `KS${String(sequence).padStart(3, '0')}`;
}

async function validateCashTypeStructure({ type, parentId, unit, excludeId = '' }) {
  const normalizedType = normalizeCashLevel(type);
  const normalizedUnit = normalizeCashUnit(unit);
  if (!normalizedType) throw new HttpError(422, 'Tingkat kas wajib dipilih: UTAMA, BESAR, atau KECIL.');
  if (!CASH_UNITS.includes(normalizedUnit)) throw new HttpError(422, 'Unit bisnis kelompok kas tidak valid.');
  if (normalizedType === 'KAS_UTAMA') {
    if (parentId) throw new HttpError(422, 'Kas tingkat UTAMA tidak boleh memiliki kelompok induk.');
    if (!['PUSAT', 'BERSAMA'].includes(normalizedUnit)) throw new HttpError(422, 'Kas tingkat UTAMA harus menggunakan unit PUSAT atau BERSAMA.');
    return { type: normalizedType, unit: normalizedUnit, parent: null };
  }
  if (!parentId || !mongoose.isValidObjectId(parentId)) throw new HttpError(422, `${normalizedType === 'KAS_BESAR' ? 'Kas tingkat BESAR' : 'Kas tingkat KECIL'} wajib memiliki kelompok induk.`);
  if (excludeId && String(parentId) === String(excludeId)) throw new HttpError(422, 'Kelompok kas tidak boleh menjadi induk untuk dirinya sendiri.');
  const parent = await CashType.findOne({ _id: parentId, aktif: true });
  if (!parent) throw new HttpError(422, 'Kelompok induk tidak ditemukan atau tidak aktif.');
  const expectedParentType = normalizedType === 'KAS_BESAR' ? 'KAS_UTAMA' : 'KAS_BESAR';
  if (parent.tipe_kas !== expectedParentType) throw new HttpError(422, `${normalizedType === 'KAS_BESAR' ? 'Kas BESAR' : 'Kas KECIL'} hanya boleh berada di bawah ${normalizedType === 'KAS_BESAR' ? 'Kas UTAMA' : 'Kas BESAR'}.`);
  if (normalizedType === 'KAS_KECIL' && normalizedUnit !== parent.unit) throw new HttpError(422, 'Unit bisnis Kas Kecil harus mengikuti Kas Besar induknya.');
  if (normalizedType === 'KAS_BESAR' && !['PUSAT', 'BERSAMA'].includes(parent.unit) && normalizedUnit !== parent.unit) throw new HttpError(422, 'Unit bisnis Kas Besar harus mengikuti unit kelompok induknya.');
  return { type: normalizedType, unit: normalizedType === 'KAS_KECIL' ? parent.unit : normalizedUnit, parent };
}

app.get('/api/cash-types', asyncRoute(async (req, res) => {
  const [items, accounts, children] = await Promise.all([
    CashType.find({ aktif: true }).sort({ urutan: 1, kode_jenis: 1 }).lean(),
    Account.aggregate([{ $match: { pos_kas_id: { $ne: null } } }, { $group: { _id: '$pos_kas_id', count: { $sum: 1 } } }]),
    CashType.aggregate([{ $match: { parent_id: { $ne: null } } }, { $group: { _id: '$parent_id', count: { $sum: 1 } } }]),
  ]);
  const accountCounts = new Map(accounts.map((item) => [String(item._id), item.count]));
  const childCounts = new Map(children.map((item) => [String(item._id), item.count]));
  const names = new Map(items.map((item) => [String(item._id), item.nama_jenis]));
  res.json(items.map((item) => serializeCashType({ ...item, account_count: accountCounts.get(String(item._id)) || 0, child_count: childCounts.get(String(item._id)) || 0, parent_name: names.get(String(item.parent_id)) || '' })));
}));

app.post('/api/cash-types', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || body.namaJenis || body.nama_jenis || '').trim().toUpperCase();
  const type = normalizeCashLevel(body.type || body.tipeKas || body.tipe_kas);
  const unit = normalizeCashUnit(body.unit || body.unitType || 'PUSAT');
  const parentId = body.parentId || body.parent_id || null;
  const order = Number(body.order ?? body.urutan ?? 0);
  if (!name) throw new HttpError(422, 'Nama kelompok kas wajib diisi.');
  const structure = await validateCashTypeStructure({ type, parentId, unit });
  const requestedCode = String(body.code || body.kodeJenis || body.kode_jenis || `KAS_${cashCodeToken(name)}`).trim().toUpperCase();
  const reusable = await CashType.findOne({ aktif: false, $or: [{ kode_jenis: requestedCode }, { nama_jenis: name }] });
  if (reusable) {
    const updated = await CashType.findByIdAndUpdate(reusable._id, { $set: { nama_jenis: name, tipe_kas: structure.type, unit: structure.unit, parent_id: structure.parent?._id || null, urutan: Number.isFinite(order) ? order : 0, aktif: true } }, { new: true, runValidators: true });
    await AuditLog.create({ actor: actor(req), action: 'CASH_TYPE_REACTIVATED', entityType: 'CASH_TYPE', entityId: id(updated._id), before: serializeCashType(reusable), after: serializeCashType(updated), correlationId: createNumber('KAS') });
    return res.status(200).json(serializeCashType(updated));
  }
  const code = await generateCashTypeCode();
  const item = await CashType.create({ kode_jenis: code, nama_jenis: name, tipe_kas: structure.type, unit: structure.unit, parent_id: structure.parent?._id || null, urutan: Number.isFinite(order) ? order : 0, aktif: true, sistem: false });
  await AuditLog.create({ actor: actor(req), action: 'CASH_TYPE_CREATED', entityType: 'CASH_TYPE', entityId: id(item._id), after: serializeCashType(item), correlationId: createNumber('KAS') });
  res.status(201).json(serializeCashType(item));
}));

app.patch('/api/cash-types/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const item = await CashType.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Kelompok kas tidak ditemukan.');
  const update = {};
  if (body.name !== undefined || body.namaJenis !== undefined || body.nama_jenis !== undefined) {
    const name = String(body.name ?? body.namaJenis ?? body.nama_jenis ?? '').trim().toUpperCase();
    if (!name) throw new HttpError(422, 'Nama jenis kas wajib diisi.');
    update.nama_jenis = name;
  }
  if (body.order !== undefined || body.urutan !== undefined) {
    const order = Number(body.order ?? body.urutan);
    if (!Number.isFinite(order)) throw new HttpError(422, 'Urutan jenis kas harus berupa angka.');
    update.urutan = order;
  }
  const requestedType = body.type !== undefined || body.tipeKas !== undefined || body.tipe_kas !== undefined ? normalizeCashLevel(body.type || body.tipeKas || body.tipe_kas) : item.tipe_kas;
  const requestedParentId = body.parentId !== undefined || body.parent_id !== undefined ? (body.parentId || body.parent_id || null) : id(item.parent_id);
  const requestedUnit = body.unit !== undefined || body.unitType !== undefined ? normalizeCashUnit(body.unit || body.unitType) : item.unit;
  const structuralChange = requestedType !== item.tipe_kas || String(requestedParentId || '') !== String(item.parent_id || '') || requestedUnit !== item.unit;
  if (structuralChange) {
    const dependencyExists = await Promise.all([
      CashType.exists({ parent_id: item._id }),
      Account.exists({ pos_kas_id: item._id }),
    ]);
    if (dependencyExists.some(Boolean)) throw new HttpError(409, 'Tingkat, induk, atau unit kelompok kas tidak dapat diubah karena sudah memiliki anak atau rekening.');
    const structure = await validateCashTypeStructure({ type: requestedType, parentId: requestedParentId, unit: requestedUnit, excludeId: item._id });
    update.tipe_kas = structure.type;
    update.parent_id = structure.parent?._id || null;
    update.unit = structure.unit;
  }
  if (body.aktif !== undefined) {
    const active = Boolean(body.aktif);
    if (active && item.parent_id && !await CashType.exists({ _id: item.parent_id, aktif: true })) throw new HttpError(409, 'Kelompok induk harus aktif sebelum kelompok ini diaktifkan.');
    update.aktif = active;
  }
  const updated = await CashType.findByIdAndUpdate(item._id, { $set: update }, { new: true, runValidators: true });
  await AuditLog.create({ actor: actor(req), action: 'CASH_TYPE_UPDATED', entityType: 'CASH_TYPE', entityId: id(updated._id), before: serializeCashType(item), after: serializeCashType(updated), correlationId: createNumber('KAS') });
  res.json(serializeCashType(updated));
}));

app.delete('/api/cash-types/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const item = await CashType.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Kelompok kas tidak ditemukan.');
  if (await CashType.exists({ parent_id: item._id })) throw new HttpError(409, 'Kelompok kas masih memiliki kelompok anak. Nonaktifkan atau hapus kelompok anak terlebih dahulu.');
  if (await Account.exists({ pos_kas_id: item._id })) throw new HttpError(409, 'Kelompok kas sudah memiliki rekening atau histori rekening. Gunakan Nonaktifkan.');
  const updated = await CashType.findByIdAndUpdate(item._id, { $set: { aktif: false } }, { new: true });
  await AuditLog.create({ actor: actor(req), action: 'CASH_TYPE_DEACTIVATED', entityType: 'CASH_TYPE', entityId: id(updated._id), before: serializeCashType(item), after: serializeCashType(updated), correlationId: createNumber('KAS') });
  res.json(serializeCashType(updated));
}));

function registerMasterOptionRoutes(path, model, entityType, label) {
  app.get(path, asyncRoute(async (req, res) => {
    const items = await model.find({ aktif: true }).sort({ urutan: 1, kode_jenis: 1 });
    res.json(items.map(serializeMasterOption));
  }));

  app.post(path, requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
    const body = req.body || {};
    const code = String(body.code || body.kodeJenis || body.kode_jenis || '').trim().toUpperCase();
    const name = String(body.name || body.namaJenis || body.nama_jenis || '').trim().toUpperCase();
    const order = Number(body.order ?? body.urutan ?? 0);
    // Kode master diisi oleh pengguna, jadi tidak dibatasi hanya huruf,
    // angka, dan garis bawah. Tetap trim + uppercase untuk menjaga bentuk
    // pencarian konsisten, serta tetap wajib diisi dan unik.
    if (!code) throw new HttpError(422, `Kode ${label} wajib diisi.`);
    if (!name) throw new HttpError(422, `Nama ${label} wajib diisi.`);
    const reusable = await model.findOne({ kode_jenis: code, aktif: false });
    if (reusable) {
      const updated = await model.findByIdAndUpdate(reusable._id, { $set: { nama_jenis: name, urutan: Number.isFinite(order) ? order : 0, aktif: true } }, { new: true, runValidators: true });
      await AuditLog.create({ actor: actor(req), action: `${entityType}_REACTIVATED`, entityType, entityId: id(updated._id), before: serializeMasterOption(reusable), after: serializeMasterOption(updated), correlationId: createNumber('MASTER') });
      return res.status(200).json(serializeMasterOption(updated));
    }
    if (await model.exists({ kode_jenis: code })) throw new HttpError(409, `Kode ${label} sudah digunakan.`);
    const item = await model.create({ kode_jenis: code, nama_jenis: name, urutan: Number.isFinite(order) ? order : 0, aktif: true, sistem: false });
    await AuditLog.create({ actor: actor(req), action: `${entityType}_CREATED`, entityType, entityId: id(item._id), after: serializeMasterOption(item), correlationId: createNumber('MASTER') });
    res.status(201).json(serializeMasterOption(item));
  }));

  app.patch(`${path}/:id`, requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
    const body = req.body || {};
    const item = await model.findById(req.params.id);
    if (!item) throw new HttpError(404, `${label} tidak ditemukan.`);
    const update = {};
    if (body.name !== undefined || body.namaJenis !== undefined || body.nama_jenis !== undefined) {
      const name = String(body.name ?? body.namaJenis ?? body.nama_jenis ?? '').trim().toUpperCase();
      if (!name) throw new HttpError(422, `Nama ${label} wajib diisi.`);
      update.nama_jenis = name;
    }
    if (body.order !== undefined || body.urutan !== undefined) {
      const order = Number(body.order ?? body.urutan);
      if (!Number.isFinite(order)) throw new HttpError(422, `Urutan ${label} harus berupa angka.`);
      update.urutan = order;
    }
    if (body.aktif !== undefined) {
      const active = Boolean(body.aktif);
      if (item.sistem && !active) throw new HttpError(409, `${label} bawaan sistem tidak dapat dinonaktifkan.`);
      update.aktif = active;
    }
    const updated = await model.findByIdAndUpdate(item._id, { $set: update }, { new: true, runValidators: true });
    await AuditLog.create({ actor: actor(req), action: `${entityType}_UPDATED`, entityType, entityId: id(updated._id), before: serializeMasterOption(item), after: serializeMasterOption(updated), correlationId: createNumber('MASTER') });
    res.json(serializeMasterOption(updated));
  }));

  app.delete(`${path}/:id`, requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
    const item = await model.findById(req.params.id);
    if (!item) throw new HttpError(404, `${label} tidak ditemukan.`);
    if (item.sistem) throw new HttpError(409, `${label} bawaan sistem tidak dapat dihapus.`);
    const updated = await model.findByIdAndUpdate(item._id, { $set: { aktif: false } }, { new: true });
    await AuditLog.create({ actor: actor(req), action: `${entityType}_DEACTIVATED`, entityType, entityId: id(updated._id), before: serializeMasterOption(item), after: serializeMasterOption(updated), correlationId: createNumber('MASTER') });
    res.json(serializeMasterOption(updated));
  }));
}

registerMasterOptionRoutes('/api/request-types', RequestType, 'REQUEST_TYPE', 'jenis request');
registerMasterOptionRoutes('/api/transaction-types', TransactionType, 'TRANSACTION_TYPE', 'jenis transaksi');

app.post('/api/banks', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  if (!code || !name) throw new HttpError(422, 'Kode dan nama bank wajib diisi.');
  const existing = await Bank.collection.findOne({ $or: [{ kode_bank: code }, { code }] });
  if (code === 'TUNAI') throw new HttpError(409, 'Bank TUNAI adalah data sistem dan tidak perlu dibuat ulang.');
  const existingIsInactive = existing && (existing.aktif === false || existing.isActive === false);
  if (existingIsInactive) {
    if (existing.sistem === true) throw new HttpError(409, 'Bank sistem tidak dapat diubah.');
    await Bank.collection.updateOne({ _id: existing._id }, { $set: { kode_bank: code, nama_bank: name.toUpperCase(), sistem: false, aktif: true }, $unset: { code: '', name: '', isActive: '' } });
    const updated = await Bank.findById(existing._id);
    await AuditLog.create({ actor: actor(req), action: 'BANK_REACTIVATED', entityType: 'BANK', entityId: id(updated._id), after: serializeBank(updated), correlationId: createNumber('BANK') });
    return res.status(200).json(serializeBank(updated));
  }
  if (existing) throw new HttpError(409, `Kode bank ${code} sudah digunakan oleh data bank yang masih aktif.`);
  const bank = await Bank.create({ kode_bank: code, nama_bank: name.toUpperCase(), sistem: false, aktif: true });
  await AuditLog.create({ actor: actor(req), action: 'BANK_CREATED', entityType: 'BANK', entityId: id(bank._id), after: serializeBank(bank), correlationId: createNumber('BANK') });
  res.status(201).json(serializeBank(bank));
}));

app.patch('/api/banks/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const bank = await Bank.findById(req.params.id);
  if (!bank) throw new HttpError(404, 'Bank tidak ditemukan.');
  if (bank.sistem === true || bank.kode_bank === 'TUNAI') throw new HttpError(409, 'Bank TUNAI adalah data sistem dan tidak dapat diedit.');
  const code = req.body.code !== undefined ? String(req.body.code || '').trim().toUpperCase() : bank.kode_bank;
  const name = req.body.name !== undefined ? String(req.body.name || '').trim().toUpperCase() : bank.nama_bank;
  if (req.body.code !== undefined && code !== bank.kode_bank) throw new HttpError(422, 'Kode bank tidak dapat diubah setelah bank tersimpan.');
  if (!code || !name) throw new HttpError(422, 'Kode dan nama bank wajib diisi.');
  if (code === 'TUNAI') throw new HttpError(409, 'Kode TUNAI hanya digunakan oleh bank sistem.');
  const duplicate = await Bank.findOne({ _id: { $ne: bank._id }, kode_bank: code });
  if (duplicate) throw new HttpError(409, `Kode bank ${code} sudah digunakan.`);
  const update = { kode_bank: code, nama_bank: name };
  if (req.body.aktif !== undefined) update.aktif = Boolean(req.body.aktif);
  const updated = await Bank.findByIdAndUpdate(bank._id, { $set: update }, { new: true, runValidators: true });
  await AuditLog.create({ actor: actor(req), action: 'BANK_UPDATED', entityType: 'BANK', entityId: id(updated._id), before: serializeBank(bank), after: serializeBank(updated), correlationId: createNumber('BANK') });
  res.json(serializeBank(updated));
}));

app.delete('/api/banks/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const bank = await Bank.findById(req.params.id);
  if (!bank) throw new HttpError(404, 'Bank tidak ditemukan.');
  if (bank.sistem === true || bank.kode_bank === 'TUNAI') throw new HttpError(409, 'Bank TUNAI adalah data sistem dan tidak dapat dihapus.');
  const updated = await Bank.findByIdAndUpdate(bank._id, { $set: { aktif: false } }, { new: true });
  await AuditLog.create({ actor: actor(req), action: 'BANK_DEACTIVATED', entityType: 'BANK', entityId: id(updated._id), before: serializeBank(bank), after: serializeBank(updated), correlationId: createNumber('BANK') });
  res.json(serializeBank(updated));
}));

app.get('/api/cabang', asyncRoute(async (req, res) => {
  const branches = await Branch.find({ aktif: { $ne: false } }).sort({ jenis_bisnis: 1, kode_toko: 1 });
  res.json(branches.map(serializeBranch));
}));

app.post('/api/cabang', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const kodeToko = String(body.kodeToko || body.kode_toko || '').trim().toUpperCase();
  const namaToko = String(body.namaToko || body.nama_toko || '').trim();
  const jenisBisnis = normalizeSourceBusiness(body.jenisBisnis || body.jenis_bisnis);
  const databaseName = String(body.databaseName || body.database_name || '').trim();
  if (!kodeToko || !namaToko || !databaseName) throw new HttpError(422, 'Kode toko, nama toko, dan nama database wajib diisi.');
  const branchFields = { kode_toko: kodeToko, nama_toko: namaToko.toUpperCase(), jenis_bisnis: jenisBisnis || 'NAGAGOLD', portal: String(body.portal || '').trim(), tipe_toko: String(body.tipeToko || body.tipe_toko || '').trim().toUpperCase(), database_name: databaseName, aktif: body.aktif !== false };
  const existing = await Branch.findOne({ ...branchIdentityQuery({ kodeToko, jenisBisnis }), });
  if (existing?.aktif !== false) throw new HttpError(409, 'Kode toko sudah digunakan.');
  const databaseConflict = await Branch.findOne({ ...branchBusinessQuery(jenisBisnis), database_name: databaseName, ...(existing ? { _id: { $ne: existing._id } } : {}) });
  if (databaseConflict) throw new HttpError(409, 'Nama database sudah digunakan oleh cabang pada sumber yang sama.');
  if (existing) {
    const reactivated = await Branch.findByIdAndUpdate(existing._id, { $set: branchFields }, { new: true, runValidators: true });
    await AuditLog.create({ actor: actor(req), action: 'BRANCH_REACTIVATED', entityType: 'BRANCH', entityId: id(reactivated._id), before: serializeBranch(existing), after: serializeBranch(reactivated), correlationId: createNumber('BRANCH') });
    return res.status(200).json(serializeBranch(reactivated));
  }
  const branch = await Branch.create(branchFields);
  res.status(201).json(serializeBranch(branch));
}));

app.patch('/api/cabang/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const update = {};
  if (body.namaToko || body.nama_toko) update.nama_toko = String(body.namaToko || body.nama_toko).trim().toUpperCase();
  if (body.jenisBisnis !== undefined || body.jenis_bisnis !== undefined) update.jenis_bisnis = String(body.jenisBisnis ?? body.jenis_bisnis ?? '').trim().toUpperCase();
  if (body.databaseName !== undefined || body.database_name !== undefined) update.database_name = String(body.databaseName ?? body.database_name ?? '').trim();
  if (body.portal !== undefined) update.portal = String(body.portal || '').trim();
  if (body.tipeToko !== undefined || body.tipe_toko !== undefined) update.tipe_toko = String(body.tipeToko ?? body.tipe_toko ?? '').trim().toUpperCase();
  if (body.aktif !== undefined) update.aktif = Boolean(body.aktif);
  const current = await Branch.findById(req.params.id).lean();
  if (!current) throw new HttpError(404, 'Cabang tidak ditemukan.');
  const nextBusiness = normalizeSourceBusiness(update.jenis_bisnis ?? current.jenis_bisnis);
  const nextDatabase = String(update.database_name ?? current.database_name ?? '').trim();
  const identityConflict = await Branch.findOne({ ...branchIdentityQuery({ kodeToko: current.kode_toko, jenisBisnis: nextBusiness }), _id: { $ne: req.params.id } }).lean();
  if (identityConflict) throw new HttpError(409, 'Kode toko sudah digunakan pada sumber bisnis tersebut.');
  const databaseConflict = await Branch.findOne({ ...branchBusinessQuery(nextBusiness), database_name: nextDatabase, _id: { $ne: req.params.id } }).lean();
  if (databaseConflict) throw new HttpError(409, 'Nama database sudah digunakan oleh cabang pada sumber yang sama.');
  if (update.jenis_bisnis !== undefined) update.jenis_bisnis = nextBusiness;
  const branch = await Branch.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  res.json(serializeBranch(branch));
}));

app.delete('/api/cabang/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const branch = await Branch.findById(req.params.id);
  if (!branch) throw new HttpError(404, 'Cabang tidak ditemukan.');
  const updated = await Branch.findByIdAndUpdate(branch._id, { $set: { aktif: false } }, { new: true, runValidators: true });
  await AuditLog.create({ actor: actor(req), action: 'BRANCH_DEACTIVATED', entityType: 'BRANCH', entityId: id(updated._id), before: serializeBranch(branch), after: serializeBranch(updated), correlationId: createNumber('BRANCH') });
  res.json(serializeBranch(updated));
}));

async function generateAccountCode() {
  const existing = await Account.find({ kode_akun: /^AKN[0-9]+$/ }).select('kode_akun').lean();
  const used = new Set(existing.map((item) => Number(String(item.kode_akun).slice(3))).filter(Number.isFinite));
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return `AKN${String(sequence).padStart(3, '0')}`;
}

async function resolveAccountInput(body, existing = null) {
  const requestedPosKasId = body.posKasId || body.pos_kas_id || existing?.pos_kas_id || '';
  const requestedJenisKas = body.jenisKas || body.jenis_kas || body.tipeKas || body.tipe_kas || '';
  const requestedBusinessId = body.jenisBisnisId !== undefined || body.jenis_bisnis_id !== undefined
    ? (body.jenisBisnisId || body.jenis_bisnis_id || '')
    : (existing?.jenis_bisnis_id || '');
  const directClassification = Boolean(requestedJenisKas || body.jenisBisnisId !== undefined || body.jenis_bisnis_id !== undefined);
  let posKas = null;
  if (requestedPosKasId && mongoose.isValidObjectId(requestedPosKasId)) {
    posKas = await CashType.findById(requestedPosKasId);
    if (posKas && !posKas.aktif && String(posKas._id) !== String(existing?.pos_kas_id || '')) posKas = null;
  }
  let jenisKas = normalizeCashLevel(requestedJenisKas || posKas?.tipe_kas || existing?.kelompok_rekening || '');
  if (!jenisKas) throw new HttpError(422, 'Jenis Kas wajib dipilih: UTAMA, BESAR, atau KECIL.');
  let business = null;
  if (requestedBusinessId) {
    if (!mongoose.isValidObjectId(requestedBusinessId)) throw new HttpError(422, 'Jenis Bisnis tidak valid.');
    const existingBusinessId = existing?.jenis_bisnis_id && String(existing.jenis_bisnis_id);
    business = await BusinessType.findOne({ _id: requestedBusinessId, ...(existingBusinessId === String(requestedBusinessId) ? { $or: [{ aktif: true }, { _id: existingBusinessId }] } : { aktif: true }) });
    if (!business) throw new HttpError(422, 'Jenis Bisnis tidak ditemukan atau tidak aktif.');
  }
  const bentukSaldo = String(body.bentukSaldo || body.bentuk_saldo || existing?.bentuk_saldo || 'REKENING_BANK').trim().toUpperCase();
  if (!['REKENING_BANK', 'KAS_TUNAI'].includes(bentukSaldo)) throw new HttpError(422, 'Jenis penyimpanan tidak valid.');
  const accountName = String(body.name ?? existing?.nama_rekening ?? '').trim().toUpperCase();
  if (!accountName) throw new HttpError(422, 'Nama rekening atau kas wajib diisi.');
  const requestedUnit = String(body.unitType || body.unit || body.unitBisnis || body.unit_bisnis || existing?.unit || '').trim().toUpperCase();
  const unit = String(business?.kode_bisnis || requestedUnit || posKas?.unit || (jenisKas === 'KAS_UTAMA' ? 'PUSAT' : '')).toUpperCase();
  if (!business && !['NAGAGOLD', 'OPTIK', 'PUSAT', 'BERSAMA'].includes(unit)) throw new HttpError(422, 'Jenis Bisnis tidak valid. Tambahkan jenis bisnis melalui Master Jenis Bisnis terlebih dahulu.');
  if (business && requestedUnit && requestedUnit !== business.kode_bisnis) throw new HttpError(422, 'Jenis Bisnis dan unit rekening tidak sesuai.');
  if (jenisKas === 'KAS_UTAMA' && !['PUSAT', 'BERSAMA'].includes(unit)) throw new HttpError(422, 'KAS UTAMA harus menggunakan jenis bisnis PUSAT atau BERSAMA.');
  if (jenisKas !== 'KAS_UTAMA' && ['PUSAT', 'BERSAMA'].includes(unit)) throw new HttpError(422, 'KAS BESAR atau KAS KECIL harus memilih jenis bisnis, misalnya NAGAGOLD atau OPTIK.');
  if (!directClassification && !posKas) throw new HttpError(422, 'Kelompok Kas lama tidak ditemukan. Pilih Jenis Kas dan Jenis Bisnis.');
  if (!posKas || posKas.tipe_kas !== jenisKas || posKas.unit !== unit) posKas = await CashType.findOne({ aktif: true, tipe_kas: jenisKas, unit });
  const lokasi = String(body.lokasiPengelolaan || body.lokasi_pengelolaan || existing?.lokasi_pengelolaan || 'PUSAT').trim().toUpperCase();
  if (!['PUSAT', 'TOKO_CABANG'].includes(lokasi)) throw new HttpError(422, 'Lokasi pengelolaan tidak valid.');
  const requestedBranchId = body.cabangId || body.cabang_id || existing?.cabang_id || '';
  const requestedBranchCode = String(body.kodeToko || body.kode_toko || existing?.kode_toko || '').trim().toUpperCase();
  let branch = null;
  if (lokasi === 'TOKO_CABANG') {
    if (requestedBranchId && mongoose.isValidObjectId(requestedBranchId)) branch = await Branch.findOne({ _id: requestedBranchId, aktif: true });
    if (!branch && requestedBranchCode) {
      const branchBusiness = ['NAGAGOLD', 'OPTIK'].includes(unit) ? unit : 'NAGAGOLD';
      branch = await Branch.findOne({ ...branchIdentityQuery({ kodeToko: requestedBranchCode, jenisBisnis: branchBusiness }), aktif: true });
    }
    if (!branch) throw new HttpError(422, 'Toko/cabang wajib dipilih untuk lokasi TOKO/CABANG.');
  }
  const kodeToko = branch?.kode_toko || '';
  const cabangId = branch?._id || null;
  const accountNumber = String(body.accountNumber ?? existing?.nomor_rekening ?? '').trim().toUpperCase();
  const cashBank = bentukSaldo === 'KAS_TUNAI' ? await Bank.findOne({ kode_bank: 'TUNAI', sistem: true, aktif: true }) : null;
  if (bentukSaldo === 'KAS_TUNAI' && !cashBank) throw new HttpError(500, 'Bank sistem TUNAI belum tersedia. Restart backend untuk menyiapkan data sistem.');
  const bankId = bentukSaldo === 'KAS_TUNAI' ? cashBank._id : (body.bankId !== undefined ? body.bankId : existing?.bank_id);
  const bank = bentukSaldo === 'REKENING_BANK' && bankId ? await Bank.findOne({ _id: bankId, aktif: true }) : cashBank;
  if (bentukSaldo === 'REKENING_BANK' && (!bank || !accountNumber)) throw new HttpError(422, 'Bank dan nomor rekening wajib diisi untuk rekening bank.');
  if (bentukSaldo === 'KAS_TUNAI' && !accountNumber) throw new HttpError(422, 'Identitas nomor rekening tunai wajib diisi.');
  const atasNama = bentukSaldo === 'REKENING_BANK' ? String(body.atasNama ?? body.atas_nama ?? existing?.atas_nama ?? '').trim().toUpperCase() : '';
  const jenisAkun = bentukSaldo === 'KAS_TUNAI'
    ? (lokasi === 'TOKO_CABANG' ? ACCOUNT_KINDS.STORE_CASH : ACCOUNT_KINDS.CASH_ACCOUNT)
    : ACCOUNT_KINDS.BANK_ACCOUNT;
  const duplicateQuery = bentukSaldo === 'REKENING_BANK' ? { aktif: true, bentuk_saldo: 'REKENING_BANK', bank_id: bank._id, nomor_rekening: accountNumber, ...(existing ? { _id: { $ne: existing._id } } : {}) } : null;
  if (duplicateQuery && await Account.exists(duplicateQuery)) throw new HttpError(409, 'Rekening fisik dengan bank dan nomor rekening tersebut sudah terdaftar. Gunakan rekening yang sama, bukan membuat duplikat.');
  return { accountName, posKas, jenisKas, business, bentukSaldo, unit, lokasi, branch, cabangId, kodeToko, accountNumber, bank, atasNama, jenisAkun, penanggungJawab: String(body.penanggungJawab ?? body.penanggung_jawab ?? existing?.penanggung_jawab ?? '').trim().toUpperCase() };
}

async function accountHasHistory(accountId) {
  const [transactions, journals, opening] = await Promise.all([
    Promise.all([
      FinanceMutation.exists({ $or: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }, { rekeningId: accountId }] }),
      SyncTransaction.exists({ $or: [{ sourceAccountId: accountId }, { destinationAccountId: accountId }, { rekeningId: accountId }] }),
    ]).then(([mutationExists, syncExists]) => mutationExists || syncExists),
    JournalEntry.exists({ rekening_id: String(accountId) }),
    OpeningBalance.exists({ rekening_id: accountId }),
  ]);
  return Boolean(transactions || journals || opening);
}

app.get('/api/accounts', asyncRoute(async (req, res) => {
  const accounts = await Account.find({ aktif: true }).populate({ path: 'bank_id', select: 'kode_bank nama_bank' }).populate({ path: 'pos_kas_id', select: 'kode_jenis nama_jenis tipe_kas unit' }).populate({ path: 'jenis_bisnis_id', select: 'kode_bisnis nama_bisnis' }).populate({ path: 'cabang_id', select: 'kode_toko nama_toko' }).sort({ kode_akun: 1, nama_rekening: 1 });
  res.json(accounts.map(serializeAccount));
}));

app.post('/api/accounts', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const resolved = await resolveAccountInput(req.body || {});
  const accountFields = { nama_rekening: resolved.accountName, kelompok_rekening: resolved.jenisKas, jenis_bisnis_id: resolved.business?._id || null, unit: resolved.unit, bank_id: resolved.bank?._id || null, nomor_rekening: resolved.accountNumber, bentuk_saldo: resolved.bentukSaldo, jenis_akun: resolved.jenisAkun, penanggung_jawab: resolved.penanggungJawab, aktif: true };
  const reusableQuery = resolved.bentukSaldo === 'REKENING_BANK'
    ? { aktif: false, bentuk_saldo: 'REKENING_BANK', bank_id: resolved.bank._id, nomor_rekening: resolved.accountNumber }
    : { aktif: false, bentuk_saldo: 'KAS_TUNAI', kelompok_rekening: resolved.jenisKas, unit: resolved.unit, nomor_rekening: resolved.accountNumber, jenis_akun: resolved.jenisAkun === ACCOUNT_KINDS.CASH_ACCOUNT ? { $in: [ACCOUNT_KINDS.CASH_ACCOUNT, ACCOUNT_KINDS.OPERATING_CASH] } : resolved.jenisAkun };
  const reusable = await Account.findOne(reusableQuery);
  if (reusable) {
    if (reusable.kelompok_rekening !== resolved.jenisKas || reusable.unit !== resolved.unit) throw new HttpError(409, 'Identitas rekening tersebut sudah ada pada Jenis Kas atau Jenis Bisnis lain. Gunakan rekening lama atau buat identitas fisik yang berbeda.');
    const reactivated = await Account.findByIdAndUpdate(reusable._id, { $set: accountFields }, { new: true, runValidators: true }).populate([{ path: 'bank_id', select: 'kode_bank nama_bank' }, { path: 'pos_kas_id', select: 'kode_jenis nama_jenis tipe_kas unit' }, { path: 'jenis_bisnis_id', select: 'kode_bisnis nama_bisnis' }, { path: 'cabang_id', select: 'kode_toko nama_toko' }]);
    await AuditLog.create({ actor: actor(req), action: 'ACCOUNT_REACTIVATED', entityType: 'ACCOUNT', entityId: id(reactivated._id), before: serializeAccount(reusable), after: serializeAccount(reactivated), correlationId: createNumber('AKUN') });
    return res.status(200).json(serializeAccount(reactivated));
  }
  const account = await Account.create({ kode_akun: await generateAccountCode(), ...accountFields });
  await account.populate([{ path: 'bank_id', select: 'kode_bank nama_bank' }, { path: 'pos_kas_id', select: 'kode_jenis nama_jenis tipe_kas unit' }, { path: 'jenis_bisnis_id', select: 'kode_bisnis nama_bisnis' }, { path: 'cabang_id', select: 'kode_toko nama_toko' }]);
  await AuditLog.create({ actor: actor(req), action: 'ACCOUNT_CREATED', entityType: 'ACCOUNT', entityId: id(account._id), after: serializeAccount(account), correlationId: createNumber('AKUN') });
  res.status(201).json(serializeAccount(account));
}));

app.patch('/api/accounts/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const existing = await Account.findById(req.params.id);
  if (!existing) throw new HttpError(404, 'Rekening atau akun kas tidak ditemukan.');
  const resolved = await resolveAccountInput(req.body || {}, existing);
  const bankChanged = existing.bentuk_saldo === 'KAS_TUNAI' && resolved.bentukSaldo === 'KAS_TUNAI' ? false : String(existing.bank_id || '') !== String(resolved.bank?._id || '');
  const structuralChanged = existing.kelompok_rekening !== resolved.jenisKas || existing.unit !== resolved.unit || existing.bentuk_saldo !== resolved.bentukSaldo || bankChanged || existing.nomor_rekening !== (resolved.bentukSaldo === 'REKENING_BANK' ? resolved.accountNumber : '') || String(existing.cabang_id || '') !== String(resolved.cabangId || '') || existing.lokasi_pengelolaan !== resolved.lokasi;
  if (structuralChanged && await accountHasHistory(existing._id)) throw new HttpError(409, 'Identitas kelompok, bank, nomor rekening, lokasi, atau cabang tidak dapat diubah karena rekening sudah memiliki histori. Nonaktifkan rekening dan buat akun baru jika memang terjadi perubahan fisik.');
  if (req.body.kodeAkun || req.body.kode_akun) throw new HttpError(422, 'Kode akun dibuat otomatis dan tidak dapat diubah.');
  const update = { nama_rekening: resolved.accountName, kelompok_rekening: resolved.jenisKas, jenis_bisnis_id: resolved.business?._id || null, unit: resolved.unit, bank_id: resolved.bank?._id || null, nomor_rekening: resolved.accountNumber, bentuk_saldo: resolved.bentukSaldo, jenis_akun: resolved.jenisAkun, penanggung_jawab: resolved.penanggungJawab };
  if (!existing.kode_akun) update.kode_akun = await generateAccountCode();
  if (req.body.aktif !== undefined) update.aktif = Boolean(req.body.aktif);
  if (update.aktif === true && resolved.posKas && !resolved.posKas.aktif) throw new HttpError(422, 'Rekening tidak dapat diaktifkan pada Kelompok Kas lama yang nonaktif.');
  const updated = await Account.findByIdAndUpdate(existing._id, { $set: update }, { new: true, runValidators: true }).populate([{ path: 'bank_id', select: 'kode_bank nama_bank' }, { path: 'pos_kas_id', select: 'kode_jenis nama_jenis tipe_kas unit' }, { path: 'jenis_bisnis_id', select: 'kode_bisnis nama_bisnis' }, { path: 'cabang_id', select: 'kode_toko nama_toko' }]);
  await AuditLog.create({ actor: actor(req), action: 'ACCOUNT_UPDATED', entityType: 'ACCOUNT', entityId: id(updated._id), before: serializeAccount(existing), after: serializeAccount(updated), correlationId: createNumber('AKUN') });
  res.json(serializeAccount(updated));
}));

app.delete('/api/accounts/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw new HttpError(404, 'Rekening atau akun kas tidak ditemukan.');
  if (!account.aktif) return res.json(serializeAccount(account));
  const updated = await Account.findByIdAndUpdate(account._id, { $set: { aktif: false } }, { new: true }).populate([{ path: 'bank_id', select: 'kode_bank nama_bank' }, { path: 'pos_kas_id', select: 'kode_jenis nama_jenis tipe_kas unit' }, { path: 'jenis_bisnis_id', select: 'kode_bisnis nama_bisnis' }, { path: 'cabang_id', select: 'kode_toko nama_toko' }]);
  await AuditLog.create({ actor: actor(req), action: 'ACCOUNT_DELETED', entityType: 'ACCOUNT', entityId: id(updated._id), before: serializeAccount(account), after: serializeAccount(updated), correlationId: createNumber('AKUN') });
  res.json(serializeAccount(updated));
}));

app.get('/api/saldo-snapshot', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const date = normalizeBusinessDate(req.query.tanggal || req.query.date, await currentBusinessDate());
  const snapshots = await BalanceSnapshot.find({ tanggal_tutup: { $lte: date } }).sort({ tanggal_tutup: -1, rekening_id: 1 }).lean();
  res.json(snapshots.map((item) => ({ ...item, id: id(item._id) })));
}));

app.post('/api/saldo-snapshot/close', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const requestedDate = normalizeBusinessDate(req.body?.tanggal || req.body?.date, await currentBusinessDate());
  const forceClose = req.body?.force === true;
  const integration = await periodIntegrationStatus();
  if (integration.hasUnfinished && !forceClose) {
    throw new HttpError(409, 'Sinkronisasi transaksi belum selesai. Periksa proses integrasi terlebih dahulu sebelum menutup periode.', {
      code: 'INTEGRATION_PENDING',
      integrationStatus: integration,
    });
  }
  const result = await withMongoTransaction(async (session) => {
    const profile = await SystemProfile.findOne({ _id: SYSTEM_PROFILE_ID }).session(session);
    const systemDate = normalizeBusinessDate(profile?.tgl_system, today());
    const actualDate = today();
    if (requestedDate !== systemDate) throw new HttpError(409, `Tutup periode harus dilakukan untuk tanggal sistem ${systemDate}.`);
    if (requestedDate > actualDate) throw new HttpError(422, 'Periode yang ditutup tidak boleh melewati tanggal sistem.');
    const lastClose = await SystemLog.findOne({ type: 'TUTUP_PERIODE' }).sort({ tanggal_sampai: -1, waktu: -1 }).session(session).lean();
    const previousEnd = String(lastClose?.tanggal_sampai || '');
    const tanggalDari = previousEnd && previousEnd < requestedDate ? addBusinessDate(previousEnd) : requestedDate;
    const snapshot = await recalculateBalanceSnapshots(requestedDate, [], actor(req), session);
    const nextSystemDate = requestedDate < actualDate ? addBusinessDate(requestedDate) : requestedDate;
    await SystemProfile.updateOne({ _id: SYSTEM_PROFILE_ID }, { $set: { tgl_system: nextSystemDate } }, { session });
    await SystemLog.create([{ type: 'TUTUP_PERIODE', user: actor(req), waktu: now(), tanggal_dari: tanggalDari, tanggal_sampai: requestedDate, keterangan: `Periode ${tanggalDari} sampai ${requestedDate} ditutup.`, hasil: { ...snapshot, tanggalBerikutnya: nextSystemDate, integrasi: integration, ditutupDenganPeringatan: forceClose && integration.hasUnfinished } }], { session });
    await AuditLog.create([{ actor: actor(req), action: 'SALDO_PERIODE_DITUTUP', entityType: 'BALANCE_SNAPSHOT', entityId: requestedDate, after: { ...snapshot, tanggalBerikutnya: nextSystemDate, integrasi: integration, ditutupDenganPeringatan: forceClose && integration.hasUnfinished }, correlationId: createNumber('TUTUP') }], { session });
    return { ...snapshot, tanggalDari, tanggalSampai: requestedDate, tanggalBerikutnya: nextSystemDate, integrasi: integration, ditutupDenganPeringatan: forceClose && integration.hasUnfinished };
  });
  res.json({ ...result, message: `Saldo periode sampai ${result.tanggalSampai} berhasil dihitung. Tanggal sistem berikutnya ${result.tanggalBerikutnya}.` });
}));

app.post('/api/saldo-snapshot/recalculate', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const date = normalizeBusinessDate(req.body?.tanggal || req.body?.date, await currentBusinessDate());
  if (date > today()) throw new HttpError(422, 'Periode tidak boleh melewati tanggal sistem.');
  const rekeningIds = Array.isArray(req.body?.rekeningIds || req.body?.rekening_ids) ? (req.body.rekeningIds || req.body.rekening_ids) : [];
  const result = await recalculateBalanceSnapshots(date, rekeningIds, actor(req));
  await AuditLog.create({ actor: actor(req), action: 'SALDO_SNAPSHOT_DIHITUNG_ULANG', entityType: 'BALANCE_SNAPSHOT', entityId: date, after: result, correlationId: createNumber('HITUNG') });
  res.json({ ...result, message: `Snapshot saldo ${date} berhasil dihitung ulang.` });
}));

app.get('/api/saldo-awal', asyncRoute(async (req, res) => {
  const [items, accounts] = await Promise.all([OpeningBalance.find({}).sort({ tanggal: -1, created_at: -1 }), resolveAccountsMap()]);
  res.json(items.map((item) => serializeOpeningBalance(item, accounts)));
}));

app.post('/api/saldo-awal', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  await assertPeriodOpen();
  const body = req.body || {};
  const date = String(body.date || '').slice(0, 10);
  const systemDate = await currentBusinessDate();
  if (!body.rekeningId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number(body.amount)) throw new HttpError(422, 'Rekening, tanggal, dan nilai saldo awal wajib diisi.');
  if (date !== systemDate) throw new HttpError(422, `Tanggal saldo awal harus mengikuti tanggal sistem ${systemDate}.`);
  const created = await withMongoTransaction(async (session) => {
    const account = await accountById(body.rekeningId, session);
    const duplicate = await OpeningBalance.findOne({ rekening_id: body.rekeningId, status: { $in: ['PENDING_APPROVAL', 'APPROVED'] } }).session(session);
    if (duplicate) throw new HttpError(409, 'Rekening tersebut sudah memiliki saldo awal atau saldo awalnya sedang menunggu approval.');
    const [item] = await OpeningBalance.create([{ rekening_id: body.rekeningId, kategori_sistem: 'SALDO AWAL', kategori_transaksi: 'SALDO AWAL', tanggal: date, nilai: Number(body.amount), keterangan: String(body.note || '').trim().toUpperCase(), status: 'PENDING_APPROVAL', status_valid: false, saldo_status: BALANCE_STATUSES.APPLIED, created_by: actor(req), applied_by: actor(req), applied_at: now() }], { session });
    const journal = await ensureOpeningJournal(item, session, actor(req), 'PROVISIONAL');
    const accountUpdate = await Account.updateOne({ _id: account._id, aktif: true }, { $inc: { saldo_akhir: item.nilai } }, { session });
    if (accountUpdate.modifiedCount !== 1) throw new HttpError(409, 'Saldo awal tidak dapat diterapkan pada rekening.');
    item.jurnal_id = journal.no_keuangan;
    await item.save({ session });
    await AuditLog.create([{ actor: actor(req), action: 'OPENING_BALANCE_RECORDED_PROVISIONAL', entityType: 'OPENING_BALANCE', entityId: id(item._id), after: { status: item.status, saldo_status: item.saldo_status, jurnalId: item.jurnal_id }, correlationId: createNumber('SALDO') }], { session });
    return item;
  });
  res.status(201).json(serializeOpeningBalance(created, await resolveAccountsMap()));
}));

app.get('/api/requests', asyncRoute(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.kodeToko) query.kodeToko = String(req.query.kodeToko).toUpperCase();
  const requests = await TransferRequest.find(query).sort({ requestedAt: -1 });
  res.json(requests.map(serializeRequest));
}));

app.post('/api/requests', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  await assertPeriodOpen();
  const body = req.body || {};
  const requestId = body.requestId || body.request_id;
  const asalPermintaan = String(body.asalPermintaan || body.asal_permintaan || (body.kodeToko || body.kode_toko ? 'CABANG' : 'INTERNAL')).trim().toUpperCase();
  if (!['CABANG', 'INTERNAL'].includes(asalPermintaan)) throw new HttpError(422, 'Asal permintaan harus CABANG atau INTERNAL.');
  const sourceSystem = String(body.sourceSystem || body.source_system || (asalPermintaan === 'INTERNAL' ? 'finance' : '')).trim().toLowerCase();
  const jenisTransaksi = body.jenisTransaksi || body.jenis_transaksi || body.jenisRequest || body.jenis_request || body.requestType || body.request_type;
  const kodeToko = String(body.kodeToko || body.kode_toko || '').trim().toUpperCase();
  const unitPemohon = String(body.unitPemohon || body.unit_pemohon || '').trim().toUpperCase();
  const namaPemohon = String(body.namaPemohon || body.nama_pemohon || '').trim().toUpperCase();
  const sourceAccountId = body.sourceAccountId || body.source_account_id || null;
  const destinationAccountId = body.destinationAccountId || body.destination_account_id || null;
  let noRekening = String(body.noRekening || body.no_rekening || '').trim().toUpperCase();
  const nilaiRp = body.nilaiRp ?? body.nilai_rp;
  const requestedAt = body.requestedAt || body.requested_at;
  const tujuan = body.tujuan || '';
  let namaToko = body.namaToko || body.nama_toko || '';
  let sourceBranch = null;
  if (!noRekening && destinationAccountId && mongoose.isValidObjectId(destinationAccountId)) {
    const destinationAccount = await Account.findOne({ _id: destinationAccountId, aktif: true }).select('nomor_rekening kode_akun').lean();
    noRekening = String(destinationAccount?.nomor_rekening || destinationAccount?.kode_akun || '').trim().toUpperCase();
  }
  if (!sourceSystem || !jenisTransaksi || !noRekening || !Number(nilaiRp) || !requestedAt) throw new HttpError(422, 'request_id, source_system, jenis_transaksi, no_rekening, nilai_rp, dan requested_at wajib diisi.');
  const normalizedRequestId = String(requestId || '').trim().toUpperCase() || await nextRequestNumber(await currentBusinessDate());
  if (!/^RQS-\d{8}-\d{4,}$/.test(normalizedRequestId)) throw new HttpError(422, 'request_id harus menggunakan format RQS-YYYYMMDD-NOMOR_URUT, contoh RQS-20261102-0001.');
  if (asalPermintaan === 'CABANG' && !kodeToko) throw new HttpError(422, 'Kode toko wajib diisi untuk permintaan dari cabang.');
  if (asalPermintaan === 'CABANG' && !['nagagold', 'optik'].includes(sourceSystem)) throw new HttpError(422, 'source_system cabang harus nagagold atau optik.');
  if (asalPermintaan === 'CABANG') {
    sourceBranch = await Branch.findOne({ kode_toko: kodeToko, jenis_bisnis: sourceSystem.toUpperCase(), aktif: { $ne: false } }).lean();
    if (!sourceBranch) throw new HttpError(422, `Cabang ${kodeToko} tidak ditemukan pada sumber ${sourceSystem.toUpperCase()}.`);
    namaToko = sourceBranch.nama_toko;
  }
  if (asalPermintaan === 'INTERNAL' && !unitPemohon && !namaPemohon) throw new HttpError(422, 'Unit atau nama pemohon internal wajib diisi.');
  let destinationAccount = null;
  for (const [label, accountId] of [['sumber', sourceAccountId], ['tujuan', destinationAccountId]]) {
    if (!accountId) continue;
    if (!mongoose.isValidObjectId(accountId)) throw new HttpError(422, `Rekening ${label} pada permintaan dana tidak ditemukan atau tidak aktif.`);
    const account = await Account.findOne({ _id: accountId, aktif: true }).select('kelompok_rekening unit').lean();
    if (!account) throw new HttpError(422, `Rekening ${label} pada permintaan dana tidak ditemukan atau tidak aktif.`);
    if (label === 'tujuan') destinationAccount = account;
  }
  if (destinationAccount) {
    const expectedCashType = asalPermintaan === 'CABANG' ? 'KAS_KECIL' : 'KAS_BESAR';
    if (String(destinationAccount.kelompok_rekening || '').toUpperCase() !== expectedCashType) {
      throw new HttpError(422, `Rekening tujuan permintaan ${asalPermintaan === 'CABANG' ? 'cabang harus berada pada Kas Kecil.' : 'internal harus berada pada Kas Besar.'}`);
    }
    const expectedBusiness = asalPermintaan === 'CABANG' ? sourceSystem.toUpperCase() : unitPemohon;
    if (expectedBusiness && String(destinationAccount.unit || '').toUpperCase() !== expectedBusiness) {
      throw new HttpError(422, 'Jenis bisnis rekening tujuan tidak sesuai dengan permintaan.');
    }
  }
  const duplicate = await TransferRequest.findOne({ sourceSystem: String(sourceSystem).toLowerCase(), requestId: normalizedRequestId });
  if (duplicate) return res.status(200).json(serializeRequest(duplicate));
  const normalizedJenisTransaksi = String(jenisTransaksi).trim().toUpperCase();
  if (!await TransactionType.exists({ kode_jenis: normalizedJenisTransaksi, aktif: true })) throw new HttpError(422, 'Jenis transaksi belum terdaftar atau sudah nonaktif di Master Jenis Transaksi.');
  const request = await TransferRequest.create({ requestId: normalizedRequestId, sourceSystem, asal_permintaan: asalPermintaan, unit_pemohon: unitPemohon, nama_pemohon: namaPemohon, source_account_id: sourceAccountId, destination_account_id: destinationAccountId, jenisRequest: normalizedJenisTransaksi, kodeToko, namaTokoSnapshot: String(namaToko).trim().toUpperCase(), sourceBranchId: sourceBranch ? id(sourceBranch._id) : (body.sourceBranchId || body.source_branch_id || ''), noRekening, nilaiRp: Number(nilaiRp), requestedAt: new Date(requestedAt), tujuan: String(tujuan).trim().toUpperCase(), created_by: actor(req), status: 'REQUESTED', approval_status: APPROVAL_STATUSES.NOT_STARTED, payment_status: PAYMENT_STATUSES.WAITING_TRANSFER, rawReference: body.rawReference || body.raw_reference || null });
  const pemohonLabel = asalPermintaan === 'CABANG' ? kodeToko : (namaPemohon || unitPemohon || 'INTERNAL FINANCE');
  await Notification.create({ type: 'BRANCH_REQUEST', title: 'Permintaan dana baru', message: `${request.requestId} dari ${pemohonLabel} membutuhkan ${request.nilaiRp}.`, referenceType: 'TRANSFER_REQUEST', referenceId: id(request._id) });
  res.status(201).json(serializeRequest(request));
}));

async function updateRequestApproval(requestId, action, req) {
  const reason = String(req.body?.reason || '').trim();
  if (action === 'REJECT' && !reason) throw new HttpError(422, 'Alasan reject request wajib diisi.');
  return withMongoTransaction(async (session) => {
    const query = action === 'APPROVE'
      ? { _id: requestId, status: 'PENDING_APPROVAL', approval_status: APPROVAL_STATUSES.PENDING }
      : { _id: requestId, status: 'PENDING_APPROVAL', approval_status: APPROVAL_STATUSES.PENDING };
    const update = action === 'APPROVE'
      ? { status: 'APPROVED', approval_status: APPROVAL_STATUSES.APPROVED, approved_by: actor(req), approved_at: now(), payment_status: PAYMENT_STATUSES.WAITING_TRANSFER }
      : { status: 'REJECTED', approval_status: APPROVAL_STATUSES.REJECTED, rejected_by: actor(req), rejected_at: now(), rejection_reason: reason };
    const request = await TransferRequest.findOneAndUpdate(query, { $set: update }, { new: true, session });
    if (!request) throw new HttpError(409, 'Request tidak berada pada status yang dapat diproses atau sudah diproses oleh user lain.');
    const actionName = action === 'APPROVE' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED';
    await AuditLog.create([{ actor: actor(req), action: actionName, entityType: 'TRANSFER_REQUEST', entityId: id(request._id), after: { status: request.status, approval_status: request.approval_status, reason }, correlationId: createNumber('REQ') }], { session });
    return request;
  });
}

async function submitRequestForApproval(requestId, req) {
  return withMongoTransaction(async (session) => {
    const request = await TransferRequest.findOneAndUpdate(
      { _id: requestId, status: 'REQUESTED', approval_status: { $in: [APPROVAL_STATUSES.NOT_STARTED, APPROVAL_STATUSES.REJECTED] } },
      { $set: { status: 'PENDING_APPROVAL', approval_status: APPROVAL_STATUSES.PENDING, rejected_by: '', rejected_at: null, rejection_reason: '' } },
      { new: true, session },
    );
    if (!request) throw new HttpError(409, 'Request tidak berada pada status REQUESTED atau sudah diajukan.');
    await Notification.create([{ type: 'PENDING_REQUEST_APPROVAL', title: 'Request cabang menunggu approval', message: `${request.requestId} dari ${request.kodeToko} menunggu approval.`, referenceType: 'TRANSFER_REQUEST', referenceId: id(request._id) }], { session });
    await AuditLog.create([{ actor: actor(req), action: 'REQUEST_SUBMITTED_FOR_APPROVAL', entityType: 'TRANSFER_REQUEST', entityId: id(request._id), after: { status: request.status, approval_status: request.approval_status }, correlationId: createNumber('REQ') }], { session });
    return request;
  });
}

async function acceptRequestForTransfer(requestId, req) {
  return withMongoTransaction(async (session) => {
    const request = await TransferRequest.findOneAndUpdate(
      { _id: requestId, status: 'REQUESTED', approval_status: { $in: [APPROVAL_STATUSES.NOT_STARTED, APPROVAL_STATUSES.REJECTED] } },
      { $set: { status: 'WAITING_TRANSFER', approval_status: APPROVAL_STATUSES.NOT_REQUIRED, payment_status: PAYMENT_STATUSES.WAITING_TRANSFER, rejected_by: '', rejected_at: null, rejection_reason: '' } },
      { new: true, session },
    );
    if (!request) throw new HttpError(409, 'Request tidak berada pada status yang dapat diterima atau sudah diproses.');
    await AuditLog.create([{ actor: actor(req), action: 'REQUEST_ACCEPTED_FOR_TRANSFER', entityType: 'TRANSFER_REQUEST', entityId: id(request._id), after: { status: request.status, approval_status: request.approval_status }, correlationId: createNumber('REQ') }], { session });
    return request;
  });
}

async function rejectRequestBeforeTransfer(requestId, req) {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) throw new HttpError(422, 'Alasan reject request wajib diisi.');
  return withMongoTransaction(async (session) => {
    const request = await TransferRequest.findOneAndUpdate(
      { _id: requestId, status: 'REQUESTED', finance_transaction_id: { $in: ['', null] } },
      { $set: { status: 'REJECTED', approval_status: APPROVAL_STATUSES.REJECTED, payment_status: PAYMENT_STATUSES.CANCELLED, rejected_by: actor(req), rejected_at: now(), rejection_reason: reason } },
      { new: true, session },
    );
    if (!request) throw new HttpError(409, 'Request tidak berada pada status yang dapat ditolak atau sudah diproses.');
    await AuditLog.create([{ actor: actor(req), action: 'REQUEST_REJECTED_BEFORE_TRANSFER', entityType: 'TRANSFER_REQUEST', entityId: id(request._id), after: { status: request.status, approval_status: request.approval_status, reason }, correlationId: createNumber('REQ') }], { session });
    return request;
  });
}

async function recordRequestPayment(requestId, body, req) {
  // Realisasi mutasi selalu memakai tanggal sistem saat dicatat. Tanggal dari
  // client tidak dipercaya agar user tidak dapat backdate atau membuat saldo
  // masuk ke periode yang belum berjalan.
  const transferDate = await currentBusinessDate();
  const transferReference = String(body.transferReference || body.transfer_reference || body.paymentReference || body.payment_reference || '').trim();
  const transferProof = String(body.transferProof || body.transfer_proof || body.paymentProof || body.payment_proof || '').trim();
  const paymentNote = String(body.paymentNote || body.payment_note || body.note || '').trim().toUpperCase();
  return withMongoTransaction(async (session) => {
    const eligibleQuery = { _id: requestId, status: { $in: ['APPROVED', 'WAITING_TRANSFER'] }, approval_status: { $in: [APPROVAL_STATUSES.APPROVED, APPROVAL_STATUSES.NOT_REQUIRED] }, finance_transaction_id: { $in: ['', null] } };
    const beforeUpdate = await TransferRequest.findOne(eligibleQuery).session(session);
    if (!beforeUpdate) {
      const existing = await TransferRequest.findById(requestId).session(session);
      if (!existing) throw new HttpError(404, 'Request tidak ditemukan.');
      if (existing.finance_transaction_id) {
        const existingTransaction = await FinanceMutation.findById(existing.finance_transaction_id).session(session);
        if (existingTransaction) return { transaction: existingTransaction, request: existing, idempotent: true };
      }
      throw new HttpError(409, 'Request belum diterima, sudah diproses, atau sedang diproses oleh user lain.');
    }
    const needsPaymentApproval = beforeUpdate.status === 'WAITING_TRANSFER' || beforeUpdate.approval_status === APPROVAL_STATUSES.NOT_REQUIRED;
    const request = await TransferRequest.findOneAndUpdate(
      { ...eligibleQuery, status: beforeUpdate.status, approval_status: beforeUpdate.approval_status },
      { $set: { status: 'IN_PROGRESS' } },
      { new: true, session },
    );
    if (!request) throw new HttpError(409, 'Request sedang diproses oleh user lain.');
    const amount = Number(body.amount ?? body.nilaiRp ?? body.nilai_rp ?? request.nilaiRp);
    if (!amount || amount !== Number(request.nilaiRp)) throw new HttpError(422, 'Nominal realisasi harus sama dengan nominal request. Pembayaran sebagian belum diaktifkan.');
    const sourceAccountId = body.sourceAccountId || body.source_account_id || request.source_account_id;
    const destinationAccountId = body.destinationAccountId || body.destination_account_id || request.destination_account_id;
    const accounts = await Promise.all([accountById(sourceAccountId, session), accountById(destinationAccountId, session)]);
    if (String(accounts[0]._id) === String(accounts[1]._id)) throw new HttpError(422, 'Rekening sumber dan tujuan tidak boleh sama.');
    const isBranchRequest = String(request.asal_permintaan || (request.kodeToko ? 'CABANG' : 'INTERNAL')).toUpperCase() === 'CABANG';
    if (isBranchRequest && accounts[0].kelompok_rekening !== 'KAS_BESAR') throw new HttpError(422, 'Rekening sumber realisasi request cabang harus berada pada Kas Besar.');
    if (isBranchRequest && accounts[1].kelompok_rekening !== 'KAS_KECIL') throw new HttpError(422, 'Rekening tujuan realisasi request cabang harus berada pada Kas Kecil.');
    if (request.noRekening && accounts[1].nomor_rekening && String(request.noRekening).trim() !== String(accounts[1].nomor_rekening).trim()) throw new HttpError(422, 'Rekening tujuan tidak sama dengan rekening pada permintaan dana.');
    const sourceBalance = await availableBalance(accounts[0]._id, session);
    if (sourceBalance < amount) throw new HttpError(422, `Saldo rekening sumber tidak cukup. Saldo tersedia: ${sourceBalance}.`);
    const sourceSnapshot = mutationAccountSnapshot(accounts[0]);
    const destinationSnapshot = mutationAccountSnapshot(accounts[1]);
    const created = await FinanceMutation.create([{
      transactionNumber: await nextMutationNumber(transferDate, session),
      bentukTransaksi: 'TRANSFER_INTERNAL',
      kategori_sistem: 'TRANSAKSI',
      requestId: request.requestId,
      transactionDate: transferDate,
      jenisTransaksi: body.jenisTransaksi || request.jenisRequest,
      jenisRequest: request.jenisRequest,
      arahDana: 'KELUAR',
      kodeToko: request.kodeToko,
      namaTokoSnapshot: request.namaTokoSnapshot,
      sourceAccountId: accounts[0]._id,
      destinationAccountId: accounts[1]._id,
      bank_asal: sourceSnapshot.bank,
      bank_tujuan: destinationSnapshot.bank,
      jenis_kas_asal: sourceSnapshot.cashType,
      jenis_kas_tujuan: destinationSnapshot.cashType,
      amount,
      status: needsPaymentApproval ? 'PENDING_APPROVAL' : 'APPROVED',
      statusValid: !needsPaymentApproval,
      note: paymentNote || request.tujuan || '-',
      created_by: actor(req),
      approved_by: needsPaymentApproval ? '' : (request.approved_by || actor(req)),
      approved_at: needsPaymentApproval ? null : (request.approved_at || now()),
      source_type: SOURCE_TYPES.BRANCH_REQUEST,
      sync_status: SYNC_STATUSES.NOT_APPLICABLE,
      approval_status: needsPaymentApproval ? APPROVAL_STATUSES.PENDING : APPROVAL_STATUSES.APPROVED,
      payment_status: needsPaymentApproval ? PAYMENT_STATUSES.PENDING_APPROVAL : PAYMENT_STATUSES.PAID,
      payment_date: transferDate,
      payment_reference: transferReference,
      payment_proof: transferProof,
      payment_note: paymentNote || '-',
      journal_status: JOURNAL_STATUSES.PROVISIONAL,
      finance_transaction_id: '',
    }], { session });
    const transaction = created[0];
      const journal = await ensureInitialJournal(transaction, session);
      const financeEntriesForTransaction = await transactionFinanceEntries(transaction, journal, session);
    await applyTransferBalance(transaction, session);
    if (!needsPaymentApproval) {
      await setFinanceEntriesStatus(financeEntriesForTransaction, 'POSTED', session, actor(req));
      transaction.journal_status = JOURNAL_STATUSES.POSTED;
      await transaction.save({ session });
    }
    const requestUpdate = await TransferRequest.updateOne(
      { _id: request._id, status: 'IN_PROGRESS', finance_transaction_id: { $in: ['', null] } },
      { $set: { status: needsPaymentApproval ? 'WAITING_PAYMENT_APPROVAL' : 'PAID', payment_status: needsPaymentApproval ? PAYMENT_STATUSES.PENDING_APPROVAL : PAYMENT_STATUSES.PAID, transfer_date: transferDate, transfer_reference: transferReference, transfer_amount: amount, transfer_proof: transferProof, payment_note: paymentNote, finance_transaction_id: id(transaction._id) } },
      { session },
    );
    if (requestUpdate.modifiedCount !== 1) throw new HttpError(409, 'Status request berubah saat realisasi pembayaran.');
    const correlationId = createNumber('PAYMENT');
    await AuditLog.create([
      { actor: actor(req), action: 'REQUEST_PAYMENT_RECORDED', entityType: 'TRANSFER_REQUEST', entityId: id(request._id), after: { status: needsPaymentApproval ? 'WAITING_PAYMENT_APPROVAL' : 'PAID', payment_status: needsPaymentApproval ? PAYMENT_STATUSES.PENDING_APPROVAL : PAYMENT_STATUSES.PAID, transactionId: id(transaction._id), transferReference }, correlationId },
      { actor: actor(req), action: needsPaymentApproval ? 'TRANSACTION_PENDING_APPROVAL' : 'TRANSACTION_POSTED', entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id), after: { status: transaction.status, journal_status: transaction.journal_status, payment_reference: transferReference }, correlationId },
    ], { session, ordered: true });
    if (needsPaymentApproval) await Notification.create([{ type: 'PENDING_APPROVAL', title: 'Realisasi request menunggu approval', message: `${transaction.transactionNumber} dari request ${request.requestId} menunggu approval Owner.`, referenceType: 'TRANSACTION', referenceId: id(transaction._id) }], { session });
    return { transaction, request, idempotent: false };
  });
}

app.post('/api/requests/:id/submit-approval', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const request = await submitRequestForApproval(req.params.id, req);
  res.json(serializeRequest(request));
}));
app.post('/api/requests/:id/accept', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const request = await acceptRequestForTransfer(req.params.id, req);
  res.json(serializeRequest(request));
}));
app.post('/api/requests/:id/cancel', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const request = await rejectRequestBeforeTransfer(req.params.id, req);
  res.json(serializeRequest(request));
}));
app.post('/api/requests/:id/approve', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const request = await updateRequestApproval(req.params.id, 'APPROVE', req);
  res.json(serializeRequest(request));
}));
app.post('/api/requests/:id/reject', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const request = await updateRequestApproval(req.params.id, 'REJECT', req);
  res.json(serializeRequest(request));
}));
app.post('/api/requests/:id/payment', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  await assertPeriodOpen();
  const result = await recordRequestPayment(req.params.id, req.body || {}, req);
  res.status(result.idempotent ? 200 : 201).json({ request: serializeRequest(result.request), transaction: serializeTransaction(result.transaction, await resolveAccountsMap()), idempotent: result.idempotent });
}));

app.get('/api/transactions', asyncRoute(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.sourceType || req.query.source_type) {
    const sourceType = String(req.query.sourceType || req.query.source_type).toUpperCase();
    query.source_type = sourceType === SOURCE_TYPES.SYNC ? { $in: [SOURCE_TYPES.SYNC, SOURCE_TYPES.SYNC_NAGAGOLD, SOURCE_TYPES.SYNC_OPTIK] } : sourceType;
  }
  if (req.query.syncStatus || req.query.sync_status) query.sync_status = String(req.query.syncStatus || req.query.sync_status).toUpperCase();
  if (req.query.approvalStatus || req.query.approval_status) query.approval_status = String(req.query.approvalStatus || req.query.approval_status).toUpperCase();
  if (req.query.paymentStatus || req.query.payment_status) query.payment_status = String(req.query.paymentStatus || req.query.payment_status).toUpperCase();
  if (req.query.journalStatus || req.query.journal_status) query.journal_status = String(req.query.journalStatus || req.query.journal_status).toUpperCase();
  if (req.query.reconciliationStatus || req.query.reconciliation_status) query.reconciliation_status = String(req.query.reconciliationStatus || req.query.reconciliation_status).toUpperCase();
  if (req.query.sourceSystem) {
    const sourceSystem = String(req.query.sourceSystem).toLowerCase();
    if (sourceSystem === 'nagagold') { query.isImported = true; query.$or = [{ jenis_bisnis: 'NAGAGOLD' }, { sourceSystem: 'nagagold' }]; }
    else query.sourceSystem = sourceSystem;
  }
  if (req.query.kodeToko) query.kodeToko = String(req.query.kodeToko).toUpperCase();
  if (req.query.dateFrom || req.query.dateTo) query.transactionDate = { ...(req.query.dateFrom ? { $gte: String(req.query.dateFrom) } : {}), ...(req.query.dateTo ? { $lte: String(req.query.dateTo) } : {}) };
  const sourceType = String(req.query.sourceType || req.query.source_type || '').toUpperCase();
  const transactions = query.isImported || sourceType === SOURCE_TYPES.SYNC || sourceType === SOURCE_TYPES.SYNC_NAGAGOLD || sourceType === SOURCE_TYPES.SYNC_OPTIK
    ? await SyncTransaction.find(query).sort({ createdAt: -1 })
    : sourceType === SOURCE_TYPES.MANUAL_ADMIN ? await FinanceMutation.find(query).sort({ createdAt: -1 }) : await listFinanceTransactions(query);
  const accounts = await resolveAccountsMap();
  res.json(transactions.map((transaction) => serializeTransaction(transaction, accounts)));
}));

app.get('/api/nagagold-transactions', asyncRoute(async (req, res) => {
  const query = nagagoldTransactionQuery();
  if (req.query.status) query.status = String(req.query.status);
  if (req.query.syncStatus || req.query.sync_status) query.sync_status = String(req.query.syncStatus || req.query.sync_status).toUpperCase();
  if (req.query.reconciliationStatus || req.query.reconciliation_status) query.reconciliation_status = String(req.query.reconciliationStatus || req.query.reconciliation_status).toUpperCase();
  if (req.query.classificationStatus || req.query.classification_status) query.classification_status = String(req.query.classificationStatus || req.query.classification_status).toUpperCase();
  if (req.query.kodeToko) query.kodeToko = String(req.query.kodeToko).toUpperCase();
  const [transactions, accounts] = await Promise.all([SyncTransaction.find(query).sort({ transactionDate: -1, createdAt: -1 }), resolveAccountsMap()]);
  res.json(transactions.map((transaction) => serializeTransaction(transaction, accounts)));
}));

app.get('/api/nagagold-mapping', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const transactionQuery = nagagoldTransactionQuery();
  if (req.query.kodeToko) transactionQuery.kodeToko = String(req.query.kodeToko).toUpperCase();
  const [mappings, transactions, accounts] = await Promise.all([
    NagagoldAccountMapping.find({ source_system: { $in: ['nagagold', 'optik'] } }).sort({ unit: 1, nomor_rekening: 1 }),
    SyncTransaction.find(transactionQuery).sort({ transactionDate: -1, createdAt: -1 }).lean(),
    Account.find({}).select('_id nama_rekening').lean(),
  ]);
  const accountsById = new Map(accounts.map((account) => [id(account._id), account.nama_rekening]));
  const failedExamples = transactions.filter((transaction) => transaction.mappingStatus !== 'TERPETAKAN').slice(0, 100).map((transaction) => ({
    id: id(transaction._id), transactionNumber: transaction.transactionNumber, kodeToko: transaction.kodeToko,
    jenisBisnis: String(transaction.sumber || transaction.jenis_bisnis || 'NAGAGOLD').toUpperCase(),
    sourceId: transaction.source_transaction_id || transaction.sourceId || '',
    metodePembayaran: transaction.source_payment_method || sourcePaymentMethod(transaction),
    sourceNoRekening: transaction.sourceNoRekening || '', sourceKodeBank: transaction.sourceKodeBank || '',
    mappingStatus: transaction.mappingStatus || 'PERLU_PEMETAAN', mappingReason: transaction.mappingReason || transaction.sync_message || '',
    mappingCandidateIds: transaction.mappingCandidateIds || [], sourceDecryptionStatus: transaction.sourceDecryptionStatus || 'UNKNOWN', sourceFinalityStatus: transaction.sourceFinalityStatus || 'UNVERIFIED',
  }));
  const sourceAccountsByKey = new Map();
  for (const transaction of transactions) {
    const unit = String(transaction.sumber || transaction.jenis_bisnis || 'NAGAGOLD').trim().toUpperCase();
    const rawNumber = normalizeNagagoldValue(transaction.source_no_rekening || transaction.sourceNoRekening || '');
    const storedMethod = String(transaction.jenis_pembayaran || transaction.source_payment_method || '').trim().toUpperCase();
    const method = storedMethod || sourcePaymentMethod({ ...transaction, no_rekening: rawNumber });
    const isCash = method === 'CASH' || !rawNumber;
    const bank = isCash ? '' : normalizeNagagoldValue(transaction.source_kode_bank || transaction.sourceKodeBank || '').toUpperCase();
    const number = isCash ? '' : rawNumber;
    const key = [unit, number].join('::');
    const current = sourceAccountsByKey.get(key) || {
      id: key,
      jenisBisnis: unit,
      sourceSystem: unit.toLowerCase(),
      metodePembayaran: isCash ? 'CASH' : method,
      kodeBank: bank,
      nomorRekening: number,
      cabangKode: new Set(),
      jumlahTransaksi: 0,
    };
    current.jumlahTransaksi += 1;
    if (transaction.kode_toko) current.cabangKode.add(String(transaction.kode_toko).toUpperCase());
    sourceAccountsByKey.set(key, current);
  }
  const sourceAccounts = [...sourceAccountsByKey.values()]
    .map((item) => ({
      ...item,
      cabangCount: item.cabangKode.size,
      cabangKode: [...item.cabangKode],
      label: item.metodePembayaran === 'CASH'
        ? `${item.jenisBisnis} · KAS TUNAI`
        : `${item.jenisBisnis} · ${item.nomorRekening}`,
    }))
    .sort((a, b) => `${a.jenisBisnis}${a.kodeBank}${a.nomorRekening}`.localeCompare(`${b.jenisBisnis}${b.kodeBank}${b.nomorRekening}`));
  res.json({ mappings: mappings.map((mapping) => serializeNagagoldMapping(mapping, accountsById)), summary: nagagoldMappingSummary(transactions), failedExamples, sourceAccounts });
}));

async function previewNagagoldMappingConfigurations(filters = {}) {
  const query = nagagoldTransactionQuery();
  const jenisBisnis = normalizeSourceBusiness(filters.jenisBisnis || filters.jenis_bisnis || filters.sourceSystem || filters.source_system, '');
  const kodeToko = String(filters.kodeToko || filters.kode_toko || '').trim().toUpperCase();
  const metode = String(filters.metodePembayaran || filters.metode_pembayaran || '').trim().toUpperCase();
  const kodeBank = String(filters.kodeBank || filters.kode_bank || '').trim().toUpperCase();
  const nomorRekening = String(filters.nomorRekening || filters.nomor_rekening || '').trim();
  if (kodeToko) query.kodeToko = kodeToko;
  if (jenisBisnis) query.sumber = jenisBisnis;
  if (metode) query.jenis_pembayaran = metode;
  if (kodeBank) query.kode_bank = kodeBank;
  if (nomorRekening) query.no_rekening = nomorRekening;
  const limit = Math.min(50000, Math.max(1, Number(filters.limit || 10000)));
  const transactions = await SyncTransaction.find(query).sort({ transactionDate: -1, createdAt: -1 }).limit(limit).lean();
  const grouped = new Map();
  for (const transaction of transactions) {
    const rawNumber = normalizeNagagoldValue(transaction.source_no_rekening || transaction.sourceNoRekening || '');
    const method = sourcePaymentMethod({
      source_payment_method: transaction.source_payment_method,
      jenis_pembayaran: transaction.jenis_pembayaran,
      jenis: transaction.jenisSumber,
      no_rekening: rawNumber,
    });
    const branchCode = String(transaction.kodeToko || '').trim().toUpperCase();
    const unit = String(transaction.sumber || transaction.jenis_bisnis || transaction.jenisBisnis || 'NAGAGOLD').trim().toUpperCase();
    const bank = normalizeNagagoldValue(transaction.source_kode_bank || transaction.sourceKodeBank || '').toUpperCase();
    const accountNumber = rawNumber;
    const isCash = method === 'CASH' || accountNumber === '-';
    const mappingAccountNumber = isCash ? '' : accountNumber;
    const key = [unit, mappingAccountNumber].join('::');
    const current = grouped.get(key) || {
      key, unit, kodeToko: branchCode, mappingKodeToko: '*', metodePembayaran: method,
      kodeBank: bank, nomorRekening: isCash ? '' : accountNumber, cabangCount: 0, cabangKode: new Set(), jumlahTransaksi: 0,
      totalMasuk: 0, totalKeluar: 0, statusSumber: new Set(), mappingStatus: new Set(), transactionIds: [],
    };
    current.jumlahTransaksi += 1;
    if (branchCode) current.cabangKode.add(branchCode);
    current.cabangCount = current.cabangKode.size;
    current.totalMasuk += transaction.arahDana === 'MASUK' ? Number(transaction.amount || 0) : 0;
    current.totalKeluar += transaction.arahDana === 'KELUAR' ? Number(transaction.amount || 0) : 0;
    if (transaction.statusSumber) current.statusSumber.add(transaction.statusSumber);
    if (transaction.mappingStatus) current.mappingStatus.add(transaction.mappingStatus);
    if (current.transactionIds.length < 5) current.transactionIds.push(id(transaction._id));
    grouped.set(key, current);
  }

  const accountCandidates = await Account.find({ aktif: true }).lean();
  const bankIds = [...new Set(accountCandidates.map((account) => id(account.bank_id)).filter(Boolean))];
  const banks = await Bank.find({ _id: { $in: bankIds } }).lean();
  const bankCodeById = new Map(banks.map((bank) => [id(bank._id), bank.kode_bank]));
  const mappings = await NagagoldAccountMapping.find({ source_system: { $in: ['nagagold', 'optik'] }, aktif: true }).lean();
  const mappingByKey = new Map(mappings.map((mapping) => [
    [mapping.unit, mapping.nomor_rekening || ''].join('::'), mapping,
  ]));

  const rows = [...grouped.values()].map((group) => {
    const isCash = group.metodePembayaran === 'CASH' || group.nomorRekening === '-';
    const candidates = accountCandidates.filter((account) => {
      if (account.unit !== group.unit) return false;
      if (isCash) return account.bentuk_saldo === 'KAS_TUNAI';
      if (account.bentuk_saldo !== 'REKENING_BANK' || account.nomor_rekening !== group.nomorRekening) return false;
      if (account.unit && account.unit !== group.unit) return false;
      return true;
    }).map((account) => ({ id: id(account._id), name: account.nama_rekening, jenisAkun: inferAccountKind(account), nomorRekening: account.nomor_rekening || '', kodeToko: account.kode_toko || '', kodeBank: bankCodeById.get(id(account.bank_id)) || '' }));
    // Mapping sekarang tidak lagi dibedakan per cabang atau metode pembayaran.
    // Satu rekening sumber dalam satu jenis bisnis harus menunjuk ke satu
    // rekening Finance yang sama, sehingga lookup preview harus memakai kunci
    // yang sama dengan resolver dan unique index.
    const configured = mappingByKey.get([group.unit, isCash ? '' : group.nomorRekening].join('::')) || null;
    const configuredCandidate = configured ? candidates.find((candidate) => candidate.id === id(configured.rekening_id)) : null;
    let hasil = 'BELUM_ADA_KANDIDAT';
    let alasan = 'Belum ada rekening Finance yang cocok dengan konteks sumber.';
    if (configured && configuredCandidate) { hasil = 'TERPETAKAN_KONFIGURASI'; alasan = 'Mapping aktif ditemukan untuk jenis bisnis dan rekening sumber ini.'; }
    else if (configured && !configuredCandidate) { hasil = 'KONFIGURASI_TIDAK_VALID'; alasan = 'Mapping aktif menunjuk rekening yang tidak lagi menjadi kandidat valid.'; }
    else if (candidates.length === 1) { hasil = 'KANDIDAT_UNIK'; alasan = 'Satu rekening Finance cocok, tetapi belum disimpan sebagai konfigurasi mapping.'; }
    else if (candidates.length > 1) { hasil = 'AMBIGU'; alasan = 'Lebih dari satu rekening Finance cocok; Admin harus memilih secara eksplisit.'; }
    return {
      ...group, statusSumber: [...group.statusSumber], mappingStatus: [...group.mappingStatus],
      totalMasuk: Number(group.totalMasuk || 0), totalKeluar: Number(group.totalKeluar || 0),
      candidates, configured: configured ? { id: id(configured._id), rekeningId: id(configured.rekening_id), jenisAkun: configured.jenis_akun, aktif: configured.aktif } : null,
      hasil, alasan,
    };
  }).sort((a, b) => b.jumlahTransaksi - a.jumlahTransaksi);
  return { previewOnly: true, writesPerformed: false, filter: { jenisBisnis, kodeToko, metodePembayaran: metode, kodeBank, nomorRekening, limit }, sourceTransactionCount: transactions.length, configurationCount: rows.length, rows };
}

app.post('/api/nagagold-mapping/bulk-preview', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  res.json(await previewNagagoldMappingConfigurations(req.body || {}));
}));

app.post('/api/nagagold-mapping/test', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const branch = mappingBusiness(req.body?.jenisBisnis || req.body?.jenis_bisnis || req.body?.sourceSystem || req.body?.source_system);
  const sourceItem = mappingSourceItem(req.body || {});
  const result = await resolveNagagoldAccount(sourceItem, branch);
  res.json({ jenisBisnis: branch.jenisBisnis, metodePembayaran: sourcePaymentMethod(sourceItem), status: result.status, reason: result.reason, candidateIds: result.candidateIds, rekening: result.account ? serializeAccount(result.account) : null, ruleKey: result.ruleKey });
}));

app.post('/api/nagagold-mapping', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const branch = mappingBusiness(body.jenisBisnis || body.jenis_bisnis || body.sourceSystem || body.source_system);
  const { account, method } = await validateNagagoldMappingAccount({ branch, body });
  const cash = method === 'CASH';
  const context = { source_system: branch.sourceSystem, kode_toko: '*', unit: branch.unit, metode_pembayaran: method, kode_bank: cash ? '' : String(body.kodeBank || body.kode_bank || '').trim().toUpperCase(), nomor_rekening: cash ? '' : normalizeNagagoldValue(body.nomorRekening || body.nomor_rekening) };
  const mapping = await NagagoldAccountMapping.findOneAndUpdate(
    { source_system: context.source_system, unit: context.unit, nomor_rekening: context.nomor_rekening },
    { $set: { ...context, jenis_akun: inferAccountKind(account), rekening_id: account._id, aktif: body.aktif !== false, keterangan: String(body.keterangan || '').trim().toUpperCase(), updated_by: actor(req) }, $setOnInsert: { created_by: actor(req) } },
    { upsert: true, new: true, runValidators: true },
  );
  const reprocess = await reprocessNagagoldTransactionsForBusiness(branch.unit);
  await AuditLog.create({ actor: actor(req), action: 'NAGAGOLD_MAPPING_SAVED', entityType: 'NAGAGOLD_ACCOUNT_MAPPING', entityId: id(mapping._id), after: { unit: context.unit, metodePembayaran: method, rekeningId: id(account._id), reprocess }, correlationId: createNumber('MAP') });
  res.status(200).json({ ...serializeNagagoldMapping(mapping, new Map([[id(account._id), account.nama_rekening]])), reprocess });
}));

app.get('/api/nagagold-auto-posting/rules', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const rules = await NagagoldAutoPostingRule.find({ source_system: 'nagagold' }).sort({ kode_toko: 1, kategori_transaksi: 1, metode_pembayaran: 1 });
  res.json({
    sourceSystem: 'nagagold',
    productionEnabled: NAGAGOLD_AUTO_POSTING_ENABLED,
    defaultActive: false,
    rules: rules.map(serializeNagagoldAutoPostingRule),
  });
}));

function autoPostingRuleInput(body = {}) {
  const metode = normalizeAutoPostingValue(body.metodePembayaran || body.metode_pembayaran, '');
  if (metode === 'TUNAI') return 'CASH';
  return metode;
}

async function assertAutoPostingRuleActivation(req, active, body = {}) {
  if (!active) return;
  if (!['OWNER', 'SUPER_USER'].includes(req.user?.role)) throw new HttpError(403, 'Aktivasi whitelist auto-posting hanya boleh dilakukan Owner atau Super User.');
  if (body.confirmation !== 'AKTIFKAN_AUTO_POSTING') throw new HttpError(422, 'Aktivasi wajib menyertakan confirmation AKTIFKAN_AUTO_POSTING.');
  if (!NAGAGOLD_AUTO_POSTING_ENABLED) throw new HttpError(409, 'Auto-posting production masih dinonaktifkan. Ubah konfigurasi sistem dan lakukan persetujuan eksplisit terlebih dahulu.');
}

app.post('/api/nagagold-auto-posting/rules', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const kodeToko = normalizeAutoPostingValue(body.kodeToko || body.kode_toko, '*');
  if (kodeToko !== '*') await mappingBranch(kodeToko);
  const jenisTransaksi = normalizeAutoPostingValue(body.jenisTransaksi || body.jenis_transaksi, '');
  const kategoriTransaksi = normalizeAutoPostingValue(body.kategoriTransaksi || body.kategori_transaksi, '');
  const metodePembayaran = autoPostingRuleInput(body);
  if (!jenisTransaksi || !kategoriTransaksi || !metodePembayaran) throw new HttpError(422, 'Jenis transaksi, kategori transaksi, dan metode pembayaran wajib diisi. Gunakan * bila konteks memang wildcard.');
  const statusFinalitas = normalizeAutoPostingValue(body.statusFinalitas || body.status_finalitas, 'FINAL_CONFIRMED');
  if (statusFinalitas !== 'FINAL_CONFIRMED') throw new HttpError(422, 'Whitelist hanya boleh menggunakan finalitas FINAL_CONFIRMED.');
  const aktif = body.aktif === true;
  await assertAutoPostingRuleActivation(req, aktif, body);
  const context = { source_system: 'nagagold', unit: 'NAGAGOLD', kode_toko: kodeToko, jenis_transaksi: jenisTransaksi, kategori_transaksi: kategoriTransaksi, metode_pembayaran: metodePembayaran, status_finalitas: statusFinalitas };
  const rule = await NagagoldAutoPostingRule.findOneAndUpdate(
    context,
    { $set: { ...context, aktif, keterangan: String(body.keterangan || '').trim().toUpperCase(), versi_aturan: NAGAGOLD_CLASSIFICATION_RULE_VERSION, updated_by: actor(req), ...(aktif ? { approved_by: actor(req), approved_at: now(), alasan_persetujuan: String(body.alasanPersetujuan || body.alasan_persetujuan || '').trim().toUpperCase() } : { approved_by: '', approved_at: null, alasan_persetujuan: '' }) }, $setOnInsert: { created_by: actor(req) } },
    { upsert: true, new: true, runValidators: true },
  );
  await AuditLog.create({ actor: actor(req), action: aktif ? 'NAGAGOLD_AUTO_POSTING_RULE_ACTIVATED' : 'NAGAGOLD_AUTO_POSTING_RULE_SAVED', entityType: 'NAGAGOLD_AUTO_POSTING_RULE', entityId: id(rule._id), after: { ...context, aktif, productionEnabled: NAGAGOLD_AUTO_POSTING_ENABLED }, correlationId: createNumber('AUTOPOST') });
  res.status(200).json({ productionEnabled: NAGAGOLD_AUTO_POSTING_ENABLED, rule: serializeNagagoldAutoPostingRule(rule) });
}));

app.patch('/api/nagagold-auto-posting/rules/:id', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const rule = await NagagoldAutoPostingRule.findById(req.params.id);
  if (!rule) throw new HttpError(404, 'Aturan whitelist auto-posting tidak ditemukan.');
  const aktif = req.body?.aktif === true;
  await assertAutoPostingRuleActivation(req, aktif, req.body || {});
  rule.aktif = aktif;
  rule.updated_by = actor(req);
  rule.keterangan = req.body?.keterangan === undefined ? rule.keterangan : String(req.body.keterangan || '').trim();
  if (aktif) { rule.approved_by = actor(req); rule.approved_at = now(); rule.alasan_persetujuan = String(req.body?.alasanPersetujuan || req.body?.alasan_persetujuan || '').trim(); }
  else { rule.approved_by = ''; rule.approved_at = null; rule.alasan_persetujuan = ''; }
  await rule.save();
  await AuditLog.create({ actor: actor(req), action: aktif ? 'NAGAGOLD_AUTO_POSTING_RULE_ACTIVATED' : 'NAGAGOLD_AUTO_POSTING_RULE_DISABLED', entityType: 'NAGAGOLD_AUTO_POSTING_RULE', entityId: id(rule._id), after: { aktif, productionEnabled: NAGAGOLD_AUTO_POSTING_ENABLED }, correlationId: createNumber('AUTOPOST') });
  res.json({ productionEnabled: NAGAGOLD_AUTO_POSTING_ENABLED, rule: serializeNagagoldAutoPostingRule(rule) });
}));

app.get('/api/transactions/:id/detail', asyncRoute(async (req, res) => {
  const transaction = await findFinanceTransactionById(req.params.id);
  if (!transaction) throw new HttpError(404, 'Transaksi tidak ditemukan.');
  const [accounts, approvals, audits, journals] = await Promise.all([
    resolveAccountsMap(),
    ApprovalAction.find({ transactionId: id(transaction._id) }).sort({ actedAt: 1, createdAt: 1 }).lean(),
    AuditLog.find({ entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id) }).sort({ createdAt: 1 }).lean(),
    JournalEntry.find({ no_transaksi: transactionNumber(transaction) }).sort({ tanggal: 1, dibuat_pada: 1 }).lean(),
  ]);
  const timeline = [
    { type: 'TRANSACTION_CREATED', at: transaction.createdAt, status: transaction.status, label: 'Transaksi tercatat', actor: transaction.created_by || 'system' },
    ...(transaction.validasiAdminPada ? [{ type: 'ADMIN_VALIDATED', at: transaction.validasiAdminPada, status: transaction.sync_status || SYNC_STATUSES.RECONCILED, label: 'Pemeriksaan Admin selesai', actor: transaction.validasiAdminOleh || 'Admin', note: transaction.validasiAdminCatatan || '' }] : []),
    ...(approvals || []).map((item) => ({ type: item.action, at: item.actedAt || item.createdAt, status: item.action === 'APPROVE' ? APPROVAL_STATUSES.APPROVED : APPROVAL_STATUSES.REJECTED, label: item.action === 'APPROVE' ? 'Disetujui Owner' : 'Ditolak Owner', actor: item.actor, note: item.reason || '' })),
    ...(journals || []).map((item) => ({ type: `KEUANGAN_${item.tipe}`, at: item.dibuat_pada, status: item.status, label: item.tipe === 'PEMBALIKAN' ? 'Pencatatan pembalikan dibuat' : `Pencatatan ${String(item.status || '').toLowerCase()}`, actor: item.created_by || 'system', financeNumber: item.no_keuangan })),
    ...(audits || []).map((item) => ({ type: item.action, at: item.createdAt, status: transaction.status, label: item.action, actor: item.actor })),
  ].filter((item) => item.at).sort((a, b) => new Date(a.at) - new Date(b.at));
  res.json({ transaction: serializeTransaction(transaction, accounts), approvals, audits, journals, timeline, reconciliation: await reconciliationPayload(transaction) });
}));

app.get('/api/saldo-awal/:id/detail', asyncRoute(async (req, res) => {
  const item = await OpeningBalance.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Saldo awal tidak ditemukan.');

  const [accounts, audits, journals] = await Promise.all([
    resolveAccountsMap(),
    AuditLog.find({ entityType: 'OPENING_BALANCE', entityId: id(item._id) }).sort({ createdAt: 1 }).lean(),
    JournalEntry.find({ no_keuangan: { $in: [item.jurnal_id, item.jurnal_balik_id].filter(Boolean) } }).sort({ tanggal: 1, dibuat_pada: 1 }).lean(),
  ]);
  const timeline = [
    { type: 'OPENING_BALANCE_CREATED', at: item.created_at, status: item.status, label: 'Saldo awal tercatat', actor: item.created_by || 'system' },
    ...(item.approved_at ? [{ type: 'OPENING_BALANCE_APPROVED', at: item.approved_at, status: 'APPROVED', label: 'Saldo awal disetujui Owner', actor: item.approved_by || 'system' }] : []),
    ...(item.ditolak_pada ? [{ type: 'OPENING_BALANCE_REJECTED', at: item.ditolak_pada, status: 'REJECTED', label: 'Saldo awal ditolak Owner', actor: item.ditolak_oleh || 'Owner', note: item.alasan_penolakan || '' }] : []),
    ...(item.applied_at ? [{ type: 'OPENING_BALANCE_APPLIED', at: item.applied_at, status: 'POSTED', label: 'Saldo awal dibukukan', actor: item.applied_by || 'system', journalNumber: item.jurnal_id || '' }] : []),
    ...(journals || []).map((journal) => ({ type: `KEUANGAN_${journal.tipe}`, at: journal.dibuat_pada, status: journal.status, label: `Pencatatan ${String(journal.status || '').toLowerCase()}`, actor: journal.created_by || 'system', financeNumber: journal.no_keuangan })),
    ...(audits || []).map((audit) => ({ type: audit.action, at: audit.createdAt, status: item.status, label: audit.action, actor: audit.actor })),
  ].filter((entry) => entry.at).sort((left, right) => new Date(left.at) - new Date(right.at));

  res.json({ openingBalance: serializeOpeningBalance(item, accounts), approvals: [], audits, journals, timeline });
}));

app.get('/api/transactions/:id/reconciliation', asyncRoute(async (req, res) => {
  const transaction = await findFinanceTransactionById(req.params.id);
  if (!transaction) throw new HttpError(404, 'Transaksi tidak ditemukan.');
  res.json(await reconciliationPayload(transaction));
}));

app.post('/api/transactions/:id/reconciliation/confirm', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const matchedTransactionId = String(req.body?.matchedTransactionId || req.body?.matched_transaction_id || '').trim();
  const result = await confirmReconciliation(req.params.id, matchedTransactionId, req);
  const accounts = await resolveAccountsMap();
  res.json({ imported: serializeTransaction(result.imported, accounts), manual: serializeTransaction(result.manual, accounts), message: 'Pasangan transaksi berhasil dikonfirmasi. Tidak ada jurnal tambahan yang dibuat.' });
}));

app.post('/api/transactions/:id/reconciliation/reject', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const candidateId = String(req.body?.candidateId || req.body?.candidate_id || '').trim();
  const transaction = await rejectReconciliation(req.params.id, candidateId, req);
  res.json({ transaction: serializeTransaction(transaction, await resolveAccountsMap()), message: 'Kandidat pasangan ditolak dan transaksi tetap tidak diposting ulang.' });
}));

app.get('/api/manual-transactions', asyncRoute(async (req, res) => {
  const query = { tipe: 'PENYESUAIAN_SALDO' };
  const requestedStatus = String(req.query.status || '').trim().toUpperCase();
  if (requestedStatus === 'PENDING_APPROVAL') query.status = 'PROVISIONAL';
  else if (requestedStatus === 'APPROVED') query.status = 'POSTED';
  else if (requestedStatus === 'REJECTED') query.status = 'REVERSED';
  if (req.query.dateFrom || req.query.dateTo) query.tanggal = { ...(req.query.dateFrom ? { $gte: String(req.query.dateFrom) } : {}), ...(req.query.dateTo ? { $lte: String(req.query.dateTo) } : {}) };
  const journals = await JournalEntry.find(query).sort({ tanggal: -1, dibuat_pada: -1 }).limit(Math.min(1000, Number(req.query.limit || 500))).lean();
  const accounts = await manualJournalAccounts(journals);
  res.json(journals.map((item) => serializeManualJournal(item, accounts)));
}));

app.get('/api/manual-transactions/:id/detail', asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Transaksi manual tidak ditemukan.');
  const journal = await JournalEntry.findOne({ _id: req.params.id, tipe: 'PENYESUAIAN_SALDO' }).lean();
  if (!journal) throw new HttpError(404, 'Transaksi manual tidak ditemukan.');
  const [journals, approvals, audits] = await Promise.all([
    JournalEntry.find({ no_transaksi: journal.no_transaksi || journal.no_keuangan }).sort({ dibuat_pada: 1 }).lean(),
    ApprovalAction.find({ transactionId: id(journal._id) }).sort({ actedAt: 1 }).lean(),
    AuditLog.find({ entityId: id(journal._id) }).sort({ createdAt: 1 }).lean(),
  ]);
  const accounts = await manualJournalAccounts([journal]);
  res.json({ manualTransaction: serializeManualJournal(journal, accounts), journals, approvals, audits });
}));

async function processManualJournalDecision(journalId, action, reason, req, session, batchId) {
  if (!mongoose.isValidObjectId(journalId)) return { state: 'ignored', id: journalId };
  const journal = await JournalEntry.findOne({ _id: journalId, tipe: 'PENYESUAIAN_SALDO' }).session(session || null);
  if (!journal || journal.status !== 'PROVISIONAL') return { state: 'ignored', id: journalId };
  if (action === 'APPROVE') {
    journal.status = 'POSTED';
    journal.approved_by = actor(req);
    journal.approved_at = now();
    await journal.save({ session });
    await ApprovalAction.create([{ transactionId: id(journal._id), action: 'APPROVE', actor: actor(req), batchId }], { session });
    await AuditLog.create([{ actor: actor(req), action: 'MANUAL_TRANSACTION_APPROVED', entityType: 'FINANCE_JOURNAL', entityId: id(journal._id), after: { status: journal.status, noKeuangan: journal.no_keuangan }, correlationId: batchId }], { session });
    return { state: 'processed', id: id(journal._id), status: 'APPROVED' };
  }

  const existingReversal = await JournalEntry.findOne({ no_transaksi: journal.no_transaksi, tipe: 'PEMBALIKAN', status: 'POSTED' }).session(session || null);
  if (existingReversal) return { state: 'ignored', id: journalId };
  const [reversal] = await JournalEntry.create([{
    ...financePayload({
      noKeuangan: await nextFinanceNumber(await currentBusinessDate(session), session),
      noTransaksi: journal.no_transaksi,
      tanggal: await currentBusinessDate(session),
      tipe: 'PEMBALIKAN',
      sumber: journalSourceForTransaction(journal),
      status: 'POSTED',
      createdBy: actor(req),
      entry: {
        rekening_id: journal.rekening_id,
        jenis_transaksi: journal.jenis_transaksi || '',
        no_rekening: journal.no_rekening,
        kode_bank: journal.kode_bank,
        nama_rekening: journal.nama_rekening,
        debet: Number(journal.kredit || 0),
        kredit: Number(journal.debet || 0),
        detail_faktur: journal.detail_faktur || [],
        keterangan: `Pembalikan transaksi manual${reason ? `: ${reason}` : ''}`,
      },
    }),
  }], { session });
  await markBalanceSnapshotsStale([reversal.rekening_id], await currentBusinessDate(session), session);
  const balanceUpdate = await Account.updateOne({ _id: journal.rekening_id, aktif: true }, { $inc: { saldo_akhir: Number(journal.kredit || 0) - Number(journal.debet || 0) } }, { session });
  if (balanceUpdate.modifiedCount !== 1) throw new HttpError(409, 'Rekening transaksi manual tidak ditemukan atau tidak aktif.');
  journal.status = 'REVERSED';
  await journal.save({ session });
  await ApprovalAction.create([{ transactionId: id(journal._id), action: 'REJECT', actor: actor(req), reason, batchId }], { session });
  await AuditLog.create([{ actor: actor(req), action: 'MANUAL_TRANSACTION_REJECTED_WITH_REVERSAL', entityType: 'FINANCE_JOURNAL', entityId: id(journal._id), after: { status: journal.status, reversalNoKeuangan: reversal.no_keuangan, reason }, correlationId: batchId }], { session });
  return { state: 'processed', id: id(journal._id), status: 'REJECTED' };
}

async function approveOrRejectManualTransactions(ids, action, reason = '', req) {
  const normalizedIds = ids.filter((value) => mongoose.isValidObjectId(value));
  const normalizedReason = String(reason || '').trim().toUpperCase();
  if (!normalizedIds.length) throw new HttpError(422, 'Tidak ada transaksi manual yang valid dipilih.');
  if (action === 'REJECT' && !normalizedReason) throw new HttpError(422, 'Alasan reject wajib diisi.');
  const batchId = createNumber('BATCH');
  const processed = [];
  const ignored = [];
  const failed = [];
  for (const journalId of normalizedIds) {
    try {
      const result = await withMongoTransaction((session) => processManualJournalDecision(journalId, action, normalizedReason, req, session, batchId));
      if (result.state === 'processed') processed.push(result.id);
      else ignored.push(journalId);
    } catch (error) {
      failed.push({ id: journalId, message: error.message || 'Transaksi manual gagal diproses.' });
    }
  }
  return { batchId, processed, ignored, failed };
}

app.post('/api/manual-transactions', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  await assertPeriodOpen();
  const body = req.body || {};
  const rekeningId = body.rekeningId || body.rekening_id;
  const tanggal = await currentBusinessDate();
  const arahDana = String(body.arahDana || body.arah_dana || body.direction || '').trim().toUpperCase();
  const jenisTransaksi = String(body.jenisTransaksi || body.jenis_transaksi || '').trim().toUpperCase();
  const amount = Number(body.amount ?? body.nilai ?? body.nominal);
  const note = String(body.keterangan || body.note || '').trim().toUpperCase() || '-';
  if (!rekeningId || !jenisTransaksi || !['MASUK', 'KELUAR'].includes(arahDana) || !Number.isFinite(amount) || amount <= 0) throw new HttpError(422, 'Arah transaksi, jenis transaksi, rekening, dan nominal wajib diisi.');
  if (!await TransactionType.exists({ kode_jenis: jenisTransaksi, aktif: true })) throw new HttpError(422, 'Jenis transaksi belum terdaftar atau sudah nonaktif di Master Jenis Transaksi.');
  const created = await withMongoTransaction(async (session) => {
    const account = await accountById(rekeningId, session);
    const [entry] = await financeEntries([{ rekeningId: account._id, debet: arahDana === 'MASUK' ? amount : 0, kredit: arahDana === 'KELUAR' ? amount : 0, jenis_transaksi: jenisTransaksi, keterangan: note }], session);
    const [journal] = await JournalEntry.create([{
      ...financePayload({ noKeuangan: await nextFinanceNumber(tanggal, session), noTransaksi: await nextManualTransactionNumber(tanggal, session), tanggal, tipe: 'PENYESUAIAN_SALDO', jenisTransaksi, sumber: 'FINANCE', status: 'PROVISIONAL', createdBy: actor(req), entry }),
    }], { session });
    await markBalanceSnapshotsStale([journal.rekening_id], tanggal, session);
    const accountUpdate = await Account.updateOne({ _id: account._id, aktif: true }, { $inc: { saldo_akhir: arahDana === 'MASUK' ? amount : -amount } }, { session });
    if (accountUpdate.modifiedCount !== 1) throw new HttpError(409, 'Saldo rekening tidak dapat diperbarui.');
    await Notification.create([{ type: 'PENDING_APPROVAL', title: 'Transaksi manual menunggu approval', message: `${journal.no_transaksi} menunggu approval Owner.`, referenceType: 'FINANCE_JOURNAL', referenceId: id(journal._id) }], { session });
    await AuditLog.create([{ actor: actor(req), action: 'MANUAL_TRANSACTION_RECORDED_PROVISIONAL', entityType: 'FINANCE_JOURNAL', entityId: id(journal._id), after: { noKeuangan: journal.no_keuangan, noTransaksi: journal.no_transaksi, arahDana, amount, status: journal.status }, correlationId: createNumber('TRX') }], { session });
    return journal;
  });
  const accounts = await manualJournalAccounts([created]);
  res.status(201).json(serializeManualJournal(created, accounts));
}));

app.post('/api/manual-transactions/bulk-approve', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectManualTransactions(Array.isArray(req.body?.ids) ? req.body.ids : [], 'APPROVE', '', req))));
app.post('/api/manual-transactions/bulk-reject', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectManualTransactions(Array.isArray(req.body?.ids) ? req.body.ids : [], 'REJECT', req.body?.reason || '', req))));
app.post('/api/manual-transactions/:id/approve', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectManualTransactions([req.params.id], 'APPROVE', '', req))));
app.post('/api/manual-transactions/:id/reject', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectManualTransactions([req.params.id], 'REJECT', req.body?.reason || '', req))));

app.get('/api/journals', asyncRoute(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = String(req.query.status).toUpperCase();
  if (req.query.journalType || req.query.journal_type) query.tipe = String(req.query.journalType || req.query.journal_type).toUpperCase();
  if (req.query.transactionId || req.query.no_transaksi) query.no_transaksi = String(req.query.transactionId || req.query.no_transaksi);
  if (req.query.dateFrom || req.query.dateTo) query.tanggal = { ...(req.query.dateFrom ? { $gte: String(req.query.dateFrom) } : {}), ...(req.query.dateTo ? { $lte: String(req.query.dateTo) } : {}) };
  const journals = await JournalEntry.find(query).sort({ tanggal: -1, dibuat_pada: -1 }).limit(Math.min(500, Number(req.query.limit || 100))).lean();
  res.json(journals.map((item) => ({ ...item, id: id(item._id) })));
}));

app.get('/api/nagagold-rekening', asyncRoute(async (req, res) => {
  const [branches, accounts, transactionStats] = await Promise.all([
    getNagagoldBranches(),
    Account.find({ aktif: true }).select('nama_rekening nomor_rekening kelompok_rekening unit').lean(),
    SyncTransaction.aggregate([
      { $match: nagagoldTransactionQuery({ source_no_rekening: { $nin: ['', '-'] } }) },
      { $group: { _id: { nomor: '$source_no_rekening', bank: '$source_kode_bank' }, cabang: { $addToSet: '$kode_toko' }, jumlahTransaksi: { $sum: 1 }, totalMasuk: { $sum: '$jumlah_in' }, totalKeluar: { $sum: '$jumlah_out' } } },
    ]),
  ]);
  const sourceAccounts = [];
  for (const branch of branches) {
    try {
      const items = await readNagagoldAccountsDirectly(branch);
      for (const item of items) {
        const nomorRekening = String(item.no_rekening || '').trim();
        if (!nomorRekening || nomorRekening === '-') continue;
        sourceAccounts.push({ nomorRekening, kodeBank: String(item.kode_bank || '').trim(), namaBank: String(item.nama_rekening || '').trim(), namaRekeningSumber: String(item.nama_rekening || '').trim(), nomorAkun: String(item.nomor_akun || '').trim(), kodeToko: branch.kodeToko });
      }
    } catch (error) {
      console.error(`Gagal membaca tm_rekening cabang ${branch.kodeToko}: ${error.message}`);
    }
  }
  const grouped = new Map();
  for (const item of sourceAccounts) {
    const key = `${item.nomorRekening}::${item.kodeBank}::${item.namaRekeningSumber}`;
    const current = grouped.get(key) || { ...item, cabang: [] };
    if (!current.cabang.includes(item.kodeToko)) current.cabang.push(item.kodeToko);
    grouped.set(key, current);
  }
  const accountByNumber = new Map(accounts.map((account) => [account.nomor_rekening, account]));
  res.json([...grouped.values()].sort((a, b) => a.nomorRekening.localeCompare(b.nomorRekening)).map((item) => {
    const account = accountByNumber.get(item.nomorRekening);
    const stats = transactionStats.filter((stat) => stat._id.nomor === item.nomorRekening && (!item.kodeBank || !stat._id.bank || stat._id.bank === item.kodeBank)).reduce((result, stat) => ({ jumlahTransaksi: result.jumlahTransaksi + stat.jumlahTransaksi, totalMasuk: result.totalMasuk + stat.totalMasuk, totalKeluar: result.totalKeluar + stat.totalKeluar, cabangTransaksi: [...new Set([...result.cabangTransaksi, ...stat.cabang])] }), { jumlahTransaksi: 0, totalMasuk: 0, totalKeluar: 0, cabangTransaksi: [] });
    return { nomorRekening: item.nomorRekening, kodeBank: item.kodeBank, namaBank: item.namaRekeningSumber, namaRekeningSumber: item.namaRekeningSumber, nomorAkun: item.nomorAkun, cabang: item.cabang.sort(), cabangTransaksi: stats.cabangTransaksi.sort(), jumlahTransaksi: stats.jumlahTransaksi, totalMasuk: stats.totalMasuk, totalKeluar: stats.totalKeluar, rekeningFinanceId: id(account?._id), namaRekeningFinance: account?.nama_rekening || '', kelompokRekeningFinance: account?.kelompok_rekening || '', statusPemetaan: account ? 'TERPETAKAN' : 'BELUM ADA DI MASTER_REKENING' };
  }));
}));

app.get('/api/sinkronisasi/nagagold/status', asyncRoute(async (req, res) => {
  const states = await SyncState.find({ sourceSystem: { $in: ['nagagold', 'optik'] }, sourceCollection: NAGAGOLD_COLLECTION }).sort({ sourceSystem: 1, kodeToko: 1 });
  res.json(states.map(serializeSyncState));
}));

app.post('/api/sinkronisasi/nagagold/run', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  res.json(await runNagagoldSync());
}));

app.post('/api/nagagold-transactions/snapshot-recovery/preview', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter((value) => mongoose.isValidObjectId(value)).slice(0, 200) : [];
  const query = nagagoldTransactionQuery();
  if (ids.length) query._id = { $in: ids };
  else {
    if (body.kodeToko) query.kodeToko = String(body.kodeToko).toUpperCase();
    if (body.onlyIncomplete !== false) query.$and.push({ $or: [{ sourceSnapshotAt: { $exists: false } }, { sourceSnapshotAt: null }, { sourceSnapshotRecoveryStatus: { $in: ['UNKNOWN', 'ERROR', 'SOURCE_NOT_FOUND', 'PREVIEW_MISMATCH', null] } }] });
  }
  const limit = Math.min(200, Math.max(1, Number(body.limit || 100)));
  const transactions = await SyncTransaction.find(query).sort({ transactionDate: -1, createdAt: -1 }).limit(limit).lean();
  const rows = await previewNagagoldSnapshotRecovery(transactions);
  const summary = rows.reduce((result, row) => {
    result.total += 1;
    result[row.recoveryStatus] = (result[row.recoveryStatus] || 0) + 1;
    result.missingFields += row.missingFields?.length ? 1 : 0;
    result.amountConsistent += row.amountConsistent ? 1 : 0;
    return result;
  }, { total: 0, missingFields: 0, amountConsistent: 0, PREVIEW_MATCH: 0, PENDING_APPLY: 0, PREVIEW_MISMATCH: 0, SOURCE_NOT_FOUND: 0, ERROR: 0 });
  res.json({ previewOnly: true, writesPerformed: false, previewToken: snapshotRecoveryPreviewToken(rows), filter: { ids, kodeToko: body.kodeToko || '', onlyIncomplete: body.onlyIncomplete !== false, limit }, summary, transactions: rows });
}));

app.post('/api/nagagold-transactions/snapshot-recovery/apply', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.ids) ? body.ids.filter((value) => mongoose.isValidObjectId(value)).slice(0, 25) : [];
  if (!ids.length) throw new HttpError(422, 'Pilih minimal satu transaksi dari hasil preview snapshot.');
  if (body.confirmation !== SNAPSHOT_RECOVERY_CONFIRMATION) throw new HttpError(422, `Pemulihan production wajib menyertakan confirmation ${SNAPSHOT_RECOVERY_CONFIRMATION}.`);
  const transactions = await SyncTransaction.find(nagagoldTransactionQuery({ _id: { $in: ids } })).sort({ transactionDate: -1, createdAt: -1 }).lean();
  const rows = await previewNagagoldSnapshotRecovery(transactions);
  const currentToken = snapshotRecoveryPreviewToken(rows);
  if (!body.previewToken || body.previewToken !== currentToken) throw new HttpError(409, 'Preview snapshot sudah berubah atau token preview tidak sesuai. Jalankan preview ulang sebelum menerapkan.');
  const batchId = String(body.batchId || createNumber('SNAPSHOT')).trim();
  const results = [];
  for (const row of rows) {
    if (row.recoveryStatus === 'PREVIEW_MATCH' && row.currentRecoveryStatus === 'APPLIED') {
      results.push({ transactionId: row.transactionId, transactionNumber: row.transactionNumber, result: 'IDEMPOTENT', reason: 'Snapshot sudah pernah dipulihkan.' });
      continue;
    }
    if (row.recoveryStatus !== 'PENDING_APPLY' || !row.canPrepareRecovery || !row.candidateMetadata) {
      results.push({ transactionId: row.transactionId, transactionNumber: row.transactionNumber, result: 'SKIPPED', reason: row.reason || 'Tidak memenuhi syarat pemulihan.' });
      continue;
    }
    const result = await withMongoTransaction(async (session) => {
      const transaction = await SyncTransaction.findOne({ _id: row.transactionId }).session(session);
      if (!transaction) return { result: 'SKIPPED', reason: 'Transaksi tidak ditemukan.' };
      if ([JOURNAL_STATUSES.POSTED, JOURNAL_STATUSES.REVERSED].includes(transaction.journal_status)) return { result: 'SKIPPED', reason: 'Transaksi sudah memiliki jurnal final; snapshot tidak ditimpa.' };
      if (transaction.status === 'APPROVED' || transaction.status === 'REJECTED') return { result: 'SKIPPED', reason: 'Transaksi sudah final pada alur approval; snapshot tidak ditimpa.' };
      if (transaction.sourceSnapshotRecoveryStatus === 'APPLIED') return { result: 'IDEMPOTENT', reason: 'Snapshot sudah pernah dipulihkan.' };
      const snapshot = row.candidateMetadata;
      const fields = {
        source_transaction_id: snapshot.source_transaction_id || row.sourceId,
        source_database_name: row.sourceDatabaseName,
        sourceNoReff: snapshot.sourceNoReff,
        sourceNoRekening: snapshot.sourceNoRekening,
        sourceKodeBank: snapshot.sourceKodeBank,
        sourceNamaBank: snapshot.sourceNamaBank,
        sourceTanggal: snapshot.sourceTanggal,
        sourceDeskripsi: snapshot.sourceDeskripsi,
        sourceKeterangan: snapshot.sourceKeterangan,
        sourceDetailTransaction: snapshot.sourceDetailTransaction,
        source_amount_in: snapshot.sourceAmountIn,
        source_amount_out: snapshot.sourceAmountOut,
        jenisSumber: snapshot.jenisSumber,
        kategoriSumber: snapshot.kategoriSumber,
        statusSumber: snapshot.statusSumber,
        sourceIsValidate: snapshot.sourceIsValidate,
        sourceStatusReceive: snapshot.sourceStatusReceive,
        sourceDecryptionStatus: snapshot.sourceDecryptionStatus,
        sourceDecryptionNote: snapshot.sourceDecryptionNote,
        sourceSnapshotAt: snapshot.sourceSnapshotAt,
        sourceSnapshotProvenance: snapshot.sourceSnapshotProvenance,
        sourceSnapshotFingerprint: snapshot.sourceSnapshotFingerprint,
        sourceFinalityStatus: snapshot.sourceFinalityStatus,
        sourceFinalityNote: snapshot.sourceFinalityNote,
        sourceSnapshotRecoveryStatus: 'APPLIED',
        sourceSnapshotRecoveredAt: now(),
        sourceSnapshotRecoveryNote: `Pemulihan metadata snapshot terverifikasi oleh ${actor(req)}. Tidak mengubah nominal Finance, saldo, jurnal, atau approval.`,
        sourceSnapshotRecoverySourceUpdatedAt: snapshot.sourceInputDate ? new Date(snapshot.sourceInputDate) : null,
      };
      const set = {};
      for (const [field, value] of Object.entries(fields)) {
        const currentValue = transaction.get(field);
        const amountSnapshotMissing = ['source_amount_in', 'source_amount_out'].includes(field) && Number(currentValue || 0) === 0 && Number(value || 0) > 0;
        const missing = currentValue === undefined || currentValue === null || currentValue === '' || (Array.isArray(currentValue) && currentValue.length === 0) || amountSnapshotMissing;
        if (missing || field === 'sourceSnapshotRecoveryStatus' || field === 'sourceSnapshotRecoveredAt' || field === 'sourceSnapshotRecoveryNote' || field === 'sourceSnapshotRecoverySourceUpdatedAt') set[field] = value;
      }
      const updated = await SyncTransaction.findOneAndUpdate({ _id: transaction._id, sourceSnapshotRecoveryStatus: { $ne: 'APPLIED' }, journal_status: { $nin: [JOURNAL_STATUSES.POSTED, JOURNAL_STATUSES.REVERSED] }, status: { $nin: ['APPROVED', 'REJECTED'] } }, { $set: set }, { new: true, session, runValidators: true });
      if (!updated) return { result: 'IDEMPOTENT', reason: 'Transaksi sudah diproses oleh proses lain atau sudah final.' };
      await AuditLog.create([{ actor: actor(req), action: 'NAGAGOLD_SNAPSHOT_RECOVERY_APPLIED', entityType: 'FINANCE_TRANSACTION', entityId: id(updated._id), after: { batchId, sourceSnapshotRecoveryStatus: 'APPLIED', sourceFingerprint: snapshot.sourceSnapshotFingerprint, saldoChanged: false, journalChanged: false, approvalChanged: false }, correlationId: batchId }], { session });
      return { result: 'APPLIED', reason: 'Metadata snapshot dipulihkan setelah preview terverifikasi.' };
    });
    results.push({ transactionId: row.transactionId, transactionNumber: row.transactionNumber, ...result });
  }
  res.json({ previewOnly: false, writesPerformed: results.some((item) => item.result === 'APPLIED'), batchId, results, summary: { applied: results.filter((item) => item.result === 'APPLIED').length, idempotent: results.filter((item) => item.result === 'IDEMPOTENT').length, skipped: results.filter((item) => item.result === 'SKIPPED').length } });
}));

app.post('/api/nagagold-transactions/:id/classify', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const transaction = await SyncTransaction.findOne(nagagoldTransactionQuery({ _id: req.params.id }));
  if (!transaction) throw new HttpError(404, 'Transaksi Nagagold tidak ditemukan.');
  const result = await classifyStoredNagagoldTransaction(transaction, { classifiedBy: actor(req) });
  const refreshed = await SyncTransaction.findById(transaction._id);
  res.json(serializeTransaction(refreshed, await resolveAccountsMap()));
}));

app.post('/api/nagagold-transactions/classification/dry-run', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const query = nagagoldTransactionQuery();
  if (body.kodeToko) query.kodeToko = String(body.kodeToko).toUpperCase();
  if (body.classificationStatus) query.classification_status = String(body.classificationStatus).toUpperCase();
  if (body.dateFrom || body.dateTo) query.transactionDate = { ...(body.dateFrom ? { $gte: String(body.dateFrom).slice(0, 10) } : {}), ...(body.dateTo ? { $lte: String(body.dateTo).slice(0, 10) } : {}) };
  const limit = Math.min(5000, Math.max(1, Number(body.limit || 1000)));
  const transactions = await SyncTransaction.find(query).sort({ transactionDate: -1, createdAt: -1 }).limit(limit);
  // Dry-run deliberately does not persist classification metadata and does not query or update saldo/jurnal.
  const rows = await classifyNagagoldTransactions(transactions, { persist: false, reconciliationCandidateCount: 0 });
  const accounts = await resolveAccountsMap();
  const summary = dryRunSummary(rows);
  const autoPostingRules = await NagagoldAutoPostingRule.find({ source_system: 'nagagold' }).lean();
  const whitelistResults = rows.map(({ transaction, classification }) => evaluateAutoPostingWhitelist({ ...transaction, classification_status: classification.status }, autoPostingRules));
  summary.autoPostingWhitelist = {
    systemEnabled: NAGAGOLD_AUTO_POSTING_ENABLED,
    totalRules: autoPostingRules.length,
    activeRules: autoPostingRules.filter((rule) => rule.aktif === true).length,
    matchedTransactions: whitelistResults.filter((item) => item.matchedRuleId).length,
    eligibleTransactions: whitelistResults.filter((item) => item.eligible).length,
    reasons: whitelistResults.reduce((result, item) => { result[item.reason] = (result[item.reason] || 0) + 1; return result; }, {}),
  };
  res.json({
    dryRun: true,
    autoPostingEnabled: false,
    ruleVersion: NAGAGOLD_CLASSIFICATION_RULE_VERSION,
    filter: { kodeToko: body.kodeToko || '', dateFrom: body.dateFrom || '', dateTo: body.dateTo || '', limit },
    summary,
    transactions: rows.map(({ transaction, classification }) => ({
      ...serializeTransaction(transaction, accounts),
      classification_status: classification.status,
      classificationStatus: classification.status,
      classificationStatusLabel: classification.statusLabel,
      classification_reason: classification.reason,
      classificationReason: classification.reason,
      classification_rule_version: classification.ruleVersion,
      classificationRuleVersion: classification.ruleVersion,
      classification_proposal: classification.proposedJournal,
      classificationProposal: classification.proposedJournal,
      classification_flags: classification.flags,
      classificationFlags: classification.flags,
      autoPostingWhitelist: evaluateAutoPostingWhitelist({ ...transaction, classification_status: classification.status }, autoPostingRules),
    })),
  });
}));

app.post('/api/nagagold-transactions/:id/validate', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  await assertPeriodOpen();
  const transaction = await SyncTransaction.findOne(nagagoldTransactionQuery({ _id: req.params.id }));
  if (!transaction) throw new HttpError(404, 'Transaksi Nagagold tidak ditemukan.');
  const result = await postImportedNagagoldTransaction(transaction._id);
  const refreshed = await SyncTransaction.findById(transaction._id);
  if (!result.posted && refreshed?.journal_status !== JOURNAL_STATUSES.POSTED && refreshed?.reconciliation_status !== RECONCILIATION_STATUSES.MATCHED) {
    throw new HttpError(422, result.reason || 'Transaksi Nagagold belum memenuhi syarat untuk dibukukan.');
  }
  res.json(serializeTransaction(refreshed, await resolveAccountsMap()));
}));

app.post('/api/nagagold-transactions/bulk-validate', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  await assertPeriodOpen();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const processed = [];
  const ignored = [];
  for (const transactionId of ids) {
    try {
      const result = await postImportedNagagoldTransaction(transactionId);
      if (result.posted || result.idempotent) processed.push(transactionId);
      else ignored.push(transactionId);
    } catch { ignored.push(transactionId); }
  }
  res.json({ processed, ignored });
}));

app.post('/api/transactions', requireRole('ADMIN', 'SUPER_USER'), asyncRoute(async (req, res) => {
  await assertPeriodOpen();
  const body = req.body || {};
  const directMutation = String(body.bentukTransaksi || body.mode || '').trim().toUpperCase() === 'MUTASI_REKENING';
  if (body.requestId) {
    const request = await TransferRequest.findOne({ requestId: body.requestId });
    if (!request) throw new HttpError(422, 'Request cabang tidak ditemukan.');
    const result = await recordRequestPayment(request._id, body, req);
    return res.status(result.idempotent ? 200 : 201).json(serializeTransaction(result.transaction, await resolveAccountsMap()));
  }
  if (!body.jenisTransaksi || (!directMutation && !body.jenisRequest) || !body.sourceAccountId || !body.destinationAccountId || !Number(body.amount)) throw new HttpError(422, 'Jenis transaksi, akun sumber, akun tujuan, dan nominal wajib diisi.');
  const transactionDate = await currentBusinessDate();
  const normalizedJenisTransaksi = String(body.jenisTransaksi).trim().toUpperCase();
  const normalizedJenisRequest = String(body.jenisRequest || (directMutation ? 'MUTASI_REKENING' : '')).trim().toUpperCase();
  if (!await TransactionType.exists({ kode_jenis: normalizedJenisTransaksi, aktif: true })) throw new HttpError(422, 'Jenis transaksi belum terdaftar atau sudah nonaktif di Master Jenis Transaksi.');
  if (!directMutation && !await RequestType.exists({ kode_jenis: normalizedJenisRequest, aktif: true })) throw new HttpError(422, 'Jenis request belum terdaftar atau sudah nonaktif di Master Jenis Request.');
  if (body.sourceAccountId === body.destinationAccountId) throw new HttpError(422, 'Akun sumber dan tujuan tidak boleh sama.');
  const accounts = await Promise.all([accountById(body.sourceAccountId), accountById(body.destinationAccountId)]);
  if (String(accounts[0]._id) === String(accounts[1]._id)) throw new HttpError(422, 'Rekening sumber dan tujuan tidak boleh sama.');
  const sourceBalance = await availableBalance(body.sourceAccountId);
  if (sourceBalance < Number(body.amount)) throw new HttpError(422, `Saldo tersedia pada rekening sumber tidak cukup. Saldo tersedia: ${sourceBalance}.`);
  const sourceSnapshot = mutationAccountSnapshot(accounts[0]);
  const destinationSnapshot = mutationAccountSnapshot(accounts[1]);
  const transaction = await withMongoTransaction(async (session) => {
    const created = await FinanceMutation.create([{
      transactionNumber: await nextMutationNumber(transactionDate, session), bentukTransaksi: 'TRANSFER_INTERNAL', kategori_sistem: 'MUTASI', requestId: '', transactionDate, jenisTransaksi: normalizedJenisTransaksi, jenisRequest: normalizedJenisRequest, arahDana: String(body.arahDana || 'KELUAR').trim().toUpperCase(), kodeToko: String(body.kodeToko || '').trim().toUpperCase(), namaTokoSnapshot: String(body.namaToko || '').trim().toUpperCase(), sourceAccountId: accounts[0]._id, destinationAccountId: accounts[1]._id, bank_asal: sourceSnapshot.bank, bank_tujuan: destinationSnapshot.bank, jenis_kas_asal: sourceSnapshot.cashType, jenis_kas_tujuan: destinationSnapshot.cashType, amount: Number(body.amount), status: 'PENDING_APPROVAL', statusValid: false, note: String(body.note || '').trim().toUpperCase() || '-', created_by: actor(req), source_type: SOURCE_TYPES.MANUAL_ADMIN, sync_status: SYNC_STATUSES.NOT_APPLICABLE, sync_message: '', approval_status: APPROVAL_STATUSES.PENDING, payment_status: PAYMENT_STATUSES.NOT_APPLICABLE, journal_status: JOURNAL_STATUSES.PROVISIONAL, source_payment_method: directMutation ? 'INTERNAL' : 'BANK', source_transaction_id: '', finance_transaction_id: '',
    }], { session });
    const item = created[0];
    await ensureInitialJournal(item, session);
    await applyTransferBalance(item, session);
    await Notification.create([{ type: 'PENDING_APPROVAL', title: 'Transaksi menunggu verifikasi', message: `${item.transactionNumber} dari ${item.kodeToko} menunggu approval.`, referenceType: 'TRANSACTION', referenceId: id(item._id) }], { session });
    return item;
  });
  await refreshReconciliationForManual(transaction._id);
  res.status(201).json(serializeTransaction(transaction, await resolveAccountsMap()));
}));

async function approveOrRejectLegacy(ids, action, reason = '', req) {
  const normalizedIds = ids.filter((value) => mongoose.isValidObjectId(value));
  if (!normalizedIds.length) throw new HttpError(422, 'Tidak ada transaksi yang valid dipilih.');
  if (action === 'REJECT' && !reason.trim()) throw new HttpError(422, 'Alasan reject wajib diisi.');
  const batchId = createNumber('BATCH');
  const result = await withMongoTransaction(async (session) => {
    const processed = [];
    for (const transactionId of normalizedIds) {
      const transaction = await findFinanceTransactionById(transactionId, session);
      if (transaction && (transaction.status !== 'PENDING_APPROVAL' || transaction.approval_status === APPROVAL_STATUSES.NOT_REQUIRED)) continue;
      if (!transaction) continue;
      if (transaction.isImported && transaction.statusSumber !== 'OPEN') throw new HttpError(422, `Transaksi sumber ${transaction.transactionNumber} belum berstatus OPEN.`);
      let initialJournal = await findTransactionJournal(transaction, session);
      if (action === 'APPROVE' && !initialJournal) {
        initialJournal = transaction.bentukTransaksi === 'MUTASI_REKENING'
          ? await ensureMutationJournal(transaction, session)
          : await ensureInitialJournal(transaction, session);
      }
      const initialEntries = initialJournal ? await transactionFinanceEntries(transaction, initialJournal, session) : [];
      if (action === 'APPROVE') {
        if (transaction.bentukTransaksi === 'MUTASI_REKENING') {
          const sourceBalance = await availableBalance(transaction.rekeningId, session);
          if (transaction.arahDana === 'KELUAR' && sourceBalance < 0) throw new HttpError(422, `Saldo rekening sumber tidak cukup untuk ${transaction.transactionNumber}.`);
          transaction.status = 'APPROVED'; transaction.statusValid = true; transaction.approval_status = APPROVAL_STATUSES.APPROVED; transaction.approved_at = now(); transaction.approved_by = actor(req); await transaction.save({ session });
          await Account.updateOne({ _id: transaction.rekeningId }, { $inc: { saldo_akhir: transaction.arahDana === 'MASUK' ? transaction.amount : -transaction.amount } }, { session });
          if (initialJournal) { await setFinanceEntriesStatus(initialEntries, 'POSTED', session, actor(req)); transaction.journal_status = JOURNAL_STATUSES.POSTED; await transaction.save({ session }); }
        } else {
          const sourceBalance = await availableBalance(transaction.sourceAccountId, session);
          if (sourceBalance < 0) throw new HttpError(422, `Saldo rekening sumber tidak cukup untuk ${transaction.transactionNumber}.`);
          transaction.status = 'APPROVED'; transaction.statusValid = true; transaction.approval_status = APPROVAL_STATUSES.APPROVED; transaction.approved_at = now(); transaction.approved_by = actor(req); await transaction.save({ session });
          await Account.updateOne({ _id: transaction.sourceAccountId }, { $inc: { saldo_akhir: -transaction.amount } }, { session });
          await Account.updateOne({ _id: transaction.destinationAccountId }, { $inc: { saldo_akhir: transaction.amount } }, { session });
          if (initialJournal) { await setFinanceEntriesStatus(initialEntries, 'POSTED', session, actor(req)); transaction.journal_status = JOURNAL_STATUSES.POSTED; await transaction.save({ session }); }
        }
        await ApprovalAction.create([{ transactionId: id(transaction._id), action: 'APPROVE', actor: actor(req), batchId }], { session });
        await AuditLog.create([{ actor: actor(req), action: 'TRANSACTION_APPROVED', entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id), after: { status: 'APPROVED', statusValid: true }, correlationId: batchId }], { session });
      } else {
        if (transaction.bentukTransaksi === 'MUTASI_REKENING') {
          transaction.status = 'REJECTED'; transaction.statusValid = false; transaction.approval_status = APPROVAL_STATUSES.REJECTED; transaction.rejected_at = now(); transaction.rejected_by = actor(req); transaction.rejection_reason = reason.trim(); transaction.journal_status = initialJournal ? JOURNAL_STATUSES.REVERSED : JOURNAL_STATUSES.NOT_CREATED; await transaction.save({ session });
          if (initialJournal) { await setFinanceEntriesStatus(initialEntries, 'REVERSED', session); }
          await ApprovalAction.create([{ transactionId: id(transaction._id), action: 'REJECT', actor: actor(req), reason: reason.trim(), batchId }], { session });
          await AuditLog.create([{ actor: actor(req), action: 'TRANSACTION_REJECTED', entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id), after: { status: 'REJECTED', statusValid: false }, correlationId: batchId }], { session });
          if (transaction.matched_transaction_id) {
            const pair = await SyncTransaction.findOne({ _id: transaction.matched_transaction_id, isImported: true }).session(session);
            if (pair) {
              pair.reconciliation_status = RECONCILIATION_STATUSES.CONFLICT;
              pair.reconciliation_note = `Transfer Finance ditolak Owner: ${reason.trim()}. Pasangan hasil fetch perlu diperiksa ulang.`;
              pair.sync_status = SYNC_STATUSES.NEEDS_REVIEW;
              pair.sync_message = pair.reconciliation_note;
              pair.approval_status = APPROVAL_STATUSES.NOT_STARTED;
              await pair.save({ session });
              await AuditLog.create([{ actor: actor(req), action: 'RECONCILIATION_CONFLICT', entityType: 'FINANCE_TRANSACTION', entityId: id(pair._id), after: { matchedTransactionId: id(transaction._id), reason: pair.reconciliation_note }, correlationId: batchId }], { session });
            }
          }
          processed.push(id(transaction._id));
          continue;
        }
        let reversal = transaction.reversal?.journalId ? [await JournalEntry.findOne({ no_keuangan: transaction.reversal.journalId }).session(session)] : null;
        if (!reversal?.[0]) {
          const reversalJournal = await ensureReversalJournal(transaction, initialJournal, session, actor(req));
          reversal = reversalJournal?._allEntries || (reversalJournal ? [reversalJournal] : []);
        }
        transaction.status = 'REJECTED'; transaction.statusValid = false; transaction.approval_status = APPROVAL_STATUSES.REJECTED; transaction.journal_status = JOURNAL_STATUSES.REVERSED; transaction.rejected_at = now(); transaction.rejected_by = actor(req); transaction.rejection_reason = reason.trim(); transaction.reversal = { reversalDate: transaction.reversal?.reversalDate || await currentBusinessDate(session), amount: transaction.amount, sourceAccountId: id(transaction.destinationAccountId), destinationAccountId: id(transaction.sourceAccountId), journalId: id(reversal[0]?._id || transaction.reversal?.journalId) }; await transaction.save({ session });
        if (initialJournal) { await setFinanceEntriesStatus(initialEntries, 'REVERSED', session); }
        await ApprovalAction.create([{ transactionId: id(transaction._id), action: 'REJECT', actor: actor(req), reason: reason.trim(), batchId }], { session });
        await AuditLog.create([{ actor: actor(req), action: 'TRANSACTION_REJECTED_WITH_REVERSAL', entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id), after: { status: 'REJECTED', statusValid: false, reversalJournalId: id(reversal[0]._id) }, correlationId: batchId }], { session });
        if (transaction.matched_transaction_id) {
          const pair = await SyncTransaction.findOne({ _id: transaction.matched_transaction_id, isImported: true }).session(session);
          if (pair) {
            pair.reconciliation_status = RECONCILIATION_STATUSES.CONFLICT;
            pair.reconciliation_note = `Transfer Finance ditolak Owner: ${reason.trim()}. Pasangan hasil fetch perlu diperiksa ulang.`;
            pair.sync_status = SYNC_STATUSES.NEEDS_REVIEW;
            pair.sync_message = pair.reconciliation_note;
            pair.approval_status = APPROVAL_STATUSES.NOT_STARTED;
            await pair.save({ session });
            await AuditLog.create([{ actor: actor(req), action: 'RECONCILIATION_CONFLICT', entityType: 'FINANCE_TRANSACTION', entityId: id(pair._id), after: { matchedTransactionId: id(transaction._id), reason: pair.reconciliation_note }, correlationId: batchId }], { session });
          }
        }
      }
      processed.push(id(transaction._id));
    }
    return processed;
  });
  return { batchId, processed: result, ignored: normalizedIds.filter((value) => !result.includes(value)) };
}

async function markMatchedImportedConflict(transaction, reason, session, batchId, req) {
  if (!transaction.matched_transaction_id) return;
  const pair = await SyncTransaction.findOne({ _id: transaction.matched_transaction_id, isImported: true }).session(session);
  if (!pair) return;
  pair.reconciliation_status = RECONCILIATION_STATUSES.CONFLICT;
  pair.reconciliation_note = `Transfer Finance ditolak Owner: ${reason}. Pasangan hasil fetch perlu diperiksa ulang.`;
  pair.sync_status = SYNC_STATUSES.NEEDS_REVIEW;
  pair.sync_message = pair.reconciliation_note;
  pair.approval_status = APPROVAL_STATUSES.NOT_STARTED;
  await pair.save({ session });
  await AuditLog.create([{ actor: actor(req), action: 'RECONCILIATION_CONFLICT', entityType: 'FINANCE_TRANSACTION', entityId: id(pair._id), after: { matchedTransactionId: id(transaction._id), reason: pair.reconciliation_note }, correlationId: batchId }], { session });
}

async function syncRequestPaymentState(transaction, action, reason, req, session, batchId) {
  if (transaction.source_type !== SOURCE_TYPES.BRANCH_REQUEST || !String(transaction.requestId || '').trim()) return;
  const isApproved = action === 'APPROVE';
  const update = isApproved
    ? { status: 'PAID', payment_status: PAYMENT_STATUSES.PAID, approved_by: transaction.approved_by || actor(req), approved_at: transaction.approved_at || now() }
    : { status: 'PAYMENT_REJECTED', payment_status: PAYMENT_STATUSES.CANCELLED, rejected_by: actor(req), rejected_at: now(), rejection_reason: reason };
  const request = await TransferRequest.findOneAndUpdate(
    { requestId: transaction.requestId, finance_transaction_id: id(transaction._id), status: 'WAITING_PAYMENT_APPROVAL' },
    { $set: update },
    { new: true, session },
  );
  if (!request) throw new HttpError(409, 'Status request tidak sesuai dengan status realisasi pembayaran.');
  await AuditLog.create([{ actor: actor(req), action: isApproved ? 'REQUEST_PAYMENT_APPROVED' : 'REQUEST_PAYMENT_REJECTED', entityType: 'TRANSFER_REQUEST', entityId: id(request._id), after: { status: request.status, payment_status: request.payment_status, transactionId: id(transaction._id), reason }, correlationId: batchId }], { session });
}

async function processTransactionDecision(transactionId, action, reason, req, session, batchId) {
  const transaction = await findFinanceTransactionById(transactionId, session);
  if (transaction && (transaction.status !== 'PENDING_APPROVAL' || transaction.approval_status === APPROVAL_STATUSES.NOT_REQUIRED)) return { state: 'ignored', id: transactionId };
  if (!transaction) return { state: 'ignored', id: transactionId };
  if (transaction.isImported && transaction.statusSumber !== 'OPEN') throw new HttpError(422, `Transaksi sumber ${transaction.transactionNumber} belum berstatus OPEN.`);
  let initialJournal = await findTransactionJournal(transaction, session);
  if (action === 'APPROVE') {
    if (!initialJournal) initialJournal = transaction.bentukTransaksi === 'MUTASI_REKENING' ? await ensureMutationJournal(transaction, session) : await ensureInitialJournal(transaction, session);
    const initialEntries = await transactionFinanceEntries(transaction, initialJournal, session);
    const alreadyPosted = initialJournal.status === 'POSTED';
    if (!alreadyPosted) {
      if (transaction.saldo_status !== BALANCE_STATUSES.APPLIED) {
        if (transaction.bentukTransaksi === 'MUTASI_REKENING') {
          const sourceBalance = await availableBalance(transaction.rekeningId, session);
          if (transaction.arahDana === 'KELUAR' && sourceBalance < transaction.amount) throw new HttpError(422, `Saldo rekening sumber tidak cukup untuk ${transaction.transactionNumber}.`);
          await Account.updateOne({ _id: transaction.rekeningId }, { $inc: { saldo_akhir: transaction.arahDana === 'MASUK' ? transaction.amount : -transaction.amount } }, { session });
          transaction.saldo_status = BALANCE_STATUSES.APPLIED;
          await transaction.save({ session });
        } else {
          await applyTransferBalance(transaction, session);
        }
      }
      await setFinanceEntriesStatus(initialEntries, 'POSTED', session, actor(req));
    }
    transaction.status = 'APPROVED'; transaction.statusValid = true; transaction.approval_status = APPROVAL_STATUSES.APPROVED; transaction.approved_at = transaction.approved_at || now(); transaction.approved_by = transaction.approved_by || actor(req); transaction.payment_status = transaction.source_type === SOURCE_TYPES.BRANCH_REQUEST ? PAYMENT_STATUSES.PAID : transaction.payment_status; transaction.journal_status = JOURNAL_STATUSES.POSTED;
    await transaction.save({ session });
    await syncRequestPaymentState(transaction, action, '', req, session, batchId);
    await ApprovalAction.create([{ transactionId: id(transaction._id), action: 'APPROVE', actor: actor(req), batchId }], { session });
    await AuditLog.create([{ actor: actor(req), action: alreadyPosted ? 'TRANSACTION_APPROVAL_RECONCILED' : 'TRANSACTION_APPROVED', entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id), after: { status: transaction.status, statusValid: true, journal_status: transaction.journal_status }, correlationId: batchId }], { session });
    return { state: 'processed', id: id(transaction._id), status: transaction.status };
  }

  const wasPosted = initialJournal?.status === 'POSTED' || transaction.journal_status === JOURNAL_STATUSES.POSTED;
  const initialEntries = initialJournal ? await transactionFinanceEntries(transaction, initialJournal, session) : [];
  const balanceApplied = transaction.saldo_status === BALANCE_STATUSES.APPLIED;
  const needsBalanceReversal = balanceApplied || wasPosted;
  if (needsBalanceReversal && !initialJournal) throw new HttpError(409, `Jurnal transaksi ${transaction.transactionNumber} tidak ditemukan; saldo tidak dibalik otomatis.`);
  let reversal = null;
  if (needsBalanceReversal) {
    reversal = await ensureReversalJournal(transaction, initialJournal, session, actor(req));
    if (!reversal) throw new HttpError(409, `Jurnal pembalik untuk ${transaction.transactionNumber} tidak dapat dibuat.`);
    if (transaction.bentukTransaksi === 'MUTASI_REKENING') {
      await Account.updateOne({ _id: transaction.rekeningId }, { $inc: { saldo_akhir: transaction.arahDana === 'MASUK' ? -transaction.amount : transaction.amount } }, { session });
      transaction.saldo_status = BALANCE_STATUSES.REVERSED;
    } else {
      if (balanceApplied) await reverseTransferBalance(transaction, session);
      else {
        await Account.updateOne({ _id: transaction.sourceAccountId }, { $inc: { saldo_akhir: transaction.amount } }, { session });
        await Account.updateOne({ _id: transaction.destinationAccountId }, { $inc: { saldo_akhir: -transaction.amount } }, { session });
      }
      transaction.saldo_status = BALANCE_STATUSES.REVERSED;
    }
    await setFinanceEntriesStatus(initialEntries, 'REVERSED', session);
  } else if (initialJournal) {
    await setFinanceEntriesStatus(initialEntries, 'REVERSED', session);
  }
  transaction.status = 'REJECTED'; transaction.statusValid = false; transaction.approval_status = APPROVAL_STATUSES.REJECTED; transaction.payment_status = transaction.source_type === SOURCE_TYPES.BRANCH_REQUEST ? PAYMENT_STATUSES.CANCELLED : transaction.payment_status; transaction.rejected_at = now(); transaction.rejected_by = actor(req); transaction.rejection_reason = reason; transaction.journal_status = needsBalanceReversal ? JOURNAL_STATUSES.REVERSED : (initialJournal ? JOURNAL_STATUSES.REVERSED : JOURNAL_STATUSES.NOT_CREATED);
  if (reversal && transaction.bentukTransaksi !== 'MUTASI_REKENING') transaction.reversal = { reversalDate: await currentBusinessDate(session), amount: transaction.amount, sourceAccountId: id(transaction.destinationAccountId), destinationAccountId: id(transaction.sourceAccountId), journalId: id(reversal._id) };
  await transaction.save({ session });
  await ApprovalAction.create([{ transactionId: id(transaction._id), action: 'REJECT', actor: actor(req), reason, batchId }], { session });
  await AuditLog.create([{ actor: actor(req), action: needsBalanceReversal ? 'TRANSACTION_REJECTED_WITH_REVERSAL' : 'TRANSACTION_REJECTED_BEFORE_POSTING', entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id), after: { status: transaction.status, statusValid: false, journal_status: transaction.journal_status, reversalJournalId: id(reversal?._id) }, correlationId: batchId }], { session });
  await syncRequestPaymentState(transaction, action, reason, req, session, batchId);
  await markMatchedImportedConflict(transaction, reason, session, batchId, req);
  return { state: 'processed', id: id(transaction._id), status: transaction.status };
}

async function approveOrReject(ids, action, reason = '', req) {
  const normalizedIds = ids.filter((value) => mongoose.isValidObjectId(value));
  const normalizedReason = String(reason || '').trim().toUpperCase();
  if (!normalizedIds.length) throw new HttpError(422, 'Tidak ada transaksi yang valid dipilih.');
  if (action === 'REJECT' && !normalizedReason) throw new HttpError(422, 'Alasan reject wajib diisi.');
  const batchId = createNumber('BATCH');
  const processed = [];
  const ignored = [];
  const failed = [];
  for (const transactionId of normalizedIds) {
    try {
      const result = await withMongoTransaction((session) => processTransactionDecision(transactionId, action, normalizedReason, req, session, batchId));
      if (result.state === 'processed') processed.push(result.id);
      else ignored.push(transactionId);
    } catch (error) {
      failed.push({ id: transactionId, message: error.message || 'Transaksi gagal diproses.' });
    }
  }
  return { batchId, processed, ignored, failed };
}

app.post('/api/transactions/bulk-approve', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrReject(Array.isArray(req.body?.ids) ? req.body.ids : [], 'APPROVE', '', req))));
app.post('/api/transactions/bulk-reject', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrReject(Array.isArray(req.body?.ids) ? req.body.ids : [], 'REJECT', req.body?.reason || '', req))));
app.post('/api/transactions/:id/approve', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrReject([req.params.id], 'APPROVE', '', req))));
app.post('/api/transactions/:id/reject', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrReject([req.params.id], 'REJECT', req.body?.reason || '', req))));

app.post('/api/transactions/:id/reverse', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) throw new HttpError(422, 'Alasan reversal wajib diisi.');
  const result = await withMongoTransaction(async (session) => {
    const transaction = await findFinanceTransactionById(req.params.id, session);
    if (!transaction) throw new HttpError(404, 'Transaksi tidak ditemukan.');
    const existingReversal = await findReversalJournal(transaction, session);
    if (existingReversal) return { transaction, reversal: existingReversal, idempotent: true };
    if (transaction.status !== 'APPROVED' || transaction.journal_status !== JOURNAL_STATUSES.POSTED) throw new HttpError(409, 'Hanya transaksi approved dengan jurnal posted yang dapat direversal.');
    const originalJournal = await findTransactionJournal(transaction, session);
    if (!originalJournal || originalJournal.status !== 'POSTED') throw new HttpError(409, 'Jurnal transaksi posted tidak ditemukan.');
    const reversal = await ensureReversalJournal(transaction, originalJournal, session, actor(req));
    if (transaction.bentukTransaksi === 'MUTASI_REKENING') {
      await Account.updateOne({ _id: transaction.rekeningId }, { $inc: { saldo_akhir: transaction.arahDana === 'MASUK' ? -transaction.amount : transaction.amount } }, { session });
    } else {
      await Account.updateOne({ _id: transaction.sourceAccountId }, { $inc: { saldo_akhir: transaction.amount } }, { session });
      await Account.updateOne({ _id: transaction.destinationAccountId }, { $inc: { saldo_akhir: -transaction.amount } }, { session });
      transaction.reversal = { reversalDate: await currentBusinessDate(session), amount: transaction.amount, sourceAccountId: id(transaction.destinationAccountId), destinationAccountId: id(transaction.sourceAccountId), journalId: id(reversal._id) };
    }
    transaction.journal_status = JOURNAL_STATUSES.REVERSED;
    await transaction.save({ session });
    await AuditLog.create([{ actor: actor(req), action: 'TRANSACTION_REVERSED', entityType: 'FINANCE_TRANSACTION', entityId: id(transaction._id), after: { journal_status: transaction.journal_status, reversalJournalId: id(reversal._id), reason }, correlationId: createNumber('REVERSAL') }], { session });
    return { transaction, reversal, idempotent: false };
  });
  res.json({ transaction: serializeTransaction(result.transaction, await resolveAccountsMap()), reversal: result.reversal, idempotent: result.idempotent });
}));

async function approveOrRejectOpeningBalancesLegacy(ids, action, reason = '', req) {
  const normalizedIds = ids.filter((value) => mongoose.isValidObjectId(value));
  const normalizedReason = String(reason || '').trim().toUpperCase();
  if (!normalizedIds.length) throw new HttpError(422, 'Tidak ada saldo awal yang valid dipilih.');
  if (action === 'REJECT' && !normalizedReason) throw new HttpError(422, 'Alasan reject wajib diisi.');
  const batchId = createNumber('SALDO');
  const processed = await withMongoTransaction(async (session) => {
    const result = [];
    for (const saldoId of normalizedIds) {
      const item = await OpeningBalance.findOne({ _id: saldoId, status: 'PENDING_APPROVAL' }).session(session);
      if (!item) continue;
      if (action === 'APPROVE') {
        item.status = 'APPROVED'; item.status_valid = true; item.approved_by = actor(req); item.approved_at = now(); await item.save({ session });
        await Account.updateOne({ _id: item.rekening_id }, { $inc: { saldo_akhir: item.nilai } }, { session });
        await AuditLog.create([{ actor: actor(req), action: 'OPENING_BALANCE_APPROVED', entityType: 'OPENING_BALANCE', entityId: id(item._id), after: { status: item.status, status_valid: true }, correlationId: batchId }], { session });
      } else {
        item.status = 'REJECTED'; item.status_valid = false; item.rejected_by = actor(req); item.rejected_at = now(); item.rejection_reason = normalizedReason; await item.save({ session });
        await AuditLog.create([{ actor: actor(req), action: 'OPENING_BALANCE_REJECTED', entityType: 'OPENING_BALANCE', entityId: id(item._id), after: { status: item.status, status_valid: false, alasan_penolakan: normalizedReason }, correlationId: batchId }], { session });
      }
      result.push(id(item._id));
    }
    return result;
  });
  return { batchId, processed, ignored: normalizedIds.filter((value) => !processed.includes(value)) };
}

async function approveOrRejectOpeningBalances(ids, action, reason = '', req) {
  const normalizedIds = ids.filter((value) => mongoose.isValidObjectId(value));
  const normalizedReason = String(reason || '').trim().toUpperCase();
  if (!normalizedIds.length) throw new HttpError(422, 'Tidak ada saldo awal yang valid dipilih.');
  if (action === 'REJECT' && !normalizedReason) throw new HttpError(422, 'Alasan reject wajib diisi.');
  const batchId = createNumber('SALDO');
  const processed = [];
  const ignored = [];
  const failed = [];
  for (const saldoId of normalizedIds) {
    try {
      const result = await withMongoTransaction(async (session) => {
        const item = await OpeningBalance.findOne({ _id: saldoId, status: 'PENDING_APPROVAL', status_valid: { $ne: true } }).session(session);
        if (!item) return { state: 'ignored', id: saldoId };
        if (action === 'REJECT') {
          const openingJournal = item.jurnal_id ? await JournalEntry.findOne({ no_keuangan: item.jurnal_id }).session(session) : null;
          if (item.saldo_status === BALANCE_STATUSES.APPLIED) {
            const reversal = await ensureOpeningReversalJournal(item, openingJournal, session, actor(req));
            if (!reversal) throw new HttpError(409, 'Jurnal saldo awal tidak ditemukan sehingga saldo tidak dapat dibalik.');
            const account = await Account.findOne({ _id: item.rekening_id, aktif: true }).session(session);
            if (!account) throw new HttpError(422, 'Rekening aktif untuk saldo awal tidak ditemukan sehingga jurnal balik tidak dapat diterapkan.');
            const currentBalance = Number(account.saldo_akhir || 0);
            if (currentBalance >= Number(item.nilai)) {
              account.saldo_akhir = currentBalance - Number(item.nilai);
              await account.save({ session });
            } else if (currentBalance !== 0) {
              throw new HttpError(422, 'Saldo rekening tidak cukup untuk membalik saldo awal tanpa membuat saldo negatif.');
            }
            if (openingJournal.status !== 'REVERSED') { openingJournal.status = 'REVERSED'; await openingJournal.save({ session }); }
            item.saldo_status = BALANCE_STATUSES.REVERSED;
            item.jurnal_balik_id = reversal.no_keuangan;
          } else if (openingJournal && openingJournal.status === 'PROVISIONAL') {
            openingJournal.status = 'REVERSED';
            await openingJournal.save({ session });
          }
          item.status = 'REJECTED'; item.status_valid = false; item.rejected_by = actor(req); item.rejected_at = now(); item.rejection_reason = normalizedReason;
          await item.save({ session });
          await AuditLog.create([{ actor: actor(req), action: item.saldo_status === BALANCE_STATUSES.REVERSED ? 'OPENING_BALANCE_REJECTED_WITH_REVERSAL' : 'OPENING_BALANCE_REJECTED', entityType: 'OPENING_BALANCE', entityId: id(item._id), after: { status: item.status, status_valid: false, saldo_status: item.saldo_status, jurnalBalikId: item.jurnal_balik_id, alasan_penolakan: normalizedReason }, correlationId: batchId }], { session });
          return { state: 'processed', id: id(item._id) };
        }
        const prior = await OpeningBalance.findOne({ _id: { $ne: item._id }, rekening_id: item.rekening_id, tanggal: item.tanggal, status: 'APPROVED', status_valid: true }).session(session);
        if (prior) throw new HttpError(409, `Saldo awal rekening pada tanggal ${item.tanggal} sudah pernah diterapkan.`);
        const existingJournal = item.jurnal_id ? await JournalEntry.findOne({ no_keuangan: item.jurnal_id }).session(session) : null;
        const journal = existingJournal || await ensureOpeningJournal(item, session, actor(req));
        const account = await accountById(item.rekening_id, session);
        if (item.saldo_status !== BALANCE_STATUSES.APPLIED) {
          const accountUpdate = await Account.updateOne({ _id: account._id, aktif: true }, { $inc: { saldo_akhir: item.nilai } }, { session });
          if (accountUpdate.modifiedCount !== 1) throw new HttpError(409, 'Saldo awal tidak dapat diterapkan pada rekening.');
          item.saldo_status = BALANCE_STATUSES.APPLIED;
          item.applied_by = actor(req);
          item.applied_at = now();
        }
        if (journal.status !== 'POSTED') { journal.status = 'POSTED'; journal.approved_by = actor(req); journal.approved_at = now(); await journal.save({ session }); }
        else if (!journal.approved_by) { journal.approved_by = actor(req); journal.approved_at = journal.approved_at || now(); await journal.save({ session }); }
        item.status = 'APPROVED'; item.status_valid = true; item.approved_by = actor(req); item.approved_at = now(); item.jurnal_id = journal.no_keuangan;
        await item.save({ session });
        await AuditLog.create([{ actor: actor(req), action: 'OPENING_BALANCE_APPROVED', entityType: 'OPENING_BALANCE', entityId: id(item._id), after: { status: item.status, status_valid: true, saldo_status: item.saldo_status, jurnalId: item.jurnal_id }, correlationId: batchId }], { session });
        return { state: 'processed', id: id(item._id) };
      });
      if (result.state === 'processed') processed.push(result.id); else ignored.push(saldoId);
    } catch (error) {
      failed.push({ id: saldoId, message: error.message || 'Saldo awal gagal diproses.' });
    }
  }
  return { batchId, processed, ignored, failed };
}

app.post('/api/saldo-awal/bulk-approve', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectOpeningBalances(Array.isArray(req.body?.ids) ? req.body.ids : [], 'APPROVE', '', req))));
app.post('/api/saldo-awal/bulk-reject', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectOpeningBalances(Array.isArray(req.body?.ids) ? req.body.ids : [], 'REJECT', req.body?.reason || '', req))));
app.post('/api/saldo-awal/:id/approve', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectOpeningBalances([req.params.id], 'APPROVE', '', req))));
app.post('/api/saldo-awal/:id/reject', requireRole('OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => res.json(await approveOrRejectOpeningBalances([req.params.id], 'REJECT', req.body?.reason || '', req))));

function reportHandler(loader) {
  return asyncRoute(async (req, res) => {
    const query = { ...(req.query || {}), __systemDate: await currentBusinessDate() };
    res.json(await loader(query));
  });
}

app.get('/api/reports/dashboard', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportDashboard));
app.get('/api/reports/financial', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportFinancial));
app.get('/api/reports/balances', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportBalances));
app.get('/api/reports/transactions', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler((query) => reportTransactions(query)));
app.get('/api/reports/integrated', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportIntegrated));
app.get('/api/reports/nagagold-source', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportNagagoldSource));
app.get('/api/reports/nagagold-cash', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportNagagoldCash));
app.get('/api/reports/nagagold-accounts', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportNagagoldAccounts));
app.get('/api/reports/mutations', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportMutations));
app.get('/api/reports/requests', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportRequests));
app.get('/api/reports/journals', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportJournals));
app.get('/api/reports/reconciliation', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportReconciliation));

function exportTitle(report) {
  return ({ financial: 'Laporan Kas & Bank', balances: 'Saldo Kas dan Rekening', transactions: 'Semua Transaksi Finance', integrated: 'Transaksi Terintegrasi Sumber', 'nagagold-source': 'Pergerakan Sumber', 'nagagold-cash': 'Laporan Cash Sumber', 'nagagold-accounts': 'Laporan Rekening Sumber', mutations: 'Mutasi Antar Kas', requests: 'Request dan Approval', journals: 'Jurnal dan Buku Besar', reconciliation: 'Rekonsiliasi Sumber' }[report] || 'Laporan Finance');
}

async function loadReportForExport(report, query) {
  const input = { ...(query || {}), export: true, page: 1, pageSize: reportExportLimit };
  if (report === 'financial') return reportFinancial(input);
  if (report === 'balances') return reportBalances(input);
  if (report === 'integrated') return reportIntegrated(input);
  if (report === 'nagagold-source') return reportNagagoldSource(input);
  if (report === 'nagagold-cash') return reportNagagoldCash(input);
  if (report === 'nagagold-accounts') return reportNagagoldAccounts(input);
  if (report === 'mutations') return reportMutations(input);
  if (report === 'requests') return reportRequests(input);
  if (report === 'journals') return reportJournals(input);
  if (report === 'reconciliation') return reportReconciliation(input);
  return reportTransactions(input);
}

const REPORT_EXPORT_COLORS = Object.freeze({
  dark: '1D2226',
  teal: '087C75',
  tealLight: 'E8F4F2',
  border: 'D5DBE0',
  stripe: 'F7F9FA',
  ink: '26343B',
  muted: '6D7D84',
  white: 'FFFFFF',
});

function reportExportFilterText(filters = {}) {
  const groupLabels = { CASH_GROUP: 'Kelompok kas', ACCOUNT: 'Rekening', UNIT: 'Unit bisnis', BRANCH: 'Toko / cabang', CATEGORY: 'Kategori' };
  const viewLabel = filters.view === 'detail' ? 'Detail' : filters.view === 'summary' ? 'Rekap' : '';
  const readable = (value) => String(value || '').replaceAll('_', ' ');
  return [
    `Periode: ${filters.dateFrom || '-'} s.d. ${filters.dateTo || '-'}`,
    filters.unit ? `Unit bisnis: ${filters.unit}` : '',
    filters.kelompokKasId ? 'Kelompok kas: Terpilih' : '',
    filters.accountId ? 'Rekening: Terpilih' : '',
    filters.kodeToko ? `Cabang: ${filters.kodeToko}` : '',
    filters.sourceType ? `Sumber: ${{ SYNC: 'Semua sumber', SYNC_NAGAGOLD: 'NAGAGOLD', SYNC_OPTIK: 'OPTIK' }[filters.sourceType] || readable(filters.sourceType)}` : '',
    filters.groupBy ? `Kelompokkan: ${groupLabels[filters.groupBy] || filters.groupBy}` : '',
    viewLabel ? `Tampilan: ${viewLabel}` : '',
    filters.search ? `Pencarian: ${filters.search}` : '',
    filters.kategoriSumber ? `Kategori: ${readable(filters.kategoriSumber)}` : '',
    filters.metodePembayaran ? `Metode: ${readable(filters.metodePembayaran)}` : '',
    `Status: ${readable(filters.journalStatus || 'POSTED')}`,
  ].filter(Boolean).join('  ·  ');
}

function isExportAmountKey(key = '') {
  return /debet|kredit|debit|credit|saldo|nominal|uang masuk|uang keluar|jumlah mutasi|confirmed/i.test(String(key));
}

function shouldExportTotalKey(key = '') {
  return isExportAmountKey(key) && !/saldo berjalan/i.test(String(key));
}

function reportExportTotals(rows, keys) {
  const totals = new Map();
  keys.forEach((key) => {
    if (!shouldExportTotalKey(key)) return;
    const value = rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? row[key] : 0), 0);
    if (value || rows.some((row) => typeof row[key] === 'number')) totals.set(key, value);
  });
  return totals;
}

function excelColumnLetter(number) {
  let result = '';
  let value = number;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function excelCellWidth(key, rows) {
  const values = rows.slice(0, 300).map((row) => String(row[key] ?? ''));
  const longest = Math.max(String(key).length, ...values.map((value) => value.length));
  const preferred = isExportAmountKey(key) ? Math.max(longest + 2, 16) : longest + 3;
  return Math.min(42, Math.max(13, preferred));
}

async function sendExcelExport(report, payload, res) {
  const rows = reportRowsForExport(report, payload);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Finance Sambas';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Laporan');
  const keys = rows.length ? Object.keys(rows[0]) : ['Keterangan'];
  sheet.columns = keys.map((key) => ({ key, width: excelCellWidth(key, rows) }));
  const filters = payload.filters || {};
  const filterText = reportExportFilterText(filters);
  const lastColumn = excelColumnLetter(keys.length);
  sheet.addRow(['FINANCE SAMBAS']);
  sheet.addRow([exportTitle(report)]);
  sheet.addRow([filterText]);
  sheet.addRow([`Dibuat: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}  ·  ${rows.length} data`]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(keys);
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.mergeCells(`A3:${lastColumn}3`);
  sheet.mergeCells(`A4:${lastColumn}4`);
  for (const row of rows) sheet.addRow(row);
  const totalValues = reportExportTotals(rows, keys);
  if (totalValues.size) {
    const totalRow = sheet.addRow(keys.map((key, index) => index === 0 ? 'TOTAL' : totalValues.has(key) ? totalValues.get(key) : ''));
    totalRow.font = { bold: true, color: { argb: REPORT_EXPORT_COLORS.ink } };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_EXPORT_COLORS.tealLight } };
  }
  const styleRow = (row, style = {}) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'middle', ...style.alignment };
      if (style.font) cell.font = style.font;
      if (style.fill) cell.fill = style.fill;
      if (style.border) cell.border = style.border;
    });
  };
  styleRow(sheet.getRow(1), { font: { bold: true, size: 11, color: { argb: REPORT_EXPORT_COLORS.white } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_EXPORT_COLORS.dark } }, alignment: { horizontal: 'left' } });
  styleRow(sheet.getRow(2), { font: { bold: true, size: 15, color: { argb: REPORT_EXPORT_COLORS.white } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_EXPORT_COLORS.dark } }, alignment: { horizontal: 'left' } });
  styleRow(sheet.getRow(3), { font: { size: 10, color: { argb: REPORT_EXPORT_COLORS.muted } }, alignment: { horizontal: 'left', wrapText: true } });
  styleRow(sheet.getRow(4), { font: { italic: true, size: 9, color: { argb: REPORT_EXPORT_COLORS.muted } }, alignment: { horizontal: 'left' } });
  headerRow.height = 30;
  styleRow(headerRow, { font: { bold: true, color: { argb: REPORT_EXPORT_COLORS.white } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_EXPORT_COLORS.teal } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: { top: { style: 'thin', color: { argb: REPORT_EXPORT_COLORS.teal } }, bottom: { style: 'thin', color: { argb: REPORT_EXPORT_COLORS.teal } }, left: { style: 'thin', color: { argb: REPORT_EXPORT_COLORS.teal } }, right: { style: 'thin', color: { argb: REPORT_EXPORT_COLORS.teal } } } });
  for (let rowNumber = headerRow.number + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (rowNumber < sheet.rowCount && (rowNumber - headerRow.number) % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: REPORT_EXPORT_COLORS.stripe } };
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const key = keys[columnNumber - 1];
      cell.alignment = { vertical: 'top', horizontal: isExportAmountKey(key) ? 'right' : 'left', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: REPORT_EXPORT_COLORS.border } } };
      if (typeof cell.value === 'number') cell.numFmt = isExportAmountKey(key) ? '#,##0;[Red]-#,##0' : '#,##0';
    });
  }
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
  sheet.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: keys.length } };
  sheet.pageSetup = { paperSize: 9, orientation: keys.length > 7 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalDpi: 300, verticalDpi: 300 };
  sheet.pageMargins = { left: 0.25, right: 0.25, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 };
  sheet.printTitlesRow = `${headerRow.number}:${headerRow.number}`;
  sheet.headerFooter.oddFooter = '&LFinance Sambas&C&D&RHalaman &P dari &N';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="finance-${report}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

function pdfText(value) { return String(value ?? '').replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || '-'; }

function pdfDisplayValue(key, value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number' && isExportAmountKey(key)) return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value);
  return pdfText(value);
}

function pdfColumnWidths(keys, rows, availableWidth) {
  const weights = keys.map((key) => {
    const normalized = String(key).toLowerCase();
    if (/keterangan|deskripsi|rekening|referensi|transaksi/.test(normalized)) return 1.45;
    if (isExportAmountKey(key)) return 0.9;
    if (/tanggal|status|jenis|sumber|cabang|unit|mapping|approval|jurnal|arah/.test(normalized)) return 1;
    return 1.1;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) => availableWidth * weight / totalWeight);
}

function drawPdfTable(document, report, rows, keys, margin, startY, contentWidth) {
  const fontSize = keys.length > 10 ? 6.4 : 7.2;
  const cellPadding = 4;
  const rowGap = 2;
  const widths = pdfColumnWidths(keys, rows, contentWidth);
  const pageBottom = () => document.page.height - 38;
  let y = startY;
  const drawHeader = () => {
    const headerHeights = keys.map((key, index) => document.heightOfString(pdfText(key), { width: Math.max(20, widths[index] - cellPadding * 2), font: 'Helvetica-Bold', fontSize }));
    const height = Math.max(24, Math.min(44, Math.max(...headerHeights) + cellPadding * 2));
    let x = margin;
    keys.forEach((key, index) => {
      document.rect(x, y, widths[index], height).fillAndStroke('#087C75', '#087C75');
      document.font('Helvetica-Bold').fontSize(fontSize).fillColor('#FFFFFF').text(pdfText(key), x + cellPadding, y + cellPadding, { width: widths[index] - cellPadding * 2, height: height - cellPadding * 2, align: isExportAmountKey(key) ? 'right' : 'left' });
      x += widths[index];
    });
    y += height;
  };
  const drawRow = (row, index) => {
    const values = keys.map((key) => pdfDisplayValue(key, row[key]));
    const heights = values.map((value, columnIndex) => document.heightOfString(value, { width: Math.max(20, widths[columnIndex] - cellPadding * 2), font: 'Helvetica', fontSize }));
    const height = Math.max(22, Math.min(68, Math.max(...heights) + cellPadding * 2 + rowGap));
    if (y + height > pageBottom()) {
      document.addPage();
      document.font('Helvetica-Bold').fontSize(9).fillColor('#26343B').text(`${exportTitle(report)} (lanjutan)`, margin, 24, { width: contentWidth });
      y = 46;
      drawHeader();
    }
    let x = margin;
    keys.forEach((key, columnIndex) => {
      const fill = index % 2 === 1 ? '#F7F9FA' : '#FFFFFF';
      document.rect(x, y, widths[columnIndex], height).fillAndStroke(fill, '#D5DBE0');
      document.font('Helvetica').fontSize(fontSize).fillColor('#26343B').text(values[columnIndex], x + cellPadding, y + cellPadding, { width: widths[columnIndex] - cellPadding * 2, height: height - cellPadding * 2, align: isExportAmountKey(key) ? 'right' : 'left' });
      x += widths[columnIndex];
    });
    y += height;
  };
  drawHeader();
  rows.forEach(drawRow);
  const totals = reportExportTotals(rows, keys);
  if (totals.size) {
    const totalValues = Object.fromEntries(keys.map((key) => [key, totals.has(key) ? totals.get(key) : key === keys[0] ? 'TOTAL' : '']));
    drawRow(totalValues, rows.length + 1);
  }
  return y;
}

async function sendPdfExport(report, payload, res) {
  const rows = reportRowsForExport(report, payload);
  const keys = rows.length ? Object.keys(rows[0]) : ['Keterangan'];
  const layout = keys.length > 7 || report === 'financial' ? 'landscape' : 'portrait';
  const margin = layout === 'landscape' ? 28 : 32;
  const document = new PDFDocument({ size: 'A4', layout, margin, bufferPages: true });
  const contentWidth = document.page.width - margin * 2;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="finance-${report}-${new Date().toISOString().slice(0, 10)}.pdf"`);
  document.pipe(res);
  document.info.Title = exportTitle(report);
  document.info.Author = 'Finance Sambas';
  document.rect(0, 0, document.page.width, 76).fill('#1D2226');
  document.font('Helvetica-Bold').fontSize(8).fillColor('#B7C6CB').text('FINANCE SAMBAS', margin, 16, { width: contentWidth });
  document.font('Helvetica-Bold').fontSize(17).fillColor('#FFFFFF').text(exportTitle(report), margin, 31, { width: contentWidth });
  document.font('Helvetica').fontSize(8).fillColor('#D4E0E3').text(`Periode: ${payload.filters?.dateFrom || '-'} s.d. ${payload.filters?.dateTo || '-'}`, margin, 57, { width: contentWidth });
  document.y = 92;
  document.font('Helvetica').fontSize(8).fillColor('#607780').text(reportExportFilterText(payload.filters || {}), margin, document.y, { width: contentWidth });
  document.moveDown(0.5);
  document.font('Helvetica-Oblique').fontSize(7.5).fillColor('#8A989D').text(`Dibuat: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}  ·  ${rows.length} data`, margin, document.y, { width: contentWidth });
  document.moveDown(1.1);
  if (!rows.length) document.font('Helvetica').fontSize(10).fillColor('#333333').text('Tidak ada data sesuai filter.', margin, document.y, { width: contentWidth });
  else drawPdfTable(document, report, rows, keys, margin, document.y, contentWidth);
  const pages = document.bufferedPageRange();
  for (let index = 0; index < pages.count; index++) {
    document.switchToPage(index);
    document.moveTo(margin, document.page.height - 29).lineTo(document.page.width - margin, document.page.height - 29).strokeColor('#D5DBE0').lineWidth(.5).stroke();
    document.font('Helvetica').fontSize(7).fillColor('#607780').text('Finance Sambas', margin, document.page.height - 22, { width: contentWidth / 2 });
    document.text(`Halaman ${index + 1} dari ${pages.count}`, margin + contentWidth / 2, document.page.height - 22, { align: 'right', width: contentWidth / 2 });
  }
  document.end();
}

app.get('/api/reports/export', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), asyncRoute(async (req, res) => {
  const report = String(req.query.report || 'transactions').toLowerCase();
  const format = String(req.query.format || 'xlsx').toLowerCase();
  if (!['financial', 'balances', 'transactions', 'integrated', 'nagagold-source', 'nagagold-cash', 'nagagold-accounts', 'mutations', 'requests', 'journals', 'reconciliation'].includes(report)) throw new HttpError(422, 'Jenis laporan export tidak didukung.');
  if (!['xlsx', 'pdf'].includes(format)) throw new HttpError(422, 'Format export hanya xlsx atau pdf.');
  const payload = await loadReportForExport(report, { ...(req.query || {}), __systemDate: await currentBusinessDate() });
  if (format === 'pdf') return sendPdfExport(report, payload, res);
  return sendExcelExport(report, payload, res);
}));

app.get('/api/reports/summary', requireRole('ADMIN', 'OWNER', 'SUPER_USER'), reportHandler(reportDashboard));

app.get('/api/notifications', asyncRoute(async (req, res) => {
  const notifications = await Notification.find({}).sort({ createdAt: -1 }).limit(50).lean();
  res.json(notifications.map((item) => ({ ...item, id: id(item._id) })));
}));

app.use((error, req, res, next) => {
  if (error?.code === 11000) return res.status(409).json({ message: 'Data duplikat: kombinasi kode atau request ID sudah digunakan.' });
  const status = error.status || 500;
  if (status >= 500) {
    if (process.env.NODE_ENV === 'production') console.error(`[${req.method} ${req.path}] ${error.message || 'Internal server error'}`);
    else console.error(error);
  }
  return res.status(status).json({
    message: error.message || 'Terjadi kesalahan pada server.',
    ...(error.code ? { code: error.code } : {}),
    ...(error.integrationStatus ? { integrationStatus: error.integrationStatus } : {}),
  });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI belum diisi. Salin server/.env.example menjadi server/.env lalu isi koneksi MongoDB.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  if (LEGACY_MASTER_MIGRATION_ENABLED) await migrateLegacyMasterData();
  await ensureSystemProfile();
  await ensureSystemCashBank();
  await ensureSafeFinanceIndexes();
  const removedMutationReconciliationStatus = await removeMutationReconciliationStatus();
  const transactionBackfill = await backfillTransactionStatusMetadata();
  const requestBackfill = await backfillRequestPaymentStatus();
  if (removedMutationReconciliationStatus || transactionBackfill.updated || requestBackfill.updated) console.log(`Backfill status aman: ${transactionBackfill.updated} transaksi, ${requestBackfill.updated} request, ${removedMutationReconciliationStatus} mutasi dibersihkan.`);
  await syncAccountBalances();
  app.listen(port, () => console.log(`Finance Sambas API berjalan di http://localhost:${port}`));
  if (String(process.env.NAGAGOLD_SYNC_ENABLED).toLowerCase() === 'true') {
    const intervalMs = Math.max(1, Number(process.env.NAGAGOLD_SYNC_INTERVAL_MINUTES || 10)) * 60 * 1000;
    runNagagoldSync().catch((error) => console.error(`Sync Nagagold awal gagal: ${error.message}`));
    setInterval(() => runNagagoldSync().catch((error) => console.error(`Sync Nagagold gagal: ${error.message}`)), intervalMs);
    console.log(`Sync Nagagold aktif setiap ${intervalMs / 60000} menit.`);
  }
}

start().catch((error) => { console.error(error.message); process.exit(1); });
