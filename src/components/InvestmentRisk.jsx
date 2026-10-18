import React, {useEffect, useState} from 'react';
import {Info, X} from 'lucide-react';

const storageKey = 'qdii-radar:risk-dismissed-until';
const day = 24 * 60 * 60 * 1000;
function readDismissal() {
  try {
    const until = Number(localStorage.getItem(storageKey));
    return Number.isFinite(until) && until > Date.now() && until <= Date.now() + day ? until : 0;
  } catch { return 0; }
}

export default function InvestmentRisk() {
  const [dismissedUntil, setDismissedUntil] = useState(readDismissal);
  useEffect(() => {
    const refresh = () => {
      if (dismissedUntil && Date.now() >= dismissedUntil) setDismissedUntil(0);
    };
    const sync = event => {
      if (event.key === storageKey || event.key === null) setDismissedUntil(readDismissal());
    };
    const timer = dismissedUntil ? setTimeout(refresh, Math.max(0, dismissedUntil - Date.now())) : null;
    window.addEventListener('storage', sync);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [dismissedUntil]);

  function dismiss() {
    const until = Date.now() + day;
    setDismissedUntil(until);
    try { localStorage.setItem(storageKey, String(until)); } catch { /* Keep this visit usable when storage is blocked. */ }
  }

  if (dismissedUntil) return null;
  return <div className="investment-risk" role="note">
    <Info size={20} aria-hidden="true"/><strong>投资有风险，入市需谨慎</strong>
    <button type="button" className="investment-risk-close" aria-label="关闭风险提示，24小时后再次显示" title="关闭后24小时内不再显示" onClick={dismiss}><X size={18} aria-hidden="true"/></button>
  </div>;
}
