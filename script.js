'use strict';
/* =====================================================================
   쑥쑥이 복약 도우미 - 어르신 복약·건강관리 모바일 웹앱 (서버 없이 동작)
   ===================================================================== */

/* ===== 시연용 설정: 아래 상수만 고치면 실제 시간(30분)으로 바뀝니다 ===== */
const SIDE_MS = 10 * 1000;    // 약 복용 기록 후 "불편하신 점" 알림까지 (시연 10초 → 실제 30분: 30 * 60 * 1000)
const REMIND_MS = 10 * 1000;  // "식사 후 30분 뒤에 다시 알려주기" 대기시간 (시연 10초)

/* ===== 대상자 정보 (1번·6번의 ○○님, 보호자·의료진 화면에서 같은 값 사용) ===== */
const PATIENT = { name: '김순자', age: 72 };

/* ===== 고정값 ===== */
const SLOT_MIN = { '아침': 8 * 60, '점심': 12 * 60, '저녁': 18 * 60, '잠자기 전': 22 * 60 };
const PERIOD_DAYS = 35;                 // 복약등록 당일부터 7일 주기 5개(약 한 달)
const STAGES = ['seed', 'sprout', 'bud', 'flower'];
const STAGE_NAME = { seed: '씨앗', sprout: '새싹', bud: '꽃봉오리', flower: '꽃' };
const STAGE_EMOJI = { seed: '🌰', sprout: '🌱', bud: '🌷', flower: '🌸' };
const GROW_AT = [7, 14, 21];            // 복약 O인 날 누적 일수 기준
const KEY = 'ssuk_app_v1';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/* ===== 작은 도구 ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ds(new Date());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ds(d); };
const diffDays = (a, b) => Math.round((parseD(a) - parseD(b)) / 86400000);
const mdw = s => { const d = parseD(s); return `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`; };
const md = s => { const d = parseD(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const ymdK = s => { const d = parseD(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const timeLabel = hhmm => { const [h, m] = hhmm.split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${pad(m)}`; };
const isCustom = s => /^\d{1,2}:\d{2}$/.test(s);
const slotMin = s => (isCustom(s) ? Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]) : (SLOT_MIN[s] != null ? SLOT_MIN[s] : 720));
const slotLabel = s => (isCustom(s) ? timeLabel(s) : s);
const slotMedName = s => (isCustom(s) ? `${timeLabel(s)} 약` : `${s}약`);
const atMin = (dateStr, min) => { const d = parseD(dateStr); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d.getTime(); };

/* ===== 저장 (localStorage는 막혀 있어도 앱은 정상 동작) ===== */
function defaults() {
  return {
    startDate: todayStr(), records: {}, meds: [], hospitals: [], guardians: [], appts: [],
    chat: [], chatGreeted: false, maxStage: 0, sideAlerts: [], medAlerted: {}, reminders: [],
    scores: [], guardianInbox: [], staffInbox: [], apptAlerted: {}, seq: 1
  };
}
function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(d, JSON.parse(raw));
  } catch (e) { /* 저장소 접근 불가: 메모리로만 동작 */ }
  return d;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ } }
let state = load();

/* ===== 화면 상태 ===== */
let screen = 'home';
let banner = null;        // 맨 위 알림 {kind:'side'|'med'|'appt', ...}
let forcedMed = null;     // 관리자 버튼으로 띄울 약 알림 시간대
let pendingGrowth = null;
let hospSel = null, apM = null, rcM = null, recView = null, plView = null;
let sideSel = null, sideDone = false, detailId = null, popDate = null, apEditId = null;
let rxItems = [], rxRound = 0;
let checkTimer = null, toastTimer = null, admTimer = null, doneTimer = null;
const TABS = ['record', 'plant', 'side'];
const NAMES = ['home', 'medreg', 'hosp', 'appt', 'care', 'chat', 'record', 'plant', 'side', 'meds', 'meddetail'];

/* =====================================================================
   화분 캐릭터 (모든 화면이 이 함수 하나로 그림)
   ===================================================================== */
function plantSVG(stage) {
  const st = typeof stage === 'number' ? STAGES[stage] : stage;
  const stem = y2 => `<path d="M100 78V${y2}" stroke="#4f9a2a" stroke-width="5" stroke-linecap="round" fill="none"/>`;
  const leaves = y => `<path d="M100 ${y}C90 ${y - 14} 74 ${y - 14} 70 ${y - 6}C80 ${y + 4} 94 ${y + 6} 100 ${y}Z" fill="#7cc242"/><path d="M100 ${y}C110 ${y - 14} 126 ${y - 14} 130 ${y - 6}C120 ${y + 4} 106 ${y + 6} 100 ${y}Z" fill="#62ad34"/>`;
  let top = '', seed = '';
  if (st === 'sprout') {
    top = stem(46) + '<path d="M100 48C88 30 68 32 64 42C76 52 92 54 100 48Z" fill="#7cc242"/><path d="M100 48C112 30 132 32 136 42C124 52 108 54 100 48Z" fill="#62ad34"/>';
  } else if (st === 'bud') {
    top = stem(40) + leaves(66) +
      '<ellipse cx="100" cy="28" rx="11" ry="15" fill="#f48fb1"/><path d="M100 14C95 22 94 32 100 42C106 32 105 22 100 14Z" fill="#f8bbd0" opacity=".7"/><path d="M89 36C92 46 108 46 111 36C106 41 94 41 89 36Z" fill="#62ad34"/>';
  } else if (st === 'flower') {
    let petals = '';
    for (let i = 0; i < 8; i++) petals += `<ellipse cx="100" cy="10" rx="8.5" ry="13" transform="rotate(${i * 45} 100 28)" fill="${i % 2 ? '#f8a5c2' : '#f48fb1'}"/>`;
    top = stem(48) + leaves(68) + petals + '<circle cx="100" cy="28" r="10" fill="#fdd835" stroke="#f9a825" stroke-width="2"/>';
  } else {
    seed = '<ellipse cx="100" cy="93" rx="17" ry="10" fill="#4a3226"/>' +
      '<line x1="100" y1="73" x2="100" y2="86" stroke="#f5c518" stroke-width="2.6" stroke-dasharray="3 4" stroke-linecap="round"/>' +
      '<ellipse cx="100" cy="93" rx="8" ry="5" transform="rotate(-35 100 93)" fill="#c99a5b"/>' +
      '<ellipse cx="97" cy="91.5" rx="3" ry="1.6" transform="rotate(-35 97 91.5)" fill="#f5deb0"/>';
  }
  const face =
    '<ellipse cx="82" cy="146" rx="7" ry="8.5" fill="#3b2a22"/><circle cx="84.5" cy="143" r="2.6" fill="#fff"/>' +
    '<ellipse cx="118" cy="146" rx="7" ry="8.5" fill="#3b2a22"/><circle cx="120.5" cy="143" r="2.6" fill="#fff"/>' +
    '<ellipse cx="68" cy="160" rx="9" ry="5.5" fill="#f58f8f" opacity=".75"/><ellipse cx="132" cy="160" rx="9" ry="5.5" fill="#f58f8f" opacity=".75"/>' +
    '<path d="M89 156Q100 174 111 156Z" fill="#a8372f"/><ellipse cx="100" cy="164" rx="5.5" ry="3.4" fill="#f28b8b"/>';
  return `<svg class="plant" viewBox="0 -8 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${STAGE_NAME[st]} 단계 화분 캐릭터 쑥쑥이">` +
    top +
    '<path d="M52 102C72 62 128 62 148 102Z" fill="#7b5a45"/><path d="M70 92C80 80 96 76 106 77" stroke="#9a7459" stroke-width="4" stroke-linecap="round" fill="none"/>' +
    seed +
    '<path d="M50 118H150C152 150 148 168 140 178Q134 188 118 188H82Q66 188 60 178C52 168 48 150 50 118Z" fill="#e9a98b"/>' +
    '<path d="M62 130C60 146 62 160 67 172" stroke="#fff" stroke-opacity=".5" stroke-width="7" stroke-linecap="round" fill="none"/>' +
    '<rect x="38" y="98" width="124" height="24" rx="12" fill="#f6cdb3"/><rect x="44" y="101" width="112" height="5" rx="2.5" fill="#fff" opacity=".45"/>' +
    face + '</svg>';
}

