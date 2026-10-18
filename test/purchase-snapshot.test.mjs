import test from 'node:test';
import assert from 'node:assert/strict';
import {initialInput,SNAPSHOT_KEY,readPurchaseSnapshot,savePurchaseSnapshot} from '../src/purchase-snapshot.mjs';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
test('新用户默认每月固定投入，历史快照保留用户选择的投入模式',()=>{
 assert.equal(initialInput.mode,'monthly');
 const storage=memory();
 for(const mode of ['fast','steady','monthly']){
  savePurchaseSnapshot(storage,{...initialInput,amount:8000,mode},{},{signature:'x'});
  assert.equal(readPurchaseSnapshot(storage).input.mode,mode);
 }
});
test('成功快照包含输入、公司选择、手选份额、结果及额度签名；恢复不直接信任旧结果',()=>{
 const storage=memory(),input={...initialInput,amount:'8000',channel:'both',selectedManagers:['甲'],includeSmallQuotas:true,ratioMode:'custom',customRatio:73,ratio:73};
 assert.equal(savePurchaseSnapshot(storage,input,{pool:'agency:a'},{signature:'known',amount:8000}),true);
 const saved=JSON.parse(storage.getItem(SNAPSHOT_KEY));assert.equal(saved.result.amount,8000);
 const restored=readPurchaseSnapshot(storage);assert.deepEqual(restored.input,input);assert.deepEqual(restored.choices,{pool:'agency:a'});assert.equal(restored.signature,'known');assert.equal(restored.result,undefined);
 const empty={...input,selectedManagers:[]};savePurchaseSnapshot(storage,empty,{},saved.result);assert.deepEqual(readPurchaseSnapshot(storage).input.selectedManagers,[]);
});
test('空存储、损坏或不兼容快照以及拒绝存储均安全回退',()=>{
 const storage=memory();assert.equal(readPurchaseSnapshot(storage),null);
 for(const raw of ['{','null','[]',JSON.stringify({version:2})]){storage.setItem(SNAPSHOT_KEY,raw);assert.equal(readPurchaseSnapshot(storage),null);}
 const broken={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};
 assert.equal(readPurchaseSnapshot(broken),null);assert.equal(savePurchaseSnapshot(broken,initialInput,{},{}),false);
 savePurchaseSnapshot(storage,{...initialInput,amount:8000,selectedManagers:'甲'},{},{signature:'x'});assert.equal(readPurchaseSnapshot(storage),null);
});
test('还原比例选项时重建实际比例，不沿用冲突数字；不活跃输入的残留无效值不阻塞恢复',()=>{
 const storage=memory();
 for(const [ratioMode,expected] of [['nasdaq',100],['sp500',0],['any','any'],['custom',65]]){
  savePurchaseSnapshot(storage,{...initialInput,amount:1000,ratioMode,customRatio:65,ratio:17,weeks:''},{},{signature:'x'});
  assert.equal(readPurchaseSnapshot(storage).input.ratio,expected);
  assert.equal(readPurchaseSnapshot(storage).input.weeks,12);
 }
});
test('指数偏好随快照还原；旧无比例快照保留输入并要求确认重算',()=>{
 const storage=memory();
 for(const ratioMode of ['any-sp500','any-nasdaq']){
  const input={...initialInput,amount:8000,ratioMode,ratio:'any'};
  savePurchaseSnapshot(storage,input,{pool:false},{signature:'x'});
  const restored=readPurchaseSnapshot(storage);assert.deepEqual(restored.input,input);assert.equal(restored.needsRecalculation,false);
 }
 savePurchaseSnapshot(storage,{...initialInput,amount:8000,ratioMode:'any',ratio:'any'},{pool:false},{signature:'x'});
 const legacy=readPurchaseSnapshot(storage);assert.equal(legacy.input.amount,8000);assert.equal(legacy.input.ratioMode,'any-sp500');assert.equal(legacy.needsRecalculation,true);assert.deepEqual(legacy.choices,{pool:false});
});
