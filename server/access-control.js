export const USER_LEVELS = Object.freeze([
  { code: 'SUPER_USER', name: 'Super User' },
  { code: 'OWNER', name: 'Owner' },
  { code: 'ADMIN', name: 'Admin' },
  { code: 'USER', name: 'User' },
]);

export const USER_MENU_GROUPS = Object.freeze([
  {
    code: 'MENU UTAMA',
    name: 'Menu Utama',
    items: [
      { code: 'dashboard', name: 'Dashboard' },
    ],
  },
  {
    code: 'DATA MASTER',
    name: 'Data Master',
    items: [
      { code: 'business-types', name: 'Master Jenis Bisnis' },
      { code: 'banks', name: 'Master Bank' },
      { code: 'accounts', name: 'Master Rekening & Kas' },
      { code: 'transaction-types', name: 'Master Jenis Transaksi' },
      { code: 'branches', name: 'Master Cabang' },
    ],
  },
  {
    code: 'TRANSAKSI',
    name: 'Transaksi',
    items: [
      { code: 'verification', name: 'Approval Center' },
      { code: 'requests', name: 'Permintaan Dana' },
      { code: 'mutations', name: 'Mutasi Rekening / Kas' },
      { code: 'manual-transactions', name: 'Transaksi Manual' },
      { code: 'period-close', name: 'Tutup Periode' },
    ],
  },
  {
    code: 'INTEGRASI NAGAGOLD',
    name: 'Integrasi Nagagold',
    items: [
      { code: 'nagagold-transactions', name: 'Transaksi Terintegrasi' },
      { code: 'nagagold-mapping', name: 'Mapping Nagagold' },
    ],
  },
  {
    code: 'LAPORAN',
    name: 'Laporan',
    items: [
      { code: 'reports-financial', name: 'Laporan Kas & Bank' },
      { code: 'reports-mutations', name: 'Laporan Mutasi Kas' },
    ],
  },
  {
    code: 'USER',
    name: 'User',
    items: [
      { code: 'users-data', name: 'Data User' },
      { code: 'users-manage', name: 'Manage User' },
    ],
  },
  {
    code: 'PENUTUPAN',
    name: 'Penutupan',
    items: [
      { code: 'period-close', name: 'Tutup Periode' },
    ],
  },
]);

export const USER_MENU_IDS = Object.freeze(USER_MENU_GROUPS.flatMap((group) => group.items.map((item) => item.code)));

export function defaultMenuIds() {
  return [...USER_MENU_IDS];
}

export function menuGroupsPayload() {
  return USER_MENU_GROUPS.map((group) => ({
    code: group.code,
    name: group.name,
    items: group.items.map((item) => ({ ...item })),
  }));
}

export function normalizeMenuIds(value) {
  const selected = Array.isArray(value) ? value.map((item) => String(item)) : [];
  return [...new Set(selected.filter((item) => USER_MENU_IDS.includes(item)))];
}