/* 약 사진이 없을 때 보여 주는 알약 그림 */
function medArt(m) {
  if (m.photo) return `<img class="med-img" src="${esc(m.photo)}" alt="${esc(m.name)}">`;
  const h = [...m.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  const col = ['#f28c28', '#5a9a21', '#e57399', '#4a90c2'][h];
  return `<svg class="med-img" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(m.name)}">` +
    '<rect width="64" height="64" fill="#eaf5d6"/>' +
    '<g transform="rotate(-35 32 32)"><rect x="9" y="21" width="46" height="22" rx="11" fill="#fff" stroke="#8a8a7a" stroke-width="2"/>' +
    `<path d="M32 21H44A11 11 0 0 1 44 43H32Z" fill="${col}"/><rect x="14" y="25" width="14" height="4" rx="2" fill="#fff" opacity=".7"/></g></svg>`;
}

/* =====================================================================
   약 정보 / 병원 / 처방전 데모 데이터
   (실제 서비스에서는 식약처 의약품 API·약학정보원 API와 병원 검색 API로 교체)
   ===================================================================== */
const DRUGS = [
  { name: '타이레놀정', strength: '500mg', ingredient: '아세트아미노펜', form: '정제',
    effect: '열을 내리고 두통, 치통, 근육통, 관절통 같은 통증을 가라앉혀 줘요.',
    how: '필요할 때 4~6시간 간격으로 물과 함께 드세요. 하루 최대 8정을 넘기지 마세요.',
    caution: '다른 감기약에도 같은 성분이 들어 있을 수 있어요. 간이 안 좋거나 술을 자주 드시면 먼저 약사·의사와 상의하세요.',
    side: '드물게 발진, 메스꺼움이 생길 수 있어요. 피부 발진이나 숨쉬기 불편함이 있으면 바로 병원에 가세요.' },
  { name: '아모디핀정', strength: '5mg', ingredient: '암로디핀베실산염', form: '정제',
    effect: '혈압을 낮춰 주고 가슴 통증(협심증)을 줄여 줘요.',
    how: '하루 한 번, 매일 같은 시간에 드세요. 식사와 상관없이 드실 수 있어요.',
    caution: '혈압이 좋아져도 마음대로 끊지 마세요. 앉았다 일어날 때 천천히 일어나세요.',
    side: '발목이 붓거나 얼굴이 화끈거리고 어지러울 수 있어요. 두통, 피곤함이 있을 수 있어요.' },
  { name: '무코스타정', strength: '100mg', ingredient: '레바미피드', form: '정제',
    effect: '위 점막을 보호해서 위염과 위궤양을 낫게 도와줘요.',
    how: '정해진 시간에 물과 함께 드세요. 보통 하루 3번(아침·저녁·자기 전) 드세요.',
    caution: '약을 먹고 가려움이나 발진이 생기면 먹기를 멈추고 병원에 문의하세요.',
    side: '변비, 배가 더부룩함, 가려움이 생길 수 있어요.' },
  { name: '글루코파지정', strength: '500mg', ingredient: '메트포르민염산염', form: '정제',
    effect: '혈당을 조절해 주는 당뇨병 약이에요.',
    how: '식사와 함께 또는 식사 직후에 드세요. 속 불편함이 줄어들어요.',
    caution: '조영제 검사나 수술 전에는 꼭 의료진에게 알리세요. 술을 많이 드시면 안 돼요.',
    side: '메스꺼움, 설사, 배 아픔, 입맛 변화가 있을 수 있어요. 심한 근육통이나 숨쉬기 힘들면 바로 병원에 가세요.' },
  { name: '리피토정', strength: '10mg', ingredient: '아토르바스타틴칼슘', form: '정제',
    effect: '혈액 속 나쁜 콜레스테롤을 낮춰 줘요.',
    how: '하루 한 번, 매일 같은 시간에 드세요.',
    caution: '이유 없는 근육통이 계속되면 의사와 상의하세요. 자몽주스를 많이 드시지 마세요.',
    side: '근육통, 소화가 안 됨, 두통이 있을 수 있어요.' },
  { name: '아스피린프로텍트정', strength: '100mg', ingredient: '아스피린', form: '장용정',
    effect: '피가 굳는 것을 막아 심장병·뇌졸중을 예방해 줘요.',
    how: '하루 한 번 식사 후 물과 함께 삼키세요. 씹거나 부수지 마세요.',
    caution: '멍이 잘 들거나 피가 나면 알려 주세요. 수술이나 치과 치료 전에는 꼭 말씀하세요.',
    side: '속쓰림, 멍, 잇몸 출혈이 생길 수 있어요.' }
];
const GENERIC_INFO = '자세한 내용은 의사나 약사에게 문의해 주세요.';
const STR_RE = /\d+(?:\.\d+)?\s*(?:mg|g|mcg|㎎)/i;
const parseStrength = t => { const m = String(t).match(STR_RE); return m ? m[0].replace(/\s+/g, '') : ''; };
const normName = s => String(s).replace(/\s+/g, '').replace(/[0-9.]+(mg|g|mcg|㎎)?/gi, '').replace(/(서방정|장용정|캡슐|정)$/, '');
function findDrug(name) {
  const n = normName(name);
  if (!n) return null;
  return DRUGS.find(d => { const dn = normName(d.name); return dn === n || dn.includes(n) || n.includes(dn); }) || null;
}
function candidates(name) {
  const n = normName(name);
  return DRUGS.map(d => ({ d, sc: [...n].filter(c => normName(d.name).includes(c)).length }))
    .filter(x => x.sc >= 2).sort((a, b) => b.sc - a.sc).slice(0, 3).map(x => x.d);
}

const HOSPITALS = [
  { name: '행복내과의원', dept: '내과', addr: '전북 전주시 완산구 푸른길 12', phone: '063-123-4501' },
  { name: '튼튼정형외과의원', dept: '정형외과', addr: '전북 전주시 덕진구 한빛로 45', phone: '063-123-4502' },
  { name: '맑은눈안과의원', dept: '안과', addr: '전북 전주시 완산구 새봄로 8', phone: '063-123-4503' },
  { name: '온누리가정의학과의원', dept: '가정의학과', addr: '전북 전주시 덕진구 햇살로 77', phone: '063-123-4504' },
  { name: '사랑신경과의원', dept: '신경과', addr: '전북 전주시 완산구 달빛로 31', phone: '063-123-4505' },
  { name: '건강드림병원', dept: '내과·순환기내과', addr: '전북 전주시 덕진구 오월로 102', phone: '063-123-4506' },
  { name: '미소치과병원', dept: '치과', addr: '전북 전주시 완산구 소나무길 5', phone: '063-123-4507' },
  { name: '푸른하늘이비인후과의원', dept: '이비인후과', addr: '전북 전주시 덕진구 은행로 19', phone: '063-123-4508' }
];

const RX_SAMPLE_A = [
  { raw: '타이레놀정 500mg', perDose: 1, perDay: 3, days: 5, how: '식후 30분' },
  { raw: '아모디핀정 5mg', perDose: 1, perDay: 1, days: 30, how: '아침 식후' },
  { raw: '무코스타정 100mg', perDose: 1, perDay: 3, days: 14, how: '식후 30분' }
];
const RX_SAMPLE_B = [
  { raw: '타이레놀정 500mg', perDose: 1, perDay: 3, days: 5, how: '식후 30분' },
  { raw: '아모디판정 5mg', perDose: 1, perDay: 1, days: 30, how: '아침 식후' },
  { raw: '무코스타정 100mg', perDose: 1, perDay: 3, days: 14, how: '식후 30분' }
];
/* 데모용 인식 함수: 실제로는 여기서 OCR → 식약처 의약품 API 조회를 수행하도록 바꿉니다. */
function recognizePrescription(/* file */) {
  return new Promise(res => setTimeout(() => { rxRound++; res(rxRound % 2 === 1 ? RX_SAMPLE_A : RX_SAMPLE_B); }, 1800));
}

/* =====================================================================
   복약 기록 계산 (기록은 state.records 한 곳에서만 관리)
   ===================================================================== */
function getSlots() {
  const set = new Set();
  state.meds.forEach(m => m.times.forEach(t => set.add(t)));
  const arr = [...set].sort((a, b) => slotMin(a) - slotMin(b));
  return arr.length ? arr : ['하루'];
}
const inRange = d => { const n = diffDays(d, state.startDate); return n >= 0 && n < PERIOD_DAYS; };
const recOf = (d, s) => { const r = state.records[d]; return r ? r[s] : undefined; };
const isRec = (d, s) => recOf(d, s) !== undefined;
function dayStatus(d) {
  if (!inRange(d)) return null;
  const slots = getSlots(), r = state.records[d] || {};
  if (slots.every(s => r[s] === true)) return 'O';
  if (slots.some(s => r[s] === false)) return 'X';
  if (d < todayStr()) return 'X';
  return null;
}
const cycleOf = d => Math.floor(diffDays(d, state.startDate) / 7);
const cycleDays = c => Array.from({ length: 7 }, (_, i) => addDays(state.startDate, c * 7 + i));
const cycleO = c => cycleDays(c).filter(d => dayStatus(d) === 'O').length;
const cycleX = c => cycleDays(c).filter(d => dayStatus(d) === 'X').length;
const cycleHasRec = c => cycleDays(c).some(d => { const r = state.records[d]; return r && Object.keys(r).length > 0; });
function currentCycle() {
  let c = Math.min(4, Math.max(0, cycleOf(todayStr())));
  while (c < 4 && cycleO(c) === 7 && cycleHasRec(c + 1)) c++;
  return c;
}
const totalO = () => Array.from({ length: PERIOD_DAYS }, (_, i) => addDays(state.startDate, i)).filter(d => dayStatus(d) === 'O').length;
function stageIdx() {
  const n = totalO();
  return Math.max(n >= 21 ? 3 : n >= 14 ? 2 : n >= 7 ? 1 : 0, state.maxStage);
}
function commitStage() { const i = stageIdx(); if (i > state.maxStage) state.maxStage = i; return i; }
const remainToGrow = () => { const i = stageIdx(); return i >= 3 ? 0 : Math.max(0, GROW_AT[i] - totalO()); };

/* 복약 기록 저장: 11번 달력과 7번 챗봇이 모두 이 함수를 사용 */
function recordSlot(date, slot, val) {
  if (isRec(date, slot)) return false;           // 한 번 기록한 시간대는 다시 바꿀 수 없음
  const before = stageIdx();
  (state.records[date] = state.records[date] || {})[slot] = val;
  if (val === true && date === todayStr()) {      // 오늘 먹었어요 → 30분 뒤(시연 10초) 불편한 점 알림 예약
    state.sideAlerts.push({ id: state.seq++, date, slot, dueAt: Date.now() + SIDE_MS, status: 'scheduled' });
  }
  const after = commitStage();
  if (after > before) pendingGrowth = { from: before, to: after };
  save();
  return true;
}

/* 약별 복용량 */
const medTotal = m => m.perDose * m.perDay * m.days;
const inMedRange = (m, d) => { const n = diffDays(d, m.startDate); return n >= 0 && n < m.days; };
function medTaken(m) {
  let n = 0;
  for (let i = 0; i < m.days; i++) {
    const r = state.records[addDays(m.startDate, i)];
    if (!r) continue;
    m.times.forEach(t => { if (r[t] === true) n += m.perDose; });
  }
  return Math.min(n, medTotal(m));
}

/* 알림 시간 계산 */
function dueMedSlot() {
  if (!state.meds.length) return null;
  const t = todayStr(), now = Date.now();
  const slots = [...new Set(state.meds.flatMap(m => m.times))].sort((a, b) => slotMin(a) - slotMin(b));
  for (const s of slots) {
    if (isRec(t, s)) continue;
    if ((state.medAlerted[t] || []).includes(s)) continue;
    const due = atMin(t, slotMin(s));
    if (due > now) continue;
    if (!state.meds.some(m => m.times.includes(s) && inMedRange(m, t) && m.regAt < due)) continue; // 등록 후에 지난 시각만
    return s;
  }
  return null;
}
const markAlerted = s => { const t = todayStr(); (state.medAlerted[t] = state.medAlerted[t] || []); if (!state.medAlerted[t].includes(s)) state.medAlerted[t].push(s); save(); };
const unmarkAlerted = s => { const t = todayStr(); if (state.medAlerted[t]) { state.medAlerted[t] = state.medAlerted[t].filter(x => x !== s); save(); } };
function nextUnrecSlot() {
  if (!state.meds.length) return null;
  const t = todayStr();
  return getSlots().find(s => !isRec(t, s)) || null;
}
const dueSideAlerts = () => { const n = Date.now(); return state.sideAlerts.filter(a => a.status === 'scheduled' && a.dueAt <= n); };

/* =====================================================================
   화면 이동
   ===================================================================== */
const onEnter = {
  home: () => renderHome(),
  medreg: () => resetReg(),
  hosp: () => { hospSel = null; $('#hospQ').value = ''; renderHosp(); },
  appt: () => { const n = new Date(); apM = { y: n.getFullYear(), m: n.getMonth() }; renderAppt(); },
  care: () => { $('#gForm').hidden = true; renderCare(); },
  chat: () => renderChat(),
  record: () => { recView = null; const n = new Date(); rcM = { y: n.getFullYear(), m: n.getMonth() }; renderRecord(); },
  plant: () => { plView = null; renderPlant(); },
  side: () => { sideSel = null; sideDone = false; clearTimeout(doneTimer); renderSide(); },
  meds: () => renderMeds(),
  meddetail: () => renderDetail()
};
function go(name) {
  screen = name;
  NAMES.forEach(n => $('#s-' + n).classList.toggle('active', n === name));
  const phone = $('#phone');
  phone.dataset.screen = name;
  const tabs = TABS.includes(name);
  $('#tabbar').hidden = !tabs;
  phone.classList.toggle('has-tabs', tabs);
  $('#chatFab').hidden = name !== 'home';
  $('#s-' + name).scrollTop = 0;
  if (onEnter[name]) onEnter[name]();
  renderTabs();
  refreshBanner();
}
function renderTabs() {
  const i = stageIdx();
  $('#tabPlantIc').innerHTML = plantSVG(i);
  $('#fabIc').innerHTML = plantSVG(i);
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === screen));
}
function renderAll() {
  const r = { home: renderHome, hosp: renderHosp, appt: renderAppt, care: renderCare, chat: renderChat, record: renderRecord, plant: renderPlant, side: renderSide, meds: renderMeds, meddetail: renderDetail }[screen];
  if (r) r();
  renderTabs(); renderInboxes(); refreshBanner();
}

