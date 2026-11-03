import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${derivedKey}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, salt, expectedHex] = String(storedHash || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = crypto.scryptSync(String(password || ''), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function seedUsers(env = process.env) {
  return [{
    username: String(env.AUTH_SUPER_USERNAME || '').trim().toLowerCase(),
    password: String(env.AUTH_SUPER_PASSWORD || ''),
    name: String(env.AUTH_SUPER_NAME || 'Super User Finance').trim(),
    role: 'SUPER_USER',
  }];
}

export function publicUser(user) {
  return {
    id: user?._id ? user._id.toString() : '',
    username: user?.username || '',
    name: user?.nama_user || user?.name || '',
    role: user?.role || '',
    active: user?.aktif !== false,
    lastLogin: user?.terakhir_login || null,
  };
}
