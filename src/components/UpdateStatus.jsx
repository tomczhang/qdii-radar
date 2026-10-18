import React, {useEffect, useId, useRef, useState} from 'react';
import {Clock3} from 'lucide-react';

export default function UpdateStatus({meta, formatTime}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null), id = useId();
  const running = meta.lastRun?.status === 'running';
  const phase = {discovery: '检查基金名单', market: '更新额度', notices: '核查当前公告', performance: '补充收益走势', analytics: '更新场内行情', history: '补录额度动态', backfill: '补录历史额度'}[meta.lastRun?.phase] || '正在同步';
  const progress = running ? `${phase}${meta.lastRun.total ? ` ${meta.lastRun.completed || 0}/${meta.lastRun.total}` : ''}` : null;
  const status = progress || (meta.updatedAt ? formatTime(meta.updatedAt) : '等待首次同步');
  useEffect(() => {
    if (!open) return;
    const dismiss = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div className="update-status" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!ref.current?.contains(document.activeElement)) setOpen(false); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className={`update-stamp topbar-update-stamp${meta.updatedAt ? '' : ' is-pending'}`} aria-label={`数据更新：${status}，查看更新频率`} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>
      <Clock3 size={17} aria-hidden="true"/><span className="update-stamp-label">{running ? '正在同步' : '数据更新'}</span>
      {progress ? <strong>{progress}</strong> : meta.updatedAt ? <time dateTime={meta.updatedAt}>{formatTime(meta.updatedAt)}</time> : <strong>等待首次同步</strong>}
    </button>
    {open && <div className="update-frequency" role="tooltip" id={id}>
      <strong>定时采集</strong>
      <p>每天 <strong>{meta.dailySyncTime || '07:30'}</strong>、<strong>16:30</strong> 同步额度、收益、净值与公告。</p>
      {running && <p>{progress}。数据分批展示，页面每15秒自动更新。</p>}
      {running && meta.updatedAt && <p>最近数据写入：{formatTime(meta.updatedAt)}。各字段日期见基金详情。</p>}
    </div>}
  </div>;
}
