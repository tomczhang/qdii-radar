export const SNAPSHOT_KEY = 'qdii-radar:purchase-calculator:v1';
export const initialInput = {amount:'',heldNasdaq:'',heldSp500:'',ratio:70,ratioMode:'custom',customRatio:70,mode:'monthly',channel:'direct',strategy:'fees',returnYears:1,holdingYears:1,feeBasis:'annual',frequency:'weekly',weeks:12,purchaseDays:20,selectedManagers:null,includeSmallQuotas:false};

// Only restore known fields. Never render a stored result as a current quote;
// the UI recomputes it after checking the latest candidate signature.
export function readPurchaseSnapshot(storage) {
  try {
    const snapshot=JSON.parse(storage.getItem(SNAPSHOT_KEY));
    if(snapshot?.version!==1 || !snapshot.input || typeof snapshot.signature!=='string' || !Number.isFinite(Date.parse(snapshot.savedAt)))return null;
    const raw=snapshot.input, input={...initialInput};
    const enums={mode:['fast','steady','monthly'],channel:['agency','direct','both'],strategy:['maintenance','returns','fees'],feeBasis:['subscription','annual'],frequency:['weekly','daily'],ratioMode:['nasdaq','sp500','custom','any','any-sp500','any-nasdaq']};
    for(const [key,values] of Object.entries(enums)) {
      if(!values.includes(raw[key]))return null;
      input[key]=raw[key];
    }
    for(const [key,min,max,integer] of [['amount',1,1e8],['heldNasdaq',0,1e8],['heldSp500',0,1e8],['customRatio',0,100,true],['weeks',1,520,true],['purchaseDays',1,23,true],['returnYears',1,5,true]]) {
      const value=raw[key];
      if(!['number','string'].includes(typeof value)||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>max||(integer&&!Number.isInteger(Number(value)))) {
        const inactive=(key==='weeks'&&input.mode!=='steady')||(key==='purchaseDays'&&input.mode!=='monthly')||(key.startsWith('held')&&(input.mode==='monthly'||input.ratioMode!=='custom'))||(key==='customRatio'&&input.ratioMode!=='custom');
        if(inactive)continue;
        return null;
      }
      input[key]=value;
    }
    if(![1,3,5].includes(Number(input.returnYears)))return null;
    if(raw.holdingYears!==null && (!Number.isFinite(raw.holdingYears)||raw.holdingYears<=0||raw.holdingYears>50))return null;
    if(raw.selectedManagers!==null && (!Array.isArray(raw.selectedManagers)||!raw.selectedManagers.every(m=>typeof m==='string')))return null;
    if(typeof raw.includeSmallQuotas!=='boolean')return null;
    Object.assign(input,{holdingYears:raw.holdingYears,selectedManagers:raw.selectedManagers,includeSmallQuotas:raw.includeSmallQuotas});
    const migrations=[];
    if(input.ratioMode==='any'){input.ratioMode='any-sp500';migrations.push('原无比例模式已更新为偏标普');}
    if(input.mode==='steady'){input.mode='fast';migrations.push('资金稳健分批已移除，已切换为资金尽快投完');}
    const needsRecalculation=migrations.length>0;
    const recalculationNotice=needsRecalculation?`已恢复上次输入；${migrations.join('；')}，请核对条件后重新计算。`:null;
    input.ratio=input.ratioMode.startsWith('any-')?'any':input.ratioMode==='nasdaq'?100:input.ratioMode==='sp500'?0:Number(input.customRatio);
    const choices=Object.fromEntries(Object.entries(snapshot.choices || {}).filter(([,value])=>value===false||typeof value==='string'));
    return {input,choices,signature:snapshot.signature,savedAt:snapshot.savedAt,needsRecalculation,recalculationNotice};
  } catch { return null; }
}

export function savePurchaseSnapshot(storage,input,choices,result) {
  try {
    storage.setItem(SNAPSHOT_KEY,JSON.stringify({version:1,savedAt:new Date().toISOString(),input,choices,signature:result.signature,result}));
    return true;
  } catch { return false; }
}
