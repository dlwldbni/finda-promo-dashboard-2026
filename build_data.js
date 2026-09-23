// build_data.js — 기존 index.html 의 DEFAULT_DATA(실데이터)를 v2 기여도 대시보드용 data/*.json 으로 변환.
// 실행: node build_data.js   (레포 루트에서)
// 나중에 자동갱신 파이프라인이 이 스크립트를 재사용해 JSON 을 갱신하는 "관" 역할.
const fs = require('fs');
const path = require('path');

const REPO = __dirname;
const html = fs.readFileSync(path.join(REPO, 'detail.html'), 'utf8');  // 데이터 소스(구 index.html) — 자동갱신 로봇이 채우는 상세 대시보드

// ---- index.html 에서 DEFAULT_DATA 객체 텍스트를 브레이스 매칭으로 추출 ----
function extractDefaultData(src) {
  const marker = 'const DEFAULT_DATA = ';
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('DEFAULT_DATA not found');
  let j = i + marker.length;
  while (src[j] !== '{') j++;
  let depth = 0, inStr = null;
  for (let k = j; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (inStr) { if (c === '\\') { k++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { while (k < src.length && src[k] !== '\n') k++; continue; }
    if (c === '/' && n === '*') { k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  throw new Error('unbalanced braces');
}

const DEFAULT_DATA = eval('(' + extractDefaultData(html) + ')');
const byId = Object.fromEntries(DEFAULT_DATA.promotions.map(p => [p.id, p]));

// ---- 유틸 ----
const nn = v => (v === undefined || v === '' ? null : v);
function periodDates(str) {
  const m = [...String(str).matchAll(/(\d{2})\.(\d{2})\.(\d{2})/g)];
  const d = x => `20${x[1]}-${x[2]}-${x[3]}`;
  return [d(m[0]), m[1] ? d(m[1]) : d(m[0])];
}

// 총계만 있는 프로모션(P1/P2/P3/P4) → run 1개, 일자 1행(시작일 앵커)
function totalRun(P, label) {
  const [s, e] = periodDates(P.period);
  return {
    label, start: s, end: e, granularity: 'total',
    // 총계 프로모션(신년·세뱃돈·대출신청상시)은 채널상 발송/광고비로 분류 (원본에 포인트/발송 구분 없음)
    daily: [{ date: s, introView: nn(P.actual.introView), inquiry: nn(P.actual.intro), apply: nn(P.actual.apply), contract: nn(P.actual.contract), amount: null, revenue: nn(P.d0_revenue), pointCost: null, sendCost: nn(P.actual.cost) }]
  };
}
// P5/P7 스타일 일자별 (paymentCount=한도조회 / creditLoan+otherLoan=신청)
function dailyRunP5P7(P, label) {
  const [s, e] = periodDates(P.period);
  const daily = P.dailyLog.map(d => ({
    date: d.date,
    introView: nn(d.introView),
    inquiry: d.paymentCount != null ? d.paymentCount : ((d.approve || 0) + (d.reject || 0)),
    approve: nn(d.approve),   // 가승인 (한도조회 세부)
    reject: nn(d.reject),     // 올거절 (한도조회 세부)
    apply: (d.creditLoan != null || d.otherLoan != null) ? (d.creditLoan || 0) + (d.otherLoan || 0) : null,
    creditLoan: nn(d.creditLoan),  // 신용대출 신청 (신청 세부)
    otherLoan: nn(d.otherLoan),    // 우수대부 신청 (신청 세부)
    contract: nn(d.contract),
    amount: null,
    revenue: null,
    pointCost: nn(d.cost),  // 지급 포인트 = 포인트 비용
    sendCost: null,
  }));
  return { label, start: s, end: e, granularity: 'daily', daily };
}
// P6 (라운드) 일자별 (limitCheck=한도조회 / applyCount=신청 / contractAmount / revenue 있음)
function p6Runs(P) {
  return P.rounds.map(r => {
    const rows = P.dailyLog.filter(d => d.group === r.group);
    const daily = rows.map(d => ({
      date: d.date, introView: null, inquiry: nn(d.limitCheck), apply: nn(d.applyCount),
      contract: nn(d.contract), amount: nn(d.contractAmount), revenue: nn(d.revenue),
      pointCost: nn(d.pointCost), sendCost: nn(d.sendCost),  // 타사 = 포인트+발송 둘 다
      send: nn(d.send), appOpen: nn(d.appOpen),  // 타사 시트 지표 (발송/오픈)
    }));
    const label = r.group + (r.status === '진행중' ? ' · 상시' : '');
    const end = r.end || (rows.length ? rows[rows.length - 1].date : r.start);
    return { label, start: r.start, end, granularity: 'daily', daily };
  });
}

// 8월 (augevt) — data/_augevt_daily.json 에서 읽음 (자동갱신 로봇이 이 파일만 갱신).
//   한도조회(inquiry)=가승인+올거절(Mixpanel 퍼널 기준, 날짜별 unique) / 약정=시트
//   ⚠ 2026-08-14 전환2: 인사이트 unique(promo_name=augevt 태그 전부)는 프로모션 미경유 트래픽까지 긁어 과집계(누적 17,922).
//     → 5월과 동일하게 퍼널(PM_augevt_intro_view→intro_clickCTA→LA_loanlist_view/LD_intro_view, conv 1d, unique)로 변경 → 누적 11,306(≈지급 10,741).
//     approve=가승인 퍼널 step3, reject=올거절 퍼널 step3. paymentCount 는 지급건수(1인1회) 세부로만 보존.
function augustRun() {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(path.join(REPO, 'data', '_augevt_daily.json'), 'utf8')); } catch (e) { rows = []; }
  const daily = rows.map(d => ({
    date: d.date,
    introView: nn(d.introView),
    inquiry: (d.approve || 0) + (d.reject || 0),
    paymentCount: nn(d.paymentCount),   // 실제 포인트 지급 수(시트 지급건수, 1인1회) — 한도조회(Mixpanel)와의 차이 ≈ 재한도조회
    approve: nn(d.approve), reject: nn(d.reject),
    apply: (d.creditLoan != null || d.otherLoan != null) ? (d.creditLoan || 0) + (d.otherLoan || 0) : null,
    creditLoan: nn(d.creditLoan), otherLoan: nn(d.otherLoan),
    contract: nn(d.contract), amount: null, revenue: null,
    pointCost: nn(d.cost), sendCost: null,  // 8월 = 포인트 비용
  }));
  // 포인트탭 진입점(슬롯+그리드) 퍼널 한도조회 — 전체 한도조회에서 빼면 '포인트탭 외 유입'. 8월 누적 값(자동갱신이 재계산).
  let pointTab = null;
  try { pointTab = JSON.parse(fs.readFileSync(path.join(REPO, 'data', '_augevt_meta.json'), 'utf8')); } catch (e) {}
  return { label: '8월', start: '2026-08-03', end: '2026-08-14', granularity: 'daily', daily,
    pointTab: pointTab ? {
      introView: nn(pointTab.pointTabIntroView),
      inquiry: nn(pointTab.pointTabInquiry), approve: nn(pointTab.pointTabApprove), reject: nn(pointTab.pointTabReject),
      apply: nn(pointTab.pointTabApply), creditLoan: nn(pointTab.pointTabCreditLoan), otherLoan: nn(pointTab.pointTabOtherLoan),
      asOf: pointTab.asOf || null,
    } : null };
}

// 9월 (sepevt) — data/_sepevt_daily.json (자동갱신 로봇이 이 파일만 갱신). 9/14~9/30.
//   한도조회(inquiry)=PM_sepevt_reward_success unique(직접) / 가승인=LA_loanlist_view / 올거절=LD_intro_view
//   신용대출신청=LA_loandetail_clickCTA / 우수대부신청=LD_loandetail_clickCTA (전부 promo_name=sepevt, 날짜별 unique)
//   시트는 비용(총 지급포인트·레퍼럴 지급포인트)과 약정 수 용도. 시트 '한도조회 수'는 비용 대사용(ownReward, 미노출).
function sepRun() {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(path.join(REPO, 'data', '_sepevt_daily.json'), 'utf8')); } catch (e) { rows = []; }
  const daily = rows.map(d => ({
    date: d.date, introView: nn(d.introView), introClick: nn(d.introClick),
    // 한도조회 = Mixpanel 가승인(LA_loanlist_view) + 올거절(LD_intro_view), promo_name=sepevt.
    // ⚠ 2026-09-23 변경: 이전엔 시트 '한도조회 수'를 썼는데, 그 값은 사실상 리워드 지급 건수(PM_sepevt_reward_success 와 일치)라
    //   실제 한도조회와 갈수록 벌어졌다(9/14 1.12배 → 9/22 0.36배). 퍼널 전 구간을 Mixpanel 소스로 통일한다.
    //   시트의 한도조회 수(ownReward)는 비용 대사용으로만 남긴다 — 지표/컬럼에는 쓰지 않는다.
    inquiry: (d.approve != null || d.reject != null) ? ((d.approve || 0) + (d.reject || 0)) : null,
    approve: nn(d.approve), reject: nn(d.reject),
    apply: (d.creditLoan != null || d.otherLoan != null) ? (d.creditLoan || 0) + (d.otherLoan || 0) : null,
    creditLoan: nn(d.creditLoan), otherLoan: nn(d.otherLoan),
    ownReward: nn(d.ownReward), friendReward: nn(d.friendReward),
    rfrView: nn(d.rfrView), rfrShare: nn(d.rfrShare),  // 레퍼럴(별도 토글): 바텀시트 조회 / 공유(clickCTA)
    // 시트 포인트 금액 — 9월 회차 전용 컬럼용 키. 다른 회차/프로모션엔 이 키를 넣지 않아 '—' 로 표시된다.
    rfrPoint: nn(d.rfrPoint),        // 레퍼럴로 나간 지급 포인트 금액(시트)
    sepPointTotal: nn(d.payTotal),   // 총 지급 포인트(시트 '지급 총액'). pointCost 와 같은 값이지만 컬럼은 9월만 노출.
    // 포인트탭 진입점(홈슬롯+퀵그리드) 퍼널 일자별 — 날짜 범위 반영용. 전체 퍼널에서 빼면 '포인트탭 외 유입'.
    ptIntroView: nn(d.ptIntroView), ptApprove: nn(d.ptApprove), ptReject: nn(d.ptReject),
    ptCreditLoan: nn(d.ptCreditLoan), ptOtherLoan: nn(d.ptOtherLoan),
    contract: nn(d.contract), amount: null, revenue: null,
    pointCost: nn(d.payTotal), sendCost: null,  // 지급 총액 = 포인트 비용
  }));
  const dates = rows.map(r => r.date);
  return { label: '9월', start: dates[0] || '2026-09-14', end: dates[dates.length - 1] || '2026-09-14', granularity: 'daily', daily, referral: true,
    pointTabDaily: rows.some(r => r.ptIntroView != null || r.ptApprove != null) };
}

