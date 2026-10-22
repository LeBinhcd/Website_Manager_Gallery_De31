import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'gallery_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getSessionId(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
  return cookies[SESSION_COOKIE];
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [, salt, expectedHex] = String(stored).split(':');
  if (!salt || !expectedHex) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export async function createSession(user) {
  const sid = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await query('INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)', [sid, JSON.stringify({ user }), expires]);
  return { sid, expires };
}

export async function loadSession(req) {
  const sid = getSessionId(req);
  if (!sid) return null;
  const rows = await query('SELECT sid, data, expires_at FROM sessions WHERE sid = ? AND expires_at > UTC_TIMESTAMP()', [sid]);
  if (!rows.length) return null;
  try { return { sid, ...JSON.parse(rows[0].data) }; } catch { return null; }
}

export async function destroySession(req) {
  const sid = getSessionId(req);
  if (sid) await query('DELETE FROM sessions WHERE sid = ?', [sid]);
}

export function setSessionCookie(res, sid, expires) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function requireAuth(req, res, next) {
  try {
    req.session = await loadSession(req);
    if (!req.session?.user) return res.status(401).json({ error: 'authentication_required' });
    next();
  } catch (error) { next(error); }
}

export function publicUser(user) {
  return { id: user.id, username: user.username, userCode: String(user.user_code).padStart(4, '0'), userTag: `${user.username}#${String(user.user_code).padStart(4, '0')}`, role: user.role };
}
