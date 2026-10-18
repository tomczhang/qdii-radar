// Calendar duration is approximate; purchase periods remain unchanged in the plan.
export function formatPlanDuration(periods, weekly = false) {
  if (!Number.isFinite(periods) || periods < 0) return '无法估算';
  if (periods === 0) return '无需等待';
  const days = periods * (weekly ? 7 : 7 / 5);
  const months = Math.round(days / (365.25 / 12));
  if (months === 0) return '不足 1 个月';
  const years = Math.floor(months / 12), remainder = months % 12;
  return `约 ${[years && `${years} 年`, remainder && `${remainder} 个月`].filter(Boolean).join(' ')}`;
}
