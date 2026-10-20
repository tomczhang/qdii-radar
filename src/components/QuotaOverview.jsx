import React, { useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import RollingAmount from './RollingAmount.jsx';
import { totalQuota, totalHistoricalQuota } from '../summary.mjs';
import { STABILITY_WINDOW_DAYS } from '../../shared/config.mjs';
import './QuotaOverview.css';

const indices = [['nasdaq', '纳指100', 'NASDAQ 100'], ['sp500', '标普500', 'S&P 500']];
const channels = [['both', '合并'], ['agency', '代销'], ['direct', '直销']];
const amount = value => value == null ? '—' : new Intl.NumberFormat('zh-CN').format(value);
const money = value => value == null ? '—' : `¥${amount(value)}`;
const partial = total => total.unknown > 0 || total.channelUnknown > 0;
const coverage = history => history.complete ? '完整覆盖' : '部分覆盖';
const summarize = funds => Object.fromEntries(channels.map(([channel]) => [channel, {
  current: totalQuota(funds, channel),
  history: totalHistoricalQuota(funds, channel),
}]));

export default function QuotaOverview({ funds, excludeSmall }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const { totals, cards } = useMemo(() => ({
    totals: summarize(funds),
    cards: indices.map(([index, name, ticker]) => ({
      index, name, ticker, stats: summarize(funds.filter(fund => fund.index === index)),
    })),
  }), [funds]);

  return <section id="quota-summary" className="quota-overview" aria-label="额度概览">
    <div className="quota-overview-heading">
      <h2>场外可买额度</h2>
      <div className="quota-overview-total" data-quota-summary="both">
        <span>{partial(totals.both.current) ? '已知合计' : '合计'}</span>
        <strong data-current-amount>{money(totals.both.current.amount)}</strong><span>元/日</span>
      </div>
    </div>
    <div className="quota-index-grid">
      {cards.map(({ index, name, ticker, stats }) => <article key={index} className={`quota-index-card quota-index-${index}`} data-quota-index={index} aria-label={`${name}额度`}>
        <div className="quota-index-ticker">{ticker}</div>
        <h3>{name}</h3>
        <div className="quota-index-label">每日可买{partial(stats.both.current) ? ' · 已知额度' : ''}</div>
        <div className={`quota-index-amount${amount(stats.both.current.amount).length > 6 ? ' quota-index-amount-long' : ''}`} data-index-amount>
          <RollingAmount value={stats.both.current.amount} replayKey={excludeSmall} />
        </div>
        <div className="quota-index-unit">元 / 可申购日</div>
        <div className="quota-index-channels">
          {channels.slice(1).map(([channel, label]) => <div key={channel} data-index-channel={channel}>
            <span>{label}</span><strong>{amount(stats[channel].current.amount)}{partial(stats[channel].current) && <small title="部分额度或共享规则待核验"> *</small>}</strong>
          </div>)}
        </div>
        <div className="quota-index-history" data-index-history>
          <span>{STABILITY_WINDOW_DAYS}日已知累计 · 元</span>
          <strong>{amount(stats.both.history.amount)}</strong>
          <small>{coverage(stats.both.history)}{partial(stats.both.current) ? ' · 当前规则待核验' : ''}</small>
        </div>
      </article>)}
    </div>
    <p className="quota-overview-method">按份额与渠道共享规则去重{excludeSmall ? ' · 已剔除 ≤10元' : ''}</p>
    <button type="button" className="quota-overview-toggle" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>
      <span>渠道{STABILITY_WINDOW_DAYS}日累计</span><span>{expanded ? '收起' : '展开'}<ChevronDown size={16} /></span>
    </button>
    <div id={detailId} className="quota-overview-details" hidden={!expanded}>
      <div className="quota-history-grid">
        {cards.map(({ index, name, stats }) => <div className="quota-history-index" key={index} data-index-details={index}>
          <h4>{name}<span>过去{STABILITY_WINDOW_DAYS}个交易日</span></h4>
          {channels.slice(1).map(([channel, label]) => <div className="quota-history-row" key={channel} data-history-channel={channel}>
            <span>{label}</span><div><strong>{money(stats[channel].history.amount)}</strong><small>{coverage(stats[channel].history)}</small></div>
          </div>)}
        </div>)}
      </div>
      <div className="quota-period-grid">
        {channels.map(([channel, label]) => <div key={channel} className="quota-period-channel" data-channel-summary={channel}>
          <h4>{label}额度{channel !== 'both' ? '小计' : '总计'}</h4>
          <div><span>每日可买{partial(totals[channel].current) ? '（已知）' : ''}</span><strong data-current-amount>{money(totals[channel].current.amount)}</strong></div>
          <div data-history-summary={channel}><span>{STABILITY_WINDOW_DAYS}日已知累计</span><strong>{money(totals[channel].history.amount)}</strong></div>
          <small>{coverage(totals[channel].history)}</small>
        </div>)}
      </div>
      <p className="quota-overview-note">历史统计不含今天，缺失记录不计为零；代销与直销不能直接相加。</p>
    </div>
  </section>;
}
