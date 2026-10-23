import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {createApplication} from '../server/index.mjs';
import {validateInitData,telegramConfig} from '../server/telegram.mjs';
import {openStore} from '../server/store.mjs';

const token='123456:fake-token-for-local-unit-tests';
function signed(id=101,date=Math.floor(Date.now()/1000),extra={}) {
  const params=new URLSearchParams({auth_date:String(date),query_id:'test-query',user:JSON.stringify({id,first_name:'Test'}),...extra});
  const check=[...params].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  params.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return params.toString();
}
test('initData signature, freshness and duplicate keys are checked',()=>{
  assert.equal(validateInitData(signed(),token).id,101);
  assert.equal(validateInitData(signed(101,Math.floor(Date.now()/1000),{signature:'opaque-signed-field'}),token).id,101);
  assert.throws(()=>validateInitData(signed().replace('101','102'),token),/Откройте/);
  assert.throws(()=>validateInitData(signed(101,1),token),/Откройте/);
  assert.throws(()=>validateInitData(signed(101,Math.floor(Date.now()/1000)+100),token),/Откройте/);
  assert.throws(()=>validateInitData(signed()+'&auth_date=1',token),/Откройте/);
  assert.throws(()=>validateInitData('',token),/Откройте/);
  assert.throws(()=>telegramConfig({APP_MODE:'telegram',BOT_TOKEN:token,MINI_APP_URL:'https://demo.example',ADMIN_TELEGRAM_IDS:'900',TEST_ADMIN_CHAT_ID:'123'}),/тестового администратора/);
});
test('server authorization, idempotency, snapshots, partial availability, proposal consent and persistence',async()=>{
  const filename=path.resolve('data','test-'+randomUUID()+'.sqlite');
  const sent=[];let networkAvailable=false;
  const app=createApplication({databasePath:filename,config:{mode:'telegram',token,adminIds:['900'],testChatId:'900',miniAppUrl:'https://demo.example',ttl:3600},fetcher:async(url,options)=>{
    if(!networkAvailable)throw new Error('offline');sent.push({url,payload:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};
  }});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;
  const call=async(route,{id=101,method='GET',body,auth=true}={})=>{
    const response=await fetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',...(auth?{'X-Telegram-Init-Data':signed(id)}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};
  };
  try {
    assert.equal((await call('/me',{auth:false})).status,401);
    assert.equal((await call('/me',{id:900})).body.isAdmin,true);
    const input={idempotencyKey:'same-request-0001',customer:{name:'Клиент',method:'bot',contact:'forged',comment:'Помощь с размером'},items:[{productId:'14501338',quantity:1,helpSize:true,product:{price:1}},{productId:'14501335',quantity:1,helpSize:true}]};
    const created=await call('/requests',{method:'POST',body:input});assert.equal(created.status,201);
    const r=created.body;assert.equal(r.items[0].product.price,1500);assert.equal(r.ownerId,'101');assert.equal(r.customer.contact,'Telegram ID 101');
    const repeats=await Promise.all(Array.from({length:4},()=>call('/requests',{method:'POST',body:input})));
    assert.ok(repeats.every(x=>x.body.id===r.id));assert.equal((await call('/requests')).body.length,1);
    assert.equal((await call('/requests',{id:102})).body.length,0);
    assert.equal((await call('/requests?scope=admin',{id:102})).status,403);
    assert.equal((await call('/requests/'+r.id,{id:102})).status,404);
    assert.equal((await call('/requests/'+r.id,{method:'PATCH',body:{}})).status,403);
    assert.equal((await call('/requests',{id:900})).body.length,0);
    assert.equal((await call('/requests?scope=admin',{id:900})).body.length,1);
    const edit={version:1,action:'save',adminComment:'Первое подтверждено, по второму уточняем размер',items:r.items.map((i,n)=>({key:i.key,availability:n?'clarify':'available',proposedId:n?'14495089':''}))};
    assert.equal((await call('/requests/'+r.id,{id:900,method:'PATCH',body:{...edit,action:'confirm'}})).status,400);
    const updated=await call('/requests/'+r.id,{id:900,method:'PATCH',body:edit});assert.equal(updated.body.status,'partial');
    assert.equal((await call('/requests/'+r.id,{method:'GET'})).body.adminComment,edit.adminComment);
    assert.equal((await call('/requests/'+r.id,{id:900,method:'PATCH',body:edit})).status,400);
    const decision={version:2,key:r.items[1].key,decision:'accepted'};
    assert.equal((await call('/requests/'+r.id+'/proposal',{id:900,method:'POST',body:decision})).status,403);
    const accepted=await call('/requests/'+r.id+'/proposal',{method:'POST',body:decision});assert.equal(accepted.body.items[1].proposal.decision,'accepted');assert.equal(accepted.body.items[1].product.id,'14501335');
    // A failed Telegram delivery keeps the saved request and durable outbox.
    assert.equal(app.store.pendingNotifications().length,1);assert.equal(sent.length,0);
    networkAvailable=true;await app.flushNotifications();assert.equal(sent.length,1);assert.equal(sent[0].payload.chat_id,'900');assert.equal(app.store.pendingNotifications().length,0);
    assert.equal((await fetch(origin+'/config.json').then(x=>x.json())).mode,'telegram');
    assert.equal((await fetch(origin+'/.env')).status,404);
    const response=await fetch(origin+'/api/requests',{method:'GET',headers:{'X-Telegram-Init-Data':signed(),'Origin':'https://wrong.example'}});assert.equal(response.status,403);
  }finally{await app.close();}
  const reopened=openStore(filename);assert.equal(reopened.list(101).length,1);assert.equal(reopened.list(101)[0].items[1].proposal.decision,'accepted');reopened.close();
  for(const suffix of ['','-wal','-shm'])await unlink(filename+suffix).catch(()=>{});
});
