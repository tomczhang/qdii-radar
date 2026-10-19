// AnyService caps response bodies at 1000KB. Do not send the website's
// per-day quota history, scope evidence, notices or chart series to the miniapp.
export function miniappDashboard(board) {
  const { meta } = board;
  return {
    funds: board.funds.map(fund => ({
      code: fund.code, name: fund.name, share: fund.share, index: fund.index, venue: fund.venue,
      agency: quota(fund.agency), direct: quota(fund.direct),
      returns: fund.returns, returnsAsOf: fund.returnsAsOf || null,
      quote: fund.quote ? { price: fund.quote.price, premium: fund.quote.premium, change: fund.quote.change, date: fund.quote.date, suspended: fund.quote.suspended } : null,
      stale: fund.stale, dataIssueCount: fund.dataIssues?.length || 0,
    })),
    changes: board.changes.map(change => ({
      id: change.id, code: change.code, name: change.name, channel: change.channel,
      type: change.type, before: change.before, after: change.after,
      effectiveAt: change.effectiveAt, createdAt: change.createdAt,
    })),
    meta: {
      mode: meta.mode, view: 'miniapp', updatedAt: meta.updatedAt || null,
      otcCount: meta.otcCount, etfCount: meta.etfCount, staleCount: meta.staleCount,
      timezone: meta.timezone, nextRunAt: meta.nextRunAt, dailySyncTime: meta.dailySyncTime,
      changesWindow: meta.changesWindow,
      changesCoverage: { complete: meta.changesCoverage?.complete === true },
    },
  };
}

function quota(value) {
  return value ? { status: value.status, limit: value.limit ?? null } : { status: 'unknown', limit: null };
}
