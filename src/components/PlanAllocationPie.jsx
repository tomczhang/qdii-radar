import React,{useState} from 'react';
import {budgetSegments,budgetPercent,donutSlicePath} from '../budget-allocation.mjs';
import {formatPlanDuration} from '../plan-duration.mjs';
import {Check,ArrowUpRight} from 'lucide-react';
import './PlanAllocationPie.css';
const money=n=>`¥${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n)}`;
const names={nasdaq:'纳斯达克100',sp500:'标普500'};
export default function PlanAllocationPie({result,horizon}) {
  const [active,setActive]=useState(null),segments=budgetSegments(result);
  const current=segments.find(s=>s.id===active),share=amount=>budgetPercent(amount/result.amount*100);
  const centerAmount=money(current?.amount??result.amount);
  const after=result.monthly?'本月计划结束后':'设定周期结束后';
  const interaction=id=>({onPointerEnter:()=>setActive(id),onPointerLeave:()=>setActive(null),onFocus:()=>setActive(id),onBlur:()=>setActive(null),onClick:()=>setActive(id),onKeyDown:e=>{if(e.key==='Escape')setActive(null);}});
  return <section className="budget-allocation" aria-label="预算分配与指数缺口">
    <div className="budget-allocation-heading"><h4>预算分配</h4><span>以总预算为 100%</span></div>
    <div className="budget-allocation-layout">
      <figure className="budget-pie">
        <div className="budget-donut-stage">
          <svg viewBox="0 0 320 320" role="group" aria-label={`${horizon}预算分配环形图，所有占比均以总预算为分母`} className={current?'has-active':''}>
            {segments.map(s=>{
              const label=`${s.label} ${money(s.amount)}，占总预算 ${budgetPercent(s.percent)}`;
              return <path key={s.id} className={`budget-pie-slice ${s.index||'unallocated'} ${s.kind}${current?.id===s.id?' is-active':''}`} d={donutSlicePath(s.start,s.end)} tabIndex={0} role="img" aria-label={label} data-budget-segment={s.id} data-amount={s.amount} {...interaction(s.id)}><title>{label}</title></path>;
            })}
          </svg>
          <div className={`budget-donut-center${current?.kind==='shortfall'?' is-gap':''}`} aria-hidden="true" style={{'--center-number-size':centerAmount.length>12?'16px':centerAmount.length>10?'20px':undefined}}>
            <span>{current?.label||'总预算'}</span><strong>{centerAmount}</strong>
            <small>{current?`占总预算 ${budgetPercent(current.percent)}`:`${horizon}投入计划`}</small>
          </div>
        </div>
        <figcaption aria-live="polite">{current?<>{current.label} {money(current.amount)} · {budgetPercent(current.percent)}</>:result.shortfall>0?<><i className="budget-key gap"/>待配置 {share(result.shortfall)} · {money(result.shortfall)}</>:<><Check size={14}/>预算已全部配置</>}</figcaption>
      </figure>
      <div className="budget-index-list">
        {result.allocations.map(a=><div className={`budget-index-row ${a.index}${current?.index===a.index?' is-active':''}`} data-allocation-index={a.index} key={a.index}>
          <button type="button" className="budget-index-main" aria-label={`查看${names[a.index]}可投入金额及预算占比`} {...interaction(`${a.index}-allocated`)}>
            <span className="budget-index-name"><i className={`budget-key ${a.index}`}/><span>{names[a.index]}<small>{horizon}可投入</small></span></span>
            <span className="budget-index-amount"><strong>{money(a.achievableAmount)}</strong><span className="budget-index-share">{share(a.achievableAmount)}<small>占总预算</small></span></span>
          </button>
          <div className="budget-index-target"><span>指数预算 {money(a.amount)} · {share(a.amount)}</span>{a.shortfall===0&&<span className="budget-covered"><Check size={12}/>{a.amount?'已配齐':'未分配预算'}</span>}</div>
          {a.shortfall>0&&<>
            <button type="button" className="budget-gap-detail" {...interaction(`${a.index}-shortfall`)}><span><i className={`budget-key gap ${a.index}`}/>{a.index==='nasdaq'?'纳指':'标普'}还差 <strong>{money(a.shortfall)}</strong></span><span>{share(a.shortfall)}<ArrowUpRight size={13}/></span></button>
            <p className="allocation-catchup">{a.blocked?'当前没有可用额度，补齐时间无法估算，需等待额度开放。':<>按{result.weekly?'每周':'每个可申购日'} {money(a.perPeriod)} 继续投入，{after}还需 <b>{formatPlanDuration(a.extraPeriods,result.weekly)}</b> 补齐。</>}</p>
          </>}
        </div>)}
        {result.unallocated>0&&<div className={`budget-unallocated${current?.kind==='unallocated'?' is-active':''}`}><button type="button" {...interaction('unallocated')}><span><i className="budget-key gap unallocated"/>尚未分配至指数</span><strong>{money(result.unallocated)} · {share(result.unallocated)}</strong></button><p>暂无可用额度，无法确定归属哪个指数；计入总缺口。</p></div>}
      </div>
    </div>
  </section>;
}
