import 'dotenv/config';
import mongoose from 'mongoose';
import { hashPassword, seedUsers } from './auth.js';
import { User } from './models.js';

async function seed() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI belum diisi.');
  const users = seedUsers();
  const invalid = users.find((user) => !user.username || !user.password);
  if (invalid) throw new Error('AUTH_SUPER_USERNAME dan AUTH_SUPER_PASSWORD wajib diisi di server/.env.');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  for (const user of users) {
    await User.updateOne(
      { username: user.username },
      { $set: { nama_user: user.name, role: user.role, password_hash: hashPassword(user.password), aktif: true } },
      { upsert: true },
    );
    console.log(`User ${user.username} (${user.role}) berhasil di-seed.`);
  }
}

seed()
  .then(async () => { await mongoose.disconnect(); })
  .catch(async (error) => { console.error(error.message); await mongoose.disconnect(); process.exitCode = 1; });
