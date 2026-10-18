import {openStore} from '../server/store.mjs';
import {fetchFees} from '../server/providers.mjs';
const store=openStore(), funds=store.snapshots().filter(f=>f.venue!=='etf');
let next=0,success=0;const failures=[];
try {
  await Promise.all(Array.from({length:4},async()=>{
    while(next<funds.length){const fund=funds[next++];try{
      const fees=await fetchFees(fund.code);
      // Preserve the latest quota/market snapshot and its timestamps.
      const latest=store.snapshot(fund.code);if(latest){store.saveSnapshot({...latest,fees});success++;}
    }catch{failures.push(fund.code);}}
  }));
  console.log(JSON.stringify({success,total:funds.length,failedCodes:failures}));
  if(failures.length)process.exitCode=1;
}finally{store.close();}
