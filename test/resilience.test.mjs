import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshFundData,fundDataIssues} from '../server/resilience.mjs';
import {fetchMarket} from '../server/providers.mjs';
const now=new Date('2026-10-16T08:00:00+08:00');
const fund={code:'000834',venue:'otc'};
const at=now.toISOString();
const tt={agency:{status:'open',limit:10,observedAt:at},returns:{y1:15,y3:70,y5:90},returnsAsOf:'2026-10-14',performanceSource:'天天基金',navAsOf:'2026-10-14',dailyChange:1,trend:[100,101],trendDates:['2026-10-13','2026-10-14'],navSource:'天天基金',trendSource:'天天基金',observedAt:at};
const jy={...tt,returns:{y1:16,y3:71,y5:91},performanceSource:'恒生聚源',navSource:'恒生聚源',trendSource:'恒生聚源'};
const unavailable=async()=>{throw new Error('failure');};
const wait=async()=>{};
test('主源两次失败后备用数据正常使用，不标记可用字段失败',async()=>{
 let calls=0;const r=await refreshFundData(fund,null,{market:async()=>tt,gildata:async()=>{calls++;throw new Error();},now,wait});
 assert.equal(calls,2);assert.deepEqual(r.unresolved,[]);assert.equal(r.snapshot.returns.y1,15);assert.equal(r.snapshot.marketError,null);assert.equal(r.snapshot.returnsCheckedAt,at);
 assert.deepEqual(fundDataIssues({...fund,...r.snapshot,direct:{status:'open',limit:100},noticeCheckedAt:at},now,['2026-10-15']),[]);
});
test('临时失败只重试有限次数，重试成功清除故障',async()=>{
 let calls=0;const r=await refreshFundData(fund,null,{market:async()=>tt,gildata:async()=>{if(++calls===1)throw new Error();return jy;},now,wait});assert.equal(calls,2);assert.equal(r.gildataSuccess,true);assert.equal(r.snapshot.returns.y1,16);assert.deepEqual(r.diagnostics,[]);
});
test('天天故障不阻止聚源更新，旧额度时间不得跟随新收益刷新',async()=>{
 const previous={...tt,agency:{...tt.agency,observedAt:'2026-10-13T08:00:00+08:00'},observedAt:'2026-10-13T08:00:00+08:00'};
 const r=await refreshFundData(fund,previous,{market:unavailable,gildata:async()=>jy,now,wait});assert.equal(r.snapshot.returns.y1,16);assert.equal(r.snapshot.agency.observedAt,previous.agency.observedAt);assert.deepEqual(r.unresolved,['agency']);
 assert.ok(fundDataIssues({...fund,...r.snapshot,direct:{status:'paused'},noticeCheckedAt:at},now).includes('代销额度待更新'));
});
test('收益与走势都失败时保留缓存及其日期，已抓取的新额度仍保存',async()=>{
 const oldAt='2026-10-13T08:00:00+08:00';const previous={...tt,observedAt:oldAt};
 const r=await refreshFundData(fund,previous,{market:async()=>({agency:{...tt.agency,limit:20},sourceErrors:['returns','nav']}),gildata:unavailable,now,wait});assert.equal(r.snapshot.agency.limit,20);assert.equal(r.snapshot.returns.y1,15);assert.equal(r.snapshot.returnsCheckedAt,oldAt);assert.equal(r.snapshot.navCheckedAt,oldAt);assert.equal(r.snapshot.navAsOf,'2026-10-14');assert.deepEqual(r.unresolved,['returns','nav']);
});
test('全部失败保持缓存，首次失败不得编造零额度或收益；旧日期不能覆盖较新日期',async()=>{
 const previous={...tt,observedAt:'2026-10-13T08:00:00+08:00'};
 const failed=await refreshFundData(fund,previous,{market:unavailable,gildata:unavailable,now,wait});assert.equal(failed.snapshot.observedAt,previous.observedAt);assert.equal(failed.snapshot.agency.limit,10);
 const empty=await refreshFundData(fund,null,{market:unavailable,gildata:unavailable,now,wait});assert.equal(empty.snapshot.agency.status,'unknown');assert.equal(empty.snapshot.returns.y1,null);assert.ok(fundDataIssues({...fund,...empty.snapshot},now).includes('近期走势待补齐'));
 const r=await refreshFundData(fund,{...tt,returnsAsOf:'2026-10-15',navAsOf:'2026-10-15'},{market:async()=>tt,gildata:async()=>jy,now,wait});assert.equal(r.snapshot.returns.y1,15);assert.equal(r.snapshot.navAsOf,'2026-10-15');
});
test('近期观测不能掩盖长期停更的行情日期，年轻基金年限不足不报缺失',()=>{
 const fresh={...fund,...tt,direct:{status:'paused'},noticeCheckedAt:at};
 assert.deepEqual(fundDataIssues({...fresh,established:'2026-01-01',returns:{y1:null,y3:null,y5:null}},now,['2026-10-15']),[]);
 assert.ok(fundDataIssues({...fresh,returnsAsOf:'2026-10-09'},now,['2026-10-12','2026-10-13','2026-10-14','2026-10-15']).includes('历史涨幅待更新'));
});
test('天天行情与费率端点隔离：收益失败不丢额度和走势；历史涨幅缺项不伪造空值覆盖',async()=>{
 const basic={Datas:{FCODE:fund.code,BUY:true,MAXSG:10,ESTABDATE:'2014-01-01',FSRQ:'2026-10-14',RZDF:9}};
 const history={Datas:[{FSRQ:'2026-10-12',DWJZ:'1',JZZZL:'0'},{FSRQ:'2026-10-13',DWJZ:'1.01',JZZZL:'1'}]};
 const request=async endpoint=>{if(endpoint==='FundMNBasicInformation')return basic;if(endpoint==='FundMNHisNetList')return history;throw new Error();};
 const r=await fetchMarket(fund,request);assert.equal(r.agency.limit,10);assert.equal(r.returnsAsOf,undefined);assert.equal(r.navAsOf,'2026-10-13');assert.equal(r.dailyChange,1);assert.deepEqual(r.sourceErrors,['fees','returns']);
 const partial=await fetchMarket(fund,async endpoint=>endpoint==='FundMNPeriodIncrease'?{Expansion:{TIME:'2026-10-14',ESTABDATE:'2014-01-01'},Datas:[{title:'1N',syl:20}]}:request(endpoint));assert.equal(partial.returns,undefined);
});

test('成熟区间缺失与滞后收盘溢价不能被新采集时间掩盖',()=>{
 const f={...fund,...tt,direct:{status:'paused'},noticeCheckedAt:at,established:'2014-01-01',returns:{y1:null,y3:70,y5:90}};
 assert.ok(fundDataIssues(f,now).includes('历史涨幅待补齐'));
 assert.ok(fundDataIssues({...f,venue:'etf',quote:{premium:10,date:'2026-10-14',fetchedAt:at}},now,['2026-10-15']).includes('收盘溢价率待更新'));
});
