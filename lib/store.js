// Validation and mutations for data/courses.json.
// Shared by the Vercel function (api/data.js) and the local dev server.

export const STATUSES = ['approved', 'ok', 'warn', 'missing', 'draft', 'planned'];

// Plan ids: p<year> for bachelor, m<year> for master. A slot id starts with its plan id.
const LEVELS = {
  p: { name: 'бакалавр', courses: 4, sems: 8, program: 'Програмна інженерія' },
  m: { name: 'магістр', courses: 2, sems: 3, program: 'Інженерія програмного забезпечення' },
};
const PLAN_ID = /^([pm])(\d{4})$/;
const SLOT_ID = /^([pm])(\d{4})-s([1-9]|1[0-2])-[a-z0-9]{1,16}$/;
const MOODLE_ID = /^\d{0,10}$/;
// Per-discipline traffic light shown as the colour of its left line on the site.
const OPTION_STATES = ['green', 'yellow', 'red'];
const PLAN_PDF = /^(plans\/[A-Za-z0-9._-]+\.pdf)?$/;
const MAX_SLOTS = 2000;
const MAX_OPTIONS = 20;

// Full curriculum of a plan: educational components and prerequisite links between them.
export const CYCLES = ['zp', 'pps', 'ppop', 'vsu', 'vss'];
const CONTROLS = ['exam', 'credit'];
const WORKS = ['project', 'paper'];
const COMPONENT_CODE = /^[А-ЯІЇЄҐA-Z]{1,6} \d{1,3}$/u;
const MAX_COMPONENTS = 150;
const MAX_LINKS = 600;

export class ValidationError extends Error {}

function text(value, max, field) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new ValidationError(`${field}: очікується рядок`);
  const s = value.trim();
  if (s.length > max) throw new ValidationError(`${field}: не довше ${max} символів`);
  return s;
}

