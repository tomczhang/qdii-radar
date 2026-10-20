import React from 'react';
import {feePercent} from '../../shared/fees.mjs';
export default function FundFees({fund,compact=false}) {
  const fees=fund.fees, first=fees?.subscription?.find(t=>t.min===0);
  if(compact)return <div className="fund-fees-compact"><strong>{feePercent(fees?.annualRate)}{Number.isFinite(fees?.annualRate)&&'/年'}</strong><small>代销申购 {feePercent(first?.agencyRate)}</small>{fees?.stale&&<small>费率待更新</small>}</div>;
  return <section className="fund-fees-detail" aria-label="基金费率"><h3>基金费率</h3><div className="fee-metrics">{[['管理费',fees?.operating?.management],['托管费',fees?.operating?.custody],['销售服务费',fees?.operating?.service],['年度费率合计',fees?.annualRate]].map(([label,value])=><div key={label}><span>{label}</span><strong>{feePercent(value)}</strong><small>每年</small></div>)}</div><p>年度费率是以上三项的合计，不代表全部运作成本；已在净值中计提，不再从历史净值收益重复扣除。</p><p>小额申购：{fund.agency?.platforms?.join(' / ') || '天天基金'} {feePercent(first?.agencyRate)} · 标准费率 {feePercent(first?.standardRate)}（实际渠道折扣请以平台公示为准）。</p>{fees?.subscription?.length>0&&<details><summary>申购费率档位</summary><ul>{fees.subscription.map((t,i)=><li key={i}>{t.min} 元起{t.max!=null?`、不足 ${t.max} 元`:'，无上限'}：{t.fixed!=null?`每笔 ${t.fixed} 元`:`代销 ${feePercent(t.agencyRate)} / 标准 ${feePercent(t.standardRate)}`}</li>)}</ul></details>}<p>赎回费用取决于每笔持有时间，请在费率原页核对。</p>{fees?.sourceUrl?<a href={fees.sourceUrl} target="_blank" rel="noreferrer">查看费率原页 ↗ · 采集于 {new Date(fees.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}{fees.stale?' · 待更新':''}</a>:<p>费率尚未取得；未知值不会按零费用处理。</p>}</section>;
}
export function ChannelScope({fund,compact=false}) {
 const scope=fund.channelScope, independent=scope?.mode==='independent',shared=scope?.mode==='shared';
 return <div className={compact?'channel-scope-compact':'channel-scope-detail'}><strong>{independent?'直销 + 代销可叠加':shared?'直销与代销共用':'渠道关系待确认'}</strong>{!compact&&<><p>{scope?.evidence || scope?.reason || '未取得渠道独立额度依据，汇总按较大渠道额度保守计入。'}同一渠道内部仍按份额共享规则去重。</p>{scope?.sourceUrl&&<a href={scope.sourceUrl} target="_blank" rel="noreferrer">查看渠道额度依据 ↗</a>}</>}</div>;
}