/* 공통 창 */
function showCheck(msg, ms, cb) {
  $('#checkMsg').textContent = msg;
  $('#checkOv').hidden = false;
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => { $('#checkOv').hidden = true; if (cb) cb(); }, ms);
}
function showToast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function showGrowth() {
  if (!pendingGrowth) return;
  const g = pendingGrowth; pendingGrowth = null;
  $('#growTx').textContent = `🎉 7일 복약 달성! 식물이 ${STAGE_NAME[STAGES[g.from]]}에서 ${STAGE_NAME[STAGES[g.to]]} 단계로 자랐어요!`;
  $('#growPlant').innerHTML = plantSVG(g.to);
  $('#growOv').hidden = false;
}

/* =====================================================================
   맨 위 알림 (부작용 확인 > 약 먹을 시간 > 진료 하루 전)
   ===================================================================== */
function refreshBanner() {
  if (screen === 'chat') { banner = null; return renderBanner(); }   // 챗봇 화면에서는 채팅창에서 바로 묻는다
  const side = dueSideAlerts();
  if (banner) {
    if (banner.kind === 'side') {
      const a = state.sideAlerts.find(x => x.id === banner.id);
      if (!a || a.status !== 'scheduled' || screen === 'side') banner = null;
    } else if (banner.kind === 'med') {
      if (isRec(todayStr(), banner.slot)) banner = null;
      else if (side.length && screen !== 'side') {          // 부작용 알림이 먼저
        if (banner.natural) unmarkAlerted(banner.slot);
        if (banner.forced) forcedMed = banner.slot;
        banner = null;
      }
    } else if (banner.kind === 'appt' && side.length && screen !== 'side') banner = null;
  }
  if (!banner) {
    if (side.length) {
      if (screen !== 'side') banner = { kind: 'side', id: side[0].id };   // 9번 화면에서는 띄우지 않음
    } else {
      const t = todayStr(), now = Date.now();
      const rem = state.reminders.find(r => !r.done && r.date === t && r.dueAt <= now);
      if (rem) {
        rem.done = true; save();
        if (!isRec(t, rem.slot)) banner = { kind: 'med', slot: rem.slot };
      }
      if (!banner && forcedMed && !isRec(t, forcedMed)) { banner = { kind: 'med', slot: forcedMed, forced: true }; forcedMed = null; }
      if (!banner) { const s = dueMedSlot(); if (s) { markAlerted(s); banner = { kind: 'med', slot: s, natural: true }; } }
      if (!banner) {
        const tm = addDays(t, 1);
        const a = state.appts.find(x => x.date === tm && !state.apptAlerted[x.id + '_' + x.date]);
        if (a) { state.apptAlerted[a.id + '_' + a.date] = true; save(); banner = { kind: 'appt', text: `내일 ${a.hospital} 진료가 있어요` }; }
      }
    }
  }
  renderBanner();
}
function renderBanner() {
  const el = $('#banner');
  if (!banner) { el.hidden = true; el.dataset.key = ''; return; }
  const text = banner.kind === 'side' ? '약을 복용하신지 30분이 지났습니다. 불편하신 점이 있으신가요?'
    : banner.kind === 'med' ? `${slotMedName(banner.slot)} 드실 시간이에요. 약 드셨나요?` : banner.text;
  const key = banner.kind + (banner.id || banner.slot || '') + text;
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    $('#bannerText').textContent = text;
    $('#bannerIc').innerHTML = plantSVG(stageIdx());
    el.classList.remove('drop'); void el.offsetWidth; el.classList.add('drop');
  }
  el.hidden = false;
}
$('#bannerX').addEventListener('click', () => {
  if (!banner) return;
  if (banner.kind === 'side') { const a = state.sideAlerts.find(x => x.id === banner.id); if (a) a.status = 'closed'; }
  banner = null; save(); refreshBanner();
});
$('#bannerMain').addEventListener('click', () => {
  const b = banner; if (!b) return;
  banner = null;
  if (b.kind === 'appt') go('appt');
  else if (b.kind === 'med') enterChat(b.slot);
  else enterChat();
});

/* =====================================================================
   1 홈
   ===================================================================== */
