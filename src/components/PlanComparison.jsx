import React, {useMemo} from 'react';
import {calculatePurchasePlan,selectedCandidates} from '../purchase-plan.mjs';
import {planReturnScenarios} from '../plan-insights.mjs';
import {feePercent,planCostSummary} from '../../shared/fees.mjs';
const strategies=[['fees','费用优先'],['maintenance','少维护'],['returns','历史收益优先']];
const money=n=>`¥${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n)}`;
export default function PlanComparison({result,input,groups,choices,onPreference}) {
  const plans=useMemo(()=>strategies.map(([strategy])=>{
    if(strategy===result.strategy)return result;
    const next={...input,strategy};
    return calculatePurchasePlan(next,selectedCandidates(groups,choices,next));
  }),[result,input,groups,choices]);
  const years=input.holdingYears;
  const mode=result.strategy;
  const returnPlans=useMemo(()=>plans.map(plan=>planReturnScenarios(plan)),[plans]);
  const horizons=[...new Set([1,3,5,...(years==null?[]:[Number(years)])])].sort((a,b)=>a-b);
  const amountsDiffer=new Set(plans.map(plan=>planCostSummary(plan).scheduledAmount)).size>1;
  return <>
    {mode==='fees'&&<>
      <label className="plan-return-years plan-holding-years">费用测算持有期<select aria-label="费用测算持有期" value={years ?? ''} onChange={e=>onPreference({holdingYears:e.target.value===''?null:Number(e.target.value),feeBasis:'annual'})}><option value="">仅看年度费率</option>{horizons.map(year=><option key={year} value={year}>{year} 年</option>)}</select></label>
      <p className="plan-comparison-basis">{years==null?'三个方案比较组合年度费率。':'三个方案比较同一持有期的申购费 + 年度费用，假设每笔买入后持有相应年限，市值与费率不变，不含赎回费。'}</p>
    </>}
    {mode==='maintenance'&&<p className="plan-comparison-basis">比较基金数量与预计涉及的 App 数。App 按每家直销公司、每个代销平台各一个估算；可用官网，实际新增下载数取决于已有 App。</p>}
    {mode==='returns'&&<p className="plan-comparison-basis">按各基金最新近一年收益率不变，复利推算每笔买入后持有 1／3／5 年的盈亏。已扣申购费，净值内年度费用不重复扣除；不含赎回费，不叠加后续月预算。这是历史收益情景，不是未来收益预测。</p>}
    <div className="plan-strategy-options" data-display={mode} role="group" aria-label="选基偏好">
    {strategies.map(([strategy,label],i)=>{
      const plan=plans[i],active=result.strategy===strategy;
      const summary=planCostSummary(plan),projection=returnPlans[i];
      const apps=(plan.maintenance.accountCount ?? 0)+plan.maintenance.agencyPlatforms.length;
      return <button key={strategy} type="button" className={active?'selected':''} aria-pressed={active} onClick={()=>onPreference({strategy})}>
        <span className="plan-strategy-name">{label}<small>{active?'已选择':'选择'}</small></span>
        {mode==='fees'&&<>
          <strong>{years==null?feePercent(plan.costs.annualRate):summary.total==null?'待确认':money(summary.total)}</strong><span className="plan-strategy-caption">{years==null?'组合年度费率':`预计 ${years} 年费用`}</span>
          {years!=null&&<span className="plan-strategy-caption">年度费率 {feePercent(plan.costs.annualRate)}</span>}
          <span className="plan-strategy-caption">计费申请金额 {money(summary.scheduledAmount)}</span>
          {plan.costs.staleCount>0&&<span className="plan-strategy-caption">含过期费率，需核对</span>}
        </>}
        {mode==='maintenance'&&<>
          <strong>{plan.maintenance.fundCount} 只基金</strong>
          <span className="plan-strategy-caption">预计涉及 {apps} 个 App</span>
          <span className="plan-strategy-caption">{plan.maintenance.planCount} 条渠道计划</span>
          <span className="plan-strategy-caption">{[...plan.maintenance.managers,...plan.maintenance.agencyPlatforms].join('、') || '暂无购买渠道'}</span>
        </>}
        {mode==='returns'&&<>
          <span className="plan-strategy-caption">情景盈亏 · 按近一年收益推算</span>
          <span className="plan-return-scenarios">{projection.scenarios.map(s=><span key={s.years} data-return-years={s.years}><span>{s.years} 年</span><strong>{s.profit==null?'无法估算':`${s.profit>0?'+':''}${money(s.profit)}`}</strong></span>)}</span>
          <span className="plan-strategy-caption">申请金额 {money(projection.scheduledAmount)}</span>
          {(projection.missingReturns>0||projection.missingCosts>0)&&<span className="plan-strategy-caption">{projection.missingReturns>0?'缺少有效近一年收益；':''}{projection.missingCosts>0?'申购费待确认；':''}不按零值补算</span>}
          <span className="plan-strategy-caption">{projection.dates.length?`收益数据截至 ${projection.dates.join('、')}`:'收益截止日未提供'}{plan.costs.staleCount>0?' · 含过期申购费估算':''}</span>
        </>}
        {(plan.shortfall>0||plan.blocked)&&<span className="plan-strategy-caption">期内缺口 {money(plan.shortfall)} · {mode==='returns'?'仅测算已安排金额，含补投':mode==='fees'?'费用含已安排补投':'仅列已安排计划'}</span>}

      </button>;
    })}
    </div>
    {amountsDiffer&&mode!=='maintenance'&&<p className="plan-comparison-basis">各方案已安排金额不同，请结合预算覆盖与投入比例比较。</p>}
  </>;
}
