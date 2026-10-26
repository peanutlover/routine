/* 웨이트트레이닝 루틴 — 진행 로직 (순수 함수). 브라우저(index.html)와 Node 테스트에서 함께 사용한다. */
const RoutineLogic = (() => {
  'use strict';

  const DAY = 86400000;
  const SLOTS = 6;          // 세션 = 운동 6회 (데드·스쿼트 번갈아 3회씩)
  const MAIN_STAGES = 4;    // 하체 묶음 = 4세션 (횟수 고정일 때)
  const ACC_TOP = 2;        // 횟수 고정 보조 종목의 무게 사다리 = 3단계 (기본·+1칸·+2칸)
  const GAP1 = 5, GAP2 = 10; // 한 종목을 이만큼 쉬면 세션을 처음부터 다시 하고 한 단계(GAP2일이면 두 단계) 낮춘다
  const PLATE_OPTIONS = [0.25, 0.5, 1, 1.25, 1.5, 2];  // 고를 수 있는 경량원판(종류별 한 쌍)
  const BIG_PLATES = [20, 15, 10, 5];                    // 어느 헬스장에나 있는 원판(2.5kg은 따로)

  // 훈련방식. cont = 무게를 %·kg으로 올리고 원판·무게추로 맞춤, list = 가진 무게 목록 안에서 다음 무게로 올림.
  const MODES = {
    barbell: { name: '바벨', cont: true },
    fixedbar: { name: '일체형 바벨', list: 'bars' },
    dumbbell: { name: '덤벨', list: 'db' },
    machine: { name: '머신 · 원판', cont: true },
    stack: { name: '머신 · 무게추', cont: true },
    chain: { name: '원판 여러 장', cont: true },
    plate: { name: '원판 한 장', list: 'one' },
    band: { name: '고무밴드' },
  };
  const MODE_KEYS = Object.keys(MODES);

  // ---------- 날짜 (UTC 일 번호로 계산해 서머타임 영향 없음) ----------
  const pad = (x) => String(x).padStart(2, '0');
  function toNum(s) { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); }
  function toStr(n) { const t = new Date(n * DAY); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  function weekday(n) { return new Date(n * DAY).getUTCDay(); } // 0=일 … 6=토
  function mondayOf(n) { return n - ((weekday(n) + 6) % 7); }
  function localToday(now = new Date()) { return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()); }

  // ---------- 기본 설정 ----------
  // gear: 가진 덤벨(db)·일체형 바벨(bars)·한 장으로 드는 원판(one) 무게 목록, 고무밴드 이름(bands).
  // 종목(acc[]): mode 훈련방식, w 시작 무게(밴드는 null), prog 'r' 횟수 고정(무게가 오름) · 'w' 무게 고정(횟수가 ladder대로 오름),
  //   reps 횟수 고정일 때 횟수, ladder 무게 고정일 때 횟수 단계, inc·incV %·kg 증량(cont 방식), stack 머신 무게추 단계, bands 쓰는 밴드.
  //   chg: 기록 중에 훈련방식을 바꾼 내역 [{no, mode, w, name}]. 그 종목의 세션 no부터 새 방식·무게로 다시 시작한다.
  // from: 시작 지점. 시작일에 하는 운동이 세션 no의 k번째(0부터) 운동이고, 그 세션의 하체 단계가 stage.
  //       시작 무게(main.dl, acc[].w)는 이 세션의 무게. acc[id]에는 보조 종목의 단계(step·n)를 따로 둘 수 있다.
  // restFrom: 오래 쉬면 처음부터 다시 하는 규칙을 이 날부터 적용한다 (규칙이 생기기 전에 한 기록은 그대로).
  const CATALOG = [
    { id: 'lat', name: '랫풀다운', part: '등', day: 'D', mode: 'stack', w: 23, prog: 'w', reps: 3, ladder: [3, 4, 5], sets: 3, rest: '3~5분', inc: 'pct', incV: 5 },
    { id: 'curl', name: '덤벨컬', part: '이두', day: 'D', mode: 'dumbbell', w: 3, prog: 'w', reps: 5, ladder: [5, 6, 7], sets: 3, rest: '2분', inc: 'kg', incV: 1 },
    { id: 'ohp', name: 'OHP', part: '어깨', day: 'D', mode: 'fixedbar', w: 10, prog: 'w', reps: 5, ladder: [5, 7, 9], sets: 3, rest: '3~5분', inc: 'pct', incV: 5 },
    { id: 'press', name: '덤벨프레스', part: '가슴', day: 'S', mode: 'dumbbell', w: 7, prog: 'w', reps: 3, ladder: [3, 4, 5], sets: 3, rest: '3~5분', inc: 'kg', incV: 1 },
    { id: 'tri', name: '머신 트라이셉스 익스텐션', part: '삼두', day: 'S', mode: 'stack', w: null, prog: 'w', reps: 5, ladder: [5, 6, 7], sets: 3, rest: '2분', inc: 'kg', incV: 1 },
    { id: 'side', name: '사이드 레터럴 레이즈', part: '어깨', day: 'S', mode: 'dumbbell', w: 2, prog: 'w', reps: 10, ladder: [10, 11, 12], sets: 3, rest: '1분', inc: 'kg', incV: 1 },
    { id: 'rear', name: '벤트오버 레터럴 레이즈', part: '후면 어깨', day: 'S', mode: 'dumbbell', w: 2, prog: 'w', reps: 10, ladder: [10, 11, 12], sets: 3, rest: '1분', inc: 'kg', incV: 1 },
  ];
  // 처음 고를 때·종목 추가할 때 고를 수 있는 종목 (기본 루틴에 없는 것)
  const EXTRA = [
    { id: 'bench', name: '바벨 벤치프레스', part: '가슴', day: 'S', mode: 'barbell', w: 20, prog: 'w', reps: 3, ladder: [3, 4, 5], sets: 3, rest: '3~5분', inc: 'pct', incV: 5 },
    { id: 'row', name: '바벨 로우', part: '등', day: 'D', mode: 'barbell', w: 20, prog: 'w', reps: 5, ladder: [5, 6, 7], sets: 3, rest: '3분', inc: 'pct', incV: 5 },
    { id: 'pullup', name: '풀업', part: '등', day: 'D', mode: 'band', w: null, prog: 'r', reps: 5, ladder: [3, 4, 5], sets: 3, rest: '3분', inc: 'pct', incV: 5 },
    { id: 'wpull', name: '중량 풀업', part: '등', day: 'D', mode: 'chain', w: 5, prog: 'w', reps: 3, ladder: [3, 4, 5], sets: 3, rest: '3분', inc: 'pct', incV: 5 },
    { id: 'lying', name: '라잉 트라이셉스 익스텐션', part: '삼두', day: 'S', mode: 'plate', w: 5, prog: 'w', reps: 8, ladder: [8, 10, 12], sets: 3, rest: '2분', inc: 'kg', incV: 1 },
    { id: 'legext', name: '레그 익스텐션', part: '하체', day: 'S', mode: 'stack', w: 20, prog: 'w', reps: 8, ladder: [8, 10, 12], sets: 3, rest: '2분', inc: 'pct', incV: 5 },
  ];
  const accDefaults = (o) => Object.assign({ stack: [], bands: [], from: 1, chg: [] }, JSON.parse(JSON.stringify(o)));
  function defaultGear() {
    return {
      db: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
      bars: [10, 15, 20, 25, 30, 35, 40],
      one: [1.25, 2.5, 5, 10, 15, 20],
      bands: ['1번밴드', '2번밴드', '3번밴드'],
    };
  }
  function defaultConfig(today) {
    return {
      cv: 3,
      startDate: today,
      restFrom: today,
      from: { no: 1, k: 0, stage: 1, acc: {} },
      plates: [1.25],
      gear: defaultGear(),
      main: { dl: 40, sq: null, ratio: 1.2, pct: 5, inc: { dl: 'pct', sq: 'pct' }, ichg: [], prog: 'r', reps: 5, ladder: [3, 4, 5], sets: 3, rest: '5~8분' },
      acc: CATALOG.map(accDefaults),
    };
  }

  // 예전 판으로 저장된 설정을 지금 규칙으로 옮긴다.
  // 첫 판(cv 없음): 고정 쉬는 요일·표시 단위 없앰, 경량원판 추가.
  // 둘째 판(cv 2): 기구(equip)·저중량 규칙(light)·자동 전환(sw)을 훈련방식(mode)·횟수 단계(ladder)로 바꾼다.
  //   저중량 규칙 종목 → 일체형 바벨 5·7·9회, 머신·케이블 → 머신 무게추, 그 밖의 종목은 n·n+1·n+2회.
  //   이미 전환한 상태로 시작한 종목(from.acc[id].phase)은 바벨 종목으로 시작한다. 자동 전환은 없애고, 바꿀 때는 훈련방식을 바꾼다.
  function migrate(cfg) {
    if (!(cfg.cv >= 2)) {
      cfg.acc = (cfg.acc || []).map((a) => Object.assign({ sw: null }, a));
      if (!Array.isArray(cfg.plates)) cfg.plates = [0.5, 1];
      delete cfg.trainDays;
      delete cfg.roundTo;
      cfg.cv = 2;
    }
    if (cfg.cv >= 3) return cfg;
    const from = (cfg.from && cfg.from.acc) || {};
    cfg.acc = (cfg.acc || []).map((a) => {
      const def = CATALOG.find((x) => x.id === a.id);
      const b = Object.assign({}, a);
      const equip = a.equip || (def ? (def.mode === 'stack' ? 'machine' : def.mode === 'fixedbar' ? 'barbell' : def.mode) : 'dumbbell');
      // 저중량 규칙은 20kg 미만일 때만이었다 (20kg 이상으로 시작했으면 이미 일반 바벨).
      const light = a.light && a.w != null && Number(a.w) < 20;
      b.mode = light && equip === 'barbell' ? 'fixedbar' : equip === 'machine' ? 'stack' : equip === 'barbell' ? 'barbell' : 'dumbbell';
      b.prog = 'w';
      const r = Math.max(1, Math.round(Number(a.reps)) || 5);
      b.ladder = light ? [5, 7, 9] : [r, r + 1, r + 2];
      if (a.sw && from[a.id] && from[a.id].phase) { b.name = a.sw.name || b.name; b.mode = 'barbell'; b.inc = a.sw.inc; b.incV = a.sw.incV; }
      if (a.id === 'tri' && /^케이블 트라이셉스 익스텐션$/.test(a.name)) b.name = '머신 트라이셉스 익스텐션';
      delete b.equip; delete b.light; delete b.sw;
      return accDefaults(b);
    });
    for (const o of Object.values(from)) if (o) { delete o.phase; delete o.done; }
    cfg.gear = defaultGear();
    cfg.main = Object.assign({ prog: 'r', ladder: [3, 4, 5] }, cfg.main);
    cfg.cv = 3;
    return cfg;
  }

  // ---------- 무게 ----------
  const EPS = 1e-9;
  const gearList = (cfg, mode) => {
    const key = MODES[mode] && MODES[mode].list;
    return key ? ((cfg.gear && cfg.gear[key]) || []).slice().sort((x, y) => x - y) : [];
  };
  // 무게 w에서 k칸 오르내린 무게. 목록 방식은 가진 무게 안에서 다음 무게(끝이면 그대로), cont 방식은 %·kg.
  function stepW(cfg, a, mode, w, k) {
    if (w == null || !k) return w;
    if (MODES[mode] && MODES[mode].list) {
      const list = gearList(cfg, mode);
      if (!list.length) return w;
      let i = -1;
      list.forEach((x, j) => { if (x <= w + EPS) i = j; });
      if (k < 0 && (i < 0 || Math.abs(list[i] - w) > EPS)) i += 1;   // 목록에 없는 무게면 바로 위 칸에서 센다
      const x = list[Math.max(0, Math.min(list.length - 1, i + k))];
      // 목록 밖(가장 무거운 것보다 무겁거나 가장 가벼운 것보다 가벼운) 무게는 반대쪽으로 가지 않고 그대로
      return k > 0 ? Math.max(w, x) : Math.min(w, x);
    }
    return a.inc === 'kg' ? Math.max(0.1, w + k * a.incV) : w * Math.pow(1 + a.incV / 100, k);
  }
  const isTop = (cfg, mode, w) => {
    const list = gearList(cfg, mode);
    return !!(MODES[mode] && MODES[mode].list && list.length && w != null && w >= list[list.length - 1] - EPS);
  };
  // 무게 고정일 때의 횟수 단계
  const ladderOf = (x) => (Array.isArray(x.ladder) && x.ladder.length ? x.ladder : [x.reps || 5]);
  function ladderReps(x, step) {
    const lad = ladderOf(x);
    return step >= 0 ? lad[Math.min(step, lad.length - 1)] : Math.max(1, lad[0] + step);
  }
  // 보조 종목 사다리의 마지막 칸 번호: 횟수 고정은 무게 3단계, 무게 고정은 횟수 단계 수.
  const accTop = (a) => (a.prog === 'r' ? ACC_TOP : ladderOf(a).length - 1);

  // ---------- 하체 증량 방식 ----------
  // 데드리프트·스쿼트마다 'pct'(main.pct% 씩) 또는 kg 숫자(그만큼씩, 고를 수 있는 값은 MAIN_KG). main.inc가 처음 방식이고,
  // ichg = 기록 중에 바꾼 내역 [{no, id, inc}]: 세션 no부터 새 방식 (그 앞 세션의 무게에서 새 방식으로 오르내린다).
  const LIFTS = ['dl', 'sq'];
  const MAIN_KG = [5, 6];
  // 'pct' 또는 kg 숫자로. 예전 판의 'kg'는 main.kg(없으면 5kg).
  const incOf = (cfg, v) => (v === 'kg' ? (cfg.main.kg > 0 ? cfg.main.kg : 5) : Number(v) > 0 ? Number(v) : 'pct');
  function mainInc(cfg, id, no) {
    let v = incOf(cfg, cfg.main.inc && cfg.main.inc[id]);
    for (const c of cfg.main.ichg || []) if (c.id === id && c.no <= no) v = incOf(cfg, c.inc);
    return v;
  }
  // 기준점 an(level l에서 무게 w, 증량 방식 i)에서 level까지 오르내린 무게
  const liftW = (cfg, an, level) => (an.i !== 'pct'
    ? Math.max(1, an.w + an.i * (level - an.l))
    : an.w * Math.pow(1 + cfg.main.pct / 100, level - an.l));
  // 스쿼트 시작 무게: 따로 넣었으면(main.sq) 그 무게, 비워 두면 추천 무게(데드리프트 ÷ ratio)
  const sqRec = (cfg) => cfg.main.dl / cfg.main.ratio;
  const sqStart = (cfg) => (cfg.main.sq > 0 ? cfg.main.sq : sqRec(cfg));
  // 시작 지점(level 0)의 기준점: 데드리프트·스쿼트 시작 무게
  const mainAnchors = (cfg, no) => ({
    dl: { l: 0, w: cfg.main.dl, i: mainInc(cfg, 'dl', no) },
    sq: { l: 0, w: sqStart(cfg), i: mainInc(cfg, 'sq', no) },
  });
  // 세션 no로 넘어갈 때 그 세션부터 증량 방식이 바뀌면, 방금 한 세션(st)의 무게를 기준점으로 잡는다.
  function rebaseMain(cfg, st, no) {
    const an = st.an || mainAnchors(cfg, 1);
    const out = Object.assign({}, an);
    for (const id of LIFTS) {
      const i = mainInc(cfg, id, no);
      if (i !== an[id].i) out[id] = { l: st.level, w: liftW(cfg, an[id], st.level), i };
    }
    return out;
  }

  // ---------- 상태 머신 ----------
  // main.level: 데드리프트 = 시작무게 × 1.05^level.
  //   횟수 고정(prog r): 묶음 = level start..start+3, 4번째(최고 중량)가 "4단계". 무게 고정(prog w): step = 횟수 단계, 끝을 성공하면 level+1.
  // acc.step: 사다리 위치(실패하면 음수까지 내려감). 마지막 칸을 성공하면 다음 세션에 한 칸 올린 무게로 첫 칸부터.
  const toInt = (v, lo, hi, dflt) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  function startPoint(cfg) {
    const f = (cfg && cfg.from) || {};
    return {
      no: toInt(f.no, 1, 9999, 1), k: toInt(f.k, 0, SLOTS - 1, 0), stage: toInt(f.stage, 1, 20, 1),
      acc: f.acc && typeof f.acc === 'object' ? f.acc : {},
    };
  }
  const mainTop = (cfg) => (cfg.main.prog === 'w' ? ladderOf(cfg.main).length : MAIN_STAGES);
  // 상체·팔이 쉬는 하체 단계 (횟수 고정은 4단계, 무게 고정은 횟수 단계가 3개 이상일 때 마지막 단계, 없으면 0)
  const restStage = (cfg) => (cfg.main.prog === 'w' ? (ladderOf(cfg.main).length >= 3 ? ladderOf(cfg.main).length : 0) : MAIN_STAGES);
  // 보조 종목 사다리의 기본 위치는 하체 단계와 나란히 간다. 상체·팔이 쉬는 하체 단계 세션 다음은 새 무게의 첫 칸.
  function accAt(stage, a, rest = MAIN_STAGES) {
    const top = a ? accTop(a) : ACC_TOP;
    return { step: rest && stage >= rest ? 0 : Math.min(top, stage - 1) };
  }
  // 그 종목의 세션 no에 쓰는 훈련방식 구간 (기록 중에 바꾼 내역 chg 중 no 이하의 마지막, 없으면 처음 설정)
  function segAt(a, no) {
    let seg = { no: 1, mode: a.mode, w: a.w, name: a.name };
    for (const c of a.chg || []) if (c.no <= no && c.no >= seg.no) seg = { no: c.no, mode: c.mode, w: c.w, name: c.name || a.name };
    return seg;
  }
  const freshAcc = (seg) => ({ w: seg.w == null ? null : seg.w, mode: seg.mode, name: seg.name, n: 0, step: 0, fail: false });

  function initState(cfg) {
    const sp = startPoint(cfg);
    const acc = {};
    for (const a of cfg.acc) {
      const o = Object.assign(accAt((a.from || 1) > sp.no ? 1 : sp.stage, a, restStage(cfg)), sp.acc[a.id] || {});
      const seg = segAt(a, sp.no);
      // 훈련방식을 바꾼 구간에서 시작하면 그 구간의 시작 무게 대신 시작 지점에 넣은 무게(from.acc[id].w)를 쓴다.
      if (seg.no > 1 && seg.mode !== 'band' && Number(o.w) > 0) seg.w = Number(o.w);
      acc[a.id] = Object.assign(freshAcc(seg), { n: toInt(o.n, 0, 999, 0), step: toInt(o.step, -9, accTop(a), 0) });
    }
    const top = mainTop(cfg);
    const stage = Math.min(sp.stage, top);
    const bundle = Math.max(1, Math.floor((sp.no - stage) / top) + 1);
    return { main: { level: 0, start: 1 - stage, step: stage - 1, bundle, fail: false, an: mainAnchors(cfg, sp.no) }, acc };
  }

  function mainPresc(cfg, m) {
    const an = m.an || mainAnchors(cfg, 1);
    const base = { dl: liftW(cfg, an.dl, m.level), sq: liftW(cfg, an.sq, m.level), level: m.level, bundle: m.bundle, retry: m.fail };
    if (cfg.main.prog === 'w') {
      const n = ladderOf(cfg.main).length;
      return Object.assign(base, { stage: m.step + 1, top: n >= 3 && m.step === n - 1, reps: ladderReps(cfg.main, m.step) });
    }
    return Object.assign(base, { stage: m.level - m.start + 1, top: m.level === m.start + MAIN_STAGES - 1, reps: cfg.main.reps });
  }
  // 보조 종목의 세션 처방. off = 아직 들어가지 않은 종목, skip = 하체가 마지막 단계(횟수 고정은 4단계)인 세션이라 쉼.
  function accPresc(cfg, a, s, no, top) {
    if (!s || no < (a.from || 1)) return { off: true };
    if (top) return { skip: true };
    const base = { name: s.name, mode: s.mode, inc: a.inc, incV: a.incV, step: s.step, retry: s.fail, prog: a.prog };
    if (s.mode === 'band') return Object.assign(base, { band: true, w: null, n: 0, reps: a.reps, bands: (a.bands || []).slice() });
    if (a.prog === 'r') {
      const w = stepW(cfg, a, s.mode, s.w, s.step);
      return Object.assign(base, { w, n: s.n + s.step, reps: a.reps, maxed: isTop(cfg, s.mode, w) });
    }
    return Object.assign(base, { w: s.w, n: s.n, reps: ladderReps(a, s.step), maxed: isTop(cfg, s.mode, s.w) });
  }
  function prescribe(cfg, st, no) {
    const main = mainPresc(cfg, st.main);
    const acc = {};
    for (const a of cfg.acc) acc[a.id] = accPresc(cfg, a, st.acc[a.id], no, main.top);
    return { no, main, acc };
  }

  // entries: 세션의 운동일들 [{type:'D'|'S', res:{종목id: true|false}}]. 기록이 없는 결과는 성공으로 본다.
  function evaluate(cfg, presc, entries) {
    let main = true;
    const acc = {};
    for (const a of cfg.acc) { const p = presc.acc[a.id]; acc[a.id] = p.off || p.skip ? null : true; }
    for (const e of entries) {
      const r = e.res || {};
      if (r[e.type === 'D' ? 'dl' : 'sq'] === false) main = false;
      for (const a of cfg.acc) if (a.day === e.type && acc[a.id] !== null && r[a.id] === false) acc[a.id] = false;
    }
    return { main, acc };
  }

  // 한 단계 낮춘 상태 (실패했을 때·오래 쉬었을 때). 하체: 횟수 고정은 무게 한 단계(−5%), 무게 고정은 횟수 한 단계.
  function lowerMain(cfg, st) {
    const m = Object.assign({}, st);
    if (cfg.main.prog === 'w') m.step = Math.max(-9, m.step - 1); else m.level -= 1;
    return m;
  }
  // 보조 종목: 사다리 한 칸 아래. 한 칸 낮춰도 무게·횟수가 같으면(가진 무게 중 가장 가벼움, 1회) 그 칸 그대로.
  function lowerAcc(cfg, a, st) {
    const s = Object.assign({}, st);
    const at = (k) => (a.prog === 'r' ? stepW(cfg, a, s.mode, s.w, k) : ladderReps(a, k));
    const same = s.w != null || a.prog !== 'r' ? at(s.step - 1) === at(s.step) : false;
    if (!same) s.step = Math.max(-9, s.step - 1);
    return s;
  }
  // 하체 한 세션의 결과로 다음 상태(다음 세션 no). bundleDone = 묶음을 마침.
  function advanceMain(cfg, st, ok, no) {
    if (!ok) return { m: Object.assign(lowerMain(cfg, st), { fail: true, an: rebaseMain(cfg, st, no) }), bundleDone: false };
    const m = Object.assign({}, st, { fail: false, an: rebaseMain(cfg, st, no) });
    let bundleDone = false;
    if (cfg.main.prog === 'w') {
      if (m.step >= ladderOf(cfg.main).length - 1) { m.level += 1; m.step = 0; m.bundle += 1; bundleDone = true; } else m.step += 1;
    } else if (m.level === m.start + MAIN_STAGES - 1) { m.start += 1; m.level = m.start; m.bundle += 1; bundleDone = true; }
    else m.level += 1;
    return { m, bundleDone };
  }
  // 보조 종목 한 세션의 결과(r: true·false, 쉰 세션은 null)로 다음 상태. 고무밴드는 기록만 하고 바뀌지 않는다.
  // 사다리 마지막 칸을 성공하면 한 칸 올린 무게로 첫 칸부터 (횟수 고정: 무게 3단계 중 2단계 무게부터). 실패하면 한 칸 낮춰 다시.
  function advanceAcc(cfg, a, st, r) {
    if (r == null || st.mode === 'band') return Object.assign({}, st);
    if (!r) return Object.assign(lowerAcc(cfg, a, st), { fail: true });
    const s = Object.assign({}, st, { fail: false });
    if (s.step < accTop(a)) s.step += 1;
    else { s.w = stepW(cfg, a, s.mode, s.w, 1); s.n += 1; s.step = 0; }
    return s;
  }
  function advance(cfg, st, out, no) {
    const { m } = advanceMain(cfg, st.main, out.main, no);
    const acc = {};
    for (const a of cfg.acc) acc[a.id] = st.acc[a.id] && advanceAcc(cfg, a, st.acc[a.id], out.acc[a.id]);
    return { main: m, acc };
  }
  // 세션 no를 열 때 그 세션부터 훈련방식을 바꿨으면 새 방식·무게로 다시 시작한다.
  function openState(a, st, no) {
    const c = (a.chg || []).filter((x) => x.no === no).pop();
    return c ? freshAcc({ mode: c.mode, w: c.w, name: c.name || a.name }) : st;
  }

  const slotType = (i) => (i % 2 === 0 ? 'D' : 'S');

  const ALL_OK = [{ type: 'D', res: {} }, { type: 'S', res: {} }];

  // 지금 시작 지점에서 모든 세션을 성공한다고 보고 세션 no의 상태·처방을 구한다. 시작 세션보다 앞이면 null.
  // 이미 하던 루틴을 이어서 시작할 때 무게·횟수를 미리 채우는 데 쓴다.
  function projectTo(cfg, no) {
    const sp = startPoint(cfg);
    if (!(no >= sp.no)) return null;
    let st = initState(cfg);
    for (let n = sp.no; n < no; n++) {
      st = advance(cfg, st, evaluate(cfg, prescribe(cfg, st, n), ALL_OK), n + 1);
      for (const a of cfg.acc) st.acc[a.id] = openState(a, st.acc[a.id], n + 1);
    }
    return { state: st, presc: prescribe(cfg, st, no) };
  }

  // ---------- 진행 엔진 (기록 → 달력·처방) ----------
  // 하체(데드리프트·스쿼트)는 칸 g를 따라 D·S를 번갈아 가고 6칸이 한 세션이다. g = 시작 세션의 첫 운동을 0으로 센 칸 번호.
  // 상체·팔은 자기 하체 날(D 또는 S)에 붙어서 세션마다 3번씩 하고, 진도는 종목마다 따로 센다.
  // 기록에서 고르지 않은 종목은 하지 않은 것으로 보고 다음 같은 날로 밀린다. 하체를 안 하면 다음 날도 같은 하체 날이다.
  // 상체·팔은 하체보다 앞서지 못한다: 다음 차례 칸이 오늘 하체 칸보다 뒤면 그날은 쉰다(붙어서 가느라 생긴 휴식).
  // 세션 6번째 운동 다음 날은 정식 휴식. 단, 그 세션을 하는 동안 REST_SKIP일 이상 쉬었다면 건너뛴다.
  // 휴식일에도 기록하면 운동한 날로 계산한다.
  // 기록 형식: {d, res:{종목id: true|false}, p:1}. p가 없는 예전 기록은 고르지 않은 종목을 성공으로 본다.
  //   w:{종목id: 무게} = 그날 계획과 다른 무게로 했으면 실제로 든 무게.
  // 무게를 바꿔서 했으면 그 무게를 기준으로 그 세션의 남은 운동과 다음 세션을 계산한다. 단, 계획보다 무겁게 해서 실패했으면
  //   계획 무게가 기준이다 (그 무게로 실패 처리). 계획보다 가볍게 했으면 성공·실패 모두 바꾼 무게가 기준.
  // 오래 쉬면 처음부터: 한 종목을 GAP1일 이상 쉬면(마지막으로 한 다음 날부터 다시 하는 날 전날까지 센 날 수) 성공·실패와 상관없이
  //   그 종목의 진행 중인 세션을 처음부터 다시 하고 한 단계 낮춘다. GAP2일 이상이면 한 단계 더 (한 번 쉬는 동안 두 단계까지).
  //   하체는 데드리프트·스쿼트 중 더 오래 쉰 쪽으로 세고, 세션(6회)을 데드리프트부터 다시 한다. 둘은 같이 낮아진다.
  //   상체·팔은 종목마다 따로 센다. 하체가 마지막 단계라 상체·팔이 쉬는 세션은 쉬는 날로 세지 않고, 고무밴드는 낮추지 않는다.
  //   그 종목을 한 번도 하지 않았으면 세지 않는다. cfg.restFrom 이전 날에는 적용하지 않는다.
  const REST_SKIP = 2;
  const accSlot = (type, j) => SLOTS * Math.floor(j / 3) + 2 * (j % 3) + (type === 'S' ? 1 : 0);

  function mainRow(cfg, mp, type) {
    return {
      id: type === 'D' ? 'dl' : 'sq', name: type === 'D' ? '데드리프트' : '스쿼트', part: '하체', main: true, mode: 'barbell',
      w: type === 'D' ? mp.dl : mp.sq, n: 0, reps: mp.reps, sets: cfg.main.sets, rest: cfg.main.rest, retry: mp.retry,
    };
  }
  function accRow(a, p) {
    if (p.skip) return { id: a.id, name: a.name, part: a.part, skip: true };
    return {
      id: a.id, name: p.name, part: a.part, mode: p.mode, w: p.w, n: p.n, inc: p.inc, incV: p.incV, prog: p.prog,
      reps: p.reps, sets: a.sets, rest: a.rest, retry: p.retry, maxed: p.maxed, band: p.band, bands: p.bands, stack: a.stack || [],
    };
  }

  // ---------- 기록 고정 ----------
  // 기록마다 그날의 상태·처방을 s에 남긴다: { main: 하체 세션 상태, 종목id: 그 종목 세션 상태 } (상체·팔은 그날 한 종목만).
  //   하체 {l level, s start, t step, b bundle, f 재도전, top 상체·팔이 쉬는 세션, k 진행 방식, W 데드리프트 무게, Q 스쿼트 무게, r 횟수, e 세트}
  //   종목 {m 훈련방식, w 기준 무게, t step, n 증량 횟수, k 진행 방식, W 든 무게, r 횟수, e 세트, f 재도전, 무게 생략이면 i·v 증량 방식·값}
  // 다시 계산할 때 세션마다 첫 기록에 남은 상태로 맞추고, 기록한 날은 그때 무게·횟수·세트를 그대로 보여준다.
  // 그래서 진행 방식·횟수 단계·장비 무게·증량 값·횟수·세트를 바꿔도 지난 기록은 그대로이고, 그다음부터 지금 설정으로 계산한다.
  const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
  function mainSnap(cfg, ms) {
    const m = ms.state, p = ms.presc;
    return { l: m.level, s: m.start, t: m.step, b: m.bundle, f: m.fail ? 1 : 0, top: p.top ? 1 : 0, k: cfg.main.prog, W: r4(p.dl), Q: r4(p.sq), r: p.reps, e: cfg.main.sets };
  }
  function accSnap(a, st, p) {
    const o = { m: st.mode, w: r4(st.w), t: st.step, n: st.n, k: a.prog, W: r4(p.w), r: p.reps, e: a.sets, f: st.fail ? 1 : 0 };
    if (p.w == null && st.mode !== 'band') { o.i = p.inc; o.v = p.incV; }   // 무게 생략(+1kg처럼 표시)은 그때 증량 단위도
    return o;
  }
  // 남긴 하체 상태를 지금 진행 방식으로. 진행 방식을 바꿨으면 그 세션을 성공했을 때 다음 세션은 한 칸 무거운 무게가 되게 맞춘다:
  // 횟수 고정 → 무게 고정은 그 무게의 마지막 횟수(다음은 증량해 첫 횟수), 무게 고정 → 횟수 고정은 그 무게를 1단계(다음은 2단계).
  function mainFromSnap(cfg, sn) {
    const st = { level: sn.l, start: sn.s, step: sn.t, bundle: sn.b, fail: !!sn.f };
    const n = ladderOf(cfg.main).length;
    if (sn.k !== cfg.main.prog) { if (cfg.main.prog === 'w') st.step = n - 1; else st.start = st.level; }
    if (cfg.main.prog === 'w') st.step = Math.min(st.step, n - 1);
    return st;
  }
  // 남긴 종목 상태를 지금 설정으로. 진행 방식을 바꿨으면 그때 든 무게에서 하체와 같은 식으로 맞춘다
  // (횟수 고정 → 무게 고정은 그 무게의 마지막 횟수, 무게 고정 → 횟수 고정은 그 무게를 첫 칸).
  // 횟수 고정은 그때 든 무게가 지금 장비 무게·증량 값으로도 같은 칸이 되게 기준 무게를 다시 잡는다 (안 되면 그 무게를 첫 칸으로).
  function accFromSnap(cfg, a, cur, sn) {
    const st = Object.assign({}, cur, { mode: sn.m, w: sn.w, n: sn.n, step: sn.t, fail: !!sn.f });
    if (sn.m === 'band') return st;
    if (sn.k !== a.prog) {
      st.w = sn.W; st.step = a.prog === 'w' ? accTop(a) : 0;
      if (sn.k === 'r') st.n = sn.n + sn.t;
    } else if (a.prog === 'r' && sn.W != null) {
      const base = stepW(cfg, a, sn.m, sn.W, -sn.t);
      if (Math.abs(stepW(cfg, a, sn.m, base, sn.t) - sn.W) < 0.01) st.w = base;
      else { st.w = sn.W; st.step = 0; }
    }
    st.step = Math.min(st.step, accTop(a));
    return st;
  }
  // 그날 한 종목의 상태 (하체는 늘). done(row) = 그날 한 종목인가.
  function snapOf(rows, done) {
    const s = {};
    for (const r of rows) if (r.snap && (r.main || (r.avail === 'ok' && done(r)))) s[r.main ? 'main' : r.id] = r.snap;
    return s;
  }
  // 기록에 그날의 상태를 남긴다. from 이후 기록은 남긴 것을 지우고 지금 설정으로 다시 남긴다(지난 기록을 고치거나 시작 지점을 옮길 때).
  // from을 생략하면 아직 남기지 않은 기록(예전 판에서 한 기록)만 채운다.
  function snapLogs(cfg, logs, from = logs.length) {
    for (let li = Math.max(0, from); li < logs.length; li++) delete logs[li].s;
    if (logs.every((l) => l.s)) return logs;
    const sim = simulate(cfg, logs, null, { until: -Infinity });
    for (const e of sim.days.values()) if (e.kind === 'log' && !logs[e.li].s) logs[e.li].s = snapOf(e.rows, (r) => r.result != null);
    return logs;
  }

  // opts.until: 이 날까지 예상(모두 성공 가정)을 채운다. opts.minSessions: 하체·모든 보조 종목이 적어도 이만큼 세션을 갖도록 채운다.
  const jStart = (type, k) => (type === 'D' ? Math.ceil(k / 2) : Math.floor(k / 2));   // 세션의 k번째 운동까지 지난 그 날 차례 수
  function simulate(cfg, logs, today, opts = {}) {
    const sp = startPoint(cfg);
    const init = initState(cfg);
    const rr = cfg.restFrom ? toNum(cfg.restFrom) : -Infinity;
    // R일 쉬고 day에 하면 이번에 쉬는 동안 낮출 단계 수
    const gapDrops = (R, day) => (day < rr ? 0 : R >= GAP2 ? 2 : R >= GAP1 ? 1 : 0);
    // 하체가 쉬는 동안: 데드리프트·스쿼트를 마지막으로 한 날, 지금 세는 쉬는 기간의 시작(anchor)과 그동안 낮춘 단계 수
    const MG = { D: null, S: null, anchor: null, dropped: 0 };
    const S = [];
    const openMain = (i, m) => {
      S[i] = { no: sp.no + i, i, state: m, presc: mainPresc(cfg, m), first: i === 0 ? sp.k : 0, n: i === 0 ? sp.k : 0, res: [],
        done: false, out: null, bundleDone: false, firstDay: null, lastDay: null, rests: 0, restSkip: false, snap: null };
    };
    // 하체 세션을 열자마자 그 세션 첫 기록에 남은 상태로 맞춘다 (상체·팔이 쉬는 세션인지도 그때대로).
    const anchorMain = (sn) => {
      const cur = S[S.length - 1];
      if (!sn || cur.snap || cur.res.length) return;
      cur.snap = sn;
      cur.state = Object.assign(mainFromSnap(cfg, sn), { an: cur.state.an });
      cur.presc = Object.assign(mainPresc(cfg, cur.state), { top: !!sn.top });
    };
    const mainSnapOf = (li) => (logs[li] && logs[li].s && logs[li].s.main) || null;
    openMain(0, init.main);
    anchorMain(mainSnapOf(0));
    const openAcc = (X, i, st) => { X.sess[i] = { no: sp.no + i, i, state: i ? openState(X.a, st, sp.no + i) : st, presc: null, res: [], done: false, out: null, snap: null }; };
    // 보조 종목 X: i 세션, j 지금까지 한 차례 수, last 마지막으로 한 날(쉬는 세션 동안은 하체를 한 날), anchor·dropped는 하체와 같다.
    const A = cfg.acc.map((a) => {
      const X = { a, i: 0, j: jStart(a.day, sp.k), sess: [], last: null, anchor: null, dropped: 0 };
      openAcc(X, 0, init.acc[a.id]);
      return X;
    });
    const accP = (X, i) => { const s = X.sess[i]; if (!s.presc) s.presc = accPresc(cfg, X.a, s.state, s.no, S[i].presc.top); return s.presc; };
    // 보조 종목이 세션 몫(3번)을 다 했거나 쉬는 세션이면, 그 세션의 하체가 끝난 뒤 다음 세션으로 넘긴다.
    // 세션 중간에 넣은 종목(fromK = 넣을 때 그 세션에서 지난 운동 수)은 그 세션의 남은 차례만 한다.
    function settle(X) {
      for (;;) {
        const i = X.i, s = X.sess[i];
        const p = accP(X, i);
        if (p.off || p.skip) X.j = Math.max(X.j, 3 * (i + 1));
        else if (X.a.fromK > 0 && s.no === X.a.from && !s.full) X.j = Math.max(X.j, 3 * i + jStart(X.a.day, X.a.fromK));
        if (X.j < 3 * (i + 1) || !S[i].done) return;
        s.done = true;
        s.out = p.off || p.skip ? null : !s.res.includes(false);
        openAcc(X, i + 1, advanceAcc(cfg, X.a, s.state, s.out));
        X.i = i + 1;
      }
    }
    let g = sp.k;
    // 오래 쉬었으면 하체 세션을 처음부터(데드리프트부터) 다시 하고 낮춘다. 기록한 날이면 그날 남긴 상태(sn)로 맞춘다.
    function restMain(day, sn) {
      const seen = [MG.D, MG.S].filter((x) => x != null);
      if (!seen.length) return;
      const from = Math.min(...seen);
      if (from !== MG.anchor) { MG.anchor = from; MG.dropped = 0; }
      const R = day - from - 1, t = gapDrops(R, day);
      if (t <= MG.dropped) return;
      const cur = S[S.length - 1];
      let st = Object.assign({}, cur.state, { fail: false });
      for (let k = MG.dropped; k < t; k++) st = lowerMain(cfg, st);
      g = SLOTS * cur.i;
      Object.assign(cur, { state: st, presc: mainPresc(cfg, st), first: 0, n: 0, res: [], firstDay: null, lastDay: null, rests: 0, snap: null,
        reset: { day, R, drops: (cur.reset ? cur.reset.drops : 0) + t - MG.dropped } });
      MG.dropped = t;
      // 같은 세션의 상체·팔도 그 세션을 처음부터(3번) 다시 한다. 무게는 그 종목을 쉰 날 수대로 따로 낮춘다.
      // 처방도 다시 구한다 (하체가 마지막 단계에서 내려오면 이번 세션은 쉬지 않고 한다).
      for (const X of A) {
        if (X.i !== cur.i) continue;
        const s = X.sess[X.i];
        Object.assign(s, { presc: null, past: (s.past || 0) + s.res.length, res: [], snap: null, full: true });
        X.j = 3 * X.i;
      }
      anchorMain(sn);
    }
    // 보조 종목 X를 오래 쉬었으면 그 종목의 진행 중인 세션을 처음부터(3번) 다시 하고 낮춘다. 낮췄으면 true.
    function restAcc(X, day) {
      const s = X.sess[X.i];
      if (X.last == null || s.state.mode === 'band') return false;
      if (X.last !== X.anchor) { X.anchor = X.last; X.dropped = 0; }
      const R = day - X.last - 1, t = gapDrops(R, day);
      if (t <= X.dropped) return false;
      let st = Object.assign({}, s.state, { fail: false });
      for (let k = X.dropped; k < t; k++) st = lowerAcc(cfg, X.a, st);
      X.j = 3 * X.i;
      // past = 처음부터 다시 하느라 지운 기록 수 (그 세션에 이미 한 기록이 있었다는 표시)
      Object.assign(s, { state: st, presc: null, past: (s.past || 0) + s.res.length, res: [], snap: null, full: true,
        reset: { day, R, drops: (s.reset ? s.reset.drops : 0) + t - X.dropped } });
      X.dropped = t;
      return true;
    }
    // 그 날 할 운동: 하체 칸 g의 하체 + 그 날에 붙는 보조 종목들의 다음 차례.
    // avail: ok(오늘 함) · skip(하체가 마지막 단계라 쉼) · wait(하체보다 앞서지 않으려고 쉼). lag = 지난 차례가 밀려서 하는 것.
    // rested = 그 세션을 오래 쉬어서 낮춘 단계 수, restart = 그 날 처음부터 다시 시작했으면 그때 쉰 날 수.
    // snaps: 기록한 날이면 그날 남긴 상태 (그 종목 세션의 첫 기록이면 그 상태로 맞춘다). 행마다 지금 상태(snap)를 붙인다.
    const restOf = (s, day) => ({ rested: s.reset ? s.reset.drops : 0, restart: s.reset && s.reset.day === day ? s.reset.R : 0 });
    function plan(day, snaps) {
      restMain(day, snaps && snaps.main);
      const i = S.length - 1, type = slotType(g);
      const rows = [Object.assign(mainRow(cfg, S[i].presc, type), { avail: 'ok', snap: mainSnap(cfg, S[i]) }, restOf(S[i], day))];
      for (const X of A) {
        if (X.a.day !== type) continue;
        settle(X);
        let p = accP(X, X.i);
        if (p.off) continue;
        if (p.skip) { rows.push(Object.assign(accRow(X.a, p), { avail: 'skip' })); continue; }
        if (restAcc(X, day)) p = accP(X, X.i);
        const at = accSlot(X.a.day, X.j), s = X.sess[X.i];
        const sn = snaps && snaps[X.a.id];
        if (sn && at <= g && !s.res.length && !s.snap) { s.snap = sn; s.state = accFromSnap(cfg, X.a, s.state, sn); s.presc = null; p = accP(X, X.i); }
        rows.push(Object.assign(accRow(X.a, p), { avail: at <= g ? 'ok' : 'wait', lag: at < g, accNo: s.no, snap: accSnap(X.a, s.state, p) }, restOf(s, day)));
      }
      return { g, slot: g, type, no: S[i].no, pos: slotPos(g), main: S[i].presc, rows };
    }
    // 기록한 날은 그때 보여준 무게·횟수·세트·단계를 그대로 보여준다.
    // 예전 기록(Q 없음)의 스쿼트는 데드리프트 ÷ ratio
    const sqOf = (m) => (m.Q != null ? m.Q : m.W / cfg.main.ratio);
    const snapMain = (p, m) => Object.assign({}, p, { dl: m.W, sq: sqOf(m), reps: m.r, bundle: m.b, retry: !!m.f,
      stage: m.k === 'w' ? m.t + 1 : m.l - m.s + 1 });
    function shown(info, sn) {
      if (sn.main && sn.main.W != null) info.main = snapMain(info.main, sn.main);
      for (const r of info.rows) {
        const x = r.main ? sn.main : sn[r.id];
        if (!x || r.avail !== 'ok') continue;
        if (!r.main) { r.w = x.W; r.mode = x.m; if (x.i) { r.inc = x.i; r.incV = x.v; } } else if (x.W != null) r.w = r.id === 'dl' ? x.W : sqOf(x);
        r.reps = x.r; r.sets = x.e;
      }
    }
    // 그날 바꾼 무게(ov)로 한 종목: 보여줄 무게를 바꾸고(plan = 계획 무게), 기준 무게가 달라지면 그 종목의 상태를 그 무게로 맞춘다.
    function overrideW(info, ov) {
      for (const r of info.rows) {
        const w = ov[r.id];
        if (!(w > 0) || r.avail !== 'ok' || typeof r.result !== 'boolean' || r.band || r.w == null) continue;
        const plan = r.w;
        if (Math.abs(w - plan) < 0.005) continue;
        r.plan = plan; r.w = w;
        if (r.main) info.main = Object.assign({}, info.main, { [r.id]: w });
        const basis = w < plan || r.result ? w : plan;
        if (Math.abs(basis - plan) < 0.005) continue;
        if (r.main) {
          const cur = S[S.length - 1], st = cur.state, an = st.an || mainAnchors(cfg, 1);
          cur.state = Object.assign({}, st, { an: Object.assign({}, an, { [r.id]: { l: st.level, w: basis, i: an[r.id].i } }) });
          cur.presc = Object.assign(mainPresc(cfg, cur.state), { top: cur.presc.top });
          continue;
        }
        const X = A.find((x) => x.a.id === r.id), s = X.sess[X.i], st = Object.assign({}, s.state);
        if (X.a.prog === 'r') {
          // 횟수 고정: 지금 칸의 무게가 basis가 되게 기준 무게를 다시 잡는다 (안 되면 basis를 첫 칸으로)
          const base = stepW(cfg, X.a, st.mode, basis, -st.step);
          if (Math.abs(stepW(cfg, X.a, st.mode, base, st.step) - basis) < 0.01) st.w = base; else { st.w = basis; st.step = 0; }
        } else st.w = basis;
        s.state = st; s.presc = null;
      }
    }
    let restDay = null, skipNote = null;
    function apply(d, info, res, legacy, nextMain, ov) {
      const got = (id) => (legacy ? res[id] !== false : typeof res[id] === 'boolean' ? res[id] : null);
      for (const r of info.rows) r.result = r.avail === 'ok' ? got(r.id) : null;
      if (ov) overrideW(info, ov);
      for (const r of info.rows) {
        if (r.main || r.result == null) continue;
        const X = A.find((x) => x.a.id === r.id);
        X.sess[X.i].res.push(r.result);
        X.j += 1;
        X.last = d;
      }
      const mv = info.rows[0].result;
      const cur = S[S.length - 1];
      if (mv != null) {
        MG[info.type] = d;
        // 쉬어서 처음부터 다시 시작한 뒤 첫 하체를 하면 그 쉬는 기간은 데드리프트·스쿼트 모두 끝난 것으로 본다
        // (다음 날 스쿼트가 그동안 쉰 날 수로 또 낮아지지 않게).
        if (MG.dropped) MG.D = MG.S = d;
        // 하체가 마지막 단계라 쉬는 세션 동안 상체·팔은 쉬는 날로 세지 않는다.
        for (const X of A) if (X.last != null && X.i === cur.i && accP(X, X.i).skip) X.last = d;
        if (cur.firstDay == null) cur.firstDay = d;
        cur.lastDay = d;
        cur.res.push(mv);
        cur.n += 1;
        g += 1;
        if (cur.n === SLOTS) {
          cur.done = true;
          cur.out = !cur.res.includes(false);
          const nx = advanceMain(cfg, cur.state, cur.out, cur.no + 1);
          cur.bundleDone = nx.bundleDone;
          cur.restSkip = cur.rests >= REST_SKIP;
          openMain(cur.i + 1, nx.m);
          anchorMain(nextMain);
          restDay = cur.restSkip ? null : d + 1;
          skipNote = cur.restSkip ? d + 1 : null;
        }
      }
      for (const X of A) settle(X);
    }
    const days = new Map();
    const quiet = (d) => {
      const kind = d === restDay ? 'gap' : 'miss';
      days.set(d, { kind });
      const cur = S[S.length - 1];
      if (kind === 'miss' && cur.firstDay != null) cur.rests += 1;
    };
    const start = toNum(cfg.startDate);
    const T = today == null ? -Infinity : toNum(today);
    let d = start, last = null;
    logs.forEach((lg, li) => {
      const ld = toNum(lg.d);
      for (; d < ld; d++) quiet(d);
      const sn = lg.s || null;
      const info = plan(ld, sn);
      // 고무밴드는 기록한 날 쓴 밴드를 남긴다 (설정에서 밴드를 바꿔도 지난 기록은 그대로).
      if (lg.b) for (const r of info.rows) if (r.band && Array.isArray(lg.b[r.id])) r.bands = lg.b[r.id].slice();
      if (sn) shown(info, sn);
      days.set(ld, Object.assign(info, { kind: 'log', li, restSkipped: ld === skipNote }));
      apply(ld, info, lg.res || {}, !lg.p, mainSnapOf(li + 1), lg.w);
      last = ld;
      d = ld + 1;
    });
    const cursor = Math.max(T, start, last == null ? -Infinity : last + 1);
    for (; d < cursor; d++) quiet(d);
    // 다음 운동 날(cursor)에 할 종목마다 지금까지 쉰 날 수 (오래 쉬면 처음부터 다시 하는 규칙 알림용)
    const seenMain = [MG.D, MG.S].filter((x) => x != null);
    const lastOf = new Map([['main', seenMain.length ? Math.min(...seenMain) : null]].concat(A.map((X) => [X.a.id, X.last])));
    const next = plan(cursor);
    const gaps = [];
    for (const r of next.rows) {
      const from = lastOf.get(r.main ? 'main' : r.id);
      if (r.avail !== 'ok' || r.band || from == null) continue;
      const X = r.main ? MG : A.find((x) => x.a.id === r.id);
      gaps.push({ id: r.id, name: r.name, main: !!r.main, rest: cursor - from - 1, dropped: X.dropped, today: !!r.restart });
    }
    const c = S[S.length - 1];
    const cur = { i: c.i, no: c.no, n: c.n, presc: c.presc };
    const real = { main: c.i, acc: Object.fromEntries(A.map((X) => [X.a.id, X.i])) };
    const until = opts.until == null ? cursor + 6 : opts.until;
    const need = opts.minSessions || 0;
    const short = () => S.length < need || A.some((X) => X.sess.length < need);
    for (let guard = 0; (d <= until || short()) && guard < 4000; d++, guard++) {
      if (d === restDay) { days.set(d, { kind: 'gap' }); continue; }
      const info = plan(d);
      const res = {};
      for (const r of info.rows) if (r.avail === 'ok') res[r.id] = true;
      days.set(d, Object.assign(info, { kind: 'plan', restSkipped: d === skipNote }));
      apply(d, info, res, false);
    }
    // 세션 no의 처방(하체 + 보조 종목 세션별). 보조 종목이 아직 그 세션에 이르지 않았으면 pending.
    // 마친 세션은 첫 기록에 남은 무게·횟수를 보여준다.
    function view(no) {
      const i = no - sp.no, s = S[i];
      if (!s) return null;
      const acc = {};
      for (const X of A) {
        const x = X.sess[i];
        if (!x) { acc[X.a.id] = { pending: true }; continue; }
        const p = accP(X, i);
        const rested = { rested: x.reset ? x.reset.drops : 0 };
        acc[X.a.id] = x.snap && x.done && !p.off && !p.skip ? Object.assign({}, p, { w: x.snap.W, reps: x.snap.r, mode: x.snap.m }, x.snap.i ? { inc: x.snap.i, incV: x.snap.v } : {}, rested) : Object.assign({}, p, rested);
      }
      const main = s.snap && s.done && s.snap.W != null ? snapMain(s.presc, s.snap) : s.presc;
      return { no, main: Object.assign({}, main, { rested: s.reset ? s.reset.drops : 0 }), acc };
    }
    return {
      days, today: T, start, cursor, last, k0: sp.k, next, cur, real, view, gaps: { day: cursor, items: gaps },
      main: S, acc: Object.fromEntries(A.map((X) => [X.a.id, X.sess])),
    };
  }
  const timeline = simulate;

  // 하체 세션 목록 (예상 없이 기록까지만). 마지막 원소가 진행 중인(또는 다음) 세션.
  function replay(cfg, logs) {
    const sim = simulate(cfg, logs, null, { until: -Infinity });
    return sim.main.map((s) => ({ no: s.no, first: s.first, done: s.done, out: s.out, presc: sim.view(s.no) }));
  }

  // 그 날짜에 다음 운동을 기록할 수 있는가: 마지막 기록 이후의 오늘·지난 날 (휴식일 포함).
  function canLog(sim, d) {
    const e = sim.days.get(d);
    if (!e || d > sim.today) return false;
    if (sim.last != null && d <= sim.last) return false;
    return e.kind === 'plan' || e.kind === 'miss' || e.kind === 'gap';
  }

  // 칸 번호 → 세션 번호, 세션 안 순서(0~5)
  function slotNo(cfg, g) { return startPoint(cfg).no + Math.floor(g / SLOTS); }
  function slotPos(g) { return ((g % SLOTS) + SLOTS) % SLOTS; }

  // ---------- 경량원판 ----------
  // plates: 가진 경량원판 무게 목록. 같은 무게가 n번 있으면 n쌍(2n장). 2.5kg 원판은 개수 제한 없이 늘 쓸 수 있다.
  // 5kg 단위는 일반 원판으로 끼우고, 나머지를 경량원판과 2.5kg 원판(한 짝도 가능)으로 채운다.
  // 고르는 순서: 목표 무게 이상이면서 가장 가벼운 조합 → (바벨) 양쪽 무게 차이가 작은 조합 → 원판 수가 적은 조합.
  function plateCounts(plates) {
    const m = new Map();
    for (const p of plates || []) if (PLATE_OPTIONS.includes(p)) m.set(p, (m.get(p) || 0) + 1);
    return m;
  }
  // 원판들을 양쪽으로 나눠 무게 차이를 가장 작게 한다 (부분합 DP). [무거운 쪽, 가벼운 쪽, 차이]
  function splitSides(pieces, total) {
    const from = new Map([[0, null]]);
    pieces.forEach((p, j) => {
      for (const s of [...from.keys()]) if (!from.has(s + p)) from.set(s + p, [s, j]);
    });
    let bestS = 0, diff = Infinity;
    for (const s of from.keys()) { const d = Math.abs(total - 2 * s); if (d < diff) { diff = d; bestS = s; } }
    const pick = new Set();
    for (let s = bestS; from.get(s); s = from.get(s)[0]) pick.add(from.get(s)[1]);
    const L = [], R = [];
    pieces.forEach((p, j) => (pick.has(j) ? L : R).push(p));
    return bestS * 2 >= total ? [L, R, diff] : [R, L, diff];
  }
  // 나머지 r(0.01kg 단위)을 kinds([무게, 장수])로 채우는, r 이상이면서 가장 가벼운 조합들.
  function fills(r, kinds) {
    let min = Infinity;
    const combos = [];
    const walk = (i, total, pieces) => {
      if (total > min) return;
      if (total >= r || i === kinds.length) {
        if (total < r) return;
        if (total < min) { min = total; combos.length = 0; }
        combos.push(pieces.slice());
        return;
      }
      const [w, max] = kinds[i];
      for (let c = 0; c <= max; c++) {
        for (let k = 0; k < c; k++) pieces.push(w);
        walk(i + 1, total + c * w, pieces);
        pieces.length -= c;
        if (total + c * w >= r) break;   // 더 끼우면 무거워지기만 한다
      }
    };
    walk(0, 0, []);
    return combos.length ? { min, combos } : null;
  }
  // [무게, 쓸 수 있는 장수]. 2.5kg(한 짝도 가능)과 가진 경량원판(쌍 × 2장).
  const lightKinds = (plates) => [[250, 2]].concat([...plateCounts(plates)].map(([p, n]) => [Math.round(p * 100), 2 * n])
    .filter(([p]) => p > 0 && p < 250).sort((a, b) => b[0] - a[0]));
  const plateMemo = new Map();
  // equip: barbell(양쪽에 나눠 끼움) · machine(한 곳에 올리거나 매닮)
  function plateMath(target, plates, equip) {
    if (!(target > 0) || (equip !== 'barbell' && equip !== 'machine')) return null;
    const key = target + '|' + (plates || []).join(',') + '|' + equip;
    if (plateMemo.has(key)) return plateMemo.get(key);
    const T = Math.round(target * 100);          // 0.01kg 단위 정수로 계산
    const base = Math.floor(T / 500) * 500;
    const r = T - base;
    let result = null;
    if (r > 0) {
      // 나머지가 5kg 미만이라 2.5kg은 2장이면 충분하다.
      const { min, combos } = fills(r, lightKinds(plates));
      let best = null;
      for (const pieces of combos) {
        let A = pieces, B = [], diff = 0;
        if (equip === 'barbell') [A, B, diff] = splitSides(pieces, min);
        const cand = { A, B, diff, count: pieces.length, pieces };
        const better = !best || (equip === 'barbell' ? cand.diff - best.diff || cand.count - best.count : cand.count - best.count) < 0;
        if (better) best = cand;
      }
      const kg = (x) => x / 100;
      const desc = (arr) => arr.map(kg).sort((x, y) => y - x);
      result = {
        equip, target: kg(T), base: kg(base), extra: kg(min), actual: kg(base + min), over: kg(min - r),
        pieces: desc(best.pieces), A: desc(best.A), B: desc(best.B), unbalanced: equip === 'barbell' && best.diff > 0,
      };
    }
    plateMemo.set(key, result);
    return result;
  }

  const kgText = (x) => Number(x.toFixed(2)) + 'kg';
  const groupW = (arr) => { const m = new Map(); for (const p of arr) m.set(p, (m.get(p) || 0) + 1); return [...m]; };
  const piecesText = (arr) => groupW(arr).map(([p, n]) => `${kgText(p)} ${n === 1 ? '한 장' : n + '장'}`).join(' + ');
  function plateText(sol) {
    if (!sol) return null;
    if (sol.extra === 5) return `${kgText(sol.base + 5)}으로 맞추기`;
    let body;
    if (sol.equip === 'machine') body = piecesText(sol.pieces);
    else {
      const same = sol.A.length === sol.B.length && sol.A.every((p, i) => p === sol.B[i]);
      if (same) body = groupW(sol.A).map(([p, n]) => `${kgText(p)} ${n === 1 ? '한 쌍' : n + '쌍'}`).join(' + ');
      else if (!sol.B.length && sol.A.length === 1) body = `${kgText(sol.A[0])} 한 짝(한쪽만)`;
      else {
        const side = (arr) => (arr.length ? groupW(arr).map(([p, n]) => kgText(p) + (n > 1 ? '×' + n : '')).join('+') : '없음');
        body = `한쪽 ${side(sol.A)} · 반대쪽 ${side(sol.B)}`;
      }
    }
    return `${sol.base ? kgText(sol.base) + ' + ' : ''}${body}${sol.over > 0 ? ` → ${kgText(sol.actual)}` : ''}`;
  }

  // 머신 무게추: 목표 이상이면서 가장 가벼운 "무게추 + 그 위에 올린 원판(2.5kg·경량원판)". 같으면 원판 수가 적은 쪽.
  function stackMath(target, stack, plates) {
    const list = [...new Set((stack || []).filter((x) => x > 0).map((x) => Math.round(x * 100)))].sort((a, b) => a - b);
    if (!(target > 0) || !list.length) return null;
    const T = Math.round(target * 100);
    const kinds = lightKinds(plates);
    let best = null;
    for (const S of list) {
      let pieces = [], total = S;
      if (S < T) {
        const f = fills(T - S, kinds);
        if (!f) continue;
        pieces = f.combos.reduce((x, y) => (y.length < x.length ? y : x));
        total = S + f.min;
      }
      if (!best || total < best.total || (total === best.total && pieces.length < best.pieces.length)) best = { S, pieces, total };
      if (S >= T) break;   // 더 무거운 추는 더 무겁기만 하다
    }
    const kg = (x) => x / 100;
    if (!best) { const S = list[list.length - 1]; return { target: kg(T), stack: kg(S), pieces: [], actual: kg(S), over: 0, short: true }; }
    return { target: kg(T), stack: kg(best.S), pieces: best.pieces.map(kg).sort((x, y) => y - x), actual: kg(best.total), over: kg(best.total - T), short: false };
  }
  function stackText(sol) {
    if (!sol) return null;
    if (sol.short) return `무게추 가장 무거운 ${kgText(sol.stack)} (목표 ${kgText(sol.target)}에 못 미쳐요)`;
    if (!sol.pieces.length) return `무게추 ${kgText(sol.stack)}에 꽂기${sol.over > 0 ? ` (목표 ${kgText(sol.target)})` : ''}`;
    return `무게추 ${kgText(sol.stack)}에 꽂고 그 위에 ${piecesText(sol.pieces)} 올리기 → ${kgText(sol.actual)}`;
  }
  // 원판 여러 장(벨트·사슬에 매닮): 큰 원판(20·15·10·5kg)으로 5kg 단위를, 나머지는 2.5kg·경량원판으로.
  function chainText(target, plates) {
    if (!(target > 0)) return null;
    const sol = plateMath(target, plates, 'machine');
    let rest = Math.round((sol ? sol.base : target) * 100) / 100;
    const big = [];
    for (const p of BIG_PLATES) while (rest >= p - EPS) { big.push(p); rest -= p; }
    const all = big.concat(sol ? sol.pieces : []);
    if (!all.length) return null;
    return `${piecesText(all)} 매달기${sol && sol.over > 0 ? ` → ${kgText(sol.actual)}` : ''}`;
  }
  // 그 날 한 종목을 무엇으로 맞추는지 (원판·무게추·밴드). 덤벨·일체형 바벨·원판 한 장은 무게 그대로라 null.
  function loadInfo(row, cfg) {
    if (!row || row.skip) return null;
    if (row.band) return { label: '밴드', text: row.bands && row.bands.length ? row.bands.join(' + ') : '설정에서 쓸 밴드를 골라 주세요' };
    if (row.w == null) return null;
    const w = roundW(row.w);
    if (row.mode === 'barbell' || row.mode === 'machine') {
      const sol = plateMath(w, cfg.plates, 'barbell');
      return sol ? { label: '원판', text: plateText(sol), unbalanced: sol.unbalanced } : null;
    }
    if (row.mode === 'chain') { const t = chainText(w, cfg.plates); return t ? { label: '원판', text: t } : null; }
    if (row.mode === 'stack') {
      if (row.stack && row.stack.length) return { label: '머신', text: stackText(stackMath(w, row.stack, cfg.plates)) };
      const sol = plateMath(w, cfg.plates, 'machine');   // 무게추 단계를 안 넣었으면 5kg 간격으로 본다
      return sol ? { label: '머신', text: plateText(sol) + ' (무게추 5kg 간격으로 계산)' } : null;
    }
    if (row.maxed) return { label: '최대', text: `가진 ${MODES[row.mode].name} 중 가장 무거워요. 더 무거운 무게를 설정에 넣으면 올라가요` };
    return null;
  }

  // ---------- 표시용 ----------
  function dayRows(cfg, presc, type) {
    const rows = [mainRow(cfg, presc.main, type)];
    for (const a of cfg.acc) {
      const p = presc.acc[a.id];
      if (a.day !== type || !p || p.off || p.pending) continue;
      rows.push(accRow(a, p));
    }
    return rows;
  }

  function roundW(w, unit = 0.1) {
    const u = unit > 0 ? unit : 0.1;
    return Number((Math.round(w / u + 1e-9) * u).toFixed(2));
  }

  function fmtW(row, unit = 0.1) {
    if (row.band) return '밴드';
    // 가진 무게 목록에서 고르는 방식(덤벨·일체형 바벨·원판 한 장)은 그 무게 그대로 (1.25kg 등)
    if (row.w != null) return (MODES[row.mode] && MODES[row.mode].list ? Number(row.w.toFixed(2)) : roundW(row.w, unit)) + 'kg';
    if (!row.n) return '—';
    const sign = row.n > 0 ? '+' : '−';
    if (row.inc === 'kg') return sign + Number(Math.abs(row.n * row.incV).toFixed(2)) + 'kg';
    return sign + Math.abs(Math.round((Math.pow(1 + row.incV / 100, row.n) - 1) * 100)) + '%';
  }

  return {
    SLOTS, MAIN_STAGES, ACC_TOP, GAP1, GAP2, PLATE_OPTIONS, MODES, MODE_KEYS, CATALOG, EXTRA, toNum, toStr, weekday, mondayOf, localToday,
    defaultConfig, defaultGear, accDefaults, migrate, mainInc, LIFTS, MAIN_KG, sqRec, sqStart, startPoint, accAt, accTop, mainTop, restStage, segAt, initState, prescribe, evaluate, advance,
    replay, projectTo, simulate, timeline, snapLogs, snapOf, canLog, slotType, slotNo, slotPos, REST_SKIP,
    stepW, gearList, ladderOf, ladderReps, dayRows, roundW, fmtW, plateCounts, plateMath, plateText, stackMath, stackText, chainText, loadInfo,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RoutineLogic;