function renderHome() {
  $('#homeHello').textContent = `안녕하세요, ${PATIENT.name}님`;
  const t = todayStr(); let n = 0; const names = [];
  state.meds.forEach(m => {
    if (!inMedRange(m, t)) return;
    const left = m.times.filter(s => recOf(t, s) !== true).length;
    if (left) { n += left; names.push(m.name); }
  });
  $('#homeToday').innerHTML = n ? `오늘 복용할 약 <b>${n}개</b>가 있어요` : (state.meds.length ? '오늘 약을 모두 드셨어요' : '오늘 복용할 약이 없어요');
  $('#homeNames').textContent = [...new Set(names)].join(', ');
  $('#homePlant').innerHTML = plantSVG(stageIdx());
}

/* =====================================================================
   2 약물 정보 등록 (사진 → 처방전 → 자동 입력)
   ===================================================================== */
const reg = {};
function resetRegState() {
  Object.assign(reg, { dose: null, perDay: null, perDayCustom: false, times: new Set(), timeCustom: false, customTime: '', days: null, daysCustom: false, photo: null });
}
resetRegState();
function resetReg() {
  resetRegState();
  $('#medName').value = ''; $('#perDayInp').value = ''; $('#timeInp').value = ''; $('#daysInp').value = '';
  $('#photoIc').textContent = '📷';
  $('#regWarn').hidden = true;
  $('#regForm').hidden = false; $('#rxView').hidden = true;
  renderRegOpts();
}
const optBtn = (k, v, label, on) => `<button type="button" class="opt${on ? ' on' : ''}" data-k="${k}" data-v="${esc(v)}">${label}</button>`;
function regTimes() {
  const a = [...reg.times];
  if (reg.timeCustom && reg.customTime) a.push(reg.customTime);
  return [...new Set(a)].sort((x, y) => slotMin(x) - slotMin(y));
}
function updateTotal() {
  $('#totalTxt').textContent = (reg.dose && reg.perDay && reg.days) ? `총 ${fmtN(reg.dose * reg.perDay * reg.days)}정` : '';
}
function renderRegOpts() {
  $('#optDose').innerHTML = [0.5, 1, 2].map(v => optBtn('dose', v, `${v}정`, reg.dose === v)).join('');
  $('#optPerDay').innerHTML = [1, 2, 3].map(v => optBtn('perDay', v, `${v}번`, !reg.perDayCustom && reg.perDay === v)).join('') + optBtn('perDay', 'custom', '직접 입력', reg.perDayCustom);
  $('#optTimes').innerHTML = ['아침', '점심', '저녁', '잠자기 전'].map(s => optBtn('time', s, s, reg.times.has(s))).join('') + optBtn('time', 'custom', '직접 입력', reg.timeCustom);
  $('#optDays').innerHTML = [7, 14, 30].map(v => optBtn('days', v, `${v}일`, !reg.daysCustom && reg.days === v)).join('') + optBtn('days', 'custom', '직접 입력', reg.daysCustom);
  $('#perDayInp').hidden = !reg.perDayCustom;
  $('#timeInp').hidden = !reg.timeCustom;
  $('#daysInp').hidden = !reg.daysCustom;
  updateTotal();
}
$('#regForm').addEventListener('click', e => {
  const b = e.target.closest('.opt'); if (!b) return;
  const k = b.dataset.k, v = b.dataset.v;
  if (k === 'dose') reg.dose = Number(v);
  else if (k === 'perDay') {
    if (v === 'custom') { reg.perDayCustom = true; reg.perDay = Number($('#perDayInp').value) || null; }
    else { reg.perDayCustom = false; reg.perDay = Number(v); }
  } else if (k === 'time') {
    if (v === 'custom') reg.timeCustom = !reg.timeCustom;
    else if (reg.times.has(v)) reg.times.delete(v); else reg.times.add(v);
  } else if (k === 'days') {
    if (v === 'custom') { reg.daysCustom = true; reg.days = Number($('#daysInp').value) || null; }
    else { reg.daysCustom = false; reg.days = Number(v); }
  }
  $('#regWarn').hidden = true;
  renderRegOpts();
});
$('#perDayInp').addEventListener('input', e => { reg.perDay = Number(e.target.value) || null; updateTotal(); });
$('#daysInp').addEventListener('input', e => { reg.days = Number(e.target.value) || null; updateTotal(); });
$('#timeInp').addEventListener('input', e => { reg.customTime = e.target.value; });

/* 약물 사진: 작게 줄여서 보관 */
$('#photoBtn').addEventListener('click', () => $('#photoInput').click());
$('#photoInput').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      reg.photo = c.toDataURL('image/jpeg', 0.7);
      $('#photoIc').innerHTML = `<img src="${reg.photo}" alt="찍은 약물 사진">`;
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
  e.target.value = '';
});

function makeMed(o) {
  const d = findDrug(o.name);
  return {
    id: state.seq++, name: d ? d.name : o.name, strength: o.strength || (d ? d.strength : ''),
    perDose: o.perDose, perDay: o.perDay, days: o.days, times: o.times, photo: o.photo || null,
    startDate: todayStr(), regAt: Date.now(), how: o.how || ''
  };
}
function addMeds(list) {
  if (!state.meds.length && !Object.keys(state.records).length) state.startDate = todayStr();
  list.forEach(m => state.meds.push(m));
  save();
}
function regWarn(t) { const w = $('#regWarn'); w.textContent = t; w.hidden = false; }
$('#regBtn').addEventListener('click', () => {
  const raw = $('#medName').value.trim();
  const times = regTimes();
  const miss = [];
  if (!raw) miss.push('약물명');
  if (!reg.dose) miss.push('한 번에 먹는 양');
  if (!reg.perDay || reg.perDay < 1) miss.push('하루 횟수');
  if (!times.length) miss.push('먹는 때');
  if (!reg.days || reg.days < 1) miss.push('먹는 날 수');
  if (miss.length) return regWarn(`빠진 곳이 있어요: ${miss.join(', ')}`);
  if (times.length !== reg.perDay) return regWarn(`하루 ${reg.perDay}번이라서 먹는 때를 ${reg.perDay}개 골라 주세요.`);
  const strength = parseStrength(raw);
  addMeds([makeMed({ name: raw.replace(STR_RE, '').trim() || raw, strength, perDose: reg.dose, perDay: reg.perDay, days: reg.days, times, photo: reg.photo })]);
  showCheck('약물 등록이 완료되었습니다', 1200, () => go('home'));
});

