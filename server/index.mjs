import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {catalog} from '../dist/shared/catalog.js';
import {createRequest,updateRequest,decideProposal,addMessage,money,total} from '../dist/shared/model.js';
import {validateInitData,telegramCall,telegramConfig} from './telegram.mjs';
import {openStore} from './store.mjs';

const staticRoot=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'};
const send = (res,status,body) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
function fail(status,message){const error=new Error(message);error.status=status;throw error;}
async function readBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415,'Нужен формат application/json.');
  let size=0;const chunks=[];
  for await (const chunk of req) {size+=chunk.length;if(size>65536)fail(413,'Запрос слишком большой.');chunks.push(chunk);}
  try {const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body || typeof body!=='object' || Array.isArray(body))throw new Error();return body;}
  catch {fail(400,'Некорректный запрос.');}
}
function notificationFor(request,config) {
  if (!config.testChatId) return null;
  const lines=request.items.map(i=>`${i.product.name} · ${i.product.sku} · ${i.quantity} шт. · ${money(i.product.price)}${i.helpSize?' · помощь с размером':''}`);
  const sum=total(request.items);
  return {chat_id:config.testChatId,text:[`ТЕСТОВЫЙ АДМИНИСТРАТОР · Запрос ${request.id}`,request.customer.name,`${request.customer.method}: ${request.customer.contact}`, ...lines,`Предварительно: ${money(sum.known)}${sum.unknown?' + уточняемая часть':''}`,`Комментарий: ${request.customer.comment || '—'}`].join('\n').slice(0,4000),reply_markup:{inline_keyboard:[[{text:'Открыть запрос',web_app:{url:config.miniAppUrl+'/#admin/'+request.id}}]]}};
}
export function createApplication(options={}) {
  const config=options.config || telegramConfig();
  const store=openStore(options.databasePath || process.env.DATABASE_PATH || './data/kitsune.sqlite');
  let delivering=false;
  async function flushNotifications() {
    if (delivering || config.mode!=='telegram' || !config.testChatId) return;
    delivering=true;
    try {for (const row of store.pendingNotifications()) {
      store.attempted(row.id);
      try {await telegramCall(config.token,'sendMessage',JSON.parse(row.body),options.fetcher);store.delivered(row.id);}
      catch {console.warn('Уведомление тестовому администратору в очереди.');break;}
    }} finally {delivering=false;}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/config.json'){if(req.method!=='GET')fail(405,'Метод не поддерживается.');return send(res,200,{mode:config.mode});}
      if(url.pathname.startsWith('/api/')) {
        if(config.mode!=='telegram')fail(503,'Браузерное демо хранит запросы только в браузере.');
        if(req.headers.origin && req.headers.origin!==new URL(config.miniAppUrl).origin)fail(403,'Недопустимый источник запроса.');
        const user=validateInitData(req.headers['x-telegram-init-data'],config.token,config.ttl);
        const isAdmin=config.adminIds.includes(String(user.id));
        if(url.pathname==='/api/me' && req.method==='GET')return send(res,200,{user,isAdmin});
        if(url.pathname==='/api/requests' && req.method==='GET'){
          const adminScope=url.searchParams.get('scope')==='admin';if(adminScope && !isAdmin)fail(403,'Недостаточно прав.');
          return send(res,200,store.list(user.id,adminScope));
        }
        if(url.pathname==='/api/requests' && req.method==='POST'){
          const input=await readBody(req);
          const prior=store.byKey(user.id,String(input.idempotencyKey || ''));
          if(prior)return send(res,200,prior);
          const request=createRequest(input,catalog,{telegramUser:user,ownerId:String(user.id)});
          store.insert(request,notificationFor(request,config));
          send(res,201,request);void flushNotifications();return;
        }
        const match=url.pathname.match(/^\/api\/requests\/([^/]+)(\/proposal|\/messages)?$/);
        if(match){
          const request=store.get(decodeURIComponent(match[1]));
          if(!request || (!isAdmin && request.ownerId!==String(user.id)))fail(404,'Запрос не найден.');
          if(!match[2] && req.method==='GET')return send(res,200,request);
          if(match[2] === '/messages' && req.method === 'POST') {
            const body = await readBody(req);
            const author = isAdmin && (body.asAdmin === true || request.ownerId !== String(user.id)) ? 'admin' : 'client';
            const updated = addMessage(request,body,author);
            if (updated !== request) store.update(updated,body.version);
            return send(res,200,updated);
          }
          if(match[2] === '/proposal' && req.method==='POST'){
            if(request.ownerId!==String(user.id))fail(403,'Только клиент может принять предложенную замену.');
            const body=await readBody(req);const updated=decideProposal(request,body.key,body.decision,body.version);
            store.update(updated,body.version);return send(res,200,updated);
          }
          if(!match[2] && req.method==='PATCH'){
            if(!isAdmin)fail(403,'Доступ разрешён только администратору.');
            const body=await readBody(req);const updated=updateRequest(request,body,catalog);
            store.update(updated,body.version);return send(res,200,updated);
          }
        }
        fail(404,'Адрес не найден.');
      }
      if(!['GET','HEAD'].includes(req.method))fail(405,'Метод не поддерживается.');
      let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{fail(400,'Некорректный адрес.');}
      const filename=path.resolve(staticRoot,'.'+(pathname==='/'?'/index.html':pathname));
      if(!filename.startsWith(staticRoot) || filename===staticRoot)fail(404,'Файл не найден.');
      let info;try {info=await stat(filename);}catch{fail(404,'Файл не найден.');}if(!info.isFile())fail(404,'Файл не найден.');
      const content=await readFile(filename);
      res.writeHead(200,{'Content-Type':types[path.extname(filename)] || 'application/octet-stream','Cache-Control':pathname.startsWith('/assets/')?'public,max-age=3600':'no-store'});
      res.end(req.method==='HEAD'?undefined:content);
    }catch(error){if(!res.headersSent)send(res,error.status || 400,{error:error.message || 'Не удалось обработать запрос.'});else res.end();}
  });
  server.requestTimeout=20000;
  const interval=setInterval(()=>void flushNotifications(),30000);interval.unref();
  return {server,store,flushNotifications,close:async()=>{clearInterval(interval);await new Promise(resolve=>server.close(resolve));store.close();}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const app=createApplication();
  const port=Number(process.env.PORT || 4173),host=process.env.HOST || '127.0.0.1';
  app.server.listen(port,host,()=>console.log(`KITSUNE Local: http://localhost:${port} · ${process.env.APP_MODE || 'demo'}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
}
