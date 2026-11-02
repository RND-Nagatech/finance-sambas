import React, { useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Eye,
  EyeOff,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  Inbox,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  SquarePen,
  ReceiptText,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldCheck,
  Store,
  Trash2,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'finance-sambas-state-v1';
const LEGACY_STORAGE_KEY = 'finance-sambas-prototype-v1';
const AUTH_TOKEN_KEY = 'finance-sambas-auth-token';
const REMEMBER_LOGIN_KEY = 'finance-sambas-remember-login';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const ActionLoadingContext = React.createContext(false);

const accountSeed = [
  { id: 'root', name: 'Kas Utama', accountType: 'KAS_UTAMA', parentId: null, unitType: 'PUSAT', accountNumber: '', isActive: true },
  { id: 'main-bca', name: 'Rekening Utama BCA', accountType: 'REKENING', parentId: 'root', unitType: 'PUSAT', bankId: 'bank-bca', bankName: 'Bank Central Asia', accountNumber: '1122334455', isActive: true },
  { id: 'large-ng', name: 'Kas Besar Nagagold', accountType: 'KAS_BESAR', parentId: 'root', unitType: 'NAGAGOLD', accountNumber: '', isActive: true },
  { id: 'large-ng-bni', name: 'Rekening Kas Besar Nagagold', accountType: 'REKENING', parentId: 'large-ng', unitType: 'NAGAGOLD', bankId: 'bank-bni', bankName: 'Bank Negara Indonesia', accountNumber: '9876543210', isActive: true },
  { id: 'small-qbs', name: 'Kas Kecil Operasional', accountType: 'KAS_KECIL', parentId: 'large-ng', unitType: 'NAGAGOLD', accountNumber: '', isActive: true },
  { id: 'qbs-bank', name: 'Rekening Operasional', accountType: 'REKENING', parentId: 'small-qbs', unitType: 'NAGAGOLD', bankId: 'bank-bni', bankName: 'Bank Negara Indonesia', accountNumber: '1234567899', isActive: true },
  { id: 'large-optik', name: 'Kas Besar Optik', accountType: 'KAS_BESAR', parentId: 'root', unitType: 'OPTIK', accountNumber: '', isActive: true },
  { id: 'small-optik', name: 'Kas Kecil Operasional Optik', accountType: 'KAS_KECIL', parentId: 'large-optik', unitType: 'OPTIK', accountNumber: '', isActive: true },
];

const bankSeed = [
  { id: 'bank-tunai-system', code: 'TUNAI', name: 'TUNAI', isActive: true, isSystem: true },
  { id: 'bank-bca', code: 'BCA', name: 'Bank Central Asia', isActive: true },
  { id: 'bank-bni', code: 'BNI', name: 'Bank Negara Indonesia', isActive: true },
  { id: 'bank-mandiri', code: 'MANDIRI', name: 'Bank Mandiri', isActive: true },
  { id: 'bank-bri', code: 'BRI', name: 'Bank Rakyat Indonesia', isActive: true },
];

const cashTypeSeed = [
  { id: 'cash-type-main', code: 'KAS_UTAMA', name: 'KAS UTAMA', type: 'KAS_UTAMA', unit: 'PUSAT', parentId: '', order: 1, isActive: true, system: true, selectable: true },
  { id: 'cash-type-large-ng', code: 'KAS_BESAR_NAGAGOLD', name: 'KAS BESAR NAGAGOLD', type: 'KAS_BESAR', unit: 'NAGAGOLD', parentId: 'cash-type-main', order: 2, isActive: true, system: true, selectable: true },
  { id: 'cash-type-small-ng', code: 'KAS_KECIL_NAGAGOLD', name: 'KAS KECIL OPERASIONAL NAGAGOLD', type: 'KAS_KECIL', unit: 'NAGAGOLD', parentId: 'cash-type-large-ng', order: 3, isActive: true, system: true, selectable: true },
  { id: 'cash-type-large-optik', code: 'KAS_BESAR_OPTIK', name: 'KAS BESAR OPTIK', type: 'KAS_BESAR', unit: 'OPTIK', parentId: 'cash-type-main', order: 4, isActive: true, system: true, selectable: true },
  { id: 'cash-type-small-optik', code: 'KAS_KECIL_OPTIK', name: 'KAS KECIL OPERASIONAL OPTIK', type: 'KAS_KECIL', unit: 'OPTIK', parentId: 'cash-type-large-optik', order: 5, isActive: true, system: true, selectable: true },
];

const requestTypeSeed = [
  { id: 'request-type-buyback', code: 'PEMBAYARAN_BUYBACK', name: 'PEMBAYARAN BUYBACK', order: 1, isActive: true, system: true },
  { id: 'request-type-opening', code: 'SALDO_AWAL', name: 'SALDO AWAL', order: 2, isActive: true, system: true },
  { id: 'request-type-operational', code: 'TAMBAHAN_OPERASIONAL', name: 'TAMBAHAN OPERASIONAL', order: 3, isActive: true, system: true },
  { id: 'request-type-withdrawal', code: 'PENARIKAN_DANA', name: 'PENARIKAN DANA', order: 4, isActive: true, system: true },
];

const transactionTypeSeed = [
  { id: 'transaction-type-purchase', code: 'PEMBELIAN', name: 'PEMBELIAN', order: 1, isActive: true, system: true },
  { id: 'transaction-type-sales', code: 'PENJUALAN', name: 'PENJUALAN', order: 2, isActive: true, system: true },
  { id: 'transaction-type-transfer', code: 'TRANSFER_INTERNAL', name: 'TRANSFER INTERNAL', order: 3, isActive: true, system: true },
  { id: 'transaction-type-operational', code: 'OPERASIONAL', name: 'OPERASIONAL', order: 4, isActive: true, system: true },
];

const branchSeed = [
  { code: 'QBS', name: 'BACKUP SAMBAS #1' },
  { code: 'WTS', name: 'WATES SAMBAS' },
  { code: 'SBY', name: 'SAMBAS UTAMA' },
];

const requestSeed = [
  { id: 'rq-1', requestId: 'RQS-20261028-0001', sourceSystem: 'nagagold', jenisRequest: 'PEMBAYARAN_BUYBACK', kodeToko: 'QBS', namaToko: 'BACKUP SAMBAS #1', noRekening: '1234567899', nilaiRp: 10000000, requestedAt: '2026-10-28T09:00:00+07:00', tujuan: 'Pembayaran buyback', status: 'REQUESTED' },
  { id: 'rq-2', requestId: 'RQS-20261028-0002', sourceSystem: 'nagagold', jenisRequest: 'TAMBAHAN_OPERASIONAL', kodeToko: 'WTS', namaToko: 'WATES SAMBAS', noRekening: '5566778899', nilaiRp: 7500000, requestedAt: '2026-10-28T08:32:00+07:00', tujuan: 'Penambahan dana operasional toko', status: 'REQUESTED' },
  { id: 'rq-3', requestId: 'RQS-20261027-0009', sourceSystem: 'nagagold', jenisRequest: 'SALDO_AWAL', kodeToko: 'SBY', namaToko: 'SAMBAS UTAMA', noRekening: '7788990011', nilaiRp: 15000000, requestedAt: '2026-10-27T16:12:00+07:00', tujuan: 'Pengisian saldo awal', status: 'COMPLETED' },
];

const transactionSeed = [
  { id: 'tx-1', transactionNumber: 'MTS-20261028-0001', requestId: 'RQS-20261028-0001', transactionDate: '2026-10-28', jenisTransaksi: 'PEMBELIAN', jenisRequest: 'PEMBAYARAN_BUYBACK', kodeToko: 'QBS', namaToko: 'BACKUP SAMBAS #1', sourceAccountId: 'large-ng-bni', destinationAccountId: 'qbs-bank', amount: 10000000, paymentMethod: 'NON_CASH', status: 'PENDING_APPROVAL', statusValid: false, note: 'Transfer buyback dari Kas Besar Nagagold', createdAt: '2026-10-28T10:12:00+07:00' },
  { id: 'tx-2', transactionNumber: 'MTS-20261028-0002', requestId: 'RQS-20261028-0002', transactionDate: '2026-10-28', jenisTransaksi: 'TRANSFER_INTERNAL', jenisRequest: 'TAMBAHAN_OPERASIONAL', kodeToko: 'WTS', namaToko: 'WATES SAMBAS', sourceAccountId: 'large-ng-bni', destinationAccountId: 'qbs-bank', amount: 7500000, paymentMethod: 'NON_CASH', status: 'PENDING_APPROVAL', statusValid: false, note: 'Dana operasional toko', createdAt: '2026-10-28T09:42:00+07:00' },
  { id: 'tx-3', transactionNumber: 'MTS-20261027-0014', requestId: 'RQS-20261027-0009', transactionDate: '2026-10-27', jenisTransaksi: 'TRANSFER_INTERNAL', jenisRequest: 'SALDO_AWAL', kodeToko: 'SBY', namaToko: 'SAMBAS UTAMA', sourceAccountId: 'main-bca', destinationAccountId: 'large-ng-bni', amount: 15000000, paymentMethod: 'NON_CASH', status: 'APPROVED', statusValid: true, note: 'Pengisian saldo awal', createdAt: '2026-10-27T16:30:00+07:00', approvedAt: '2026-10-27T17:05:00+07:00' },
  { id: 'tx-4', transactionNumber: 'MTS-20261026-0011', requestId: 'RQS-20261026-0004', transactionDate: '2026-10-26', jenisTransaksi: 'TRANSFER_INTERNAL', jenisRequest: 'PENARIKAN_DANA', kodeToko: 'QBS', namaToko: 'BACKUP SAMBAS #1', sourceAccountId: 'qbs-bank', destinationAccountId: 'large-ng-bni', amount: 3000000, paymentMethod: 'NON_CASH', status: 'REJECTED', statusValid: false, note: 'Penarikan dana cabang', createdAt: '2026-10-26T14:20:00+07:00', rejectedAt: '2026-10-27T08:15:00+07:00', rejectionReason: 'Bukti transfer belum sesuai', reversal: { reversalDate: '2026-10-27', amount: 3000000 } },
];

const openingBalanceSeed = [];

// Laporan diaktifkan bertahap. Tambahkan id sub-menu di daftar ini saat laporan
// berikutnya siap ditampilkan kembali.
const REPORT_MENU_KEYS = Object.freeze(['reports-financial', 'reports-mutations']);
const REPORTS_MENU_ENABLED = REPORT_MENU_KEYS.length > 0;

const navGroups = [
  {
    label: 'MENU UTAMA',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'DATA MASTER',
    items: [
      { id: 'business-types', label: 'Master Jenis Bisnis', icon: Building2 },
      { id: 'banks', label: 'Master Bank', icon: Landmark },
      { id: 'accounts', label: 'Master Rekening & Kas', icon: WalletCards },
      { id: 'transaction-types', label: 'Master Jenis Transaksi', icon: ReceiptText },
      { id: 'request-types', label: 'Master Jenis Request', icon: Inbox },
      { id: 'branches', label: 'Master Cabang', icon: Building2 },
    ],
  },
  {
    label: 'TRANSAKSI',
    items: [
      { id: 'mutations', label: 'Mutasi Rekening / Kas', icon: ArrowLeftRight },
      { id: 'requests', label: 'Permintaan Dana', icon: Inbox, badge: 'requests' },
      { id: 'opening-balances', label: 'Saldo Awal', icon: WalletCards },
      { id: 'verification', label: 'Approval Center', icon: ClipboardCheck, badge: true },
    ],
  },
  {
    label: 'INTEGRASI NAGAGOLD',
    items: [
      { id: 'nagagold-transactions', label: 'Transaksi Terintegrasi', icon: RefreshCw },
      { id: 'nagagold-mapping', label: 'Mapping Nagagold', icon: Route },
    ],
  },
  {
    label: 'LAPORAN',
    items: [
      ...(REPORTS_MENU_ENABLED ? [{
        id: 'reports',
        label: 'Laporan',
        icon: FileBarChart2,
        hideParent: true,
        children: [
          { id: 'reports-financial', label: 'Laporan Kas & Bank', icon: FileBarChart2 },
          { id: 'reports-transactions', label: 'Semua Transaksi', icon: ReceiptText },
          { id: 'reports-balances', label: 'Saldo Kas & Rekening', icon: WalletCards },
          { id: 'reports-integrated', label: 'Terintegrasi Nagagold', icon: RefreshCw },
          { id: 'reports-source', label: 'Pergerakan Nagagold', icon: ArrowLeftRight },
          { id: 'reports-cash', label: 'Laporan Cash Nagagold', icon: Banknote },
          { id: 'reports-accounts', label: 'Laporan Rekening Nagagold', icon: Landmark },
          { id: 'reports-mutations', label: 'Laporan Mutasi Kas', icon: ArrowLeftRight },
          { id: 'reports-requests', label: 'Request & Approval', icon: Inbox },
          { id: 'reports-journals', label: 'Jurnal & Buku Besar', icon: FileBarChart2 },
          { id: 'reports-reconciliation', label: 'Rekonsiliasi', icon: Route },
        ].filter((item) => REPORT_MENU_KEYS.includes(item.id)),
      }] : []),
    ],
  },
];

const reportViewKeys = Object.freeze({
  'reports-financial': 'financial',
  'reports-transactions': 'transactions',
  'reports-balances': 'balances',
  'reports-integrated': 'integrated',
  'reports-source': 'nagagold-source',
  'reports-cash': 'nagagold-cash',
  'reports-accounts': 'nagagold-accounts',
  'reports-mutations': 'mutations',
  'reports-requests': 'requests',
  'reports-journals': 'journals',
  'reports-reconciliation': 'reconciliation',
});

const formatRupiah = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0);
const formatInputRupiah = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(digits))}` : '';
};
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');
const nextLocalNumber = (prefix, date, items, valueSelector) => {
  const dateKey = String(date || '').slice(0, 10).replaceAll('-', '');
  const marker = `${prefix}-${dateKey}-`;
  const max = items.reduce((highest, item) => {
    const value = String(valueSelector(item) || '');
    if (!value.startsWith(marker)) return highest;
    const number = Number(value.slice(marker.length));
    return Number.isInteger(number) ? Math.max(highest, number) : highest;
  }, 0);
  return `${marker}${String(max + 1).padStart(4, '0')}`;
};
const formatDate = (value, withTime = false) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
};
const getInitialState = () => {
  // Saat backend dikonfigurasi, MongoDB menjadi satu-satunya sumber data.
  // Jangan menampilkan cache prototype/localStorage karena dapat membuat master
  // yang sudah dihapus dari database terlihat muncul kembali.
  if (!API_BASE_URL) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
      if (saved?.accounts && saved?.requests && saved?.transactions) return { ...saved, banks: saved.banks?.length ? saved.banks : [bankSeed[0]], businessTypes: saved.businessTypes || [], cashTypes: saved.cashTypes || [], requestTypes: saved.requestTypes || [], transactionTypes: saved.transactionTypes || [], openingBalances: saved.openingBalances || [], nagagoldTransactions: saved.nagagoldTransactions || [], nagagoldAccounts: saved.nagagoldAccounts || [], nagagoldMappings: saved.nagagoldMappings || [], nagagoldMappingSummary: saved.nagagoldMappingSummary || null, nagagoldMappingExamples: saved.nagagoldMappingExamples || [], nagagoldAutoPostingRules: saved.nagagoldAutoPostingRules || [], nagagoldAutoPostingSettings: saved.nagagoldAutoPostingSettings || null, syncStatus: saved.syncStatus || [], branches: saved.branches || [] };
    } catch { /* local storage is optional */ }
  }
  return { accounts: [], banks: [bankSeed[0]], businessTypes: [], cashTypes: [], requestTypes: [], transactionTypes: [], requests: [], transactions: [], openingBalances: [], nagagoldTransactions: [], nagagoldAccounts: [], nagagoldMappings: [], nagagoldMappingSummary: null, nagagoldMappingExamples: [], nagagoldAutoPostingRules: [], nagagoldAutoPostingSettings: null, syncStatus: [], branches: [] };
};

async function apiRequest(path, options = {}) {
  if (!API_BASE_URL) throw new Error('API belum dikonfigurasi.');
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/auth/login') {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    window.dispatchEvent(new Event('finance:unauthorized'));
  }
  if (!response.ok) throw new Error(body.message || 'Request API gagal.');
  return body;
}

function reportQuery(filters = {}) {
  const params = new URLSearchParams();
  const normalizedFilters = filters.sourceType === 'SYNC_NAGAGOLD' ? { ...filters, sourceType: 'SYNC' } : filters;
  Object.entries(normalizedFilters).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, value); });
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function downloadReportFile(report, filters, format) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
  const response = await fetch(`${API_BASE_URL}/reports/export${reportQuery({ ...filters, report, format })}`, { headers: { Accept: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || 'Export laporan gagal.'); }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = match?.[1] || `finance-${report}.${format}`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function LoginScreen({ onSubmit, error, loading }) {
  const rememberedLogin = (() => {
    try { return JSON.parse(localStorage.getItem(REMEMBER_LOGIN_KEY) || 'null') || {}; } catch { return {}; }
  })();
  const [form, setForm] = useState({ username: rememberedLogin.username || '', password: rememberedLogin.password || '' });
  const [rememberMe, setRememberMe] = useState(Boolean(rememberedLogin.username || rememberedLogin.password));
  const [showPassword, setShowPassword] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => { event.preventDefault(); if (rememberMe) localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify(form)); else localStorage.removeItem(REMEMBER_LOGIN_KEY); onSubmit(form); };
  return <main className="login-shell"><section className="login-card"><div className="login-brand"><FinanceMark size={40} /><div><strong>Finance</strong><small>Finance Sambas</small></div></div><div className="login-heading"><span className="section-kicker">Akses aplikasi</span><h1>Masuk ke Finance</h1><p>Gunakan akun yang sudah dikonfigurasi untuk mengakses data keuangan.</p></div><form className="login-form" onSubmit={submit}><label className="form-field"><span>Username</span><input autoComplete="username" required value={form.username} onChange={(event) => update('username', event.target.value)} placeholder="Masukkan username" /></label><label className="form-field"><span>Password</span><div className="password-field"><input autoComplete="current-password" required type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder="Masukkan password" /><button className="password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><label className="remember-field"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /><span>Ingat saya</span></label>{error && <div className="login-error" role="alert"><XCircle size={15} />{error}</div>}<button className="button button-primary login-submit" type="submit" disabled={loading} aria-busy={loading}>{loading && <Spinner />}{loading ? 'Memproses...' : 'Masuk'}</button></form><small className="login-footer">Finance Sambas · Akses internal</small></section></main>;
}

function Spinner() {
  return <span className="button-spinner" aria-hidden="true" />;
}

function ActionLoadingOverlay() {
  return <div className="action-loading-overlay" role="status" aria-live="polite" aria-busy="true">
    <div className="action-loading-card">
      <span className="action-loading-spinner" aria-hidden="true" />
      <strong>Memproses transaksi</strong>
      <span className="action-loading-message">Mohon tunggu sebentar...</span>
    </div>
  </div>;
}

function Toast({ message }) {
  return <div className="toast toast-enter" role="status" aria-live="polite"><span className="toast-icon"><CheckCircle2 size={17} /></span><span>{message}</span><span className="toast-progress" /></div>;
}

function humanStatus(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return raw || '-';
  const normalized = raw.toUpperCase();
  const labels = {
    PENDING_APPROVAL: 'PENDING',
    MENUNGGU_APPROVAL: 'PENDING',
    WAITING_PAYMENT_APPROVAL: 'PENDING',
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    NOT_APPLICABLE: 'Tidak berlaku',
    TIDAK_BERLAKU: 'Tidak berlaku',
    NOT_REQUIRED: 'Tidak perlu',
    TIDAK_DIPERLUKAN: 'Tidak perlu',
    BELUM_DITERAPKAN: 'Belum diterapkan',
    DITERAPKAN: 'Diterapkan',
    DIBALIK: 'Dibalik',
    PROVISIONAL: 'Sementara',
    POSTED: 'Tercatat',
    BELUM_DIBUAT: 'Belum dibuat',
    NOT_STARTED: 'Belum diproses',
    BELUM_DIPERIKSA: 'Belum diperiksa',
    WAITING_TRANSFER: 'Menunggu transfer',
    PAYMENT_REJECTED: 'Realisasi ditolak',
    PAID: 'Sudah dibayar',
    COMPLETED: 'Selesai',
    CANCELLED: 'Dibatalkan',
    ERROR: 'Perlu diperiksa',
    PERLU_REVIEW: 'Perlu diperiksa',
  };
  if (labels[normalized]) return labels[normalized];
  return normalized.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanTimelineLabel(value) {
  const raw = String(value || '').trim();
  const labels = {
    OPENING_BALANCE_RECORDED_PROVISIONAL: 'Saldo awal dicatat',
    OPENING_BALANCE_CREATED: 'Saldo awal dicatat',
    OPENING_BALANCE_APPLIED: 'Saldo awal diterapkan',
    OPENING_BALANCE_APPROVED: 'Saldo awal disetujui',
    OPENING_BALANCE_REJECTED: 'Saldo awal ditolak',
    OPENING_BALANCE_REJECTED_WITH_REVERSAL: 'Saldo awal ditolak dan dibalik',
    TRANSACTION_CREATED: 'Transaksi dicatat',
    TRANSACTION_APPROVED: 'Transaksi disetujui',
    TRANSACTION_REJECTED: 'Transaksi ditolak',
    TRANSACTION_REVERSED: 'Transaksi dibalik',
    ADMIN_VALIDATED: 'Pemeriksaan Admin selesai',
  };
  return labels[raw] || humanStatus(raw);
}

function Badge({ status }) {
  const labels = { MENUNGGU_VALIDASI_ADMIN: 'Pemeriksaan Admin', PENDING_APPROVAL: 'PENDING', APPROVED: 'APPROVED', POSTED: 'Tercatat', PROVISIONAL: 'Sementara', BELUM_DIBUAT: 'Belum dibuat', REVERSED: 'Dibalik', REJECTED: 'REJECTED', REQUESTED: 'Menunggu Diterima Admin', IN_PROGRESS: 'Sedang Diproses', WAITING_TRANSFER: 'Menunggu Transfer', WAITING_PAYMENT_APPROVAL: 'PENDING', PAYMENT_REJECTED: 'Realisasi Ditolak', PAID: 'Sudah Dibayar', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan', ERROR: 'Perlu Diperiksa', NOT_REQUIRED: 'Tidak perlu', NOT_STARTED: 'Belum diproses' };
  if (status === 'TERCATAT' || status === 'TERHUBUNG') return null;
  return <span className={`status-badge status-${String(status).toLowerCase()}`}><span className="status-dot" />{labels[status] || humanStatus(status)}</span>;
}

function RequestStatusBadge({ status }) {
  const raw = String(status || '').toUpperCase();
  const labels = { REQUESTED: 'Menunggu diterima', PENDING_APPROVAL: 'Menunggu persetujuan', APPROVED: 'Disetujui', IN_PROGRESS: 'Sedang diproses', WAITING_TRANSFER: 'Menunggu transfer', WAITING_PAYMENT_APPROVAL: 'Menunggu Approval Owner', PAYMENT_REJECTED: 'Pembayaran ditolak', PAID: 'Sudah dibayar', COMPLETED: 'Selesai', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan', ERROR: 'Perlu diperiksa' };
  return <span className={`status-badge request-${raw.toLowerCase()}`}><span className="status-dot" />{labels[raw] || humanStatus(raw) || 'Belum ada status'}</span>;
}

function ProcessingBadge({ status, label }) {
  const labels = { POSTED: 'Tercatat', TIDAK_BERLAKU: 'Tidak berlaku', TERCATAT: 'Tercatat', DIREKONSILIASI: 'Direkonsiliasi', PERLU_REVIEW: 'Perlu diperiksa', PERLU_DIPERIKSA: 'Perlu diperiksa', GAGAL_MAPPING: 'Gagal mapping', GAGAL_SINKRONISASI: 'Gagal sinkronisasi' };
  return <span className={`status-badge processing-${String(status || '').toLowerCase()}`}><span className="status-dot" />{humanStatus(label || labels[status] || status || 'Belum ada status')}</span>;
}

function ClassificationBadge({ status }) {
  const labels = { AUTO_ELIGIBLE: 'Siap dibukukan', REVIEW_REQUIRED: 'Perlu diperiksa', RECONCILIATION_REQUIRED: 'Perlu rekonsiliasi', BLOCKED: 'Ditahan' };
  return <span className={`status-badge classification-${String(status || 'REVIEW_REQUIRED').toLowerCase()}`}><span className="status-dot" />{humanStatus(labels[status] || status || 'Belum diklasifikasikan')}</span>;
}

function SourceAuditSummary({ transaction }) {
  return <div className="source-audit-summary"><div><span>Finalitas sumber</span><strong>{transaction.sourceFinalityStatus || 'UNVERIFIED'}</strong><small>{transaction.sourceFinalityNote || 'Belum terbukti final.'}</small></div><div><span>Dekripsi</span><strong>{transaction.sourceDecryptionStatus || 'UNKNOWN'}</strong><small>{transaction.sourceDecryptionNote || '-'}</small></div><div><span>Snapshot</span><strong>{transaction.sourceSnapshotRecoveryStatus || 'UNKNOWN'}</strong><small>{transaction.sourceSnapshotAt ? formatDate(transaction.sourceSnapshotAt, true) : 'Belum tersimpan'}</small></div><div><span>Mapping</span><strong>{transaction.mappingStatus || 'PERLU_PEMETAAN'}</strong><small>{transaction.mappingReason || transaction.rekeningName || 'Belum ada rekening.'}</small></div></div>;
}

function ProposedJournal({ proposal }) {
  if (!proposal) return <div className="proposal-empty">Jurnal usulan belum tersedia karena akun belum lengkap.</div>;
  const incoming = proposal.direction === 'MASUK';
  return <div className="proposal-box"><strong>Preview pencatatan keuangan — tidak dibuat saat ini</strong><div className="proposal-lines"><span><b>{incoming ? 'Debet' : 'Kredit'}</b>{proposal.rekeningName || proposal.debitAccountName || proposal.creditAccountName || '-'} · {formatRupiah(proposal.amount)}</span></div>{proposal.audit && <div className="proposal-audit"><span>Mapping: {proposal.audit.mappingStatus || '-'}</span><span>Dekripsi: {proposal.audit.sourceDecryptionStatus || '-'}</span><span>Finalitas: {proposal.audit.sourceFinalityStatus || '-'}</span><small>{proposal.audit.mappingReason || proposal.audit.sourceFinalityNote || proposal.audit.sourceDecryptionNote || 'Belum ada catatan tambahan.'}</small></div>}</div>;
}

function DryRunPanel({ result }) {
  const summary = result?.summary || {};
  const byClassification = summary.byClassification || [];
  return <section className="panel dry-run-panel"><div className="table-heading"><div><span className="section-kicker">Simulasi klasifikasi</span><h2>Dry-run auto-posting Nagagold</h2></div><span className="count-label">Tidak mengubah saldo</span></div><div className="info-strip dry-run-note"><ShieldCheck size={17} /><span>Simulasi hanya menghitung usulan berdasarkan aturan {result.ruleVersion || '-'}. Auto-posting production tetap nonaktif.</span></div><div className="dry-run-grid">{byClassification.map((item) => <div className="dry-run-card" key={item.status}><ClassificationBadge status={item.status} /><strong>{item.count} transaksi</strong><span>{formatRupiah(item.amount)}</span></div>)}</div><div className="dry-run-columns"><div><strong>Jumlah per jenis</strong><div className="dry-run-list">{(summary.byJenis || []).map((item) => <div key={item.jenis}><span>{item.jenis}</span><b>{item.count} · {formatRupiah(item.amount)}</b></div>)}</div></div><div><strong>Pencatatan yang diusulkan</strong><div className="dry-run-list">{(summary.proposedAccounts || []).length ? summary.proposedAccounts.map((item) => { const incoming = item.debitAccountName && item.debitAccountName !== '-'; return <div key={`${item.debitAccountId}-${item.creditAccountId}`}><span>{incoming ? 'Debet' : 'Kredit'} · {incoming ? item.debitAccountName : item.creditAccountName}</span><b>{item.count} · {formatRupiah(item.amount)}</b></div>; }) : <span className="form-note">Belum ada rekening yang aman untuk diusulkan.</span>}</div></div></div></section>;
}

function SnapshotRecoveryPanel({ result, onApply, canApply = false }) {
  const summary = result?.summary || {};
  const rows = result?.transactions || [];
  const labels = { PENDING_APPLY: 'Siap dipreview untuk dipulihkan', PREVIEW_MATCH: 'Snapshot cocok', PREVIEW_MISMATCH: 'Tidak cocok', SOURCE_NOT_FOUND: 'Sumber tidak ditemukan', ERROR: 'Gagal membaca sumber' };
  return <section className="panel recovery-panel"><div className="table-heading"><div><span className="section-kicker">Preview read-only</span><h2>Pemulihan snapshot sumber</h2></div><div className="page-actions"><span className="count-label">Tidak ada perubahan data</span>{canApply && summary.PENDING_APPLY > 0 && <button className="button button-primary" type="button" onClick={() => onApply?.(result)}><ShieldCheck size={16} />Pulihkan metadata terverifikasi</button>}</div></div><div className="info-strip dry-run-note"><ShieldCheck size={17} /><span>Preview hanya membaca `tt_cash_daily`. Eksekusi dibatasi Owner/Super User, memakai token preview, batch kecil, dan hanya mengisi metadata yang hilang. Saldo, jurnal, approval, nominal Finance, dan status_valid tidak diubah.</span></div><div className="recovery-summary"><div><span>Dicek</span><strong>{summary.total || 0}</strong></div><div><span>Siap dipulihkan</span><strong>{summary.PENDING_APPLY || 0}</strong></div><div><span>Nominal konsisten</span><strong>{summary.amountConsistent || 0}</strong></div><div><span>Perlu pemeriksaan</span><strong>{(summary.PREVIEW_MISMATCH || 0) + (summary.SOURCE_NOT_FOUND || 0) + (summary.ERROR || 0)}</strong></div></div><div className="table-wrap"><table><thead><tr><th>Transaksi Finance</th><th>Cabang</th><th>ID sumber</th><th>Status preview</th><th>Yang kurang</th><th>Sumber</th></tr></thead><tbody>{rows.map((row) => <tr key={row.transactionId}><td><strong className="table-primary">{row.transactionNumber}</strong><small className="table-secondary">{formatRupiah(row.financeAmount)} · {row.financeDirection || '-'}</small></td><td>{row.kodeToko || '-'}</td><td className="mono">{row.sourceId || '-'}</td><td><span className={`status-badge recovery-${String(row.recoveryStatus || '').toLowerCase()}`}><span className="status-dot" />{labels[row.recoveryStatus] || row.recoveryStatus || '-'}</span><small className="table-secondary">{row.reason || ''}</small></td><td>{row.missingFields?.length ? row.missingFields.join(', ') : 'Tidak ada'}</td><td>{row.currentSource ? `${row.currentSource.jenis || '-'} · ${row.currentSource.kategori || '-'} · ${row.currentSource.status || '-'}` : '-'}</td></tr>)}</tbody></table>{rows.length === 0 && <EmptyState title="Tidak ada snapshot yang perlu dipreview" description="Gunakan filter cabang atau pilih transaksi lama untuk pemeriksaan lebih spesifik." />}</div></section>;
}

function MassMappingPreview({ result }) {
  const rows = result?.rows || [];
  return <section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Preview read-only</span><h2>Usulan mapping massal</h2></div><span className="count-label">{result?.configurationCount || 0} konteks</span></div><div className="info-strip dry-run-note"><ShieldCheck size={17} /><span>Preview mengelompokkan transaksi Finance berdasarkan unit, cabang, metode, bank, dan nomor rekening. Tidak ada mapping atau saldo yang diubah.</span></div><div className="table-wrap"><table><thead><tr><th>Cabang</th><th>Metode</th><th>Bank / rekening</th><th>Transaksi</th><th>Nominal masuk</th><th>Nominal keluar</th><th>Hasil</th><th>Kandidat</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><td><strong className="table-primary">{row.kodeToko || '-'}</strong><small className="table-secondary">{row.unit}</small></td><td><span className="type-chip">{row.metodePembayaran || '-'}</span></td><td>{row.kodeBank || '-'}<small className="table-secondary mono">{row.nomorRekening || 'Tanpa rekening bank'}</small></td><td>{row.jumlahTransaksi}</td><td><strong className="amount-cell">{formatRupiah(row.totalMasuk)}</strong></td><td><strong className="amount-cell">{formatRupiah(row.totalKeluar)}</strong></td><td><span className={`type-chip mapping-preview-${String(row.hasil || '').toLowerCase()}`}>{row.hasil}</span><small className="table-secondary">{row.alasan}</small></td><td>{row.candidates?.length ? row.candidates.map((candidate) => <small className="table-secondary" key={candidate.id}>{candidate.name} · {candidate.jenisAkun}</small>) : '-'}</td></tr>)}</tbody></table>{rows.length === 0 && <EmptyState title="Belum ada konteks transaksi" description="Preview akan muncul setelah transaksi Nagagold tersedia." />}</div></section>;
}

function AutoPostingRulesPanel({ rules, settings, branches, onSave, onToggle, apiConnected }) {
  const [form, setForm] = useState({ kodeToko: '*', jenisTransaksi: 'CASH', kategoriTransaksi: 'PENJUALAN', metodePembayaran: 'CASH', keterangan: '' });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => { event.preventDefault(); await onSave?.(form); };
  return <section className="panel auto-posting-panel"><div className="table-heading"><div><span className="section-kicker">Kontrol otomatisasi</span><h2>Whitelist auto-posting Nagagold</h2></div><span className={`status-badge ${settings?.productionEnabled ? 'status-approved' : 'status-rejected'}`}><span className="status-dot" />{settings?.productionEnabled ? 'Sistem aktif' : 'Sistem nonaktif'}</span></div><div className="info-strip dry-run-note"><ShieldCheck size={17} /><span>Aturan baru selalu nonaktif. Whitelist hanya menjadi izin tambahan setelah finalitas, mapping unik, rekonsiliasi, dan dry-run memenuhi syarat. Saat ini tidak ada auto-posting production yang berjalan.</span></div><form className="mapping-form auto-posting-form" onSubmit={submit}><label className="form-field"><span>Cabang</span><select value={form.kodeToko} onChange={(event) => update('kodeToko', event.target.value)}><option value="*">Semua cabang</option>{branches.map((branch) => <option key={branch.id} value={branch.kodeToko}>{branch.kodeToko} · {branch.namaToko}</option>)}</select></label><label className="form-field"><span>Jenis sumber</span><select value={form.jenisTransaksi} onChange={(event) => update('jenisTransaksi', event.target.value)}><option value="CASH">CASH</option><option value="DEBET">DEBET</option><option value="TRANSFER">TRANSFER</option><option value="*">Semua jenis</option></select></label><label className="form-field"><span>Kategori sumber</span><input required value={form.kategoriTransaksi} onChange={(event) => update('kategoriTransaksi', event.target.value.toUpperCase())} placeholder="Contoh: PENJUALAN" /></label><label className="form-field"><span>Metode pembayaran</span><select value={form.metodePembayaran} onChange={(event) => update('metodePembayaran', event.target.value)}><option value="CASH">CASH</option><option value="DEBET">DEBET</option><option value="TRANSFER">TRANSFER</option><option value="BANK">BANK</option><option value="*">Semua metode</option></select></label><label className="form-field"><span>Keterangan</span><input value={form.keterangan} onChange={(event) => update('keterangan', event.target.value.toUpperCase())} placeholder="Catatan aturan" /></label><div className="mapping-form-actions"><button className="button button-secondary" type="submit" disabled={!apiConnected}><Check size={16} />Simpan nonaktif</button></div></form><div className="auto-posting-rules-list">{rules?.length ? rules.map((rule) => <div className="auto-posting-rule" key={rule.id}><div><strong>{rule.kategoriTransaksi}</strong><small>{rule.kodeToko} · {rule.jenisTransaksi} · {rule.metodePembayaran} · {rule.statusFinalitas}</small><small>{rule.keterangan || 'Tanpa keterangan'}</small></div><div className="auto-posting-rule-actions"><span className={`status-badge ${rule.isActive ? 'status-approved' : 'status-rejected'}`}><span className="status-dot" />{rule.isActive ? 'Aktif' : 'Nonaktif'}</span><button className="row-action" type="button" disabled={!apiConnected} onClick={() => onToggle?.(rule)}>{rule.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button></div></div>) : <EmptyState title="Belum ada whitelist" description="Simpan aturan dalam kondisi nonaktif untuk ditinjau sebelum aktivasi." />}</div></section>;
}

function PaymentBadge({ status }) {
  const labels = { TIDAK_BERLAKU: 'Tidak berlaku', MENUNGGU_TRANSFER: 'Menunggu transfer', MENUNGGU_APPROVAL: 'Menunggu approval Owner', SUDAH_DIBAYAR: 'Sudah dibayar', GAGAL: 'Gagal', DIBATALKAN: 'Dibatalkan' };
  return <span className={`status-badge payment-${String(status || '').toLowerCase()}`}><span className="status-dot" />{humanStatus(labels[status] || status || 'Belum ada status')}</span>;
}

function SourceBadge({ sourceType, business }) {
  const labels = { MANUAL_ADMIN: 'Input Admin', SYNC: 'Sinkronisasi', SYNC_NAGAGOLD: 'Sync Nagagold', SYNC_OPTIK: 'Sync Optik', BRANCH_REQUEST: 'Permintaan Dana' };
  const normalizedBusiness = String(business || '').trim().toUpperCase();
  const dynamicSync = String(sourceType || '').startsWith('SYNC_') && !['SYNC_NAGAGOLD', 'SYNC_OPTIK'].includes(sourceType) ? String(sourceType).slice(5).replaceAll('_', ' ') : '';
  const label = sourceType === 'SYNC' && normalizedBusiness ? `Sync ${normalizedBusiness}` : dynamicSync ? `Sync ${dynamicSync}` : (labels[sourceType] || sourceType || 'Tidak diketahui');
  return <span className="source-chip">{label}</span>;
}

function getSourceType(item) {
  const explicit = item?.sourceType || item?.source_type;
  const business = String(item?.jenisBisnis || item?.jenis_bisnis || '').trim().toUpperCase();
  if (explicit) return explicit === 'SYNC' && business ? (business === 'NAGAGOLD' ? 'SYNC_NAGAGOLD' : `SYNC_${business}`) : explicit;
  if (item?.isImported && business) return business === 'NAGAGOLD' ? 'SYNC_NAGAGOLD' : `SYNC_${business}`;
  if (item?.isImported) return String(item.sourceSystem || '').toLowerCase() === 'optik' ? 'SYNC_OPTIK' : 'SYNC_NAGAGOLD';
  return item?.requestId ? 'BRANCH_REQUEST' : 'MANUAL_ADMIN';
}

function FinanceMark({ size = 38 }) {
  return <img className="finance-mark" width={size} height={size} src="/finance-mark.svg" alt="Finance" />;
}

function AppDialog({ dialog, onResolve }) {
  const [value, setValue] = useState(dialog?.value || '');
  useEffect(() => setValue(dialog?.value || ''), [dialog]);
  if (!dialog) return null;
  const isPrompt = dialog.kind === 'prompt';
  return <div className="modal-backdrop app-dialog-backdrop" role="presentation"><section className="app-dialog" role="dialog" aria-modal="true" aria-label="Konfirmasi Finance"><div className="app-dialog-icon">{isPrompt ? <ReceiptText size={20} /> : <ShieldCheck size={20} />}</div><div className="app-dialog-content"><h2>{isPrompt ? 'Konfirmasi diperlukan' : 'Konfirmasi tindakan'}</h2><p>{dialog.message}</p>{isPrompt && <input autoFocus value={value} onChange={(event) => setValue(dialog.uppercase ? event.target.value.toUpperCase() : event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onResolve(value); }} placeholder="Masukkan konfirmasi" style={dialog.uppercase ? { textTransform: 'uppercase' } : undefined} />}</div><div className="app-dialog-actions"><button className="button button-secondary" type="button" onClick={() => onResolve(isPrompt ? '' : false)}>Batal</button><button className="button button-primary" type="button" onClick={() => onResolve(isPrompt ? value : true)}>{isPrompt ? 'Kirim' : 'Lanjutkan'}</button></div></section></div>;
}

function App() {
  const [view, setView] = useState('dashboard');
  const [state, setState] = useState(getInitialState);
  const [session, setSession] = useState(() => API_BASE_URL ? null : { username: 'system', name: 'Super User Finance', role: 'SUPER_USER' });
  const [authReady, setAuthReady] = useState(!API_BASE_URL);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  useEffect(() => {
    if (reportViewKeys[view] && !REPORT_MENU_KEYS.includes(view)) setView('dashboard');
  }, [view]);

  const runAction = (handler) => async (...args) => {
    if (actionLoading) return undefined;
    setActionLoading(true);
    try { return await handler(...args); } finally { setActionLoading(false); }
  };
  const [apiConnected, setApiConnected] = useState(false);
  const [hydrated, setHydrated] = useState(!API_BASE_URL);

  const refreshFromApi = async () => {
    const [accounts, banks, businessTypes, cashTypes, requestTypes, transactionTypes, requests, transactions, openingBalances, nagagoldTransactions, nagagoldAccounts, syncStatus, branches, nagagoldMapping, nagagoldAutoPosting] = await Promise.all([apiRequest('/accounts'), apiRequest('/banks'), apiRequest('/business-types'), apiRequest('/cash-types'), apiRequest('/request-types'), apiRequest('/transaction-types'), apiRequest('/requests'), apiRequest('/transactions'), apiRequest('/saldo-awal'), apiRequest('/nagagold-transactions'), apiRequest('/nagagold-rekening'), apiRequest('/sinkronisasi/nagagold/status'), apiRequest('/cabang'), apiRequest('/nagagold-mapping'), apiRequest('/nagagold-auto-posting/rules')]);
    setState({ accounts, banks, businessTypes, cashTypes, requestTypes, transactionTypes, requests, transactions, openingBalances, nagagoldTransactions, nagagoldAccounts, nagagoldMappings: nagagoldMapping.mappings || [], nagagoldMappingSummary: nagagoldMapping.summary || null, nagagoldMappingExamples: nagagoldMapping.failedExamples || [], nagagoldAutoPostingRules: nagagoldAutoPosting.rules || [], nagagoldAutoPostingSettings: nagagoldAutoPosting || null, syncStatus, branches });
    setApiConnected(true);
    return { accounts, banks, businessTypes, cashTypes, requestTypes, transactionTypes, requests, transactions, openingBalances, nagagoldTransactions, nagagoldAccounts, nagagoldMappings: nagagoldMapping.mappings || [], nagagoldMappingSummary: nagagoldMapping.summary || null, nagagoldMappingExamples: nagagoldMapping.failedExamples || [], nagagoldAutoPostingRules: nagagoldAutoPosting.rules || [], nagagoldAutoPostingSettings: nagagoldAutoPosting || null, syncStatus, branches };
  };

  const runNagagoldSync = async () => {
    try {
      const result = await apiRequest('/sinkronisasi/nagagold/run', { method: 'POST' });
      await refreshFromApi();
      const results = result.results || [];
      const fetched = results.reduce((total, item) => total + Number(item.fetched || 0), 0);
      const errors = results.filter((item) => item.error).length;
      showToast(errors ? `Sinkronisasi selesai dengan ${errors} cabang gagal.` : `Sinkronisasi selesai. ${fetched} data sumber dibaca.`);
      return result;
    } catch (error) {
      showToast(error.message);
      throw error;
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!API_BASE_URL) return undefined;
    apiRequest('/auth/me').then((body) => { if (!cancelled) setSession(body.user); }).catch(() => { if (!cancelled) setSession(null); }).finally(() => { if (!cancelled) setAuthReady(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!API_BASE_URL || !session) return undefined;
    refreshFromApi().catch(() => { if (!cancelled) setApiConnected(false); }).finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, [session]);
  useEffect(() => {
    const handleUnauthorized = () => { setSession(null); setApiConnected(false); setHydrated(false); setUserMenuOpen(false); };
    window.addEventListener('finance:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('finance:unauthorized', handleUnauthorized);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state, hydrated]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleLogin = async (form) => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const body = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(form) });
      if (body.token) sessionStorage.setItem(AUTH_TOKEN_KEY, body.token);
      setSession(body.user);
      setHydrated(false);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try { if (API_BASE_URL && sessionStorage.getItem(AUTH_TOKEN_KEY)) await apiRequest('/auth/logout', { method: 'POST' }); } catch { /* session is cleared locally below */ }
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    setSession(null);
    setApiConnected(false);
    setHydrated(false);
    setUserMenuOpen(false);
  };

  const openTransactionDetail = async (item) => {
    setDetail(item);
    if (!apiConnected || !item?.id) return;
    try {
      const isOpeningBalance = item.isOpeningBalance || String(item.kategoriSistem || item.kategori_sistem || item.kategoriTransaksi || item.kategori_transaksi || '').toUpperCase() === 'SALDO AWAL';
      const body = await apiRequest(isOpeningBalance ? `/saldo-awal/${item.id}/detail` : `/transactions/${item.id}/detail`);
      if (isOpeningBalance) {
        const opening = body.openingBalance || item;
        setDetail({ ...item, ...opening, id: opening.id || item.id, isOpeningBalance: true, transactionNumber: 'SALDO AWAL', jenisTransaksi: 'SALDO AWAL', kategoriSistem: 'SALDO AWAL', kategori_sistem: 'SALDO AWAL', kategoriTransaksi: 'SALDO AWAL', amount: opening.amount ?? item.amount, transactionDate: opening.date || item.date, status: opening.status || item.status, approvalStatus: opening.status || item.status, journalStatus: opening.status === 'APPROVED' ? 'POSTED' : 'PROVISIONAL', sourceType: 'MANUAL_ADMIN', sourceTypeLabel: 'Saldo awal', sourceAccountId: opening.rekeningId || item.rekeningId, destinationAccountId: '', note: opening.note || item.note, timeline: body.timeline || [], journals: body.journals || [], approvals: body.approvals || [], reconciliation: null });
      } else {
        setDetail({ ...body.transaction, timeline: body.timeline || [], journals: body.journals || [], approvals: body.approvals || [], reconciliation: body.reconciliation || null });
      }
    } catch {
      // Ringkasan transaksi tetap dapat dibuka jika detail timeline gagal dimuat.
    }
  };

  const pendingTransactions = state.transactions.filter((item) => {
    const approval = item.approvalStatus || item.approval_status;
    return item.status === 'PENDING_APPROVAL' && approval !== 'TIDAK_DIPERLUKAN';
  });
  const pendingOpeningBalances = state.openingBalances.filter((item) => item.status === 'PENDING_APPROVAL');
  const pendingApprovalCount = pendingTransactions.length + pendingOpeningBalances.length;
  const pendingRequestCount = state.requests.filter((item) => {
    const status = String(item.status || '').toUpperCase();
    // Badge Permintaan Dana hanya menghitung pekerjaan yang masih membutuhkan
    // tindakan Admin. Saat sudah menunggu keputusan Owner, antreannya pindah
    // secara logis ke Approval Center sehingga badge ini harus berkurang.
    return ['REQUESTED', 'APPROVED', 'WAITING_TRANSFER'].includes(status);
  }).length;
  const visibleTransactions = state.transactions.filter((item) => {
    const needle = search.toLowerCase();
    return !needle || [item.transactionNumber, item.kodeToko, item.namaToko, item.jenisRequest, item.sourceType, item.sourceTypeLabel, item.status, item.syncStatusLabel].join(' ').toLowerCase().includes(needle);
  });

  const showToast = (message) => setToast(message);
  const askDialog = (kind, message, initialValue = '', options = {}) => new Promise((resolve) => setDialog({ kind, message, value: initialValue, ...options, resolve }));
  const resolveDialog = (value) => {
    const current = dialog;
    setDialog(null);
    current?.resolve(value);
  };
  const setTransactionStatus = async (ids, nextStatus, reason = '') => {
    if (apiConnected) {
      try {
        const result = await apiRequest(nextStatus === 'APPROVED' ? '/transactions/bulk-approve' : '/transactions/bulk-reject', { method: 'POST', body: JSON.stringify({ ids, ...(nextStatus === 'REJECTED' ? { reason } : {}) }) });
        await refreshFromApi();
        setSelectedIds([]);
        setDetail(null);
        const failedText = result.failed?.length ? ` ${result.failed.length} gagal diproses.` : '';
        showToast(`${result.processed?.length || 0} transaksi ${nextStatus === 'APPROVED' ? 'disetujui' : 'ditolak'}${nextStatus === 'REJECTED' ? ' dan jurnal diproses sesuai status posting' : ''}.${failedText}`);
      } catch (error) { showToast(error.message); }
      return;
    }
    const now = new Date().toISOString();
    setState((current) => {
      const affectedRequestIds = new Set(current.transactions.filter((transaction) => ids.includes(transaction.id) && transaction.requestId).map((transaction) => transaction.requestId));
      const accounts = nextStatus === 'REJECTED'
        ? current.accounts.map((account) => {
          const balance = current.transactions.filter((transaction) => ids.includes(transaction.id) && transaction.status === 'PENDING_APPROVAL' && (transaction.saldoStatus === 'DITERAPKAN' || transaction.saldo_status === 'DITERAPKAN')).reduce((value, transaction) => {
            if (transaction.sourceAccountId === account.id) return value + Number(transaction.amount || 0);
            if (transaction.destinationAccountId === account.id) return value - Number(transaction.amount || 0);
            return value;
          }, Number(account.saldoAkhir || 0));
          return { ...account, saldoAkhir: balance };
        })
        : current.accounts;
      return {
        ...current,
        accounts,
        transactions: current.transactions.map((transaction) => {
          if (!ids.includes(transaction.id) || (transaction.status !== 'PENDING_APPROVAL' && transaction.approvalStatus !== 'PENDING')) return transaction;
          if (nextStatus === 'APPROVED') return { ...transaction, status: 'APPROVED', approvalStatus: 'APPROVED', approval_status: 'APPROVED', paymentStatus: transaction.requestId ? 'SUDAH_DIBAYAR' : transaction.paymentStatus, payment_status: transaction.requestId ? 'SUDAH_DIBAYAR' : transaction.payment_status, journalStatus: 'POSTED', journal_status: 'POSTED', statusValid: true, approvedAt: now, approvedBy: 'Owner' };
          return { ...transaction, status: 'REJECTED', approvalStatus: 'REJECTED', approval_status: 'REJECTED', paymentStatus: transaction.requestId ? 'DIBATALKAN' : transaction.paymentStatus, payment_status: transaction.requestId ? 'DIBATALKAN' : transaction.payment_status, journalStatus: 'REVERSED', journal_status: 'REVERSED', statusValid: false, rejectedAt: now, rejectedBy: 'Owner', rejectionReason: reason, reversal: { reversalDate: now.slice(0, 10), amount: transaction.amount, sourceAccountId: transaction.destinationAccountId, destinationAccountId: transaction.sourceAccountId } };
        }),
        requests: current.requests.map((item) => {
          if (!affectedRequestIds.has(item.requestId) || item.status !== 'WAITING_PAYMENT_APPROVAL') return item;
          return nextStatus === 'APPROVED'
            ? { ...item, status: 'PAID', approvalStatus: 'APPROVED', paymentStatus: 'SUDAH_DIBAYAR' }
            : { ...item, status: 'PAYMENT_REJECTED', approvalStatus: 'REJECTED', paymentStatus: 'DIBATALKAN', rejectionReason: reason };
        }),
      };
    });
    setSelectedIds([]);
    setDetail(null);
    showToast(nextStatus === 'APPROVED' ? `${ids.length} transaksi disetujui.` : `${ids.length} transaksi ditolak dan jurnal reversal dibuat.`);
  };

  const submitRequest = async (form) => {
    const branch = branchSeed.find((item) => item.code === form.kodeToko);
    const isBranchRequest = form.asalPermintaan === 'CABANG';
    if (!form.asalPermintaan || !form.jenisRequest || !form.tujuanAccountId || !form.noRekening || !Number(form.nilaiRp) || (!isBranchRequest && !form.unitPemohon) || (isBranchRequest && !form.kodeToko)) { showToast('Asal, jenis request, rekening tujuan, nominal, dan pemohon wajib dipilih.'); return; }
    const request = { ...form, id: `rq-${Date.now()}`, requestId: nextLocalNumber('RQS', new Date().toISOString().slice(0, 10), state.requests, (item) => item.requestId), sourceSystem: isBranchRequest ? 'nagagold' : 'finance', namaToko: branch?.name || '', nilaiRp: Number(form.nilaiRp), requestedAt: new Date().toISOString(), status: 'REQUESTED' };
    if (apiConnected) {
      try { await apiRequest('/requests', { method: 'POST', body: JSON.stringify({ sourceSystem: request.sourceSystem, asalPermintaan: request.asalPermintaan, unitPemohon: request.unitPemohon, namaPemohon: request.namaPemohon, jenisRequest: request.jenisRequest, destinationAccountId: request.tujuanAccountId || '', ...(isBranchRequest ? { kodeToko: request.kodeToko, namaToko: request.namaToko } : {}), noRekening: request.noRekening, nilaiRp: request.nilaiRp, requestedAt: request.requestedAt, tujuan: request.tujuan }) }); await refreshFromApi(); setModal(null); showToast('Permintaan dana berhasil ditambahkan.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, requests: [request, ...current.requests] }));
    setModal(null);
    showToast('Permintaan dana berhasil ditambahkan.');
  };

  const submitTransaction = async (form) => {
    const request = state.requests.find((item) => item.requestId === form.requestId);
    const isRequestPayment = Boolean(request);
    const transaction = { ...form, id: `tx-${Date.now()}`, transactionNumber: nextLocalNumber('MTS', form.transactionDate || new Date().toISOString().slice(0, 10), state.transactions, (item) => item.transactionNumber), amount: Number(form.amount), status: 'PENDING_APPROVAL', approvalStatus: isRequestPayment ? 'PENDING' : 'PENDING', paymentStatus: isRequestPayment ? 'MENUNGGU_APPROVAL' : 'TIDAK_BERLAKU', statusValid: false, journalStatus: 'PROVISIONAL', journal_status: 'PROVISIONAL', createdAt: new Date().toISOString(), namaToko: request?.namaToko || form.namaToko || '-' };
    if (!apiConnected && calculateAvailableBalance(form.sourceAccountId, state.openingBalances, state.transactions) < transaction.amount) { showToast('Saldo rekening sumber tidak cukup. Input saldo awal terlebih dahulu atau gunakan rekening lain.'); return; }
    if (apiConnected) {
      try { await apiRequest('/transactions', { method: 'POST', body: JSON.stringify({ requestId: transaction.requestId, bentukTransaksi: transaction.bentukTransaksi, transactionDate: transaction.transactionDate, transferDate: transaction.transferDate, transferReference: transaction.transferReference, transferProof: transaction.transferProof, paymentNote: transaction.paymentNote, jenisTransaksi: transaction.jenisTransaksi, jenisRequest: transaction.jenisRequest, arahDana: transaction.arahDana || 'KELUAR', ...(transaction.kodeToko ? { kodeToko: transaction.kodeToko } : {}), sourceAccountId: transaction.sourceAccountId, destinationAccountId: transaction.destinationAccountId, amount: transaction.amount, note: transaction.note }) }); await refreshFromApi(); setModal(null); showToast(isRequestPayment ? 'Realisasi pembayaran tersimpan dan menunggu approval Owner.' : 'Transaksi dicatat dan menunggu verifikasi Owner.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => {
      const accounts = current.accounts.map((account) => {
        if (account.id === transaction.sourceAccountId) return { ...account, saldoAkhir: Number(account.saldoAkhir || 0) - transaction.amount };
        if (account.id === transaction.destinationAccountId) return { ...account, saldoAkhir: Number(account.saldoAkhir || 0) + transaction.amount };
        return account;
      });
      return { ...current, accounts, transactions: [transaction, ...current.transactions], requests: current.requests.map((item) => item.requestId === form.requestId ? { ...item, status: isRequestPayment ? 'WAITING_PAYMENT_APPROVAL' : item.status, approvalStatus: isRequestPayment ? 'NOT_REQUIRED' : item.approvalStatus, paymentStatus: isRequestPayment ? 'MENUNGGU_APPROVAL' : item.paymentStatus } : item) };
    });
    setModal(null);
    showToast(isRequestPayment ? 'Realisasi pembayaran tersimpan dan menunggu approval Owner.' : 'Transaksi dicatat dan menunggu verifikasi Owner.');
  };

  const submitMutation = async (form) => {
    const source = state.accounts.find((item) => item.id === form.sourceAccountId);
    const destination = state.accounts.find((item) => item.id === form.destinationAccountId);
    if (!source || !destination || source.id === destination.id) { showToast('Pilih rekening atau kas sumber dan tujuan yang berbeda.'); return; }
    if (!form.jenisTransaksi || !form.transactionDate || !Number(form.amount)) { showToast('Tanggal, jenis transaksi, dan nominal wajib diisi.'); return; }
    await submitTransaction({ ...form, bentukTransaksi: 'MUTASI_REKENING', jenisRequest: 'MUTASI_REKENING', requestId: '', kodeToko: '', arahDana: 'KELUAR' });
  };

  const submitRequestPayment = async (form) => {
    const request = state.requests.find((item) => item.requestId === form.requestId);
    if (!request) { showToast('Permintaan dana tidak ditemukan.'); return; }
    if (!form.transactionDate || !form.sourceAccountId || !form.destinationAccountId || !form.jenisTransaksi || !Number(form.amount)) { showToast('Tanggal, rekening sumber, rekening tujuan, jenis transaksi, dan nominal wajib diisi.'); return; }
    await submitTransaction({ ...form, requestId: request.requestId, bentukTransaksi: 'TRANSFER_INTERNAL', jenisRequest: request.jenisRequest, kodeToko: request.kodeToko, arahDana: 'KELUAR', transferDate: form.transactionDate, note: form.note });
  };

  const acceptRequest = async (requestId) => {
    if (apiConnected) {
      try { await apiRequest(`/requests/${requestId}/accept`, { method: 'POST' }); await refreshFromApi(); showToast('Request diterima Admin. Silakan lakukan transfer dan catat realisasinya.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, requests: current.requests.map((item) => item.id === requestId ? { ...item, status: 'WAITING_TRANSFER', approvalStatus: 'TIDAK_DIPERLUKAN', paymentStatus: 'MENUNGGU_TRANSFER' } : item) }));
    showToast('Request diterima Admin. Silakan lakukan transfer dan catat realisasinya.');
  };

  const rejectRequestBeforeTransfer = async (requestId, reason) => {
    if (apiConnected) {
      try { await apiRequest(`/requests/${requestId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); await refreshFromApi(); showToast('Request ditolak dan ditutup.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, requests: current.requests.map((item) => item.id === requestId ? { ...item, status: 'REJECTED', approvalStatus: 'REJECTED', paymentStatus: 'DIBATALKAN', rejectionReason: reason } : item) }));
    showToast('Request ditolak dan ditutup.');
  };

  const submitRequestForApproval = async (requestId) => {
    if (!apiConnected) { setState((current) => ({ ...current, requests: current.requests.map((item) => item.id === requestId ? { ...item, status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' } : item) })); showToast('Request diajukan untuk approval.'); return; }
    try { await apiRequest(`/requests/${requestId}/submit-approval`, { method: 'POST' }); await refreshFromApi(); showToast('Request diajukan untuk approval Owner.'); } catch (error) { showToast(error.message); }
  };

  const setRequestApproval = async (requestId, action, reason = '') => {
    if (apiConnected) {
      try { await apiRequest(`/requests/${requestId}/${action === 'APPROVED' ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify(action === 'REJECTED' ? { reason } : {}) }); await refreshFromApi(); showToast(action === 'APPROVED' ? 'Request disetujui. Menunggu realisasi transfer.' : 'Request ditolak.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, requests: current.requests.map((item) => item.id === requestId ? { ...item, status: action === 'APPROVED' ? 'APPROVED' : 'REJECTED', approvalStatus: action } : item) }));
    showToast(action === 'APPROVED' ? 'Request disetujui.' : 'Request ditolak.');
  };

  const submitOpeningBalance = async (form) => {
    const systemDate = todayJakarta();
    if (String(form.date || '') !== systemDate) { showToast(`Tanggal saldo awal harus mengikuti tanggal sistem ${systemDate}.`); return; }
    const duplicate = (state.openingBalances || []).some((item) => ['PENDING_APPROVAL', 'APPROVED'].includes(String(item.status || '').toUpperCase()) && String(item.rekeningId || item.rekening_id || '') === String(form.rekeningId || ''));
    if (duplicate) { showToast('Rekening tersebut sudah memiliki saldo awal atau saldo awalnya sedang menunggu approval.'); return; }
    const item = { ...form, id: `saldo-${Date.now()}`, rekeningName: accountName(state.accounts, form.rekeningId), amount: Number(form.amount), date: form.date, kategoriSistem: 'SALDO AWAL', kategoriTransaksi: 'SALDO AWAL', status: 'PENDING_APPROVAL', statusValid: false, saldoStatus: 'DITERAPKAN', saldo_status: 'DITERAPKAN', diterapkanPada: new Date().toISOString(), diterapkanOleh: 'Admin' };
    if (apiConnected) {
      try { await apiRequest('/saldo-awal', { method: 'POST', body: JSON.stringify(form) }); await refreshFromApi(); setModal(null); showToast('Saldo awal berhasil dicatat dan menunggu approval Owner.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, accounts: current.accounts.map((account) => account.id === item.rekeningId ? { ...account, saldoAkhir: Number(account.saldoAkhir || 0) + item.amount } : account), openingBalances: [item, ...current.openingBalances] }));
    setModal(null);
    showToast('Saldo awal berhasil dicatat dan menunggu approval Owner.');
  };

  const setOpeningBalanceStatus = async (ids, nextStatus, reason = '') => {
    if (apiConnected) {
      try {
        const result = await apiRequest(nextStatus === 'APPROVED' ? '/saldo-awal/bulk-approve' : '/saldo-awal/bulk-reject', { method: 'POST', body: JSON.stringify({ ids, ...(nextStatus === 'REJECTED' ? { reason } : {}) }) });
        await refreshFromApi();
        const failedMessage = result.failed?.length ? ` Gagal: ${result.failed.map((item) => item.message).filter(Boolean).join(' | ')}` : '';
        showToast(`${result.processed?.length || 0} saldo awal ${nextStatus === 'APPROVED' ? 'disetujui' : 'ditolak'}.${result.failed?.length ? ` ${result.failed.length} gagal diproses.` : ''}${failedMessage}`);
      } catch (error) { showToast(error.message); }
      return;
    }
    const now = new Date().toISOString();
    setState((current) => {
      const pending = current.openingBalances.filter((item) => ids.includes(item.id) && item.status === 'PENDING_APPROVAL');
      const balanceDelta = pending.reduce((sum, item) => {
        const applied = item.saldoStatus === 'DITERAPKAN' || item.saldo_status === 'DITERAPKAN';
          if (nextStatus === 'APPROVED' && !applied) return sum + Number(item.amount || 0);
        if (nextStatus === 'REJECTED' && applied) return sum - Number(item.amount || 0);
        return sum;
      }, 0);
      return { ...current, accounts: balanceDelta === 0 ? current.accounts : current.accounts.map((account) => ({ ...account, saldoAkhir: Number(account.saldoAkhir || 0) + pending.filter((item) => item.rekeningId === account.id).reduce((sum, item) => { const applied = item.saldoStatus === 'DITERAPKAN' || item.saldo_status === 'DITERAPKAN'; if (nextStatus === 'APPROVED' && !applied) return sum + Number(item.amount || 0); if (nextStatus === 'REJECTED' && applied) return sum - Number(item.amount || 0); return sum; }, 0) })), openingBalances: current.openingBalances.map((item) => ids.includes(item.id) && item.status === 'PENDING_APPROVAL' ? { ...item, status: nextStatus, statusValid: nextStatus === 'APPROVED', ...(nextStatus === 'APPROVED' ? { saldoStatus: 'DITERAPKAN', saldo_status: 'DITERAPKAN', approvedAt: now, approvedBy: 'Owner' } : { saldoStatus: 'DIBALIK', saldo_status: 'DIBALIK', rejectedAt: now, rejectedBy: 'Owner', rejectionReason: reason }) } : item) };
    });
    showToast(nextStatus === 'APPROVED' ? `${ids.length} saldo awal disetujui.` : `${ids.length} saldo awal ditolak.`);
  };

  const validateNagagold = async (ids) => {
    if (!apiConnected) { showToast('Validasi transaksi Nagagold membutuhkan backend aktif.'); return; }
    try {
      await apiRequest('/nagagold-transactions/bulk-validate', { method: 'POST', body: JSON.stringify({ ids }) });
      await refreshFromApi();
      setSelectedIds([]);
      showToast(`${ids.length} transaksi Nagagold dikirim ke approval Owner.`);
    } catch (error) { showToast(error.message); }
  };

  const runNagagoldDryRun = async (filters = {}) => {
    if (!apiConnected) { showToast('Simulasi membutuhkan backend aktif.'); return null; }
    try {
      return await apiRequest('/nagagold-transactions/classification/dry-run', { method: 'POST', body: JSON.stringify(filters) });
    } catch (error) { showToast(error.message); return null; }
  };

  const runNagagoldSnapshotRecoveryPreview = async (filters = {}) => {
    if (!apiConnected) { showToast('Preview pemulihan membutuhkan backend aktif.'); return null; }
    try { return await apiRequest('/nagagold-transactions/snapshot-recovery/preview', { method: 'POST', body: JSON.stringify(filters) }); } catch (error) { showToast(error.message); return null; }
  };

  const applyNagagoldSnapshotRecovery = async (preview) => {
    if (!apiConnected || !['OWNER', 'SUPER_USER'].includes(session?.role)) { showToast('Pemulihan snapshot hanya dapat dijalankan Owner atau Super User.'); return null; }
    const ids = (preview?.transactions || []).filter((row) => row.recoveryStatus === 'PENDING_APPLY').map((row) => row.transactionId);
    if (!ids.length) { showToast('Tidak ada snapshot yang aman untuk dipulihkan.'); return null; }
    const confirmation = await askDialog('prompt', 'Ketik APPLY_NAGAGOLD_SNAPSHOT_RECOVERY untuk menyetujui pemulihan metadata. Saldo, jurnal, dan approval tidak diubah.');
    if (confirmation !== 'APPLY_NAGAGOLD_SNAPSHOT_RECOVERY') return null;
    try { const result = await apiRequest('/nagagold-transactions/snapshot-recovery/apply', { method: 'POST', body: JSON.stringify({ ids, previewToken: preview.previewToken, confirmation, batchId: `SNAPSHOT-${Date.now()}` }) }); await refreshFromApi(); showToast(`${result.summary?.applied || 0} snapshot dipulihkan; saldo dan jurnal tetap aman.`); return result; } catch (error) { showToast(error.message); return null; }
  };

  const testNagagoldMapping = async (form) => {
    if (!apiConnected) { showToast('Uji mapping membutuhkan backend aktif.'); return null; }
    try { return await apiRequest('/nagagold-mapping/test', { method: 'POST', body: JSON.stringify(form) }); } catch (error) { showToast(error.message); return null; }
  };

  const previewNagagoldMapping = async (filters = {}) => {
    if (!apiConnected) { showToast('Preview mapping membutuhkan backend aktif.'); return null; }
    try { return await apiRequest('/nagagold-mapping/bulk-preview', { method: 'POST', body: JSON.stringify(filters) }); } catch (error) { showToast(error.message); return null; }
  };

  const saveNagagoldMapping = async (form) => {
    if (!apiConnected) { showToast('Penyimpanan mapping membutuhkan backend aktif.'); return null; }
    try { const result = await apiRequest('/nagagold-mapping', { method: 'POST', body: JSON.stringify(form) }); await refreshFromApi(); showToast('Mapping Nagagold berhasil disimpan.'); return result; } catch (error) { showToast(error.message); return null; }
  };

  const saveNagagoldAutoPostingRule = async (form) => {
    if (!apiConnected) { showToast('Penyimpanan whitelist membutuhkan backend aktif.'); return null; }
    try { const result = await apiRequest('/nagagold-auto-posting/rules', { method: 'POST', body: JSON.stringify({ ...form, aktif: false }) }); await refreshFromApi(); showToast('Whitelist tersimpan dalam kondisi nonaktif.'); return result; } catch (error) { showToast(error.message); return null; }
  };

  const toggleNagagoldAutoPostingRule = async (rule) => {
    if (!apiConnected) return null;
    const active = !rule.isActive;
    const confirmation = active ? await askDialog('prompt', 'Ketik AKTIFKAN_AUTO_POSTING untuk meminta aktivasi. Sistem tetap menolak jika konfigurasi global masih false.') : '';
    if (active && confirmation !== 'AKTIFKAN_AUTO_POSTING') return null;
    try { const result = await apiRequest(`/nagagold-auto-posting/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ aktif: active, confirmation, alasanPersetujuan: active ? 'Persetujuan eksplisit dari pengguna berwenang.' : '' }) }); await refreshFromApi(); showToast(active ? 'Permintaan aktivasi diproses.' : 'Whitelist dinonaktifkan.'); return result; } catch (error) { showToast(error.message); return null; }
  };

  const confirmReconciliation = async (transactionId, matchedTransactionId) => {
    if (!apiConnected) return;
    try {
      await apiRequest(`/transactions/${transactionId}/reconciliation/confirm`, { method: 'POST', body: JSON.stringify({ matchedTransactionId }) });
      await refreshFromApi();
      setDetail(null);
      showToast('Pasangan transaksi dikonfirmasi. Tidak ada jurnal tambahan yang dibuat.');
    } catch (error) { showToast(error.message); }
  };

  const rejectReconciliation = async (transactionId, candidateId) => {
    if (!apiConnected) return;
    const note = await askDialog('prompt', 'Alasan menolak pasangan:');
    if (!note?.trim()) return;
    try {
      await apiRequest(`/transactions/${transactionId}/reconciliation/reject`, { method: 'POST', body: JSON.stringify({ candidateId, note }) });
      await refreshFromApi();
      setDetail(null);
      showToast('Kandidat pasangan ditolak.');
    } catch (error) { showToast(error.message); }
  };

  const submitAccount = async (form) => {
    const { id: formId, kodeAkun, isActive, ...formValues } = form;
    const payload = { ...formValues, name: String(form.name || '').trim().toUpperCase() };
    const apiPayload = {
      jenisKas: payload.jenisKas,
      jenisBisnisId: payload.jenisBisnisId,
      unitType: payload.unitType,
      bentukSaldo: payload.bentukSaldo,
      name: payload.name,
      bankId: payload.bankId,
      accountNumber: payload.accountNumber,
      penanggungJawab: payload.penanggungJawab,
    };
    const selectedBank = state.banks.find((bank) => bank.id === payload.bankId);
    const selectedBusiness = state.businessTypes.find((item) => item.id === payload.jenisBisnisId);
    const account = { ...payload, id: formId || `account-${Date.now()}`, accountType: payload.jenisKas, jenisBisnisCode: selectedBusiness?.code || payload.unitType || '', jenisBisnisName: selectedBusiness?.name || payload.unitType || '', accountNumber: payload.accountNumber || '', bankCode: payload.bentukSaldo === 'KAS_TUNAI' ? 'TUNAI' : (selectedBank?.code || ''), bankName: payload.bentukSaldo === 'KAS_TUNAI' ? 'TUNAI' : (selectedBank?.name || ''), isActive: isActive !== false, kodeAkun: kodeAkun || `AKN${String(state.accounts.filter((row) => /^AKN[0-9]+$/.test(row.kodeAkun || '')).length + 1).padStart(3, '0')}` };
    if (apiConnected) {
      try { await apiRequest(formId ? `/accounts/${formId}` : '/accounts', { method: formId ? 'PATCH' : 'POST', body: JSON.stringify(apiPayload) }); await refreshFromApi(); setModal(null); showToast(formId ? 'Rekening berhasil diperbarui.' : 'Rekening berhasil ditambahkan.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, accounts: formId ? current.accounts.map((row) => row.id === formId ? { ...row, ...account } : row) : [...current.accounts, account] }));
    setModal(null);
    showToast(formId ? 'Rekening berhasil diperbarui.' : 'Rekening berhasil ditambahkan.');
  };

  const deleteAccount = async (account) => {
    if (!await askDialog('confirm', `Hapus rekening ${account.name}? Rekening akan disembunyikan, sementara histori transaksi dan jurnal tetap dipertahankan.`)) return;
    if (apiConnected) {
      try { await apiRequest(`/accounts/${account.id}`, { method: 'DELETE' }); await refreshFromApi(); showToast('Rekening berhasil dihapus.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, accounts: current.accounts.map((row) => row.id === account.id ? { ...row, isActive: false } : row) }));
    showToast('Rekening berhasil dihapus.');
  };

  const submitBank = async (form) => {
    const bank = { ...form, id: form.id || `bank-${Date.now()}`, code: form.code.toUpperCase(), name: form.name.toUpperCase(), isActive: true, isSystem: false };
    if (apiConnected) {
      try { await apiRequest(form.id ? `/banks/${form.id}` : '/banks', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(form) }); await refreshFromApi(); setModal(null); showToast(form.id ? 'Bank berhasil diperbarui.' : 'Bank berhasil ditambahkan.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, banks: form.id ? current.banks.map((row) => row.id === form.id ? { ...row, ...bank } : row) : [...current.banks, bank] }));
    setModal(null);
    showToast(form.id ? 'Bank berhasil diperbarui.' : 'Bank berhasil ditambahkan.');
  };

  const deleteBank = async (bank) => {
    if (bank.isSystem) { showToast('Bank TUNAI adalah data sistem dan tidak dapat dihapus.'); return; }
    if (!await askDialog('confirm', `Hapus bank ${bank.name}? Bank akan disembunyikan dari pilihan rekening, sementara histori tetap dipertahankan.`)) return;
    if (apiConnected) {
      try { await apiRequest(`/banks/${bank.id}`, { method: 'DELETE' }); await refreshFromApi(); showToast('Bank berhasil dihapus.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, banks: current.banks.map((row) => row.id === bank.id ? { ...row, isActive: false } : row) }));
    showToast('Bank berhasil dihapus.');
  };

  const submitBusinessType = async (form) => {
    const payload = { ...form, code: String(form.code || '').trim().toUpperCase(), name: String(form.name || '').trim().toUpperCase() };
    if (apiConnected) {
      try { await apiRequest(form.id ? `/business-types/${form.id}` : '/business-types', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); await refreshFromApi(); setModal(null); showToast(form.id ? 'Jenis bisnis berhasil diperbarui.' : 'Jenis bisnis berhasil ditambahkan.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => {
      const reusable = !form.id && current.businessTypes.find((row) => row.isActive === false && (row.code === payload.code || row.name === payload.name));
      const item = { id: form.id || reusable?.id || `business-type-${Date.now()}`, code: payload.code, name: payload.name, isActive: true };
      return { ...current, businessTypes: form.id ? current.businessTypes.map((row) => row.id === form.id ? { ...row, ...item } : row) : reusable ? current.businessTypes.map((row) => row.id === reusable.id ? { ...row, ...item } : row) : [...current.businessTypes, item] };
    });
    setModal(null);
    showToast(form.id ? 'Jenis bisnis berhasil diperbarui.' : 'Jenis bisnis berhasil ditambahkan.');
  };

  const deleteBusinessType = async (item) => {
    if (!await askDialog('confirm', `Hapus jenis bisnis ${item.name}? Jenis bisnis akan disembunyikan, sementara histori rekening tetap dipertahankan.`)) return;
    if (apiConnected) {
      try { await apiRequest(`/business-types/${item.id}`, { method: 'DELETE' }); await refreshFromApi(); showToast('Jenis bisnis berhasil dihapus.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, businessTypes: current.businessTypes.map((row) => row.id === item.id ? { ...row, isActive: false } : row) }));
    showToast('Jenis bisnis berhasil dihapus.');
  };

  const submitCashType = async (form) => {
    const payload = { id: form.id || '', code: String(form.code || '').trim().toUpperCase(), name: String(form.name || '').trim().toUpperCase() };
    if (apiConnected) {
      try {
        const path = form.id ? `/cash-types/${form.id}` : '/cash-types';
        await apiRequest(path, { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        await refreshFromApi();
        setModal(null);
        showToast(form.id ? 'Kelompok kas berhasil diperbarui.' : 'Kelompok kas berhasil ditambahkan.');
      } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => {
      const reusable = !form.id && current.cashTypes.find((row) => row.isActive === false && ((payload.code && row.code === payload.code) || row.name === payload.name));
      const nextCode = `KS${String(current.cashTypes.filter((row) => /^KS[0-9]+$/.test(row.code || '')).length + 1).padStart(3, '0')}`;
      const item = { id: form.id || reusable?.id || `cash-type-${Date.now()}`, code: form.code || reusable?.code || nextCode, name: payload.name, type: form.type, parentId: form.parentId || '', unit: form.unit, order: payload.order, isActive: true, system: reusable?.system || false, selectable: true };
      return { ...current, cashTypes: form.id ? current.cashTypes.map((row) => row.id === form.id ? { ...row, ...item } : row) : reusable ? current.cashTypes.map((row) => row.id === reusable.id ? { ...row, ...item } : row) : [...current.cashTypes, item] };
    });
    setModal(null);
    showToast(form.id ? 'Kelompok kas berhasil diperbarui.' : 'Kelompok kas berhasil ditambahkan.');
  };

  const toggleCashType = async (item) => {
    if (item.system) { showToast('Kelompok kas bawaan sistem tidak dapat dinonaktifkan.'); return; }
    if (item.isActive && !await askDialog('confirm', `Nonaktifkan jenis kas ${item.name}?`)) return;
    if (apiConnected) {
      try { await apiRequest(`/cash-types/${item.id}`, { method: 'PATCH', body: JSON.stringify({ aktif: !item.isActive }) }); await refreshFromApi(); showToast(item.isActive ? 'Kelompok kas dinonaktifkan.' : 'Kelompok kas diaktifkan.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, cashTypes: current.cashTypes.map((row) => row.id === item.id ? { ...row, isActive: !row.isActive } : row) }));
    showToast(item.isActive ? 'Kelompok kas dinonaktifkan.' : 'Kelompok kas diaktifkan.');
  };

  const deleteCashType = async (item) => {
    if (item.system) { showToast('Kelompok kas bawaan sistem tidak dapat dihapus.'); return; }
    if (!await askDialog('confirm', `Hapus kelompok kas ${item.name}? Data akan dinonaktifkan, bukan dihapus permanen.`)) return;
    if (apiConnected) {
      try { await apiRequest(`/cash-types/${item.id}`, { method: 'DELETE' }); await refreshFromApi(); showToast('Kelompok kas berhasil dihapus.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, cashTypes: current.cashTypes.map((row) => row.id === item.id ? { ...row, isActive: false } : row) }));
    showToast('Kelompok kas berhasil dihapus.');
  };

  const submitMasterOption = async (master, form) => {
    const key = master === 'request' ? 'requestTypes' : 'transactionTypes';
    const endpoint = master === 'request' ? 'request-types' : 'transaction-types';
    const payload = { ...form, code: String(form.code || '').trim().toUpperCase(), name: String(form.name || '').trim().toUpperCase(), order: Number(form.order || 0) };
    if (apiConnected) {
      try { await apiRequest(form.id ? `/${endpoint}/${form.id}` : `/${endpoint}`, { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); await refreshFromApi(); setModal(null); showToast(form.id ? 'Master berhasil diperbarui.' : 'Master berhasil ditambahkan.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => {
      const reusable = !form.id && current[key].find((row) => row.isActive === false && row.code === payload.code);
      const item = { id: form.id || reusable?.id || `${master}-type-${Date.now()}`, code: payload.code, name: payload.name, isActive: true, system: reusable?.system || false };
      return { ...current, [key]: form.id ? current[key].map((row) => row.id === form.id ? { ...row, ...item } : row) : reusable ? current[key].map((row) => row.id === reusable.id ? { ...row, ...item } : row) : [...current[key], item] };
    });
    setModal(null);
    showToast(form.id ? 'Master berhasil diperbarui.' : 'Master berhasil ditambahkan.');
  };

  const toggleMasterOption = async (master, item) => {
    if (item.system) { showToast('Data bawaan sistem tidak dapat dinonaktifkan.'); return; }
    const key = master === 'request' ? 'requestTypes' : 'transactionTypes';
    const endpoint = master === 'request' ? 'request-types' : 'transaction-types';
    if (item.isActive && !await askDialog('confirm', `Nonaktifkan ${item.name}?`)) return;
    if (apiConnected) {
      try { await apiRequest(`/${endpoint}/${item.id}`, { method: 'PATCH', body: JSON.stringify({ aktif: !item.isActive }) }); await refreshFromApi(); showToast(item.isActive ? 'Data master dinonaktifkan.' : 'Data master diaktifkan.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, [key]: current[key].map((row) => row.id === item.id ? { ...row, isActive: !row.isActive } : row) }));
    showToast(item.isActive ? 'Data master dinonaktifkan.' : 'Data master diaktifkan.');
  };

  const deleteMasterOption = async (master, item) => {
    if (item.system) { showToast('Data bawaan sistem tidak dapat dihapus.'); return; }
    const key = master === 'request' ? 'requestTypes' : 'transactionTypes';
    const endpoint = master === 'request' ? 'request-types' : 'transaction-types';
    if (!await askDialog('confirm', `Hapus ${item.name}? Data akan dinonaktifkan, bukan dihapus permanen.`)) return;
    if (apiConnected) {
      try { await apiRequest(`/${endpoint}/${item.id}`, { method: 'DELETE' }); await refreshFromApi(); showToast('Data master berhasil dihapus.'); } catch (error) { showToast(error.message); }
      return;
    }
    setState((current) => ({ ...current, [key]: current[key].map((row) => row.id === item.id ? { ...row, isActive: false } : row) }));
    showToast('Data master berhasil dihapus.');
  };

  const submitBranch = async (form) => {
    if (!apiConnected) { showToast('Master cabang membutuhkan backend aktif.'); return; }
    try { await apiRequest(form.id ? `/cabang/${form.id}` : '/cabang', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(form) }); await refreshFromApi(); setModal(null); showToast(form.id ? 'Cabang berhasil diperbarui.' : 'Cabang berhasil ditambahkan.'); } catch (error) { showToast(error.message); }
  };

  const deleteBranch = async (branch) => {
    if (!apiConnected) { showToast('Master cabang membutuhkan backend aktif.'); return; }
    if (!await askDialog('confirm', `Hapus cabang ${branch.kodeToko}? Cabang akan disembunyikan dari pilihan baru, sementara histori transaksi tetap dipertahankan.`)) return;
    try { await apiRequest(`/cabang/${branch.id}`, { method: 'DELETE' }); await refreshFromApi(); showToast('Cabang berhasil dihapus.'); } catch (error) { showToast(error.message); }
  };

  const loadReport = async (path, filters = {}) => {
    if (!apiConnected) throw new Error('Backend laporan belum terhubung.');
    return apiRequest(`${path}${reportQuery(filters)}`);
  };

  const exportReport = async (report, filters, format) => {
    if (!apiConnected) { showToast('Backend laporan belum terhubung.'); return; }
    try { await downloadReportFile(report, filters, format); showToast(`Laporan ${format.toUpperCase()} berhasil disiapkan.`); } catch (error) { showToast(error.message); }
  };

  const approveCombined = runAction(async ({ transactionIds, openingIds }) => {
    if (transactionIds.length) await setTransactionStatus(transactionIds, 'APPROVED');
    if (openingIds.length) await setOpeningBalanceStatus(openingIds, 'APPROVED');
  });
  const rejectCombined = async ({ transactionIds, openingIds }) => {
    const reason = await askDialog('prompt', 'Alasan reject wajib diisi:', '', { uppercase: true });
    if (!reason?.trim()) return;
    await runAction(async () => {
      if (transactionIds.length) await setTransactionStatus(transactionIds, 'REJECTED', reason.trim());
      if (openingIds.length) await setOpeningBalanceStatus(openingIds, 'REJECTED', reason.trim());
    })();
  };

  if (API_BASE_URL && !authReady) return <main className="auth-loading"><FinanceMark size={40} /><span>Memuat Finance...</span></main>;
  if (API_BASE_URL && !session) return <LoginScreen onSubmit={handleLogin} error={authError} loading={authLoading} />;

  return (
    <ActionLoadingContext.Provider value={actionLoading}>
    <div className="app-shell">
      <Sidebar view={view} setView={(next) => { setView(next); setMobileNav(false); }} pendingCount={pendingApprovalCount} pendingRequestCount={pendingRequestCount} mobileOpen={mobileNav} />
      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu" type="button" onClick={() => setMobileNav((current) => !current)} aria-label="Buka menu"><Menu size={19} /></button>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <div className="system-date"><CalendarDays size={16} /><span>Tanggal System : {new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(new Date())}</span></div>
            <div className="user-menu"><button className="user-chip user-menu-trigger" type="button" onClick={() => setUserMenuOpen((current) => !current)} aria-label="Buka menu akun" aria-expanded={userMenuOpen}><span className="user-avatar">{String(session?.name || 'F').slice(0, 1).toUpperCase()}</span><ChevronDown size={14} /></button>{userMenuOpen && <div className="user-menu-popover"><div><strong>{session?.name || 'User'}</strong><small>{session?.username || ''}</small></div><button className="logout-button" type="button" onClick={handleLogout}><LogOut size={15} />Keluar</button></div>}</div>
          </div>
        </header>
        <main className="page-content">
          {view === 'dashboard' && <Dashboard state={state} pendingTransactions={pendingTransactions} setView={setView} setDetail={openTransactionDetail} apiConnected={apiConnected} loadReport={loadReport} />}
          {view === 'verification' && <Verification transactions={state.transactions} openingBalances={state.openingBalances} accounts={state.accounts} setDetail={openTransactionDetail} actionLoading={actionLoading} onApproveCombined={approveCombined} onRejectCombined={rejectCombined} />}
          {view === 'requests' && <Requests requests={state.requests} openCreate={() => setModal({ type: 'request' })} openTransaction={(request) => setModal({ type: 'mutation', request })} onAcceptRequest={acceptRequest} onRejectRequest={async (id) => { const reason = await askDialog('prompt', 'Alasan reject request wajib diisi:'); if (reason?.trim()) rejectRequestBeforeTransfer(id, reason.trim()); }} onApproveRequest={(id) => setRequestApproval(id, 'APPROVED')} onRejectApprovedRequest={async (id) => { const reason = await askDialog('prompt', 'Alasan reject request wajib diisi:'); if (reason?.trim()) setRequestApproval(id, 'REJECTED', reason.trim()); }} />}
          {view === 'mutations' && <Mutations transactions={state.transactions} accounts={state.accounts} openCreate={() => setModal({ type: 'mutation' })} setDetail={openTransactionDetail} />}
          {view === 'nagagold-transactions' && <NagagoldTransactionsSimple transactions={state.nagagoldTransactions || []} syncStatus={state.syncStatus || []} branches={state.branches || []} accounts={state.accounts} setDetail={openTransactionDetail} onSync={runNagagoldSync} apiConnected={apiConnected} />}
          {view === 'nagagold-mapping' && <NagagoldMappingPage mappings={state.nagagoldMappings || []} summary={state.nagagoldMappingSummary} examples={state.nagagoldMappingExamples || []} autoPostingRules={state.nagagoldAutoPostingRules || []} autoPostingSettings={state.nagagoldAutoPostingSettings} branches={state.branches || []} accounts={state.accounts} banks={state.banks} onSave={saveNagagoldMapping} onTest={testNagagoldMapping} onBulkPreview={previewNagagoldMapping} onPreviewRecovery={runNagagoldSnapshotRecoveryPreview} onApplyRecovery={applyNagagoldSnapshotRecovery} onSaveAutoPostingRule={saveNagagoldAutoPostingRule} onToggleAutoPostingRule={toggleNagagoldAutoPostingRule} canApplySnapshotRecovery={['OWNER', 'SUPER_USER'].includes(session?.role)} apiConnected={apiConnected} />}
          {view === 'opening-balances' && <OpeningBalances items={state.openingBalances} accounts={state.accounts} openCreate={() => setModal({ type: 'opening-balance' })} />}
          {view === 'banks' && <Banks banks={state.banks} openCreate={() => setModal({ type: 'bank' })} openEdit={(item) => setModal({ type: 'bank', item })} onDelete={deleteBank} />}
          {view === 'business-types' && <BusinessTypes items={state.businessTypes || []} openCreate={() => setModal({ type: 'business-type' })} openEdit={(item) => setModal({ type: 'business-type', item })} onDelete={deleteBusinessType} />}
          {view === 'branches' && <Branches branches={state.branches || []} openCreate={() => setModal({ type: 'branch' })} openEdit={(item) => setModal({ type: 'branch', item })} onDelete={deleteBranch} apiConnected={apiConnected} />}
          {view === 'accounts' && <Accounts accounts={state.accounts} openingBalances={state.openingBalances} transactions={state.transactions} openCreate={() => setModal({ type: 'account' })} openEdit={(item) => setModal({ type: 'account', item })} onDelete={deleteAccount} />}
          {view === 'cash-types' && <CashTypes items={state.cashTypes || cashTypeSeed} openCreate={() => setModal({ type: 'cash-type' })} openEdit={(item) => setModal({ type: 'cash-type', item })} onToggle={toggleCashType} onDelete={deleteCashType} apiConnected={apiConnected} />}
          {view === 'transaction-types' && <MasterOptions title="Master Jenis Transaksi" eyebrow="Data Master" description="Kelola jenis kejadian keuangan yang digunakan pada transaksi Finance." items={state.transactionTypes || transactionTypeSeed} openCreate={() => setModal({ type: 'transaction-type' })} openEdit={(item) => setModal({ type: 'transaction-type', item })} onDelete={(item) => deleteMasterOption('transaction', item)} />}
          {view === 'request-types' && <MasterOptions title="Master Jenis Request" eyebrow="Data Master" description="Kelola tujuan atau kebutuhan dana yang diajukan melalui Permintaan Dana." items={state.requestTypes || requestTypeSeed} openCreate={() => setModal({ type: 'request-type' })} openEdit={(item) => setModal({ type: 'request-type', item })} onDelete={(item) => deleteMasterOption('request', item)} />}
          {reportViewKeys[view] && <Reports key={view} initialReportKey={reportViewKeys[view]} transactions={visibleTransactions} state={state} apiConnected={apiConnected} loadReport={loadReport} exportReport={exportReport} setDetail={openTransactionDetail} />}
        </main>
      </div>
      {detail && <TransactionDetail transaction={detail} accounts={state.accounts} close={() => setDetail(null)} onApprove={runAction(() => detail.isOpeningBalance ? setOpeningBalanceStatus([detail.id], 'APPROVED') : setTransactionStatus([detail.id], 'APPROVED'))} onReject={async () => { const reason = await askDialog('prompt', 'Alasan reject wajib diisi:', '', { uppercase: true }); if (reason?.trim()) await runAction(() => detail.isOpeningBalance ? setOpeningBalanceStatus([detail.id], 'REJECTED', reason.trim()) : setTransactionStatus([detail.id], 'REJECTED', reason.trim()))(); }} onReconcileConfirm={confirmReconciliation} onReconcileReject={rejectReconciliation} />}
      {modal?.type === 'request' && <RequestModal close={() => setModal(null)} onSubmit={runAction(submitRequest)} loading={actionLoading} requestTypes={state.requestTypes || requestTypeSeed} accounts={state.accounts || []} businessTypes={state.businessTypes || []} />}
      {modal?.type === 'transaction' && <TransactionModal close={() => setModal(null)} onSubmit={runAction(submitTransaction)} loading={actionLoading} accounts={state.accounts} requests={state.requests} transactionTypes={state.transactionTypes || transactionTypeSeed} requestTypes={state.requestTypes || requestTypeSeed} initialRequest={modal.request} />}
      {modal?.type === 'mutation' && <MutationModal close={() => setModal(null)} onSubmit={runAction(modal.request ? submitRequestPayment : submitMutation)} loading={actionLoading} accounts={state.accounts} businessTypes={state.businessTypes || []} transactionTypes={state.transactionTypes || transactionTypeSeed} initialRequest={modal.request} />}
      {modal?.type === 'opening-balance' && <OpeningBalanceModal close={() => setModal(null)} onSubmit={runAction(submitOpeningBalance)} loading={actionLoading} accounts={state.accounts} openingBalances={state.openingBalances} />}
      {modal?.type === 'bank' && <BankModal close={() => setModal(null)} onSubmit={runAction(submitBank)} loading={actionLoading} initialItem={modal.item} />}
      {modal?.type === 'business-type' && <BusinessTypeModal close={() => setModal(null)} onSubmit={runAction(submitBusinessType)} loading={actionLoading} initialItem={modal.item} />}
      {modal?.type === 'cash-type' && <CashTypeModal close={() => setModal(null)} onSubmit={runAction(submitCashType)} loading={actionLoading} initialItem={modal.item} items={state.cashTypes} />}
      {modal?.type === 'branch' && <BranchModal close={() => setModal(null)} onSubmit={runAction(submitBranch)} loading={actionLoading} businessTypes={state.businessTypes || []} initialItem={modal.item} />}
          {modal?.type === 'account' && <AccountModal close={() => setModal(null)} onSubmit={runAction(submitAccount)} loading={actionLoading} accounts={state.accounts} banks={state.banks} businessTypes={state.businessTypes || []} initialItem={modal.item} />}
      {modal?.type === 'transaction-type' && <MasterOptionModal title="Jenis Transaksi" initialItem={modal.item} close={() => setModal(null)} loading={actionLoading} onSubmit={runAction((form) => submitMasterOption('transaction', form))} />}
      {modal?.type === 'request-type' && <MasterOptionModal title="Jenis Request" initialItem={modal.item} close={() => setModal(null)} loading={actionLoading} onSubmit={runAction((form) => submitMasterOption('request', form))} />}
      {toast && <Toast message={toast} />}
      {dialog && <AppDialog dialog={dialog} onResolve={resolveDialog} />}
      {actionLoading && <ActionLoadingOverlay />}
    </div>
    </ActionLoadingContext.Provider>
  );
}

function Sidebar({ view, setView, pendingCount, pendingRequestCount, mobileOpen }) {
  const [menuSearch, setMenuSearch] = useState('');
  const [reportsOpen, setReportsOpen] = useState(true);
  const searchTerm = menuSearch.toLowerCase().trim();
  const filteredGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => item.children
      ? { ...item, children: item.children.filter((child) => !searchTerm || child.label.toLowerCase().includes(searchTerm)) }
      : item
    ).filter((item) => !searchTerm || item.label.toLowerCase().includes(searchTerm) || item.children?.length),
  })).filter((group) => group.items.length > 0);
  const renderItem = (item, nested = false) => {
    const Icon = item.icon;
    const badgeCount = item.badge === 'requests' ? pendingRequestCount : pendingCount;
    const activeChild = item.children?.some((child) => child.id === view);
    const expanded = item.children && (reportsOpen || Boolean(searchTerm) || activeChild);
    if (item.children) {
      const submenu = expanded && <div className={`nav-submenu ${item.hideParent ? 'nav-submenu-root' : ''}`}>{item.children.map((child) => renderItem(child, true))}</div>;
      if (item.hideParent) return <div className="nav-section nav-section-root" key={item.id}>{submenu}</div>;
      return <div className="nav-section" key={item.id}>
        <button type="button" className={`nav-item nav-parent ${activeChild ? 'nav-parent-active' : ''}`} onClick={() => setReportsOpen((current) => !current)} aria-expanded={expanded}>
          <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span><ChevronDown className={`nav-chevron ${expanded ? 'is-open' : ''}`} size={15} />
        </button>
        {submenu}
      </div>;
    }
    return <button key={item.id} type="button" className={`nav-item ${nested ? 'nav-subitem' : ''} ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><Icon size={nested ? 15 : 18} strokeWidth={1.8} /><span>{item.label}</span>{item.badge && badgeCount > 0 && <em>{badgeCount}</em>}</button>;
  };
  return <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
    <div className="brand-block"><FinanceMark size={34} /><div><strong>Finance</strong></div></div>
    <label className="sidebar-search"><Search size={16} /><input value={menuSearch} onChange={(event) => setMenuSearch(event.target.value)} placeholder="Cari Menu..." aria-label="Cari menu" /></label>
    <nav className="main-nav" aria-label="Navigasi utama">
      {filteredGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map((item) => renderItem(item))}</div>)}
      {filteredGroups.length === 0 && <span className="nav-empty">Menu tidak ditemukan</span>}
    </nav>
    <div className="sidebar-footer"><div className="secure-note"><ShieldCheck size={16} /><span><strong>Sistem Keuangan Internal</strong><small>Finance Sambas</small></span></div><small className="version">Finance Sambas</small></div>
  </aside>;
}

function PageHeader({ eyebrow, title, description, action, children }) {
  const displayTitle = title === 'Master Rekening' ? 'Master Rekening & Kas' : title;
  return <div className="page-header"><div><div className="eyebrow"><span />{eyebrow}</div><h1>{displayTitle}</h1>{description && <p>{description}</p>}</div><div className="header-actions">{action}{children}</div></div>;
}

function StatCard({ icon: Icon, label, value, note, accent = '' }) {
  return <div className={`stat-card ${accent}`}><div className="stat-icon"><Icon size={19} /></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;
}

function todayJakarta() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function matchesDateRange(value, dateFrom, dateTo) {
  const date = String(value || '').slice(0, 10);
  if (!dateFrom && !dateTo) return true;
  if (!date) return false;
  return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
}

function DateRangeFilter({ dateFrom, dateTo, onDateFromChange, onDateToChange }) {
  return <div className="date-range-filter"><label className="filter-field"><span>Tanggal dari</span><input type="date" value={dateFrom} onChange={(event) => onDateFromChange(event.target.value)} /></label><label className="filter-field"><span>Tanggal sampai</span><input type="date" value={dateTo} onChange={(event) => onDateToChange(event.target.value)} /></label></div>;
}

function reportDateDefaults() {
  const today = todayJakarta();
  return { dateFrom: today, dateTo: today, kodeToko: '', bentukSaldo: '' };
}

function dashboardDateDefaults() {
  const today = todayJakarta();
  return { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: `${today.slice(0, 4)}-12-31`, kodeToko: '', bentukSaldo: '' };
}

function Dashboard({ state, pendingTransactions, setView, setDetail, apiConnected, loadReport }) {
  const accounts = state.accounts || [];
  const openingBalances = state.openingBalances || [];
  const transactions = state.transactions || [];
  const [filters, setFilters] = useState(dashboardDateDefaults);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!apiConnected) return;
    let active = true;
    setLoading(true); setError('');
    loadReport('/reports/dashboard', filters).then((body) => { if (active) setReport(body); }).catch((reason) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiConnected, filters.dateFrom, filters.dateTo, filters.kodeToko, filters.bentukSaldo]);
  const balanceRows = report?.balanceRows || [];
  const matchesStorage = (account) => {
    const storage = String(account.bentukSaldo || account.bentuk_saldo || '').toUpperCase();
    const kind = String(account.jenisAkun || account.jenis_akun || '').toUpperCase();
    if (!filters.bentukSaldo) return true;
    if (filters.bentukSaldo === 'KAS_TUNAI') return storage === 'KAS_TUNAI' || ['KAS_TUNAI_TOKO', 'KAS_TUNAI', 'KAS_KECIL_OPERASIONAL'].includes(kind);
    return storage === 'REKENING_BANK' || kind === 'REKENING_BANK';
  };
  const scopedAccounts = accounts.filter(matchesStorage);
  const fallbackSmallAccounts = getDashboardGroupAccounts('KAS_KECIL', null, scopedAccounts);
  const smallAccounts = report ? balanceRows.filter((row) => row.kelompokRekening === 'KAS_KECIL') : fallbackSmallAccounts.map((account) => ({ rekeningId: account.id, namaRekening: account.name, kodeToko: account.kodeToko || '', unit: account.unitType || '', kodeAkun: account.accountNumber || account.id, jenisAkun: account.jenisAkun || account.accountType, saldoTersimpan: getAccountBalance(account, openingBalances, transactions) }));
  const fallback = {
    balances: {
      total: scopedAccounts.reduce((sum, account) => sum + Number(getAccountBalance(account, openingBalances, transactions) || 0), 0),
      kasUtama: calculateGroupBalance('KAS_UTAMA', null, scopedAccounts, openingBalances, transactions),
      kasBesar: calculateGroupBalance('KAS_BESAR', null, scopedAccounts, openingBalances, transactions),
      kasKecil: calculateGroupBalance('KAS_KECIL', null, scopedAccounts, openingBalances, transactions),
      kasTunai: scopedAccounts.filter((account) => account.bentukSaldo === 'KAS_TUNAI').reduce((sum, account) => sum + Number(getAccountBalance(account, openingBalances, transactions) || 0), 0),
      kasTunaiToko: calculateGroupBalance('KAS_KECIL', 'NAGAGOLD', scopedAccounts, openingBalances, transactions),
      kasKecilOperasional: 0,
      rekeningBank: 0,
    },
    period: { totalPenerimaan: 0, totalPengeluaran: 0, totalMutasiAntarKas: 0, confirmedTransactions: transactions.filter((item) => item.status === 'APPROVED').length },
    operations: { pendingRequests: state.requests.filter((item) => item.status === 'PENDING_APPROVAL').length, approvedUnpaidRequests: 0, pendingManual: pendingTransactions.length, needsReview: 0, mappingFailed: 0, reconciliationConflicts: 0, sync: state.syncStatus || [] },
    businessGroups: [],
  };
  const data = report || fallback;
  const balance = data.balances || fallback.balances;
  const period = data.period || fallback.period;
  const operations = data.operations || fallback.operations;
  const flowData = report?.flow || buildDailyCashFlow(transactions);
  const categoryData = report?.categories || buildCategoryBreakdown('NAGAGOLD', transactions, accounts);
  const fallbackBusinessGroups = [...new Map([
    ...(state.businessTypes || []).filter((item) => item.isActive !== false).map((item) => [String(item.code || '').toUpperCase(), { code: String(item.code || '').toUpperCase(), name: item.name || item.code || '' }]),
    ...scopedAccounts.map((item) => { const code = String(item.jenisBisnisCode || item.unitType || '').toUpperCase(); return [code, { code, name: code }]; }),
  ].filter(([code]) => code && !['PUSAT', 'BERSAMA'].includes(code))).values()].map((business) => ({ ...business, kasBesar: calculateGroupBalance('KAS_BESAR', business.code, scopedAccounts, openingBalances, transactions), kasKecil: calculateGroupBalance('KAS_KECIL', business.code, scopedAccounts, openingBalances, transactions) }));
  const businessGroups = Array.isArray(data.businessGroups) && (report || data.businessGroups.length) ? data.businessGroups : fallbackBusinessGroups;
  const storageLabel = filters.bentukSaldo === 'KAS_TUNAI' ? 'Tunai' : filters.bentukSaldo === 'REKENING_BANK' ? 'Non Tunai' : '';
  const totalLabel = storageLabel ? `Total ${storageLabel}` : 'Total Saldo';
  const totalNote = storageLabel ? `Seluruh saldo ${storageLabel.toLowerCase()}` : 'Tunai dan non tunai seluruh rekening';
  const summaryCards = [
    { key: 'utama', icon: Building2, label: `Kas Utama${storageLabel ? ` ${storageLabel}` : ''}`, value: balance.kasUtama, note: `Seluruh rekening Kas Utama${storageLabel ? ` ${storageLabel.toLowerCase()}` : ''}`, accent: 'stat-blue' },
    { key: 'besar', icon: Building2, label: `Kas Besar${storageLabel ? ` ${storageLabel}` : ''}`, value: balance.kasBesar, note: `Seluruh rekening Kas Besar${storageLabel ? ` ${storageLabel.toLowerCase()}` : ''}`, accent: 'stat-teal' },
    { key: 'kecil', icon: CreditCard, label: `Kas Kecil${storageLabel ? ` ${storageLabel}` : ''}`, value: balance.kasKecil, note: `Seluruh rekening Kas Kecil${storageLabel ? ` ${storageLabel.toLowerCase()}` : ''}`, accent: 'stat-primary' },
    { key: 'total', icon: Landmark, label: totalLabel, value: balance.total, note: totalNote, accent: 'stat-cash' },
  ];
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return <>
    <PageHeader eyebrow="Ringkasan Finance" title="Dashboard Finance" description="Posisi saldo confirmed dan aktivitas Finance–Nagagold pada periode yang dipilih." action={<div className="page-actions"><button className="button button-secondary" type="button" onClick={() => setFilters(dashboardDateDefaults())}><RefreshCw size={16} />Tahun ini</button></div>} />
    <section className="report-filter-panel"><div className="report-filter-heading"><div><span className="section-kicker">Filter laporan</span><strong>Periode, cabang, dan bentuk penyimpanan</strong></div>{loading && <span className="loading-label">Memuat data...</span>}</div><div className="report-filter-grid"><label className="filter-field"><span>Dari tanggal</span><input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></label><label className="filter-field"><span>Sampai tanggal</span><input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></label><label className="filter-field"><span>Cabang</span><select value={filters.kodeToko} onChange={(event) => updateFilter('kodeToko', event.target.value)}><option value="">Semua cabang Nagagold</option>{(state.branches || []).map((branch) => <option key={branch.id || branch.kodeToko} value={branch.kodeToko}>{branch.kodeToko} · {branch.namaToko}</option>)}</select></label><label className="filter-field"><span>Bentuk penyimpanan</span><select value={filters.bentukSaldo} onChange={(event) => updateFilter('bentukSaldo', event.target.value)}><option value="">Semua</option><option value="KAS_TUNAI">Tunai</option><option value="REKENING_BANK">Non Tunai</option></select></label></div></section>
    {error && <div className="error-strip"><XCircle size={17} /><span>{error}</span></div>}
    <div className="dashboard-summary-grid dashboard-summary-grid-five">{summaryCards.map((card) => <StatCard key={card.key} icon={card.icon} label={card.label} value={formatRupiah(card.value)} note={card.note} accent={card.accent} />)}</div>
    <div className="report-mini-grid"><div><span>Penerimaan confirmed</span><strong>{formatRupiah(period.totalPenerimaan)}</strong></div><div><span>Pengeluaran confirmed</span><strong>{formatRupiah(period.totalPengeluaran)}</strong></div><div><span>Mutasi antar kas</span><strong>{formatRupiah(period.totalMutasiAntarKas)}</strong></div><div><span>{storageLabel ? `Akun ${storageLabel}` : 'Akun terdaftar'}</span><strong>{report ? balanceRows.length : scopedAccounts.length}</strong><small>{storageLabel ? `Akun ${storageLabel.toLowerCase()} yang dipilih` : 'Seluruh akun aktif'}</small></div></div>
    <section className="panel table-panel dashboard-table-panel"><div className="table-heading"><div><span className="section-kicker">Saldo rekening</span><h2>Saldo setiap rekening Kas Kecil</h2></div><span className="count-label">{smallAccounts.length} rekening</span></div><div className="table-wrap"><table><thead><tr><th>Kode akun</th><th>Nama kas/rekening</th><th>Cabang</th><th>Jenis akun</th><th>Saldo</th><th>Rekonsiliasi master</th></tr></thead><tbody>{smallAccounts.map((row) => <tr key={row.rekeningId}><td className="mono">{row.kodeAkun || '-'}</td><td><strong className="table-primary">{row.namaRekening || '-'}</strong></td><td>{row.kodeToko || row.unit || '-'}</td><td><span className="type-chip">{String(row.jenisAkun || '').replaceAll('_', ' ')}</span></td><td><strong className="amount-cell">{formatRupiah(row.saldoDashboard ?? row.saldoTersimpan ?? row.saldoAkhir)}</strong></td><td><span className={`status-badge ${row.rekonsiliasiSaldo === 'SELISIH' ? 'status-rejected' : 'status-approved'}`}><span className="status-dot" />{row.rekonsiliasiSaldo || 'Terukur'}</span></td></tr>)}</tbody></table>{smallAccounts.length === 0 && <EmptyState title="Belum ada rekening Kas Kecil" description="Rekening Nagagold akan tampil setelah tersedia di master rekening." />}</div></section>
    <div className="dashboard-visual-grid"><DashboardFlowChart data={flowData} granularity={report?.flowGranularity} /><CategoryDonut unit="NAGAGOLD" items={categoryData} /></div><section className="panel dashboard-flow-panel"><div className="table-heading"><div><span className="section-kicker">Aktivitas periode</span><h2>Penerimaan dan pengeluaran confirmed</h2></div><span className="count-label">{period.confirmedTransactions} transaksi</span></div><div className="report-flow-summary"><div><span className="flow-dot flow-in" /><strong>{formatRupiah(period.totalPenerimaan)}</strong><small>Penerimaan</small></div><div><span className="flow-dot flow-out" /><strong>{formatRupiah(period.totalPengeluaran)}</strong><small>Pengeluaran</small></div><div><span className="flow-dot flow-neutral" /><strong>{formatRupiah(period.totalMutasiAntarKas)}</strong><small>Mutasi internal</small></div></div></section>
    <section className="panel operational-panel"><div className="table-heading"><div><span className="section-kicker">Monitoring operasional</span><h2>Hal yang perlu diperhatikan</h2></div>{REPORT_MENU_KEYS.includes('reports-transactions') && <button className="text-button" type="button" onClick={() => setView('reports-transactions')}>Buka laporan <ChevronRight size={15} /></button>}</div><div className="operational-grid"><button type="button" onClick={() => setView('requests')}><strong>{operations.pendingRequests}</strong><span>Request menunggu approval</span></button><button type="button" onClick={() => setView('requests')}><strong>{operations.approvedUnpaidRequests}</strong><span>Approved belum ditransfer</span></button><button type="button" onClick={() => setView('verification')}><strong>{operations.pendingManual}</strong><span>Transaksi manual pending</span></button><button type="button" onClick={() => setView('nagagold-transactions')}><strong>{operations.needsReview}</strong><span>Integrasi perlu review</span></button><button type="button" onClick={() => setView('nagagold-mapping')}><strong>{operations.mappingFailed}</strong><span>Gagal mapping</span></button>{REPORT_MENU_KEYS.includes('reports-reconciliation') && <button type="button" onClick={() => setView('reports-reconciliation')}><strong>{operations.reconciliationConflicts}</strong><span>Konflik rekonsiliasi</span></button>}</div></section>
    <div className="dashboard-grid"><section className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">Approval terbaru</span><h2>Perlu perhatian Owner</h2></div><button className="text-button" type="button" onClick={() => setView('verification')}>Lihat semua <ChevronRight size={15} /></button></div>{pendingTransactions.slice(0, 3).map((item) => <button className="activity-row" key={item.id} type="button" onClick={() => setDetail(item)}><span className="activity-icon"><ArrowUpRight size={17} /></span><span className="activity-copy"><strong>{(item.jenisRequest || item.jenisTransaksi || 'Transaksi').replaceAll('_', ' ')}</strong><small>{item.kodeToko} · {item.transactionNumber}</small></span><span className="activity-amount"><strong>{formatRupiah(item.amount)}</strong><small>{formatDate(item.transactionDate)}</small></span><ChevronRight size={16} /></button>)}{pendingTransactions.length === 0 && <EmptyState title="Tidak ada transaksi pending" description="Semua transaksi sudah diproses." />}</section><section className="panel tree-panel"><div className="panel-heading"><div><span className="section-kicker">Struktur kas</span><h2>Hierarki akun aktif</h2></div><button className="text-button" type="button" onClick={() => setView('accounts')}>Kelola <ChevronRight size={15} /></button></div><MiniTree accounts={accounts} /></section></div>
  </>;
}

const dashboardCategoryColors = ['#087c75', '#f2ae2b', '#2f7fb8', '#8a6bbd', '#d46a5c'];
function getAccountBalance(account, openingBalances, transactions) { return account.saldoAkhir ?? calculateEndingBalance(account.id, openingBalances, transactions); }
function isDashboardLedgerAccount(account) { return account.accountType === 'REKENING' || account.bentukSaldo === 'KAS_TUNAI' || Boolean(account.accountNumber || account.bankId); }
function getDashboardGroupInfo(account, accounts) {
  if (account.accountType !== 'REKENING') return { type: account.accountType, unit: account.unitType || null };
  let parent = accounts.find((item) => item.id === account.parentId);
  while (parent) { if (parent.accountType !== 'REKENING') return { type: parent.accountType, unit: parent.unitType || account.unitType || null }; parent = accounts.find((item) => item.id === parent.parentId); }
  return { type: account.accountType, unit: account.unitType || null };
}
function getDashboardGroupAccounts(groupType, unit, accounts) { return accounts.filter((account) => { if (!isDashboardLedgerAccount(account)) return false; const group = getDashboardGroupInfo(account, accounts); return group.type === groupType && (!unit || group.unit === unit || account.unitType === unit); }); }
function calculateGroupBalance(groupType, unit, accounts, openingBalances, transactions) { return getDashboardGroupAccounts(groupType, unit, accounts).reduce((total, account) => total + getAccountBalance(account, openingBalances, transactions), 0); }
function countGroupAccounts(groupType, unit, accounts) { return getDashboardGroupAccounts(groupType, unit, accounts).length; }
function calculateCashBalance(transactions) {
  return transactions.filter((item) => item.status === 'APPROVED' && ['CASH', 'TUNAI'].includes(String(item.paymentMethod || item.metodePembayaran || item.metode_pembayaran || item.cashForm || item.jenis || item.jenisSumber || '').toUpperCase())).reduce((total, item) => { const amount = Number(item.amount || 0); if (item.destinationAccountId && !item.sourceAccountId) return total + amount; if (item.sourceAccountId && !item.destinationAccountId) return total - amount; if (item.rekeningId && !item.sourceAccountId && !item.destinationAccountId) return total + (String(item.arahDana).toUpperCase() === 'MASUK' ? amount : -amount); return total; }, 0);
}
function buildDailyCashFlow(transactions, days = 7) {
  const approved = transactions.filter((item) => item.status === 'APPROVED');
  const knownDates = approved.map((item) => String(item.transactionDate || item.createdAt || '').slice(0, 10)).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)).sort();
  const end = new Date(`${knownDates.at(-1) || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const rows = Array.from({ length: days }, (_, index) => { const date = new Date(end); date.setDate(end.getDate() - (days - index - 1)); return { date: date.toISOString().slice(0, 10), masuk: 0, keluar: 0 }; });
  approved.forEach((item) => { const row = rows.find((entry) => entry.date === String(item.transactionDate || item.createdAt || '').slice(0, 10)); if (!row) return; const amount = Number(item.amount || 0); if (item.destinationAccountId) row.masuk += amount; if (item.sourceAccountId) row.keluar += amount; if (item.rekeningId && !item.sourceAccountId && !item.destinationAccountId) { if (String(item.arahDana).toUpperCase() === 'MASUK') row.masuk += amount; else row.keluar += amount; } });
  return rows;
}
function getTransactionUnit(item, accounts) { const explicit = String(item.unit || item.unitType || item.jenisBisnis || item.jenis_bisnis || '').toUpperCase(); if (explicit === 'NAGAGOLD' || explicit === 'OPTIK') return explicit; return [item.rekeningId, item.destinationAccountId, item.sourceAccountId].map((id) => accounts.find((account) => account.id === id)?.unitType).find((unit) => unit === 'NAGAGOLD' || unit === 'OPTIK') || (item.sourceSystem === 'nagagold' ? 'NAGAGOLD' : 'OPTIK'); }
function categoryLabel(item) { const raw = String(item.kategoriSumber || item.jenisRequest || item.jenisTransaksi || item.jenisSumber || 'LAINNYA').toUpperCase(); if (raw.includes('PENJUAL') || raw.includes('PENDAPATAN')) return 'Penjualan'; if (raw.includes('PEMBELI')) return 'Pembelian'; if (raw.includes('SERVICE') || raw.includes('SERVIS')) return 'Service'; if (raw.includes('BUYBACK')) return 'Buyback'; if (raw.includes('OPERASIONAL')) return 'Operasional'; if (raw.includes('TRANSFER') || raw.includes('SALDO')) return 'Transfer internal'; return raw.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function buildCategoryBreakdown(unit, transactions, accounts) { const totals = {}; transactions.filter((item) => item.status === 'APPROVED' && getTransactionUnit(item, accounts) === unit).forEach((item) => { const label = categoryLabel(item); totals[label] = (totals[label] || 0) + Number(item.amount || 0); }); return Object.entries(totals).sort(([, a], [, b]) => b - a).map(([label, value], index) => ({ label, value, color: dashboardCategoryColors[index % dashboardCategoryColors.length] })); }
function DashboardFlowChart({ data, granularity = 'HARIAN' }) {
  const chartData = data.map((item) => ({ ...item, masuk: Number(item.masuk || 0), keluar: Number(item.keluar || 0) }));
  const totalIn = chartData.reduce((sum, item) => sum + item.masuk, 0);
  const totalOut = chartData.reduce((sum, item) => sum + item.keluar, 0);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const width = 960;
  const height = 300;
  const padding = { top: 22, right: 22, bottom: 42, left: 72 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...chartData.flatMap((item) => [item.masuk, item.keluar]));
  const x = (index) => chartData.length <= 1 ? padding.left + plotWidth / 2 : padding.left + (index / (chartData.length - 1)) * plotWidth;
  const y = (value) => padding.top + plotHeight - (value / max) * plotHeight;
  const linePath = (key) => chartData.map((item, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(item[key]).toFixed(2)}`).join(' ');
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.ceil(chartData.length / 8));
  const label = (item) => granularity === 'BULANAN' ? formatMonthLabel(item.date) : formatShortDate(item.date);
  const hoveredItem = hoveredIndex === null ? null : chartData[hoveredIndex];
  const tooltipWidth = 190;
  const tooltipHeight = 68;
  const tooltipX = hoveredIndex === null ? 0 : Math.min(Math.max(x(hoveredIndex) - (tooltipWidth / 2), padding.left), width - padding.right - tooltipWidth);
  const tooltipY = hoveredIndex === null ? 0 : Math.max(padding.top + 4, Math.min(y(Math.max(hoveredItem.masuk, hoveredItem.keluar)) - tooltipHeight - 12, height - padding.bottom - tooltipHeight));
  const hoverTargetWidth = chartData.length <= 1 ? plotWidth : plotWidth / (chartData.length - 1);
  const showHovered = (index) => setHoveredIndex(index);
  return <section className="panel dashboard-flow-panel"><div className="table-heading"><div><span className="section-kicker">Jurnal posted</span><h2>Arus kas per bulan</h2></div><span className="count-label">{chartData.length} bulan</span></div><div className="flow-summary"><span><i className="flow-dot flow-in" />Pemasukan <strong>{formatRupiah(totalIn)}</strong></span><span><i className="flow-dot flow-out" />Pengeluaran <strong>{formatRupiah(totalOut)}</strong></span></div>{chartData.length ? <div className="flow-line-chart"><div className="flow-line-legend"><span><i className="flow-legend-line flow-legend-income" />Pemasukan</span><span><i className="flow-legend-line flow-legend-expense" />Pengeluaran</span></div><svg className="flow-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik arus kas bulanan"><g>{gridLines.map((ratio) => <g key={ratio}><line className="flow-grid-line" x1={padding.left} x2={width - padding.right} y1={y(max * ratio)} y2={y(max * ratio)} /><text className="flow-axis-label" x={padding.left - 12} y={y(max * ratio) + 4} textAnchor="end">{formatCompactRupiah(max * ratio)}</text></g>)}</g><path className="flow-line flow-line-income" d={linePath('masuk')} /><path className="flow-line flow-line-expense" d={linePath('keluar')} />{hoveredItem && <g className="flow-tooltip" pointerEvents="none"><line className="flow-hover-line" x1={x(hoveredIndex)} x2={x(hoveredIndex)} y1={padding.top} y2={height - padding.bottom} /><rect className="flow-tooltip-box" x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="8" /><text className="flow-tooltip-title" x={tooltipX + 12} y={tooltipY + 18}>{label(hoveredItem)}</text><text className="flow-tooltip-income" x={tooltipX + 12} y={tooltipY + 38}>Pemasukan: {formatRupiah(hoveredItem.masuk)}</text><text className="flow-tooltip-expense" x={tooltipX + 12} y={tooltipY + 56}>Pengeluaran: {formatRupiah(hoveredItem.keluar)}</text></g>}{chartData.map((item, index) => <g key={item.date}><circle className="flow-point flow-point-income" cx={x(index)} cy={y(item.masuk)} r="4"><title>{`${label(item)} · Pemasukan ${formatRupiah(item.masuk)}`}</title></circle><circle className="flow-point flow-point-expense" cx={x(index)} cy={y(item.keluar)} r="4"><title>{`${label(item)} · Pengeluaran ${formatRupiah(item.keluar)}`}</title></circle>{(index % labelStep === 0 || index === chartData.length - 1) && <text className="flow-date-label" x={x(index)} y={height - 12} textAnchor="middle">{label(item)}</text>}</g>)}{chartData.map((item, index) => <rect key={`hover-${item.date}`} className="flow-hover-target" x={Math.max(padding.left, x(index) - (hoverTargetWidth / 2))} y={padding.top} width={Math.min(hoverTargetWidth, width - padding.left - padding.right)} height={plotHeight} tabIndex="0" aria-label={`${label(item)}. Pemasukan ${formatRupiah(item.masuk)}. Pengeluaran ${formatRupiah(item.keluar)}`} onMouseEnter={() => showHovered(index)} onMouseLeave={() => setHoveredIndex(null)} onFocus={() => showHovered(index)} onBlur={() => setHoveredIndex(null)} />)}</svg></div> : <EmptyState title="Belum ada arus kas" description="Belum ada transaksi posted pada periode ini." />}</section>;
}
function CategoryDonut({ unit, items }) { const total = items.reduce((sum, item) => sum + item.value, 0); let cursor = 0; const gradient = total ? items.map((item) => { const start = cursor; cursor += (item.value / total) * 100; return `${item.color} ${start}% ${cursor}%`; }).join(', ') : '#e4eceb 0 100%'; return <section className="panel category-panel"><div className="table-heading"><div><span className="section-kicker">Komposisi transaksi</span><h2>{unit === 'NAGAGOLD' ? 'Nagagold' : 'Optik'}</h2></div><span className="count-label">{items.length} kategori</span></div><div className="category-content"><div className="donut-chart" style={{ background: `conic-gradient(${gradient})` }}><div className="donut-center"><strong>{formatCompactRupiah(total)}</strong><small>approved</small></div></div><div className="category-legend">{items.length ? items.map((item) => <div key={item.label}><span className="legend-swatch" style={{ background: item.color }} /><span>{item.label}</span><strong>{formatRupiah(item.value)}</strong></div>) : <EmptyState title="Belum ada data" description={`Transaksi ${unit.toLowerCase()} approved belum tersedia.`} />}</div></div></section>; }
function formatShortDate(value) { return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`)); }
function formatMonthLabel(value) { return new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(new Date(`${String(value).slice(0, 7)}-01T00:00:00`)).replace('.', '').toUpperCase(); }
function formatCompactRupiah(value) { return `Rp ${new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)}`; }
function businessDisplayName(value) { return String(value || '').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function Toolbar({ value, onChange, placeholder = 'Cari data...', searchLabel = 'Cari data', children }) {
  return <div className="toolbar"><div className="toolbar-field"><span className="toolbar-label">{searchLabel}</span><label className="table-search"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label></div><div className="toolbar-filters">{children}</div></div>;
}

function LegacyVerification({ transactions, openingBalances, accounts, selectedIds, setSelectedIds, setDetail, onApprove, onReject, onApproveOpening, onRejectOpening }) {
  const [searchText, setSearchText] = useState('');
  const [unitFilter, setUnitFilter] = useState('ALL');
  const [selectedOpeningIds, setSelectedOpeningIds] = useState([]);
  const pending = transactions.filter((item) => {
    if (item.status !== 'PENDING_APPROVAL') return false;
    const unit = String(item.unit || item.unitType || (item.sourceSystem === 'nagagold' ? 'NAGAGOLD' : '')).toUpperCase();
    if (unitFilter !== 'ALL' && unit !== unitFilter) return false;
    const needle = searchText.trim().toLowerCase();
    return !needle || [item.transactionNumber, item.kodeToko, item.namaToko, item.jenisRequest, item.sourceInvoiceNumbers?.join(' ')].filter(Boolean).join(' ').toLowerCase().includes(needle);
  });
  const pendingOpeningBalances = openingBalances.filter((item) => item.status === 'PENDING_APPROVAL');
  const allSelected = pending.length > 0 && pending.every((item) => selectedIds.includes(item.id));
  const allOpeningSelected = pendingOpeningBalances.length > 0 && pendingOpeningBalances.every((item) => selectedOpeningIds.includes(item.id));
  const toggleAll = () => setSelectedIds(allSelected ? [] : pending.map((item) => item.id));
  const toggleOne = (id) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const toggleAllOpening = () => setSelectedOpeningIds(allOpeningSelected ? [] : pendingOpeningBalances.map((item) => item.id));
  const toggleOneOpening = (id) => setSelectedOpeningIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const approveOpening = (ids) => { onApproveOpening(ids); setSelectedOpeningIds([]); };
  const rejectOpening = (ids) => { onRejectOpening(ids); setSelectedOpeningIds([]); };
  const clearFilters = () => { setSearchText(''); setUnitFilter('ALL'); };
  return <><PageHeader eyebrow="Approval Center" title="Approval Center" description="Periksa detail transaksi lalu proses satu atau beberapa transaksi sekaligus." action={<span className="live-pill"><span />Data tersinkron</span>} />
    <div className="info-strip"><ClipboardCheck size={18} /><span><strong>{pending.length} transaksi</strong> dan <strong>{pendingOpeningBalances.length} saldo awal</strong> menunggu keputusan Owner.</span></div>
    <section className="panel table-panel"><Toolbar value={searchText} onChange={setSearchText} placeholder="Cari nomor transaksi, faktur, atau cabang..."><label className="filter-field"><span>Unit</span><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}><option value="ALL">Semua unit</option><option value="NAGAGOLD">Nagagold</option><option value="OPTIK">Optik</option></select></label>{(searchText || unitFilter !== 'ALL') && <button className="filter-clear" type="button" onClick={clearFilters}>Bersihkan</button>}</Toolbar>{selectedIds.length > 0 && <div className="bulk-bar"><span><strong>{selectedIds.length}</strong> transaksi dipilih</span><div><button className="button button-approve" type="button" onClick={() => onApprove(selectedIds)}><Check size={15} />Approve Terpilih</button><button className="button button-reject" type="button" onClick={() => onReject(selectedIds)}><X size={15} />Reject Terpilih</button></div></div>}<div className="table-wrap"><table><thead><tr><th className="checkbox-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Pilih semua pending" /></th><th>Transaksi</th><th>Cabang</th><th>Tujuan Dana</th><th>Nominal</th><th>Tanggal</th><th>Status</th><th /></tr></thead><tbody>{pending.map((item) => <tr key={item.id}><td className="checkbox-cell"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleOne(item.id)} aria-label={`Pilih ${item.transactionNumber}`} /></td><td><strong className="table-primary">{item.transactionNumber}</strong><small className="table-secondary">{item.jenisRequest.replaceAll('_', ' ')}</small></td><td><strong className="table-primary">{item.kodeToko}</strong><small className="table-secondary">{item.namaToko}</small></td><td><strong className="table-primary">{accountName(accounts, item.destinationAccountId)}</strong><small className="table-secondary">Transfer rekening</small></td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td>{formatDate(item.transactionDate)}</td><td><Badge status={item.status} /></td><td><button className="row-action" type="button" onClick={() => setDetail(item)}><Eye size={16} />Detail</button></td></tr>)}</tbody></table>{pending.length === 0 && <EmptyState title="Tidak ada transaksi menunggu approval" description="Transaksi baru yang sudah divalidasi Admin akan muncul di sini." />}</div></section>
    <section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Saldo awal rekening</span><h2>Saldo awal menunggu approval</h2></div><span className="count-label">{pendingOpeningBalances.length} data</span></div>{selectedOpeningIds.length > 0 && <div className="bulk-bar"><span><strong>{selectedOpeningIds.length}</strong> saldo awal dipilih</span><div><button className="button button-approve" type="button" onClick={() => approveOpening(selectedOpeningIds)}><Check size={15} />Approve Terpilih</button><button className="button button-reject" type="button" onClick={() => rejectOpening(selectedOpeningIds)}><X size={15} />Reject Terpilih</button></div></div>}<div className="table-wrap"><table><thead><tr><th className="checkbox-cell"><input type="checkbox" checked={allOpeningSelected} onChange={toggleAllOpening} aria-label="Pilih semua saldo awal pending" /></th><th>Rekening</th><th>Tanggal</th><th>Nilai</th><th>Keterangan</th><th>Status</th></tr></thead><tbody>{pendingOpeningBalances.map((item) => <tr key={item.id}><td className="checkbox-cell"><input type="checkbox" checked={selectedOpeningIds.includes(item.id)} onChange={() => toggleOneOpening(item.id)} aria-label={`Pilih saldo awal ${item.id}`} /></td><td><strong className="table-primary">{item.rekeningName || accountName(accounts, item.rekeningId)}</strong></td><td>{formatDate(item.date)}</td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td>{item.note || '-'}</td><td><Badge status={item.status} /></td></tr>)}</tbody></table>{pendingOpeningBalances.length === 0 && <EmptyState title="Tidak ada saldo awal pending" description="Saldo awal baru dari Admin akan muncul di sini." />}</div></section>
  </>;
}

function approvalCategory(item) {
  if (item?.isOpeningBalance || String(item?.kategoriSistem || item?.kategori_sistem || item?.kategoriTransaksi || item?.kategori_transaksi || '').toUpperCase() === 'SALDO AWAL') return 'SALDO AWAL';
  const sourceType = getSourceType(item);
  if (!String(sourceType).startsWith('SYNC')) return (String(item?.kategoriSistem || item?.kategori_sistem || '').toUpperCase() === 'MUTASI' || String(item?.jenisTransaksi || item?.jenis_transaksi || '').toUpperCase() === 'MUTASI' || String(item?.jenisRequest || item?.jenis_request || '').toUpperCase() === 'MUTASI_REKENING' || String(item?.bentukTransaksi || item?.bentuk_transaksi || '').toUpperCase() === 'MUTASI_REKENING' || String(item?.transactionNumber || item?.no_mutasi || '').toUpperCase().startsWith('MTS-')) ? 'MUTASI' : 'TRANSAKSI';
  return 'TRANSAKSI';
}

function Verification({ transactions, openingBalances, accounts, setDetail, actionLoading = false, onApproveCombined, onRejectCombined }) {
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('PENDING_APPROVAL');
  const [unitFilter, setUnitFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState(todayJakarta);
  const [dateTo, setDateTo] = useState(todayJakarta);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const transactionRows = transactions.filter((item) => {
    const approvalStatus = item.approvalStatus || item.approval_status;
    return approvalStatus !== 'TIDAK_DIPERLUKAN' && ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(item.status);
  }).map((item) => ({ kind: 'TRANSACTION', id: item.id, key: `TRANSACTION:${item.id}`, item, category: approvalCategory(item), status: item.status, unit: String(item.unit || item.unitType || (item.sourceSystem === 'nagagold' ? 'NAGAGOLD' : '')).toUpperCase(), label: item.transactionNumber || 'Transaksi' }));
  const openingRows = openingBalances.filter((item) => ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(item.status)).map((item) => {
    const account = accounts.find((row) => row.id === item.rekeningId);
    return { kind: 'OPENING_BALANCE', id: item.id, key: `OPENING_BALANCE:${item.id}`, item, category: 'SALDO AWAL', status: item.status, unit: String(account?.jenisBisnisCode || account?.unitType || 'PUSAT').toUpperCase(), label: 'SALDO AWAL' };
  });
  const rows = [...transactionRows, ...openingRows].filter((row) => {
    const rowDate = row.kind === 'OPENING_BALANCE' ? row.item.date : row.item.transactionDate;
    if (!matchesDateRange(rowDate, dateFrom, dateTo)) return false;
    if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
    if (unitFilter !== 'ALL' && row.unit !== unitFilter) return false;
    if (categoryFilter !== 'ALL' && row.category !== categoryFilter) return false;
    const item = row.item;
    const needle = searchText.trim().toLowerCase();
    return !needle || [row.category, row.label, item.kodeToko, item.namaToko, item.jenisRequest, item.sourceInvoiceNumbers?.join(' '), item.rekeningName, item.sourceAccountName, item.destinationAccountName, item.note].filter(Boolean).join(' ').toLowerCase().includes(needle);
  });
  const approvalRows = rows.filter((row) => row.status === 'PENDING_APPROVAL');
  const selectedRows = approvalRows.filter((row) => selectedKeys.includes(row.key));
  const allSelected = approvalRows.length > 0 && approvalRows.every((row) => selectedKeys.includes(row.key));
  const hasSourceBranch = rows.some((row) => row.kind === 'TRANSACTION' && getSourceType(row.item).startsWith('SYNC'));
  useEffect(() => setSelectedKeys((current) => current.filter((key) => approvalRows.some((row) => row.key === key))), [searchText, statusFilter, unitFilter, categoryFilter, dateFrom, dateTo, transactions, openingBalances]);
  const toggleAll = () => { if (!actionLoading) setSelectedKeys(allSelected ? [] : approvalRows.map((row) => row.key)); };
  const toggleOne = (key) => { if (!actionLoading) setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]); };
  const decisionPayload = () => ({ transactionIds: selectedRows.filter((row) => row.kind === 'TRANSACTION').map((row) => row.id), openingIds: selectedRows.filter((row) => row.kind === 'OPENING_BALANCE').map((row) => row.id) });
  const clearFilters = () => { const today = todayJakarta(); setSearchText(''); setStatusFilter('PENDING_APPROVAL'); setUnitFilter('ALL'); setCategoryFilter('ALL'); setDateFrom(today); setDateTo(today); };
  const openDetail = (row) => {
    if (row.kind === 'TRANSACTION') return setDetail(row.item);
    return setDetail({ ...row.item, id: row.id, isOpeningBalance: true, transactionNumber: 'SALDO AWAL', jenisTransaksi: 'SALDO AWAL', kategoriSistem: 'SALDO AWAL', kategori_sistem: 'SALDO AWAL', kategoriTransaksi: 'SALDO AWAL', amount: row.item.amount, transactionDate: row.item.date, status: row.item.status, approvalStatus: row.item.status, journalStatus: row.item.status === 'APPROVED' ? 'POSTED' : 'PROVISIONAL', sourceType: 'MANUAL_ADMIN', sourceTypeLabel: 'Saldo awal', sourceAccountId: row.item.rekeningId, destinationAccountId: '', note: row.item.note });
  };
  return <><PageHeader eyebrow="Approval Center" title="Approval Center" description="Satu antrean untuk saldo awal, mutasi, transaksi manual, request, dan transaksi terintegrasi." action={<span className="live-pill"><span />Data tersinkron</span>} /><div className="info-strip"><ClipboardCheck size={18} /><span><strong>{approvalRows.length} data</strong> menunggu keputusan Owner.</span></div><section className="panel table-panel"><DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} /><Toolbar value={searchText} onChange={setSearchText} searchLabel="Cari approval" placeholder="Kategori, nomor transaksi, atau rekening..."><label className="filter-field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Semua status</option><option value="PENDING_APPROVAL">Menunggu approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></label><label className="filter-field"><span>Kategori sistem</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="ALL">Semua kategori</option><option value="SALDO AWAL">Saldo awal</option><option value="MUTASI">Mutasi</option><option value="TRANSAKSI">Transaksi</option></select></label><label className="filter-field"><span>Unit bisnis</span><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}><option value="ALL">Semua unit</option><option value="PUSAT">Pusat</option><option value="NAGAGOLD">Nagagold</option><option value="OPTIK">Optik</option></select></label>{(searchText || statusFilter !== 'PENDING_APPROVAL' || unitFilter !== 'ALL' || categoryFilter !== 'ALL' || dateFrom !== todayJakarta() || dateTo !== todayJakarta()) && <button className="filter-clear" type="button" onClick={clearFilters}><X size={14} />Bersihkan</button>}</Toolbar>{selectedRows.length > 0 && <div className="bulk-bar"><span><strong>{selectedRows.length}</strong> data dipilih</span><div><button className="button button-approve" type="button" disabled={actionLoading} aria-busy={actionLoading} onClick={() => { onApproveCombined(decisionPayload()); setSelectedKeys([]); }}>{actionLoading ? <Spinner /> : <Check size={15} />}{actionLoading ? 'Memproses...' : 'Approve Terpilih'}</button><button className="button button-reject" type="button" disabled={actionLoading} aria-busy={actionLoading} onClick={() => onRejectCombined(decisionPayload())}>{actionLoading ? <Spinner /> : <X size={15} />}{actionLoading ? 'Memproses...' : 'Reject Terpilih'}</button></div></div>}<div className="table-wrap"><table><thead><tr><th className="checkbox-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={actionLoading} aria-label="Pilih semua data pending" /></th><th>Kategori sistem</th><th>Transaksi</th><th>{hasSourceBranch ? 'Rekening / Cabang sumber' : 'Rekening'}</th><th>Nominal</th><th>Tanggal</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row) => { const item = row.item; const canApprove = row.status === 'PENDING_APPROVAL'; const sourceType = row.kind === 'TRANSACTION' ? getSourceType(item) : ''; const isSynced = sourceType.startsWith('SYNC'); const accountId = row.kind === 'OPENING_BALANCE' ? item.rekeningId : (item.destinationAccountId || item.rekeningId || item.sourceAccountId); const accountLabel = accountDisplayLabel(accounts, accountId, item.rekeningName || item.destinationAccountName || item.sourceAccountName); const accountSecondary = row.kind === 'OPENING_BALANCE' ? '' : (isSynced ? `Cabang: ${item.kodeToko || '-'}${item.namaToko ? ` · ${item.namaToko}` : ''}` : 'Rekening tujuan'); const sourceLabel = row.kind === 'OPENING_BALANCE' ? 'Master saldo awal' : (sourceType === 'SYNC_NAGAGOLD' ? `Nagagold · ${item.kategoriSumber || 'Kategori sumber belum terbaca'}` : (item.jenisTransaksi || 'Finance')); return <tr key={row.key}><td className="checkbox-cell">{canApprove && <input type="checkbox" checked={selectedKeys.includes(row.key)} onChange={() => toggleOne(row.key)} disabled={actionLoading} aria-label={`Pilih ${row.label}`} />}</td><td><span className="type-chip">{row.category}</span><small className="table-secondary">{sourceLabel}</small></td><td><strong className="table-primary">{row.kind === 'OPENING_BALANCE' ? 'SALDO AWAL' : row.label}</strong><small className="table-secondary">{row.kind === 'OPENING_BALANCE' ? (item.note || 'Pembukaan saldo rekening') : (item.jenisRequest ? String(item.jenisRequest).replaceAll('_', ' ') : 'Input Finance')}</small></td><td><strong className="table-primary">{accountLabel}</strong>{accountSecondary && <small className="table-secondary">{accountSecondary}</small>}</td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td>{formatDate(row.kind === 'OPENING_BALANCE' ? item.date : item.transactionDate)}</td><td><Badge status={row.status} /></td><td><button className="row-action" type="button" onClick={() => openDetail(row)} disabled={actionLoading}><Eye size={16} />Detail</button></td></tr>; })}</tbody></table>{rows.length === 0 && <EmptyState title="Tidak ada data approval" description="Tidak ada saldo awal atau transaksi yang sesuai dengan filter saat ini." />}</div></section></>;
}

function Requests({ requests, openCreate, openTransaction, onAcceptRequest, onRejectRequest, onApproveRequest, onRejectApprovedRequest }) {
  const [expandedRequests, setExpandedRequests] = useState([]);
  const [dateFrom, setDateFrom] = useState(todayJakarta);
  const [dateTo, setDateTo] = useState(todayJakarta);
  const toggle = (requestId) => setExpandedRequests((current) => current.includes(requestId) ? current.filter((id) => id !== requestId) : [...current, requestId]);
  const visibleRequests = requests.filter((item) => matchesDateRange(item.requestedAt || item.requested_at || item.tanggal || item.transactionDate || item.createdAt, dateFrom, dateTo));
  return <><PageHeader eyebrow="Permintaan Dana" title="Permintaan Dana" description="Kelola permintaan dana dari cabang maupun kebutuhan internal Finance, lalu catat realisasi dan approval sesuai alurnya." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Tambah Permintaan</button>} /><div className="info-strip request-strip"><Inbox size={18} /><span>Realisasi langsung mengubah saldo dan membuat jurnal provisional. Owner hanya mengesahkan; jika ditolak, sistem membuat jurnal balik sesuai tanggal penolakan.</span></div><section className="panel table-panel"><DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} /><div className="table-heading"><div><span className="section-kicker">Daftar masuk</span><h2>Permintaan terbaru</h2></div><span className="count-label">{visibleRequests.length} permintaan</span></div><div className="table-wrap"><table><thead><tr><th className="expand-cell" /><th>Request ID</th><th>Jenis Request</th><th>Rekening</th><th>Nilai</th><th>Status request</th><th>Aksi</th></tr></thead><tbody>{visibleRequests.map((item) => { const expanded = expandedRequests.includes(item.id); const approval = item.approvalStatus || item.approval_status || 'BELUM_DIPERIKSA'; const status = String(item.status || '').toUpperCase(); const origin = String(item.asalPermintaan || item.asal_permintaan || (item.kodeToko ? 'CABANG' : 'INTERNAL')).toUpperCase(); const rawBusinessType = String(item.jenisBisnis || item.jenis_bisnis || (origin === 'INTERNAL' ? item.unitPemohon || item.unit_pemohon : '') || item.sourceSystem || 'FINANCE').trim(); const businessType = rawBusinessType.replace(/^([^\.]+)\.\1$/i, '$1').toUpperCase(); const isBranchRequester = origin === 'CABANG'; const requesterLabel = isBranchRequester ? 'Cabang pemohon' : 'Unit pemohon'; const requesterParts = isBranchRequester ? [item.kodeToko, item.namaToko] : [item.namaPemohon || item.nama_pemohon, item.unitPemohon || item.unit_pemohon]; const requesterValue = [...new Set(requesterParts.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))].join(' - ') || (isBranchRequester ? 'CABANG' : 'INTERNAL FINANCE'); const realizationDone = ['WAITING_PAYMENT_APPROVAL', 'PAID', 'COMPLETED'].includes(status); return <React.Fragment key={item.id}><tr><td className="expand-cell"><button className="row-action" type="button" onClick={() => toggle(item.id)} aria-label={expanded ? 'Tutup detail permintaan' : 'Buka detail permintaan'}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td><td><strong className="table-primary">{item.requestId}</strong><small className="table-secondary">{item.sourceSystem || 'Finance'}</small></td><td><span className="type-chip">{String(item.jenisRequest || '').replaceAll('_', ' ')}</span><small className="table-secondary">{item.tujuan || '-'}</small></td><td><strong className="table-primary mono">{item.noRekening || '-'}</strong></td><td><strong className="amount-cell">{formatRupiah(item.nilaiRp)}</strong></td><td><RequestStatusBadge status={status} /></td><td className="row-actions">{status === 'REQUESTED' && <><button className="row-action" type="button" onClick={() => onAcceptRequest(item.id)}><Check size={15} />Terima</button><button className="row-action row-action-danger" type="button" onClick={() => onRejectRequest(item.id)}><X size={15} />Tolak</button></>}{status === 'PENDING_APPROVAL' && <><button className="row-action" type="button" onClick={() => onApproveRequest(item.id)}><Check size={15} />Approve</button><button className="row-action row-action-danger" type="button" onClick={() => onRejectApprovedRequest(item.id)}><X size={15} />Reject</button></>}{['APPROVED', 'WAITING_TRANSFER'].includes(status) ? <button className="row-action" type="button" onClick={() => openTransaction(item)}><Plus size={16} />Realisasi</button> : realizationDone ? <button className="row-action row-action-disabled" type="button" disabled title="Permintaan sudah direalisasikan"><Plus size={16} /></button> : null}</td></tr>{expanded && <tr className="expanded-row"><td colSpan="7"><div className="expand-panel"><div className="expand-grid"><DetailLine label="Jenis bisnis" value={businessType} /><DetailLine label={requesterLabel} value={requesterValue} /><DetailLine label="Persetujuan" value={<Badge status={approval} />} /><DetailLine label="Asal permintaan" value={origin} /><DetailLine label="Tanggal pengajuan" value={formatDate(item.requestedAt, true)} /><DetailLine label="Tujuan" value={item.tujuan || '-'} /></div></div></td></tr>}</React.Fragment>; })}</tbody></table>{visibleRequests.length === 0 && <EmptyState title="Belum ada permintaan dana" description="Tidak ada permintaan pada rentang tanggal yang dipilih." />}</div></section></>;
}

function Transactions({ transactions, state, openCreate, setDetail }) {
  return <><PageHeader eyebrow="Buku Transaksi" title="Semua Transaksi" description="Satu daftar transaksi Finance dengan asal data, status proses, approval, dan jurnal yang jelas." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Input Manual</button>} /><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Ledger keuangan</span><h2>Daftar transaksi</h2></div><span className="count-label">{transactions.length} transaksi</span></div><div className="table-wrap"><table><thead><tr><th>Nomor</th><th>Sumber</th><th>Cabang</th><th>Rekening</th><th>Nominal</th><th>Status proses</th><th>Approval</th><th>Jurnal</th><th /></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><strong className="table-primary">{item.transactionNumber}</strong><small className="table-secondary">{item.jenisTransaksi}</small></td><td><SourceBadge sourceType={getSourceType(item)} /><small className="table-secondary">{item.source_transaction_id || item.sourceId || 'Internal Finance'}</small></td><td><strong className="table-primary">{item.kodeToko || '-'}</strong><small className="table-secondary">{item.namaToko || '-'}</small></td><td><strong className="table-primary">{item.sourceAccountName || accountName(state.accounts, item.sourceAccountId)}</strong><small className="table-secondary">→ {item.destinationAccountName || accountName(state.accounts, item.destinationAccountId)}</small></td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td><ProcessingBadge status={item.syncStatus || item.sync_status || 'TIDAK_BERLAKU'} /></td><td><Badge status={item.status} /></td><td><span className="journal-mini">{item.journalStatusLabel || item.journalStatus || item.journal_status || 'Belum dibuat'}</span>{item.reversal && <small className="reversal-note">Reversal {formatDate(item.reversal.reversalDate)}</small>}</td><td><button className="row-action" type="button" onClick={() => setDetail(item)}><Eye size={16} />Detail</button></td></tr>)}</tbody></table></div></section></>;
}

function NagagoldTransactions({ transactions, nagagoldAccounts, syncStatus, branches, accounts, onValidate, setDetail, onRefresh, apiConnected }) {
  const [selected, setSelected] = useState([]);
  const pendingAdmin = transactions.filter((item) => item.status === 'MENUNGGU_VALIDASI_ADMIN');
  const allSelected = pendingAdmin.length > 0 && pendingAdmin.every((item) => selected.includes(item.id));
  const toggleAll = () => setSelected(allSelected ? [] : pendingAdmin.map((item) => item.id));
  const toggleOne = (itemId) => setSelected((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  const syncText = syncStatus.length ? syncStatus.map((item) => `${item.kodeToko}: ${item.lastSuccessAt ? `terakhir ${formatDate(item.lastSuccessAt, true)}` : 'belum pernah berhasil'}`).join(' · ') : branches.length ? `${branches.length} cabang terdaftar; belum ada fetch yang berhasil.` : 'Belum ada data cabang di tm_cabang.';
  return <><PageHeader eyebrow="Integrasi Nagagold" title="Transaksi Nagagold" description="Data dari tt_cash_daily masuk lebih dulu ke sini. Admin memvalidasi pemetaan rekening sebelum transaksi dikirim ke approval Owner." action={<button className="button button-secondary" type="button" disabled={!apiConnected} onClick={onRefresh}><RefreshCw size={16} />Muat Ulang</button>} />
    <div className="info-strip"><RefreshCw size={18} /><span><strong>Sinkronisasi:</strong> {syncText}</span></div>
    <section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Rekening sumber</span><h2>Daftar rekening dari Nagagold</h2></div><span className="count-label">{nagagoldAccounts.length} rekening</span></div><div className="table-wrap"><table><thead><tr><th>Nomor rekening</th><th>Bank / Nama rekening</th><th>Cabang</th><th>Jumlah transaksi</th><th>Total masuk</th><th>Total keluar</th><th>Pemetaan</th></tr></thead><tbody>{nagagoldAccounts.map((item) => <tr key={`${item.kodeBank}-${item.nomorRekening}-${item.namaRekeningSumber}`}><td><strong className="table-primary mono">{item.nomorRekening}</strong><small className="table-secondary">Akun: {item.nomorAkun || '-'}</small></td><td>{item.kodeBank || '-'}<small className="table-secondary">{item.namaRekeningSumber || '-'}</small></td><td>{item.cabang.join(', ')}</td><td>{item.jumlahTransaksi}</td><td><strong className="amount-cell">{formatRupiah(item.totalMasuk)}</strong></td><td><strong className="amount-cell">{formatRupiah(item.totalKeluar)}</strong></td><td>{item.namaRekeningFinance ? <><strong className="table-primary">{item.namaRekeningFinance}</strong><small className="table-secondary">{item.kelompokRekeningFinance}</small></> : <span className="status-badge status-rejected"><span className="status-dot" />Belum di Master Rekening</span>}</td></tr>)}</tbody></table>{nagagoldAccounts.length === 0 && <EmptyState title="Belum ada rekening sumber" description="Daftar rekening muncul setelah sinkronisasi master rekening Nagagold berhasil dibaca." />}</div></section>
    <section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Antrian data sumber</span><h2>Menunggu validasi Admin</h2></div><span className="count-label">{transactions.length} transaksi</span></div>{selected.length > 0 && <div className="bulk-bar"><span><strong>{selected.length}</strong> transaksi dipilih</span><button className="button button-approve" type="button" onClick={() => { onValidate(selected); setSelected([]); }}><Check size={15} />Validasi & Kirim Approval</button></div>}<div className="table-wrap"><table><thead><tr><th className="checkbox-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Pilih semua transaksi Nagagold" /></th><th>Faktur transaksi</th><th>Cabang</th><th>Jenis / Status sumber</th><th>Rekening sumber</th><th>Masuk</th><th>Keluar</th><th>Status Finance</th><th /></tr></thead><tbody>{transactions.map((item) => { const incoming = item.arahDana === 'MASUK'; return <tr key={item.id}><td className="checkbox-cell">{item.status === 'MENUNGGU_VALIDASI_ADMIN' && item.mappingStatus === 'TERPETAKAN' && item.statusSumber === 'OPEN' && <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleOne(item.id)} aria-label={`Pilih ${item.transactionNumber}`} />}</td><td><strong className="table-primary">{item.sourceInvoiceNumbers?.length ? item.sourceInvoiceNumbers.join(', ') : '-'}</strong><small className="table-secondary">1 transaksi kas · ref sumber {item.sourceNoReff || item.sourceId}</small></td><td><strong className="table-primary">{item.kodeToko}</strong><small className="table-secondary">{item.namaToko}</small></td><td><span className="type-chip">{item.kategoriSumber || item.jenisSumber || '-'}</span><small className="table-secondary">{item.jenisSumber || '-'} · {item.statusSumber || '-'}</small></td><td><strong className="table-primary">{item.rekeningName || accountName(accounts, item.rekeningId)}</strong><small className="table-secondary">{item.sourceNoRekening || 'Tanpa nomor rekening'} · {item.sourceKodeBank || '-'} · {item.mappingStatus === 'TERPETAKAN' ? 'Terpetakan' : 'Perlu pemetaan'}</small></td><td><strong className="amount-cell">{incoming ? formatRupiah(item.amount) : '-'}</strong></td><td><strong className="amount-cell">{!incoming ? formatRupiah(item.amount) : '-'}</strong></td><td><Badge status={item.status} /></td><td><button className="row-action" type="button" onClick={() => setDetail(item)}><Eye size={16} />Detail</button></td></tr>; })}</tbody></table>{transactions.length === 0 && <EmptyState title="Belum ada transaksi Nagagold" description="Data akan muncul setelah worker sinkronisasi berhasil mengambil data dari endpoint cabang." />}</div></section></>;
}

function IntegrationStatusBadge({ status, label }) {
  const classes = { RECORDED: 'status-approved', WAITING_MAPPING: 'status-pending', WAITING_REQUEST: 'status-pending', NEEDS_REVIEW: 'status-pending', NOT_PROCESSED: 'status-neutral', FAILED: 'status-rejected', FINANCE: 'status-neutral' };
  return <span className={`status-badge ${classes[status] || 'status-pending'}`}><span className="status-dot" />{label || humanStatus(status) || 'Perlu diperiksa'}</span>;
}

function NagagoldTransactionsSimple({ transactions, syncStatus, branches, accounts, setDetail, onSync, apiConnected }) {
  const [expandedTransactions, setExpandedTransactions] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState(todayJakarta);
  const [dateTo, setDateTo] = useState(todayJakarta);
  const [syncLoading, setSyncLoading] = useState(false);
  const visibleTransactions = transactions.filter((item) => {
    const searchable = [item.sourceInvoiceNumbers?.join(' '), item.kodeToko, item.namaToko, item.sourceNoReff, item.sourceId, item.rekeningName, item.kategori, item.jenis_pembayaran, item.note, item.integrationStatusLabel].filter(Boolean).join(' ').toLowerCase();
    return matchesDateRange(item.transactionDate || item.tanggal || item.sourceTanggal || item.date || item.createdAt, dateFrom, dateTo) && (!searchText.trim() || searchable.includes(searchText.trim().toLowerCase()));
  });
  const toggle = (itemId) => setExpandedTransactions((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  const runSync = async () => {
    if (syncLoading || !onSync) return;
    setSyncLoading(true);
    try { await onSync(); } finally { setSyncLoading(false); }
  };
  const syncText = syncStatus.length ? syncStatus.map((item) => `${item.kodeToko}: ${item.lastSuccessAt ? `terakhir ${formatDate(item.lastSuccessAt, true)}` : 'belum berhasil'}`).join(' · ') : branches.length ? `${branches.length} cabang terdaftar; belum ada fetch berhasil.` : 'Belum ada data cabang di tm_cabang.';
  return <><PageHeader eyebrow="Integrasi Nagagold" title="Transaksi Terintegrasi" description="Transaksi Nagagold yang berdampak pada saldo Finance. Data rinci tetap berada di database Nagagold." action={<button className="button button-secondary" type="button" disabled={!apiConnected || syncLoading} onClick={runSync}><RefreshCw size={16} className={syncLoading ? 'spin' : undefined} />{syncLoading ? 'Menyinkronkan...' : 'Sinkronkan'}</button>} />
    <div className="info-strip"><RefreshCw size={18} /><span><strong>Sinkronisasi:</strong> {syncText}</span></div>
    <section className="panel table-panel"><DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} /><div className="table-heading"><div><span className="section-kicker">Data transaksi sumber</span><h2>Transaksi Nagagold</h2></div><span className="count-label">{visibleTransactions.length} transaksi</span></div><Toolbar value={searchText} onChange={setSearchText} searchLabel="Cari transaksi" placeholder="Referensi, faktur, cabang, rekening, atau keterangan..." /><div className="table-wrap"><table><thead><tr><th className="expand-cell" /><th>Referensi sumber</th><th>Cabang</th><th>Nominal</th><th>Arah</th><th>Kategori</th><th>Pembayaran</th><th>Rekening Finance</th><th>Status integrasi</th><th /></tr></thead><tbody>{visibleTransactions.map((item) => { const expanded = expandedTransactions.includes(item.id); const incoming = item.arahDana === 'MASUK'; const status = item.integrationStatus || 'NEEDS_REVIEW'; const invoices = item.detail_faktur || item.sourceInvoiceDetails || []; return <React.Fragment key={item.id}><tr><td className="expand-cell"><button className="row-action" type="button" onClick={() => toggle(item.id)} aria-label="Buka detail transaksi">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td><td><strong className="table-primary mono">{item.sourceNoReff || item.sourceId || '-'}</strong><small className="table-secondary">{item.sourceInvoiceNumbers?.length ? item.sourceInvoiceNumbers.join(', ') : 'Tanpa nomor faktur'}</small></td><td><strong className="table-primary">{item.kodeToko || '-'}</strong><small className="table-secondary">{item.namaToko || '-'}</small></td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td><span className="type-chip">{incoming ? 'Masuk' : 'Keluar'}</span></td><td><span className="type-chip">{item.kategori || item.kategoriSumber || '-'}</span></td><td>{item.jenis_pembayaran || item.sourcePaymentMethod || item.source_payment_method || '-'}</td><td><strong className="table-primary">{item.rekeningName || accountName(accounts, item.rekeningId)}</strong></td><td><IntegrationStatusBadge status={status} label={item.integrationStatusLabel} /></td><td><button className="row-action" type="button" onClick={() => setDetail(item)}><Eye size={16} />Detail</button></td></tr>{expanded && <tr className="expanded-row"><td colSpan="10"><div className="expand-panel"><div className="expand-grid"><DetailLine label="Sumber" value="Nagagold" /><DetailLine label="Kategori" value={item.kategori || item.kategoriSumber || '-'} /><DetailLine label="Jenis pembayaran" value={item.jenis_pembayaran || item.sourcePaymentMethod || item.source_payment_method || '-'} /><DetailLine label="Rekening Finance" value={item.rekeningName || accountName(accounts, item.rekeningId)} /><DetailLine label="Status integrasi" value={item.integrationStatusLabel || 'Perlu diperiksa'} /><DetailLine label="No. keuangan" value={item.no_keuangan || '-'} /><DetailLine label="Referensi sumber" value={item.sourceNoReff || item.sourceId || '-'} /><DetailLine label="Request ID" value={item.requestId || '-'} /><DetailLine label="Keterangan" value={item.note || item.sourceKeterangan || '-'} /><DetailLine label="Catatan proses" value={item.integrationReason || item.sync_message || '-'} /></div><div className="invoice-detail-list"><strong>Detail faktur</strong>{invoices.length ? <table><thead><tr><th>No. faktur</th><th>Jenis</th><th>Nominal</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={`${item.id}-${invoice.no_faktur || invoice.nomorFaktur}`}><td>{invoice.no_faktur || invoice.nomorFaktur}</td><td>{invoice.jenis_faktur || invoice.jenisFaktur || '-'}</td><td>{formatRupiah(invoice.nominal ?? invoice.nilaiFaktur ?? 0)}</td></tr>)}</tbody></table> : <span>Tidak ada detail faktur.</span>}</div></div></td></tr>}</React.Fragment>; })}</tbody></table>{visibleTransactions.length === 0 && <EmptyState title="Belum ada transaksi terintegrasi" description="Data akan muncul setelah sinkronisasi berhasil mengambil data dari database cabang." />}</div></section></>;
}

function NagagoldTransactionsCompact({ transactions, syncStatus, branches, accounts, onValidate, onDryRun, onSnapshotRecoveryPreview, onApplySnapshotRecovery, canApplySnapshotRecovery, setDetail, onRefresh, apiConnected }) {
  const [expandedTransactions, setExpandedTransactions] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [reconciliationFilter, setReconciliationFilter] = useState('ALL');
  const [classificationFilter, setClassificationFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState(todayJakarta);
  const [dateTo, setDateTo] = useState(todayJakarta);
  const [dryRun, setDryRun] = useState(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [recoveryPreview, setRecoveryPreview] = useState(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const visibleTransactions = transactions.filter((item) => {
    const reconciliationStatus = item.reconciliationStatus || item.reconciliation_status || 'UNMATCHED';
    const classificationStatus = item.classificationStatus || item.classification_status || 'REVIEW_REQUIRED';
    const searchable = [item.sourceInvoiceNumbers?.join(' '), item.kodeToko, item.sourceNoReff, item.sourceId].filter(Boolean).join(' ').toLowerCase();
    return matchesDateRange(item.transactionDate || item.date || item.createdAt, dateFrom, dateTo) && (reconciliationFilter === 'ALL' || reconciliationStatus === reconciliationFilter) && (classificationFilter === 'ALL' || classificationStatus === classificationFilter) && (!searchText.trim() || searchable.includes(searchText.trim().toLowerCase()));
  });
  const toggle = (setter, itemId) => setter((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  const runDryRun = async () => { setDryRunLoading(true); const result = await onDryRun?.({ classificationStatus: classificationFilter === 'ALL' ? '' : classificationFilter, limit: 1000 }); setDryRun(result); setDryRunLoading(false); };
  const runRecoveryPreview = async () => { setRecoveryLoading(true); const result = await onSnapshotRecoveryPreview?.({ kodeToko: '', onlyIncomplete: true, limit: 100 }); setRecoveryPreview(result); setRecoveryLoading(false); };
  const syncText = syncStatus.length ? syncStatus.map((item) => `${item.kodeToko}: ${item.lastSuccessAt ? `terakhir ${formatDate(item.lastSuccessAt, true)}` : 'belum berhasil'}`).join(' · ') : branches.length ? `${branches.length} cabang terdaftar; belum ada fetch berhasil.` : 'Belum ada data cabang di tm_cabang.';
  return <><PageHeader eyebrow="Integrasi & Sinkronisasi" title="Transaksi Terintegrasi" description="Transaksi Nagagold yang sudah divalidasi kasir dan memiliki mapping rekening unik langsung dibukukan ke Finance. Hanya mapping bermasalah atau request Finance yang ditahan." action={<><button className="button button-secondary" type="button" disabled={!apiConnected || dryRunLoading} onClick={runDryRun}><FileBarChart2 size={16} />{dryRunLoading ? 'Menyiapkan...' : 'Simulasi Dry-run'}</button><button className="button button-secondary" type="button" disabled={!apiConnected || recoveryLoading} onClick={runRecoveryPreview}><ShieldCheck size={16} />{recoveryLoading ? 'Memeriksa...' : 'Preview Recovery'}</button><button className="button button-secondary" type="button" disabled={!apiConnected} onClick={onRefresh}><RefreshCw size={16} />Muat Ulang</button></>} />
    <div className="info-strip"><RefreshCw size={18} /><span><strong>Sinkronisasi:</strong> {syncText}</span></div>
    {dryRun && <DryRunPanel result={dryRun} />}
    {recoveryPreview && <SnapshotRecoveryPanel result={recoveryPreview} onApply={onApplySnapshotRecovery} canApply={canApplySnapshotRecovery} />}
    <section className="panel table-panel"><DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} /><div className="table-heading"><div><span className="section-kicker">Hasil pemrosesan sumber</span><h2>Transaksi Nagagold</h2></div><span className="count-label">{visibleTransactions.length} transaksi</span></div><Toolbar value={searchText} onChange={setSearchText} searchLabel="Cari transaksi" placeholder="Nomor faktur, cabang, atau referensi..."><label className="filter-field"><span>Hubungan request</span><select value={reconciliationFilter} onChange={(event) => setReconciliationFilter(event.target.value)}><option value="ALL">Semua hubungan</option><option value="NOT_APPLICABLE">Transaksi normal</option><option value="UNMATCHED">Request belum terhubung</option><option value="MATCH_CANDIDATE">Ada kandidat request</option><option value="MATCHED">Terhubung ke request</option><option value="CONFLICT">Konflik</option></select></label><label className="filter-field"><span>Klasifikasi</span><select value={classificationFilter} onChange={(event) => setClassificationFilter(event.target.value)}><option value="ALL">Semua klasifikasi</option><option value="AUTO_ELIGIBLE">Sudah diproses</option><option value="REVIEW_REQUIRED">Perlu perhatian</option><option value="RECONCILIATION_REQUIRED">Perlu rekonsiliasi</option><option value="BLOCKED">Ditahan</option></select></label></Toolbar><div className="table-wrap"><table><thead><tr><th className="expand-cell" /><th>Faktur transaksi</th><th>Cabang</th><th>Nominal</th><th>Arah</th><th>Klasifikasi</th><th>Status pemrosesan</th><th>Hubungan request</th><th>Jurnal</th><th /></tr></thead><tbody>{visibleTransactions.map((item) => { const expanded = expandedTransactions.includes(item.id); const incoming = item.arahDana === 'MASUK'; const invoices = item.sourceInvoiceNumbers || []; return <React.Fragment key={item.id}><tr><td className="expand-cell"><button className="row-action" type="button" onClick={() => toggle(setExpandedTransactions, item.id)} aria-label="Buka detail transaksi">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td><td><strong className="table-primary">{invoices[0] || 'Tanpa nomor faktur'}</strong><small className="table-secondary">{invoices.length > 1 ? `+ ${invoices.length - 1} faktur lain` : `Ref ${item.sourceNoReff || item.sourceId}`}</small></td><td><strong className="table-primary">{item.kodeToko}</strong><small className="table-secondary">{item.namaToko}</small></td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td><span className="type-chip">{incoming ? 'Masuk' : 'Keluar'}</span></td><td><ClassificationBadge status={item.classificationStatus || item.classification_status} /></td><td><ProcessingBadge status={item.sourceProcessingStatus || item.syncStatus || item.sync_status} label={item.sourceProcessingStatusLabel} /></td><td><span className="journal-mini">{item.reconciliationStatusLabel || item.reconciliationStatus || item.reconciliation_status || 'Tidak perlu rekonsiliasi'}</span></td><td><Badge status={item.journalStatus || item.journal_status} /></td><td><button className="row-action" type="button" onClick={() => setDetail(item)}><Eye size={16} />Detail</button></td></tr>{expanded && <tr className="expanded-row"><td colSpan="10"><div className="expand-panel"><div className="expand-grid"><DetailLine label="Sumber" value={item.sourceTypeLabel || item.sourceType || item.source_type || 'Sync Nagagold'} /><DetailLine label="Metode sumber" value={item.sourcePaymentMethod || item.source_payment_method || '-'} /><DetailLine label="Klasifikasi" value={item.classificationStatusLabel || item.classificationStatus || item.classification_status || '-'} /><DetailLine label="Alasan klasifikasi" value={item.classificationReason || item.classification_reason || 'Belum diklasifikasikan'} /><DetailLine label="Versi aturan" value={item.classificationRuleVersion || item.classification_rule_version || '-'} /><DetailLine label="Status pemrosesan" value={item.sourceProcessingStatusLabel || item.syncStatusLabel || item.syncStatus || item.sync_status || '-'} /><DetailLine label="Hubungan request" value={item.reconciliationStatusLabel || item.reconciliationStatus || item.reconciliation_status || 'Tidak perlu rekonsiliasi'} /><DetailLine label="Status jurnal" value={item.journalStatusLabel || item.journalStatus || item.journal_status || '-'} /><DetailLine label="Status sumber" value={item.statusSumber || '-'} /><DetailLine label="Rekening sumber" value={`${item.sourceNoRekening || 'Tanpa nomor rekening'} · ${item.sourceKodeBank || '-'}`} /><DetailLine label="Pemetaan rekening" value={item.rekeningName || accountName(accounts, item.rekeningId)} /><DetailLine label="Referensi teknis" value={item.sourceNoReff || item.sourceId} /><DetailLine label="Keterangan" value={item.note || '-'} /></div><ProposedJournal proposal={item.classificationProposal || item.classification_proposal} /></div><div className="invoice-detail-list"><strong>Rincian faktur</strong>{item.sourceInvoiceDetails?.length ? <table><thead><tr><th>Nomor faktur</th><th>Jenis</th><th>Nilai faktur</th></tr></thead><tbody>{item.sourceInvoiceDetails.map((invoice) => <tr key={`${item.id}-${invoice.nomorFaktur}`}><td>{invoice.nomorFaktur}</td><td>{invoice.jenisFaktur || '-'}</td><td>{invoice.nilaiFaktur ? formatRupiah(invoice.nilaiFaktur) : '-'}</td></tr>)}</tbody></table> : <span>Tidak ada rincian faktur dari sumber.</span>}</div></td></tr>}</React.Fragment>; })}</tbody></table>{visibleTransactions.length === 0 && <EmptyState title="Belum ada transaksi terintegrasi" description="Data akan muncul setelah worker sinkronisasi berhasil mengambil data dari database cabang." />}</div></section></>;
}

function NagagoldMappingPage({ mappings, summary, examples, autoPostingRules, autoPostingSettings, branches, accounts, banks, onSave, onTest, onBulkPreview, onPreviewRecovery, onApplyRecovery, onSaveAutoPostingRule, onToggleAutoPostingRule, canApplySnapshotRecovery, apiConnected }) {
  const firstBranch = branches[0]?.kodeToko || '';
  const [form, setForm] = useState({ kodeToko: firstBranch, metodePembayaran: 'CASH', kodeBank: '', nomorRekening: '', rekeningId: '', keterangan: '' });
  const [testResult, setTestResult] = useState(null);
  const [recoveryPreview, setRecoveryPreview] = useState(null);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const isCash = form.metodePembayaran === 'CASH';
  const eligibleAccounts = accounts.filter((account) => account.isActive && (isCash ? account.jenisAkun === 'KAS_TUNAI_TOKO' || account.bentukSaldo === 'KAS_TUNAI' : account.bentukSaldo === 'REKENING_BANK'));
  const submit = async (event) => { event.preventDefault(); setLoading(true); const result = await onSave?.({ ...form, ...(isCash ? { kodeBank: '', nomorRekening: '' } : {}) }); setLoading(false); if (result) setTestResult({ status: 'TERPETAKAN', reason: 'Mapping tersimpan dan akan digunakan saat fetch berikutnya.', rekening: result }); };
  const test = async () => { setLoading(true); const result = await onTest?.({ ...form, ...(isCash ? { kodeBank: '', nomorRekening: '' } : {}) }); setLoading(false); setTestResult(result); };
  const previewRecovery = async () => setRecoveryPreview(await onPreviewRecovery?.({ onlyIncomplete: true, limit: 100 }));
  const previewBulkMapping = async () => setBulkPreview(await onBulkPreview?.({ limit: 10000 }));
  const summaryData = summary || {};
  return <><PageHeader eyebrow="Integrasi Nagagold" title="Mapping Rekening Nagagold" description="Tentukan mapping per cabang dan metode pembayaran agar worker tidak menebak rekening saat memproses tt_cash_daily." action={<div className="page-actions"><button className="button button-secondary" type="button" disabled={!apiConnected} onClick={previewBulkMapping}><Route size={16} />Preview Mapping Massal</button><button className="button button-secondary" type="button" disabled={!apiConnected} onClick={previewRecovery}><ShieldCheck size={16} />Preview Snapshot Lama</button></div>} /><div className="info-strip"><Route size={18} /><span>Konfigurasi mapping hanya memengaruhi pemetaan transaksi berikutnya. Tidak mengubah saldo, jurnal, approval, atau transaksi historis.</span></div>{bulkPreview && <MassMappingPreview result={bulkPreview} />}{recoveryPreview && <SnapshotRecoveryPanel result={recoveryPreview} onApply={onApplyRecovery} canApply={canApplySnapshotRecovery} />}<div className="mapping-summary-grid"><div><span>Total transaksi Nagagold</span><strong>{summaryData.total || 0}</strong></div><div><span>Mapping unik</span><strong>{summaryData.mappingUnique || 0}</strong></div><div><span>Belum / ambigu</span><strong>{(summaryData.mappingMissing || 0) + (summaryData.mappingAmbiguous || 0)}</strong></div><div><span>Snapshot belum lengkap</span><strong>{summaryData.snapshotMissing || 0}</strong></div><div><span>Dekripsi bermasalah</span><strong>{summaryData.decryptionFailed || 0}</strong></div><div><span>Finalitas belum terbukti</span><strong>{summaryData.finalityUnverified || 0}</strong></div></div><AutoPostingRulesPanel rules={autoPostingRules} settings={autoPostingSettings} branches={branches} onSave={onSaveAutoPostingRule} onToggle={onToggleAutoPostingRule} apiConnected={apiConnected} /><section className="panel mapping-form-panel"><div className="table-heading"><div><span className="section-kicker">Konfigurasi aktif</span><h2>Tambah atau ubah mapping</h2></div><span className="count-label">Per cabang & metode</span></div><form className="mapping-form" onSubmit={submit}><label className="form-field"><span>Cabang</span><select required value={form.kodeToko} onChange={(event) => update('kodeToko', event.target.value)}><option value="">Pilih cabang</option>{branches.map((branch) => <option key={branch.id} value={branch.kodeToko}>{branch.kodeToko} · {branch.namaToko}</option>)}</select></label><label className="form-field"><span>Metode pembayaran sumber</span><select required value={form.metodePembayaran} onChange={(event) => { update('metodePembayaran', event.target.value); update('rekeningId', ''); }}><option value="CASH">CASH</option><option value="DEBET">DEBET</option><option value="TRANSFER">TRANSFER</option><option value="BANK">BANK</option></select></label>{!isCash && <><label className="form-field"><span>Bank</span><select required value={form.kodeBank} onChange={(event) => update('kodeBank', event.target.value)}><option value="">Pilih bank</option>{banks.filter((bank) => bank.isActive).map((bank) => <option key={bank.id} value={bank.code}>{bank.code} · {bank.name}</option>)}</select></label><label className="form-field"><span>Nomor rekening sumber</span><input required value={form.nomorRekening} onChange={(event) => update('nomorRekening', event.target.value)} placeholder="Masukkan nomor rekening" /></label></>}<label className="form-field"><span>Rekening Finance</span><select required value={form.rekeningId} onChange={(event) => update('rekeningId', event.target.value)}><option value="">Pilih rekening tujuan mapping</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{accountOptionLabel(account)} · {account.jenisAkun || account.bentukSaldo}</option>)}</select></label><label className="form-field"><span>Keterangan</span><input value={form.keterangan} onChange={(event) => update('keterangan', event.target.value.toUpperCase())} placeholder="Opsional" /></label><div className="mapping-form-actions"><button className="button button-secondary" type="button" disabled={!apiConnected || loading} onClick={test}><Route size={16} />Uji Mapping</button><button className="button button-primary" type="submit" disabled={!apiConnected || loading}><Check size={16} />Simpan Mapping</button></div></form>{testResult && <div className={`mapping-test-result mapping-test-${String(testResult.status || '').toLowerCase()}`}><strong>Hasil uji: {testResult.status || '-'}</strong><span>{testResult.reason || '-'}</span>{testResult.rekening && <small>{testResult.rekening.name || testResult.rekening.nama_rekening || '-'}</small>}</div>}</section><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Konfigurasi tersimpan</span><h2>Mapping aktif</h2></div><span className="count-label">{mappings.length} konfigurasi</span></div><div className="table-wrap"><table><thead><tr><th>Cabang</th><th>Metode</th><th>Bank</th><th>Nomor rekening</th><th>Rekening Finance</th><th>Jenis akun</th><th>Status</th></tr></thead><tbody>{mappings.map((mapping) => <tr key={mapping.id}><td><strong className="table-primary">{mapping.kodeToko}</strong></td><td><span className="type-chip">{mapping.metodePembayaran}</span></td><td>{mapping.kodeBank || '-'}</td><td className="mono">{mapping.nomorRekening || 'Tanpa rekening bank'}</td><td>{mapping.rekeningName || '-'}</td><td>{mapping.jenisAkun || '-'}</td><td><Badge status={mapping.isActive ? 'APPROVED' : 'REJECTED'} /></td></tr>)}</tbody></table>{mappings.length === 0 && <EmptyState title="Belum ada mapping tersimpan" description="Simpan mapping per cabang dan metode pembayaran setelah menguji hasilnya." />}</div></section><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Antrian perbaikan</span><h2>Contoh transaksi yang belum terpetakan</h2></div><span className="count-label">{examples.length} contoh</span></div><div className="table-wrap"><table><thead><tr><th>Transaksi</th><th>Cabang</th><th>Metode</th><th>Sumber</th><th>Status mapping</th><th>Alasan</th></tr></thead><tbody>{examples.map((item) => <tr key={item.id}><td><strong className="table-primary">{item.transactionNumber}</strong><small className="table-secondary mono">{item.sourceId}</small></td><td>{item.kodeToko}</td><td>{item.metodePembayaran || '-'}</td><td>{item.sourceNoRekening || 'Tanpa rekening'} · {item.sourceKodeBank || '-'}</td><td><span className="type-chip">{item.mappingStatus}</span></td><td>{item.mappingReason || '-'}</td></tr>)}</tbody></table>{examples.length === 0 && <EmptyState title="Tidak ada contoh gagal mapping" description="Semua transaksi yang termuat sudah memiliki mapping unik." />}</div></section></>;
}

function OpeningBalances({ items, accounts, openCreate }) {
  return <><PageHeader eyebrow="Saldo Rekening" title="Saldo Awal" description="Catat saldo awal setiap rekening sebelum digunakan untuk transaksi." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Input Saldo Awal</button>} /><div className="info-strip"><WalletCards size={18} /><span>Saldo awal yang baru dicatat akan diverifikasi Owner melalui <strong>Approval Center</strong>.</span></div><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Daftar saldo awal</span><h2>Saldo rekening</h2></div><span className="count-label">{items.length} data</span></div><div className="table-wrap"><table><thead><tr><th>Rekening</th><th>Tanggal</th><th>Nilai</th><th>Keterangan</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong className="table-primary">{item.rekeningName || accountName(accounts, item.rekeningId)}</strong></td><td>{formatDate(item.date)}</td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td>{item.note || '-'}</td><td><Badge status={item.status} /></td></tr>)}</tbody></table>{items.length === 0 && <EmptyState title="Belum ada saldo awal" description="Input saldo awal untuk mulai memakai rekening." />}</div></section></>;
}

function OpeningBalanceModal({ close, onSubmit, accounts, openingBalances = [], loading = false }) {
  const activeOpeningAccountIds = new Set(openingBalances.filter((item) => ['PENDING_APPROVAL', 'APPROVED'].includes(String(item.status || '').toUpperCase())).map((item) => String(item.rekeningId || item.rekening_id || '')));
  const usableAccounts = accounts.filter((account) => account.isActive && !activeOpeningAccountIds.has(String(account.id || account._id || '')) && (account.accountType === 'REKENING' || account.bentukSaldo === 'KAS_TUNAI' || account.accountNumber || account.bankId));
  const systemDate = todayJakarta();
  const [form, setForm] = useState(() => ({ rekeningId: '', date: systemDate, amount: '', note: '' }));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title="Input Saldo Awal" eyebrow="Saldo rekening" close={close}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><Field label="Rekening" full><select required value={form.rekeningId} onChange={(event) => update('rekeningId', event.target.value)}><option value="">Pilih rekening</option>{usableAccounts.map((account) => <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>)}</select>{usableAccounts.length === 0 && <small className="form-note">Semua rekening aktif sudah memiliki saldo awal atau sedang menunggu approval.</small>}</Field><Field label="Tanggal saldo (tanggal sistem)"><input required disabled type="date" value={form.date} aria-readonly="true" /></Field><Field label="Saldo awal (Rp)"><input required type="text" inputMode="numeric" value={formatInputRupiah(form.amount)} onChange={(event) => update('amount', digitsOnly(event.target.value))} placeholder="Rp 0" /></Field><Field label="Keterangan" full><textarea rows="3" value={form.note} onChange={(event) => update('note', event.target.value.toUpperCase())} placeholder="Contoh: Saldo rekening saat mulai menggunakan sistem" /></Field><FormActions close={close} submitLabel="Simpan & Kirim Approval" /></form></Modal>;
}

function Banks({ banks, openCreate, openEdit, onDelete }) {
  const activeBanks = banks.filter((bank) => bank.isActive !== false);
  return <><PageHeader eyebrow="Data Master" title="Master Bank" description="Daftarkan bank untuk rekening Finance. Bank TUNAI disediakan otomatis oleh sistem untuk seluruh akun cash." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Tambah Bank</button>} /><div className="info-strip"><Landmark size={18} /><span>Bank TUNAI adalah data sistem dan tidak dapat diedit atau dihapus. Bank lain dapat diedit atau dihapus dengan aman; histori rekening tetap dipertahankan.</span></div><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Daftar bank</span><h2>Bank terdaftar</h2></div><span className="count-label">{activeBanks.length} bank</span></div><div className="table-wrap"><table><thead><tr><th>Kode bank</th><th>Nama bank</th><th>Aksi</th></tr></thead><tbody>{activeBanks.map((bank) => <tr key={bank.id}><td><strong className="table-primary mono">{bank.code}</strong></td><td><strong className="table-primary">{bank.name}</strong></td><td><div className="row-actions">{!bank.isSystem && <><button className="row-action row-action-edit" title="Edit" aria-label="Edit" type="button" onClick={() => openEdit(bank)}><SquarePen size={13} />Edit</button><button className="row-action row-action-delete row-action-danger" title="Hapus" aria-label="Hapus" type="button" onClick={() => onDelete(bank)}><Trash2 size={13} />Hapus</button></>}</div></td></tr>)}</tbody></table>{activeBanks.length === 0 && <EmptyState title="Belum ada bank" description="Bank TUNAI akan tersedia setelah backend dijalankan." />}</div></section></>;
}

function BusinessTypes({ items, openCreate, openEdit, onDelete }) {
  const activeItems = items.filter((item) => item.isActive !== false);
  return <><PageHeader eyebrow="Data Master" title="Master Jenis Bisnis" description="Kelola unit bisnis yang dapat dipilih langsung pada setiap rekening atau kas." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Tambah Jenis Bisnis</button>} /><div className="info-strip"><Building2 size={18} /><span>Contoh jenis bisnis: NAGAGOLD, OPTIK, atau LAINNYA. PUSAT/BERSAMA digunakan khusus untuk Kas Utama. Hapus hanya menyembunyikan data dari pilihan baru; histori rekening tetap dipertahankan.</span></div><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Referensi rekening</span><h2>Jenis bisnis terdaftar</h2></div><span className="count-label">{activeItems.length} bisnis</span></div><div className="table-wrap"><table><thead><tr><th>Kode bisnis</th><th>Nama bisnis</th><th>Aksi</th></tr></thead><tbody>{activeItems.map((item) => <tr key={item.id}><td className="mono"><strong className="table-primary">{item.code}</strong></td><td><strong className="table-primary">{item.name}</strong></td><td><div className="row-actions"><button className="row-action row-action-edit" title="Edit" aria-label="Edit" type="button" onClick={() => openEdit(item)}><SquarePen size={13} />Edit</button><button className="row-action row-action-delete row-action-danger" title="Hapus" aria-label="Hapus" type="button" onClick={() => onDelete(item)}><Trash2 size={13} />Hapus</button></div></td></tr>)}</tbody></table>{activeItems.length === 0 && <EmptyState title="Belum ada jenis bisnis" description="Tambahkan NAGAGOLD, OPTIK, atau jenis bisnis lain sebelum membuat rekening." />}</div></section></>;
}

function BusinessTypeModal({ close, onSubmit, initialItem, loading = false }) {
  const [form, setForm] = useState({ id: initialItem?.id || '', code: initialItem?.code || '', name: initialItem?.name || '', isActive: initialItem?.isActive !== false });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title={initialItem ? 'Edit Jenis Bisnis' : 'Tambah Jenis Bisnis'} eyebrow="Master jenis bisnis" close={close}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><Field label="Kode bisnis"><input required disabled={Boolean(initialItem)} value={form.code} onChange={(event) => update('code', event.target.value.toUpperCase())} placeholder="CONTOH: NAGAGOLD" /></Field><Field label="Nama bisnis"><input required value={form.name} onChange={(event) => update('name', event.target.value.toUpperCase())} placeholder="CONTOH: NAGAGOLD" /></Field><div className="form-note full">Kode bisnis menjadi identitas laporan dan tidak dapat diubah setelah tersimpan.</div><FormActions close={close} submitLabel={initialItem ? 'Simpan Perubahan' : 'Simpan Jenis Bisnis'} /></form></Modal>;
}

function CashTypes({ items, openCreate, openEdit, onToggle, onDelete }) {
  const visibleItems = items.filter((item) => !item.legacy && item.isActive !== false);
  const accountCount = (item) => item.accountCount ?? item.account_count ?? 0;
  const positionLabel = (item) => item.name;
  return <><PageHeader eyebrow="Data Master" title="Master Kelompok Kas" description="Bangun hierarki kas secara dinamis. Rekening dan kas tunai disimpan di Master Rekening." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Tambah Kelompok Kas</button>} /><div className="info-strip"><WalletCards size={18} /><span>Kelompok kas hanya mengatur struktur dan laporan. Saldo sebenarnya tetap berada pada masing-masing rekening atau akun kas.</span></div><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Struktur kas</span><h2>Kelompok kas terdaftar</h2></div><span className="count-label">{visibleItems.length} kelompok</span></div><div className="table-wrap"><table><thead><tr><th>Kelompok Kas</th><th>Kode Kelompok</th><th>Tingkat</th><th>Induk</th><th>Unit Bisnis</th><th>Jumlah Akun</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id || item.code}><td><strong className="table-primary">{positionLabel(item)}</strong></td><td className="mono">{item.code}</td><td><span className="type-chip">{item.type?.replace('KAS_', '') || '-'}</span></td><td>{item.parentName || '-'}</td><td>{item.unit || 'PUSAT'}</td><td>{accountCount(item)}</td><td><Badge status={item.isActive ? 'APPROVED' : 'REJECTED'} /></td><td><div className="row-actions"><button className="row-action row-action-edit" title="Edit" aria-label="Edit" type="button" onClick={() => openEdit(item)}><SquarePen size={13} />Edit</button><button className="row-action" type="button" onClick={() => onToggle(item)}>{item.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button><button className="row-action row-action-delete row-action-danger" title="Hapus" aria-label="Hapus" type="button" onClick={() => onDelete(item)}><Trash2 size={13} />Hapus</button></div></td></tr>)}</tbody></table>{visibleItems.length === 0 && <EmptyState title="Belum ada kelompok kas" description="Tambahkan kelompok kas melalui tombol Tambah Kelompok Kas." />}</div></section></>;
}

function CashTypeModal({ close, onSubmit, initialItem, items = [], loading = false }) {
  const [form, setForm] = useState({ id: initialItem?.id || '', code: initialItem?.code || '', name: initialItem?.name || '', type: initialItem?.type || '', parentId: initialItem?.parentId || '', unit: initialItem?.unit || 'PUSAT', isActive: initialItem?.isActive !== false });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const currentParent = items.find((item) => item.id === form.parentId);
  const parentOptions = items.filter((item) => item.isActive && item.id !== form.id && (form.type === 'KAS_BESAR' ? item.type === 'KAS_UTAMA' : form.type === 'KAS_KECIL' ? item.type === 'KAS_BESAR' : false));
  const changeType = (type) => setForm((current) => ({ ...current, type, parentId: type === 'KAS_UTAMA' ? '' : '', unit: type === 'KAS_UTAMA' ? 'PUSAT' : 'PUSAT' }));
  const changeParent = (parentId) => { const parent = items.find((item) => item.id === parentId); setForm((current) => ({ ...current, parentId, unit: current.type === 'KAS_KECIL' && parent ? parent.unit : current.unit })); };
  const preview = form.type ? `${form.type.replace('KAS_', '')} · ${form.unit}${currentParent ? ` · di bawah ${currentParent.name}` : ''}` : 'Pilih tingkat kas terlebih dahulu';
  const submit = (event) => { event.preventDefault(); onSubmit(form); };
  return <Modal title={initialItem ? 'Edit Kelompok Kas' : 'Tambah Kelompok Kas'} eyebrow="Master kelompok kas" close={close}><form className="form-grid" onSubmit={submit}><div className="form-note full">Kode kelompok dibuat otomatis saat disimpan dan tidak dapat diubah.</div><Field label="Nama kelompok kas" full><input required value={form.name} onChange={(event) => update('name', event.target.value.toUpperCase())} placeholder="CONTOH: KAS BESAR NAGAGOLD" /></Field><Field label="Tingkat kas"><select required value={form.type} onChange={(event) => changeType(event.target.value)}><option value="">Pilih tingkat kas</option><option value="KAS_UTAMA">UTAMA</option><option value="KAS_BESAR">BESAR</option><option value="KAS_KECIL">KECIL</option></select></Field>{form.type !== 'KAS_UTAMA' && form.type && <Field label="Kelompok induk"><select required value={form.parentId} onChange={(event) => changeParent(event.target.value)}><option value="">Pilih kelompok induk</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></Field>}{form.type && <Field label="Unit bisnis"><select required value={form.unit} disabled={form.type === 'KAS_KECIL'} onChange={(event) => update('unit', event.target.value)}>{form.type === 'KAS_UTAMA' && <><option value="PUSAT">PUSAT</option><option value="BERSAMA">BERSAMA</option></>}{form.type === 'KAS_BESAR' && <><option value="NAGAGOLD">NAGAGOLD</option><option value="OPTIK">OPTIK</option><option value="PUSAT">PUSAT</option><option value="BERSAMA">BERSAMA</option></>}{form.type === 'KAS_KECIL' && <option value={form.unit}>{form.unit || 'Mengikuti induk'}</option>}</select></Field>}{form.type && <div className="info-strip full"><WalletCards size={16} /><span>Preview: <strong>{form.name || 'Nama kelompok'}</strong> · {preview}</span></div>}<Field label="Urutan tampilan"><input type="number" min="0" value={form.order} onChange={(event) => update('order', event.target.value)} /></Field><FormActions close={close} submitLabel={initialItem ? 'Simpan Perubahan' : 'Simpan Kelompok Kas'} /></form></Modal>;
}

function MasterOptions({ title, eyebrow, description, items, openCreate, openEdit, onDelete }) {
  const activeItems = items.filter((item) => item.isActive !== false);
  return <><PageHeader eyebrow={eyebrow} title={title} description={description} action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Tambah</button>} /><div className="info-strip"><ReceiptText size={18} /><span>Kode bawaan sistem dipertahankan agar transaksi lama tetap terbaca. Tombol Hapus hanya menyembunyikan data dari pilihan baru; data lama tetap tersimpan.</span></div><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Referensi transaksi</span><h2>{title}</h2></div><span className="count-label">{activeItems.length} data</span></div><div className="table-wrap"><table><thead><tr><th>Kode</th><th>Nama</th><th>Aksi</th></tr></thead><tbody>{activeItems.map((item) => <tr key={item.id || item.code}><td className="mono"><strong className="table-primary">{item.code}</strong></td><td><strong className="table-primary">{item.name}</strong></td><td><div className="row-actions"><button className="row-action row-action-edit" title="Edit" aria-label="Edit" type="button" onClick={() => openEdit(item)}><SquarePen size={13} />Edit</button>{!item.system && <button className="row-action row-action-delete row-action-danger" title="Hapus" aria-label="Hapus" type="button" onClick={() => onDelete(item)}><Trash2 size={13} />Hapus</button>}</div></td></tr>)}</tbody></table>{activeItems.length === 0 && <EmptyState title={`Belum ada ${title.toLowerCase()}`} description="Tambahkan data melalui tombol Tambah." />}</div></section></>;
}

function MasterOptionModal({ title, close, onSubmit, initialItem, loading = false }) {
  const [form, setForm] = useState({ id: initialItem?.id || '', code: initialItem?.code || '', name: initialItem?.name || '' });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title={initialItem ? `Edit ${title}` : `Tambah ${title}`} eyebrow={title} close={close}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><Field label="Kode"><input required disabled={Boolean(initialItem)} value={form.code} onChange={(event) => update('code', event.target.value.toUpperCase())} placeholder="CONTOH: JENIS_BARU" /></Field><Field label="Nama"><input required value={form.name} onChange={(event) => update('name', event.target.value.toUpperCase())} placeholder="CONTOH: JENIS BARU" /></Field><div className="form-note full">Kode tidak dapat diubah setelah data tersimpan.</div><FormActions close={close} submitLabel={initialItem ? 'Simpan Perubahan' : 'Simpan'} /></form></Modal>;
}

function Branches({ branches, openCreate, openEdit, onDelete, apiConnected }) {
  const activeBranches = branches.filter((branch) => branch.isActive !== false);
  return <><PageHeader eyebrow="Integrasi Sumber" title="Master Cabang" description="Simpan identitas cabang, jenis bisnis, dan database sumber pada satu koneksi cluster." action={<button className="button button-primary" type="button" onClick={openCreate} disabled={!apiConnected}><Plus size={16} />Tambah Cabang</button>} /><div className="info-strip"><Building2 size={18} /><span>Jenis bisnis menentukan asal transaksi sinkronisasi, sedangkan nama database menentukan sumber datanya. Hapus hanya menyembunyikan cabang dari pilihan baru.</span></div><section className="panel table-panel"><div className="table-heading"><div><span className="section-kicker">Daftar sumber database</span><h2>Cabang terdaftar</h2></div><span className="count-label">{activeBranches.length} cabang</span></div><div className="table-wrap"><table><thead><tr><th>Kode toko</th><th>Nama toko</th><th>Jenis bisnis</th><th>Tipe toko</th><th>Database</th><th>Aksi</th></tr></thead><tbody>{activeBranches.map((branch) => <tr key={branch.id}><td><strong className="table-primary mono">{branch.kodeToko}</strong></td><td>{branch.namaToko}<small className="table-secondary">{branch.portal || '-'}</small></td><td><span className="type-chip">{branch.jenisBisnis || '-'}</span></td><td>{branch.tipeToko || '-'}</td><td className="mono">{branch.databaseName}</td><td><div className="row-actions"><button className="row-action row-action-edit" title="Edit" aria-label="Edit" type="button" onClick={() => openEdit(branch)}><SquarePen size={13} />Edit</button><button className="row-action row-action-delete row-action-danger" title="Hapus" aria-label="Hapus" type="button" onClick={() => onDelete(branch)}><Trash2 size={13} />Hapus</button></div></td></tr>)}</tbody></table>{activeBranches.length === 0 && <EmptyState title="Belum ada data cabang" description="Tambahkan data cabang dan jenis bisnis sumbernya." />}</div></section></>;
}

function Accounts({ accounts, openingBalances, transactions, openCreate, openEdit, onDelete }) {
  const activeAccounts = accounts.filter((account) => account.isActive !== false);
  return <><PageHeader eyebrow="Master Data" title="Master Rekening" description="Catat rekening bank atau kas tunai dengan Jenis Kas dan Jenis Bisnis langsung pada rekening." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Tambah Rekening</button>} /><div className="info-strip"><WalletCards size={18} /><span>Saldo rekening dihitung dari saldo awal dan jurnal yang sah. Jenis Kas dan Jenis Bisnis menjadi pembeda laporan tanpa perlu mengatur kelompok induk. Cabang dikenali dari transaksi yang masuk.</span></div><section className="panel table-panel account-list-panel"><div className="table-heading"><div><span className="section-kicker">Data rekening aktif</span><h2>Semua rekening</h2></div><span className="count-label">{activeAccounts.length} data</span></div><div className="table-wrap"><table><thead><tr><th>Kode akun</th><th>Nama rekening</th><th>Jenis Kas</th><th>Jenis Bisnis</th><th>Jenis penyimpanan</th><th>Bank / nomor rekening</th><th>Saldo</th><th>Aksi</th></tr></thead><tbody>{activeAccounts.map((account) => <tr key={account.id}><td className="mono">{account.kodeAkun || '-'}</td><td><span className="table-primary table-value">{account.name}</span></td><td><span className="type-chip">{(account.jenisKas || account.posKasType || account.accountType || '').replace('KAS_', '') || '-'}</span></td><td><span className="type-chip">{account.jenisBisnisName || account.jenisBisnisCode || account.unitType || '-'}</span></td><td><span className="type-chip">{account.bentukSaldo === 'KAS_TUNAI' ? 'TUNAI' : 'REKENING BANK'}</span></td><td><span className="table-primary table-value">{account.bentukSaldo === 'KAS_TUNAI' ? 'TUNAI' : (account.bankCode || account.bankName || 'Bank belum terbaca')}</span><small className="table-primary table-value mono">{account.accountNumber || 'Tanpa nomor rekening'}</small></td><td><strong className="amount-cell">{formatRupiah(account.saldoAkhir ?? calculateEndingBalance(account.id, openingBalances, transactions))}</strong></td><td><div className="row-actions"><button className="row-action row-action-edit" title="Edit" aria-label="Edit" type="button" onClick={() => openEdit(account)}><SquarePen size={13} />Edit</button><button className="row-action row-action-delete row-action-danger" title="Hapus" aria-label="Hapus" type="button" onClick={() => onDelete(account)}><Trash2 size={13} />Hapus</button></div></td></tr>)}</tbody></table>{activeAccounts.length === 0 && <EmptyState title="Belum ada rekening" description="Tambahkan rekening melalui tombol Tambah Rekening." />}</div></section></>;
}

function financialCategoryLabel(item) {
  const raw = String(item.kategoriSumber || item.kategori_sistem || item.jenisTransaksi || item.jenisRequest || '').trim().toUpperCase();
  if (item.bentukTransaksi === 'MUTASI_REKENING' || raw.includes('MUTASI')) return 'MUTASI';
  if (raw.includes('SALDO')) return 'SALDO AWAL';
  if (raw.includes('PENJUAL') || raw.includes('PENDAPATAN')) return 'PENJUALAN';
  if (raw.includes('PEMBELI') || raw.includes('BUYBACK')) return 'PEMBELIAN';
  if (raw.includes('OPERASIONAL')) return 'OPERASIONAL';
  if (raw.includes('SERVICE') || raw.includes('SERVIS')) return 'SERVICE';
  return raw.replaceAll('_', ' ') || 'LAINNYA';
}

function financialSearchText(row) {
  return [row.transactionNumber, row.accountNumber, row.accountName, row.category, row.reference, row.description].filter(Boolean).join(' ').toLowerCase();
}

function fallbackFinancialRows(state) {
  const accounts = state.accounts || [];
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const rows = [];
  const addRow = ({ item, accountId, debit = 0, credit = 0, category, transactionNumber, date, reference, description, journalStatus = 'Sementara', journalNumber = item.id }) => {
    if (!accountId || !debit && !credit) return;
    const account = accountById.get(accountId);
    if (!account) return;
    const isOpening = category === 'SALDO AWAL';
    rows.push({ id: `${item.id}-${accountId}-${debit ? 'D' : 'K'}`, date, transactionNumber, category, accountNumber: account.accountNumber || account.kodeAkun || '-', accountName: account.name || '-', accountLabel: accountDisplayLabel(accounts, accountId), reference: reference || '-', description: description || '-', debit, credit, reportDebit: isOpening ? 0 : debit, reportCredit: isOpening ? 0 : credit, isOpeningBalance: isOpening, journalStatus, journalNumber });
  };
  for (const item of state.openingBalances || []) {
    addRow({ item, accountId: item.rekeningId, debit: Number(item.amount || 0), category: 'SALDO AWAL', transactionNumber: '-', date: item.date, reference: '-', description: item.note || 'Saldo awal rekening', journalStatus: item.status === 'REJECTED' ? 'Dibalik' : 'Sementara' });
    if (item.status === 'REJECTED' && (item.saldoStatus === 'DIBALIK' || item.saldo_status === 'DIBALIK')) addRow({ item, accountId: item.rekeningId, credit: Number(item.amount || 0), category: 'PEMBALIKAN', transactionNumber: '-', date: item.rejectedAt || item.date, reference: '-', description: item.rejectionReason || 'Saldo awal dibalik', journalStatus: 'Terposting', journalNumber: `${item.id}-REVERSAL` });
  }
  for (const item of state.transactions || []) {
    const category = financialCategoryLabel(item);
    const common = { item, category, transactionNumber: item.transactionNumber || '-', date: item.transactionDate, reference: item.sourceNoReff || item.requestId || '-', description: item.note || '-', journalStatus: item.journalStatus || item.journal_status || 'Sementara' };
    if (item.rekeningId) addRow({ ...common, accountId: item.rekeningId, debit: item.arahDana === 'MASUK' ? Number(item.amount || 0) : 0, credit: item.arahDana === 'KELUAR' ? Number(item.amount || 0) : 0 });
    else {
      addRow({ ...common, accountId: item.destinationAccountId, debit: Number(item.amount || 0) });
      addRow({ ...common, accountId: item.sourceAccountId, credit: Number(item.amount || 0) });
    }
  }
  return rows;
}

function summarizeFinancialRows(rows, groupBy) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = groupBy === 'CATEGORY' ? row.category : row.accountNumber + ':' + row.accountName;
    const current = grouped.get(key) || { key, id: `fallback-${key}`, rowType: groupBy === 'CATEGORY' ? 'GROUP' : 'ACCOUNT', label: groupBy === 'CATEGORY' ? row.category : row.accountLabel, accountLabel: row.accountLabel, accountNumber: groupBy === 'CATEGORY' ? '' : row.accountNumber, saldoAwal: 0, debet: 0, kredit: 0, totalDebit: 0, totalKredit: 0, saldoAkhir: 0, journalKeys: new Set() };
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    if (row.category === 'SALDO AWAL') {
      current.saldoAwal += debit - credit;
    } else {
      current.debet += Number(row.reportDebit ?? debit);
      current.kredit += Number(row.reportCredit ?? credit);
      current.totalDebit += Number(row.reportDebit ?? debit);
      current.totalKredit += Number(row.reportCredit ?? credit);
    }
    current.saldoAkhir = current.saldoAwal + current.debet - current.kredit;
    current.journalKeys.add(row.journalNumber || row.transactionNumber);
    grouped.set(key, current);
  });
  return [...grouped.values()].map((row) => ({ ...row, jumlahTransaksi: row.journalKeys.size, journalKeys: undefined })).sort((left, right) => (right.debet + right.kredit) - (left.debet + left.kredit));
}

function financialGroupOptions(accounts = [], cashTypes = []) {
  const master = cashTypes.filter((item) => item.isActive !== false).map((item) => ({ id: item.id, label: item.name || item.code, parentId: item.parentId || '', unit: item.unit || '' }));
  if (master.length) return master;
  const derived = new Map();
  accounts.filter((account) => account.isActive !== false).forEach((account) => {
    const id = account.posKasId || `LEGACY:${account.jenisKas || account.accountType || 'LAINNYA'}:${account.unitType || 'PUSAT'}`;
    if (!derived.has(id)) derived.set(id, { id, label: `${String(account.jenisKas || account.accountType || 'LAINNYA').replaceAll('_', ' ')} ${account.unitType || 'PUSAT'}`.trim(), parentId: '', unit: account.unitType || 'PUSAT' });
  });
  return [...derived.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function financialGroupDescendants(groups, groupId) {
  const children = new Map();
  groups.forEach((group) => children.set(group.parentId || '', [...(children.get(group.parentId || '') || []), group]));
  const result = [groupId];
  const visit = (id) => { (children.get(id) || []).forEach((child) => { result.push(child.id); visit(child.id); }); };
  visit(groupId);
  return result;
}

function Reports({ transactions, state, apiConnected, loadReport, exportReport, setDetail, initialReportKey = 'transactions' }) {
  const reportKey = initialReportKey;
  const sourceReportKeys = ['nagagold-source', 'nagagold-cash', 'nagagold-accounts'];
  const reportConfigs = {
    financial: { title: 'Laporan Kas & Bank', description: 'Laporan keuangan Finance dan transaksi Nagagold yang sudah tercatat.', filters: ['financialView', 'period', 'business', 'cashGroup', 'account', 'branch', 'source', 'financialOptions'] },
    transactions: { title: 'Semua Transaksi', description: 'Seluruh transaksi Finance dengan status approval, jurnal, dan sumber yang jelas.', filters: ['period', 'posting', 'branch', 'search', 'source', 'transactionType', 'approval', 'journal', 'reconciliation', 'sync'] },
    balances: { title: 'Saldo Kas & Rekening', description: 'Saldo kas dan rekening berdasarkan saldo awal, jurnal posted, serta pengecekan selisih akun.', filters: ['period', 'branch', 'storage'] },
    integrated: { title: 'Terintegrasi Nagagold', description: 'Transaksi Nagagold yang sudah masuk ke Finance untuk dipantau dan diproses.', filters: ['period', 'branch', 'search', 'category', 'method', 'approval', 'journal', 'reconciliation', 'sync'] },
    'nagagold-source': { title: 'Pergerakan Nagagold', description: 'Semua pergerakan sumber dari tt_cash_daily tanpa penghitungan ulang per faktur.', filters: ['period', 'branch', 'search', 'category', 'method', 'sourceStatus', 'finality', 'mapping', 'reconciliation'] },
    'nagagold-cash': { title: 'Laporan Cash Nagagold', description: 'Laporan uang tunai Nagagold dengan format event cash harian dari tt_cash_daily.', filters: ['period', 'branch', 'search', 'category', 'sourceStatus', 'finality', 'mapping', 'reconciliation'] },
    'nagagold-accounts': { title: 'Laporan Rekening Nagagold', description: 'Laporan pergerakan rekening/bank Nagagold dengan nomor rekening dan bank sumber.', filters: ['period', 'branch', 'search', 'category', 'method', 'sourceStatus', 'finality', 'mapping', 'reconciliation'] },
    mutations: { title: 'Laporan Mutasi Kas', description: 'Perpindahan dana internal antar jenis kas dan rekening Finance.', filters: ['period', 'branch', 'search'] },
    requests: { title: 'Request & Approval', description: 'Daftar permintaan dana, status approval, pembayaran, dan realisasi transfer.', filters: ['period', 'branch', 'search', 'requestStatus', 'approval', 'payment'] },
    journals: { title: 'Pencatatan Keuangan', description: 'Catatan pergerakan uang Finance berdasarkan rekening dan jenis transaksi.', filters: ['period', 'journal', 'journalType', 'account'] },
    reconciliation: { title: 'Rekonsiliasi', description: 'Pemeriksaan mapping, pasangan transaksi, klasifikasi, dan jurnal Nagagold.', filters: ['period', 'branch', 'search', 'mapping', 'reconciliation', 'classification', 'journal'] },
  };
  const config = reportConfigs[reportKey] || reportConfigs.transactions;
  const createFilters = () => ({ ...reportDateDefaults(), postingDateFrom: '', postingDateTo: '', search: '', sourceType: '', jenisTransaksi: '', kategoriSumber: '', kategoriKeuangan: '', metodePembayaran: '', statusSumber: '', sourceFinalityStatus: '', approvalStatus: '', journalStatus: '', syncStatus: '', reconciliationStatus: '', mappingStatus: '', classificationStatus: '', status: '', paymentStatus: '', journalType: '', accountId: '', unit: '', kelompokKasId: '', includeSubgroups: true, includeEmptyAccounts: false, detailDirection: '', nomorKeuangan: '', nomorTransaksi: '', keterangan: '', groupBy: 'CASH_GROUP', view: 'summary', page: 1, pageSize: 25 });
  const [filters, setFilters] = useState(createFilters);
  const appliedFilters = filters;
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value, ...(key === 'page' ? {} : { page: 1 }) }));
  const reset = () => setFilters(createFilters());
  const changePage = (page) => setFilters((current) => ({ ...current, page }));
  const cashGroups = financialGroupOptions(state.accounts || [], state.cashTypes || []);
  const visibleCashGroups = filters.unit ? cashGroups.filter((group) => !group.unit || String(group.unit).toUpperCase() === filters.unit) : cashGroups;
  const selectedGroupIds = filters.kelompokKasId && filters.includeSubgroups ? new Set(financialGroupDescendants(cashGroups, filters.kelompokKasId)) : filters.kelompokKasId ? new Set([filters.kelompokKasId]) : null;
  const financialAccounts = (state.accounts || []).filter((account) => {
    if (account.isActive === false) return false;
    if (filters.unit && String(account.unitType || account.jenisBisnisCode || '').toUpperCase() !== filters.unit) return false;
    if (selectedGroupIds && !selectedGroupIds.has(String(account.posKasId || `LEGACY:${account.jenisKas || account.accountType || 'LAINNYA'}:${account.unitType || 'PUSAT'}`))) return false;
    return true;
  });
  const businessOptions = [...new Set([...(state.businessTypes || []).filter((item) => item.isActive !== false).map((item) => item.code), ...(state.accounts || []).map((item) => item.unitType).filter(Boolean), 'PUSAT'])].sort();
  useEffect(() => {
    if (!apiConnected) { setPayload(null); return undefined; }
    let active = true;
    setLoading(true); setError('');
    const endpoint = reportKey === 'transactions' ? '/reports/transactions' : '/reports/' + reportKey;
    loadReport(endpoint, filters).then((body) => { if (active) setPayload(body); }).catch((reason) => { if (active) { setPayload(null); setError(reason.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiConnected, reportKey, filters.dateFrom, filters.dateTo, filters.postingDateFrom, filters.postingDateTo, filters.kodeToko, filters.bentukSaldo, filters.search, filters.sourceType, filters.jenisTransaksi, filters.kategoriSumber, filters.kategoriKeuangan, filters.metodePembayaran, filters.statusSumber, filters.sourceFinalityStatus, filters.approvalStatus, filters.journalStatus, filters.syncStatus, filters.reconciliationStatus, filters.mappingStatus, filters.classificationStatus, filters.status, filters.paymentStatus, filters.journalType, filters.accountId, filters.unit, filters.kelompokKasId, filters.includeSubgroups, filters.includeEmptyAccounts, filters.detailDirection, filters.nomorKeuangan, filters.nomorTransaksi, filters.keterangan, filters.groupBy, filters.view, filters.page]);
  const fallbackRows = reportKey === 'transactions' ? transactions.map((item) => ({ id: item.id, transactionDate: item.transactionDate, postedDate: item.approvedAt || '', transactionNumber: item.transactionNumber, sourceType: getSourceType(item), sourceNoReff: item.sourceNoReff || '', requestId: item.requestId || '', kodeToko: item.kodeToko || '', jenisTransaksi: item.jenisTransaksi || '', amount: Number(item.amount || 0), confirmedAmount: item.status === 'APPROVED' ? Number(item.amount || 0) : 0, approvalStatus: item.approvalStatus || item.status, journalStatus: item.journalStatus || item.journal_status || '', syncStatus: item.syncStatus || item.sync_status || '', reconciliationStatus: item.reconciliationStatus || item.reconciliation_status || '' })) : [];
  const fallbackFinancial = reportKey === 'financial' ? fallbackFinancialRows(state).filter((row) => (!appliedFilters.accountId || row.accountId === appliedFilters.accountId) && (!appliedFilters.kategoriKeuangan || row.category === appliedFilters.kategoriKeuangan) && (!appliedFilters.search || financialSearchText(row).includes(appliedFilters.search.toLowerCase()))) : [];
  const fallbackFinancialSummary = reportKey === 'financial' ? summarizeFinancialRows(fallbackFinancial, appliedFilters.groupBy) : [];
  const rows = payload?.rows || (reportKey === 'financial' ? (appliedFilters.view === 'summary' ? fallbackFinancialSummary : fallbackFinancial) : fallbackRows);
  const total = payload?.total ?? rows.length;
  const totalPages = payload?.totalPages ?? 1;
  const sourceSummary = sourceReportKeys.includes(reportKey) ? payload?.summary : null;
  const groupRows = reportKey === 'balances' ? (payload?.groupRows || []) : [];
  const financialSummary = reportKey === 'financial' ? (payload?.summary || { saldoAwal: fallbackFinancial.filter((row) => row.category === 'SALDO AWAL').reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0), totalDebit: fallbackFinancial.reduce((sum, row) => sum + Number((row.reportDebit ?? row.debit) || 0), 0), totalKredit: fallbackFinancial.reduce((sum, row) => sum + Number((row.reportCredit ?? row.credit) || 0), 0), saldoAkhir: fallbackFinancial.reduce((sum, row) => sum + Number((row.reportDebit ?? row.debit) || 0) - Number((row.reportCredit ?? row.credit) || 0), 0) + fallbackFinancial.filter((row) => row.category === 'SALDO AWAL').reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0) }) : null;
  const financialTree = reportKey === 'financial' ? (payload?.groupTree || []) : [];
  const financialGroupRows = (() => { const result = []; const visit = (nodes) => (nodes || []).forEach((node) => { if (node.rowType === 'GROUP') result.push(node); visit(node.children); visit(node.accounts); }); visit(financialTree); return result; })();
  const renderInput = (key, label, type = 'text', placeholder = '') => <label key={key} className="filter-field"><span>{label}</span><input type={type} value={filters[key] || ''} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} /></label>;
  const renderSelect = (key, label, options) => <label key={key} className="filter-field"><span>{label}</span><select value={filters[key] || ''} onChange={(event) => update(key, event.target.value)}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const renderFilter = (filter) => {
    if (filter === 'financialView') return renderSelect('view', 'Tampilan laporan', [['summary', 'Rekap'], ['detail', 'Detail']]);
    if (filter === 'period') return [renderInput('dateFrom', 'Tanggal dari', 'date'), renderInput('dateTo', 'Tanggal sampai', 'date')];
    if (filter === 'business') return <label key={filter} className="filter-field"><span>Unit bisnis</span><select value={filters.unit || ''} onChange={(event) => setFilters((current) => ({ ...current, unit: event.target.value, kelompokKasId: '', accountId: '', page: 1 }))}><option value="">Semua unit</option>{businessOptions.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>;
    if (filter === 'cashGroup') return <label key={filter} className="filter-field"><span>Kelompok kas</span><select value={filters.kelompokKasId || ''} onChange={(event) => setFilters((current) => ({ ...current, kelompokKasId: event.target.value, accountId: '', page: 1 }))}><option value="">Semua kelompok kas</option>{visibleCashGroups.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
    if (filter === 'financialOptions') return <React.Fragment key={filter}><label className="filter-field"><span>Pengelompokan</span><select value={filters.groupBy} onChange={(event) => update('groupBy', event.target.value)}><option value="CASH_GROUP">Per Kelompok Kas</option><option value="ACCOUNT">Per Rekening</option><option value="UNIT">Per Unit Bisnis</option><option value="BRANCH">Per Toko / Cabang</option></select></label>{filters.groupBy === 'ACCOUNT' && filters.view === 'summary' && <label className="filter-check"><input type="checkbox" checked={Boolean(filters.includeEmptyAccounts)} onChange={(event) => update('includeEmptyAccounts', event.target.checked)} /><span>Tampilkan rekening tanpa transaksi</span></label>}{filters.view === 'detail' && <><label className="filter-field"><span>Jenis transaksi</span><select value={filters.jenisTransaksi || ''} onChange={(event) => update('jenisTransaksi', event.target.value)}><option value="">Semua jenis</option>{(state.transactionTypes || transactionTypeSeed).filter((item) => item.isActive !== false).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>{renderSelect('detailDirection', 'Arah transaksi', [['', 'Semua arah'], ['DEBET', 'Debet / uang masuk'], ['KREDIT', 'Kredit / uang keluar']])}{renderInput('search', 'Pencarian', 'text', 'No. keuangan, no. transaksi, rekening, atau keterangan')}</>}</React.Fragment>;
    if (filter === 'posting') return [renderInput('postingDateFrom', 'Posting dari', 'date'), renderInput('postingDateTo', 'Posting sampai', 'date')];
    if (filter === 'branch') return renderSelect('kodeToko', 'Cabang', [['', 'Semua cabang'], ...(state.branches || []).map((branch) => [branch.kodeToko, branch.kodeToko + ' · ' + branch.namaToko])]);
    if (filter === 'search') return renderInput('search', 'Pencarian', 'text', 'Nomor, referensi, rekening, atau cabang');
    if (filter === 'source') return renderSelect('sourceType', 'Sumber transaksi', reportKey === 'financial' ? [['', 'Semua sumber'], ['FINANCE', 'Finance'], ['NAGAGOLD', 'Nagagold']] : [['', 'Semua sumber'], ['MANUAL_ADMIN', 'Input Manual'], ['SYNC_NAGAGOLD', 'Sync Nagagold'], ['BRANCH_REQUEST', 'Request Cabang']]);
    if (filter === 'category') return renderInput('kategoriSumber', 'Kategori sumber', 'text', 'PENJUALAN / PEMBELIAN');
    if (filter === 'method') return renderSelect('metodePembayaran', 'Metode pembayaran', [['', 'Semua metode'], ['CASH', 'CASH'], ['DEBET', 'DEBET'], ['CREDIT', 'CREDIT'], ['TRANSFER', 'TRANSFER']]);
    if (filter === 'transactionType') return renderSelect('jenisTransaksi', 'Jenis transaksi', [['', 'Semua jenis'], ...(state.transactionTypes || transactionTypeSeed).filter((item) => item.isActive).map((item) => [item.code, item.name])]);
    if (filter === 'approval') return renderSelect('approvalStatus', 'Status approval', [['', 'Semua status'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']]);
    if (filter === 'journal') return renderSelect('journalStatus', 'Status jurnal', [['', 'Semua status'], ['PROVISIONAL', 'Provisional'], ['POSTED', 'Posted'], ['REVERSED', 'Reversed']]);
    if (filter === 'sync') return renderSelect('syncStatus', 'Status sinkronisasi', [['', 'Semua status'], ['TERCATAT', 'Tercatat'], ['DIREKONSILIASI', 'Direkonsiliasi'], ['PERLU_DIPERIKSA', 'Perlu diperiksa'], ['GAGAL', 'Gagal']]);
    if (filter === 'reconciliation') return renderSelect('reconciliationStatus', 'Status rekonsiliasi', [['', 'Semua status'], ['UNMATCHED', 'Belum cocok'], ['MATCH_CANDIDATE', 'Kandidat'], ['MATCHED', 'Matched'], ['CONFLICT', 'Conflict']]);
    if (filter === 'mapping') return renderSelect('mappingStatus', 'Status mapping', [['', 'Semua status'], ['TERPETAKAN', 'Terpetakan'], ['PERLU_PEMETAAN', 'Perlu pemetaan'], ['PEMETAAN_AMBIGU', 'Pemetaan ambigu'], ['GAGAL_MAPPING', 'Gagal mapping']]);
    if (filter === 'classification') return renderSelect('classificationStatus', 'Status klasifikasi', [['', 'Semua status'], ['AUTO_ELIGIBLE', 'Siap dibukukan'], ['REVIEW_REQUIRED', 'Perlu diperiksa'], ['RECONCILIATION_REQUIRED', 'Perlu rekonsiliasi'], ['BLOCKED', 'Ditahan']]);
    if (filter === 'finality') return renderSelect('sourceFinalityStatus', 'Finalitas sumber', [['', 'Semua status'], ['UNVERIFIED', 'Belum diverifikasi'], ['OPEN_UNVERIFIED', 'OPEN belum final'], ['FINALITY_UNPROVEN', 'Finalitas belum terbukti'], ['FINAL_CONFIRMED', 'Final terkonfirmasi']]);
    if (filter === 'sourceStatus') return renderInput('statusSumber', 'Status sumber', 'text', 'OPEN / CLOSED');
    if (filter === 'storage') return renderSelect('bentukSaldo', 'Jenis penyimpanan', [['', 'Kas dan rekening'], ['KAS_TUNAI', 'Kas tunai'], ['REKENING_BANK', 'Rekening bank']]);
    if (filter === 'requestStatus') return renderSelect('status', 'Status request', [['', 'Semua status'], ['REQUESTED', 'Requested'], ['APPROVED', 'Approved'], ['WAITING_TRANSFER', 'Menunggu transfer'], ['COMPLETED', 'Completed'], ['REJECTED', 'Rejected'], ['CANCELLED', 'Cancelled']]);
    if (filter === 'payment') return renderSelect('paymentStatus', 'Status pembayaran', [['', 'Semua status'], ['MENUNGGU_TRANSFER', 'Menunggu transfer'], ['MENUNGGU_APPROVAL', 'Menunggu approval'], ['PAID', 'Paid'], ['REJECTED', 'Rejected']]);
    if (filter === 'journalType') return renderSelect('journalType', 'Jenis pencatatan', [['', 'Semua jenis'], ['SALDO_AWAL', 'Saldo awal'], ['MUTASI', 'Mutasi'], ['PENJUALAN', 'Penjualan'], ['PEMBELIAN', 'Pembelian'], ['OPERASIONAL', 'Operasional'], ['TRANSAKSI', 'Transaksi'], ['PEMBALIKAN', 'Pembalikan']]);
    if (filter === 'account') return renderSelect('accountId', 'Rekening / kas tunai', [['', 'Semua rekening'], ...(reportKey === 'financial' ? financialAccounts : (state.accounts || [])).map((account) => [account.id, accountOptionLabel(account)])]);
    return null;
  };
  const drilldown = (row, categoryCode = '') => {
    const next = { ...filters, view: 'detail', accountId: row.rowType === 'ACCOUNT' ? row.accountId : '', kelompokKasId: row.rowType === 'GROUP' && row.groupId ? row.groupId : filters.kelompokKasId, includeSubgroups: row.rowType === 'GROUP' ? true : filters.includeSubgroups, kategoriKeuangan: categoryCode, detailDirection: '', page: 1 };
    setFilters(next);
  };
  const openFinancialDetail = (row) => setDetail({ ...row, id: row.openingBalanceId || row.transactionId || row.id, isOpeningBalance: Boolean(row.openingBalanceId), transactionDate: row.date, amount: Math.max(Number(row.debit || 0), Number(row.credit || 0)), sourceAccountId: row.accountId, note: row.description, status: 'APPROVED', approvalStatus: 'APPROVED', journalStatus: row.journalStatus || 'POSTED' });
  const summaryAmount = (row, field, categoryCode = '') => <button className="report-number-button" type="button" onClick={() => drilldown(row, categoryCode)}>{formatRupiah(row[field] || 0)}</button>;
  const renderFinancialSummaryRow = (row) => <tr key={row.id || row.key} className={row.rowType === 'GROUP' ? 'report-group-row' : 'report-account-row'}><td><div className="report-hierarchy-label"><strong className="table-primary">{row.rowType === 'GROUP' ? row.label : row.accountName || row.label || row.accountLabel}</strong><small className="table-secondary">{row.rowType === 'GROUP' ? (row.code || row.unit || '-') : (row.accountLabel || '-')}</small></div></td><td>{summaryAmount(row, 'saldoAwal')}</td><td>{summaryAmount(row, 'debet')}</td><td>{summaryAmount(row, 'kredit')}</td><td>{summaryAmount(row, 'saldoAkhir')}</td></tr>;
  const renderTable = () => {
    if (reportKey === 'financial') {
      if (appliedFilters.view === 'summary') {
        const summaryRows = appliedFilters.groupBy === 'CASH_GROUP' ? financialGroupRows : rows;
        return <table><thead><tr><th>Kelompok / Rekening</th><th>Saldo awal</th><th>Debet</th><th>Kredit</th><th>Saldo akhir</th></tr></thead><tbody>{summaryRows.map(renderFinancialSummaryRow)}</tbody></table>;
      }
      return <table><thead><tr><th>Tanggal</th><th>No. Keuangan</th><th>No. Transaksi</th><th>Sumber</th><th>Rekening</th><th>Jenis</th><th>Keterangan</th><th>Debet</th><th>Kredit</th><th>Saldo berjalan</th><th>Aksi</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td><strong className="table-primary">{row.journalNumber}</strong></td><td className="mono">{row.transactionNumber || '-'}</td><td><SourceBadge sourceType={row.source === 'NAGAGOLD' ? 'SYNC_NAGAGOLD' : 'MANUAL_ADMIN'} /></td><td><strong className="table-primary">{row.accountName}</strong><small className="table-secondary">{row.accountNumber}</small></td><td><span className="type-chip">{row.category}</span></td><td>{row.description || '-'}</td><td><strong className="amount-cell">{formatRupiah(row.reportDebit ?? row.debit)}</strong></td><td><strong className="amount-cell">{formatRupiah(row.reportCredit ?? row.credit)}</strong></td><td><strong className="amount-cell">{formatRupiah(row.saldoBerjalan)}</strong></td><td><button className="row-action" type="button" onClick={() => openFinancialDetail(row)}><Eye size={15} />Detail</button></td></tr>)}</tbody></table>;
    }
    if (reportKey === 'nagagold-source') return <table><thead><tr><th>Tanggal sumber</th><th>Cabang</th><th>Referensi</th><th>Jenis / kategori</th><th>Metode</th><th>Masuk</th><th>Keluar</th><th>Finalitas</th><th>Mapping</th><th>Rekonsiliasi</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.sourceDate || row.transactionDate)}</td><td><strong className="table-primary">{row.kodeToko || '-'}</strong></td><td className="mono">{row.noReff || row.sourceTransactionId || '-'}</td><td><span className="type-chip">{row.kategori || row.jenis || '-'}</span><small className="table-secondary">{row.jenis || '-'}</small></td><td>{row.metodePembayaran || '-'}</td><td><strong className="amount-cell">{formatRupiah(row.jumlahIn)}</strong></td><td><strong className="amount-cell">{formatRupiah(row.jumlahOut)}</strong></td><td><span className="journal-mini">{row.finalitas || 'UNVERIFIED'}</span></td><td><Badge status={row.mappingStatus || 'PERLU_PEMETAAN'} /></td><td><span className="journal-mini">{row.rekonsiliasiStatus || 'UNMATCHED'}</span></td><td><button className="row-action" type="button" onClick={() => setDetail({ id: row.id, transactionNumber: row.transactionNumber })}>Detail</button></td></tr>)}</tbody></table>;
    if (reportKey === 'nagagold-cash') return <table><thead><tr><th>Tanggal</th><th>Cabang</th><th>No. referensi</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Uang masuk</th><th>Uang keluar</th><th>Status sumber</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.sourceDate || row.transactionDate)}</td><td><strong className="table-primary">{row.kodeToko || '-'}</strong></td><td className="mono">{row.noReff || row.sourceTransactionId || '-'}</td><td><span className="type-chip">{row.jenis || '-'}</span></td><td>{row.kategori || '-'}</td><td><strong className="table-primary">{row.keterangan || row.deskripsi || '-'}</strong><small className="table-secondary">{row.sourceInvoiceNumbers?.length ? row.sourceInvoiceNumbers.join(', ') : ''}</small></td><td><strong className="amount-cell">{formatRupiah(row.jumlahIn)}</strong></td><td><strong className="amount-cell">{formatRupiah(row.jumlahOut)}</strong></td><td><span className="journal-mini">{row.statusSumber || '-'}</span></td><td><button className="row-action" type="button" onClick={() => setDetail({ id: row.id, transactionNumber: row.transactionNumber })}>Detail</button></td></tr>)}</tbody></table>;
    if (reportKey === 'nagagold-accounts') return <table><thead><tr><th>Tanggal</th><th>Cabang</th><th>Bank</th><th>No. rekening</th><th>No. referensi</th><th>Jenis / kategori</th><th>Keterangan</th><th>Uang masuk</th><th>Uang keluar</th><th>Status sumber</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.sourceDate || row.transactionDate)}</td><td><strong className="table-primary">{row.kodeToko || '-'}</strong></td><td>{row.namaBank || row.kodeBank || '-'}</td><td className="mono">{row.noRekening || '-'}</td><td className="mono">{row.noReff || row.sourceTransactionId || '-'}</td><td><span className="type-chip">{row.kategori || row.jenis || '-'}</span><small className="table-secondary">{row.jenis || '-'}</small></td><td><strong className="table-primary">{row.keterangan || row.deskripsi || '-'}</strong><small className="table-secondary">{row.sourceInvoiceNumbers?.length ? row.sourceInvoiceNumbers.join(', ') : ''}</small></td><td><strong className="amount-cell">{formatRupiah(row.jumlahIn)}</strong></td><td><strong className="amount-cell">{formatRupiah(row.jumlahOut)}</strong></td><td><span className="journal-mini">{row.statusSumber || '-'}</span></td><td><button className="row-action" type="button" onClick={() => setDetail({ id: row.id, transactionNumber: row.transactionNumber })}>Detail</button></td></tr>)}</tbody></table>;
    if (reportKey === 'balances') return <>{groupRows.length > 0 && <section className="group-balance-inline"><div className="table-heading"><div><span className="section-kicker">Konsolidasi kelompok kas</span><h2>Saldo langsung dan saldo konsolidasi</h2></div><span className="count-label">{groupRows.length} kelompok</span></div><div className="table-wrap"><table><thead><tr><th>Kelompok Kas</th><th>Unit</th><th>Saldo langsung</th><th>Saldo konsolidasi</th><th>Jumlah akun langsung</th></tr></thead><tbody>{groupRows.map((group) => <tr key={group.id}><td><strong className="table-primary">{group.namaKelompokKas}</strong><small className="table-secondary">{group.kodeKelompokKas}</small></td><td>{group.unit}</td><td><strong className="amount-cell">{formatRupiah(group.saldoLangsung)}</strong></td><td><strong className="amount-cell">{formatRupiah(group.saldoKonsolidasi)}</strong></td><td>{group.jumlahAkun}</td></tr>)}</tbody></table></div></section>}<table><thead><tr><th>Kode akun</th><th>Kas / rekening</th><th>Unit</th><th>Cabang</th><th>Jenis</th><th>Saldo awal</th><th>Debit</th><th>Kredit</th><th>Saldo akhir</th><th>Selisih</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rekeningId}><td className="mono">{row.kodeAkun}</td><td><strong className="table-primary">{row.namaRekening}</strong></td><td>{row.unit}</td><td>{row.kodeToko || '-'}</td><td><span className="type-chip">{String(row.jenisAkun || '').replaceAll('_', ' ')}</span></td><td>{formatRupiah(row.saldoAwal)}</td><td>{formatRupiah(row.totalDebit)}</td><td>{formatRupiah(row.totalKredit)}</td><td><strong className="amount-cell">{formatRupiah(row.saldoAkhir)}</strong></td><td><Badge status={row.rekonsiliasiSaldo} /></td></tr>)}</tbody></table></>;
    if (reportKey === 'requests') return <table><thead><tr><th>Request ID</th><th>Cabang</th><th>Jenis</th><th>Nominal</th><th>Pengajuan</th><th>Approval</th><th>Pembayaran</th><th>Transfer</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong className="table-primary">{row.requestId}</strong><small className="table-secondary">{row.noRekening || '-'}</small></td><td>{row.kodeToko}</td><td><span className="type-chip">{String(row.jenisRequest || '').replaceAll('_', ' ')}</span></td><td><strong className="amount-cell">{formatRupiah(row.nilaiRp)}</strong></td><td>{formatDate(row.requestedAt, true)}</td><td><Badge status={row.approvalStatus || row.status} /></td><td><Badge status={row.paymentStatus || 'MENUNGGU_TRANSFER'} /></td><td>{row.transferReference || '-'}</td></tr>)}</tbody></table>;
    if (reportKey === 'journals') return <table><thead><tr><th>No. keuangan</th><th>Tanggal</th><th>Jenis</th><th>Status</th><th>Transaksi</th><th>Rekening</th><th>Debet</th><th>Kredit</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong className="table-primary">{row.no_keuangan}</strong></td><td>{formatDate(row.tanggal)}</td><td><span className="type-chip">{humanStatus(row.tipe)}</span></td><td><Badge status={row.status} /></td><td>{row.transaction?.transactionNumber || row.no_transaksi || '-'}</td><td><strong>{row.no_rekening || '-'}</strong><small className="table-secondary">{row.nama_rekening || '-'}</small></td><td>{formatRupiah(row.debet)}</td><td>{formatRupiah(row.kredit)}</td><td><button className="row-action" type="button" onClick={() => row.transaction && setDetail(row.transaction)}>Detail</button></td></tr>)}</tbody></table>;
    if (reportKey === 'reconciliation') return <table><thead><tr><th>Transaksi</th><th>Cabang</th><th>Referensi sumber</th><th>Nominal</th><th>Mapping</th><th>Rekonsiliasi</th><th>Klasifikasi</th><th>Jurnal</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong className="table-primary">{row.transactionNumber}</strong><small className="table-secondary">{row.sourceInvoiceNumbers?.join(', ') || '-'}</small></td><td>{row.kodeToko}</td><td className="mono">{row.sourceNoReff || '-'}</td><td>{formatRupiah(row.amount)}</td><td><Badge status={row.mappingStatus || 'PERLU_PEMETAAN'} /></td><td><Badge status={row.reconciliationStatus || 'UNMATCHED'} /></td><td><Badge status={row.classificationStatus || 'BLOCKED'} /></td><td><Badge status={row.journalStatus || 'BELUM_DIBUAT'} /></td></tr>)}</tbody></table>;
    if (reportKey === 'mutations') return <table><thead><tr><th>Jenis kas asal</th><th>Jenis kas tujuan</th><th>Rekening asal</th><th>Rekening tujuan</th><th>Jumlah mutasi (Rp)</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="type-chip">{String(row.jenisKasAsal || '-').replaceAll('_', ' ')}</span></td><td><span className="type-chip">{String(row.jenisKasTujuan || '-').replaceAll('_', ' ')}</span></td><td>{row.rekeningAsal || '-'}</td><td>{row.rekeningTujuan || '-'}</td><td><strong className="amount-cell">{formatRupiah(row.jumlahMutasi)}</strong></td></tr>)}</tbody></table>;
    return <table><thead><tr><th>Tanggal</th><th>Transaksi</th><th>Sumber</th><th>Cabang</th><th>Jenis</th><th>Referensi</th><th>Nominal monitoring</th><th>Confirmed</th><th>Approval</th><th>Jurnal</th><th>Rekonsiliasi</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.transactionDate)}</td><td><strong className="table-primary">{row.transactionNumber}</strong><small className="table-secondary">{row.postedDate ? 'Posting ' + formatDate(row.postedDate) : 'Belum posting'}</small></td><td><SourceBadge sourceType={row.sourceType} /></td><td>{row.kodeToko || '-'}</td><td><span className="type-chip">{row.jenisTransaksi || '-'}</span></td><td className="mono">{row.sourceNoReff || row.requestId || '-'}</td><td><strong className="amount-cell">{formatRupiah(row.amount)}</strong></td><td>{formatRupiah(row.confirmedAmount)}</td><td><Badge status={row.approvalStatus || row.status} /></td><td><Badge status={row.journalStatus || 'BELUM_DIBUAT'} /></td><td><Badge status={row.reconciliationStatus || 'NOT_APPLICABLE'} /></td><td><button className="row-action" type="button" onClick={() => setDetail(row)}>Detail</button></td></tr>)}</tbody></table>;
  };
  const balanceSummary = reportKey === 'balances' && payload?.summary;
  const displayedReportTitle = appliedFilters.view === 'summary' && reportKey === 'financial' ? 'Rekap' : appliedFilters.view === 'detail' && reportKey === 'financial' ? 'Detail' : config.title;
  return <><PageHeader eyebrow="Laporan" title={config.title} description={config.description} action={<div className="page-actions report-export-actions"><button className="button export-button export-excel" type="button" onClick={() => exportReport(reportKey, appliedFilters, 'xlsx')} disabled={!apiConnected}><FileSpreadsheet size={16} />Export Excel</button><button className="button export-button export-pdf" type="button" onClick={() => exportReport(reportKey, appliedFilters, 'pdf')} disabled={!apiConnected}><FileText size={16} />Export PDF</button></div>} /><div className="report-page-shell">{sourceSummary && <div className="report-summary"><div><span>Uang masuk sumber</span><strong>{formatRupiah(sourceSummary.totalMonitoringIn)}</strong><small>Monitoring tt_cash_daily</small></div><div><span>Uang keluar sumber</span><strong>{formatRupiah(sourceSummary.totalMonitoringOut)}</strong><small>{sourceSummary.totalEvents || 0} event sumber</small></div><div><span>Net confirmed</span><strong>{formatRupiah(sourceSummary.netConfirmed)}</strong><small>{sourceSummary.matchedExcluded || 0} data matched dikecualikan</small></div></div>}{financialSummary && <div className="report-summary financial-summary"><div><span>Saldo awal periode</span><strong>{formatRupiah(financialSummary.saldoAwal)}</strong><small>{appliedFilters.dateFrom}</small></div><div><span>Total debet</span><strong>{formatRupiah(financialSummary.totalDebit)}</strong><small>Transaksi tercatat, tidak termasuk saldo awal</small></div><div><span>Total kredit</span><strong>{formatRupiah(financialSummary.totalKredit)}</strong><small>Transaksi tercatat, tidak termasuk saldo awal</small></div><div><span>Saldo akhir periode</span><strong>{formatRupiah(financialSummary.saldoAkhir)}</strong><small>{appliedFilters.dateTo}</small></div></div>}{financialSummary?.unclassifiedCount > 0 && <div className="info-strip report-warning"><XCircle size={17} /><span>{financialSummary.unclassifiedCount} baris belum terklasifikasi. Nilainya tetap dihitung dalam saldo dan ditampilkan sebagai Koreksi (+/-).</span></div>}{balanceSummary && <div className="report-summary"><div><span>Saldo akhir</span><strong>{formatRupiah(balanceSummary.saldoAkhir)}</strong><small>{balanceSummary.totalAccounts || 0} akun</small></div><div><span>Akun selisih</span><strong>{balanceSummary.selisih || 0}</strong><small>Saldo tersimpan vs jurnal</small></div><div><span>Periode</span><strong>{appliedFilters.dateFrom}</strong><small>s.d. {appliedFilters.dateTo}</small></div></div>}<section className="panel report-workspace"><div className="report-filter-panel report-filter-panel-inline"><div className="report-filter-heading"><div><span className="section-kicker">Filter laporan</span><strong>{config.description}</strong></div><span className="count-label">{loading ? 'Memuat...' : String(total) + ' data'}</span></div><div className="report-filter-grid">{config.filters.flatMap(renderFilter)}<button className="filter-clear" type="button" onClick={reset}><X size={14} />Bersihkan filter</button></div></div><div className="table-heading report-table-heading"><div><span className="section-kicker">{displayedReportTitle}</span><h2>{loading ? 'Memuat laporan...' : String(total) + ' data'}</h2></div><span className="count-label">{(payload?.filters?.dateFrom || appliedFilters.dateFrom) + ' s.d. ' + (payload?.filters?.dateTo || appliedFilters.dateTo)}</span></div>{error && <div className="error-strip"><XCircle size={17} /><span>{error}</span></div>}<div className="table-wrap report-table-wrap">{rows.length ? renderTable() : (!loading && <EmptyState title="Tidak ada data laporan" description="Coba ubah periode atau filter laporan." />)}</div>{totalPages > 1 && <div className="pagination-bar"><button className="button button-secondary" type="button" disabled={appliedFilters.page <= 1} onClick={() => changePage(appliedFilters.page - 1)}>Sebelumnya</button><span>Halaman {appliedFilters.page} dari {totalPages}</span><button className="button button-secondary" type="button" disabled={appliedFilters.page >= totalPages} onClick={() => changePage(appliedFilters.page + 1)}>Berikutnya</button></div>}</section></div></>;
  /*
  return <><PageHeader eyebrow="Laporan" title={config.title} description={config.description} action={<div className="page-actions"><button className="button button-secondary" type="button" onClick={() => exportReport(reportKey, filters, 'xlsx')} disabled={!apiConnected}><FileBarChart2 size={16} />Export Excel</button><button className="button button-secondary" type="button" onClick={() => exportReport(reportKey, filters, 'pdf')} disabled={!apiConnected}>PDF</button></div>} /><div className="report-page-shell">{reportKey === 'financial' && <div className="report-tabs" role="tablist" aria-label="Laporan Kas dan Bank"><button className={filters.view === 'summary' ? 'report-tab active' : 'report-tab'} type="button" role="tab" aria-selected={filters.view === 'summary'} onClick={() => update('view', 'summary')}>REKAP</button><button className={filters.view === 'detail' ? 'report-tab active' : 'report-tab'} type="button" role="tab" aria-selected={filters.view === 'detail'} onClick={() => update('view', 'detail')}>DETAIL</button></div>}{sourceSummary && <div className="report-summary"><div><span>Uang masuk sumber</span><strong>{formatRupiah(sourceSummary.totalMonitoringIn)}</strong><small>Monitoring tt_cash_daily</small></div><div><span>Uang keluar sumber</span><strong>{formatRupiah(sourceSummary.totalMonitoringOut)}</strong><small>{sourceSummary.totalEvents || 0} event sumber</small></div><div><span>Net confirmed</span><strong>{formatRupiah(sourceSummary.netConfirmed)}</strong><small>{sourceSummary.matchedExcluded || 0} data matched dikecualikan</small></div></div>}{financialSummary && <div className="report-summary financial-summary"><div><span>Saldo awal periode</span><strong>{formatRupiah(financialSummary.saldoAwal)}</strong><small>{filters.dateFrom}</small></div><div><span>Total debet</span><strong>{formatRupiah(financialSummary.totalDebit)}</strong><small>Seluruh transaksi POSTED</small></div><div><span>Total kredit</span><strong>{formatRupiah(financialSummary.totalKredit)}</strong><small>Seluruh transaksi POSTED</small></div><div><span>Saldo akhir periode</span><strong>{formatRupiah(financialSummary.saldoAkhir)}</strong><small>{filters.dateTo}</small></div></div>}{financialSummary?.unclassifiedCount > 0 && <div className="info-strip report-warning"><XCircle size={17} /><span>{financialSummary.unclassifiedCount} baris belum terklasifikasi. Nilainya tetap dihitung dalam saldo dan ditampilkan sebagai Koreksi (+/-).</span></div>}{balanceSummary && <div className="report-summary"><div><span>Saldo akhir</span><strong>{formatRupiah(balanceSummary.saldoAkhir)}</strong><small>{balanceSummary.totalAccounts || 0} akun</small></div><div><span>Akun selisih</span><strong>{balanceSummary.selisih || 0}</strong><small>Saldo tersimpan vs jurnal</small></div><div><span>Periode</span><strong>{filters.dateFrom}</strong><small>s.d. {filters.dateTo}</small></div></div>}<section className="panel report-workspace"><div className="report-filter-panel report-filter-panel-inline"><div className="report-filter-heading"><div><span className="section-kicker">Filter laporan</span><strong>{config.description}</strong></div><span className="count-label">{loading ? 'Memuat...' : String(total) + ' data'}</span></div><div className="report-filter-grid">{config.filters.flatMap(renderFilter)}<button className="filter-clear" type="button" onClick={reset}><X size={14} />Bersihkan filter</button></div></div><div className="table-heading report-table-heading"><div><span className="section-kicker">{filters.view === 'summary' && reportKey === 'financial' ? 'Rekap' : filters.view === 'detail' && reportKey === 'financial' ? 'Detail' : config.title}</span><h2>{loading ? 'Memuat laporan...' : String(total) + ' data'}</h2></div><span className="count-label">{(payload?.filters?.dateFrom || filters.dateFrom) + ' s.d. ' + (payload?.filters?.dateTo || filters.dateTo)}</span></div>{error && <div className="error-strip"><XCircle size={17} /><span>{error}</span></div>}<div className="table-wrap report-table-wrap">{rows.length ? renderTable() : (!loading && <EmptyState title="Tidak ada data laporan" description="Coba ubah periode atau filter laporan." />)}</div>{totalPages > 1 && <div className="pagination-bar"><button className="button button-secondary" type="button" disabled={filters.page <= 1} onClick={() => update('page', filters.page - 1)}>Sebelumnya</button><span>Halaman {filters.page} dari {totalPages}</span><button className="button button-secondary" type="button" disabled={filters.page >= totalPages} onClick={() => update('page', filters.page + 1)}>Berikutnya</button></div>}</section></div></>;
}
  */
}

