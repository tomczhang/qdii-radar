import test from 'node:test';
import assert from 'node:assert/strict';
import {groupFunds,groupRules,selectFundGroups,groupSortValue} from '../src/fund-groups.mjs';
const fund = (code,share,codes,extra={}) => ({code,share,name:'测试纳指',legalName:'测试基金',manager:'测试',index:'nasdaq',currency:'CNY',venue:'otc',returns:{y1:10},agency:{status:'open',limit:10,scope:{mode:'independent',basis:'announcement',codes}},direct:{status:'open',limit:10,scope:{mode:'independent',basis:'announcement',codes}},channelScope:{mode:'shared'},...extra});

test('channel-shared A/C add once per share; separately governed I stays outside',()=>{
 const funds=[fund('1','A',['1','2']),fund('2','C',['1','2']),fund('3','I',['3'])];
 const groups=groupFunds(funds);
 assert.equal(groups.length,2);assert.equal(groups[0].total.amount,20);assert.equal(groups[1].total.amount,10);
 assert.deepEqual(groupRules(groups[0]),{channel:'直销与代销共用',shares:'各份额分别计算，可相加'});
 assert.equal(groups.reduce((n,g)=>n+g.members.length,0),3);
});
test('a shared A/C/I cap is counted only once across both channels',()=>{
 const codes=['1','2','3'];const funds=codes.map((code,i)=>fund(code,['A','C','I'][i],codes));
 for(const f of funds)for(const c of ['agency','direct'])f[c]={status:'open',limit:5,scope:{mode:'shared',codes,cap:5,groupId:c+':test'}};
 const [group]=groupFunds(funds);assert.equal(group.total.amount,5);assert.equal(groupRules(group).shares,'A/C/I 共用一份额度');
});
test('code search and open filter retain complete group, including paused siblings',()=>{
 const funds=[fund('1','A',['1','2']),fund('2','C',['1','2'],{agency:{status:'paused'},direct:{status:'paused'}})];
 const groups=selectFundGroups(groupFunds(funds),{query:'2',onlyOpen:true});
 assert.equal(groups.length,1);assert.equal(groups[0].members.length,2);assert.equal(groups[0].total.amount,10);
 assert.equal(selectFundGroups(groups,{query:'absent'}).length,0);
});
test('unrelated legal funds and currencies never merge',()=>{
 const a=fund('1','A',['1','2']);
 assert.equal(groupFunds([a,fund('2','C',['1','2'],{legalName:'另一个基金'})]).length,2);
 assert.equal(groupFunds([a,fund('2','C',['1','2'],{currency:'USD'})]).length,2);
});
test('group sorting uses disclosed minimum fees and maximum returns; unknown last',()=>{
 const groups=groupFunds([fund('1','A',['1','2'],{fees:{annualRate:1}}),fund('2','C',['1','2'],{fees:{annualRate:0.5},returns:{y1:20}}),fund('3','I',['3'],{fees:{annualRate:0.8}}),fund('4','D',['4'],{returns:{}})]);
 assert.equal(groupSortValue(groups[0],'annualFee'),0.5);assert.equal(groupSortValue(groups[0],'y1'),20);
 assert.deepEqual(selectFundGroups(groups,{sort:'annualFee:desc'}).map(g=>g.id),['3','1-2','4']);
});
test('unknown channel relation stays conservative and is never labeled shared',()=>{
 const f=fund('1','A',['1'],{channelScope:{mode:'unknown'}});const [group]=groupFunds([f]);
 assert.equal(group.total.amount,10);assert.equal(group.total.channelUnknown,1);assert.equal(groupRules(group).channel,'渠道关系待确认');
});

test('channel checkboxes use OR availability, never filter group members or recompute totals',()=>{
 const a=fund('1','A',['1','2'],{agency:{status:'paused'},channelScope:{mode:'independent'}});
 const c=fund('2','C',['1','2'],{direct:{status:'unavailable'},channelScope:{mode:'independent'}});
 const paused=fund('3','I',['3'],{agency:{status:'paused',scope:{codes:['3']}},direct:{status:'unknown',scope:{codes:['3']}}});
 const groups=groupFunds([a,c,paused]);
 assert.equal(selectFundGroups(groups,{channels:[]}).length,2);
 for(const channels of [['direct'],['agency'],['direct','agency']]) {
  const result=selectFundGroups(groups,{channels});
  assert.equal(result.length,1);assert.equal(result[0].members.length,2);assert.equal(result[0].total.amount,20);
 }
});
test('share badges distinguish verified independence, default assumptions and sharing scope',async()=>{
 const {shareRuleBadge}=await import('../src/fund-groups.mjs');
 const codes=['1','2','3'];const members=codes.map((c,i)=>fund(c,['A','C','I'][i],codes));
 const group={members,shares:'A/C/I'};
 assert.equal(shareRuleBadge(group).label,'份额独立');
 members[0].agency.scope.basis='default';assert.equal(shareRuleBadge(group).label,'待确认');
 members[0].agency.scope.basis='announcement';
 for(const f of members)for(const channel of ['agency','direct'])f[channel].scope={mode:'shared',codes};
 assert.equal(shareRuleBadge(group).label,'A/C/I共享');
 for(const f of members.slice(0,2))for(const channel of ['agency','direct'])f[channel].scope={mode:'shared',codes:['1','2']};
 for(const channel of ['agency','direct'])members[2][channel].scope={mode:'independent'};
 assert.equal(shareRuleBadge(group).label,'A/C共享');
 members[0].agency.scope={mode:'independent'};assert.equal(shareRuleBadge(group).label,'部分共享');
 members[0].agency.scope={mode:'unknown'};assert.equal(shareRuleBadge(group).label,'待确认');
 assert.equal(shareRuleBadge({members:[members[2]]}).label,'份额独立');
});
