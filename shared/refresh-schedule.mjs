// Both scheduled page reads use Beijing time, regardless of the browser timezone.
export function nextDashboardRefresh(now = Date.now(), morning = '07:30') {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(morning)) morning = '07:30';
  const date = new Date(Number(now) + 8 * 3600000).toISOString().slice(0, 10);
  return Math.min(...[morning, '16:30'].map(time => {
    const timestamp = Date.parse(`${date}T${time}:00+08:00`);
    return timestamp > Number(now) ? timestamp : timestamp + 86400000;
  }));
}
