import test from 'node:test';
import assert from 'node:assert/strict';
import {gildataConnection, parseGildataResponse, mergeGildata} from '../server/gildata.mjs';
const fund={code:'000834'};
function fixture({code='000834',date='2026-10-14',established='2014-11-13',periods=[['近一年','13.37'],['近三年','73.24'],['近五年','89.99']],navs=[['2026-10-13','6.4580','-0.3380'],['2026-10-14','6.3249','-2.0610']]}={}){
 const table=(headers,rows)=>'|'+headers.join('|')+'|\n|'+headers.map(()=>'---').join('|')+'|\n'+rows.map(r=>'|'+r.join('|')+'|').join('\n');
 return {content:[{type:'text',text:JSON.stringify({code:0,results:[
 {api_name:'阶段业绩表现',table_markdown:table(['基金代码','基金成立日','截止日期','时间区间','基金收益率(%)'],periods.map(([period,value])=>[code,established,date,period,value]))},
 {api_name:'净值表现',table_markdown:table(['基金代码','截止日期','复权单位净值(元)','单位基金净值增长率(%)'],navs.map(row=>[code,...row]))}
 ]})}]};
}
test('官方HTTP地址使用独立环境Token，缺少Token不误报已配置；可显式用Bearer',()=>{
 const q=gildataConnection({GILDATA_MCP_TOKEN:'test-secret'});assert.equal(q.protocol,'http');assert.equal(q.url.searchParams.get('token'),'test-secret');assert.deepEqual(q.headers,{});
 assert.equal(gildataConnection({}),null);
 const b=gildataConnection({GILDATA_MCP_TOKEN:'test-secret',GILDATA_MCP_AUTH:'bearer',GILDATA_MCP_URL:'https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool?token=old'});
 assert.equal(b.url.searchParams.has('token'),false);assert.equal(b.headers.Authorization,'Bearer test-secret');
 assert.throws(()=>gildataConnection({GILDATA_MCP_TOKEN:'secret',GILDATA_MCP_URL:'http://example.test'}));
});
test('实测结构解析收益与复权净值，日涨幅和净值日同步更新',()=>{
 const d=parseGildataResponse(fixture(),fund,'2026-10-15');
 assert.deepEqual(d.returns,{y1:13.37,y3:73.24,y5:89.99});assert.equal(d.returnsAsOf,'2026-10-14');assert.equal(d.navAsOf,'2026-10-14');assert.equal(d.dailyChange,-2.061);
 assert.deepEqual(d.trendDates,['2026-10-13','2026-10-14']);assert.equal(d.trend[0],100);assert.ok(d.trend[1]<100);assert.equal(d.trendSource,'恒生聚源');
});
test('代码、日期、缺失和冲突不符合要求时拒绝覆盖；年限不足留空',()=>{
 assert.throws(()=>parseGildataResponse(fixture({code:'000835'}),fund,'2026-10-15'));
 assert.throws(()=>parseGildataResponse(fixture({date:'2026-10-16'}),fund,'2026-10-15'));
 assert.throws(()=>parseGildataResponse(fixture({periods:[['近一年','13.37']]}),fund,'2026-10-15'));
 assert.throws(()=>parseGildataResponse(fixture({periods:[['近一年','13.37'],['近一年','14.00']]}),fund,'2026-10-15'));
 assert.throws(()=>parseGildataResponse(fixture({navs:[['2026-10-14','0','--']]}),fund,'2026-10-15'));
 assert.deepEqual(parseGildataResponse(fixture({established:'2024-01-01'}),fund,'2026-10-15').returns,{y1:13.37,y3:null,y5:null});
});
test('只用同组较新数据替换；不会把旧日期的日涨幅拼到新走势',()=>{
 const d=parseGildataResponse(fixture(),fund,'2026-10-15');
 const old={returns:{y1:14.99},returnsAsOf:'2026-10-13',navAsOf:'2026-10-13',dailyChange:-.34,trend:[100,101],trendDates:['2026-10-12','2026-10-13'],marketSource:'天天基金',agency:{status:'open',limit:10}};
 const fresh=mergeGildata(old,d);assert.equal(fresh.dailyChange,-2.061);assert.equal(fresh.navAsOf,'2026-10-14');assert.equal(fresh.marketSource,'恒生聚源');assert.equal(fresh.agency.limit,10);
 const keep=mergeGildata({...old,returnsAsOf:'2026-10-15',navAsOf:'2026-10-15'},d);assert.equal(keep.dailyChange,-.34);assert.equal(keep.marketSource,'天天基金');assert.deepEqual(keep.trend,old.trend);
 const mixed=mergeGildata({...old,navAsOf:'2026-10-15'},d);assert.equal(mixed.performanceSource,'恒生聚源');assert.equal(mixed.trendSource,'天天基金');assert.equal(mixed.dailyChange,-.34);
});