/* 처방전 촬영 → 약물 자동 확인 → 내용 확인 → 등록 완료 */
const STEP4 = ['① 처방전 촬영', '② 약물 자동 확인', '③ 내용 확인', '④ 등록 완료'];
const stepsHTML = n => `<ol class="steps4">${STEP4.map((t, i) => `<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}">${t}</li>`).join('')}</ol>`;
const defaultTimes = n => ({ 1: ['아침'], 2: ['아침', '저녁'], 3: ['아침', '점심', '저녁'] }[n] || ['아침', '점심', '저녁', '잠자기 전']);
$('#rxBtn').addEventListener('click', () => $('#rxInput').click());
$('#rxInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  e.target.value = '';
  $('#regForm').hidden = true;
  const v = $('#rxView'); v.hidden = false;
  v.innerHTML = stepsHTML(2) + '<div class="analyze"><div class="spin"></div><p>약물을 확인하고 있어요</p></div>';
  const list = await recognizePrescription(f);       // 사진은 분석용 입력일 뿐, 결과 화면에는 보여주지 않음
  rxItems = list.map(r => {
    const nm = r.raw.replace(STR_RE, '').trim(), drug = findDrug(nm);
    return { raw: r.raw, name: drug ? drug.name : nm, strength: parseStrength(r.raw) || (drug ? drug.strength : ''), drug, ok: !!drug, checked: !!drug, perDose: r.perDose, perDay: r.perDay, days: r.days, how: r.how, open: null };
  });
  if (screen === 'medreg') renderRx();
});
function okItem(it, i) {
  let more = '';
  if (it.open === 'info') {
    const d = it.drug;
    more = `<dl class="rx-more"><dt>성분명</dt><dd>${esc(d ? d.ingredient : '확인 필요')}</dd><dt>함량 · 제형</dt><dd>${esc(it.strength || '-')} · ${esc(d ? d.form : '-')}</dd>` +
      `<dt>효능·효과</dt><dd>${esc(d ? d.effect : GENERIC_INFO)}</dd>` +
      `<dt>복용 방법 (처방전 기준)</dt><dd>1회 ${fmtN(it.perDose)}정, 하루 ${it.perDay}번, ${it.days}일${it.how ? ', ' + esc(it.how) : ''}</dd>` +
      `<dt>주의사항</dt><dd>${esc(d ? d.caution : GENERIC_INFO)}</dd></dl>`;
  } else if (it.open === 'edit') {
    more = `<div class="row-edit rx-more"><input class="inp" data-f="name" value="${esc(it.name + (it.strength ? ' ' + it.strength : ''))}" aria-label="약물명">` +
      `<select class="inp" data-f="perDose" aria-label="한 번에 먹는 양">${[0.5, 1, 2].map(v => `<option value="${v}"${v === it.perDose ? ' selected' : ''}>한 번에 ${v}정</option>`).join('')}</select>` +
      `<select class="inp" data-f="perDay" aria-label="하루 횟수">${[1, 2, 3, 4].map(v => `<option value="${v}"${v === it.perDay ? ' selected' : ''}>하루 ${v}번</option>`).join('')}</select>` +
      `<input class="inp" data-f="days" type="number" min="1" inputmode="numeric" value="${it.days}" aria-label="며칠 동안"><button type="button" class="btn-main" data-act="edit-close">확인</button></div>`;
  }
  return `<div class="rx-item" data-i="${i}"><label class="rx-row"><input type="checkbox" class="chk"${it.checked ? ' checked' : ''}><span>${esc(it.name)} ${esc(it.strength)}</span></label>` +
    `<p class="rx-sub">${fmtN(it.perDose)}정 · 하루 ${it.perDay}번 · ${it.days}일</p>` +
    `<div class="rx-btns"><button type="button" data-act="info">정보 확인</button><button type="button" data-act="edit">수정</button></div>${more}</div>`;
}
function badItem(it, i) {
  const c = candidates(it.name).map((d, k) => `<button type="button" class="cand" data-act="cand" data-c="${k}">${esc(d.name)} ${esc(d.strength)}</button>`).join('');
  return `<div class="rx-item bad" data-i="${i}"><p class="rx-warn">약물명을 정확하게 확인하지 못했습니다. 직접 확인해주세요.</p>${c}` +
    `<input class="inp" data-f="manual" placeholder="약물명 직접 입력" autocomplete="off"><button type="button" class="btn-neutral" style="margin-top:8px" data-act="manual">이 이름으로 하기</button></div>`;
}
function renderRx() {
  const n = rxItems.filter(i => i.ok && i.checked).length;
  $('#rxView').innerHTML = stepsHTML(3) + '<h2 class="rx-title">처방전에서 다음 약물을 확인했습니다</h2>' +
    rxItems.map((it, i) => (it.ok ? okItem(it, i) : badItem(it, i))).join('') +
    `<button type="button" class="btn-main" id="rxSave"${n ? '' : ' disabled'}>이대로 약물 등록하기</button>`;
}
$('#rxView').addEventListener('click', e => {
  if (e.target.closest('#rxSave')) {
    const list = rxItems.filter(i => i.ok && i.checked);
    if (!list.length) return;
    addMeds(list.map(i => makeMed({ name: i.name, strength: i.strength, perDose: i.perDose, perDay: i.perDay, days: i.days, times: defaultTimes(i.perDay), how: i.how })));
    $('#rxView').innerHTML = stepsHTML(4);
    return showCheck('약물 등록이 완료되었습니다', 1200, () => go('home'));
  }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const box = b.closest('.rx-item'); const it = rxItems[Number(box.dataset.i)];
  const act = b.dataset.act;
  if (act === 'info') it.open = it.open === 'info' ? null : 'info';
  else if (act === 'edit') it.open = it.open === 'edit' ? null : 'edit';
  else if (act === 'edit-close') it.open = null;
  else if (act === 'cand') {
    const d = candidates(it.name)[Number(b.dataset.c)];
    Object.assign(it, { drug: d, name: d.name, strength: d.strength, ok: true, checked: true });
  } else if (act === 'manual') {
    const val = box.querySelector('[data-f="manual"]').value.trim(); if (!val) return;
    const d = findDrug(val);
    Object.assign(it, { name: d ? d.name : val.replace(STR_RE, '').trim(), strength: parseStrength(val) || (d ? d.strength : ''), drug: d, ok: true, checked: true });
  }
  renderRx();
});
$('#rxView').addEventListener('change', e => {
  const box = e.target.closest('.rx-item'); if (!box) return;
  const it = rxItems[Number(box.dataset.i)];
  if (e.target.classList.contains('chk')) { it.checked = e.target.checked; return renderRx(); }
  const f = e.target.dataset.f; if (!f) return;
  if (f === 'perDose') it.perDose = Number(e.target.value);
  else if (f === 'perDay') it.perDay = Number(e.target.value);
  else if (f === 'days') it.days = Math.max(1, Number(e.target.value) || 1);
  else if (f === 'name') {
    const raw = e.target.value.trim(), nm = raw.replace(STR_RE, '').trim(), d = findDrug(nm);
    it.drug = d; it.name = d ? d.name : nm; it.strength = parseStrength(raw) || (d ? d.strength : '');
    if (!d) { it.ok = false; it.checked = false; it.open = null; }   // 공식 정보와 일치하지 않으면 다시 확인
  }
  renderRx();
});

/* =====================================================================
   3 병원 등록
   ===================================================================== */
function renderHosp() {
  const q = $('#hospQ').value.trim();
  let list = [];
  if (q) list = HOSPITALS.map((h, i) => ({ h, i })).filter(x => (x.h.name + x.h.dept + x.h.addr).includes(q));
  $('#hospList').innerHTML = !q ? '' : list.length ? list.map(({ h, i }) =>
    `<button type="button" class="h-card${hospSel === i ? ' sel' : ''}" data-i="${i}"><b>${esc(h.name)}</b><span class="dept">${esc(h.dept)}</span><span class="addr">${esc(h.addr)}</span><span class="tel">${esc(h.phone)}</span><span class="mark">${hospSel === i ? '✓' : ''}</span></button>`).join('')
    : '<p class="empty">검색 결과가 없어요</p>';
  $('#hospRegBtn').disabled = hospSel === null;
}
$('#hospQ').addEventListener('input', () => { hospSel = null; renderHosp(); });
$('#hospList').addEventListener('click', e => {
  const b = e.target.closest('.h-card'); if (!b) return;
  hospSel = Number(b.dataset.i); renderHosp();
});
$('#hospRegBtn').addEventListener('click', () => {
  if (hospSel === null) return;
  const h = HOSPITALS[hospSel];
  if (state.hospitals.some(x => x.name === h.name)) showToast('이미 등록된 병원이에요.');
  else {
    state.hospitals.push({ id: state.seq++, name: h.name, dept: h.dept, addr: h.addr, phone: h.phone });
    save();
    showToast(`${h.name}이 등록되었습니다.`);
  }
  hospSel = null; renderHosp();
});

/* =====================================================================
   4 다음 외래 일정
   ===================================================================== */
