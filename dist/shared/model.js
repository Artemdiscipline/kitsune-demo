export const statuses = {
  pending: 'Ожидает подтверждения', confirmed: 'Наличие подтверждено',
  partial: 'Часть позиций подтверждена', clarify: 'Нужно уточнение',
  unavailable: 'Нет в наличии', closed: 'Запрос закрыт',
};
export const availabilityLabels = {
  pending: 'Наличие уточняется', available: 'Наличие подтверждено',
  clarify: 'Нужно уточнение', unavailable: 'Нет в наличии',
};
export const itemKey = item => `${item.productId}:${item.helpSize ? 'help' : 'check'}`;
export const money = value => value == null ? 'Цена уточняется' : new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
export function total(items) {
  const known = items.reduce((sum, item) => sum + (item.product.price == null ? 0 : item.product.price * item.quantity), 0);
  return {known, unknown: items.some(item => item.product.price == null)};
}
export function effectiveItems(request) {
  return request.items.map(item => item.proposal?.decision === 'accepted'
    ? {...item, originalProduct: item.product, product: item.proposal.product, availability: item.proposal.availability || 'pending'}
    : item);
}
function stockStatus(request) {
  const values = effectiveItems(request).map(item => item.availability);
  return values.every(v => v === 'available') ? 'confirmed' :
    values.every(v => v === 'unavailable') ? 'unavailable' :
    values.includes('available') ? 'partial' : 'clarify';
}
export function normalizeRequest(request) {
  if (!Array.isArray(request?.items)) return request;
  if (!request.items.some(item => item.proposal?.decision === 'accepted' && !item.proposal.availability)) return request;
  const next=structuredClone(request);
  for (const item of next.items) if (item.proposal?.decision === 'accepted' && !item.proposal.availability) item.proposal.availability='pending';
  if (next.status !== 'closed') next.status=stockStatus(next);
  return next;
}
export function requestMessages(request) {
  const messages = structuredClone(request.messages || []);
  if (request.adminComment && !messages.some(message => message.author === 'admin')) {
    messages.unshift({id:'legacy-' + request.id, author:'admin', text:request.adminComment, createdAt:request.updatedAt});
  }
  return messages;
}
export function validateCustomer(input, telegramUser) {
  const customer = {
    name: String(input?.name || '').trim(), method: input?.method,
    contact: String(input?.contact || '').trim(), comment: String(input?.comment || '').trim(),
  };
  if (!customer.name || customer.name.length > 80) throw new Error('Укажите имя: от 1 до 80 символов.');
  if (customer.comment.length > 1000) throw new Error('Комментарий должен быть короче 1 000 символов.');
  if (customer.method === 'bot') {
    if (!telegramUser?.id) throw new Error('Откройте витрину через Telegram или выберите другой способ связи.');
    customer.contact = `Telegram ID ${telegramUser.id}`;
  } else if (customer.method === 'telegram') {
    const contact = customer.contact.replace(/^https:\/\/t\.me\//i, '').replace(/^@/, '');
    if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(contact)) throw new Error('Укажите Telegram в формате @username: от 5 до 32 символов.');
    customer.contact = '@' + contact;
  } else if (customer.method === 'phone') {
    if (!/^\+?[\d\s()\-]{10,24}$/.test(customer.contact) || !/^\d{10,15}$/.test(customer.contact.replace(/\D/g, ''))) throw new Error('Укажите телефон: от 10 до 15 цифр.');
  } else throw new Error('Выберите способ связи.');
  return customer;
}
export function createRequest(input, products, options = {}) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) throw new Error('Выберите от 1 до 30 украшений.');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.idempotencyKey || '')) throw new Error('Обновите страницу и повторите отправку.');
  const customer = validateCustomer(input.customer, options.telegramUser);
  const merged = new Map();
  for (const line of input.items) {
    const product = products.find(p => p.id === line.productId);
    if (!product) throw new Error('Одного из украшений больше нет в каталоге. Обновите выбор.');
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new Error('Количество должно быть от 1 до 20.');
    const clean = {productId: product.id, helpSize: line.helpSize === true, quantity: line.quantity};
    const key = itemKey(clean);
    if (merged.has(key)) merged.get(key).quantity += clean.quantity;
    else merged.set(key, {...clean, key, product: structuredClone(product), availability: 'pending', proposal: null});
    if (merged.get(key).quantity > 20) throw new Error('Не больше 20 единиц одного украшения.');
  }
  return {
    id: options.id || 'KS-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    version: 1, ownerId: options.ownerId || 'browser-demo',
    idempotencyKey: input.idempotencyKey, customer, items: [...merged.values()],
    status: 'pending', adminComment: '', messages: [], demo: !options.telegramUser,
  };
}
export function updateRequest(request, patch, products) {
  if (request.status === 'closed') throw new Error('Запрос закрыт. Изменения недоступны.');
  if (patch.version !== request.version) throw new Error('Запрос уже изменён. Обновите его и повторите действие.');
  if (!Array.isArray(patch.items) || patch.items.length !== request.items.length) throw new Error('Передайте наличие для каждой позиции.');
  const next = structuredClone(request);
  next.items = next.items.map(item => {
    const edit = patch.items.find(i => i.key === item.key);
    if (!edit || !Object.hasOwn(availabilityLabels, edit.availability)) throw new Error('Уточните статус каждой позиции.');
    const proposedId = edit.proposedId || null;
    if (item.proposal?.decision === 'accepted') {
      if (proposedId !== item.proposal.product.id) throw new Error('Клиент уже принял эту замену. Сохраните согласованный вариант.');
      item.proposal.availability = edit.availability;
      return item;
    }
    item.availability = edit.availability;
    if (proposedId !== (item.proposal?.product.id || null)) {
      const product = products.find(p => p.id === proposedId);
      if (proposedId && (!product || product.id === item.productId)) throw new Error('Выберите замену из каталога.');
      item.proposal = product ? {product: structuredClone(product), decision: 'pending', availability:'pending'} : null;
    }
    return item;
  });
  const values = effectiveItems(next).map(i => i.availability);
  if (patch.action === 'confirm' && !values.every(v => v === 'available')) throw new Error('Сначала подтвердите наличие каждой позиции. Для части списка сохраните уточнение.');
  if (patch.action === 'unavailable' && !values.every(v => v === 'unavailable')) throw new Error('Отметьте «Нет в наличии» для каждой позиции или сохраните уточнение.');
  if (!['confirm', 'clarify', 'unavailable', 'close', 'save'].includes(patch.action)) throw new Error('Неизвестное действие.');
  next.status = patch.action === 'close' ? 'closed' :
    patch.action === 'clarify' && values.every(v => v === 'available') ? 'clarify' :
    stockStatus(next);
  next.adminComment = String(patch.adminComment || '').trim();
  if (next.adminComment.length > 1000) throw new Error('Комментарий должен быть короче 1 000 символов.');
  next.messages = requestMessages(request);
  if (next.adminComment && next.adminComment !== request.adminComment) {
    next.messages.push({id:crypto.randomUUID(), author:'admin', text:next.adminComment, createdAt:new Date().toISOString()});
  }
  next.updatedAt = new Date().toISOString(); next.version++;
  return next;
}
export function decideProposal(request, key, decision, version) {
  if (version !== request.version) throw new Error('Запрос уже изменён. Обновите его.');
  if (request.status === 'closed') throw new Error('Запрос закрыт.');
  if (!['accepted','declined'].includes(decision)) throw new Error('Неизвестное решение.');
  const next = structuredClone(request);
  const item = next.items.find(i => i.key === key);
  if (!item?.proposal || item.proposal.decision !== 'pending') throw new Error('Предложение уже обработано.');
  item.proposal.decision = decision;
  if (decision === 'accepted') {
    item.proposal.availability = 'pending';
    next.status = stockStatus(next);
  }
  next.updatedAt = new Date().toISOString(); next.version++;
  return next;
}
export function addMessage(request, input, author) {
  if (!['client','admin'].includes(author)) throw new Error('Неизвестный автор сообщения.');
  const text = String(input.text || '').trim();
  const id = String(input.id || '');
  if (!text || text.length > 1000) throw new Error('Напишите от 1 до 1 000 символов.');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Обновите страницу и повторите отправку.');
  const messages = requestMessages(request);
  const previous = messages.find(message => message.id === id);
  if (previous) {
    if (previous.author !== author || previous.text !== text) throw new Error('Этот идентификатор сообщения уже использован.');
    return request;
  }
  if (request.status === 'closed') throw new Error('Запрос закрыт. Создайте новый запрос в витрине.');
  if (input.version !== request.version) throw new Error('Запрос уже изменён. Обновите его и повторите отправку.');
  const next = structuredClone(request);
  next.messages = [...messages, {id, author, text, createdAt:new Date().toISOString()}];
  if (author === 'admin') next.adminComment = text;
  next.updatedAt = new Date().toISOString();
  next.version++;
  return next;
}
export function formatRequestSummary(request) {
  const items = effectiveItems(request), sum = total(items);
  return [
    `${request.demo ? 'ТЕСТОВЫЙ ЗАПРОС' : 'ЗАПРОС НА РЕЗЕРВ'} KITSUNE · ${request.id}`,
    request.demo ? 'Сохранён в браузере. Автоматически в студию не отправлен.' : '',
    `Статус: ${statuses[request.status]}`,
    ...items.map(item => `${item.product.name} · арт. ${item.product.sku} · ${item.quantity} шт. · ${money(item.product.price)} за шт.\n${item.helpSize ? 'Нужна помощь с размером' : 'Размер уточнит администратор'}; ${availabilityLabels[item.availability]}${item.originalProduct ? '\nПринятая замена вместо арт. ' + item.originalProduct.sku : ''}`),
    `Предварительно: ${sum.unknown ? (sum.known ? money(sum.known) + ' + стоимость остальных позиций уточняется' : 'сумму уточнит администратор') : money(sum.known)}`,
    `Имя: ${request.customer.name}`,
    `Связь: ${request.customer.contact}`,
    request.customer.comment ? `Пожелания: ${request.customer.comment}` : '',
    request.adminComment ? `Администратор: ${request.adminComment}` : '',
    'Наличие, комплектацию и окончательную стоимость подтверждает администратор.',
  ].filter(Boolean).join('\n\n');
}
