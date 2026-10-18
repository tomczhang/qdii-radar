// Contribution is the share of scheduled application money, before fees.
// Merge the same fund code across channels; keep each channel's instructions.
export function planContributions(result) {
  const byCode = new Map();
  for (const allocation of result.allocations) for (const row of allocation.rows) {
    if (!(row.total > 0)) continue;
    if (!byCode.has(row.code)) byCode.set(row.code, {code: row.code, index: allocation.index, total: 0, rows: []});
    const fund = byCode.get(row.code);
    fund.total += row.total;
    fund.rows.push(row);
  }
  const funds = [...byCode.values()].sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  const total = funds.reduce((sum, fund) => sum + fund.total, 0);
  return {total, funds: funds.map(fund => ({...fund, contribution: total > 0 ? fund.total / total : 0,
    rows: [...fund.rows].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))}))};
}
