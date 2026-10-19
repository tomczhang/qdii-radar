const names={nasdaq:'纳斯达克100',sp500:'标普500'};
export const budgetPercent=value=>value>0&&value<0.1?'<0.1%':`${value.toFixed(1)}%`;
// Use the same horizon and cent amounts as the plan, including unassigned funds.
export function budgetSegments(result) {
  const budget=Math.round(result.amount*100);
  if(budget<=0)return [];
  const entries=result.allocations.flatMap(a=>[
    {id:`${a.index}-allocated`,index:a.index,kind:'allocated',label:`${names[a.index]}可投入`,cents:Math.round(a.achievableAmount*100)},
    {id:`${a.index}-shortfall`,index:a.index,kind:'shortfall',label:`${names[a.index]}缺口`,cents:Math.round(a.shortfall*100)},
  ]);
  entries.push({id:'unallocated',index:null,kind:'unallocated',label:'尚未分配至指数',cents:Math.round((result.unallocated||0)*100)});
  let offset=0;
  return entries.filter(s=>s.cents>0).map(s=>{
    const start=offset/budget;offset+=s.cents;
    return {...s,amount:s.cents/100,percent:s.cents/budget*100,start,end:offset/budget};
  });
}
// Two half-arcs also render a complete 100% ring without a degenerate arc.
export function donutSlicePath(start,end,outer=126,inner=88) {
  const point=(f,r)=>[160+r*Math.sin(f*Math.PI*2),160-r*Math.cos(f*Math.PI*2)].join(' ');
  const mid=(start+end)/2;
  return `M ${point(start,outer)} A ${outer} ${outer} 0 0 1 ${point(mid,outer)} A ${outer} ${outer} 0 0 1 ${point(end,outer)} L ${point(end,inner)} A ${inner} ${inner} 0 0 0 ${point(mid,inner)} A ${inner} ${inner} 0 0 0 ${point(start,inner)} Z`;
}
