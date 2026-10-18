import {quotaContribution} from '../shared/quota-scope.mjs';
import {costScore,estimateCosts} from '../shared/fees.mjs';
const feeCompare = (years = null,basis = 'subscription') => (a,b) => { const av=costScore(a,years,basis),bv=costScore(b,years,basis); return (av===bv?0:av-bv) || (Number.isFinite(av)&&Number.isFinite(bv)?costScore(a,null,basis==='annual'?'subscription':'annual')-costScore(b,null,basis==='annual'?'subscription':'annual'):0) || b.limit-a.limit || textCompare(a.code,b.code); };
const optionKey = o => o.optionId || o.code;
const accountKey = r => r.channel === 'agency' ? `:agency:${r.platform || '天天基金'}` : r.manager || r.id;
const indices = ['nasdaq', 'sp500'];
const cents = value => Math.round(Number(value) * 100);
const returnValue = (row, years) => Number.isFinite(row.returns?.[`y${years}`]) ? row.returns[`y${years}`] : null;
const returnCompare = years => (a,b) => {
  const av=returnValue(a,years),bv=returnValue(b,years);
  return (av==null)-(bv==null) || (av==null?0:bv-av) || b.limit-a.limit || textCompare(a.code,b.code);
};
const availableCents = row => cents(row.planningLimit ?? row.limit);
const textCompare = (a, b) => String(a).localeCompare(String(b), 'zh-CN');

// Apply A/C preference within the same fund and purchase venue, without
// comparing an unrelated fund's share class or discarding independent capacity.
function orderCandidates(rows, compare, strategy, preserveCapacity = false) {
  const ordered = [...rows].sort(compare), families = new Map();
  ordered.forEach((row,i) => {
    if (!row.name || !['A','C'].includes(row.share)) return;
    const key = JSON.stringify([row.manager,row.legalName || row.name,row.index,row.channel,row.platform,preserveCapacity ? row.limit : null]);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(i);
  });
  const preferred = strategy === 'maintenance' ? 'C' : 'A';
  for (const positions of families.values()) {
    const siblings = positions.map(i=>ordered[i]).sort((a,b)=>(a.share!==preferred)-(b.share!==preferred));
    positions.forEach((position,i)=>{ordered[position]=siblings[i];});
  }
  return ordered;
}

// Independent shares each participate; a shared quota pool selects one purchase share.
export function purchaseCandidates(funds, channel) {
  if (channel === 'both') {
    const groups = [...purchaseCandidates(funds,'agency'),...purchaseCandidates(funds,'direct')];
    const parent=groups.map((_,i)=>i), root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
    // Unite overlapping pools across channels unless independence is verified for
    // every overlapping share. Unknown relationships never multiply capacity.
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++) {
      if(groups[i].channel===groups[j].channel)continue;
      const codes=new Set(groups[i].options.flatMap(o=>o.scope?.mode==='shared' ? o.scope.codes || [o.code] : [o.code]));
      const overlap=groups[j].options.flatMap(o=>o.scope?.mode==='shared' ? o.scope.codes || [o.code] : [o.code]).filter(code=>codes.has(code));
      if(overlap.some(code=>funds.find(f=>f.code===code)?.channelScope?.mode!=='independent'))parent[root(j)]=root(i);
    }
    const merged=new Map();
    groups.forEach((g,i)=>{const key=root(i);if(!merged.has(key))merged.set(key,[]);merged.get(key).push(g);});
    return [...merged.values()].map(list=>list.length===1?list[0]:{
      ...list[0],id:JSON.stringify(['both',...list.map(g=>g.id).sort()]),channel:'choice',
      channelNote:'渠道共用或关系待确认，仅选一个渠道；不叠加',
      options:list.flatMap(g=>g.options).sort((a,b)=>b.limit-a.limit || textCompare(a.channel,b.channel) || textCompare(a.code,b.code)),
    });
  }
  const groups = new Map();
  for (const f of funds) {
    const q = f[channel];
    if (f.venue === 'etf' || (f.currency && f.currency !== 'CNY') || !indices.includes(f.index) || q?.status !== 'open' || !Number.isFinite(q.limit) || q.limit <= 0 || q.stale || q.pendingReview) continue;
    if (f.dataIssues?.some(issue => issue.includes(channel === 'agency' ? '代销' : '直销'))) continue;
    const contribution=quotaContribution(f.code,q);
    if(!contribution.known || !f.manager)continue;
    const id = JSON.stringify([f.index,channel,contribution.key,f.currency || 'CNY']);
    if (!groups.has(id)) groups.set(id, { id, channel, index: f.index, name: f.name, scope:q.scope, options: [] });
    for(const platform of channel==='agency'?(q.platforms || ['天天基金']):[null])groups.get(id).options.push({ channel, platform, availabilityBasis:q.availabilityBasis, optionId:`${channel}:${f.code}${platform&&platform!=='天天基金'?':'+platform:''}`, fees:f.fees, channelScope:f.channelScope, manager: f.manager, legalName: f.legalName, code: f.code, share: f.share || '人民币', name: f.name, limit: contribution.amount, scope:q.scope, returns:f.returns, returnsAsOf:f.returnsAsOf, coveredDays: f.stability?.[channel]?.coveredDays || 0, openDays: f.stability?.[channel]?.openDays || 0 });
  }
  return [...groups.values()].map(g => ({ ...g, options: g.options.sort((a,b) => b.limit-a.limit || textCompare(a.share,b.share) || textCompare(a.code,b.code)) }))
    .sort((a,b) => textCompare(a.index,b.index) || textCompare(a.name,b.name));
}

