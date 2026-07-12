import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(password, salt, 64);
  return `${salt}:${buf.toString('hex')}`;
}

export async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  const buf = await scryptAsync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (buf.length !== keyBuf.length) return false;
  return timingSafeEqual(buf, keyBuf);
}
