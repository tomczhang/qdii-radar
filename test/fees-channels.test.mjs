import {totalQuota} from '../src/summary.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFeePage,parseRate} from '../server/fees.mjs';
import {resolveChannelScope,attachChannelScopes} from '../server/channel-scopes.mjs';
import {refreshFundData} from '../server/resilience.mjs';
const fee=(rate=0,annual=1)=>({subscription:[{min:0,max:null,agencyRate:rate,standardRate:rate}],annualRate:annual});
const q=(limit,scope={mode:'independent'})=>({status:'open',limit,scope});
const f={code:'a',name:'测试',share:'A',index:'nasdaq',manager:'公司',agency:q(10),direct:q(100),channelScope:{mode:'independent'},fees:fee()};
test('真实费率页面：费率分层、C零申购费不等于零年度费用、缺失不补零',()=>{
 const a=parseFeePage(readFileSync(new URL('./fixtures/fees/000834.html',import.meta.url),'utf8'),'000834');
 assert.equal(a.annualRate,1);assert.equal(a.subscription[0].agencyRate,0.12);assert.equal(a.subscription[0].standardRate,1.2);


 const c=parseFeePage(readFileSync(new URL('./fixtures/fees/019442.html',import.meta.url),'utf8'),'019442');
 assert.equal(c.annualRate,0.85);
 assert.equal(parseRate('--'),null);assert.equal(parseRate('0.00%'),0);assert.equal(parseRate('-1%'),null);
 assert.throws(()=>parseFeePage('bad','000834'));
 const partial=parseFeePage('000834 管理费率 0.50%','000834');assert.equal(partial.annualRate,null);
});
test('真实渠道规则：生效日期、新公告失效、费率陈旧各自独立',()=>{
 assert.equal(resolveChannelScope('000834','2026-10-16').mode,'independent');
 assert.equal(resolveChannelScope('000834','2026-06-03').mode,'unknown');
 assert.equal(resolveChannelScope('023422','2026-10-16').mode,'unknown');
 assert.equal(resolveChannelScope('000834','2026-10-16',[{code:'008971',id:'new',title:'调整大额申购限额',publishedAt:'2026-10-16'}]).mode,'unknown');
 const stamped=attachChannelScopes([{...f,fees:{...fee(),observedAt:'2026-10-01'}}],[],new Date('2026-10-16T12:00:00Z'));
 assert.equal(stamped[0].fees.stale,true);
});
test('费率请求失败保留旧费率和采集时间，其他字段成功仍更新',async()=>{
 const old={...f,fees:{...fee(),observedAt:'2026-10-01'},observedAt:'2026-10-01'};
 const {snapshot}=await refreshFundData(f,old,{enabled:false,market:async()=>({agency:q(20),sourceErrors:['fees']}),now:new Date('2026-10-16T12:00:00Z')});
 assert.deepEqual(snapshot.fees,old.fees);assert.equal(snapshot.agency.limit,20);
});
test('宝盈按同一基金账户跨渠道共用、A/C分别10元，公告生效前不倒填关系',()=>{
 const codes=['019736','019737'];
 const funds=codes.map((code,i)=>({...f,code,share:i?'C':'A',name:'宝盈纳斯达克100',agency:q(10),direct:q(10),channelScope:resolveChannelScope(code,'2026-10-16')}));
 assert.equal(resolveChannelScope(codes[0],'2026-09-27').mode,'unknown');
 for(const fund of funds)assert.equal(fund.channelScope.mode,'shared');
 assert.equal(totalQuota(funds,'both').amount,20);
 assert.equal(resolveChannelScope(codes[0],'2026-10-17',[{code:codes[0],id:'new',title:'调整申购限额公告',publishedAt:'2026-10-17'}]).mode,'unknown');
});

test('南方、摩根按份额跨渠道共用；华泰柏瑞跨份额跨渠道共用5元',()=>{
 const families=[{codes:['016452','016453'],from:'2026-07-09',limit:10,total:20},{codes:['017641','019305'],from:'2026-07-27',limit:10,total:20},{codes:['019172','019173'],from:'2026-07-27',limit:10,total:20},{codes:['019524','019525','022664'],from:'2026-09-22',limit:5,total:5,shared:true}];
 for(const family of families){
   const funds=family.codes.map((code,i)=>({...f,code,share:['A','C','I'][i],agency:q(family.limit,family.shared?{mode:'shared',groupId:'agency:test',codes:family.codes,cap:5}:{mode:'independent'}),direct:q(family.limit,family.shared?{mode:'shared',groupId:'direct:test',codes:family.codes,cap:5}:{mode:'independent'}),channelScope:resolveChannelScope(code,'2026-10-16')}));
   for(const fund of funds){assert.equal(fund.channelScope.mode,'shared');assert.equal(fund.channelScope.from,family.from);}
   assert.equal(totalQuota(funds,'both').amount,family.total);
 }
 assert.equal(resolveChannelScope('021000','2026-10-16').mode,'unknown','南方I不被A/C规则覆盖');
});
