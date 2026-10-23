import {createHmac, timingSafeEqual} from 'node:crypto';

// Official bot-token validation: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function validateInitData(raw, token, ttl = 3600, now = Date.now()) {
  const fail = () => { const error = new Error('Откройте витрину заново через кнопку Telegram-бота.'); error.status = 401; throw error; };
  if (!token || typeof raw !== 'string' || !raw || raw.length > 12000) fail();
  const params = new URLSearchParams(raw);
  if (new Set(params.keys()).size !== [...params.keys()].length) fail();
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) fail();
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) fail();
  const authDate = Number(params.get('auth_date'));
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || nowSeconds - authDate > ttl || authDate - nowSeconds > 30) fail();
  let user;
  try { user = JSON.parse(params.get('user')); } catch { fail(); }
  if (!user || !Number.isSafeInteger(user.id) || user.id < 1 || user.is_bot === true || typeof user.first_name !== 'string') fail();
  return {id:user.id, first_name:user.first_name, username:typeof user.username === 'string' ? user.username : undefined};
}

export async function telegramCall(token, method, payload, fetcher = fetch) {
  const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(method === 'getUpdates' ? 40000 : 10000),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error('Telegram временно не принял запрос.');
  return body.result;
}

export function telegramConfig(env = process.env) {
  const mode = env.APP_MODE || 'demo';
  if (!['demo','telegram'].includes(mode)) throw new Error('APP_MODE должен быть demo или telegram.');
  const adminIds = String(env.ADMIN_TELEGRAM_IDS || '').split(',').map(x=>x.trim()).filter(Boolean);
  if (adminIds.some(x=>!/^\d+$/.test(x) || !Number.isSafeInteger(Number(x)))) throw new Error('ADMIN_TELEGRAM_IDS: нужны числовые ID.');
  const testChatId = env.TEST_ADMIN_CHAT_ID || '';
  if (testChatId && (!/^[1-9]\d*$/.test(testChatId) || !adminIds.includes(testChatId))) throw new Error('TEST_ADMIN_CHAT_ID должен быть личным числовым ID тестового администратора из ADMIN_TELEGRAM_IDS.');
  const miniAppUrl = env.MINI_APP_URL || '';
  if (mode === 'telegram') {
    if (!env.BOT_TOKEN || !/^\d+:[A-Za-z0-9_-]+$/.test(env.BOT_TOKEN)) throw new Error('Задайте BOT_TOKEN на сервере.');
    if (!adminIds.length) throw new Error('Задайте ADMIN_TELEGRAM_IDS.');
    try {const url = new URL(miniAppUrl); if(url.protocol !== 'https:' || url.username || url.password) throw new Error();}
    catch {throw new Error('MINI_APP_URL: нужен публичный HTTPS-адрес сервера.');}
  }
  const ttl = Number(env.INIT_DATA_TTL_SECONDS || 3600);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new Error('INIT_DATA_TTL_SECONDS должен быть от 60 до 86400.');
  return {mode, token:env.BOT_TOKEN || '', adminIds, testChatId, miniAppUrl, ttl};
}
