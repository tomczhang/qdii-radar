import {dashboardRefreshDelay,nextDashboardRefresh} from '../shared/refresh-schedule.mjs';

export const DASHBOARD_CACHE_KEY='qdii-radar:dashboard:v1';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validBoard=board=>record(board)&&record(board.meta)&&Array.isArray(board.changes)&&board.changes.every(record)&&Array.isArray(board.funds)&&board.funds.every(f=>
  record(f)&&typeof f.code==='string'&&typeof f.name==='string'&&typeof f.manager==='string'&&record(f.returns)&&(f.venue==='etf'||(record(f.agency)&&record(f.direct)))
);
// Pin expiry to the original request time, never to a subsequent cache read.
// A run in progress (or not yet observed at a scheduled slot) still polls at 15s.
export function dashboardCacheExpiry(board,requestedAt) {
  return Math.min(nextDashboardRefresh(requestedAt,board.meta.dailySyncTime),requestedAt+dashboardRefreshDelay(board.meta,requestedAt));
}
function validEntry(entry,now) {
  return entry?.version===1&&Number.isFinite(entry.savedAt)&&Number.isFinite(entry.expiresAt)&&validBoard(entry.board)
    &&entry.savedAt<=now&&now<entry.expiresAt&&entry.expiresAt===dashboardCacheExpiry(entry.board,entry.savedAt);
}
export function readDashboardCache(storage,now=Date.now()) {
  try {
    const entry=JSON.parse(storage?.getItem(DASHBOARD_CACHE_KEY)||'null');
    return validEntry(entry,now)?entry:null;
  } catch {return null;}
}

// This cache contains only the public dashboard, never account or subscription data.
// Memory keeps the same refresh semantics if browser storage is blocked or full.
export function createDashboardLoader({fetchBoard,storage,now=Date.now}) {
  let memory=null,inFlight=null;
  const getStorage=()=>{try{return typeof storage==='function'?storage():storage;}catch{return null;}};
  return async function loadDashboard() {
    const at=now(),stored=readDashboardCache(getStorage(),at);
    const cached=[stored,memory].filter(entry=>validEntry(entry,at)).sort((a,b)=>b.savedAt-a.savedAt)[0];
    if(cached){memory=cached;return {board:cached.board,expiresAt:cached.expiresAt};}
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      const board=await fetchBoard();
      if(!validBoard(board))throw new Error('看板数据格式异常，请稍后重试');
      const entry={version:1,savedAt:at,expiresAt:dashboardCacheExpiry(board,at),board};
      memory=entry;
      try {
        const target=getStorage(),newer=readDashboardCache(target,now());
        if(!newer||newer.savedAt<=at)target?.setItem(DASHBOARD_CACHE_KEY,JSON.stringify(entry));
      } catch { /* A failed cache write must not discard a successful response. */ }
      return {board,expiresAt:entry.expiresAt};
    })();
    try {return await inFlight;} finally {inFlight=null;}
  };
}