const DOW_HTML = DOW.map(d => `<span>${d}</span>`).join('');
$('#apDow').innerHTML = DOW_HTML; $('#rcDow').innerHTML = DOW_HTML;
function buildCal(y, m, fn) {
  const first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
  let h = '';
  for (let i = 0; i < first; i++) h += '<div class="cal-empty"></div>';
  for (let d = 1; d <= n; d++) h += fn(`${y}-${pad(m + 1)}-${pad(d)}`, d);
  return h;
}
const apDT = a => `${a.date}T${a.time}`;
const apText = a => { const d = parseD(a.date); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일 ${timeLabel(a.time)}`; };
function renderAppt() {
  $('#apMonth').textContent = `${apM.y}년 ${apM.m + 1}월`;
  const t = todayStr();
  $('#apGrid').innerHTML = buildCal(apM.y, apM.m, (s, d) => {
    const has = state.appts.some(a => a.date === s);
    return `<div class="cal-cell${s === t ? ' today' : ''}"><span>${d}</span>${has ? '<i class="dot" aria-label="진료 있음"></i>' : ''}</div>`;
  });
  const now = ds(new Date()) + 'T' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes());
  const up = state.appts.filter(a => apDT(a) >= now).sort((a, b) => apDT(a).localeCompare(apDT(b)));
  $('#apNearest').innerHTML = up.length
    ? `<div class="ap-near"><p class="a2">${apText(up[0])}</p><p class="a1">${esc(up[0].hospital)}</p><p class="a3">${esc(up[0].dept || '')}</p></div>`
    : '<p class="empty">예정된 진료 일정이 없어요</p>';
  $('#apList').innerHTML = up.slice(1).map(a =>
    `<div class="ap-item"><div class="tx"><b>${apText(a)}</b><br>${esc(a.hospital)}${a.dept ? ' · ' + esc(a.dept) : ''}</div><button type="button" data-edit="${a.id}">수정</button></div>`).join('');
}
$('#apPrev').addEventListener('click', () => { apM = apM.m === 0 ? { y: apM.y - 1, m: 11 } : { y: apM.y, m: apM.m - 1 }; renderAppt(); });
$('#apNext').addEventListener('click', () => { apM = apM.m === 11 ? { y: apM.y + 1, m: 0 } : { y: apM.y, m: apM.m + 1 }; renderAppt(); });
$('#s-appt').addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) openApForm(Number(b.dataset.edit)); });
$('#apAdd').addEventListener('click', () => openApForm(null));
function setApTimeBtn(v) {
  const b = $('#apTimeBtn');
  b.textContent = v ? timeLabel(v) : '진료 시간';
  b.classList.toggle('set', !!v);
}
function openApForm(id) {
  apEditId = id;
  const a = id ? state.appts.find(x => x.id === id) : null;
  $('#apFormTitle').textContent = a ? '진료 일정 수정하기' : '진료 일정 추가하기';
  $('#apHosp').value = a ? a.hospital : '';
  $('#apDate').value = a ? a.date : '';
  $('#apTime').value = a ? a.time : '';
  $('#apDept').value = a ? a.dept : '';
  setApTimeBtn(a ? a.time : '');
  $('#hospNames').innerHTML = state.hospitals.map(h => `<option value="${esc(h.name)}">`).join('');
  $('#apSheet').hidden = false;
}
$('#apTimeBtn').addEventListener('click', () => {
  const inp = $('#apTime');
  try { inp.showPicker(); } catch (e) { inp.focus(); inp.click(); }   // 기기 기본 시간 선택창
});
$('#apTime').addEventListener('input', e => setApTimeBtn(e.target.value));
$('#apTime').addEventListener('change', e => setApTimeBtn(e.target.value));
$('#apCancel').addEventListener('click', () => { $('#apSheet').hidden = true; });
$('#apSave').addEventListener('click', () => {
  const hospital = $('#apHosp').value.trim(), date = $('#apDate').value, time = $('#apTime').value, dept = $('#apDept').value.trim();
  if (!hospital || !date || !time) return showToast('병원, 날짜, 진료 시간을 입력해 주세요.', 2500);
  const editing = apEditId !== null;
  if (editing) Object.assign(state.appts.find(x => x.id === apEditId), { hospital, date, time, dept });
  else state.appts.push({ id: state.seq++, hospital, date, time, dept });
  save();
  $('#apSheet').hidden = true;
  renderAppt();
  showCheck(editing ? '일정 수정이 완료되었습니다' : '진료 일정 등록이 완료되었습니다', 3000);
});

/* =====================================================================
   5 보호자·의료진 연계
   ===================================================================== */
function renderCare() {
  $('#gList').innerHTML = state.guardians.map(g =>
    `<div class="person"><span>${esc(g.relation)} ${esc(g.name)}님</span><a href="tel:${esc(g.phone.replace(/[^0-9+]/g, ''))}">연락하기</a></div>`).join('');
  $('#hList').innerHTML = state.hospitals.map(h =>
    `<div class="person"><span>${esc(h.name)}</span><a href="tel:${esc(h.phone.replace(/[^0-9+]/g, ''))}">문의하기</a></div>`).join('');
}
$('#gAddBtn').addEventListener('click', () => { $('#gForm').hidden = false; $('#gRel').focus(); });
$('#gCancel').addEventListener('click', () => { $('#gForm').hidden = true; $('#gForm').reset(); });
$('#gForm').addEventListener('submit', e => {
  e.preventDefault();
  const relation = $('#gRel').value.trim(), name = $('#gName').value.trim(), phone = $('#gPhone').value.trim();
  if (!relation || !name || !phone) return showToast('관계, 이름, 전화번호를 모두 입력해 주세요.', 2500);
  state.guardians.push({ id: state.seq++, relation, name, phone });
  save();
  $('#gForm').hidden = true; $('#gForm').reset();
  showCheck('보호자 등록이 완료되었습니다', 3000, () => { renderCare(); renderInboxes(); });
});

/* =====================================================================
   6~8 챗봇 쑥쑥이 (대화는 localStorage에 저장되어 이어서 보임)
   ===================================================================== */
const SYMS = [['😵‍💫', '어지러움'], ['😴', '졸림'], ['🤕', '두통'], ['🔥', '속쓰림'], ['🤢', '메스꺼움'], ['🔴', '발진이나 가려움'], ['😮‍💨', '호흡곤란'], ['😖', '심한 복통'], ['🙂', '없음']];
const OPEN_KINDS = ['med', 'meal', 'remind', 'take'];
function pushBot(text, ex) { const m = Object.assign({ id: state.seq++, from: 'bot', kind: 'text', text, open: false }, ex || {}); state.chat.push(m); return m; }
function pushMe(text) { state.chat.push({ id: state.seq++, from: 'me', kind: 'text', text }); }
const chatHasOpen = () => state.chat.some(m => m.open);
const hasOpenMed = s => state.chat.some(m => m.open && m.kind === 'med' && m.slot === s);
const medsForSlot = s => state.meds.filter(m => m.times.includes(s));
function askMed(slot) { pushBot(`${slotMedName(slot)} 드셨나요?`, { kind: 'med', slot, open: true }); }
function askSide(a) { a.status = 'asked'; pushBot('약을 복용하신지 30분이 지났습니다. 불편하신 점이 있으신가요?', { kind: 'side', alertId: a.id, open: true }); }
function closeStale() {
  const t = todayStr();
  state.chat.forEach(m => { if (m.open && OPEN_KINDS.includes(m.kind) && isRec(t, m.slot)) m.open = false; });
}
/* 새 질문이 생기면 true */
function pumpChat() {
  if (screen !== 'chat') return false;
  let changed = false;
  dueSideAlerts().forEach(a => { askSide(a); changed = true; });
  if (!chatHasOpen()) {
    const t = todayStr(), now = Date.now();
    const rem = state.reminders.find(r => !r.done && r.date === t && r.dueAt <= now);
    if (rem) {
      rem.done = true;
      if (!isRec(t, rem.slot)) { askMed(rem.slot); changed = true; }
    } else {
      const s = dueMedSlot();
      if (s) { markAlerted(s); if (!hasOpenMed(s)) { askMed(s); changed = true; } }
    }
  }
  if (changed) save();
  return changed;
}
function enterChat(medSlot) {
  const first = !state.chatGreeted;
  const b = banner;
  banner = null;
  if (first) { pushBot(`안녕하세요? 저는 ${PATIENT.name}님의 건강 길잡이 쑥쑥이라고 해요!`); state.chatGreeted = true; }
  closeStale();
  screen = 'chat';
  const slot = medSlot || (b && b.kind === 'med' ? b.slot : null);
  const t = todayStr();
  dueSideAlerts().forEach(a => askSide(a));
  if (slot && !isRec(t, slot) && !hasOpenMed(slot)) askMed(slot);
  else if (!first && !slot && !chatHasOpen()) { const nx = nextUnrecSlot(); if (nx) askMed(nx); }
  save();
  go('chat');
  pumpChat();
  save(); renderChat();
}
function msgHTML(m) {
  if (m.from === 'me') return `<div class="msg me"><div class="bub">${esc(m.text)}</div></div>`;
  let inner = `<div class="bub">${esc(m.text)}</div>`, wide = '';
  if (m.kind === 'med') {
    const ms = medsForSlot(m.slot);
    if (ms.length) inner += `<div class="med-photos">${ms.map(x => `<figure class="med-photo">${medArt(x)}<figcaption>${esc(x.name)}</figcaption></figure>`).join('')}</div>`;
    wide = ' wide';
  }
  if (m.open) {
    const btn = (act, label, cls) => `<button type="button" class="oval ${cls}" data-act="${act}" data-id="${m.id}">${label}</button>`;
    if (m.kind === 'med') inner += `<div class="btn-col">${btn('med-yes', '예', 'go')}${btn('med-no', '아니요', 'alt')}</div>`;
    else if (m.kind === 'meal') inner += `<div class="btn-col">${btn('meal-not', '아직 안 먹었어요', 'alt')}${btn('meal-yes', '식사했어요', 'go')}</div>`;
    else if (m.kind === 'remind') inner += `<div class="btn-col">${btn('remind-set', '식사 후 30분 뒤에 다시 알려주기', 'or')}</div>`;
    else if (m.kind === 'take') inner += `<div class="btn-col">${btn('take-done', '약 복용 완료했어요', 'go')}</div>`;
    else if (m.kind === 'side') {
      wide = ' wide';
      inner += `<div class="sym-grid">${SYMS.map(([ic, tx]) => `<button type="button" class="sym" data-act="side-pick" data-id="${m.id}" data-v="${tx}"><span class="sym-ic">${ic}</span><span>${tx}</span></button>`).join('')}</div>` +
        `<div class="sym-custom"><input class="inp" id="sym-${m.id}" placeholder="직접 입력" autocomplete="off"><button type="button" class="oval go" data-act="side-custom" data-id="${m.id}">보내기</button></div>`;
    }
  }
  return `<div class="msg"><div class="avatar">${plantSVG(stageIdx())}</div><div class="body${wide}">${inner}</div></div>`;
}
function renderChat() {
  $('#chatList').innerHTML = state.chat.map(msgHTML).join('');
  const sc = $('#s-chat'); sc.scrollTop = sc.scrollHeight;
}
function chooseSide(m, label) {
  m.open = false; m.choice = label;
  const a = state.sideAlerts.find(x => x.id === m.alertId); if (a) a.status = 'done';
  pushMe(label);
  pushBot('이어서 불편한 정도를 점수로 골라 주세요');
  setTimeout(() => { if (screen === 'chat') go('side'); }, 1500);   // 약 1~2초 뒤 9번으로
}
function recordFromChat(slot) {
  if (recordSlot(todayStr(), slot, true)) pushBot('잘하셨어요! 약을 챙겨 드셨네요.');
  else pushBot('이미 기록된 시간대예요.');
}
$('#chatList').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const m = state.chat.find(x => x.id === Number(b.dataset.id));
  if (!m || !m.open) return;
  const act = b.dataset.act;
  if (act === 'side-custom') {
    const inp = $('#sym-' + m.id); const v = inp ? inp.value.trim() : '';
    if (!v) return;
    chooseSide(m, v);
  } else if (act === 'side-pick') chooseSide(m, b.dataset.v);
  else {
    m.open = false;
    if (act === 'med-yes') { pushMe('예'); recordFromChat(m.slot); }
    else if (act === 'med-no') { pushMe('아니요'); pushBot('혹시 식사를 안 하셨나요?', { kind: 'meal', slot: m.slot, open: true }); }
    else if (act === 'meal-not') {
      pushMe('아직 안 먹었어요');
      pushBot('아, 식사 전이시군요! 빈속에 약을 드시면 속이 쓰릴 수 있어요. 식사를 가볍게 하신 후에 약을 드시는 것이 좋답니다.');
      pushBot('식사 후에 약을 드시면 알림을 다시 보내드릴까요?', { kind: 'remind', slot: m.slot, open: true });
    } else if (act === 'meal-yes') {
      pushMe('식사했어요');
      pushBot('식사를 챙겨 드셨군요! 다행이에요. 그럼 지금 바로 물과 함께 약을 드셔주세요.', { kind: 'take', slot: m.slot, open: true });
    } else if (act === 'remind-set') {
      pushMe('식사 후 30분 뒤에 다시 알려주기');
      state.reminders.push({ id: state.seq++, date: todayStr(), slot: m.slot, dueAt: Date.now() + REMIND_MS, done: false });
      pushBot('네, 식사 후에 다시 알려 드릴게요.');
    } else if (act === 'take-done') { pushMe('약 복용 완료했어요'); recordFromChat(m.slot); }
  }
  save(); renderChat(); showGrowth(); renderTabs(); refreshBanner();
});

/* =====================================================================
   11 복약 기록 / 10 내 식물 / 공통 주기 계산
   ===================================================================== */
const cycleTitle = (vc, cur, cur_label) => (vc === cur ? cur_label : `${vc + 1}주차 복약 달성률`);
const cycleRange = vc => { const d = cycleDays(vc); return `${md(d[0])}~${md(d[6])}`; };
function renderRecord() {
  const idx = stageIdx(), st = STAGES[idx], cur = currentCycle();
  $('#recPlant').innerHTML = plantSVG(idx);
  const O = cycleO(cur), X = cycleX(cur), has = cycleHasRec(cur);
  $('#recSay').textContent = O === 7 ? '대단하세요! 이번 주 약을 모두 드셨어요'
    : X > 0 ? '괜찮아요, 오늘부터 다시 챙겨 드세요'
      : !has ? '오늘 약을 드셨나요?' : '꾸준히 복약하고 계시네요!';
  $('#recGrow').textContent = idx < 3 ? `${remainToGrow()}일 더 드시면 식물이 자라요` : '꽃이 활짝 피었어요';
  $('#recStage').textContent = `현재 단계: ${STAGE_NAME[st]} ${STAGE_EMOJI[st]}`;

  $('#rcMonth').textContent = `${rcM.y}년 ${rcM.m + 1}월`;
  const t = todayStr();
  $('#rcGrid').innerHTML = buildCal(rcM.y, rcM.m, (s, d) => {
    const stt = dayStatus(s), can = inRange(s);
    const cls = ['cal-cell', 'rc', stt || '', s === t ? 'today' : '', can ? '' : 'off'].join(' ');
    const inner = `<span class="dn">${d}</span><span class="st">${stt === 'O' ? '복약 O' : stt === 'X' ? '복약 X' : '&nbsp;'}</span>`;
    return can ? `<button type="button" class="${cls}" data-d="${s}">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
  });

  const vc = recView === null ? cur : recView;
  const done = cycleO(vc), miss = cycleX(vc), pct = Math.round(done / 7 * 100);
  $('#raTitle').textContent = cycleTitle(vc, cur, '이번 주기 복약 달성률');
  $('#raSub').textContent = `${vc + 1}주차 · ${cycleRange(vc)}`;
  $('#raIc').innerHTML = plantSVG(idx);
  $('#raBar').style.width = pct + '%';
  $('#raPct').textContent = pct + '%';
  $('#raDone').textContent = done + '일'; $('#raMiss').textContent = miss + '일';
  $('#raPrev').disabled = vc <= 0; $('#raNext').disabled = vc >= 4;
}
$('#rcPrev').addEventListener('click', () => { rcM = rcM.m === 0 ? { y: rcM.y - 1, m: 11 } : { y: rcM.y, m: rcM.m - 1 }; renderRecord(); });
$('#rcNext').addEventListener('click', () => { rcM = rcM.m === 11 ? { y: rcM.y + 1, m: 0 } : { y: rcM.y, m: rcM.m + 1 }; renderRecord(); });
$('#raPrev').addEventListener('click', () => { const cur = currentCycle(); recView = Math.max(0, (recView === null ? cur : recView) - 1); renderRecord(); });
$('#raNext').addEventListener('click', () => { const cur = currentCycle(); recView = Math.min(4, (recView === null ? cur : recView) + 1); renderRecord(); });
$('#rcGrid').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) openDay(b.dataset.d); });