// 쿠폰함 프로모션 (민주) — data/_coupon_daily.json. 지표: 한도조회(가승인 세부)·신청·약정·매출 (인트로조회·올거절·신용대출/우수대부 미집계).
function couponRun() {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(path.join(REPO, 'data', '_coupon_daily.json'), 'utf8')); } catch (e) { rows = []; }
  const daily = rows.map(d => ({
    date: d.date,
    inquiry: nn(d.inquiry),
    approve: nn(d.approve),   // 가승인 (한도조회 세부)
    apply: nn(d.apply),
    contract: nn(d.contract),
    revenue: nn(d.revenue),
    amount: null,
  }));
  const dates = rows.map(r => r.date);
  return { label: '7월', start: dates[0] || '2026-07-14', end: dates[dates.length - 1] || '2026-07-27', granularity: 'daily', daily };
}

// 타사 4차 A/B 테스트 (9/7~) — data/_tasa4_daily.json (자동갱신이 이 파일만 갱신).
//   A=프로모션(포인트 지급) / B=비프로모션(대조군). group='4차-A'/'4차-B'.
//   ⚠ 단일 run '4차 A/B' 로 병합(대시보드 탭 하나). daily=A+B 날짜별 합산(표준 뷰·라인 집계용),
//   A/B 상세는 run.abA/abB 에 각각 담아 A/B 비교 블록·토글이 사용. 데이터 없으면 run 생략.
function tasa4Runs() {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(path.join(REPO, 'data', '_tasa4_daily.json'), 'utf8')); } catch (e) { rows = []; }
  const mk = g => rows.filter(d => d.group === g).sort((a, b) => (a.date < b.date ? -1 : 1)).map(d => ({
    date: d.date, introView: null,
    inquiry: nn(d.limitCheck), apply: nn(d.applyCount),
    contract: nn(d.contract), amount: nn(d.contractAmount), revenue: nn(d.revenue),
    pointCost: nn(d.pointCost), sendCost: nn(d.sendCost), send: nn(d.send), appOpen: nn(d.appOpen),
  }));
  const abA = mk('4차-A'), abB = mk('4차-B');
  if (!abA.length && !abB.length) return [];
  // 날짜별 A+B 합산 → combined daily (모달 일별표·라인 집계용)
  const keys = ['introView', 'inquiry', 'apply', 'contract', 'amount', 'revenue', 'pointCost', 'sendCost', 'send', 'appOpen'];
  const byDate = {};
  [...abA, ...abB].forEach(d => {
    const t = byDate[d.date] || (byDate[d.date] = { date: d.date });
    keys.forEach(k => { if (d[k] != null) t[k] = (t[k] || 0) + d[k]; });
  });
  const daily = Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
  const dates = daily.map(d => d.date);
  return [{ label: '4차 A/B', start: dates[0], end: dates[dates.length - 1], granularity: 'daily', daily, ab: true, abA, abB }];
}

