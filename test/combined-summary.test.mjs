import test from 'node:test';
import assert from 'node:assert/strict';
import {totalQuota,totalHistoricalQuota} from '../src/summary.mjs';
import {attachChannelScopes,resolveChannelScope} from '../server/channel-scopes.mjs';
import {attachShareScopes} from '../server/share-scopes.mjs';
import {createFeeChannelComparator} from '../src/fund-sort.mjs';
const q=(limit,scope={mode:'independent'})=>({status:'open',limit,scope});
const fund=(code,mode='unknown',agency=10,direct=100)=>({code,index:'nasdaq',channelScope:{mode},agency:q(agency),direct:q(direct)});
const history=(agency,direct)=>({calendarReady:true,windowDays:20,startDate:'2026-09-01',endDate:'2026-09-30',agency:{daily:agency},direct:{daily:direct}});
const dates=Array.from({length:20},(_,i)=>`2026-09-${String(i+1).padStart(2,'0')}`);
test('总额度：独立相加，共用取同一额度，未知保守择一，未知不冒充完整',()=>{
 for(const mode of ['independent','shared','unknown']){
  const result=totalQuota([fund('a',mode)],'both');
  assert.equal(result.amount,mode==='independent'?110:100);
  assert.equal(result.channelUnknown,mode==='unknown'?1:0);
  assert.equal(result.open,1);
 }
 const mixed=totalQuota([fund('a','independent'),fund('b','shared'),fund('c')],'both');
 assert.equal(mixed.amount,310);assert.equal(mixed.channelUnknown,1);
 assert.equal(totalQuota([{code:'z',agency:{status:'unknown'},direct:{status:'unknown'}}],'both').amount,null);
 assert.equal(totalQuota([{code:'z',agency:{status:'paused'},direct:{status:'unavailable'}}],'both').amount,0);
 assert.equal(totalQuota([{...fund('z'),venue:'etf'}],'both').amount,null);
});
test('份额共享先去重再叠加渠道；缺失组成员codes时仍按实际份额去重',()=>{
 const funds=['a','c'].map(code=>({...fund(code,'independent'),agency:q(10,{mode:'shared',groupId:'agency:pool',cap:10}),direct:q(100,{mode:'shared',groupId:'direct:pool',cap:100})}));
 assert.equal(totalQuota(funds,'both').amount,110);
 assert.equal(totalQuota(funds.map(f=>({...f,channelScope:{mode:'shared'}})),'both').amount,100);
 const conflict=funds.map((f,i)=>({...f,direct:q(100,{mode:'shared',groupId:'direct:pool',cap:i?90:100})}));
 const total=totalQuota(conflict,'both');assert.equal(total.amount,10);assert.equal(total.scopeUnknown,2);
});
test('未知跨渠道关联以整组渠道小计择一，不丢掉同渠道内多个独立份额的额度',()=>{
 const funds=['a','c'].map(code=>({...fund(code),agency:q(10,{mode:'shared',groupId:'agency:pool',codes:['a','c'],cap:10}),direct:q(100)}));
 assert.equal(totalQuota(funds,'both').amount,200);
 assert.equal(totalQuota(funds,'direct').amount,200);
 const separate=funds.map(f=>({...f,agency:q(10,{mode:'independent',codes:['a','c']})}));
 assert.equal(totalQuota(separate,'both').amount,200);
});
test('历史逐日渠道变更：不把今日独立规则倒填、不把共享两次计入',()=>{
 const rows=limit=>dates.map((date,i)=>({...q(limit),date,channelScope:{mode:i<10?'shared':'independent'}}));
 const f={...fund('a','independent'),stability:history(rows(10),rows(100))};
 const total=totalHistoricalQuota([f],'both');
 assert.equal(total.amount,10*100+10*110);assert.equal(total.complete,true);assert.equal(total.completeCount,1);
 const old={...f,stability:history(rows(10).map(({channelScope,...r})=>r),rows(100).map(({channelScope,...r})=>r))};
 const unknown=totalHistoricalQuota([old],'both');assert.equal(unknown.amount,2000);assert.equal(unknown.complete,false);assert.equal(unknown.channelUnknownDays,20);
});
test('历史逐日先合并共享份额；重复记录只留最后一条，缺失和休市不混为一谈',()=>{
 const rows=(channel,limit)=>dates.map(date=>({...q(limit,{mode:'shared',groupId:channel+':pool',codes:['a','c'],cap:limit}),date,channelScope:{mode:'independent'}}));
 const funds=['a','c'].map(code=>({...fund(code,'independent'),stability:history(rows('agency',10),rows('direct',100))}));
 assert.equal(totalHistoricalQuota(funds,'both').amount,2200);
 const a=dates.map(date=>({...q(10),date,channelScope:{mode:'independent'}}));
 const d=dates.map(date=>({...q(100),date,channelScope:{mode:'independent'}}));
 const total=totalHistoricalQuota([{...fund('x'),stability:history([...a,{...a[0],status:'paused',limit:0},{...a[0],date:'2026-10-01',limit:999999}],d.slice(1))}],'both');
 assert.equal(total.amount,19*110);assert.equal(total.unknownDays,1);assert.equal(total.complete,false);
 const zero=totalHistoricalQuota([{code:'z',stability:history(a.map(r=>({...r,status:'paused',limit:0})),d.map(r=>({...r,status:'paused',limit:0})))}],'both');
 assert.equal(zero.amount,0);assert.equal(zero.complete,true);
 assert.equal(totalHistoricalQuota([{...fund('missing'),stability:history([],[])}],'both').amount,null);
});
test('真实万家历史：9/9渠道独立、9/10全渠道共享、9/23渠道独立但份额共享',()=>{
 assert.equal(resolveChannelScope('019441','2026-09-09').mode,'independent');
 assert.equal(resolveChannelScope('019441','2026-09-10').mode,'shared');
 assert.equal(resolveChannelScope('019441','2026-09-23').mode,'independent');
 const days=['2026-09-09','2026-09-10','2026-09-23'];
 const rows=channel=>days.map((date,i)=>({date,...q((channel==='direct'?[20000,100,100]:[5000,100,10])[i])}));
 const funds=['019441','019442'].map(code=>({...fund(code),stability:history(rows('agency'),rows('direct'))}));
 const attached=attachChannelScopes(attachShareScopes(funds,[],new Date('2026-10-16')),[],new Date('2026-10-16'));
 assert.deepEqual(attached[0].stability.agency.daily.map(r=>r.channelScope.mode),['independent','shared','independent']);
 assert.equal(totalHistoricalQuota(attached,'both').amount,50000+200+110);
 assert.equal(totalHistoricalQuota(attached,'both').complete,false);
 // A newly published rule invalidates only subsequent dates, not prior history.
 const invalidated=attachChannelScopes(attached,[{id:'new',code:'019441',title:'调整大额申购限额',publishedAt:'2026-10-16'}],new Date('2026-10-16'));
 assert.equal(invalidated[0].channelScope.mode,'unknown');assert.equal(invalidated[0].stability.agency.daily.at(-1).channelScope.mode,'independent');
});
test('费率排序使用数值，零费率有效；缺失、过期和未知渠道在双向排序中均置后',()=>{
 const funds=[{code:'a',fees:{annualRate:1.2,subscription:[{min:0,agencyRate:0.12}]},channelScope:{mode:'independent'}},{code:'c',fees:{annualRate:0,subscription:[{min:0,agencyRate:0}]},channelScope:{mode:'shared'}},{code:'u',fees:{annualRate:null},channelScope:{mode:'unknown'}},{code:'s',fees:{annualRate:0.1,stale:true}}];
 assert.deepEqual([...funds].sort(createFeeChannelComparator('annualFee','asc')).map(f=>f.code),['c','a','s','u']);
 assert.deepEqual([...funds].sort(createFeeChannelComparator('annualFee','desc')).map(f=>f.code),['a','c','s','u']);
 assert.deepEqual([...funds].sort(createFeeChannelComparator('agencyFee','asc')).slice(0,2).map(f=>f.code),['c','a']);
 assert.deepEqual([...funds].sort(createFeeChannelComparator('channelScope','desc')).slice(0,2).map(f=>f.code),['a','c']);
 assert.deepEqual([...funds].sort(createFeeChannelComparator('channelScope','asc')).slice(0,2).map(f=>f.code),['c','a']);
});