function int(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field}: ціле число від ${min} до ${max}`);
  }
  return value;
}

function normSubject(t) {
  return String(t || '').toLowerCase().replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
}

function plural(n, one, few, many) {
  const m = n % 10, mm = n % 100;
  return m === 1 && mm !== 11 ? one : m >= 2 && m <= 4 && (mm < 10 || mm >= 20) ? few : many;
}

function planLabel(id, year) {
  return `план ${year}${id[0] === 'm' ? ', магістр' : ''}`;
}

export function cleanPlan(id, plan) {
  const m = PLAN_ID.exec(id || '');
  if (!m) throw new ValidationError('Некоректний ідентифікатор плану');
  if (!plan || typeof plan !== 'object') throw new ValidationError('Порожні дані плану');
  const defaults = LEVELS[m[1]];
  const year = int(plan.year, 2000, 2100, 'Рік вступу');
  if (year !== Number(m[2])) throw new ValidationError('Рік плану не збігається з ідентифікатором');
  const pdf = text(plan.pdf, 120, 'PDF');
  if (!PLAN_PDF.test(pdf)) throw new ValidationError('PDF: очікується шлях виду plans/<файл>.pdf');
  return {
    year,
    code: text(plan.code, 40, 'Шифр'),
    note: text(plan.note, 300, 'Примітка'),
    pdf,
    level: m[1] === 'm' ? 'master' : 'bachelor',
    courses: plan.courses == null ? defaults.courses : int(plan.courses, 1, 6, 'Кількість курсів'),
    sems: plan.sems == null ? defaults.sems : int(plan.sems, 1, 12, 'Кількість семестрів'),
    program: text(plan.program, 120, 'Освітня програма') || defaults.program,
  };
}

export function cleanSlot(id, slot, data) {
  const m = SLOT_ID.exec(id || '');
  if (!m) throw new ValidationError('Некоректний ідентифікатор блоку');
  if (!slot || typeof slot !== 'object') throw new ValidationError('Порожні дані блоку');
  const plan = int(slot.plan, 2000, 2100, 'План');
  const sem = int(slot.sem, 1, 12, 'Семестр');
  if (plan !== Number(m[2]) || sem !== Number(m[3])) {
    throw new ValidationError('План або семестр не збігаються з ідентифікатором блоку');
  }
  const owner = data.plans[m[1] + plan];
  if (!owner) throw new ValidationError(`Плану ${plan} (${LEVELS[m[1]].name}) не існує`);
  const maxSem = owner.sems || LEVELS[m[1]].sems;
  if (sem > maxSem) throw new ValidationError(`Семестр ${sem} поза межами плану (семестрів у плані: ${maxSem})`);
  let credits = null;
  if (slot.credits != null && slot.credits !== '') credits = int(slot.credits, 0, 30, 'Кредити');
  const status = STATUSES.includes(slot.status) ? slot.status : 'planned';
  if (!Array.isArray(slot.options)) throw new ValidationError('Дисципліни: очікується список');
  if (slot.options.length > MAX_OPTIONS) throw new ValidationError(`Не більше ${MAX_OPTIONS} дисциплін у блоці`);
  const options = slot.options
    .map((o, i) => {
      const n = i + 1;
      const moodle = text(o && o.moodle != null ? String(o.moodle) : '', 10, `ID у Moodle ${n}`);
      if (!MOODLE_ID.test(moodle)) throw new ValidationError(`ID у Moodle ${n}: лише цифри`);
      return {
        subject: text(o && o.subject, 200, `Дисципліна ${n}`),
        teacher: text(o && o.teacher, 200, `Викладач ${n}`),
        moodle,
        state: o && OPTION_STATES.includes(o.state) ? o.state : '',
      };
    })
    .filter((o) => o.subject);
  return {
    plan,
    sem,
    order: Number.isInteger(slot.order) ? slot.order : 0,
    label: text(slot.label, 40, 'Блок') || 'Блок',
    credits,
    status,
    options,
  };
}

function normCode(value, field) {
  const s = text(value, 16, field).replace(/\s+/g, ' ');
  if (!COMPONENT_CODE.test(s)) throw new ValidationError(`${field}: шифр виду «ППС 7»`);
  return s;
}

function curriculumPlan(id, data) {
  const m = PLAN_ID.exec(id || '');
  if (!m || !data.plans[id]) throw new ValidationError('Навчального плану не знайдено');
  return { year: Number(m[2]), sems: data.plans[id].sems || LEVELS[m[1]].sems };
}

export function cleanComponents(planId, list, data) {
  const { sems } = curriculumPlan(planId, data);
  if (!Array.isArray(list)) throw new ValidationError('Освітні компоненти: очікується список');
  if (list.length > MAX_COMPONENTS) throw new ValidationError(`Не більше ${MAX_COMPONENTS} освітніх компонентів`);
  const seen = new Set();
  return list.map((c, i) => {
    const n = i + 1;
    if (!c || typeof c !== 'object') throw new ValidationError(`Компонент ${n}: порожні дані`);
    const code = normCode(c.code, `Шифр компонента ${n}`);
    if (seen.has(code)) throw new ValidationError(`Шифр ${code} повторюється`);
    seen.add(code);
    if (!CYCLES.includes(c.cycle)) throw new ValidationError(`${code}: невідомий цикл`);
    if (!Array.isArray(c.parts) || !c.parts.length || c.parts.length > 12) {
      throw new ValidationError(`${code}: від 1 до 12 семестрів`);
    }
    const parts = c.parts.map((p, j) => {
      if (!p || typeof p !== 'object') throw new ValidationError(`${code}: порожній семестр`);
      const sem = int(p.sem, 1, sems, `${code}: семестр`);
      let credits = null;
      if (p.credits != null && p.credits !== '') {
        credits = Number(p.credits);
        if (!Number.isFinite(credits) || credits < 0 || credits > 60 || Math.round(credits * 2) !== credits * 2) {
          throw new ValidationError(`${code}: кредити — число від 0 до 60 (крок 0,5)`);
        }
      }
      const part = { sem, credits, control: CONTROLS.includes(p.control) ? p.control : '' };
      if (WORKS.includes(p.work)) part.work = p.work;
      if (j && sem <= c.parts[j - 1].sem) throw new ValidationError(`${code}: семестри мають іти за зростанням`);
      return part;
    });
    const out = { code, name: text(c.name, 200, `${code}: назва`), cycle: c.cycle, parts };
    if (c.slot != null && c.slot !== '') {
      if (typeof c.slot !== 'string' || !c.slot.startsWith(planId + '-s') || !data.slots[c.slot]) {
        throw new ValidationError(`${code}: блок спецкурсів ${c.slot} не знайдено в цьому плані`);
      }
      out.slot = c.slot;
    }
    return out;
  });
}

function firstSem(c) { return c.parts[0].sem; }
function lastSem(c) { return c.parts[c.parts.length - 1].sem; }

// Checks one link against the plan's components; `links` are the other links (to detect cycles).
function checkLink(from, to, components, links) {
  if (from === to) throw new ValidationError('Дисципліна не може бути пререквізитом сама собі');
  const a = components.find((c) => c.code === from);
  const b = components.find((c) => c.code === to);
  if (!a || !b) throw new ValidationError(`Немає компонента ${!a ? from : to} у переліку плану`);
  if (firstSem(a) > lastSem(b)) {
    throw new ValidationError(`${from} (з ${firstSem(a)} сем.) не може передувати ${to} (до ${lastSem(b)} сем.)`);
  }
  // Reject a cycle: is `from` reachable from `to`?
  const next = new Map();
  links.forEach((l) => { if (!next.has(l.from)) next.set(l.from, []); next.get(l.from).push(l.to); });
  const stack = [to], seen = new Set();
  while (stack.length) {
    const x = stack.pop();
    if (x === from) throw new ValidationError(`Звʼязок ${from} → ${to} утворює цикл`);
    if (seen.has(x)) continue;
    seen.add(x);
    (next.get(x) || []).forEach((y) => stack.push(y));
  }
}

function cleanLink(l, n) {
  if (!l || typeof l !== 'object') throw new ValidationError(`Звʼязок ${n}: порожні дані`);
  const out = { from: normCode(l.from, `Звʼязок ${n}: звідки`), to: normCode(l.to, `Звʼязок ${n}: куди`) };
  // draft — taken from a source and not yet checked; doubt — what exactly is unclear about it.
  if (l.draft) out.draft = true;
  const doubt = text(l.doubt, 300, `Звʼязок ${n}: сумнів`);
  if (doubt) out.doubt = doubt;
  return out;
}

export function cleanLinks(list, components) {
  if (!Array.isArray(list)) throw new ValidationError('Звʼязки: очікується список');
  if (list.length > MAX_LINKS) throw new ValidationError(`Не більше ${MAX_LINKS} звʼязків`);
  const out = [];
  list.forEach((l, i) => {
    const link = cleanLink(l, i + 1);
    if (out.some((x) => x.from === link.from && x.to === link.to)) {
      throw new ValidationError(`Звʼязок ${link.from} → ${link.to} повторюється`);
    }
    checkLink(link.from, link.to, components, out);
    out.push(link);
  });
  return out;
}

function linkLabel(planId, year, l) {
  return `${l.from} → ${l.to} (${planLabel(planId, year)})`;
}

// Applies one operation and returns the new document plus a commit message.
export function applyOp(data, op) {
  if (!op || typeof op !== 'object') throw new ValidationError('Порожній запит');
  const next = structuredClone(data);
  next.plans ||= {};
  next.slots ||= {};

  switch (op.type) {
    case 'setSlot': {
      const isNew = !next.slots[op.id];
      if (isNew && Object.keys(next.slots).length >= MAX_SLOTS) {
        throw new ValidationError('Досягнуто ліміту блоків');
      }
      const slot = cleanSlot(op.id, op.slot, next);
      next.slots[op.id] = slot;
      const verb = isNew ? 'Додано' : 'Оновлено';
      return { data: next, message: `${verb} блок ${slot.label} (${planLabel(op.id, slot.plan)}, сем. ${slot.sem})` };
    }
    case 'deleteSlot': {
      const slot = next.slots[op.id];
      if (!slot) throw new ValidationError('Блок уже видалено');
      delete next.slots[op.id];
      // The curriculum keeps the elective component, only without the link to the removed block.
      Object.values(next.curricula || {}).forEach((cur) => (cur.components || []).forEach((c) => {
        if (c.slot === op.id) delete c.slot;
      }));
      return { data: next, message: `Видалено блок ${slot.label} (${planLabel(op.id, slot.plan)}, сем. ${slot.sem})` };
    }
    case 'moveOption': {
      // Move one discipline (with teacher and Moodle id) from one block to another in a single commit.
      const src = next.slots[op.from];
      const dst = next.slots[op.to];
      if (!src || !dst) throw new ValidationError('Блок не знайдено. Оновіть сторінку.');
      if (op.from === op.to) throw new ValidationError('Дисципліна вже в цьому блоці');
      if (op.from[0] !== op.to[0]) throw new ValidationError('Переносити можна лише в межах одного рівня (бакалавр або магістр)');
      const key = normSubject(op.subject);
      if (!key) throw new ValidationError('Не вказано дисципліну');
      const i = (src.options || []).findIndex((o) => normSubject(o.subject) === key);
      if (i < 0) throw new ValidationError('Дисципліну вже переміщено або змінено. Оновіть сторінку.');
      dst.options = Array.isArray(dst.options) ? dst.options : [];
      if (dst.options.some((o) => normSubject(o.subject) === key)) {
        throw new ValidationError(`У блоці ${dst.label} вже є ця дисципліна`);
      }
      if (dst.options.length >= MAX_OPTIONS) throw new ValidationError(`Не більше ${MAX_OPTIONS} дисциплін у блоці`);
      const [moved] = src.options.splice(i, 1);
      dst.options.push(moved);
      // Keep statuses consistent with what saving a block does.
      if (!src.options.length && ['ok', 'draft', 'approved'].includes(src.status)) src.status = 'planned';
      if (dst.status === 'planned') dst.status = 'ok';
      const where = op.from.split('-')[0] === op.to.split('-')[0]
        ? `${planLabel(op.to, dst.plan)}`
        : `${planLabel(op.from, src.plan)} → ${planLabel(op.to, dst.plan)}`;
      return { data: next, message: `Перенесено «${moved.subject}» з ${src.label} у ${dst.label} (${where})` };
    }
    case 'setPlan': {
      const isNew = !next.plans[op.id];
      // Keep stored fields (PDF link, duration, programme) the client does not send.
      const incoming = isNew ? { ...op.plan } : { ...next.plans[op.id], ...op.plan };
      if (op.plan && op.plan.pdf == null && !isNew) incoming.pdf = next.plans[op.id].pdf;
      const plan = cleanPlan(op.id, incoming);
      next.plans[op.id] = plan;
      return { data: next, message: `${isNew ? 'Додано' : 'Оновлено'} навчальний ${planLabel(op.id, plan.year)}` };
    }
    case 'setComponents': {
      // Replaces the list of educational components of a plan; links must still point to existing codes.
      const { year } = curriculumPlan(op.plan, next);
      next.curricula ||= {};
      const prev = next.curricula[op.plan] || {};
      const components = cleanComponents(op.plan, op.components, next);
      const links = op.links === undefined ? prev.links || [] : op.links;
      const cur = { source: text(op.source === undefined ? prev.source : op.source, 200, 'Джерело'), components, links: cleanLinks(links, components) };
      if (op.linksSource !== undefined || prev.linksSource) {
        cur.linksSource = text(op.linksSource === undefined ? prev.linksSource : op.linksSource, 300, 'Джерело звʼязків');
      }
      next.curricula[op.plan] = cur;
      const n = components.length;
      return { data: next, message: `Оновлено перелік освітніх компонентів (${planLabel(op.plan, year)}): ${n} ${plural(n, 'компонент', 'компоненти', 'компонентів')}, ${cur.links.length} ${plural(cur.links.length, 'звʼязок', 'звʼязки', 'звʼязків')}` };
    }
    case 'setLink': {
      // Adds a prerequisite link or updates an existing one (e.g. confirms a draft).
      const { year } = curriculumPlan(op.plan, next);
      const cur = next.curricula && next.curricula[op.plan];
      if (!cur || !(cur.components || []).length) throw new ValidationError('Для цього плану ще немає переліку освітніх компонентів');
      const link = cleanLink(op, 1);
      cur.links ||= [];
      const i = cur.links.findIndex((l) => l.from === link.from && l.to === link.to);
      if (i < 0 && cur.links.length >= MAX_LINKS) throw new ValidationError(`Не більше ${MAX_LINKS} звʼязків`);
      checkLink(link.from, link.to, cur.components, cur.links.filter((_, k) => k !== i));
      const verb = i < 0 ? 'Додано' : (cur.links[i].draft && !link.draft ? 'Підтверджено' : 'Оновлено');
      if (i < 0) cur.links.push(link); else cur.links[i] = link;
      return { data: next, message: `${verb} звʼязок ${linkLabel(op.plan, year, link)}` };
    }
    case 'deleteLink': {
      const { year } = curriculumPlan(op.plan, next);
      const cur = next.curricula && next.curricula[op.plan];
      const i = cur && cur.links ? cur.links.findIndex((l) => l.from === op.from && l.to === op.to) : -1;
      if (i < 0) throw new ValidationError('Звʼязок уже видалено');
      const [link] = cur.links.splice(i, 1);
      return { data: next, message: `Видалено звʼязок ${linkLabel(op.plan, year, link)}` };
    }
    default:
      throw new ValidationError('Невідома операція');
  }
}
