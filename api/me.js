// GET /api/me — is sign-in required, who is signed in, may they edit.
import { authConfig, canEdit, currentUser } from '../lib/auth.js';

export default function handler(req, res) {
  const cfg = authConfig();
  const user = currentUser(req, cfg);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify({
    authEnabled: cfg.enabled,
    user: user ? { login: user.login, name: user.name, avatar: user.avatar } : null,
    canEdit: !cfg.enabled || Boolean(user && canEdit(cfg, user.login)),
  }));
}
