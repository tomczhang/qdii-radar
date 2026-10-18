import React, {useEffect, useId, useRef, useState} from 'react';
import {Clock3} from 'lucide-react';

export default function UpdateStatus({meta, formatTime}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null), id = useId();
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
    <button type="button" className={`update-stamp topbar-update-stamp${meta.updatedAt ? '' : ' is-pending'}`} aria-label={`数据更新：${meta.updatedAt ? formatTime(meta.updatedAt) : '等待首次同步'}，查看更新频率`} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>
      <Clock3 size={17} aria-hidden="true"/><span className="update-stamp-label">{meta.lastRun?.status === 'running' ? '正在同步' : '数据更新'}</span>
      {meta.updatedAt ? <time dateTime={meta.updatedAt}>{formatTime(meta.updatedAt)}</time> : <strong>等待首次同步</strong>}
    </button>
    {open && <div className="update-frequency" role="tooltip" id={id}>
      <strong>定时采集</strong>
      <p>每天 <strong>{meta.dailySyncTime || '07:30'}</strong>、<strong>16:30</strong> 同步额度、收益、净值与公告。</p>
    </div>}
  </div>;
}
