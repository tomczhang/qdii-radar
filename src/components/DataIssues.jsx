import React from 'react';
import {Info} from 'lucide-react';

export default function DataIssues({funds, onDetail}) {
  const affected = funds.filter(f => f.dataIssues?.length || f.stale);
  if (!affected.length) return null;
  const item = fund => <button type="button" className="data-issue-link" onClick={() => onDetail(fund)}>
    <strong>{fund.name}{fund.share ? ` ${fund.share}` : ''}（{fund.code}）</strong>
    <span>{fund.dataIssues?.length ? fund.dataIssues.join('；') : '数据待更新，请查看对应日期'} <span aria-hidden="true">↗</span></span>
  </button>;
  return <section className="live-status data-issues" aria-label="基金数据异常">
    <Info size={15}/><div>
      {item(affected[0])}
      {affected.length > 1 && <details><summary>查看其余 {affected.length - 1} 只基金的具体问题</summary>
        <ul>{affected.slice(1).map(f => <li key={f.code}>{item(f)}</li>)}</ul>
      </details>}
      <p>仅上述字段异常，其余可用数据及原始日期保留。</p>
    </div>
  </section>;
}
