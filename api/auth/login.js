// GET /api/auth/login — redirect to GitHub sign-in (no scopes: public profile only).
import crypto from 'node:crypto';
import { authConfig, cookie, origin, STATE_COOKIE } from '../../lib/auth.js';

export default function handler(req, res) {
  const cfg = authConfig();
  if (!cfg.enabled) {
    res.statusCode = 404;
    return res.end('Вхід через GitHub не налаштовано');
  }
  const state = crypto.randomBytes(16).toString('hex');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', `${origin(req)}/api/auth/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  res.statusCode = 302;
  res.setHeader('Set-Cookie', cookie(req, STATE_COOKIE, state, 600));
  res.setHeader('Location', url.toString());
  res.end();
}