// ---- v2 프로젝트 구성 (사용자 정의 그룹핑) ----
const projects = [
  { id: 'daegaek', line: 'loan', emoji: '🎯', name: '대고객 한도조회 유도', owner: '지윤', status: 'live',
    runs: [ totalRun(byId.P1, '1월 · 신년 행운카드'), dailyRunP5P7(byId.P5, '5월 · 가정의달'), dailyRunP5P7(byId.P7, '7월'), augustRun(), sepRun() ] },
  { id: 'sebet', line: 'loan', emoji: '🧧', name: '세뱃돈 프로모션', owner: '지윤', status: 'done',
    runs: [ totalRun(byId.P2, '2월') ] },
  { id: 'tasa', line: 'loan', emoji: '🔥', name: '타사한도조회자 약정', owner: '지윤', status: 'live',
    runs: [ ...p6Runs(byId.P6), ...tasa4Runs() ] },
  { id: 'sangsi', line: 'loan', emoji: '💳', name: '대출신청 상시', owner: '지윤', status: 'done',
    runs: [ totalRun(byId.P3, '4월 · 신규유저'), totalRun(byId.P4, '4월 · 타사한도조회') ] },
  // ⚠️ coupon 은 민주님이 data/coupon.json 을 직접 관리한다. external:true → 파일 덮어쓰기 제외.
  // (detail.html 기준으로 재생성하면 수기 추가한 회차·status 가 날아감. list.json 등록용으로만 남겨둠.)
  { id: 'coupon', line: 'loan', emoji: '🎟️', name: '쿠폰함 프로모션', owner: '민주', status: 'done',
    external: true, runs: [ couponRun() ] },
];

