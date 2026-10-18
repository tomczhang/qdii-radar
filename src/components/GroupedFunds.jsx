import React, {useEffect, useId, useRef, useState} from 'react';
import {ArrowDown, ChevronDown} from 'lucide-react';
import {channelBadge, shareRuleBadge, groupRules, groupSortValue, sortGroupMembers} from '../fund-groups.mjs';
import {feePercent} from '../../shared/fees.mjs';
import {STABILITY_WINDOW_DAYS} from '../../shared/config.mjs';

const money = value => value == null ? '—' : `¥${new Intl.NumberFormat('zh-CN').format(value)}`;
const sortLabels = {agency:'代销小计',direct:'直销小计',agencyHistory:'历史代销累计',directHistory:'历史直销累计',annualFee:'最低年度费率',agencyFee:'最低代销申购费',y1:'最高近1年涨幅',y3:'最高近3年涨幅',y5:'最高近5年涨幅'};
function ChannelFilter({channels,onChange}) {
  const ref=useRef(null), id=useId();
  useEffect(()=>{
    const close=e=>{if(!ref.current?.contains(e.target))ref.current?.removeAttribute('open');};
    const escape=e=>{if(e.key==='Escape' && ref.current?.open){e.preventDefault();ref.current.removeAttribute('open');ref.current.querySelector('summary').focus();}};
    document.addEventListener('keydown',escape);
    document.addEventListener('pointerdown',close);
    document.addEventListener('focusin',close);
    return ()=>{document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',close);document.removeEventListener('focusin',close);};
  },[]);
  return <details ref={ref} className="channel-filter">
    <summary aria-controls={id}>渠道{channels.length>0&&<span className="channel-filter-count">{channels.length}</span>}<ChevronDown size={14}/></summary>
    <div className="channel-filter-menu" id={id}>
      <fieldset><legend>按可买渠道筛选</legend>{[['direct','直销'],['agency','代销']].map(([key,label])=><label key={key}><input type="checkbox" checked={channels.includes(key)} onChange={e=>onChange(e.target.checked?[...channels,key]:channels.filter(c=>c!==key))}/>{label}</label>)}</fieldset>
      <p>未勾选时不限渠道；多选匹配任一可买渠道。保留整组额度。</p>
      <button type="button" onClick={()=>onChange([])} disabled={!channels.length}>清除筛选</button>
    </div>
  </details>;
}
function RuleBadge({badge}) {return <span className={badge.tone==='empty'?'rule-empty':badge.tone==='shared'?'quota-scope-badge shared':`rule-badge ${badge.tone}`} title={badge.detail}>{badge.label}</span>;}
function GroupRow({group, sort, renderShares}) {
  const [expanded,setExpanded] = useState(false), id = useId();
  const rules = groupRules(group), shareRule=shareRuleBadge(group), key = sort.split(':')[0], value = groupSortValue(group,key);
  const partial = group.total.unknown > 0 || group.total.channelUnknown > 0;
  const rates = group.members.filter(f=>!f.fees?.stale).map(f=>f.fees?.annualRate).filter(Number.isFinite);
  const rate = rates.length ? Math.min(...rates) === Math.max(...rates) ? feePercent(rates[0]) : `${feePercent(Math.min(...rates))}–${feePercent(Math.max(...rates))}` : '—';
  return <article className={`fund-group${expanded?' is-expanded':''}`} data-group-codes={group.id}>
    <button className="fund-group-toggle" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(!expanded)}>
      <span className="group-identity"><strong>{group.name}</strong><span>{group.shares} · {group.members.length} 个份额{group.members.some(f=>f.stale) && ' · 部分数据待更新'}</span></span>
      <span className="group-quota"><span className="group-mobile-label">合计 / 日 · 已去重</span><strong>{money(group.total.amount)}</strong><small>{group.total.amount==null?'额度待核验':partial?'已知额度 · 部分待确认':group.total.amount===0?'当前无已知可买额度':'元 / 日 · 已去重'}</small>{sortLabels[key]&&<small className="group-sort-value">{sortLabels[key]} {key.includes('Fee')?feePercent(value):key.startsWith('y')?value==null?'—':`${value.toFixed(2)}%`:money(value)}</small>}</span>
      <span className="group-channels"><span className="group-mobile-label">渠道</span><span className="group-badges">{['direct','agency'].map(channel=><RuleBadge key={channel} badge={channelBadge(group,channel)}/>)}</span><RuleBadge badge={{label:rules.channel==='直销与代销共用'?'额度共用':rules.channel==='直销 + 代销可叠加'?'额度可叠加':rules.channel==='渠道关系待确认'?'关系待确认':'各份额规则不同',tone:'neutral',detail:rules.channel}}/></span>
      <span className="group-share-rule"><span className="group-mobile-label">份额规则</span><RuleBadge badge={shareRule}/>{shareRule.label==='待确认'&&group.members.some(f=>['direct','agency'].some(c=>f[c]?.scope?.basis==='default'))&&<small>默认按独立计算</small>}</span>
      <span className="group-fee"><span className="group-mobile-label">年度费率</span><strong>{rate}</strong><small>{rates.length<group.members.length?'部分费率待更新':'各份额费率范围'}</small></span>
      <span className="group-expand">{expanded?'收起':'展开'}<ChevronDown size={16}/></span>
    </button>
    <div id={id} hidden={!expanded} className="fund-group-details">
      {expanded&&<>
        <div className="group-periods"><span>本组合计 · 过去{STABILITY_WINDOW_DAYS}个交易日 <strong>{money(group.history.amount)}</strong><small>{group.history.complete?'完整累计':'已知累计 · 部分历史待核验'}</small></span><span>未来{STABILITY_WINDOW_DAYS}个交易日 <strong>{money(group.total.amount==null?null:group.total.amount*STABILITY_WINDOW_DAYS)}</strong><small>假设当前额度不变，非承诺额度</small></span></div>
        <p className="group-detail-note">下方是每个份额单独购买的上限，共用额度不能重复相加。点击费率、渠道或基金名称查看公告依据。桌面表格可左右滚动。</p>
        {renderShares(sortGroupMembers(group.members,sort))}
      </>}
    </div>
  </article>;
}
export default function GroupedFunds({groups,sort,onSort,query,channels,onChannelsChange,renderShares}) {
  return <div className="grouped-funds">
    <div className="group-list-note"><strong>按基金分组 · 额度已去重</strong><span>渠道共用与份额共用分别标明；关系未确认时，双渠道按较大额度保守计入。渠道筛选保留整组及其总额。{query.trim()&&' 搜索保留命中基金的整组份额与总额。'}</span></div>
    <div className="group-list-heading"><span>基金 / 份额</span><button aria-pressed={sort.startsWith('combined:')} onClick={()=>onSort('combined')}>合计可买 / 日 <ArrowDown size={13} className={sort==='combined:asc'?'asc-arrow':''}/></button><ChannelFilter channels={channels} onChange={onChannelsChange}/><span className="group-share-heading">份额规则</span><button aria-pressed={sort.startsWith('annualFee:')} onClick={()=>onSort('annualFee')}>年度费率 <ArrowDown size={13} className={sort==='annualFee:asc'?'asc-arrow':''}/></button><span>明细</span></div>
    {groups.map(group=><GroupRow key={group.id} group={group} sort={sort} renderShares={renderShares}/>)}
  </div>;
}
