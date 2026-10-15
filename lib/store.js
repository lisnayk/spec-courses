// Validation and mutations for data/courses.json.
// Shared by the Vercel function (api/data.js) and the local dev server.

export const STATUSES = ['ok', 'warn', 'missing', 'draft', 'planned'];

const PLAN_ID = /^p(\d{4})$/;
const SLOT_ID = /^p(\d{4})-s([1-8])-[a-z0-9]{1,16}$/;
const MOODLE_ID = /^\d{0,10}$/;
const PLAN_PDF = /^(plans\/[A-Za-z0-9._-]+\.pdf)?$/;
const MAX_SLOTS = 2000;
const MAX_OPTIONS = 20;

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

export function cleanPlan(id, plan) {
  const m = PLAN_ID.exec(id || '');
  if (!m) throw new ValidationError('Некоректний ідентифікатор плану');
  if (!plan || typeof plan !== 'object') throw new ValidationError('Порожні дані плану');
  const year = int(plan.year, 2000, 2100, 'Рік вступу');
  if (year !== Number(m[1])) throw new ValidationError('Рік плану не збігається з ідентифікатором');
  const pdf = text(plan.pdf, 120, 'PDF');
  if (!PLAN_PDF.test(pdf)) throw new ValidationError('PDF: очікується шлях виду plans/<файл>.pdf');
  return { year, code: text(plan.code, 40, 'Шифр'), note: text(plan.note, 300, 'Примітка'), pdf };
}

export function cleanSlot(id, slot, data) {
  const m = SLOT_ID.exec(id || '');
  if (!m) throw new ValidationError('Некоректний ідентифікатор блоку');
  if (!slot || typeof slot !== 'object') throw new ValidationError('Порожні дані блоку');
  const plan = int(slot.plan, 2000, 2100, 'План');
  const sem = int(slot.sem, 1, 8, 'Семестр');
  if (plan !== Number(m[1]) || sem !== Number(m[2])) {
    throw new ValidationError('План або семестр не збігаються з ідентифікатором блоку');
  }
  if (!data.plans['p' + plan]) throw new ValidationError(`Плану ${plan} не існує`);
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
      return { data: next, message: `${verb} блок ${slot.label} (план ${slot.plan}, сем. ${slot.sem})` };
    }
    case 'deleteSlot': {
      const slot = next.slots[op.id];
      if (!slot) throw new ValidationError('Блок уже видалено');
      delete next.slots[op.id];
      return { data: next, message: `Видалено блок ${slot.label} (план ${slot.plan}, сем. ${slot.sem})` };
    }
    case 'setPlan': {
      const isNew = !next.plans[op.id];
      // Keep an existing PDF link when the client does not send one.
      const incoming = { ...op.plan };
      if (incoming.pdf == null && !isNew) incoming.pdf = next.plans[op.id].pdf;
      const plan = cleanPlan(op.id, incoming);
      next.plans[op.id] = plan;
      return { data: next, message: `${isNew ? 'Додано' : 'Оновлено'} навчальний план ${plan.year}` };
    }
    default:
      throw new ValidationError('Невідома операція');
  }
}
