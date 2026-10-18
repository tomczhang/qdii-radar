const pages = { overview: '基金总览', calculator: '购买计算器', changes: '额度动态', alerts: '邮箱提醒' };
const tabs = { navigation: Object.keys(pages), venue: ['otc', 'etf'], index: ['all', 'nasdaq', 'sp500'] };
const paths = { overview: '/', calculator: '/calculator', changes: '/changes', alerts: '/alerts' };

// Only public configuration comes from our server. All events go directly to Umami Cloud.
export function createUsageTracker(environment = globalThis) {
  let initialized = false, ready = false, disabled = false, lastPage;
  const pending = [];
  function send(event) {
    if (disabled) return;
    if (!ready) { if (pending.length < 100) pending.push(event); return; }
    try {
      // Override URL/title for this state-based SPA; never send query strings or form values.
      Promise.resolve(environment.umami.track(props => ({
        ...props, url: paths[event.page], title: pages[event.page], referrer: '',
        ...(event.name ? { name: event.name, data: event.data } : {}),
      }))).catch(() => {});
    } catch { /* Statistics must never interrupt the app. */ }
  }
  const disable = () => { disabled = true; pending.length = 0; };
  return {
    async init() {
      if (initialized) return;
      initialized = true;
      try {
        const response = await environment.fetch('/api/public-config', { credentials: 'same-origin' });
        if (!response.ok) return disable();
        const { umamiWebsiteId } = await response.json();
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(umamiWebsiteId || '')) return disable();
        const script = environment.document.createElement('script');
        script.src = 'https://cloud.umami.is/script.js';
        script.async = true;
        script.setAttribute('data-website-id', umamiWebsiteId);
        // Explicit pageviews prevent double counts and work with React state navigation.
        script.setAttribute('data-auto-track', 'false');
        script.setAttribute('data-exclude-search', 'true');
        script.setAttribute('data-exclude-hash', 'true');
        script.onload = () => {
          if (typeof environment.umami?.track !== 'function') return disable();
          ready = true;
          pending.splice(0).forEach(send);
        };
        script.onerror = disable;
        environment.document.head.appendChild(script);
      } catch { disable(); }
    },
    pageView(page) {
      if (!Object.hasOwn(pages, page) || page === lastPage) return;
      lastPage = page;
      send({ page });
    },
    tabClick(group, tab, page) {
      if (!tabs[group]?.includes(tab) || !Object.hasOwn(pages, page)) return;
      send({ page, name: `tab_${group}_${tab}`, data: { group, tab } });
    },
    calculateClick() { send({ page: 'calculator', name: 'calculator_calculate_click' }); },
  };
}
export const usage = createUsageTracker();
