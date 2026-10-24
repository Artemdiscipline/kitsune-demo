import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../dist/shared/catalog.js';
import {createRequest,updateRequest,decideProposal,total,validateCustomer,effectiveItems,addMessage,requestMessages,formatRequestSummary,normalizeRequest} from '../dist/shared/model.js';
const customer={name:'Тест',method:'telegram',contact:'@demo_user',comment:'Нужна помощь с размером'};
const input=()=>({items:[{productId:catalog[0].id,quantity:1,helpSize:true},{productId:catalog[1].id,quantity:1,helpSize:false}],customer,idempotencyKey:'test-model-0001'});
const patch=(r,availability=['available','clarify'],action='save')=>({version:r.version,action,adminComment:'По второй позиции уточняем размер',items:r.items.map((i,n)=>({key:i.key,availability:availability[n],proposedId:''}))});

test('request snapshots survive later catalogue mutation, identical lines merge',()=>{
  const products=structuredClone(catalog), data=input();data.items.push({...data.items[0]});
  const r=createRequest(data,products);assert.equal(r.items.length,2);assert.equal(r.items[0].quantity,2);
  products[0].price=99999;products[0].name='Другое название';
  assert.equal(r.items[0].product.price,1500);assert.equal(r.items[0].product.name,'Накрутка');assert.equal(total(r.items).known,5200);
});
test('partial stock never confirms the entire list; stale edits fail',()=>{
  const r=createRequest(input(),catalog);assert.equal(r.status,'pending');
  assert.throws(()=>updateRequest(r,patch(r,undefined,'confirm'),catalog),/каждой позиции/);
  const next=updateRequest(r,patch(r),catalog);assert.equal(next.status,'partial');assert.equal(next.version,2);
  assert.throws(()=>updateRequest(next,patch(r),catalog),/уже изменён/);
  assert.equal(r.items[0].availability,'pending');
  assert.equal(updateRequest(next,patch(next,['available','available'],'confirm'),catalog).status,'confirmed');
  assert.equal(updateRequest(next,patch(next,['available','available'],'clarify'),catalog).status,'clarify');
});
test('proposals preserve the original choice and require an explicit customer decision',()=>{
  const r=createRequest(input(),catalog), p=patch(r);p.items[1].proposedId=catalog[3].id;
  const offered=updateRequest(r,p,catalog);assert.equal(offered.items[1].proposal.decision,'pending');
  const accepted=decideProposal(offered,offered.items[1].key,'accepted',offered.version);
  assert.equal(accepted.items[1].product.id,catalog[1].id);assert.equal(accepted.items[1].proposal.product.id,catalog[3].id);
  assert.equal(accepted.items[1].proposal.decision,'accepted');assert.equal(offered.items[1].proposal.decision,'pending');
  assert.throws(()=>decideProposal(accepted,accepted.items[1].key,'accepted',accepted.version),/уже обработано/);
});
test('unknown prices remain unknown rather than free',()=>{
  const r=createRequest(input(),catalog);r.items[1].product.price=null;
  assert.deepEqual(total(r.items),{known:1500,unknown:true});
});
test('empty selection, malformed contacts and quantities are rejected',()=>{
  assert.throws(()=>createRequest({...input(),items:[]},catalog),/Выберите/);
  assert.throws(()=>validateCustomer({...customer,contact:''}),/Telegram/);
  assert.throws(()=>validateCustomer({...customer,method:'phone',contact:'abc'}),/телефон/);
  assert.throws(()=>validateCustomer({...customer,method:'bot'}),/Telegram/);
  assert.equal(validateCustomer({...customer,method:'bot'},{id:42}).contact,'Telegram ID 42');
  assert.throws(()=>createRequest({...input(),items:[{productId:catalog[0].id,quantity:0}]},catalog),/Количество/);
  assert.throws(()=>createRequest({...input(),items:[{productId:'invented',quantity:1}]},catalog),/нет в каталоге/);
});
test('accepted replacement changes the current total and requires its own availability confirmation',()=>{
  const data=input();data.items[1].productId=catalog[3].id;
  const r=createRequest(data,catalog), p=patch(r,['available','unavailable']);p.items[1].proposedId=catalog[4].id;
  const offered=updateRequest(r,p,catalog);
  assert.equal(total(effectiveItems(offered)).known,4000);
  const accepted=decideProposal(offered,offered.items[1].key,'accepted',offered.version);
  assert.equal(total(effectiveItems(accepted)).known,4500);
  assert.equal(effectiveItems(accepted)[1].availability,'pending');
  assert.equal(accepted.items[1].product.id,catalog[3].id);
  assert.equal(accepted.items[1].product.price,2500);
  const confirm=patch(accepted,['available','pending'],'confirm');confirm.items[1].proposedId=catalog[4].id;
  assert.throws(()=>updateRequest(accepted,confirm,catalog),/каждой позиции/);
  confirm.items[1].availability='available';
  const final=updateRequest(accepted,confirm,catalog);
  assert.equal(final.status,'confirmed');assert.equal(final.items[1].availability,'unavailable');
  assert.equal(final.items[1].proposal.availability,'available');
  assert.throws(()=>updateRequest(accepted,patch(accepted),catalog),/уже принял/);
  assert.match(formatRequestSummary(final),/4\s500 ₽/);assert.match(formatRequestSummary(final),/14495080/);
});
test('clarifications preserve author, immutable history and reject stale or duplicate-conflicting messages',()=>{
  const r=createRequest(input(),catalog), first=updateRequest(r,patch(r),catalog);
  const message={text:'Размер не знаю, нужна помощь мастера',id:'client-message-0001',version:first.version};
  const reply=addMessage(first,message,'client');
  assert.equal(reply.messages.length,2);assert.equal(reply.messages[1].author,'client');assert.equal(first.messages.length,1);
  assert.equal(addMessage(reply,message,'client'),reply);
  assert.throws(()=>addMessage(reply,{...message,id:'another-message-0002'},'client'),/уже изменён/);
  assert.throws(()=>addMessage(reply,{...message,text:'Другое сообщение'},'client'),/уже использован/);
  assert.throws(()=>addMessage(reply,{...message,text:'',version:reply.version},'client'),/Напишите/);
  const sameComment=patch(reply);const saved=updateRequest(reply,sameComment,catalog);
  assert.equal(saved.messages.length,2);
  const legacy={...r,adminComment:'Старый комментарий'};delete legacy.messages;
  assert.equal(requestMessages(legacy)[0].text,'Старый комментарий');
  assert.throws(()=>addMessage({...reply,status:'closed'},{text:'Тест',id:'closed-message-001',version:reply.version},'client'),/закрыт/);
  assert.throws(()=>updateRequest({...reply,status:'closed'},patch(reply),catalog),/закрыт/);
});
test('old accepted replacements do not inherit the original item availability',()=>{
  const r=createRequest(input(),catalog), p=patch(r,['available','available'],'confirm');p.items[1].proposedId=catalog[3].id;
  const old=updateRequest(r,p,catalog);old.items[1].proposal.decision='accepted';delete old.items[1].proposal.availability;
  const migrated=normalizeRequest(old);
  assert.equal(migrated.status,'partial');assert.equal(effectiveItems(migrated)[1].availability,'pending');
  assert.equal(old.status,'confirmed');assert.equal(migrated.items[1].product.price,2200);
});
