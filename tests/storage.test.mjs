import test from 'node:test';
import assert from 'node:assert/strict';
import {STORAGE,readState,writeState} from '../dist/storage.js';
import {createRequest} from '../dist/shared/model.js';
import {catalog} from '../dist/shared/catalog.js';
test('failed persistence preserves selection and creates no successful request',()=>{
  const initial={cart:[{productId:'14501338',quantity:1,helpSize:true}],requests:[],checkoutToken:'storage-test-0001'};
  const request=createRequest({items:initial.cart,customer:{name:'Тест',method:'telegram',contact:'@demo_user'},idempotencyKey:initial.checkoutToken},catalog);
  const next={...initial,cart:[],requests:[request]};
  const storage={setItem:()=>{throw new Error('QuotaExceededError');}};
  let current=initial;
  assert.throws(()=>{current=writeState(next,true,storage);},/не смог сохранить/);
  assert.equal(current.cart.length,1);assert.equal(current.requests.length,0);
});
test('browser reload restores the exact request and connected mode excludes personal records',()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const state={cart:[],requests:[{id:'KS-TEST',status:'partial',adminComment:'Уточняем'}],customer:{name:'Тест',contact:'@demo_user'}};
  writeState(state,true,storage);assert.deepEqual(readState({},storage).requests,state.requests);
  writeState(state,false,storage);const saved=JSON.parse(memory.get(STORAGE));
  assert.deepEqual(saved.requests,[]);assert.equal(saved.customer.contact,'');
});
