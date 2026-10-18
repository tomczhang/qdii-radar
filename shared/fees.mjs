// All rates are percentage points (1.2 means 1.2%). Gross subscriptions include fees.
export const feePercent = value => Number.isFinite(value) ? `${value.toFixed(2)}%` : '待确认';
export function subscriptionCharge(amount, fees, channel) {
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (!amount) return 0;
  const tier = fees?.subscription?.find(t => amount >= t.min && (t.max == null || amount < t.max));
  if (!tier) return null;
  if (Number.isFinite(tier.fixed)) return Math.min(Math.round(amount*100),Math.round(tier.fixed*100))/100;
  const rate = channel === 'agency' ? tier.agencyRate : tier.standardRate;
  if (!Number.isFinite(rate) || rate < 0) return null;
  return Math.round((amount-amount/(1+rate/100))*100)/100;
}
export function costScore(row, years = null, basis = 'subscription') {
  const fee = subscriptionCharge(row.limit,row.fees,row.channel);
  const annual = row.fees?.annualRate;
  if (fee == null || !Number.isFinite(annual) || row.fees?.stale) return Infinity;
  if (years == null || years === '') return basis === 'annual' ? annual/100 : fee/row.limit;
  return fee/row.limit + (1-fee/row.limit)*annual/100*years;
}
export function estimateCosts(row, years = null) {
  const regular = subscriptionCharge(row.regular,row.fees,row.channel), last = subscriptionCharge(row.last,row.fees,row.channel);
  const subscriptionFee = regular == null || last == null ? null : Math.round((regular*row.fullCycles+last)*100)/100;
  const netAmount = subscriptionFee == null ? null : Math.round((row.total-subscriptionFee)*100)/100;
  const annualCost = netAmount != null && Number.isFinite(row.fees?.annualRate) ? Math.round(netAmount*row.fees.annualRate)/100 : null;
  return {subscriptionFee,netAmount,annualCost,holdingCost:annualCost==null||years==null?null:Math.round(netAmount*row.fees.annualRate/100*years*100)/100};
}

// Compare the entire scheduled purchase, including any catch-up after the horizon.
// The holding period applies to each purchase; this is not a calendar-year bill.
export function planCostSummary(plan) {
  const scheduledAmount=Math.round(plan.allocations.flatMap(a=>a.rows).reduce((sum,row)=>sum+row.total,0)*100)/100;
  const {subscriptionFee,holdingCost,holdingYears}=plan.costs;
  const total=holdingYears!=null && Number.isFinite(subscriptionFee) && Number.isFinite(holdingCost)
    ? Math.round((subscriptionFee+holdingCost)*100)/100 : null;
  return {scheduledAmount,total};
}

// Static comparison of one equal-gross purchase, never a return forecast.
export function shareBreakEven(a, c, amount) {
  if (a.channel!==c.channel || a.fees?.stale || c.fees?.stale || !Number.isFinite(amount) || amount<=0) return null;
  const af=subscriptionCharge(amount,a.fees,a.channel),cf=subscriptionCharge(amount,c.fees,c.channel);
  const ar=a.fees?.annualRate,cr=c.fees?.annualRate;
  if (af==null || cf==null || !Number.isFinite(ar) || !Number.isFinite(cr) || ar>=cr || af<=cf) return null;
  const saving=((amount-cf)*cr-(amount-af)*ar)/100;
  return saving>0 ? {years:(af-cf)/saving,amount} : null;
}
