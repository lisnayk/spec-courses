// Sign-in with GitHub is used only to know WHO edits: commits are still made with the site's own token,
// and the editor's login is written into the commit message. No GitHub token of the visitor is kept.
import crypto from 'node:crypto';

const COOKIE = 'sc_session';
const STATE_COOKIE = 'sc_oauth';
const MAX_AGE = 60 * 60 * 8; // 8 hours: both the cookie lifetime and the signed exp

export function authConfig() {
  const clientId = (process.env.GITHUB_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GITHUB_CLIENT_SECRET || '').trim();
  const secret = (process.env.SESSION_SECRET || '').trim();
  const editors = (process.env.EDITORS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { enabled: Boolean(clientId && clientSecret && secret), clientId, clientSecret, secret, editors };
}

export function canEdit(cfg, login) {
  return !cfg.editors.length || cfg.editors.includes(String(login || '').toLowerCase());
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sign(secret, data) {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}

export function makeSession(secret, user) {
  const payload = b64url(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return `${payload}.${sign(secret, payload)}`;
}

export function readSession(secret, token) {
  if (!secret || !token || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  const expected = sign(secret, payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').includes('https');
}

export function cookie(req, name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    isHttps(req) ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function currentUser(req, cfg = authConfig()) {
  if (!cfg.enabled) return null;
  return readSession(cfg.secret, parseCookies(req)[COOKIE]);
}

export function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}

// Text appended to the commit: who made the change.
export function authorSuffix(user) {
  return user ? ` — @${user.login}` : '';
}
export function authorTrailer(user) {
  return user ? `\n\nАвтор зміни: ${user.name || user.login} (https://github.com/${user.login})` : '';
}

export { COOKIE, STATE_COOKIE, MAX_AGE };
