import {initialInput,readPurchaseSnapshot,savePurchaseSnapshot} from '../purchase-snapshot.mjs';
import { usage } from '../usage.mjs';
import PlanOutcome from './PlanOutcome.jsx';
import MobileDisclosure from './MobileDisclosure.jsx';
import PlanCosts from './PlanCosts.jsx';
import PlanComparison from './PlanComparison.jsx';
import PlanExecution from './PlanExecution.jsx';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Calculator, ArrowRight, Info, ChevronRight, X, SlidersHorizontal } from 'lucide-react';
import { purchaseCandidates, selectedCandidates, calculatePurchasePlan, planSignature } from '../purchase-plan.mjs';
const money = n => `¥${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n)}`;
const channelName = (key,platform) => key==='agency'?`${platform || '代销平台'}${platform?'代销':''}`:key==='direct'?'基金公司直销':'跨渠道择一';
const optionKey = o => o.optionId || o.code;
const indexName = key => key === 'nasdaq' ? '纳斯达克100' : '标普500';
const StepTitle = ({number,children}) => <div className="calculator-section-title"><span>{number}</span><h2>{children}</h2></div>;
const loadSnapshot = () => {try{return readPurchaseSnapshot(window.localStorage);}catch{return null;}};
export default function PurchaseCalculator({funds, updatedAt, onDetail, favorites = []}) {
  const [snapshot] = useState(loadSnapshot);
  const [input,setInput] = useState(()=>snapshot?.input || {...initialInput}), [choices,setChoices] = useState(()=>snapshot?.choices || {}), [result,setResult] = useState(null), [error,setError] = useState('');
  const [completing,setCompleting] = useState(false), [revealVersion,setRevealVersion] = useState(0);
  const calculatorRef=useRef(null),pendingExit=useRef(null);
  const [storageNotice,setStorageNotice] = useState('');
  const [conditionsOpen,setConditionsOpen] = useState(()=>!snapshot);
  const drawerRef=useRef(null),editBaseline=useRef(null),conditionButton=useRef(null);
  const restored = useRef(false);
  const allGroups = useMemo(()=>purchaseCandidates(funds,input.channel),[funds,input.channel]);
  // Company selection is independent of today's quota and the selected sales channel.
  const managers = useMemo(()=>[...new Set(funds.filter(f=>f.venue!=='etf' && (!f.currency || f.currency==='CNY') && ['nasdaq','sp500'].includes(f.index)).map(f=>f.manager).filter(Boolean))].sort(),[funds]);
  const groups = useMemo(()=>allGroups.map(g=>({...g,options:g.options.filter(o=>input.selectedManagers===null || input.selectedManagers.includes(o.manager))})).filter(g=>g.options.length),[allGroups,input.selectedManagers]);
  const selected = selectedCandidates(groups,choices,input), signature = planSignature(selected);
  const stale = result && result.signature !== signature;
  const planStatus = !result ? null : result.blocked ? 'blocked' : result.shortfall>0 || result.targetUnreachable ? 'partial' : 'achievable';
  const scopePending=funds.filter(f=>f.venue!=='etf'&&(input.channel==='both'?['agency','direct']:[input.channel]).some(c=>f[c]?.status==='open'&&!['independent','shared'].includes(f[c]?.scope?.mode))).length;
  const favoriteGroups = groups.filter(g=>g.options.some(o=>favorites.includes(o.code)));
  const eligible = selected.filter(f=>input.includeSmallQuotas || f.limit>10);
  const totals = Object.fromEntries(['nasdaq','sp500'].map(index=>[index,eligible.filter(f=>f.index===index).reduce((s,f)=>s+f.limit,0)]));
  useEffect(()=>{
    if(restored.current || !snapshot || !funds.length)return;
    restored.current=true;
    if(snapshot.needsRecalculation){setStorageNotice('已恢复上次输入；原无比例模式已更新为偏标普，请重新计算。');setConditionsOpen(true);return;}
    if(signature!==snapshot.signature){setStorageNotice('已恢复上次输入；额度、费率或候选基金已变化，请重新计算。');setConditionsOpen(true);return;}
    try{setResult(calculatePurchasePlan(input,selected));setStorageNotice('已恢复上次计算快照，并核对当前额度。');}catch{setStorageNotice('已恢复上次输入，请重新计算。');setConditionsOpen(true);}
  },[snapshot,funds.length,signature,input,selected]);
  useEffect(()=>{
    if(!conditionsOpen)return;
    const dialog=drawerRef.current,previousOverflow=document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow='hidden';
    dialog.querySelector('h2').focus();
    const keepFocus=e=>{
      if(e.key!=='Tab')return;
      const controls=[...dialog.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.querySelector('h2'))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    };
    dialog.addEventListener('keydown',keepFocus);
    return ()=>{dialog.removeEventListener('keydown',keepFocus);dialog.close();document.body.style.overflow=previousOverflow;conditionButton.current?.focus({preventScroll:true});};
  },[conditionsOpen]);
  useEffect(()=>()=>{pendingExit.current?.cancel();pendingExit.current=null;},[]);
  useLayoutEffect(()=>{
    if(!revealVersion)return;
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    if(preference.matches)return;
    const animations=[...calculatorRef.current.querySelectorAll('.plan-result-step')].map((element,index)=>element.animate(
      [{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],
      {duration:280,delay:index*40,easing:'cubic-bezier(0.22, 1, 0.36, 1)',fill:'backwards'}
    ));
    const stop=()=>animations.forEach(animation=>animation.cancel());
    preference.addEventListener('change',stop);
    return ()=>{stop();preference.removeEventListener('change',stop);};
  },[revealVersion]);
  function openConditions() {
    editBaseline.current={input,choices,result,error,storageNotice};
    setConditionsOpen(true);
  }
  async function animateConditionsExit() {
    pendingExit.current?.cancel();
    pendingExit.current=null;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return true;
    setCompleting(true);
    const mobile=window.matchMedia('(max-width: 760px)').matches;
    const animation=drawerRef.current.animate(
      [{opacity:1,transform:'translate(0,0)'},{opacity:0,transform:mobile?'translateY(100%)':'translateX(24px)'}],
      {duration:180,easing:'cubic-bezier(0.4, 0, 1, 1)',fill:'forwards'}
    );
    pendingExit.current=animation;
    try{await animation.finished;}catch{return false;}
    if(pendingExit.current!==animation)return false;
    pendingExit.current=null;animation.cancel();
    return true;
  }
  async function closeConditions() {
    if(!await animateConditionsExit())return;
    setCompleting(false);
    const previous=editBaseline.current;
    if(previous){setInput(previous.input);setChoices(previous.choices);setResult(previous.result);setError(previous.error);setStorageNotice(previous.storageNotice);}
    editBaseline.current=null;
    setConditionsOpen(false);
  }
  function invalidate() {restored.current=true;setResult(null);setError('');setStorageNotice('');}
  function useFavorites() {setChoices(Object.fromEntries(groups.map(g=>[g.id,g.options.find(o=>favorites.includes(o.code))?.optionId || false])));invalidate();}
  const update = (key,value) => {setInput(p=>({...p,[key]:value}));invalidate();if(key==='channel')setChoices({});};
  function chooseRatio(mode) {setInput(p=>({...p,ratioMode:mode,ratio:mode.startsWith('any-')?'any':mode==='nasdaq'?100:mode==='sp500'?0:Number(p.customRatio)}));invalidate();}
  function select(id,value) {setChoices(p=>({...p,[id]:value}));invalidate();}
  function chooseManager(manager,checked) {
    const current=input.selectedManagers===null?managers:input.selectedManagers;
    update('selectedManagers',checked?[...new Set([...current,manager])]:current.filter(m=>m!==manager));
  }
  function persist(next,plan) {
    let saved=false;try{saved=savePurchaseSnapshot(window.localStorage,next,choices,plan);}catch{}
    setStorageNotice(saved?'已保存本次计算快照，下次打开自动恢复。':'本次计算已完成，但浏览器未能保存快照。');
  }
  function changePreference(key,value) {
    const next={...input,...(typeof key==='object'?key:{[key]:value})};
    try{const plan=calculatePurchasePlan(next,selectedCandidates(groups,choices,next));setInput(next);setResult(plan);setError('');persist(next,plan);}catch(e){setError(e.message);}
  }
  async function calculate(e) {
    e.preventDefault();
    if(pendingExit.current)return;
    restored.current=true;
    let plan;
    try{plan=calculatePurchasePlan(input,selected);}
    catch(error){setError(error.message);setResult(null);setStorageNotice('');return;}
    setError('');
    if(!await animateConditionsExit())return;
    setCompleting(false);setResult(plan);persist(input,plan);
    editBaseline.current=null;setConditionsOpen(false);setRevealVersion(version=>version+1);
  }
  const ratioSummary=input.ratioMode==='custom'?`纳指 ${input.ratio}% / 标普 ${100-Number(input.ratio)}%`:({'nasdaq':'只买纳指','sp500':'只买标普','any-sp500':'不限比例偏标普','any-nasdaq':'不限比例偏纳指'}[input.ratioMode]);
  const timeSummary=input.mode==='monthly'?`每月固定投入 · ${input.purchaseDays} 个扣款日`:input.mode==='steady'?`${input.weeks} 周分批 · ${input.frequency==='weekly'?'每周一次':'每个可申购日'}`:'资金尽快投完';
  return <section ref={calculatorRef} className="purchase-calculator" aria-label="购买计算器">
    <div className="calculator-conditions-summary">
      <div><span>投入条件</span><h2>{input.amount?`${input.mode==='monthly'?'每月':'计划投入'} ${money(Number(input.amount))}`:'设置条件，生成投入方案'}</h2><p>{timeSummary} · {ratioSummary} · {input.channel==='both'?'代销+直销':input.channel==='agency'?'代销':'直销'} · {input.selectedManagers===null?'全部基金公司':`已选 ${input.selectedManagers.length} 家基金公司`}</p></div>
      <button ref={conditionButton} type="button" className="button secondary" aria-haspopup="dialog" aria-expanded={conditionsOpen} onClick={openConditions}><SlidersHorizontal size={16}/>{result?'修改条件':'设置条件'}</button>
      {storageNotice&&<p className="calculator-storage-notice" role="status">{storageNotice}</p>}
    </div>
    <dialog ref={drawerRef} data-completing={completing || undefined} className="calculator-conditions-drawer" aria-labelledby="calculator-conditions-title" onCancel={e=>{e.preventDefault();closeConditions();}} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeConditions();}}>
    <header className="calculator-drawer-heading"><div><h2 id="calculator-conditions-title" tabIndex={-1}>设置投入条件</h2><p>计算后应用修改，关闭可保留原方案。</p></div><button type="button" className="icon-button" aria-label="关闭条件设置" onClick={closeConditions}><X size={20}/></button></header>
    <form className="calculator-form" onSubmit={calculate}>
      <div className="calculator-drawer-body" inert={completing}>
      <section className="calculator-step" aria-label="01 定金额">
        <StepTitle number="01">定金额</StepTitle>
        <div className="calculator-fields calculator-amount"><label>{input.mode==='monthly'?'每月投入预算（元）':'本次计划投入金额（元）'}<input type="number" min="1" max="100000000" step="0.01" required placeholder="例如 10000" value={input.amount} onChange={e=>update('amount',e.target.value)} /></label></div>
      </section>
      <section className="calculator-step" aria-label="02 定时间">
        <StepTitle number="02">定时间</StepTitle>
        <fieldset className="calculator-mode" aria-label="投入时间"><div className="calculator-mode-options">{[['monthly','每月固定投入','按每月预算安排扣款'],['fast','资金尽快投完','每个可申购日尽量投入'],['steady','资金稳健分批','自己设定周期，分散投入时点']].map(([value,label,note])=><label key={value} className={input.mode===value?'selected':''}><input type="radio" name="plan-mode" value={value} checked={input.mode===value} onChange={()=>update('mode',value)}/><span><strong>{label}</strong><small>{note}</small></span></label>)}</div></fieldset>
        {input.mode==='monthly' && <div className="calculator-monthly-settings"><label className="monthly-days">每月计划扣款日（天）<input type="number" min="1" max="23" step="1" required value={input.purchaseDays} onChange={e=>update('purchaseDays',e.target.value)}/></label><p>默认按20天测算，请按当月可申购日调整；已有持仓不参与每月重复分配。</p></div>}
        {input.mode==='steady' && <div className="calculator-fields paced-fields"><label>期望投完周期（周）<input type="number" required min="1" max="520" step="1" value={input.weeks} onChange={e=>update('weeks',e.target.value)}/></label><label>定投频率<select aria-label="定投频率" value={input.frequency} onChange={e=>update('frequency',e.target.value)}><option value="weekly">每周一次</option><option value="daily">每个可申购日</option></select></label></div>}
        {input.mode==='steady' && <p className="calculator-risk">“稳健分批”仅指投入节奏；定投不能消除股票基金的亏损风险。<a href="https://www.csrc.gov.cn/csrc/c101883/c1030398/content.shtml" target="_blank" rel="noreferrer">了解定投风险 ↗</a></p>}
      </section>
      <section className="calculator-step" aria-label="03 定比例">
        <StepTitle number="03">定比例</StepTitle>
        <fieldset className="calculator-ratio" aria-label="目标金额比例"><div className="ratio-presets">{[['nasdaq','只买纳指'],['sp500','只买标普'],['custom','自定义比例'],['any-sp500','无所谓比例偏标普'],['any-nasdaq','无所谓比例偏纳指']].map(([value,label])=><button type="button" key={value} aria-pressed={input.ratioMode===value} onClick={()=>chooseRatio(value)}>{label}</button>)}</div>
        {input.ratioMode==='custom' && <><div className="ratio-labels"><strong>纳指 {input.ratio}%</strong><strong>标普 {100-Number(input.ratio)}%</strong></div><input type="range" aria-label="纳指目标比例" min="0" max="100" step="1" value={input.ratio} onChange={e=>{setInput(p=>({...p,ratio:Number(e.target.value),customRatio:Number(e.target.value)}));invalidate();}}/></>}
        <p>{input.ratioMode.startsWith('any-')?`不设固定比例，先尽量投满预算；在同一期限内优先买${input.ratioMode==='any-sp500'?'标普':'纳指'}，额度不足时用另一侧补足。`:input.ratioMode==='nasdaq'?'本次新增资金全部用于纳斯达克100。':input.ratioMode==='sp500'?'本次新增资金全部用于标普500。':'比例用于分配本次新增资金，不预测收益、汇率或持仓涨跌。'}</p></fieldset>
        {input.mode!=='monthly' && input.ratioMode==='custom' && <details className="calculator-holdings"><summary>已有持仓？填入后按最终比例补齐 <ChevronRight size={14}/></summary><p>选填当前持仓市值。不填写时，比例只用于分配本次新增资金。</p><div className="calculator-fields"><label>已有纳指持仓（元）<input type="number" min="0" max="100000000" step="0.01" value={input.heldNasdaq} onChange={e=>update('heldNasdaq',e.target.value)} placeholder="0" /></label><label>已有标普持仓（元）<input type="number" min="0" max="100000000" step="0.01" value={input.heldSp500} onChange={e=>update('heldSp500',e.target.value)} placeholder="0" /></label></div></details>}
      </section>
      <section className="calculator-step" aria-label="04 定购买渠道">
        <StepTitle number="04">定购买渠道</StepTitle>
        <div className="calculator-fields calculator-amount"><label>购买渠道<select aria-label="购买渠道" value={input.channel} onChange={e=>update('channel',e.target.value)}><option value="agency">代销（方便）</option><option value="direct">直销（额度大）</option><option value="both">代销+直销（最大额度）</option></select></label></div>
        <p className="calculator-step-note">{input.channel==='both'?'合并比较两种渠道，只有公告确认独立的额度才相加；共享或关系待确认的额度择一使用。':input.channel==='agency'?'按基金标注的平台购买；同一份额在多个代销平台择一，不重复计额。':'在对应基金公司的直销渠道购买，实际限额以当前公告和购买页面为准。'}</p>
      </section>
      <MobileDisclosure title={`基金公司与份额 · 已选 ${managers.filter(m=>input.selectedManagers===null || input.selectedManagers.includes(m)).length} 家`} className="calculator-company-details"><section className="calculator-step" aria-label="05 定基金公司">
        <StepTitle number="05">定基金公司</StepTitle>
        <p className="calculator-step-note">基金公司默认全选，暂无额度的公司也保留。计算时只安排所选公司中当前有可用额度的基金。</p>
        <div className="calculator-company-actions"><span>已选 {managers.filter(m=>input.selectedManagers===null || input.selectedManagers.includes(m)).length} / {managers.length} 家</span><button type="button" onClick={()=>update('selectedManagers',null)}>全选</button><button type="button" onClick={()=>update('selectedManagers',[])}>清空</button></div>
        <fieldset className="calculator-companies" aria-label="参与购买的基金公司">{managers.map(manager=><label key={manager}><input type="checkbox" checked={input.selectedManagers===null || input.selectedManagers.includes(manager)} onChange={e=>chooseManager(manager,e.target.checked)}/>{manager}</label>)}</fieldset>
        {!managers.length && <p className="calculator-step-note">暂无基金公司数据。</p>}
        <div className="calculator-small-quotas"><button type="button" className="calculator-toggle-row" role="switch" aria-checked={input.includeSmallQuotas} aria-label="≤10元的小额度基金也纳入" onClick={()=>update('includeSmallQuotas',!input.includeSmallQuotas)}><span>≤10元的小额度基金也纳入</span><span className="calculator-toggle-track" aria-hidden="true"><span/></span></button><p className="calculator-step-note">按每日申购上限判断，代销和直销统一适用；关闭时跳过日限额≤10元的基金。</p></div>
        <div className="calculator-capacity"><span>当前选择的每日可用上限</span><div><strong>纳指 {money(totals.nasdaq)}</strong><strong>标普 {money(totals.sp500)}</strong></div><small>已按公司、小额度开关与渠道去重规则筛选。{scopePending>0 && `另有 ${scopePending} 个可申购份额的规则待核验，暂未纳入。`}</small></div>
      <details className="calculator-candidates"><summary>{selected.length} 个候选额度组 · 调整参与计算的份额</summary><p>以下是可用候选，先满足额度与投入节奏，计划可达成时可在方案中切换选基方式。日限额≤10元的基金由小额度开关统一控制，实际采用的额度以计算结果为准。独立份额分别列出；共享组保留可用额度较高的份额，同额度时优先A类，少维护方案优先C类；手动指定的份额不会自动切换。取消不准备购买的基金；直销需自行确认开户及购买资格。</p>{favoriteGroups.length>0 && <button className="calculator-use-favorites" type="button" onClick={useFavorites}>使用已关注的 {favoriteGroups.length} 个额度组</button>}{groups.length ? groups.map(group=>{
        const enabled=choices[group.id]!==false, code=choices[group.id] || optionKey(selected.find(r=>r.id===group.id) || group.options[0]);
        return <div className="calculator-candidate" key={group.id}><label><input type="checkbox" checked={enabled} onChange={e=>select(group.id,e.target.checked?optionKey(group.options[0]):false)}/><span>{group.name}<small>{channelName(group.channel)} · {indexName(group.index)} · {group.scope?.mode==='shared'?`共享 ${group.scope.members?.map(m=>m.share).join('/') || ''}`:`${group.options[0].share} 独立额度`}</small>{group.channelNote&&<small>{group.channelNote}</small>}</span></label><select aria-label={`${group.name}${channelName(group.channel)}参与计算的份额`} disabled={!enabled} value={code} onChange={e=>select(group.id,e.target.value)}>{!group.options.some(o=>optionKey(o)===code)&&<option value={code}>所选份额已不可用</option>}{group.options.map(o=><option key={optionKey(o)} value={optionKey(o)}>{channelName(o.channel,o.platform)} · {o.share} · {o.code} · {money(o.limit)}/日</option>)}</select></div>;
      }):<p>当前公司与渠道组合暂无可用基金，请调整选择。</p>}</details>
      </section></MobileDisclosure>
      </div>
      <footer className="calculator-drawer-footer">
      {error && <p className="calculator-error" role="alert">{error}</p>}
      <button className="button primary calculate-button" type="submit" disabled={completing} onClick={() => usage.calculateClick()}><Calculator size={18}/>生成方案<ArrowRight size={16}/></button>
      <p className="calculator-privacy">计算成功后，输入与结果快照仅保存在本浏览器，下次打开自动恢复，不会自动申购。网站仅统计匿名访问与按钮点击，不上传金额、持仓或计算结果。</p>
      </footer>
    </form>
    </dialog>
    <div className="calculator-results" aria-live="polite">
      {!result && <div className="calculator-placeholder"><Calculator size={32}/><h2>把金额变成可执行的步骤</h2><p>填好金额与比例，查看预计所需期数、每只基金的扣款金额，以及最后一笔如何收尾。</p><div><span>资金分配</span><ArrowRight size={14}/><span>额度约束</span><ArrowRight size={14}/><span>定投安排</span></div></div>}
      {stale && <div className="calculator-warning"><Info size={18}/><p>参与计算的额度、费率或份额已变化，请修改条件后重新计算。</p><button type="button" className="button secondary" onClick={openConditions}>重新计算</button></div>}
      {error&&!conditionsOpen&&<p className="calculator-error" role="alert">{error}</p>}
      {result && !stale && <>
        <section className="plan-result-step" aria-label="01 能不能完成">
          <StepTitle number="01">能不能完成</StepTitle>
          <PlanOutcome result={result} status={planStatus}/>
        </section>
        <MobileDisclosure title="调整选基、费用与账户明细" className="plan-secondary-details"><section className="plan-result-step" aria-label="02 选基与费用">
          <StepTitle number="02">选基与费用</StepTitle>
          <section className="plan-preferences" aria-label="比较选基方案">
            <PlanComparison {...{result,input,groups,choices}} onPreference={changePreference}/>
            <p className="plan-share-policy">同一基金有可用 A 类时优先选 A；“少维护”在不增加账户、产品数量的前提下优先选 C。额度不足时补充其他份额，手选份额保持不变。</p>
            {input.strategy==='returns' && <label className="plan-return-years">选基收益区间<select aria-label="比较收益区间" value={input.returnYears} onChange={e=>changePreference('returnYears',Number(e.target.value))}>{[1,3,5].map(year=><option key={year} value={year}>近{year}年</option>)}</select></label>}
          </section>
          <PlanCosts {...{result,input,groups,choices}} onPreference={changePreference}/>
        </section>
        <section className="plan-result-step" aria-label="03 需要购买几个产品">
          <StepTitle number="03">需要购买几个产品</StepTitle>
        {result.maintenance && <section className="plan-maintenance">
          <h3>{result.strategy==='returns'?`近${result.returnYears}年历史收益优先方案`:result.strategy==='fees'?'优先降低费用':'优先方便维护'}</h3><div className="maintenance-metrics"><div><strong>{result.maintenance.fundCount}</strong><span>只基金 · {result.maintenance.planCount} 条渠道计划</span></div>{input.channel!=='agency'?<><div><strong>{result.maintenance.accountCount}</strong><span>个直销账户</span></div>{result.maintenance.agencyUsed&&<div><strong>+ {result.maintenance.agencyPlatforms.length} 个平台</strong><span>{result.maintenance.agencyPlatforms.join('、')}</span></div>}</>:<div><strong>{result.maintenance.agencyPlatforms.length} 个平台</strong><span>{result.maintenance.agencyPlatforms.join('、')} · 待确认定投支持</span></div>}</div>
          {input.channel!=='agency'?<><p>涉及：{result.maintenance.managers.join('、') || '暂无可用直销账户'}。</p><p>账户按基金公司计算，不等同券商数或App安装数；可能通过官网、App或其他官方入口办理，请以各公司实际服务为准。</p></>:<p>按所选销售平台统计，不按基金公司数量计算。执行前需确认平台当前额度、个人购买资格和自动定投支持。</p>}
          <p className="plan-selection-note">{result.strategy==='maintenance'?'先满足预算与期限，再减少账户和购买产品；同等条件下优先选 C 类。':result.strategy==='returns'?`同一基金优先 A 类，再按近${result.returnYears}年历史收益安排额度。历史收益不代表未来收益，具体数据在最终方案中展开查看。`:`先满足预算与期限，同一基金优先 A 类，${result.costs.holdingYears==null?'按年度费率安排额度':`按申购费 + ${result.costs.holdingYears} 年持有费用安排额度`}。按额度上限估算排序，再逐笔估费，不保证全局费用最低。`}</p>
          {result.missingReturnCount>0 && <p className="calculator-warning">本方案有 {result.missingReturnCount} 只基金缺少近{result.returnYears}年收益，仅作为额度补充；不能据此认定其历史收益更高。</p>}
        </section>}
        </section></MobileDisclosure>
        {result.skippedSmallQuotas.length>0 && <p className="calculator-warning">本次已跳过 {result.skippedSmallQuotas.length} 个日限额≤10元的小额度候选。如需一起投入，请开启“≤10元的小额度基金也纳入”后重新计算。</p>}
        {result.targetUnreachable && <p className="calculator-warning">仅靠本次新增资金无法达到目标比例，已优先补足另一侧；不卖出现有持仓。按金额计算，完成后纳指占比约 {result.finalNasdaqPercent.toFixed(1)}%。</p>}
      </>}
    </div>
    {result && !stale && <>
        <section className="plan-result-step calculator-final-plan" aria-label="04 最终方案" aria-live="polite">
          <StepTitle number="04">最终方案</StepTitle>
          <PlanExecution {...{result,funds,onDetail}}/>
        <p className="plan-footnote">按含申购费的申请金额安排扣款，净投入另列；目标比例是申请金额比例，扣费后会偏离。不含赎回费；未确认最低起购金额或自动定投支持；小额尾款可能需要手动处理。当前暂停的基金不假设未来恢复，独立份额分别计额、共享额度组只计一次；新公告尚未核验或规则冲突的份额暂不纳入计划，因此不代表全部渠道的最短时间。</p>
        <p className="plan-footnote">额度采集时间：{updatedAt ? new Date(updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}) : '待更新'}；最终确认额度及份额限制以购买渠道和公告为准。</p>
        </section>
    </>}
  </section>;
}
