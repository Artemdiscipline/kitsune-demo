import {catalog} from './shared/catalog.js';
import {money, total, itemKey, statuses, availabilityLabels, createRequest, updateRequest, decideProposal, validateCustomer} from './shared/model.js';
import {STORAGE,readState,writeState} from './storage.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  bag:'<path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  request:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>', check:'<path d="m5 12 4 4L19 6"/>',
  back:'<path d="M20 12H5m6-6-6 6 6 6"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  expand:'<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
};
const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;
let config, me = null, serverRequests = [], busy = false, checkout = false, storageWarning = '', toastTimer;
let query = '', type = 'Все', price = 'all';
let state = {cart:[], requests:[], customer:{name:'',method:'telegram',contact:'',comment:''}, role:'client', checkoutToken:crypto.randomUUID()};
try { state=readState(state); }
catch { storageWarning = 'Не удалось прочитать сохранённые данные. Проверьте доступ браузера к хранилищу.'; }
const demo = () => config?.mode === 'demo';
const requests = () => demo() ? state.requests : serverRequests;
const admin = () => demo() ? state.role === 'admin' : me?.isAdmin && location.hash.startsWith('#admin');
function persist(next) {
  state=writeState(next,demo());
}
async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options, headers:{'Content-Type':'application/json','X-Telegram-Init-Data':window.Telegram?.WebApp?.initData || '',...options.headers},
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось связаться с сервером. Повторите попытку.');
  return body;
}
async function refresh() { if (!demo()) serverRequests = await api('/requests' + (admin()?'?scope=admin':'')); }
function toast(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = 'show' + (error?' error':'');
  toastTimer = setTimeout(() => {$('#toast').className = '';}, 5500);
}
function go(path) { location.hash = path; }
const photo = (p, cls = '', zoom = false) => `<${zoom?'button':'div'} class="photo ${cls}" ${zoom?`data-zoom="${esc(p.images[0] || '')}" data-alt="${esc(p.name + ' · ' + p.sku)}" aria-label="Увеличить фото ${esc(p.sku)}"`:''}>${p.images?.length ? `<img src="${esc(p.images[0])}" alt="${esc(p.name + ' · ' + p.sku)}" loading="lazy">` : '<span class="placeholder">Фото уточняется</span>'}${zoom?`<span class="zoom-icon">${icon('expand')}</span>`:''}</${zoom?'button':'div'}>`;
const date = value => new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const amount = items => {const t=total(items); return `<strong>${t.unknown && t.known === 0 ? 'Сумму уточнит администратор' : money(t.known)}</strong>${t.unknown && t.known > 0 ? '<small>Известная часть суммы. Остальное уточнит администратор.</small>' : ''}`;};
const shortAmount = items => {const t=total(items);return t.unknown ? (t.known ? money(t.known)+' + уточнение' : 'Сумма уточняется') : money(t.known);};
const cartItems = () => state.cart.map(i => ({...i, product:catalog.find(p=>p.id===i.productId)})).filter(i=>i.product);
const statusBadge = request => `<span class="status ${esc(request.status)}"><i></i>${esc(statuses[request.status] || request.status)}</span>`;
function header() {
  const count = state.cart.reduce((n,i)=>n+i.quantity,0);
  return `<div class="demo-bar"><div class="demo-bar-inner">${demo()?'<span class="demo-label"><i></i>Демо</span><span class="demo-hint">Попробуйте обе стороны запроса</span><div class="role-switch" aria-label="Демонстрационная роль"><button data-role="client" aria-pressed="'+(state.role==='client')+'">Клиент</button><button data-role="admin" aria-pressed="'+(state.role==='admin')+'">Администратор</button></div>':'<span>Витрина в Telegram</span>'+ (me?.isAdmin?'<a href="#admin">Администратор</a><a href="#catalog">Клиент</a>':'')}</div></div>
  <header class="header"><a href="#catalog" class="wordmark" aria-label="KITSUNE — каталог">KITSUNE<span>ПИРСИНГ И ТАТУ</span></a><div class="header-note">Маленькие детали.<br>Ваш характер.</div><a class="header-selection" href="#selection">${icon('bag')}<span>Мой выбор</span><b>${count}</b></a></header>`;
}
function nav() {
  const route = location.hash;
  const count=state.cart.reduce((n,i)=>n+i.quantity,0);
  return `<nav class="bottom-nav" aria-label="Основная навигация"><a href="#catalog" ${!route || route==='#catalog' || route.startsWith('#product')?'aria-current="page"':''}>${icon('grid')}<span>Витрина</span></a><a href="#selection" ${route==='#selection'?'aria-current="page"':''}>${icon('bag')}<span>Мой выбор ${count?`<b>${count}</b>`:''}</span></a><a href="${admin()?'#admin':'#requests'}" ${route.includes('request') || route.includes('admin')?'aria-current="page"':''}>${icon('request')}<span>${admin()?'Запросы клиентов':'Мои запросы'}</span></a></nav>`;
}
function catalogView() {
  return `<section class="intro"><div><p class="eyebrow">КОЛЛЕКЦИЯ KITSUNE</p><h1>Украшения для пирсинга</h1></div><p class="intro-copy">Выберите понравившиеся украшения — администратор уточнит наличие и поможет с выбором.</p></section>
  <section aria-label="Каталог украшений"><div class="catalog-toolbar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="Название, артикул или материал" aria-label="Поиск украшений" value="${esc(query)}" autocomplete="off"></label><label class="price-filter"><span>Цена</span><select id="price" aria-label="Фильтр по цене"><option value="all" ${price==='all'?'selected':''}>Любая цена</option><option value="2000" ${price==='2000'?'selected':''}>До 2 000 ₽</option><option value="3000" ${price==='3000'?'selected':''}>До 3 000 ₽</option><option value="above" ${price==='above'?'selected':''}>От 3 000 ₽</option></select></label></div><div class="catalog-meta"><div class="filters" aria-label="Тип украшения">${['Все','Накрутки','Кластеры','Кликеры'].map(t=>`<button data-filter="${t}" aria-pressed="${type===t}">${t}</button>`).join('')}</div><span id="results-count" class="muted"></span></div><div id="products" class="product-grid"></div></section>
  <aside class="catalog-note">${icon('info')}<p>Ваш выбор — начало разговора.<br><span>Подходящий размер и совместимость поможет уточнить мастер.</span></p></aside><footer class="footer"><span>KITSUNE · Украшения с характером</span><a href="https://t.me/kitsumori" target="_blank" rel="noopener">Контакт студии ↗</a></footer>`;
}
function renderProducts() {
  const normalized = query.toLocaleLowerCase('ru');
  const list = catalog.filter(p=>(type==='Все' || p.type===type) && `${p.name} ${p.sku} ${p.material}`.toLocaleLowerCase('ru').includes(normalized) && (price==='all' || (p.price != null && (price==='above'?p.price>=3000:p.price<=Number(price)))));
  $('#results-count').textContent = `${list.length} из ${catalog.length}`;
  $('#products').innerHTML = list.length ? list.map(p=>{
    const selected=state.cart.some(i=>i.productId===p.id);
    return `<article class="product-card ${selected?'selected':''}"><a class="product-image-link" href="#product/${p.id}" aria-label="${esc(p.name)} · ${p.sku}">${photo(p)}${selected?`<span class="selected-tag">${icon('check')}В выборе</span>`:''}</a><div class="product-meta"><span>${p.type}</span><span>№ ${p.sku}</span></div><a class="product-title" href="#product/${p.id}">${esc(p.name)}</a><p class="material">${esc(p.material || 'Уточнить материал')}</p><div class="product-bottom"><strong>${money(p.price)}</strong><a class="choose ${selected?'chosen':''}" href="#product/${p.id}">${selected?'Выбрано':'Выбрать'}${icon(selected?'check':'arrow')}</a></div></article>`;
  }).join('') : `<div class="empty no-results">${icon('search')}<h2>Таких украшений пока нет в этой подборке</h2><button class="primary" data-reset>Сбросить фильтры</button></div>`;
}
function detailView(id) {
  const p=catalog.find(p=>p.id===id);
  if (!p) return empty('Украшение не найдено','Вернитесь в подборку и выберите другой вариант.');
  const existing=state.cart.find(i=>i.productId===id);
  return `<a class="back" href="#catalog">${icon('back')}В витрину</a><section class="detail"><div>${photo(p,'detail-photo',true)}<p class="photo-caption">Фотография из каталога KITSUNE · ${p.sku}</p></div><div class="detail-info"><p class="eyebrow">${p.type} <span>· № ${p.sku}</span></p><h1>${esc(p.name)}</h1><div class="detail-price">${money(p.price)}</div><span class="status pending"><i></i>Наличие уточняется</span><dl class="specs"><div><dt>Материал</dt><dd>${esc(p.material || 'Уточнить материал')}</dd></div><div><dt>Размер</dt><dd>${esc(p.size || 'Размер уточнит администратор')}</dd></div><div><dt>Комплектация</dt><dd>${esc(p.kit || 'Комплектацию уточнит администратор')}</dd></div><div><dt>Резьба</dt><dd>${esc(p.thread || 'Уточнит администратор')}</dd></div></dl>${p.type==='Накрутки'?'<p class="soft-note">Накрутка — отдельная деталь. Наличие основания в комплекте нужно уточнить.</p>':''}<label class="check-option"><input type="checkbox" id="help-size" ${existing?.helpSize?'checked':''}><span>Нужна помощь с размером<small>Подходящий размер и совместимость поможет уточнить мастер.</small></span></label><button class="primary full" data-add="${p.id}">${icon('bag')}Добавить в запрос</button><p class="button-note">Это запрос на резерв. Администратор сначала подтвердит наличие.</p>${existing?'<a href="#selection" class="text-link">Перейти в мой выбор →</a>':''}</div></section>`;
}
function empty(title, description, link='#catalog', text='Открыть витрину') {return `<div class="empty">${icon('bag')}<h1>${title}</h1><p>${description}</p><a class="primary" href="${link}">${text}${icon('arrow')}</a></div>`;}
function lineView(item, editable=false, index=0) {
  const p=item.product;
  return `<article class="line-item" data-key="${esc(item.key || itemKey(item))}"><a href="#product/${p.id}" class="line-photo">${photo(p)}</a><div class="line-info"><a class="line-title" href="#product/${p.id}">${esc(p.name)}</a><span class="sku">№ ${p.sku}</span><p>${item.helpSize?'Нужна помощь с размером':'Размер уточнит администратор'}</p><strong>${money(p.price)}</strong>${!editable?`<span class="muted"> × ${item.quantity}</span>`:''}</div>${editable?`<div class="line-controls"><button class="remove" data-remove="${esc(itemKey(item))}" aria-label="Удалить ${p.sku}">${icon('close')}</button><div class="quantity"><button data-qty="${esc(itemKey(item))}" data-delta="-1" aria-label="Уменьшить количество ${p.sku}" ${item.quantity<=1?'disabled':''}>−</button><span>${item.quantity}</span><button data-qty="${esc(itemKey(item))}" data-delta="1" aria-label="Увеличить количество ${p.sku}" ${item.quantity>=20?'disabled':''}>+</button></div></div>`:`<span class="item-availability ${esc(item.availability)}">${esc(availabilityLabels[item.availability])}</span>`}</article>`;
}
function selectionView() {
  const items=cartItems();
  if (!items.length) return empty('Пока ничего не выбрано','Найдите украшения с вашим характером. Мы сохраним их здесь.');
  const c=state.customer;
  return `<div class="page-heading"><div><p class="eyebrow">ВАШИ УКРАШЕНИЯ</p><h1>${checkout?'Проверьте запрос':'Мой выбор'}</h1></div><a href="#catalog" class="text-link">Добавить ещё →</a></div><div class="checkout-layout"><section class="panel selection-list"><h2>${checkout?'Состав запроса':'Выбранные украшения'} <span class="count">${items.length}</span></h2>${items.map(i=>lineView(i,!checkout)).join('')}<div class="total"><span>Предварительная сумма</span><div>${amount(items)}</div></div><p class="soft-note">Наличие, комплектацию и итоговую стоимость подтвердит администратор.</p></section><section class="panel checkout-panel">${checkout?`<h2>Всё верно?</h2><dl class="review-contact"><dt>Имя</dt><dd>${esc(c.name)}</dd><dt>Способ связи</dt><dd>${c.method==='bot'?'Через бота':c.method==='phone'?'Телефон':'Telegram'}</dd><dt>Контакт</dt><dd>${esc(c.contact || 'Через Telegram-бота')}</dd>${c.comment?`<dt>Комментарий</dt><dd>${esc(c.comment)}</dd>`:''}</dl>${demo()?'<p class="demo-notice">Это тестовый запрос. Он сохранится только в этом браузере и не будет отправлен в студию.</p>':''}<div id="form-error" role="alert" class="form-error"></div><button class="primary full" data-submit ${busy?'disabled':''}>${busy?'Сохраняем…':demo()?'Создать тестовый запрос':'Отправить запрос на резерв'}${icon('arrow')}</button><button class="secondary full" data-edit>Изменить данные</button>`:`<h2>Как с вами связаться</h2><p class="muted form-intro">Администратор поможет уточнить детали вашего выбора.</p>${demo()?'<button class="test-fill" data-test-fill>Заполнить тестовыми данными ↗</button>':''}<form id="customer-form" novalidate><label>Имя<input name="name" autocomplete="given-name" maxlength="80" value="${esc(c.name)}" placeholder="Как к вам обращаться"></label><label>Способ связи<select name="method">${!demo()?'<option value="bot" '+(c.method==='bot'?'selected':'')+'>Через Telegram-бота</option>':''}<option value="telegram" ${c.method==='telegram'?'selected':''}>Telegram</option><option value="phone" ${c.method==='phone'?'selected':''}>Телефон</option></select></label><label id="contact-label" ${c.method==='bot'?'hidden':''}>Контакт<input name="contact" autocomplete="off" value="${esc(c.contact)}" placeholder="${c.method==='phone'?'+7 900 000-00-00':'@username'}" maxlength="50"></label><label>Комментарий <span class="optional">необязательно</span><textarea name="comment" rows="3" maxlength="1000" placeholder="Например: не знаю размер, нужна помощь">${esc(c.comment)}</textarea></label><div id="form-error" role="alert" class="form-error"></div><button class="primary full" type="submit">Проверить запрос${icon('arrow')}</button><p class="button-note">${demo()?'Демо: запрос тестовый и студии не отправляется.':'Администратор сначала подтвердит наличие.'}</p></form>`}</section></div>`;
}
function requestsView() {
  const rows=requests();
  if (!rows.length) return empty(admin()?'Запросов пока нет':'У вас пока нет запросов',admin()?'Переключитесь в роль клиента, выберите украшения и создайте тестовый запрос.':'Соберите свой выбор в витрине и отправьте его на уточнение.');
  return `<div class="page-heading"><div><p class="eyebrow">${admin()?'РАБОЧИЙ СТОЛ':'ВАШ ВЫБОР И ДЕТАЛИ'}</p><h1>${admin()?'Запросы клиентов':'Мои запросы'}</h1></div><button class="secondary" data-refresh>Обновить</button></div>${demo()&&admin()?'<p class="demo-notice">Демонстрация администратора. Здесь только запросы, созданные в этом браузере.</p>':''}<div class="request-list">${[...rows].reverse().map(r=>`<a class="request-card panel" href="#${admin()?'admin':'request'}/${encodeURIComponent(r.id)}"><div class="request-card-heading"><h2>${r.id}</h2>${statusBadge(r)}</div><p class="muted">${date(r.createdAt)}${admin()?' · '+esc(r.customer.name):''}</p><div class="request-thumbs">${r.items.slice(0,4).map(i=>photo(i.product)).join('')}</div><div class="request-card-bottom"><span>${r.items.length} поз. · ${shortAmount(r.items)}</span><span>Открыть ${icon('arrow')}</span></div>${r.adminComment?'<p class="comment-preview">'+esc(r.adminComment)+'</p>':''}</a>`).join('')}</div>`;
}
function proposalView(r,item) {
  if (!item.proposal) return '';
  const p=item.proposal;
  return `<div class="proposal"><p class="eyebrow">${p.decision==='accepted'?'ВЫ ПРИНЯЛИ ПРЕДЛОЖЕНИЕ':p.decision==='declined'?'ПРЕДЛОЖЕНИЕ ОТКЛОНЕНО':'АДМИНИСТРАТОР ПРЕДЛАГАЕТ ЗАМЕНУ'}</p><div class="proposal-product">${photo(p.product)}<div><a href="#product/${p.product.id}">${esc(p.product.name)} · ${p.product.sku}</a><strong>${money(p.product.price)}</strong><span class="muted">Вместо ${esc(item.product.name)} · ${item.product.sku}</span></div></div>${p.decision==='pending' && !admin() && r.status!=='closed'?`<p>Исходный выбор сохранён. Вы можете согласиться на обсуждение замены.</p><div class="proposal-actions"><button class="secondary" data-decision="accepted" data-request="${r.id}" data-key="${esc(item.key)}">Принять предложение</button><button class="text-link" data-decision="declined" data-request="${r.id}" data-key="${esc(item.key)}">Оставить мой выбор</button></div>`:''}${p.decision==='accepted'?'<p>Администратор уточнит наличие и параметры замены. Исходный состав запроса сохранён.</p>':''}</div>`;
}
function requestView(id, isAdmin) {
  const r=requests().find(r=>r.id===id);
  if (!r) return empty('Запрос не найден','Возможно, он создан в другом браузере.','#requests','Мои запросы');
  return `<a class="back" href="#${isAdmin?'admin':'requests'}">${icon('back')}Все запросы</a><div class="page-heading request-heading"><div><p class="eyebrow">ЗАПРОС НА РЕЗЕРВ · ${date(r.createdAt)}</p><h1>${r.id}</h1></div>${statusBadge(r)}</div>${!isAdmin?`<div class="request-message">${icon(r.status==='confirmed'?'check':'request')}<div><h2>${r.status==='pending'?'Запрос создан':statuses[r.status]}</h2><p>${r.status==='pending'?'Запрос создан. Администратор уточнит наличие украшений и свяжется с вами.':r.status==='partial'?'Наличие подтверждено только для отмеченных позиций. По остальным нужно уточнение.':r.status==='confirmed'?'Наличие подтверждено администратором. Окончательный выбор и детали согласуйте со студией.':r.status==='closed'?'Обработка этого запроса завершена. Вы можете собрать новый выбор.':'Посмотрите отметки по украшениям и комментарий администратора.'}</p></div></div>`:''}${demo()?'<p class="demo-notice">Это тестовый запрос. Он сохранён только в этом браузере и не отправлен в студию.</p>':''}<div class="checkout-layout"><section class="panel"><h2>Украшения в запросе</h2>${r.items.map(i=>lineView(i)).join('')}<div class="total"><span>Предварительная сумма</span><div>${amount(r.items)}</div></div><p class="soft-note">Наличие, комплектацию и итоговую стоимость подтвердит администратор.</p>${r.items.map(i=>proposalView(r,i)).join('')}</section><aside class="panel"><h2>${isAdmin?'Контакт клиента':'Данные запроса'}</h2><dl class="review-contact"><dt>Имя</dt><dd>${esc(r.customer.name)}</dd><dt>Связь</dt><dd>${esc(r.customer.method==='bot'?'Через Telegram-бота':r.customer.contact)}</dd><dt>Комментарий</dt><dd>${esc(r.customer.comment || 'Без комментария')}</dd></dl>${!isAdmin?`<div class="admin-message"><p class="eyebrow">ОТ АДМИНИСТРАТОРА</p><p>${esc(r.adminComment || 'Комментарий появится после обработки запроса.')}</p></div><button class="secondary full" data-refresh>Обновить статус</button>${demo()?'<button class="primary full" data-role="admin">Посмотреть как администратор →</button>':''}<a class="text-link" href="#catalog">Вернуться в каталог →</a>`:''}</aside></div>${isAdmin?adminForm(r):''}`;
}
function adminForm(r) {
  return `<form id="admin-form" class="panel admin-panel" data-id="${r.id}" data-version="${r.version}"><div class="page-heading"><div><p class="eyebrow">ОБРАБОТКА ЗАПРОСА</p><h2>Уточните каждую позицию</h2></div><span class="muted">Изменено ${date(r.updatedAt)}</span></div><p class="muted">Подтвердить весь список можно, когда подтверждена каждая позиция.</p><div class="admin-item-list">${r.items.map((item,index)=>`<div class="admin-item" data-key="${esc(item.key)}"><div class="admin-item-name">${photo(item.product)}<div><strong>${esc(item.product.name)}</strong><span>№ ${item.product.sku} · ${item.quantity} шт.</span><small>${item.helpSize?'Нужна помощь с размером':'Размер уточнит администратор'}</small></div></div><label>Наличие ${item.product.sku}<select name="availability-${index}" data-item-status>${Object.entries(availabilityLabels).map(([value,label])=>`<option value="${value}" ${item.availability===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Предложить замену ${item.product.sku}<select name="proposal-${index}"><option value="">Без замены</option>${catalog.filter(p=>p.id!==item.productId).map(p=>`<option value="${p.id}" ${item.proposal?.product.id===p.id?'selected':''}>${esc(p.name)} · ${p.sku} · ${money(p.price)}</option>`).join('')}</select></label>${item.proposal?`<small class="proposal-decision">Решение клиента: ${item.proposal.decision==='accepted'?'предложение принято':item.proposal.decision==='declined'?'отклонено':'ожидается'}</small>`:''}</div>`).join('')}</div><label>Комментарий клиенту<textarea name="adminComment" rows="3" maxlength="1000" placeholder="Что удалось подтвердить и что нужно уточнить">${esc(r.adminComment)}</textarea></label><div id="admin-error" class="form-error" role="alert"></div><div class="admin-actions"><button class="primary" type="submit" data-action="save">Сохранить изменения</button><button class="secondary" type="submit" data-action="confirm">Подтвердить наличие</button><button class="secondary" type="submit" data-action="clarify">Нужно уточнение</button><button class="secondary" type="submit" data-action="unavailable">Нет в наличии</button><button class="text-link" type="submit" data-action="close">Закрыть запрос</button></div><p class="button-note">Предложение замены не меняет выбор клиента без его согласия.</p></form>`;
}
function render() {
  const route=(location.hash || '#catalog').slice(1).split('/');
  const isAdmin=admin();
  let content = route[0]==='product'?detailView(route[1]):route[0]==='selection'?selectionView():route[0]==='request'?requestView(decodeURIComponent(route[1] || ''),false):route[0]==='admin' && isAdmin?(route[1]?requestView(decodeURIComponent(route[1]),true):requestsView()):route[0]==='requests'?requestsView():catalogView();
  $('#app').innerHTML=header()+`<main id="main">${storageWarning?'<p class="form-error">'+esc(storageWarning)+'</p>':''}${content}</main>`+nav();
  if ($('#products')) renderProducts();
  document.title = route[0]==='product'?'KITSUNE · '+(catalog.find(p=>p.id===route[1])?.name || 'Украшение'):'KITSUNE — украшения для пирсинга';
  const tg=window.Telegram?.WebApp;
  try { if (tg?.isVersionAtLeast('6.1')) {if (route[0]!=='catalog') tg.BackButton.show(); else tg.BackButton.hide();} } catch {}
}
document.addEventListener('error', event => {if(event.target.matches?.('.photo img')) {event.target.replaceWith(Object.assign(document.createElement('span'),{className:'placeholder',textContent:'Фото уточняется'}));}},true);
document.addEventListener('input',event=>{
  if(event.target.id==='search') {query=event.target.value;renderProducts();}
  if(event.target.closest('#customer-form')) { const form=$('#customer-form'); state.customer=Object.fromEntries(new FormData(form)); try {persist(state);}catch(error){toast(error.message,true);} }
});
document.addEventListener('change',event=>{
  if(event.target.id==='price') {price=event.target.value;renderProducts();}
  if(event.target.name==='method') {state.customer.method=event.target.value;$('#contact-label').hidden=event.target.value==='bot';const field=$('[name="contact"]');field.placeholder=event.target.value==='phone'?'+7 900 000-00-00':'@username';try{persist(state);}catch(e){toast(e.message,true);}}
});
document.addEventListener('click',async event=>{
  const el=event.target.closest('button,a');if(!el) return;
  try {
    if(el.dataset.role) {if(!demo())return;persist({...state,role:el.dataset.role});checkout=false;const id=location.hash.split('/')[1];const target=el.dataset.role==='admin'?'admin':'request';go(id && requests().some(r=>r.id===id)?`${target}/${id}`:el.dataset.role==='admin'?'admin':'catalog');render();}
    if(el.dataset.filter) {type=el.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===type)));renderProducts();}
    if(el.hasAttribute('data-reset')) {query='';type='Все';price='all';render();}
    if(el.dataset.zoom) {const dialog=$('#zoom');dialog.querySelector('img').src=el.dataset.zoom;dialog.querySelector('img').alt=el.dataset.alt;dialog.showModal();}
    if(el.matches('.zoom-close')) $('#zoom').close();
    if(el.dataset.add) {const item={productId:el.dataset.add,helpSize:$('#help-size').checked,quantity:1};const cart=structuredClone(state.cart);if(!cart.some(i=>itemKey(i)===itemKey(item)))cart.push(item);persist({...state,cart,checkoutToken:crypto.randomUUID()});toast('Украшение добавлено в ваш выбор');go('selection');}
    if(el.dataset.remove) {persist({...state,cart:state.cart.filter(i=>itemKey(i)!==el.dataset.remove),checkoutToken:crypto.randomUUID()});checkout=false;render();}
    if(el.dataset.qty) {const cart=structuredClone(state.cart);const item=cart.find(i=>itemKey(i)===el.dataset.qty);item.quantity=Math.max(1,Math.min(20,item.quantity+Number(el.dataset.delta)));persist({...state,cart,checkoutToken:crypto.randomUUID()});checkout=false;render();}
    if(el.hasAttribute('data-test-fill')) {persist({...state,customer:{name:'Александра · тест',method:'telegram',contact:'@kitsune_demo',comment:'Не знаю размер, нужна помощь'}});render();}
    if(el.hasAttribute('data-edit')) {checkout=false;render();}
    if(el.hasAttribute('data-submit')) await submitRequest(el);
    if(el.hasAttribute('data-refresh')) {el.disabled=true;await refresh();render();toast('Статус обновлён');}
    if(el.dataset.decision) {if(busy)return;busy=true;el.disabled=true;const r=requests().find(r=>r.id===el.dataset.request);if(demo()){const next=decideProposal(r,el.dataset.key,el.dataset.decision,r.version);persist({...state,requests:state.requests.map(x=>x.id===r.id?next:x)});}else {await api(`/requests/${encodeURIComponent(r.id)}/proposal`,{method:'POST',body:JSON.stringify({key:el.dataset.key,decision:el.dataset.decision,version:r.version})});await refresh();}render();toast('Ваше решение сохранено');}
  } catch(error) {toast(error.message || 'Не удалось выполнить действие. Повторите попытку.',true);}
  finally {if(!el.hasAttribute('data-submit'))busy=false;}
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='customer-form') {
    event.preventDefault();
    try {const customer=validateCustomer(Object.fromEntries(new FormData(event.target)),demo()?null:me.user);persist({...state,customer});checkout=true;render();window.scrollTo({top:0,behavior:'smooth'});}
    catch(error) {$('#form-error').textContent=error.message;}
  }
  if(event.target.id==='admin-form') {
    event.preventDefault();if(busy)return;busy=true;
    const form=event.target, r=requests().find(r=>r.id===form.dataset.id), data=new FormData(form);
    const patch={version:Number(form.dataset.version),action:event.submitter?.dataset.action || 'save',adminComment:data.get('adminComment'),items:r.items.map((item,i)=>({key:item.key,availability:data.get('availability-'+i),proposedId:data.get('proposal-'+i)}))};
    form.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      if(demo()){const next=updateRequest(r,patch,catalog);persist({...state,requests:state.requests.map(x=>x.id===r.id?next:x)});}
      else {await api(`/requests/${encodeURIComponent(r.id)}`,{method:'PATCH',body:JSON.stringify(patch)});await refresh();}
      render();toast('Изменения сохранены. Клиент увидит актуальный статус.');
    }catch(error){$('#admin-error').textContent=error.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
    finally {busy=false;}
  }
});
async function submitRequest(button) {
  if(busy)return;busy=true;button.disabled=true;button.textContent='Сохраняем…';
  try {
    const payload={items:state.cart,customer:state.customer,idempotencyKey:state.checkoutToken};
    let request;
    if(demo()) {
      request=state.requests.find(r=>r.idempotencyKey===payload.idempotencyKey) || createRequest(payload,catalog);
      const rows=state.requests.some(r=>r.id===request.id)?state.requests:[...state.requests,request];
      // One atomic write records the request and clears the selection only after success.
      persist({...state,requests:rows,cart:[],checkoutToken:crypto.randomUUID()});
    } else {
      request=await api('/requests',{method:'POST',body:JSON.stringify(payload)});
      state={...state,cart:[],checkoutToken:crypto.randomUUID()};
      try {persist(state);}catch {toast('Запрос сохранён на сервере. Браузер не смог очистить сохранённый выбор.',true);}
      serverRequests=[...serverRequests.filter(r=>r.id!==request.id),request];
    }
    checkout=false;go('request/'+encodeURIComponent(request.id));render();
  }catch(error){if($('#form-error'))$('#form-error').textContent=error.message || 'Не удалось сохранить запрос. Ваш выбор сохранён. Повторите попытку.';button.disabled=false;button.textContent=demo()?'Создать тестовый запрос':'Отправить запрос на резерв';}
  finally {busy=false;}
}
window.addEventListener('hashchange',async()=>{checkout=false;try{await refresh();}catch(error){toast(error.message,true);}render();window.scrollTo({top:0});});
window.addEventListener('storage',event=>{if(demo() && event.key===STORAGE && event.newValue){try{state=JSON.parse(event.newValue);render();}catch{}}});
async function init() {
  try {
    const response=await fetch('./config.json',{cache:'no-store'});if(!response.ok)throw new Error('Не удалось загрузить настройки витрины. Обновите страницу.');config=await response.json();
    if(!['demo','telegram'].includes(config.mode))throw new Error('Режим витрины не настроен.');
    if(!demo()){me=await api('/me');state.customer={name:me.user.first_name || '',method:'bot',contact:'',comment:''};state.role='client';await refresh();}
    const tg=window.Telegram?.WebApp;
    if(tg){tg.ready();tg.expand();try{if(tg.isVersionAtLeast('6.1')){tg.setHeaderColor('#f6f5f1');tg.setBackgroundColor('#f6f5f1');tg.BackButton.onClick(()=>go(admin()?'admin':'catalog'));}}catch{}}
    render();
  }catch(error){$('#app').innerHTML=`<main>${empty('Витрина пока недоступна',esc(error.message))}<button class="secondary" id="retry-init">Повторить</button></main>`;$('#retry-init').onclick=()=>location.reload();}
}
init();
