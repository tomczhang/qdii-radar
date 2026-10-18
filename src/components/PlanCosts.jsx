import React, {useMemo, useState} from 'react';
import {feePercent,shareBreakEven,planCostSummary} from '../../shared/fees.mjs';
import {calculatePurchasePlan,selectedCandidates} from '../purchase-plan.mjs';
const money = n => `¥${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n)}`;
const channelName = (key,platform) => key==='agency'?`${platform || '天天基金'}代销`:'基金公司直销';
const rowsOf = plan => plan.allocations.flatMap(a=>a.rows);
const allocationKey = plan => JSON.stringify(rowsOf(plan).map(r=>[r.code,r.channel,r.platform,r.total]).sort());
export default function PlanCosts({result,input,groups,choices,onPreference}) {
  const [expanded,setExpanded]=useState(false);
  const scenarios=useMemo(()=>expanded?[1,3,5].map(years=>{
    const next={...input,strategy:'fees',holdingYears:years};
    return {years,plan:calculatePurchasePlan(next,selectedCandidates(groups,choices,next))};
  }):[],[expanded,input,groups,choices]);
  const crossings=useMemo(()=>{
    if(!expanded)return [];
    const seen=new Set(),pairs=[];
    for(const group of groups) {
      if(choices[group.id]===false)continue;
      for(const a of group.options.filter(o=>o.share==='A'))for(const c of group.options.filter(o=>o.share==='C')) {
        // Only compare shares in the same confirmed quota pool and channel.
        if(a.manager!==c.manager||a.channel!==c.channel||a.platform!==c.platform||a.name!==c.name)continue;
        const key=`${a.channel}:${a.platform}:${a.code}:${c.code}`;
        if(seen.has(key))continue;seen.add(key);
        const point=shareBreakEven(a,c,Math.min(a.limit,c.limit));
        if(point)pairs.push({a,c,...point});
      }
    }
    return pairs;
  },[expanded,groups,choices]);
  const {costs}=result;
  const summary=planCostSummary(result);
  const changed=scenarios.length>1&&new Set(scenarios.map(s=>allocationKey(s.plan))).size>1;
  return <section className="plan-costs" aria-label="购买费用估算">
    <h3>当前方案的费用</h3>
    <div className="fee-metrics">
      {costs.holdingYears!=null&&<div><span>预计 {costs.holdingYears} 年费用</span><strong>{summary.total==null?'待确认':money(summary.total)}</strong><small>申购费 + 持有期年度费用 · 计费申请金额 {money(summary.scheduledAmount)}</small></div>}
      <div><span>组合年度费率（加权）</span><strong>{feePercent(costs.annualRate)}</strong><small>每万元持仓每年约 {costs.annualRate==null?'待确认':money(costs.annualRate*100)}</small></div>
      <div><span>申购费</span><strong>{costs.subscriptionFee==null?'待确认':money(costs.subscriptionFee)}</strong></div>
      <div><span>扣申购费后净投入</span><strong>{costs.netAmount==null?'待确认':money(costs.netAmount)}</strong></div>

    </div>
    <details className="fee-method"><summary>费用如何计算</summary>
    <p>持有期费用 = 逐笔申购费 + 各笔净投入 × 对应年度费率 × 持有年数。组合年度费率按各笔净投入加权，仅作辅助比较；不包含已有持仓。</p>
    <p>年度费用通常按资产净值逐日计提，市值涨跌和分批买入都会改变实际费用。每万元示例假设持仓市值、组合权重和费率不变，不代表未来实际扣费。</p>
    <p>预算与额度均按含申购费的申请金额计算，申购费逐笔估算并保留到分；年度费用在净值内计提，不额外占用购买预算。历史净值收益已扣净值内费用，不重复扣除。{result.netNasdaqPercent!=null&&`扣申购费后，含已有持仓的纳指金额占比约 ${result.netNasdaqPercent.toFixed(2)}%。`}</p>
    <p>直销申购费按标准费率估算，实际优惠需下单前核对；代销按每行标注的平台；天天优惠费率不用于其他平台。不含赎回费、交易成本。</p>
    </details>
    {costs.unknownCount>0&&<p className="calculator-warning">{costs.unknownCount} 笔计划存在未知费率，费用总额不完整，不能按零费率理解。</p>}
    {costs.staleCount>0&&<p className="calculator-warning">{costs.staleCount} 笔计划费率已过期，保留旧费率作估算，需重新确认。</p>}
    {result.shortfall>0&&<p>费用覆盖下方已安排的全部申购，包含计划周期后的部分；暂无额度的预算不计入费用估算。</p>}
    <details className="fee-scenarios" onToggle={e=>setExpanded(e.currentTarget.open)}>
      <summary>长期费用比较（可选）{costs.holdingYears!=null&&` · 已选择 ${costs.holdingYears} 年`}</summary>
      <p>以下分别按 1／3／5 年比较费用优先方案，保留预算、额度和手选份额约束。假设每笔申购后均持有对应年限且净投入市值不变，不代表从今天开始的实际年度账单，也不预测收益。</p>
      <p>各情景先满足额度与期限，按当前每日上限对应的申购费加持有期年度费用比例排序，再按实际计划逐笔估费；不保证全局最低成本。</p>
      <div className="fee-scenario-list">{scenarios.map(({years,plan})=>{
        const {total}=planCostSummary(plan);
        return <article key={years} data-fee-years={years}>
          <h4>{years} 年情景</h4><strong>{total==null?'费用待确认':money(total)}</strong><small>已安排金额的申购费 + 年度费用</small>
          <ul>{rowsOf(plan).map(r=><li key={r.id}>{r.name} {r.share} · {channelName(r.channel,r.platform)} · {money(r.total)}</li>)}</ul>
          {plan.blocked&&<p>部分预算暂无额度，未计入费用。</p>}
          {plan.costs.staleCount>0&&<p>包含过期费率，需重新确认。</p>}
          <button type="button" className="button secondary" aria-pressed={input.strategy==='fees'&&Number(input.holdingYears)===years} onClick={()=>onPreference({strategy:'fees',holdingYears:years})}>采用 {years} 年费用方案</button>
        </article>;
      })}</div>
      {scenarios.length>0&&<p className="fee-scenario-difference">{changed?'持有期限改变了基金、渠道或投入分配，选择情景后再查看具体扣款计划。':'这三个期限下的基金、渠道和投入分配相同；费用金额随年限变化。'}</p>}
      {costs.holdingYears!=null&&<button type="button" className="button secondary" onClick={()=>onPreference('holdingYears',null)}>取消持有期限，恢复单项比较</button>}
      {crossings.length>0&&<div className="fee-break-even"><h4>A/C 费用持平时间参考</h4>{crossings.map(p=><p key={`${p.a.channel}:${p.a.code}:${p.c.code}`}>{p.a.name}（A {p.a.code} / C {p.c.code}）· {channelName(p.a.channel,p.a.platform)}：按单笔 {money(p.amount)} 计算，{p.years<0.1?'不足 0.1':`约 ${p.years.toFixed(1)}`} 年费用持平；此前 C 成本较低，此后 A 较低。</p>)}<p>仅比较同一已确认额度组、同一渠道的可买 A/C 份额。假设市值、费率不变，不含赎回费；分批投入应分别计算持有期，不据此预测净收益。</p></div>}
    </details>
  </section>;
}
