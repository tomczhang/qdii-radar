// Hypothetical holding-period outcomes, not a forecast or a contribution-calendar backtest.
export function planReturnScenarios(plan, horizons=[1,3,5]) {
  const rows=plan.allocations.flatMap(a=>a.rows).filter(r=>r.total>0);
  const missingReturns=rows.filter(r=>!Number.isFinite(r.returns?.y1)||r.returns.y1 < -100).length;
  const missingCosts=rows.filter(r=>!Number.isFinite(r.costs?.netAmount)).length;
  const scheduledAmount=rows.reduce((sum,r)=>sum+r.total,0);
  const available=rows.length>0&&!missingReturns&&!missingCosts;
  const round=n=>Math.round(n*100)/100;
  return {
    scheduledAmount,missingReturns,missingCosts,
    dates:[...new Set(rows.map(r=>r.returnsAsOf).filter(Boolean))].sort(),
    scenarios:horizons.map(years=>{
      const value=available?rows.reduce((sum,r)=>sum+r.costs.netAmount*(1+r.returns.y1/100)**years,0):null;
      return {years,value:Number.isFinite(value)?round(value):null,profit:Number.isFinite(value)?round(value-scheduledAmount):null};
    }),
  };
}
