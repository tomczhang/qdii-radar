import React from 'react';
import PlanAllocationPie from './PlanAllocationPie.jsx';
import {formatPlanDuration} from '../plan-duration.mjs';
import {CircleCheck,TriangleAlert,CircleX} from 'lucide-react';
const money = n => `¥${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n)}`;
const percent = n => `${(n<100?Math.min(n,99.9):n).toFixed(1)}%`;
const indexName = key => key==='nasdaq'?'纳斯达克100':'标普500';

export default function PlanOutcome({result,status,children}) {
  const horizon=result.monthly?'本月':result.desiredWeeks?`${result.desiredWeeks}周内`:'完整计划';
  const duration=periods=>formatPlanDuration(periods,result.weekly);
  const Icon=status==='achievable'?CircleCheck:status==='blocked'?CircleX:TriangleAlert;
  return <>
    <section className={`plan-status plan-budget plan-outcome ${status}`} data-plan-status={status} aria-label="预算达成情况">
      <div className="plan-outcome-heading"><h3><span className="plan-outcome-label"><Icon size={23}/><span>{horizon}预算达成率</span></span><strong>{percent(result.achievementPercent)}</strong></h3><span className="plan-status-badge">{result.blocked?'部分预算暂无额度':result.shortfall>0?'有缺口':result.targetUnreachable?'目标比例未达成':'可达成'}</span></div>
      <progress aria-label="整体预算达成率" max="100" value={result.achievementPercent}/>
      <div className="plan-budget-metrics"><div><span>预算</span><b>{money(result.amount)}</b></div><div><span>预计可投入</span><b>{money(result.amount-result.shortfall)}</b></div><div><span>缺口</span><b>{money(result.shortfall)}</b></div></div>
      <div className="plan-duration-summary"><span>{result.desiredWeeks ? `计划周期 ${formatPlanDuration(result.desiredWeeks,true)} · ${result.weekly?'每周扣款一次':'每个可申购日扣款'}` : '本笔预算从开始到全部投完'}</span><strong>{result.blocked ? '存在无额度预算，投完时间暂无法估算' : `预计${duration(result.periods)}投完`}</strong></div>
      <PlanAllocationPie result={result} horizon={horizon}/>
      <p>{result.preferredIndex?`不设固定比例，在同一期限内优先买${indexName(result.preferredIndex)}，额度不足时由另一侧补足。`:result.unrestricted?'不限指数比例，预算按可用额度分配。':'按设定比例分别测算，不把一侧的余量用于补另一侧。'}这是按当前额度测算的预计达成率，不代表已完成扣款。</p>
      {result.targetUnreachable&&<p>预算达成率仅衡量投入金额；仅靠新增资金无法达到目标比例。按申请金额计算，完成后纳指占比约 {result.finalNasdaqPercent.toFixed(1)}%。</p>}
      {result.unallocated>0&&<p>暂无可用额度，{money(result.unallocated)} 预算尚未分配至指数，补齐时间无法估算。</p>}
      <small className="plan-timing-assumptions">按当前额度不变、{result.weekly?'每周扣款一次':'每周5个可申购日'}测算，按每月约30天换算为近似年月，未计节假日和临时停购。</small>
      {result.monthly&&<div className="plan-monthly-continuation"><b>每月固定投入提醒</b><p>{result.shortfall>0?`以上补齐时间仅针对本月预算，不叠加下个月的新预算。若每月仍投入 ${money(result.amount)}，保持当前比例、额度和每月扣款安排，每月将新增 ${money(result.shortfall)} 缺口，未投入金额会继续累积。`:'本计划仅对应本月预算；下个月请按最新额度和扣款日重新计算。'}</p></div>}

    </section>
    {children}
  </>;
}