function openDay(d) { popDate = d; renderDayPop(); $('#dayOv').hidden = false; }
function renderDayPop() {
  let h = `<h2>${mdw(popDate)} 약을 드셨나요?</h2>`;
  getSlots().forEach(s => {
    const v = recOf(popDate, s), done = v !== undefined, dis = done ? ' disabled' : '';
    h += `<div class="slot-row"><p class="slot-name">${esc(slotLabel(s))}${done ? `<span class="slot-res ${v ? 'ok' : 'bad'}">${v ? 'O' : 'X'}</span>` : ''}</p>` +
      `<div class="slot-btns"><button type="button" class="btn-yes" data-v="1" data-s="${esc(s)}"${dis}>예, 먹었어요</button><button type="button" class="btn-no" data-v="0" data-s="${esc(s)}"${dis}>아니요, 안 먹었어요</button></div></div>`;
  });
  h += '<button type="button" class="btn-neutral" id="dayClose">닫기</button>';
  $('#dayPop').innerHTML = h;
}
$('#dayPop').addEventListener('click', e => {
  if (e.target.closest('#dayClose')) { $('#dayOv').hidden = true; return; }
  const b = e.target.closest('[data-s]'); if (!b || b.disabled) return;
  recordSlot(popDate, b.dataset.s, b.dataset.v === '1');
  $('#dayOv').hidden = true;                 // 선택하면 창이 자동으로 닫힘
  renderAll(); showGrowth();
});
$('#growOk').addEventListener('click', () => { $('#growOv').hidden = true; });

function renderPlant() {
  const idx = stageIdx(), st = STAGES[idx], cur = currentCycle();
  const vc = plView === null ? cur : plView;
  const O = cycleO(vc), pct = Math.round(O / 7 * 100);
  $('#plTitle').textContent = cycleTitle(vc, cur, '이번 주 복약 달성률');
  $('#plSub').textContent = `${vc + 1}주차 · ${cycleRange(vc)} (7일 단위로 한 달 진행)`;
  $('#plNum').textContent = `${O}/7일`;
  $('#plPct').textContent = `${pct}%`;
  $('#plBar').style.width = pct + '%';
  const t = todayStr();
  $('#plDots').innerHTML = cycleDays(vc).map(d => {
    const s = dayStatus(d);
    return `<div class="dot-wrap"><span class="dot7 ${s === 'O' ? 'ok' : s === 'X' ? 'bad' : ''} ${d === t ? 'today' : ''}" aria-label="${md(d)} ${s === 'O' ? '복약 O' : s === 'X' ? '복약 X' : '기록 없음'}">${s === 'O' ? '✓' : s === 'X' ? '×' : ''}</span><span class="dot-d">${md(d)}</span></div>`;
  }).join('');
  $('#plPlant').innerHTML = plantSVG(idx);
  $('#plStage').textContent = `현재 단계: ${STAGE_NAME[st]} ${STAGE_EMOJI[st]}`;
  $('#plRemain').textContent = idx < 3 ? `다음 성장까지 ${remainToGrow()}일 남았어요!` : '꽃이 활짝 피었어요! 지금처럼 꾸준히 드세요';
  $('#plPrev').disabled = vc <= 0; $('#plNextBtn').disabled = vc >= 4;
}
$('#plPrev').addEventListener('click', () => { const cur = currentCycle(); plView = Math.max(0, (plView === null ? cur : plView) - 1); renderPlant(); });
$('#plNextBtn').addEventListener('click', () => { const cur = currentCycle(); plView = Math.min(4, (plView === null ? cur : plView) + 1); renderPlant(); });
$('#plPlant').addEventListener('click', () => go('record'));