export function selectedCandidates(groups, choices = {}, preference = {}) {
  return groups.flatMap(g => {
    if (choices[g.id] === false) return [];
    // Preserve the pool's full capacity and explicit user share choices.
    const compare=preference.strategy==='returns'?returnCompare(preference.returnYears||1):feeCompare(preference.holdingYears ?? null,preference.strategy==='fees'?preference.feeBasis:'subscription');
    const defaults=orderCandidates(g.options,(a,b)=>b.limit-a.limit || compare(a,b),preference.strategy,true);
    const option = choices[g.id] == null ? defaults[0] : g.options.find(o => optionKey(o) === choices[g.id] || o.code === choices[g.id]);
    // If a selected share stops accepting subscriptions, do not silently switch it.
    return option ? [{ ...option, id:g.id, index:g.index }] : [];
  });
}
export const planSignature = rows => JSON.stringify(rows.map(r => [r.id,r.code,r.limit,r.manager,r.scope?.mode,r.scope?.groupId,r.scope?.cap,r.scope?.ruleId,r.returns?.y1,r.returns?.y3,r.returns?.y5,r.returnsAsOf,r.channel,r.platform,r.availabilityBasis,r.channelScope,r.fees]).sort((a,b)=>textCompare(a[0],b[0])));

// Minimise maintained accounts, then recurring fund plans; no registration state.
// Agency coverage is an explicit user assumption, not a provider inventory claim.
export function maintenanceSelection(candidates, targets, channel, unrestricted = false, holdingYears = null) {
  const keys = unrestricted ? ['total'] : indices;
  const matches = (row, key) => unrestricted || row.index === key;
  const trim = rows => keys.flatMap(index => {
    let remaining = targets[index];
    return orderCandidates(rows.filter(r=>matches(r,index)),(a,b)=>b.limit-a.limit || feeCompare(holdingYears)(a,b),'maintenance',true).filter(r=>{
      if (remaining<=0) return false;
      remaining-=cents(r.limit);return true;
    });
  });
  if (channel==='agency') return trim(candidates);
  const companies = [...new Set(candidates.map(accountKey))].sort(textCompare);
  const byCompany = companies.map(name=>candidates.filter(r=>accountKey(r)===name));
  const capacities = byCompany.map(rows=>keys.map(index=>rows.filter(r=>matches(r,index)).reduce((n,r)=>n+cents(r.limit),0)));
  const zero = keys.map(()=>0);
  const suffix=Array.from({length:companies.length+1},()=>[...zero]);
  for(let i=companies.length-1;i>=0;i--)suffix[i]=suffix[i+1].map((n,j)=>n+capacities[i][j]);
  let best=null, score=null;
  const less=(a,b)=>!b || a.some((v,i)=>v<b[i]&&a.slice(0,i).every((x,j)=>x===b[j]));
  function visit(i,chosen,cap) {
    if(score&&chosen.length>score[0])return;
    if(keys.every((key,j)=>cap[j]>=targets[key])) {
      const rows=trim(chosen.flatMap(k=>byCompany[k]));
      const next=[chosen.length,rows.length,rows.reduce((n,r)=>n+(Number.isFinite(costScore(r,holdingYears))?costScore(r,holdingYears):1000),0)];
      if(less(next,score)){best=rows;score=next;}return;
    }
    if(i===companies.length || keys.some((key,j)=>cap[j]+suffix[i][j]<targets[key]))return;
    visit(i+1,chosen,cap);
    visit(i+1,[...chosen,i],cap.map((n,j)=>n+capacities[i][j]));
  }
  visit(0,[],zero);
  return best || [];
}