function MiniTree({ accounts }) { return <div className="mini-tree"><TreeNodes accounts={accounts} parentId={null} compact /></div>; }
function TreeNodes({ accounts, parentId, compact = false }) {
  return <>{accounts.filter((item) => (item.parentId || null) === (parentId || null)).map((account) => <div className="tree-node-wrap" key={account.id}><div className={`tree-node ${compact ? 'compact' : ''}`}><span className="tree-chevron">{accounts.some((item) => item.parentId === account.id) ? <ChevronDown size={14} /> : <span />}</span><span className={`tree-symbol ${account.accountType.toLowerCase()}`}>{account.accountType === 'REKENING' ? <CreditCard size={15} /> : account.accountType === 'KAS_KECIL' ? <Store size={15} /> : account.accountType === 'KAS_BESAR' ? <Building2 size={15} /> : <Landmark size={15} />}</span><span className="tree-copy"><strong>{account.name}</strong><small>{account.bankName || account.unitType || ''}</small></span><span className="tree-type">{account.accountType.replace('KAS_', '').replace('REKENING', 'REK')}</span></div><TreeNodes accounts={accounts} parentId={account.id} compact={compact} /></div>)}</>;
}

function Mutations({ transactions, accounts, openCreate, setDetail }) {
  const [dateFrom, setDateFrom] = useState(todayJakarta);
  const [dateTo, setDateTo] = useState(todayJakarta);
  const rows = transactions.filter((item) => {
    if (item.isImported === true || !matchesDateRange(item.transactionDate || item.tanggal || item.date || item.createdAt, dateFrom, dateTo)) return false;
    return String(item.kategoriSistem || item.kategori_sistem || '').toUpperCase() === 'MUTASI'
      || String(item.jenisTransaksi || item.jenis_transaksi || '').toUpperCase() === 'MUTASI'
      || String(item.jenisRequest || item.jenis_request || '').toUpperCase() === 'MUTASI_REKENING'
      || String(item.bentukTransaksi || item.bentuk_transaksi || '').toUpperCase() === 'MUTASI_REKENING'
      || String(item.transactionNumber || item.no_mutasi || '').toUpperCase().startsWith('MTS-');
  });
  return <><PageHeader eyebrow="Transaksi Keuangan" title="Mutasi Rekening / Kas" description="Pindahkan dana antar rekening atau kas melalui satu alur approval dan jurnal yang sama." action={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={16} />Tambah Mutasi</button>} /><div className="info-strip"><ArrowLeftRight size={18} /><span>Pilih sumber dan tujuan secara bertahap. Mutasi langsung memengaruhi saldo dengan jurnal provisional; Owner mengesahkan atau membuat jurnal balik jika ditolak.</span></div><section className="panel table-panel"><DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} /><div className="table-heading"><div><span className="section-kicker">Riwayat mutasi</span><h2>Mutasi rekening dan kas</h2></div><span className="count-label">{rows.length} transaksi</span></div><div className="table-wrap"><table><thead><tr><th>Nomor</th><th>Tanggal</th><th>Dari</th><th>Ke</th><th>Jenis transaksi</th><th>Nominal</th><th>Approval</th><th>Jurnal</th><th /></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong className="table-primary">{item.transactionNumber}</strong><small className="table-secondary">Mutasi internal</small></td><td>{formatDate(item.transactionDate)}</td><td>{accountName(accounts, item.sourceAccountId)}</td><td>{accountName(accounts, item.destinationAccountId)}</td><td>{String(item.jenisTransaksi || '-').replaceAll('_', ' ')}</td><td><strong className="amount-cell">{formatRupiah(item.amount)}</strong></td><td><Badge status={item.approvalStatus || item.status} /></td><td><Badge status={item.journalStatus || 'PROVISIONAL'} /></td><td><button className="row-action" type="button" onClick={() => setDetail(item)}><Eye size={16} />Detail</button></td></tr>)}</tbody></table>{rows.length === 0 && <EmptyState title="Belum ada mutasi" description="Tidak ada mutasi pada rentang tanggal yang dipilih." />}</div></section></>;
}

