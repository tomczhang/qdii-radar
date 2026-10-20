// Rates are percentage points (1.2 means 1.2%).
export const feePercent = value => Number.isFinite(value) ? `${value.toFixed(2)}%` : '待确认';
