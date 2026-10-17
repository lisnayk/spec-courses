// GET /api/auth/logout — forget the session.
import { cookie, origin, COOKIE } from '../../lib/auth.js';

export default function handler(req, res) {
  res.statusCode = 302;
  res.setHeader('Set-Cookie', cookie(req, COOKIE, '', 0));
  res.setHeader('Location', `${origin(req)}/`);
  res.end();
}
