export const STORAGE = 'kitsune-demo-v1';
export function readState(defaultState, storage = localStorage) {
  const saved = JSON.parse(storage.getItem(STORAGE) || 'null');
  if (!saved) return defaultState;
  if (!Array.isArray(saved.cart) || !Array.isArray(saved.requests)) throw new Error('Некорректный формат сохранённых данных.');
  return {...defaultState,...saved};
}
export function writeState(next, isDemo, storage = localStorage) {
  // A single synchronous storage write: request + selection change succeed together.
  const stored = isDemo ? next : {...next,requests:[],customer:{name:'',method:'bot',contact:'',comment:''},role:'client'};
  try { storage.setItem(STORAGE, JSON.stringify(stored)); }
  catch { throw new Error('Браузер не смог сохранить данные. Разрешите хранение данных и повторите. Ваш выбор остаётся на экране.'); }
  return next;
}
