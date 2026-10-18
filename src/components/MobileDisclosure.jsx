import React, {useEffect, useState} from 'react';

// Keep desktop information visible, but let mobile readers open secondary detail on demand.
export default function MobileDisclosure({title, children, className = ''}) {
  const [open, setOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const change = () => setOpen(!media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return <details className={`mobile-disclosure ${className}`} open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{title}</summary><div className="mobile-disclosure-content">{children}</div>
  </details>;
}
