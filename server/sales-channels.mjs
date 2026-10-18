import {chinaDate} from './domain.mjs';

// Availability and a fund-wide subscription cap are separate facts. Platform
// reports retain their own timestamp; refreshing Tiantian cannot renew them.
export const salesChannelEvidence = {
  '022523': {
    directUnavailableFrom:'2024-11-01',
    directSourceUrl:'https://pdf.dfcfw.com/pdf/H2_AN202411011640656967_1.pdf',
    directEvidence:'第6.1节：本基金D类基金份额暂不上线直销机构。',
    platforms:['腾讯理财通','京东金融'],
    reportedAt:'2026-10-18T07:04:37Z',
    validity:'until_replaced',
    platformSource:'用户确认销售平台，非平台接口核验',
    limit:100,
    quotaEffectiveFrom:'2026-09-02',
    quotaSourceUrl:'https://pdf.dfcfw.com/pdf/H2_AN202609011828844257_1.pdf',
    quotaEvidence:'第2(1)条：单个基金份额单笔及单日单账户累计申购不超过100元；9月18日公告仅暂停A/C，D类继续适用。',
  },
  '022525': {
    directUnavailableFrom:'2024-11-01',
    directSourceUrl:'https://pdf.dfcfw.com/pdf/H2_AN202411011640657980_1.pdf',
    directEvidence:'第6.1节：本基金D类基金份额暂不上线直销机构。',
    platforms:['腾讯理财通','京东金融'],
    reportedAt:'2026-10-16T14:56:50Z',
    // Keep this manually confirmed allowance until replaced by new evidence.
    validity:'until_replaced',
    platformSource:'用户确认销售平台，非平台接口核验',
    limit:100,
    quotaEffectiveFrom:'2026-09-21',
    quotaSourceUrl:'https://pdf.dfcfw.com/pdf/H2_AN202609181829590491_1.pdf',
    quotaEvidence:'第2(3)条：D类单笔及单个基金账户单日累计申购金额不得超过100元。',
  },
};
export function applySalesChannels(fund, now=new Date(), quotaRule=null) {
  const evidence=salesChannelEvidence[fund.code];
  if(!evidence)return fund;
  const date=chinaDate(now);
  const direct=date>=evidence.directUnavailableFrom?{status:'unavailable',limit:null,source:'基金公司销售渠道公告',sourceUrl:evidence.directSourceUrl,evidence:evidence.directEvidence,reason:evidence.directEvidence,effectiveAt:`${evidence.directUnavailableFrom}T00:00:00+08:00`}:fund.direct;
  let agency=fund.agency;
  if(date>=chinaDate(new Date(evidence.reportedAt))) {
    const expired=evidence.validity!=='until_replaced' && +now-Date.parse(evidence.reportedAt)>36*3600000;
    agency={status:expired?'unknown':'open',limit:expired?null:evidence.limit,platforms:evidence.platforms,source:evidence.platformSource,sourceUrl:evidence.quotaSourceUrl,observedAt:evidence.reportedAt,validity:evidence.validity,availabilityBasis:'user_report',reason:expired?'销售平台信息待重新确认':evidence.platformSource,evidence:evidence.quotaEvidence,platformNote:'两个平台择一，合计最多计100元；平台实时额度及定投支持需下单前确认。',tiantian:fund.agency};
    if(fund.direct?.pendingReview || [fund.direct,quotaRule].some(rule=>rule?.effectiveAt && rule.effectiveAt.slice(0,10)>evidence.quotaEffectiveFrom)) {
      agency={...agency,status:'unknown',limit:null,reason:'出现新的额度规则，原平台限额需重新核验'};
    }
  }
  return {...fund,direct,agency,quotaNote:`${evidence.directEvidence} D类公告上限100元；腾讯理财通、京东金融由用户确认可买，非天天基金。多个平台不重复计算。`,salesChannelEvidence:evidence,
    fees:fund.fees?{...fund.fees,agencyBasis:'其他代销平台：仅沿用公告零申购费，非天天优惠',subscription:fund.fees.subscription?.map(t=>({...t,agencyRate:t.standardRate===0?0:null,fixed:null}))}:fund.fees};
}
export function correctSalesHistory(code,channel,row) {
  const evidence=salesChannelEvidence[code];
  if(!evidence||row.date<evidence.directUnavailableFrom)return row;
  if(channel==='direct')return {...row,status:'unavailable',limit:0,origin:'announcement_estimate',source:'销售渠道公告纠正',sourceUrl:evidence.directSourceUrl,evidence:evidence.directEvidence,reason:null};
  // Old Tiantian observations do not establish availability on these platforms.
  // Do not backdate today's user report or relabel direct history as agency.
  if(row.date<chinaDate(new Date(evidence.reportedAt)))return {...row,status:'unknown',limit:null,origin:'missing',reason:'缺少腾讯理财通、京东金融该日可买额度记录；不以天天基金状态替代',sourceUrl:null};
  return row;
}
