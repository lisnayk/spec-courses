# Спецкурси ПІ

Драбина спецкурсів за вибором (блоки вільного вибору в межах спеціальності, ВКС/ВСС) для ОП «Програмна інженерія», бакалавр. Рядки — навчальні плани за роком вступу, стовпці — навчальні роки, починаючи з поточного.

- Перегляд, редагування дисциплін, викладачів і ID курсів у Moodle прямо на сторінці.
- Вивантаження в Excel.
- Дані зберігаються у [`data/courses.json`](data/courses.json) у цьому репозиторії. Кожне збереження на сайті — окремий коміт, тож будь-яку зміну видно в історії й можна відкотити.

## Як це влаштовано

| Файл | Призначення |
|---|---|
| `index.html` | Уся сторінка (без збирання). |
| `api/data.js` | Serverless-функція Vercel: `GET` віддає дані, `POST` застосовує одну зміну й комітить `data/courses.json` через GitHub API. |
| `lib/store.js` | Перевірка даних і операції `setSlot`, `deleteSlot`, `setPlan`. |
| `dev-server.mjs` | Локальний сервер з тим самим API, пише одразу у файл. |
| `vercel.json` | Не перебудовує сайт, якщо в коміті змінились лише дані. |
| `plans/*.pdf` | Навчальні плани у PDF. Посилання задається полем `pdf` плану в `data/courses.json`. |

Редагувати може будь-хто з посиланням. Захист від псування — перевірка формату на сервері та історія комітів.

## Локальний запуск

```bash
npm run dev
```

Сторінка відкриється на http://localhost:3000. Зміни пишуться в `data/courses.json` локально, без комітів.

## Розгортання на Vercel (безкоштовно)

1. **Токен GitHub.** GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token:
   - Repository access: *Only select repositories* → `spec-courses`;
   - Permissions → Repository → **Contents: Read and write**.
2. **Проєкт Vercel.** [vercel.com/new](https://vercel.com/new) → увійти через GitHub → Import `spec-courses`. Framework preset: *Other*, решту не змінювати.
3. **Змінні середовища** (Project → Settings → Environment Variables):

   | Назва | Значення |
   |---|---|
   | `GITHUB_TOKEN` | токен з кроку 1 |
   | `GITHUB_REPO` | `lisnayk/spec-courses` |
   | `GITHUB_BRANCH` | `main` (необовʼязково) |

4. **Redeploy** після додавання змінних. Сайт буде доступний за адресою `https://<назва-проєкту>.vercel.app`.

## Відкат зміни

Знайдіть потрібний коміт в [історії `data/courses.json`](https://github.com/lisnayk/spec-courses/commits/main/data/courses.json) і зробіть `git revert <коміт>` або відредагуйте файл на GitHub.