// ---- 프로젝트별 실제 추적 지표(metricKeys) 자동 도출 ----
// (해당 프로젝트가 값을 하나라도 가진 지표만 → 프로젝트마다 지표 세트가 다름)
// sepPointTotal·rfrPoint 는 9월(sepevt) 회차에서만 채워지는 키 → 다른 회차·프로모션 컬럼은 그대로 유지된다.
// ownReward·friendReward 는 컬럼에서 뺐다(2026-09-23) — inquiry 계산에는 계속 쓰이므로 daily 필드로는 남는다.
const ALL_KEYS = ['introView', 'introClick', 'inquiry', 'paymentCount', 'apply', 'contract', 'sepPointTotal', 'rfrPoint', 'amount', 'revenue'];
projects.forEach(p => {
  const rows = p.runs.flatMap(r => r.daily);
  p.metricKeys = ALL_KEYS.filter(k => rows.some(d => d[k] != null));
});

// ---- 파일 쓰기 ----
const dataDir = path.join(REPO, 'data');
fs.mkdirSync(dataDir, { recursive: true });
// build_data 가 생성하는 프로젝트(지윤)만 파일 덮어씀. 팀원(외부) JSON 은 건드리지 않음.
const skipped = [];
projects.forEach(p => {
  if (p.external) { skipped.push(p.id); return; }   // 팀원이 직접 관리 → 덮어쓰기 금지
  const { external, ...out } = p;
  fs.writeFileSync(path.join(dataDir, p.id + '.json'), JSON.stringify(out, null, 2));
});

// list.json: 생성 프로젝트 + 기존 list 의 팀원(외부) id 보존 병합
const ownIds = new Set(projects.map(p => p.id));
let existing = { loan: [], asset: [], app: [] };
try { existing = JSON.parse(fs.readFileSync(path.join(dataDir, 'list.json'), 'utf8')); } catch (e) {}
const list = { loan: [], asset: [], app: [] };
['loan', 'asset', 'app'].forEach(line => {
  const own = projects.filter(p => p.line === line).map(p => p.id);
  const ext = (existing[line] || []).filter(id => !ownIds.has(id));  // 팀원이 등록한 외부 프로젝트
  list[line] = [...own, ...ext];
});
fs.writeFileSync(path.join(dataDir, 'list.json'), JSON.stringify(list, null, 2));

// ---- 요약 출력 ----
console.log('생성 완료 → data/');
projects.forEach(p => {
  const days = p.runs.reduce((s, r) => s + r.daily.length, 0);
  const tot = p.runs.flatMap(r => r.daily).reduce((a, d) => {
    a.inquiry += d.inquiry || 0; a.contract += d.contract || 0; return a;
  }, { inquiry: 0, contract: 0 });
  console.log(`  ${p.id.padEnd(8)} runs=${p.runs.length} rows=${days}  한도조회합=${tot.inquiry}  약정합=${tot.contract}  지표=[${p.metricKeys.join(',')}]`);
});
console.log('list.json:', JSON.stringify(list));
if (skipped.length) console.log(`⏭  덮어쓰기 제외(팀원 직접 관리): ${skipped.join(', ')}`);
