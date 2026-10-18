import {STABILITY_WINDOW_DAYS} from '../../shared/config.mjs';
import React, {useId, useState} from 'react';
import {planContributions} from '../plan-contributions.mjs';
import {ChevronDown, ChevronRight, TriangleAlert} from 'lucide-react';
import {feePercent} from '../../shared/fees.mjs';
const money=n=>`¥${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n)}`;
const indexName=key=>key==='nasdaq'?'纳斯达克100':'标普500';
function ExecutionFund({contribution:a,result,funds,onDetail}) {
  const [expanded,setExpanded]=useState(true),id=useId(),fund=a.rows[0];
  return <section className="execution-group" data-execution-index={a.index} data-contribution-code={a.code}>
    <button type="button" className="execution-group-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(!expanded)}>
      <span className="execution-group-identity"><strong>{fund.name} {fund.share}</strong><span>{a.code} · {indexName(a.index)}</span></span>
      <span className="execution-contribution"><small className="execution-mobile-label">方案贡献度</small><strong>{(a.contribution*100).toFixed(1)}%</strong><span className="contribution-track" aria-hidden="true"><span style={{width:`${a.contribution*100}%`}}/></span></span>
      <span className="execution-group-total"><small className="execution-mobile-label">累计申请</small><strong>{money(a.total)}</strong><small>{a.rows.length} 条渠道计划</small></span>
      <span className="execution-group-expand">{expanded?'收起':'展开'}<ChevronDown size={16}/></span>
    </button>
    <div id={id} hidden={!expanded} className="execution-group-details">
      <div className="execution-table-scroll" role="region" aria-label={`${fund.name} ${fund.share} 渠道明细，可横向滚动`} tabIndex={0}>
      <table className="execution-table" aria-label={`${fund.name} ${fund.share} 渠道明细`}>
        <thead><tr>{['购买渠道','执行方式','每期金额','最后一笔','累计申请','详情'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{a.rows.map(row=>{
          const lastPeriod=row.last>0?row.lastPeriod:row.fullCycles;
          const lastAmount=row.last>0?row.last:row.regular;
          const once=lastPeriod===1;
          const fullQuota=Math.round(row.regular*100)===Math.round(row.limit*100);
          const action=once?'一次买入':fullQuota?'定投拉满':'按计划定投';
          return <tr className="plan-fund-row" key={row.id}>
            <td className="execution-channel"><b>{row.channel==='direct'?row.manager:row.platform || '代销平台'}</b><small>{row.channel==='direct'?'基金公司直销':'代销'}</small></td>
            <td className="execution-action"><strong>{action}</strong><small>{once?'仅买 1 次':result.weekly?'每周一次':'每个可申购日'}</small></td>
            <td className="execution-regular"><strong>{money(once?lastAmount:row.regular)}</strong><small>{once?'一次买入':`前 ${row.fullCycles.toLocaleString()} 期`}</small></td>
            <td className="execution-last"><strong>{money(lastAmount)}</strong><small>第 {lastPeriod.toLocaleString()} 期{row.last>0&&row.last!==row.regular?' · 按此尾款调整':' · 金额不变'}</small></td>
            <td className="execution-stop"><strong>{money(row.total)}</strong><small>共 {lastPeriod.toLocaleString()} 次 · 达到后停止</small></td>
            <td><details className="execution-details"><summary>费用与历史</summary>
              <small>当前限额 {money(row.limit)}/日 · 申购费 {row.costs.subscriptionFee==null?'待确认':money(row.costs.subscriptionFee)} · 净投入 {row.costs.netAmount==null?'待确认':money(row.costs.netAmount)}</small>
              <small>年度费率 {feePercent(row.fees?.annualRate)} · 每万元每年约 {Number.isFinite(row.fees?.annualRate)?money(row.fees.annualRate*100):'待确认'}{row.channel==='direct'?' · 申购费按标准估算':row.platform&&row.platform!=='天天基金'?' · 公告费率，平台实际费用需确认':' · 天天优惠费率'}</small>
              <small>近{result.returnYears}年累计收益：{Number.isFinite(row.returns?.[`y${result.returnYears}`])?`${row.returns[`y${result.returnYears}`]>=0?'+':''}${row.returns[`y${result.returnYears}`].toFixed(2)}%`:'—（年限不足或数据缺失）'}{row.returnsAsOf&&` · 截至 ${row.returnsAsOf}`}</small>
              <small>过去{STABILITY_WINDOW_DAYS}个交易日：已知开放 {row.openDays} 天 · 记录 {row.coveredDays} 天</small>
              {row.availabilityBasis==='user_report'&&<small>平台由用户确认，非实时接口核验；多个代销平台择一，不叠加。</small>}
              <button type="button" className="execution-fund-detail" onClick={()=>onDetail(funds.find(f=>f.code===row.code))}>查看基金<ChevronRight size={14}/></button>
            </details></td>
          </tr>;
        })}</tbody>
      </table>
      </div>
    </div>
  </section>;
}
export default function PlanExecution({result,funds,onDetail}) {
  const {total: scheduledAmount, funds: contributions}=planContributions(result);
  return <div className="plan-funds plan-execution" aria-label="最终渠道计划">
    <header className="plan-execution-heading"><h3>购买基金与金额</h3><span>{result.maintenance.planCount} 条计划</span></header>
    <p className="plan-execution-frequency">扣款频率：<b>{result.weekly?'每周一次':'每个可申购日'}</b> · 每条计划按自己的累计金额停止{result.monthly?'，仅对应本月预算':''}。自动定投支持需在渠道确认，不支持时按同样频率手动申购。</p>
    <p className="execution-contribution-note">贡献度按同一份额的各渠道累计金额合计，占已安排总金额的比例。</p>
    <div className="execution-groups">
      <div className="execution-group-heading"><span>基金 / 份额</span><span>方案贡献度 ↓</span><span>累计申请</span><span>明细</span></div>
      {contributions.map(a=><ExecutionFund key={a.code} contribution={a} {...{result,funds,onDetail}}/>)}
      <div className="execution-grand-total"><span>已安排合计</span><strong>{money(scheduledAmount)}</strong></div>
    </div>
    {result.allocations.filter(a=>a.blocked && a.amount>0).map(a=><div key={a.index} className="plan-blocked" role="note">
      <TriangleAlert size={20} aria-hidden="true"/><div><strong>{indexName(a.index)}：{money(a.amount)}</strong><p>暂无可执行计划，等待额度开放。</p></div>
    </div>)}
    {result.unallocated>0&&<div className="plan-blocked" role="note"><TriangleAlert size={20} aria-hidden="true"/><div><strong>另有 {money(result.unallocated)} 未安排购买</strong><p>暂无额度，等待额度开放。</p></div></div>}
  </div>;
}