// Fill each index's required daily budget with higher historical returns first.
// Missing history ranks after every known value, including negative returns.
export function returnSelection(candidates, targets, years, unrestricted = false, compare = returnCompare(years), strategy = 'returns') {
  return (unrestricted ? ['total'] : indices).flatMap(key=>{
    let remaining=targets[key];
    return orderCandidates(candidates.filter(r=>unrestricted || r.index===key),compare,strategy).flatMap(row=>{
      if(remaining<=0)return [];
      const used=Math.min(cents(row.limit),remaining);remaining-=used;
      return [{...row,planningLimit:used/100}];
    });
  });
}

export function calculatePurchasePlan(input, candidates) {
  const strategy=input.strategy || 'maintenance',returnYears=Number(input.returnYears || 1),holdingYears=input.holdingYears==null||input.holdingYears===''?null:Number(input.holdingYears),feeBasis=input.feeBasis || 'subscription';
  if(holdingYears!=null&&(!Number.isFinite(holdingYears)||holdingYears<=0||holdingYears>50))throw new Error('费用测算持有年限需大于0且不超过50年。');
  if(!['subscription','annual'].includes(feeBasis)||!['maintenance','returns','fees'].includes(strategy)||![1,3,5].includes(returnYears))throw new Error('请选择有效的选基方式和收益年限。');
  const unrestricted = input.ratio === 'any';
  const preferredIndex = unrestricted ? ({'any-sp500':'sp500','any-nasdaq':'nasdaq'}[input.ratioMode] || null) : null;
  const ignoreHoldings=input.mode==='monthly'||unrestricted||['nasdaq','sp500'].includes(input.ratioMode);
  const amount = Number(input.amount), heldNasdaq = ignoreHoldings?0:Number(input.heldNasdaq || 0), heldSp500 = ignoreHoldings?0:Number(input.heldSp500 || 0), ratio = Number(input.ratio);
  if (![amount,heldNasdaq,heldSp500].every(n => Number.isFinite(n) && n >= 0 && n <= 100000000) || amount < 1) throw new Error('计划投入金额需在1元至1亿元之间，已有持仓不能为负数。');
  if (!unrestricted && (!Number.isFinite(ratio) || ratio < 0 || ratio > 100)) throw new Error('纳指比例需在0%至100%之间。');
  if (!['fast','steady','monthly'].includes(input.mode) || !['agency','direct','both'].includes(input.channel)) throw new Error('请选择有效的投入节奏和购买渠道。');
  const monthly=input.mode==='monthly', purchaseDays=Number(input.purchaseDays);
  if(monthly&&(!Number.isInteger(purchaseDays)||purchaseDays<1||purchaseDays>23))throw new Error('每月计划扣款日需为1至23天。');
  const weeks = Number(input.weeks), weekly = input.mode === 'steady' && input.frequency === 'weekly';
  if (input.mode === 'steady' && (!['daily','weekly'].includes(input.frequency) || !Number.isInteger(weeks) || weeks < 1 || weeks > 520)) throw new Error('分批周期需为1至520周，并选择扣款频率。');
  const budget = cents(amount), heldN = cents(heldNasdaq), heldS = cents(heldSp500), combined = budget + heldN + heldS;
  const rawN = unrestricted ? 0 : Math.round(combined * ratio / 100) - heldN;
  const needs = { nasdaq: Math.max(0,Math.min(budget,rawN)), sp500: 0 };
  needs.sp500 = budget - needs.nasdaq;
  const desiredPeriods = monthly ? purchaseDays : input.mode === 'fast' ? null : weeks * (weekly ? 1 : 5);
  const unique = new Map(), pools=new Set();
  for (const row of candidates) {
    if (!indices.includes(row.index) || !Number.isFinite(row.limit) || row.limit <= 0 || !row.id) continue;
    if (unique.has(row.id)) throw new Error('同一个额度组不能重复参与计算。');
    const pool=row.scope?.mode==='shared'?row.scope.groupId:null;
    if(pool&&pools.has(pool))throw new Error('共享额度组不能重复参与计算。');
    if(pool)pools.add(pool);
    unique.set(row.id,{...row,channel:row.channel || input.channel});
  }
  let usable=[...unique.values()];
  if (Array.isArray(input.selectedManagers)) usable=usable.filter(row=>input.selectedManagers.includes(row.manager));
  const skippedSmallQuotas = input.includeSmallQuotas ? [] : usable.filter(row=>
    (unrestricted || needs[row.index]>0) && row.limit<=10
  );
  const skippedIds = new Set(skippedSmallQuotas.map(row=>row.id));
  usable=usable.filter(row=>!skippedIds.has(row.id));
  const capacityByIndex=Object.fromEntries(indices.map(index=>[index,usable.filter(r=>r.index===index).reduce((n,r)=>n+cents(r.limit),0)]));
  const totalAvailable=Object.values(capacityByIndex).reduce((a,b)=>a+b,0);
  const fastestPeriods=unrestricted ? (totalAvailable?Math.ceil(budget/totalAvailable):null)
    : indices.some(index=>needs[index]>0&&!capacityByIndex[index]) ? null
    : Math.max(...indices.map(index=>needs[index]?Math.ceil(needs[index]/capacityByIndex[index]):0));
  const selectionPeriods=desiredPeriods || fastestPeriods;
  // Maximise coverage within the requested (or fastest) horizon first, then
  // give the preferred index as much of that budget as its quota permits.
  // In a shortfall, use both sides' full horizon capacity and cap the preferred
  // allocation at its fastest-completion capacity; preference must not make
  // catch-up slower or leave usable horizon capacity idle.
  if(preferredIndex && totalAvailable) {
    const other=preferredIndex==='nasdaq'?'sp500':'nasdaq';
    needs[preferredIndex]=!capacityByIndex[preferredIndex]?0:!capacityByIndex[other]?budget:
      totalAvailable*selectionPeriods<budget
        ? Math.min(capacityByIndex[preferredIndex]*fastestPeriods,budget-capacityByIndex[other]*selectionPeriods)
        : Math.min(budget,capacityByIndex[preferredIndex]*selectionPeriods);
    needs[other]=budget-needs[preferredIndex];
  }
  const freeAllocation=unrestricted && !preferredIndex;
  const feasible=selectionPeriods && (unrestricted ? totalAvailable*selectionPeriods>=budget : indices.every(index=>capacityByIndex[index]*selectionPeriods>=needs[index]));
  // Preserve the requested horizon (or the fastest feasible duration). If a new
  // quota leaves a shortfall, do not disguise it by extending the horizon.
  if(monthly || (input.strategy && feasible)){
    const targets=freeAllocation
      ? {total:Math.min(Math.ceil(budget/selectionPeriods),totalAvailable)}
      : Object.fromEntries(indices.map(index=>[index,Math.min(Math.ceil(needs[index]/selectionPeriods),capacityByIndex[index])]));
    usable=strategy!=='maintenance' ? returnSelection(usable,targets,returnYears,freeAllocation,strategy==='fees'?feeCompare(holdingYears,feeBasis):returnCompare(returnYears),strategy)
      : maintenanceSelection(usable,targets,input.channel,freeAllocation,holdingYears);
  }
  let unallocated = 0;
  if (freeAllocation || (preferredIndex && !totalAvailable)) {
    const totalCapacity = usable.reduce((n,r)=>n+availableCents(r),0);
    const nasdaqCapacity = usable.filter(r=>r.index==='nasdaq').reduce((n,r)=>n+availableCents(r),0);
    needs.nasdaq = totalCapacity ? Math.round(budget*nasdaqCapacity/totalCapacity) : 0;
    needs.sp500 = totalCapacity ? budget-needs.nasdaq : 0;
    unallocated = totalCapacity ? 0 : budget;
  }
  const allocations = indices.map(index => {
    const rows = orderCandidates(usable.filter(r=>r.index===index),strategy==='returns'?returnCompare(returnYears):strategy==='fees'?feeCompare(holdingYears,feeBasis):(a,b)=>b.limit-a.limit || feeCompare(holdingYears)(a,b),strategy,strategy==='maintenance');
    const capacity = rows.reduce((n,r)=>n+availableCents(r),0), need = needs[index];
    if (!need) return { index, amount:0, capacity:capacity/100, perPeriod:0, periods:0, blocked:false, rows:[] };
    if (!capacity) return { index, amount:need/100, capacity:0, perPeriod:0, periods:null, blocked:true, rows:[] };
    const perPeriod = Math.min(capacity, desiredPeriods ? Math.ceil(need/desiredPeriods) : need);
    const fullCycles = Math.floor(need/perPeriod), tail = need%perPeriod;
    let regularLeft = perPeriod, tailLeft = tail;
    const instructions = rows.flatMap(row => {
      const regular = Math.min(availableCents(row),regularLeft); regularLeft -= regular;
      if (!regular) return [];
      const last = Math.min(regular,tailLeft);tailLeft -= last;
      return [{...row,regular:regular/100,fullCycles,last:last/100,lastPeriod:last ? fullCycles+1 : null,total:(regular*fullCycles+last)/100}];
    });
    return { index, amount:need/100, capacity:capacity/100, perPeriod:perPeriod/100, periods:fullCycles+(tail?1:0), blocked:false, rows:instructions };
  });
  const weeksFor = periods => periods == null ? null : weekly ? periods : Math.ceil(periods/5);
  for (const allocation of allocations) {
    const planned = cents(allocation.amount);
    const achievable = allocation.blocked ? 0 : desiredPeriods ? Math.min(planned,cents(allocation.perPeriod)*desiredPeriods) : planned;
    allocation.achievableAmount = achievable/100;
    allocation.shortfall = (planned-achievable)/100;
    allocation.achievementPercent = planned ? achievable/planned*100 : null;
    // Extra time starts AFTER the requested horizon. Never round total weeks and
    // subtract rounded horizon weeks: a one-day tail can otherwise disappear.
    allocation.extraPeriods = !allocation.shortfall ? 0 : allocation.blocked ? null : Math.ceil(cents(allocation.shortfall)/cents(allocation.perPeriod));
    allocation.extraWeeks = weeksFor(allocation.extraPeriods);
    allocation.estimatedWeeks = weeksFor(allocation.periods);
  }
  const blocked = unallocated>0 || allocations.some(a=>a.blocked);
  const periods = blocked ? null : Math.max(...allocations.map(a=>a.periods));
  const extraPeriods = blocked ? null : Math.max(...allocations.map(a=>a.extraPeriods));
  const used=allocations.flatMap(a=>a.rows), managers=[...new Set(used.filter(r=>r.channel!=='agency').map(r=>r.manager || r.id))];
  for(const row of used)row.costs=estimateCosts(row,holdingYears);
  const costTotal=key=>used.length && used.every(r=>r.costs[key]!=null)?Math.round(used.reduce((n,r)=>n+r.costs[key],0)*100)/100:null;
  const costs={holdingYears,subscriptionFee:costTotal('subscriptionFee'),netAmount:costTotal('netAmount'),annualCost:costTotal('annualCost'),holdingCost:costTotal('holdingCost'),unknownCount:used.filter(r=>r.costs.subscriptionFee==null||r.costs.annualCost==null).length,staleCount:used.filter(r=>r.fees?.stale).length};
  costs.annualRate=costs.netAmount>0 && used.every(r=>Number.isFinite(r.fees?.annualRate)) ? used.reduce((n,r)=>n+r.costs.netAmount*r.fees.annualRate,0)/costs.netAmount : null;
  const netN=used.filter(r=>r.index==='nasdaq').reduce((n,r)=>n+(r.costs.netAmount||0),0);
  const netNasdaqPercent=!blocked && costs.netAmount!=null && heldN+heldS+costs.netAmount>0?(heldN+netN)/(heldN+heldS+costs.netAmount)*100:null;
  const shortfall=(unallocated+allocations.reduce((n,a)=>n+cents(a.shortfall),0))/100;
  const monthlyShortfall=monthly?shortfall:0;
  return {
    strategy,returnYears,feeBasis,costs,netNasdaqPercent,selectionPeriods,missingReturnCount:strategy==='returns'?used.filter(r=>returnValue(r,returnYears)==null).length:0,
    unrestricted, preferredIndex, unallocated:unallocated/100, shortfall, achievementPercent:(budget-cents(shortfall))/budget*100,
    skippedSmallQuotas,
    monthly,purchaseDays:monthly?purchaseDays:null,monthlyShortfall,
    maintenance:{fundCount:new Set(used.map(r=>r.code)).size,planCount:used.length,managers,agencyPlatforms:[...new Set(used.filter(r=>r.channel==='agency').map(r=>r.platform || '天天基金'))],agencyUsed:used.some(r=>r.channel==='agency'),accountCount:input.channel!=='agency'?managers.length:null},
    amount:budget/100, ratio:unrestricted?'any':ratio, allocations, blocked, periods, weekly, mode:input.mode, channel:input.channel,
    estimatedWeeks:weeksFor(periods),horizonPeriods:desiredPeriods,extraPeriods,extraWeeks:weeksFor(extraPeriods),
    desiredWeeks:input.mode==='steady'?weeks:null,
    targetUnreachable:!unrestricted&&(rawN<0||rawN>budget),
    finalNasdaqPercent:(heldN+needs.nasdaq)/combined*100,
    signature:planSignature(candidates),
  };
}