/* =====================================================================
   9 부작용 상태 (5점 척도)
   ===================================================================== */
const FACES = ['😀', '🙂', '😐', '😣', '😫'];
const SCORE_COL = ['#2e9e4f', '#7cb342', '#f2a900', '#ef6c00', '#d32f2f'];
const SCORE_TXT = ['증상이 없어요', '조금 불편해요', '보통으로 불편해요', '많이 불편해요', '매우 심하게 불편해요'];
function renderSide() {
  $('#sideMain').hidden = sideDone; $('#sideDone').hidden = !sideDone;
  $('#scale').innerHTML = FACES.map((f, i) =>
    `<button type="button" class="sc${sideSel === i + 1 ? ' on' : ''}" data-n="${i + 1}" style="--c:${SCORE_COL[i]}" aria-label="${i + 1}점 ${SCORE_TXT[i]}"><span class="sc-f">${f}</span><span class="sc-n">${i + 1}</span></button>`).join('');
  $('#selLine').innerHTML = sideSel ? `<span class="sl-f">${FACES[sideSel - 1]}</span><b class="sl-n">${sideSel}점</b><span class="sl-d">${SCORE_TXT[sideSel - 1]}</span>` : '';
  $('#sideOk').disabled = !sideSel;
}
$('#scale').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (!b) return; sideSel = Number(b.dataset.n); renderSide(); });
$('#sideOk').addEventListener('click', () => {
  if (!sideSel) return;
  const t = todayStr(), score = sideSel;
  state.scores.push({ ts: Date.now(), date: t, score });
  if (score >= 3) {
    state.guardians.forEach(g => state.guardianInbox.push({ id: state.seq++, relation: g.relation, name: g.name, phone: g.phone, score, date: t }));
    const cnt = state.scores.filter(s => s.date === t && s.score >= 3).length;
    if (cnt >= 3) {
      state.hospitals.forEach(h => {
        const item = { id: state.seq++, hid: h.id, hname: h.name, hphone: h.phone, date: t, meds: state.meds.map(m => m.name), history: state.scores.slice(-10).map(s => ({ date: s.date, score: s.score })) };
        const i = state.staffInbox.findIndex(x => x.hid === h.id && x.date === t);
        if (i >= 0) state.staffInbox[i] = item; else state.staffInbox.push(item);
      });
    }
  }
  save(); renderInboxes();
  sideDone = true; renderSide();
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { if (screen === 'side') go('home'); }, 2500);
});

/* =====================================================================
   12 나의 등록된 약물
   ===================================================================== */
function renderMeds() {
  $('#medList').innerHTML = state.meds.length ? state.meds.map(m => {
    const tot = medTotal(m), tk = medTaken(m), pct = Math.round(tk / tot * 100);
    return `<button type="button" class="med-card" data-id="${m.id}"><div class="art">${medArt(m)}</div><div class="info">` +
      `<div class="nm">${esc(m.name)} ${esc(m.strength)}</div><div class="cnt">복용 ${fmtN(tk)}정 / 전체 ${fmtN(tot)}정</div>` +
      `<div class="bar"><i style="width:${pct}%"></i></div><div class="row">복용률 ${pct}%<span>${fmtN(tot - tk)}정 남음</span></div>` +
      `<div class="good">${pct >= 100 ? '처방을 모두 드셨어요' : '처방대로 잘 복용하고 있어요'}</div></div></button>`;
  }).join('') : '<p class="empty">등록된 약물이 없어요</p>';
}
$('#medList').addEventListener('click', e => { const b = e.target.closest('.med-card'); if (!b) return; detailId = Number(b.dataset.id); go('meddetail'); });
function renderDetail() {
  const m = state.meds.find(x => x.id === detailId);
  if (!m) return go('meds');
  const d = findDrug(m.name), tot = medTotal(m), tk = medTaken(m), pct = Math.round(tk / tot * 100);
  const end = addDays(m.startDate, m.days - 1);
  const cell = (k, v, hl) => `<div${hl ? ' class="hl"' : ''}><span>${k}</span>${v}</div>`;
  $('#medDetail').innerHTML =
    `<div class="det-head"><div class="art">${medArt(m)}</div><h2>${esc(m.name)} ${esc(m.strength)}</h2></div>` +
    `<div class="grid-info">${cell('복용량', `1회 ${fmtN(m.perDose)}정`)}${cell('하루 복용 횟수', `하루 ${m.perDay}번`)}${cell('복용 기간', `${m.days}일`)}${cell('전체 처방량', `${fmtN(tot)}정`)}` +
    `${cell('현재까지 복용한 양', `${fmtN(tk)}정`, true)}${cell('남은 약 개수', `${fmtN(tot - tk)}정`, true)}${cell('복용률', `${pct}%`, true)}${cell('복용 시작일', ymdK(m.startDate))}${cell('복용 종료 예정일', ymdK(end))}</div>` +
    `<div class="info-card"><h3>💊 약물 용도 및 효능</h3>${esc(d ? d.effect : GENERIC_INFO)}</div>` +
    `<div class="info-card"><h3>🥛 올바른 복용 방법</h3>${m.how ? `처방: ${esc(m.how)}<br>` : ''}${esc(d ? d.how : GENERIC_INFO)}</div>` +
    `<div class="info-card cau"><h3>⚠️ 특별 주의사항</h3>${esc(d ? d.caution : GENERIC_INFO)}</div>` +
    `<div class="info-card sid"><h3>🩺 예상되는 주요 부작용</h3>${esc(d ? d.side : GENERIC_INFO)}</div>`;
}

/* =====================================================================
   앱 아래 별도 영역: 보호자용 / 의료진용 화면
   ===================================================================== */
function renderInboxes() {
  $('#guardianList').innerHTML = state.guardianInbox.length ? state.guardianInbox.slice().reverse().map(g =>
    `<div class="inbox-item"><p class="who">${esc(g.relation)} ${esc(g.name)} · ${esc(g.phone)}</p><p>${esc(PATIENT.name)}님의 부작용이 3점 이상(${g.score}점)으로 기록되었어요.(${mdw(g.date)})</p></div>`).join('')
    : '<p class="small">받은 알림이 없어요</p>';
  $('#staffList').innerHTML = state.staffInbox.length ? state.staffInbox.slice().reverse().map(s =>
    `<div class="inbox-item"><p class="who">${esc(s.hname)} · ${esc(s.hphone)}</p><p>3점 이상 누적 3회 이상으로 알람이 왔어요.</p>` +
    `<p>이름: ${esc(PATIENT.name)} / 나이: ${PATIENT.age}세</p><p>복용약: ${s.meds.length ? esc(s.meds.join(', ')) : '없음'}</p>` +
    `<p class="hist">점수 이력: ${s.history.map(h => `${mdw(h.date)} ${h.score}점`).join(' · ')}</p></div>`).join('')
    : '<p class="small">받은 알림이 없어요</p>';
}

/* =====================================================================
   관리자용 패널
   ===================================================================== */
function admMsg(t) {
  const el = $('#adminMsg'); el.textContent = t;
  clearTimeout(admTimer); admTimer = setTimeout(() => { el.textContent = ''; }, 2500);
}
$('#admMed').addEventListener('click', () => {
  if (!state.meds.length) return admMsg('등록된 약물이 없어요');
  const slot = nextUnrecSlot();
  if (!slot) return admMsg('기록하지 않은 시간대가 없어요');
  if (screen === 'chat') { if (!hasOpenMed(slot)) { askMed(slot); save(); renderChat(); } }
  else { forcedMed = slot; refreshBanner(); }      // "하루 한 번" 규칙에는 영향 없음
});
$('#admRec').addEventListener('click', () => {
  state.records = {}; state.sideAlerts = []; state.reminders = []; state.medAlerted = {}; state.maxStage = 0;
  banner = null; forcedMed = null; pendingGrowth = null; recView = null; plView = null;
  save(); renderAll(); admMsg('복약기록을 처음 상태로 되돌렸어요');
});
$('#admAll').addEventListener('click', () => {
  state = defaults();
  try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
  banner = null; forcedMed = null; pendingGrowth = null; rxRound = 0; rxItems = [];
  $$('.overlay,.sheet').forEach(o => { o.hidden = true; });
  save(); go('home'); renderInboxes(); admMsg('모든 내용을 처음 상태로 되돌렸어요');
});

/* =====================================================================
   시작
   ===================================================================== */
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
  const t = e.target.closest('[data-tab]'); if (t) return go(t.dataset.tab);
});
$('#homePlant').addEventListener('click', () => go('record'));   // 가운데 화분 → 복약 기록 탭(하단 탭 등장)
$('#chatFab').addEventListener('click', () => enterChat());
function tick() {
  refreshBanner();
  if (screen === 'chat' && pumpChat()) renderChat();
}
renderInboxes();
go('home');
setInterval(tick, 1000);
