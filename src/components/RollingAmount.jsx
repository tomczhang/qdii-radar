import React from 'react';
import Counter from './react-bits/Counter.jsx';

export default function RollingAmount({value, currency = false, replayKey}) {
  if (!Number.isFinite(value)) return <span className="rolling-amount">—</span>;
  return <Counter
    className="rolling-amount"
    value={value}
    prefix={currency ? '¥' : undefined}
    locale="zh-CN"
    fontSize="inherit"
    tabular={false}
    direction="auto"
    duration={0.38}
    bounce={0.08}
    stagger={0.025}
    fade={0.16}
    motionBlur={false}
    replayKey={replayKey}
  />;
}
