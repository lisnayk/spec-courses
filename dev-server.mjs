// Local dev server: serves the page and the same /api/data contract,
// storing changes straight in data/courses.json instead of committing to GitHub.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { applyOp, ValidationError } from './lib/store.js';

const PORT = Number(process.env.PORT) || 3000;
const DATA = new URL('./data/courses.json', import.meta.url);
const INDEX = new URL('./index.html', import.meta.url);

// Sign-in simulation: DEV_LOGIN unset — no sign-in (anyone edits, as on the site without OAuth);
// DEV_LOGIN=- — sign-in required but nobody signed in (read-only); DEV_LOGIN=<login> — signed in as <login>.
const DEV_LOGIN = (process.env.DEV_LOGIN || '').trim();
const devUser = DEV_LOGIN && DEV_LOGIN !== '-' ? { login: DEV_LOGIN, name: '', avatar: '' } : null;
function devMe() {
  return { authEnabled: Boolean(DEV_LOGIN), user: devUser, canEdit: !DEV_LOGIN || Boolean(devUser) };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/data' && req.method === 'GET') {
      return send(res, 200, await readFile(DATA, 'utf8'));
    }
    if (pathname === '/api/me') return send(res, 200, devMe());
    if (pathname === '/api/data' && req.method === 'POST') {
      if (!devMe().canEdit) return send(res, 401, { error: 'Увійдіть через GitHub, щоб редагувати.' });
      const data = JSON.parse(await readFile(DATA, 'utf8'));
      const { data: next, message } = applyOp(data, JSON.parse(await readBody(req)));
      await writeFile(DATA, JSON.stringify(next, null, 2) + '\n');
      console.log('saved:', message + (devUser ? ` — @${devUser.login}` : ''));
      return send(res, 200, next);
    }
    if (pathname === '/' || pathname === '/index.html') {
      return send(res, 200, await readFile(INDEX, 'utf8'), 'text/html; charset=utf-8');
    }
    if (/^\/plans\/[A-Za-z0-9._-]+\.pdf$/.test(pathname)) {
      const pdf = await readFile(new URL('.' + pathname, import.meta.url)).catch(() => null);
      if (pdf) {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        return res.end(pdf);
      }
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof ValidationError) return send(res, 400, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Internal error' });
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