function MutationModal({ close, onSubmit, accounts, businessTypes, transactionTypes, initialRequest = null, loading = false }) {
  const storageOptions = [{ code: 'REKENING_BANK', label: 'REKENING BANK' }, { code: 'KAS_TUNAI', label: 'TUNAI' }];
  const cashLevelOptions = [{ code: 'KAS_UTAMA', label: 'KAS UTAMA' }, { code: 'KAS_BESAR', label: 'KAS BESAR' }, { code: 'KAS_KECIL', label: 'KAS KECIL' }];
  const activeBusinessTypes = businessTypes.filter((item) => item.isActive !== false);
  const legacyBusinessTypes = [...new Set(accounts.map((item) => String(item.jenisBisnisCode || item.unitType || '').trim().toUpperCase()).filter((code) => code && !['PUSAT', 'BERSAMA'].includes(code)))].map((code) => ({ code, name: code }));
  const businesses = [...activeBusinessTypes, ...legacyBusinessTypes.filter((legacy) => !activeBusinessTypes.some((item) => String(item.code || '').toUpperCase() === legacy.code))];
  const activeTransactionTypes = transactionTypes.filter((item) => item.isActive !== false);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const getStorage = (account) => account.bentukSaldo || (String(account.bankCode || account.bankName || '').toUpperCase() === 'TUNAI' ? 'KAS_TUNAI' : 'REKENING_BANK');
  const getCashLevel = (account) => account.jenisKas || account.posKasType || '';
  const getBusiness = (account) => String(account.jenisBisnisCode || account.unitType || '').toUpperCase();
  const requestAccountNumber = String(initialRequest?.noRekening || initialRequest?.accountNumber || '').trim();
  const requestDestinationCandidates = initialRequest && requestAccountNumber
    ? accounts.filter((account) => account.isActive !== false && String(account.accountNumber || '').trim() === requestAccountNumber)
    : [];
  const presetDestination = requestDestinationCandidates.length === 1 ? requestDestinationCandidates[0] : null;
  const defaultJenisTransaksi = initialRequest?.jenisRequest === 'PEMBAYARAN_BUYBACK'
    ? (activeTransactionTypes.find((item) => item.code === 'PEMBELIAN')?.code || '')
    : (activeTransactionTypes.find((item) => item.code === 'TRANSFER_INTERNAL')?.code || activeTransactionTypes[0]?.code || '');
  const [form, setForm] = useState(() => ({ requestId: initialRequest?.requestId || '', transactionDate: today, sourceStorage: '', sourceCashLevel: '', sourceBusiness: '', sourceAccountId: '', destinationStorage: presetDestination ? getStorage(presetDestination) : '', destinationCashLevel: presetDestination ? getCashLevel(presetDestination) : '', destinationBusiness: presetDestination ? getBusiness(presetDestination) : '', destinationAccountId: presetDestination?.id || '', jenisTransaksi: defaultJenisTransaksi, amount: initialRequest?.nilaiRp || '', transferReference: '', transferProof: '', paymentNote: '', note: initialRequest?.tujuan || '' }));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const businessOptions = (level) => level === 'KAS_UTAMA' ? [{ code: 'PUSAT', name: 'PUSAT' }, { code: 'BERSAMA', name: 'BERSAMA' }] : businesses;
  const matchingAccounts = (side) => accounts.filter((account) => account.isActive !== false && getStorage(account) === form[`${side}Storage`] && getCashLevel(account) === form[`${side}CashLevel`] && getBusiness(account) === String(form[`${side}Business`] || '').toUpperCase() && account.id !== form[side === 'source' ? 'destinationAccountId' : 'sourceAccountId']);
  const sourceAccounts = matchingAccounts('source');
  const destinationAccounts = matchingAccounts('destination').filter((account) => !initialRequest || !requestAccountNumber || String(account.accountNumber || '').trim() === requestAccountNumber);
  const changeSide = (side, key, value) => setForm((current) => ({ ...current, [key]: value, ...(key.endsWith('Storage') ? { [`${side}CashLevel`]: '', [`${side}Business`]: '', [`${side}AccountId`]: '' } : {}), ...(key.endsWith('CashLevel') ? { [`${side}Business`]: '', [`${side}AccountId`]: '' } : {}), ...(key.endsWith('Business') ? { [`${side}AccountId`]: '' } : {}) }));
  const renderSide = (side, title) => {
    const sideAccounts = side === 'source' ? sourceAccounts : destinationAccounts;
    return <div className="mutation-side"><div className="mutation-side-heading"><span className="section-kicker">{side === 'source' ? 'Dana keluar' : 'Dana masuk'}</span><h3>{title}</h3></div><Field label="Bentuk akun"><select required value={form[`${side}Storage`]} onChange={(event) => changeSide(side, `${side}Storage`, event.target.value)}><option value="">Pilih rekening atau tunai</option>{storageOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></Field><Field label="Jenis kas"><select required value={form[`${side}CashLevel`]} onChange={(event) => changeSide(side, `${side}CashLevel`, event.target.value)}><option value="">Pilih jenis kas</option>{cashLevelOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></Field><Field label="Jenis bisnis"><select required value={form[`${side}Business`]} onChange={(event) => changeSide(side, `${side}Business`, event.target.value)} disabled={!form[`${side}CashLevel`]}><option value="">Pilih jenis bisnis</option>{businessOptions(form[`${side}CashLevel`]).map((item) => <option key={item.code} value={item.code}>{item.name || item.code}</option>)}</select></Field><Field label={side === 'source' ? 'Rekening / kas sumber' : 'Rekening / kas tujuan'} full><select required value={form[`${side}AccountId`]} onChange={(event) => update(`${side}AccountId`, event.target.value)} disabled={!form[`${side}Business`]}><option value="">Pilih rekening atau kas</option>{sideAccounts.map((account) => <option key={account.id} value={account.id}>{accountOptionLabel(account)}{account.bankCode ? ` · ${account.bankCode}` : ''}</option>)}</select></Field>{form[`${side}Business`] && sideAccounts.length === 0 && <div className="form-note full">Belum ada rekening atau kas aktif yang sesuai dengan pilihan ini{initialRequest && side === 'destination' ? ` dan nomor rekening ${requestAccountNumber}.` : '.'}</div>}</div>;
  };
  const title = initialRequest ? 'Realisasi Permintaan Dana' : 'Tambah Mutasi Rekening / Kas';
  return <Modal title={title} eyebrow={initialRequest ? 'Realisasi pembayaran' : 'Mutasi internal'} close={close} wide><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>{initialRequest && <><div className="info-strip full"><ReceiptText size={17} /><span><strong>{initialRequest.requestId}</strong> · {initialRequest.kodeToko || '-'} · tujuan rekening {requestAccountNumber || '-'} · {initialRequest.tujuan || '-'}</span></div><Field label="Request ID"><input value={form.requestId} readOnly className="input-readonly" /></Field></>}<div className="mutation-flow">{renderSide('source', 'Sumber mutasi')}<div className="mutation-arrow"><ArrowLeftRight size={22} /></div>{renderSide('destination', 'Tujuan mutasi')}</div><Field label={initialRequest ? 'Tanggal transfer' : 'Tanggal mutasi'}><input type="date" required value={form.transactionDate} onChange={(event) => update('transactionDate', event.target.value)} /></Field><Field label="Jenis transaksi"><select required value={form.jenisTransaksi} onChange={(event) => update('jenisTransaksi', event.target.value)}><option value="">Pilih jenis transaksi</option>{activeTransactionTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></Field>{initialRequest && <Field label="Nomor referensi transfer (opsional)"><input value={form.transferReference} onChange={(event) => update('transferReference', event.target.value.toUpperCase())} placeholder="OPSIONAL" /></Field>}<Field label="Nominal (Rp)"><input required readOnly={Boolean(initialRequest)} type="text" inputMode="numeric" value={formatInputRupiah(form.amount)} onChange={(event) => update('amount', digitsOnly(event.target.value))} placeholder="Rp 0" /></Field>{initialRequest ? <Field label="Catatan realisasi" full><textarea rows="3" value={form.paymentNote} onChange={(event) => update('paymentNote', event.target.value.toUpperCase())} placeholder="OPSIONAL" /></Field> : <Field label="Keterangan (opsional)" full><textarea rows="3" value={form.note} onChange={(event) => update('note', event.target.value.toUpperCase())} placeholder="Masukkan keterangan bila diperlukan" /></Field>}<FormActions close={close} submitLabel={initialRequest ? 'Simpan & Posting Pembayaran' : 'Simpan & Kirim Approval'} /></form></Modal>;
}

function accountName(accounts, id) { return accounts.find((account) => account.id === id)?.name || id || '-'; }
function accountDisplayLabel(accounts, id, fallbackName = '') {
  const account = accounts.find((item) => item.id === id);
  if (!account) return fallbackName ? `- - ${fallbackName}` : '-';
  return `${account.accountNumber || account.kodeAkun || '-'} - ${account.name || fallbackName || '-'}`;
}
function requestDisplayLabel(value) {
  const requestId = String(value || '').trim().toUpperCase();
  return /^RQS-\d{8}-\d{4,}$/.test(requestId) ? requestId : '';
}
function accountOptionLabel(account) { return `${account.kodeAkun || account.accountNumber || '-'} - ${account.name}`; }
function calculateAvailableBalance(accountId, openingBalances = [], transactions = []) {
  const ending = calculateEndingBalance(accountId, openingBalances, transactions);
  return transactions.reduce((balance, item) => {
    const saldoApplied = item.saldoStatus === 'DITERAPKAN' || item.saldo_status === 'DITERAPKAN';
    if (item.sourceAccountId === accountId && item.status === 'PENDING_APPROVAL' && !saldoApplied) return balance - Number(item.amount || 0);
    return balance;
  }, ending);
}
function calculateEndingBalance(accountId, openingBalances = [], transactions = []) {
  const opening = openingBalances
    .filter((item) => item.rekeningId === accountId && ((item.status === 'APPROVED' && item.statusValid !== false) || item.saldoStatus === 'DITERAPKAN' || item.saldo_status === 'DITERAPKAN'))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return transactions.reduce((balance, item) => {
    const saldoApplied = item.saldoStatus === 'DITERAPKAN' || item.saldo_status === 'DITERAPKAN';
    if (item.sourceAccountId === accountId && (item.status === 'APPROVED' || saldoApplied)) return balance - Number(item.amount || 0);
    if (item.destinationAccountId === accountId && (item.status === 'APPROVED' || saldoApplied)) return balance + Number(item.amount || 0);
    return balance;
  }, opening);
}
function displayAccountNumber(value) { return value || '-'; }
function EmptyState({ title, description }) { return <div className="empty-state"><Inbox size={24} /><strong>{title}</strong><span>{description}</span></div>; }

function Modal({ title, eyebrow, close, children, wide = false }) { const displayEyebrow = eyebrow === 'Master rekening' ? 'Master rekening & kas' : eyebrow; return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true"><div className="modal-heading"><div><span className="section-kicker">{displayEyebrow}</span><h2>{title}</h2></div><button className="icon-button" type="button" onClick={close} aria-label="Tutup"><X size={18} /></button></div>{children}</section></div>; }

function RequestModal({ close, onSubmit, requestTypes, accounts, businessTypes, loading = false }) {
  const availableRequestTypes = requestTypes.filter((item) => item.isActive);
  const availableAccounts = accounts.filter((item) => item.isActive !== false);
  const availableBusinessTypes = businessTypes.filter((item) => item.isActive !== false);
  const [form, setForm] = useState({ asalPermintaan: '', jenisRequest: '', kodeToko: '', unitPemohon: '', namaPemohon: '', tujuanAccountId: '', noRekening: '', nilaiRp: '', tujuan: '' });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const selectAccount = (field, accountId) => {
    const account = availableAccounts.find((item) => item.id === accountId);
    if (field === 'tujuanAccountId') update('noRekening', account?.accountNumber || account?.nomorRekening || account?.nomor_rekening || account?.kodeAkun || '');
    update(field, accountId);
  };
  const changeOrigin = (value) => setForm((current) => ({ ...current, asalPermintaan: value, kodeToko: '', unitPemohon: '', tujuanAccountId: '', noRekening: '' }));
  const changeBusiness = (value) => setForm((current) => ({ ...current, unitPemohon: value, tujuanAccountId: '', noRekening: '' }));
  const accountLabel = (account) => `${accountOptionLabel(account)} · ${account.bankCode || 'TUNAI'} · ${account.accountNumber || account.kodeAkun || '-'}`;
  const isBranch = form.asalPermintaan === 'CABANG';
  const destinationAccounts = isBranch ? availableAccounts : availableAccounts.filter((account) => String(account.jenisBisnisCode || account.unitType || '').trim().toUpperCase() === form.unitPemohon);
  return <Modal title="Tambah Permintaan Dana" eyebrow="Permintaan dana" close={close}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
    <Field label="Asal permintaan"><select required value={form.asalPermintaan} onChange={(event) => changeOrigin(event.target.value)}><option value="">Pilih asal permintaan</option><option value="CABANG">CABANG</option><option value="INTERNAL">INTERNAL FINANCE</option></select></Field>
    <Field label="Jenis request"><select required value={form.jenisRequest} onChange={(event) => update('jenisRequest', event.target.value)}><option value="">Pilih jenis request</option>{availableRequestTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></Field>
    {isBranch ? <Field label="Cabang / kode toko"><select required value={form.kodeToko} onChange={(event) => update('kodeToko', event.target.value)}><option value="">Pilih cabang</option>{branchSeed.map((branch) => <option key={branch.code} value={branch.code}>{branch.code} · {branch.name}</option>)}</select></Field> : <><Field label="Unit bisnis pemohon"><select required value={form.unitPemohon} onChange={(event) => changeBusiness(event.target.value)}><option value="">Pilih unit bisnis</option>{availableBusinessTypes.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></Field><Field label="Nama pemohon (opsional)"><input value={form.namaPemohon} onChange={(event) => update('namaPemohon', event.target.value.toUpperCase())} placeholder="Contoh: ADMIN FINANCE" /></Field></>}
    <Field label="Rekening tujuan (uang dikirim ke)"><select required value={form.tujuanAccountId} onChange={(event) => selectAccount('tujuanAccountId', event.target.value)} disabled={!isBranch && !form.unitPemohon}><option value="">{!isBranch && !form.unitPemohon ? 'Pilih unit bisnis terlebih dahulu' : destinationAccounts.length ? 'Pilih rekening atau kas tujuan' : 'Belum ada rekening pada unit ini'}</option>{destinationAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</select></Field>
    <Field label="Nilai request (Rp)"><input required type="text" inputMode="numeric" value={formatInputRupiah(form.nilaiRp)} onChange={(event) => update('nilaiRp', digitsOnly(event.target.value))} placeholder="Rp 0" /></Field>
    <Field label="Tujuan / keterangan" full><textarea required rows="3" value={form.tujuan} onChange={(event) => update('tujuan', event.target.value.toUpperCase())} placeholder="Contoh: PEMBAYARAN BUYBACK" /></Field>
    <FormActions close={close} submitLabel="Simpan Permintaan" />
  </form></Modal>;
}

function TransactionModal({ close, onSubmit, accounts, requests, transactionTypes, requestTypes, initialRequest }) { const availableTransactionTypes = transactionTypes.filter((item) => item.isActive); const availableRequestTypes = requestTypes.filter((item) => item.isActive); const usableAccounts = accounts.filter((account) => account.isActive && (account.accountType === 'REKENING' || account.accountNumber || account.bankId)); const kasBesarIds = new Set(accounts.filter((account) => account.accountType === 'KAS_BESAR').map((account) => account.id)); const kasKecilIds = new Set(accounts.filter((account) => account.accountType === 'KAS_KECIL').map((account) => account.id)); const requestOrigin = String(initialRequest?.asalPermintaan || initialRequest?.asal_permintaan || (initialRequest?.kodeToko ? 'CABANG' : 'INTERNAL')).toUpperCase(); const isInternalRequest = Boolean(initialRequest) && requestOrigin === 'INTERNAL'; const sourceAccounts = isInternalRequest ? usableAccounts : usableAccounts.filter((account) => account.accountType === 'KAS_BESAR' || kasBesarIds.has(account.parentId)); const destinationAccounts = isInternalRequest ? usableAccounts.filter((account) => !initialRequest?.destinationAccountId || account.id === initialRequest.destinationAccountId) : usableAccounts.filter((account) => account.accountType === 'KAS_KECIL' || kasKecilIds.has(account.parentId)); const [form, setForm] = useState({ requestId: initialRequest?.requestId || '', transactionDate: '2026-10-28', transferDate: '2026-10-28', transferReference: '', transferProof: '', paymentNote: '', jenisTransaksi: initialRequest?.jenisRequest === 'PEMBAYARAN_BUYBACK' ? 'PEMBELIAN' : availableTransactionTypes.find((item) => item.code === 'TRANSFER_INTERNAL')?.code || availableTransactionTypes[0]?.code || '', jenisRequest: initialRequest?.jenisRequest || availableRequestTypes.find((item) => item.code === 'TAMBAHAN_OPERASIONAL')?.code || availableRequestTypes[0]?.code || '', kodeToko: initialRequest?.kodeToko || '', sourceAccountId: initialRequest?.sourceAccountId || '', destinationAccountId: initialRequest?.destinationAccountId || '', amount: initialRequest?.nilaiRp || '', note: initialRequest?.tujuan || '' }); const isRequestPayment = Boolean(form.requestId); const update = (key, value) => setForm((current) => ({ ...current, [key]: value })); return <Modal title={isRequestPayment ? 'Realisasi Permintaan Dana' : 'Input Transaksi'} eyebrow="Transfer Rekening" close={close}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><Field label="Berdasarkan request"><select value={form.requestId} disabled={Boolean(initialRequest)} onChange={(event) => { const request = requests.find((item) => item.requestId === event.target.value); update('requestId', event.target.value); if (request) setForm((current) => ({ ...current, jenisRequest: request.jenisRequest, kodeToko: request.kodeToko, sourceAccountId: request.sourceAccountId || '', destinationAccountId: request.destinationAccountId || '', amount: request.nilaiRp, note: request.tujuan })); }}><option value="">Input manual</option>{requests.filter((item) => ['APPROVED', 'WAITING_TRANSFER'].includes(item.status)).map((item) => <option key={item.requestId} value={item.requestId}>{item.requestId} · {item.pemohonLabel || item.kodeToko || 'INTERNAL FINANCE'}</option>)}</select></Field><Field label="Tanggal transfer"><input type="date" required value={form.transactionDate} onChange={(event) => update('transactionDate', event.target.value)} /></Field>{isRequestPayment && <><Field label="Tanggal transfer terealisasi"><input type="date" required value={form.transferDate} onChange={(event) => update('transferDate', event.target.value)} /></Field><Field label="Nomor referensi transfer (opsional)"><input value={form.transferReference} onChange={(event) => update('transferReference', event.target.value)} placeholder="Nomor referensi bank" /></Field><Field label="Catatan realisasi" full><textarea rows="2" value={form.paymentNote} onChange={(event) => update('paymentNote', event.target.value.toUpperCase())} /></Field></>}<Field label="Jenis transaksi"><select value={form.jenisTransaksi} onChange={(event) => update('jenisTransaksi', event.target.value)}>{availableTransactionTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></Field><Field label="Jenis request"><select value={form.jenisRequest} onChange={(event) => update('jenisRequest', event.target.value)}>{availableRequestTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></Field><Field label={isInternalRequest ? 'Rekening / kas sumber' : 'Rekening sumber (Kas Besar)'}><select required value={form.sourceAccountId} onChange={(event) => update('sourceAccountId', event.target.value)}><option value="">Pilih rekening atau kas sumber</option>{sourceAccounts.map((account) => <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>)}</select></Field><Field label={isInternalRequest ? 'Rekening / kas tujuan' : 'Rekening tujuan (Kas Kecil)'}><select required value={form.destinationAccountId} onChange={(event) => update('destinationAccountId', event.target.value)}><option value="">Pilih rekening atau kas tujuan</option>{destinationAccounts.map((account) => <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>)}</select></Field><Field label="Nominal (Rp)"><input required type="text" inputMode="numeric" value={formatInputRupiah(form.amount)} onChange={(event) => update('amount', digitsOnly(event.target.value))} placeholder="Rp 0" /></Field><Field label="Keterangan" full><textarea rows="3" value={form.note} onChange={(event) => update('note', event.target.value.toUpperCase())} /></Field><FormActions close={close} submitLabel={isRequestPayment ? 'Simpan & Posting Pembayaran' : 'Simpan & Kirim Approval'} /></form></Modal>; }

function BranchModal({ close, onSubmit, businessTypes, initialItem, loading = false }) {
  const availableBusinessTypes = businessTypes.filter((item) => item.isActive !== false);
  const [form, setForm] = useState({ id: initialItem?.id || '', kodeToko: initialItem?.kodeToko || '', namaToko: initialItem?.namaToko || '', jenisBisnis: initialItem?.jenisBisnis || '', portal: initialItem?.portal || '', tipeToko: initialItem?.tipeToko || 'OFFLINE', databaseName: initialItem?.databaseName || '' });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title={initialItem ? 'Edit Cabang' : 'Tambah Cabang'} eyebrow="Data cabang sumber" close={close}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><Field label="Kode toko"><input required disabled={Boolean(initialItem)} value={form.kodeToko} onChange={(event) => update('kodeToko', event.target.value.toUpperCase())} placeholder="QBS" /></Field><Field label="Nama toko"><input required value={form.namaToko} onChange={(event) => update('namaToko', event.target.value.toUpperCase())} placeholder="BACKUP SAMBAS #1" /></Field><Field label="Jenis bisnis"><select required value={form.jenisBisnis} onChange={(event) => update('jenisBisnis', event.target.value)}><option value="">Pilih jenis bisnis</option>{availableBusinessTypes.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></Field><Field label="Portal"><input value={form.portal} onChange={(event) => update('portal', event.target.value)} placeholder="https://..." /></Field><Field label="Tipe toko"><input value={form.tipeToko} onChange={(event) => update('tipeToko', event.target.value.toUpperCase())} placeholder="OFFLINE" /></Field><Field label="Nama database" full><input required value={form.databaseName} onChange={(event) => update('databaseName', event.target.value)} placeholder="sambas_qbs_..." /></Field><div className="form-note full">Semua sumber memakai URI cluster dan key dekripsi global dari server/.env.</div><FormActions close={close} submitLabel={initialItem ? 'Simpan Perubahan' : 'Simpan Cabang'} /></form></Modal>;
}


function BankModal({ close, onSubmit, initialItem, loading = false }) {
  const [form, setForm] = useState({ id: initialItem?.id || '', code: initialItem?.code || '', name: initialItem?.name || '' });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title={initialItem ? 'Edit Bank' : 'Tambah Bank'} eyebrow="Master bank" close={close}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><Field label="Kode bank"><input required disabled={Boolean(initialItem?.isSystem)} value={form.code} onChange={(event) => update('code', event.target.value.toUpperCase())} placeholder="BCA" /></Field><Field label="Nama bank"><input required disabled={Boolean(initialItem?.isSystem)} value={form.name} onChange={(event) => update('name', event.target.value.toUpperCase())} placeholder="BANK CENTRAL ASIA" /></Field>{initialItem?.isSystem && <div className="form-note full">Bank TUNAI adalah data sistem dan tidak dapat diedit atau dihapus.</div>}<FormActions close={close} submitLabel={initialItem ? 'Simpan Perubahan' : 'Simpan Bank'} /></form></Modal>;
}

function AccountModal({ close, onSubmit, accounts, banks, businessTypes, initialItem, loading = false }) {
  const cashLevels = [{ code: 'KAS_UTAMA', label: 'KAS UTAMA' }, { code: 'KAS_BESAR', label: 'KAS BESAR' }, { code: 'KAS_KECIL', label: 'KAS KECIL' }];
  const legacyBusinessCodes = [...new Set(accounts.map((item) => String(item.jenisBisnisCode || item.unitType || '').toUpperCase()).filter((code) => ['NAGAGOLD', 'OPTIK'].includes(code)))];
  const initialBusinessCode = String(initialItem?.jenisBisnisCode || initialItem?.unitType || '').toUpperCase();
  const initialBusiness = businessTypes.find((item) => item.id === initialItem?.jenisBisnisId);
  const initialJenisKas = initialItem ? (initialItem.jenisKas || initialItem.posKasType || initialItem.accountType || '') : '';
  const initialUnitType = initialItem ? (initialBusiness?.code || initialBusinessCode || (initialJenisKas === 'KAS_UTAMA' ? 'PUSAT' : '')) : '';
  const [form, setForm] = useState({ id: initialItem?.id || '', kodeAkun: initialItem?.kodeAkun || '', jenisKas: initialJenisKas, jenisBisnisId: initialBusiness?.id || '', unitType: initialUnitType, bentukSaldo: initialItem?.bentukSaldo || 'REKENING_BANK', name: initialItem?.name || '', bankId: initialItem?.bankId || '', accountNumber: initialItem?.accountNumber || '', atasNama: initialItem?.name || '', penanggungJawab: initialItem?.penanggungJawab || '', isActive: initialItem?.isActive !== false });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const changeJenisKas = (jenisKas) => setForm((current) => ({ ...current, jenisKas, jenisBisnisId: '', unitType: '' }));
  const changeBusiness = (value) => {
    if (value === 'PUSAT' || value === 'BERSAMA') return setForm((current) => ({ ...current, jenisBisnisId: '', unitType: value }));
    if (value.startsWith('legacy:')) return setForm((current) => ({ ...current, jenisBisnisId: '', unitType: value.slice(7) }));
    const selected = businessTypes.find((item) => item.id === value);
    setForm((current) => ({ ...current, jenisBisnisId: value, unitType: selected?.code || '' }));
  };
  const changeBentukSaldo = (bentukSaldo) => setForm((current) => ({ ...current, bentukSaldo, bankId: bentukSaldo === 'KAS_TUNAI' ? '' : current.bankId, accountNumber: current.accountNumber }));
  const businessOptions = !form.jenisKas ? [] : form.jenisKas === 'KAS_UTAMA' ? [{ id: 'PUSAT', code: 'PUSAT', name: 'PUSAT / BERSAMA' }, { id: 'BERSAMA', code: 'BERSAMA', name: 'BERSAMA' }] : [...businessTypes.filter((item) => item.isActive !== false), ...legacyBusinessCodes.filter((code) => !businessTypes.some((item) => item.code === code)).map((code) => ({ id: `legacy:${code}`, code, name: `${code} (LEGACY)` }))];
  const businessValue = form.jenisBisnisId || (['PUSAT', 'BERSAMA'].includes(form.unitType) ? form.unitType : businessTypes.some((item) => item.code === form.unitType) ? businessTypes.find((item) => item.code === form.unitType)?.id : form.unitType ? `legacy:${form.unitType}` : '');
  const submit = (event) => { event.preventDefault(); const { atasNama, ...rest } = form; onSubmit({ ...rest, name: atasNama }); };
  return <Modal title={initialItem ? 'Edit Rekening / Kas' : 'Tambah Rekening / Kas'} eyebrow="Master rekening" close={close}><form className="form-grid" onSubmit={submit}>
    <div className="form-note full">Kode akun dibuat otomatis. Pilih Jenis Kas dan Jenis Bisnis langsung pada rekening ini.</div>
    {initialItem && <Field label="Kode akun"><input value={form.kodeAkun} readOnly className="input-readonly" /></Field>}
    <Field label="Jenis Kas"><select required value={form.jenisKas} onChange={(event) => changeJenisKas(event.target.value)}><option value="">Pilih jenis kas</option>{cashLevels.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></Field>
    <Field label="Jenis Bisnis"><select required value={businessValue} onChange={(event) => changeBusiness(event.target.value)}><option value="">Pilih jenis bisnis</option>{businessOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
    <Field label="Jenis penyimpanan"><select required value={form.bentukSaldo} onChange={(event) => changeBentukSaldo(event.target.value)}><option value="REKENING_BANK">REKENING BANK</option><option value="KAS_TUNAI">TUNAI</option></select></Field>
    {form.bentukSaldo === 'REKENING_BANK' && <Field label="Bank"><select required value={form.bankId} onChange={(event) => update('bankId', event.target.value)}><option value="">Pilih bank</option>{banks.filter((bank) => bank.isActive && !bank.isSystem).map((bank) => <option key={bank.id} value={bank.id}>{bank.code} · {bank.name}</option>)}</select></Field>}
    {form.bentukSaldo === 'KAS_TUNAI' && <Field label="Bank"><input value="TUNAI" readOnly className="input-readonly" /></Field>}
    <Field label="Nomor rekening"><input required value={form.accountNumber} onChange={(event) => update('accountNumber', event.target.value.toUpperCase())} placeholder={form.bentukSaldo === 'KAS_TUNAI' ? 'CONTOH: KAS-QBS-01' : 'Masukkan nomor rekening'} /></Field>
    <Field label="Nama rekening"><input required value={form.atasNama} onChange={(event) => update('atasNama', event.target.value.toUpperCase())} placeholder="CONTOH: BCA OPERASIONAL NAGAGOLD" /></Field>
    <Field label="Penanggung jawab"><input value={form.penanggungJawab} onChange={(event) => update('penanggungJawab', event.target.value.toUpperCase())} placeholder="OPSIONAL" /></Field>
    {form.bentukSaldo === 'KAS_TUNAI' && <div className="form-note full">TUNAI dapat digunakan pada Kas Utama, Kas Besar, maupun Kas Kecil. Nomor rekening bank tidak diperlukan.</div>}
    <FormActions close={close} submitLabel={initialItem ? 'Simpan Perubahan' : 'Simpan Rekening'} />
  </form></Modal>;
}

function Field({ label, children, full = false }) {
  if (label === 'Urutan tampilan') return null;
  return <label className={`form-field ${full ? 'full' : ''}`}><span>{label}</span>{children}</label>;
}
function FormActions({ close, submitLabel, loading = false }) { const contextLoading = useContext(ActionLoadingContext); const busy = loading || contextLoading; return <div className="form-actions full"><button className="button button-secondary" type="button" onClick={close} disabled={busy}>Batal</button><button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>{busy ? <Spinner /> : <Check size={16} />}{busy ? 'Menyimpan...' : submitLabel}</button></div>; }

function TransactionDetail({ transaction, accounts, close, onApprove, onReject, onReconcileConfirm, onReconcileReject }) {
  const canApprove = transaction.status === 'PENDING_APPROVAL' || transaction.approvalStatus === 'PENDING' || transaction.approval_status === 'PENDING';
  const reconciliation = transaction.reconciliation || {};
  const isOpeningBalance = Boolean(transaction.isOpeningBalance);
  const isImported = transaction.isImported || transaction.sourceType === 'SYNC' || transaction.source_type === 'SYNC' || transaction.sourceType === 'SYNC_NAGAGOLD' || transaction.source_type === 'SYNC_NAGAGOLD' || transaction.sourceType === 'SYNC_OPTIK' || transaction.source_type === 'SYNC_OPTIK';
  const canReconcile = isImported && reconciliation.status !== 'MATCHED' && reconciliation.status !== 'CONFLICT' && (reconciliation.candidates || []).length > 0;
  if (isOpeningBalance) {
    const saldoStatus = String(transaction.saldoStatus || transaction.saldo_status || (transaction.status === 'APPROVED' ? 'DITERAPKAN' : 'BELUM_DITERAPKAN')).toUpperCase();
    const saldoStatusLabel = { BELUM_DITERAPKAN: 'Belum diterapkan', DITERAPKAN: 'Diterapkan', DIBALIK: 'Dibalik' }[saldoStatus] || saldoStatus;
    const accountId = transaction.rekeningId || transaction.sourceAccountId;
    const account = accounts.find((item) => item.id === accountId);
    const branchLabel = account?.kodeToko || account?.cabangName || account?.unitType || 'PUSAT';
    return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}><aside className="detail-drawer"><div className="drawer-heading"><div><span className="section-kicker">Detail saldo awal</span><h2>SALDO AWAL</h2></div><button className="icon-button" type="button" onClick={close} aria-label="Tutup"><X size={18} /></button></div><div className="drawer-status"><SourceBadge sourceType="MANUAL_ADMIN" /><Badge status={transaction.status} /></div><div className="amount-hero"><span>Nominal saldo awal</span><strong>{formatRupiah(transaction.amount)}</strong><small>{formatDate(transaction.transactionDate)} · Saldo awal rekening</small></div><div className="detail-list"><DetailLine label="Asal transaksi" value="Input Finance" /><DetailLine label="Cabang / unit" value={branchLabel} /><DetailLine label="Jenis transaksi" value="SALDO AWAL" /><DetailLine label="Rekening saldo awal" value={accountDisplayLabel(accounts, accountId)} /><DetailLine label="Status pemrosesan" value={saldoStatusLabel} /><DetailLine label="Approval status" value={humanStatus(transaction.approvalStatusLabel || transaction.approvalStatus || transaction.approval_status || transaction.status)} /><DetailLine label="Keterangan" value={transaction.note || '-'} /></div>{transaction.timeline?.length > 0 && <div className="timeline-section"><span className="section-kicker">Riwayat proses</span><div className="timeline">{transaction.timeline.map((item, index) => <div className="timeline-item" key={`${item.type}-${item.at}-${index}`}><span className="timeline-dot" /><div><strong>{humanTimelineLabel(item.label || item.type)}</strong><small>{formatDate(item.at, true)} · {item.actor || 'System'}</small>{item.note && <span>{item.note}</span>}</div></div>)}</div></div>}{canApprove && <div className="drawer-actions"><button className="button button-reject" type="button" onClick={onReject}><X size={16} />Reject</button><button className="button button-approve" type="button" onClick={onApprove}><Check size={16} />Approve</button></div>}</aside></div>;
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}><aside className="detail-drawer"><div className="drawer-heading"><div><span className="section-kicker">Detail transaksi</span><h2>{transaction.transactionNumber}</h2></div><button className="icon-button" type="button" onClick={close} aria-label="Tutup"><X size={18} /></button></div><div className="drawer-status"><SourceBadge sourceType={getSourceType(transaction)} /><Badge status={transaction.status} /><ProcessingBadge status={transaction.sourceProcessingStatus || transaction.syncStatus || transaction.sync_status || 'TIDAK_BERLAKU'} label={transaction.sourceProcessingStatusLabel} />{isImported && <ClassificationBadge status={transaction.classificationStatus || transaction.classification_status} />}</div><div className="amount-hero"><span>Nominal transaksi</span><strong>{formatRupiah(transaction.amount)}</strong><small>{formatDate(transaction.transactionDate)} · {transaction.bentukTransaksi === 'MUTASI_REKENING' ? 'Mutasi rekening' : 'Transfer rekening'}</small></div><div className="detail-list"><DetailLine label="Asal transaksi" value={humanStatus(transaction.sourceTypeLabel || transaction.sourceType || transaction.source_type)} /><DetailLine label="Cabang" value={`${transaction.kodeToko || '-'} · ${transaction.namaToko || '-'}`} /><DetailLine label="Jenis transaksi" value={humanStatus(transaction.jenisTransaksi)} /><DetailLine label="Jenis request" value={humanStatus(transaction.jenisRequest)} /><DetailLine label="Faktur sumber" value={transaction.sourceInvoiceNumbers?.length ? transaction.sourceInvoiceNumbers.join(', ') : '-'} /><DetailLine label="Metode sumber" value={humanStatus(transaction.sourcePaymentMethod || transaction.source_payment_method)} /><DetailLine label="Akun sumber" value={transaction.sourceAccountName || accountName(accounts, transaction.sourceAccountId)} /><DetailLine label="Akun tujuan" value={transaction.destinationAccountName || accountName(accounts, transaction.destinationAccountId)} /><DetailLine label="Rekening mutasi" value={transaction.rekeningId ? accountDisplayLabel(accounts, transaction.rekeningId) : (transaction.rekeningName || '-')} /><DetailLine label="Status pemrosesan" value={humanStatus(transaction.sourceProcessingStatusLabel || transaction.syncStatusLabel || transaction.syncStatus || transaction.sync_status)} />{isImported && <><DetailLine label="Klasifikasi" value={humanStatus(transaction.classificationStatusLabel || transaction.classificationStatus || transaction.classification_status || 'Belum diklasifikasikan')} /><DetailLine label="Alasan klasifikasi" value={transaction.classificationReason || transaction.classification_reason || '-'} /><DetailLine label="Versi aturan" value={transaction.classificationRuleVersion || transaction.classification_rule_version || '-'} /></>}<DetailLine label="Approval status" value={humanStatus(transaction.approvalStatusLabel || transaction.approvalStatus || transaction.approval_status || transaction.status)} /><DetailLine label="Payment status" value={humanStatus(transaction.paymentStatus || transaction.payment_status || 'TIDAK_BERLAKU')} />{requestDisplayLabel(transaction.requestId) && <DetailLine label="Request ID" value={requestDisplayLabel(transaction.requestId)} />}<DetailLine label="Keterangan" value={transaction.note || '-'} /></div>{isImported && <ProposedJournal proposal={transaction.classificationProposal || transaction.classification_proposal} />}{transaction.sync_message && <div className="detail-note"><strong>Catatan proses</strong><span>{transaction.sync_message}</span></div>}{transaction.classificationReason && <div className="detail-note"><strong>Alasan klasifikasi</strong><span>{transaction.classificationReason}</span></div>}{transaction.reconciliation_note && <div className="detail-note"><strong>Catatan rekonsiliasi</strong><span>{transaction.reconciliation_note}</span></div>}{transaction.reversal && <div className="reversal-box"><ArrowDownLeft size={17} /><span><strong>Jurnal reversal dibuat</strong><small>{formatDate(transaction.reversal.reversalDate)} · {formatRupiah(transaction.reversal.amount)} kembali ke akun sumber</small></span></div>}{isImported && <ReconciliationPanel reconciliation={reconciliation} canReconcile={canReconcile} onConfirm={(candidateId) => onReconcileConfirm?.(transaction.id, candidateId)} onReject={(candidateId) => onReconcileReject?.(transaction.id, candidateId)} />}{transaction.timeline?.length > 0 && <div className="timeline-section"><span className="section-kicker">Riwayat proses</span><div className="timeline">{transaction.timeline.map((item, index) => <div className="timeline-item" key={`${item.type}-${item.at}-${index}`}><span className="timeline-dot" /><div><strong>{humanTimelineLabel(item.label || item.type)}</strong><small>{formatDate(item.at, true)} · {item.actor || 'System'}</small>{item.note && <span>{item.note}</span>}</div></div>)}</div></div>}{canApprove && <div className="drawer-actions"><button className="button button-reject" type="button" onClick={onReject}><X size={16} />Reject</button><button className="button button-approve" type="button" onClick={onApprove}><Check size={16} />Approve</button></div>}</aside></div>;
}

function ReconciliationPanel({ reconciliation, canReconcile, onConfirm, onReject }) {
  const matched = reconciliation.matchedTransaction;
  const statusLabel = reconciliation.status === 'NOT_APPLICABLE' ? 'Tidak perlu rekonsiliasi' : (humanStatus(reconciliation.status) || 'Belum terhubung request');
  const note = reconciliation.status === 'NOT_APPLICABLE' ? 'Transaksi operasional Nagagold tidak memiliki request Finance, sehingga tidak perlu dicari pasangan.' : reconciliation.note;
  return <section className="reconciliation-panel"><div className="timeline-section"><span className="section-kicker">Hubungan request</span><strong className="reconciliation-status">{statusLabel}</strong>{note && <p>{note}</p>}</div>{matched && <div className="reconciliation-pair"><strong>Pasangan transaksi</strong><span>{matched.transactionNumber} · {formatRupiah(matched.amount)}</span><small>{formatDate(matched.transactionDate)} · {matched.kodeToko || '-'}</small></div>}{canReconcile && <div className="reconciliation-candidates"><strong>Kandidat transfer Finance</strong>{reconciliation.candidates.map((candidate) => <div className="reconciliation-candidate" key={candidate.transaction.id}><div><strong>{candidate.transaction.transactionNumber}</strong><span>{formatRupiah(candidate.transaction.amount)} · {formatDate(candidate.transaction.transactionDate)}</span><small>{candidate.transaction.sourceAccountName || '-'} → {candidate.transaction.destinationAccountName || '-'} · skor bukti {candidate.evidence.score}</small></div><div className="reconciliation-actions"><button className="button button-secondary" type="button" onClick={() => onReject(candidate.transaction.id)}>Tolak</button><button className="button button-approve" type="button" onClick={() => onConfirm(candidate.transaction.id)}>Konfirmasi</button></div></div>)}</div>}{!matched && !canReconcile && reconciliation.status !== 'NOT_APPLICABLE' && <p className="form-note">Belum ada pasangan yang dapat dikonfirmasi. Hanya transaksi dengan request_id yang perlu dihubungkan.</p>}</section>;
}
function DetailLine({ label, value }) { return <div className="detail-line"><span>{label}</span><strong>{value}</strong></div>; }

createRoot(document.getElementById('root')).render(<App />);
