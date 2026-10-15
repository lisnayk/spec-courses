// Vercel serverless function: reads and writes data/courses.json in the GitHub repo.
// GET  /api/data -> current document
// POST /api/data -> { type: 'setSlot' | 'deleteSlot' | 'setPlan', ... } -> new document (one commit per change)
import { applyOp, ValidationError } from '../lib/store.js';

const GITHUB_API = 'https://api.github.com';
const MAX_BODY = 50_000;

class GitHubError extends Error {
  constructor(action, status) {
    super(`GitHub ${action} failed: ${status}`);
    this.status = status;
  }
}

// Turns a GitHub status into a hint the site owner can act on (no secrets in it).
function githubHint(status) {
  if (status === 401) return 'GitHub відхилив токен: перевірте GITHUB_TOKEN (недійсний або прострочений).';
  if (status === 403) return 'Токену GitHub бракує прав: потрібен доступ Contents: Read and write до репозиторію.';
  if (status === 404) return 'Репозиторій або файл не знайдено: перевірте GITHUB_REPO, GITHUB_BRANCH і доступ токена до репозиторію.';
  return `GitHub повернув помилку ${status}.`;
}

function config() {
  return {
    token: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || 'main',
    path: process.env.DATA_PATH || 'data/courses.json',
  };
}

function github(cfg, url, init = {}) {
  return fetch(GITHUB_API + url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'spec-courses',
      ...(init.headers || {}),
    },
  });
}

function contentsUrl(cfg) {
  const path = cfg.path.split('/').map(encodeURIComponent).join('/');
  return `/repos/${cfg.repo}/contents/${path}`;
}

async function readDocument(cfg) {
  const res = await github(cfg, `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (!res.ok) throw new GitHubError('read', res.status);
  const file = await res.json();
  const json = Buffer.from(file.content, 'base64').toString('utf8');
  return { data: JSON.parse(json), sha: file.sha };
}

// Returns false when the file changed since it was read (sha mismatch).
async function writeDocument(cfg, data, sha, message) {
  const res = await github(cfg, contentsUrl(cfg), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      branch: cfg.branch,
      sha,
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
    }),
  });
  if (res.status === 409 || res.status === 422) return false;
  if (!res.ok) throw new GitHubError('write', res.status);
  return true;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const cfg = config();
  if (!cfg.token || !cfg.repo) {
    return send(res, 500, { error: 'Сервер не налаштовано: задайте GITHUB_TOKEN і GITHUB_REPO.' });
  }

  try {
    if (req.method === 'GET') {
      const { data } = await readDocument(cfg);
      return send(res, 200, data);
    }

    if (req.method === 'POST') {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      if (raw.length > MAX_BODY) return send(res, 413, { error: 'Запит завеликий' });
      const op = JSON.parse(raw);

      // Optimistic locking: re-read and re-apply if someone committed in between.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, sha } = await readDocument(cfg);
        const { data: next, message } = applyOp(data, op);
        if (await writeDocument(cfg, next, sha, message)) return send(res, 200, next);
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
      }
      return send(res, 409, { error: 'Дані щойно змінив хтось інший. Спробуйте ще раз.' });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Метод не підтримується' });
  } catch (err) {
    if (err instanceof ValidationError) return send(res, 400, { error: err.message });
    if (err instanceof SyntaxError) return send(res, 400, { error: 'Некоректний JSON' });
    console.error(err);
    if (err instanceof GitHubError) {
      return send(res, 502, { error: 'Не вдалося звернутися до сховища даних.', detail: githubHint(err.status) });
    }
    return send(res, 502, { error: 'Не вдалося звернутися до сховища даних.' });
  }
}
