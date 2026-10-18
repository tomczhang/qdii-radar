const text = html => html.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
export function parseRate(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(value || '');
  return match && Number(match[1]) <= 100 ? Number(match[1]) : null;
}
function amount(value,unit) { return Number(value)*(unit==='万'?10000:1); }
export function parseFeePage(html, code, observedAt = new Date().toISOString()) {
  // A changed or wrong product page must not silently become zero fees.
  if (!/^\d{6}$/.test(code) || !html.includes(code)) throw new Error('费率基金代码不匹配');
  const plain=text(html), operating={};
  for(const [key,label] of [['management','管理费率'],['custody','托管费率'],['service','销售服务费率']]) {
    const value=plain.match(new RegExp(label+'\\s*(\\d+(?:\\.\\d+)?%)'));
    operating[key]=parseRate(value?.[1]);
  }
  const section=html.match(/<label[^>]*>申购费率<\/label>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  const subscription=[];
  for(const match of (section || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells=[...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m=>text(m[1]));
    if(cells.length!==2)continue;
    const lower=cells[0].match(/大于等于\s*(\d+(?:\.\d+)?)(万?)元/), upper=cells[0].match(/小于\s*(\d+(?:\.\d+)?)(万?)元/);
    if(!lower&&!upper&&!/所有|全部|不限|---|^--$/.test(cells[0]))continue;
    const rates=[...cells[1].matchAll(/(\d+(?:\.\d+)?)%/g)].map(m=>Number(m[1])), fixed=cells[1].match(/每笔\s*(\d+(?:\.\d+)?)元/);
    if(!rates.length&&!fixed)continue;
    subscription.push({min:lower?amount(lower[1],lower[2]):0,max:upper?amount(upper[1],upper[2]):null,standardRate:rates[0]??null,agencyRate:rates.at(-1)??null,fixed:fixed?Number(fixed[1]):null});
  }
  if(Object.values(operating).every(v=>v==null)&&!subscription.length)throw new Error('费率页面结构异常');
  return {operating,annualRate:Object.values(operating).every(Number.isFinite)?Math.round(Object.values(operating).reduce((a,b)=>a+b,0)*10000)/10000:null,subscription,source:'天天基金费率页',sourceUrl:`https://fundf10.eastmoney.com/jjfl_${code}.html`,observedAt,directBasis:'标准费率估算，直销实际折扣待确认'};
}
