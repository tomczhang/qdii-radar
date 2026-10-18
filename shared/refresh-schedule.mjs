// Both scheduled page reads use Beijing time, regardless of the browser timezone.
export function nextDashboardRefresh(now = Date.now(), morning = '07:30') {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(morning)) morning = '07:30';
  const date = new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10);
  return Math.min(...[morning, '16:30'].map(time => {
    const timestamp = Date.parse(`${date}T${time}:00+08:00`);
    return timestamp > Number(now) ? timestamp : timestamp + 86400000;
  }));
}

// Poll only while a run is active (or starting at a scheduled slot).
export function dashboardRefreshDelay(meta, now = Date.now(), failed = false) {
  const morning = meta?.dailySyncTime || '07:30';
  if (failed || !meta?.lastRun || meta.lastRun.status === 'running') return 15000;
  const next = nextDashboardRefresh(now, morning);
  const recentSlot = nextDashboardRefresh(Number(now) - 90000, morning);
  if (recentSlot <= Number(now) && !(Date.parse(meta.lastRun.startedAt) >= recentSlot)) return 15000;
  return Math.max(1, next - Number(now));
}
