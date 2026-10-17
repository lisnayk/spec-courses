// GET /api/auth/callback — GitHub returns here; we read the visitor's public profile and set a signed session cookie.
import {
  authConfig, canEdit, cookie, makeSession, origin, parseCookies, COOKIE, STATE_COOKIE, MAX_AGE,
} from '../../lib/auth.js';

function back(req, res, cookies, hash = '') {
  res.statusCode = 302;
  res.setHeader('Set-Cookie', cookies);
  res.setHeader('Location', `${origin(req)}/${hash}`);
  res.end();
}

export default async function handler(req, res) {
  const cfg = authConfig();
  const clearState = cookie(req, STATE_COOKIE, '', 0);
  if (!cfg.enabled) return back(req, res, [clearState]);

  const params = new URL(req.url, 'http://localhost').searchParams;
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || state !== parseCookies(req)[STATE_COOKIE]) return back(req, res, [clearState], '#login-failed');

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: `${origin(req)}/api/auth/callback`,
      }),
    });
    const { access_token: token } = await tokenRes.json();
    if (!token) return back(req, res, [clearState], '#login-failed');

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'spec-courses' },
    });
    if (!userRes.ok) return back(req, res, [clearState], '#login-failed');
    const u = await userRes.json();
    // The visitor's GitHub token is not stored anywhere.
    if (!canEdit(cfg, u.login)) return back(req, res, [clearState], '#not-editor');

    const session = makeSession(cfg.secret, { login: u.login, name: u.name || '', avatar: u.avatar_url || '' });
    return back(req, res, [clearState, cookie(req, COOKIE, session, MAX_AGE)]);
  } catch (err) {
    console.error(err);
    return back(req, res, [clearState], '#login-failed');
  }
}
