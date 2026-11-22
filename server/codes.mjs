// Personal codes are hashed with scrypt + a random salt. Plain codes are never stored.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export function hashCode(code) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(code), salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export function verifyCode(code, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const want = Buffer.from(rec.hash, 'hex');
  const got = scryptSync(String(code), Buffer.from(rec.salt, 'hex'), want.length);
  return timingSafeEqual(want, got);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomId = () => Date.now().toString(36) + randomBytes(4).toString('hex');
