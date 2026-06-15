import bcryptjs from 'bcryptjs';
import pool, { initializeDatabase } from '../server/db.js';

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('Usage: node scripts/resetPassword.js <username> <new-password>');
  process.exit(1);
}

await initializeDatabase();

const hash = await bcryptjs.hash(password, 10);
const result = await pool.query(
  'UPDATE users SET password_hash = $1 WHERE username = $2',
  [hash, username]
);

if (result?.info?.changes === 0 || result?.rowCount === 0) {
  console.error(`No user found for username: ${username}`);
  await pool.close();
  process.exit(1);
}

console.log(`Password reset for ${username}`);
await pool.close();
