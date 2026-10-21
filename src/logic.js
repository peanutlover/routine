/* 웨이트트레이닝 루틴 — 진행 로직 (순수 함수). 브라우저(index.html)와 Node 테스트에서 함께 사용한다. */
const RoutineLogic = (() => {
  'use strict';

  const DAY = 86400000;
  const SLOTS = 6;          // 세션 = 운동 6회 (데드·스쿼트 번갈아 3회씩)
  const MAIN_STAGES = 4;    // 하체 묶음 = 4세션 (횟수 고정일 때)
  const ACC_TOP = 2;        // 횟수 고정 보조 종목의 무게 사다리 = 3단계 (기본·+1칸·+2칸)
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
      from: { no: 1, k: 0, stage: 1, acc: {} },
      plates: [1.25],
      gear: defaultGear(),
      main: { dl: 40, ratio: 1.2, pct: 5, prog: 'r', reps: 5, ladder: [3, 4, 5], sets: 3, rest: '5~8분' },
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
      b.mode = a.light && equip === 'barbell' ? 'fixedbar' : equip === 'machine' ? 'stack' : equip === 'barbell' ? 'barbell' : 'dumbbell';
      b.prog = 'w';
      const r = Math.max(1, Math.round(Number(a.reps)) || 5);
      b.ladder = a.light ? [5, 7, 9] : [r, r + 1, r + 2];
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
      return list[Math.max(0, Math.min(list.length - 1, i + k))];
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
  // 보조 종목 사다리의 기본 위치는 하체 단계와 나란히 간다. 하체 4단계 세션(쉬는 날) 다음은 새 무게의 첫 칸.
  function accAt(stage, a) { const top = a ? accTop(a) : ACC_TOP; return { step: stage >= MAIN_STAGES ? 0 : Math.min(top, stage - 1) }; }
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
      const o = Object.assign(accAt((a.from || 1) > sp.no ? 1 : sp.stage, a), sp.acc[a.id] || {});
      acc[a.id] = Object.assign(freshAcc(segAt(a, sp.no)), { n: toInt(o.n, 0, 999, 0), step: toInt(o.step, -9, accTop(a), 0) });
    }
    const top = mainTop(cfg);
    const stage = Math.min(sp.stage, top);
    const bundle = Math.max(1, Math.floor((sp.no - stage) / top) + 1);
    return { main: { level: 0, start: 1 - stage, step: stage - 1, bundle, fail: false }, acc };
  }

  function mainPresc(cfg, m) {
    const dl = cfg.main.dl * Math.pow(1 + cfg.main.pct / 100, m.level);
    const base = { dl, sq: dl / cfg.main.ratio, level: m.level, bundle: m.bundle, retry: m.fail };
    if (cfg.main.prog === 'w') {
      const n = ladderOf(cfg.main).length;
      return Object.assign(base, { stage: m.step >= 0 ? m.step + 1 : 0, top: n >= 3 && m.step === n - 1, reps: ladderReps(cfg.main, m.step) });
    }
    return Object.assign(base, { stage: m.level - m.start + 1, top: m.level === m.start + MAIN_STAGES - 1, reps: cfg.main.reps });
  }
  // 보조 종목의 세션 처방. off = 아직 들어가지 않은 종목, skip = 하체 4단계 세션이라 쉼.
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

  // 하체 한 세션의 결과로 다음 상태. bundleDone = 묶음을 마침.
  function advanceMain(cfg, st, ok) {
    const m = Object.assign({}, st);
    let bundleDone = false;
    if (cfg.main.prog === 'w') {
      const n = ladderOf(cfg.main).length;
      if (ok) {
        if (m.step >= n - 1) { m.level += 1; m.step = 0; m.bundle += 1; bundleDone = true; } else m.step += 1;
        m.fail = false;
      } else { m.step = Math.max(-9, m.step - 1); m.fail = true; }
      return { m, bundleDone };
    }
    if (ok) {
      if (m.level === m.start + MAIN_STAGES - 1) { m.start += 1; m.level = m.start; m.bundle += 1; bundleDone = true; }
      else m.level += 1;
      m.fail = false;
    } else {
      m.level -= 1; m.fail = true;
    }
    return { m, bundleDone };
  }
  // 보조 종목 한 세션의 결과(r: true·false, 쉰 세션은 null)로 다음 상태. 고무밴드는 기록만 하고 바뀌지 않는다.
  // 사다리 마지막 칸을 성공하면 한 칸 올린 무게로 첫 칸부터 (횟수 고정: 무게 3단계 중 2단계 무게부터).
  function advanceAcc(cfg, a, st, r) {
    const s = Object.assign({}, st);
    if (r == null || s.mode === 'band') return s;
    if (r) {
      if (s.step < accTop(a)) s.step += 1;
      else { s.w = stepW(cfg, a, s.mode, s.w, 1); s.n += 1; s.step = 0; }
      s.fail = false;
    } else { s.step = Math.max(-9, s.step - 1); s.fail = true; }
    return s;
  }
  function advance(cfg, st, out) {
    const { m } = advanceMain(cfg, st.main, out.main);
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
      st = advance(cfg, st, evaluate(cfg, prescribe(cfg, st, n), ALL_OK));
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

  // opts.until: 이 날까지 예상(모두 성공 가정)을 채운다. opts.minSessions: 하체·모든 보조 종목이 적어도 이만큼 세션을 갖도록 채운다.
  function simulate(cfg, logs, today, opts = {}) {
    const sp = startPoint(cfg);
    const init = initState(cfg);
    const S = [];
    const openMain = (i, m) => {
      S[i] = { no: sp.no + i, i, state: m, presc: mainPresc(cfg, m), first: i === 0 ? sp.k : 0, n: i === 0 ? sp.k : 0, res: [],
        done: false, out: null, bundleDone: false, firstDay: null, lastDay: null, rests: 0, restSkip: false };
    };
    openMain(0, init.main);
    const openAcc = (X, i, st) => { X.sess[i] = { no: sp.no + i, i, state: i ? openState(X.a, st, sp.no + i) : st, presc: null, res: [], done: false, out: null }; };
    const A = cfg.acc.map((a) => {
      const X = { a, i: 0, j: a.day === 'D' ? Math.ceil(sp.k / 2) : Math.floor(sp.k / 2), sess: [] };
      openAcc(X, 0, init.acc[a.id]);
      return X;
    });
    const accP = (X, i) => { const s = X.sess[i]; if (!s.presc) s.presc = accPresc(cfg, X.a, s.state, s.no, S[i].presc.top); return s.presc; };
    // 보조 종목이 세션 몫(3번)을 다 했거나 쉬는 세션이면, 그 세션의 하체가 끝난 뒤 다음 세션으로 넘긴다.
    function settle(X) {
      for (;;) {
        const i = X.i, s = X.sess[i];
        const p = accP(X, i);
        if (p.off || p.skip) X.j = Math.max(X.j, 3 * (i + 1));
        if (X.j < 3 * (i + 1) || !S[i].done) return;
        s.done = true;
        s.out = p.off || p.skip ? null : !s.res.includes(false);
        openAcc(X, i + 1, advanceAcc(cfg, X.a, s.state, s.out));
        X.i = i + 1;
      }
    }
    let g = sp.k;
    // 그 날 할 운동: 하체 칸 g의 하체 + 그 날에 붙는 보조 종목들의 다음 차례.
    // avail: ok(오늘 함) · skip(하체 4단계라 쉼) · wait(하체보다 앞서지 않으려고 쉼). lag = 지난 차례가 밀려서 하는 것.
    function plan() {
      const i = S.length - 1, type = slotType(g);
      const rows = [Object.assign(mainRow(cfg, S[i].presc, type), { avail: 'ok' })];
      for (const X of A) {
        if (X.a.day !== type) continue;
        settle(X);
        const p = accP(X, X.i);
        if (p.off) continue;
        if (p.skip) { rows.push(Object.assign(accRow(X.a, p), { avail: 'skip' })); continue; }
        const at = accSlot(X.a.day, X.j);
        rows.push(Object.assign(accRow(X.a, p), { avail: at <= g ? 'ok' : 'wait', lag: at < g, accNo: X.sess[X.i].no }));
      }
      return { g, slot: g, type, no: S[i].no, pos: slotPos(g), main: S[i].presc, rows };
    }
    let restDay = null, skipNote = null;
    function apply(d, info, res, legacy) {
      const got = (id) => (legacy ? res[id] !== false : typeof res[id] === 'boolean' ? res[id] : null);
      for (const r of info.rows) {
        r.result = r.avail === 'ok' ? got(r.id) : null;
        if (r.main || r.result == null) continue;
        const X = A.find((x) => x.a.id === r.id);
        X.sess[X.i].res.push(r.result);
        X.j += 1;
      }
      const mv = info.rows[0].result;
      const cur = S[S.length - 1];
      if (mv != null) {
        if (cur.firstDay == null) cur.firstDay = d;
        cur.lastDay = d;
        cur.res.push(mv);
        cur.n += 1;
        g += 1;
        if (cur.n === SLOTS) {
          cur.done = true;
          cur.out = !cur.res.includes(false);
          const nx = advanceMain(cfg, cur.state, cur.out);
          cur.bundleDone = nx.bundleDone;
          cur.restSkip = cur.rests >= REST_SKIP;
          openMain(cur.i + 1, nx.m);
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
      const info = plan();
      // 고무밴드는 기록한 날 쓴 밴드를 남긴다 (설정에서 밴드를 바꿔도 지난 기록은 그대로).
      if (lg.b) for (const r of info.rows) if (r.band && Array.isArray(lg.b[r.id])) r.bands = lg.b[r.id].slice();
      days.set(ld, Object.assign(info, { kind: 'log', li, restSkipped: ld === skipNote }));
      apply(ld, info, lg.res || {}, !lg.p);
      last = ld;
      d = ld + 1;
    });
    const cursor = Math.max(T, start, last == null ? -Infinity : last + 1);
    for (; d < cursor; d++) quiet(d);
    const next = plan();
    const c = S[S.length - 1];
    const cur = { i: c.i, no: c.no, n: c.n, presc: c.presc };
    const real = { main: c.i, acc: Object.fromEntries(A.map((X) => [X.a.id, X.i])) };
    const until = opts.until == null ? cursor + 6 : opts.until;
    const need = opts.minSessions || 0;
    const short = () => S.length < need || A.some((X) => X.sess.length < need);
    for (let guard = 0; (d <= until || short()) && guard < 4000; d++, guard++) {
      if (d === restDay) { days.set(d, { kind: 'gap' }); continue; }
      const info = plan();
      const res = {};
      for (const r of info.rows) if (r.avail === 'ok') res[r.id] = true;
      days.set(d, Object.assign(info, { kind: 'plan', restSkipped: d === skipNote }));
      apply(d, info, res, false);
    }
    // 세션 no의 처방(하체 + 보조 종목 세션별). 보조 종목이 아직 그 세션에 이르지 않았으면 pending.
    function view(no) {
      const i = no - sp.no, s = S[i];
      if (!s) return null;
      const acc = {};
      for (const X of A) acc[X.a.id] = X.sess[i] ? accP(X, i) : { pending: true };
      return { no, main: s.presc, acc };
    }
    return {
      days, today: T, start, cursor, last, k0: sp.k, next, cur, real, view,
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
    if (row.w != null) return roundW(row.w, unit) + 'kg';
    if (!row.n) return '—';
    const sign = row.n > 0 ? '+' : '−';
    if (row.inc === 'kg') return sign + Number(Math.abs(row.n * row.incV).toFixed(2)) + 'kg';
    return sign + Math.abs(Math.round((Math.pow(1 + row.incV / 100, row.n) - 1) * 100)) + '%';
  }

  return {
    SLOTS, MAIN_STAGES, ACC_TOP, PLATE_OPTIONS, MODES, MODE_KEYS, CATALOG, EXTRA, toNum, toStr, weekday, mondayOf, localToday,
    defaultConfig, defaultGear, accDefaults, migrate, startPoint, accAt, accTop, mainTop, segAt, initState, prescribe, evaluate, advance,
    replay, projectTo, simulate, timeline, canLog, slotType, slotNo, slotPos, REST_SKIP,
    stepW, gearList, ladderOf, ladderReps, dayRows, roundW, fmtW, plateCounts, plateMath, plateText, stackMath, stackText, chainText, loadInfo,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RoutineLogic;
