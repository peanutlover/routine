/* 웨이트트레이닝 루틴 — 진행 로직 (순수 함수). 브라우저(index.html)와 Node 테스트에서 함께 사용한다. */
const RoutineLogic = (() => {
  'use strict';

  const DAY = 86400000;
  const SLOTS = 6;          // 세션 = 운동 6회 (데드·스쿼트 번갈아 3회씩)
  const MAIN_STAGES = 4;    // 하체 묶음 = 4세션
  const ACC_TOP = 2;        // 상체 사다리 = 3단계 (0·1·2)
  const LIGHT = { under: 20, reps: 5, step: 2, add: 5 }; // 20kg 미만: 5·7·9회, 묶음 성공 시 +5kg
  const PLATE_OPTIONS = [0.25, 0.5, 1, 1.25, 1.5, 2];  // 고를 수 있는 경량원판(종류별 한 쌍)

  // ---------- 날짜 (UTC 일 번호로 계산해 서머타임 영향 없음) ----------
  const pad = (x) => String(x).padStart(2, '0');
  function toNum(s) { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); }
  function toStr(n) { const t = new Date(n * DAY); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  function weekday(n) { return new Date(n * DAY).getUTCDay(); } // 0=일 … 6=토
  function mondayOf(n) { return n - ((weekday(n) + 6) % 7); }
  function localToday(now = new Date()) { return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()); }

  // ---------- 기본 설정 ----------
  // equip: barbell(원판 계산·좌우 균형) / machine(무게 추에 원판 올리기) / dumbbell(계산 없음)
  // sw: 무게가 at에 이르는 시점에 다른 종목으로 바꿔 w부터 다시 시작 (가슴: 덤벨프레스 → 바벨 벤치프레스)
  // from: 시작 지점. 시작일에 하는 운동이 세션 no의 k번째(0부터) 운동이고, 그 세션의 하체 단계가 stage(1~4).
  //       시작 무게(main.dl, acc[].w)는 이 세션의 무게. acc[id]에는 상체·팔의 횟수 단계(step·done·phase·n)를 따로 둘 수 있다.
  function defaultConfig(today) {
    return {
      cv: 2,
      startDate: today,
      from: { no: 1, k: 0, stage: 1, acc: {} },
      plates: [1.25],
      main: { dl: 40, ratio: 1.2, pct: 5, reps: 5, sets: 3, rest: '5~8분' },
      acc: [
        { id: 'lat', name: '랫풀다운', part: '등', day: 'D', equip: 'machine', w: 23, reps: 3, sets: 3, rest: '3~5분', inc: 'pct', incV: 5, light: false, from: 1, sw: null },
        { id: 'curl', name: '덤벨컬', part: '이두', day: 'D', equip: 'dumbbell', w: 3, reps: 5, sets: 3, rest: '2분', inc: 'kg', incV: 1, light: false, from: 1, sw: null },
        { id: 'ohp', name: 'OHP', part: '어깨', day: 'D', equip: 'barbell', w: 10, reps: 3, sets: 3, rest: '3~5분', inc: 'pct', incV: 5, light: true, from: 1, sw: null },
        { id: 'press', name: '덤벨프레스', part: '가슴', day: 'S', equip: 'dumbbell', w: 7, reps: 3, sets: 3, rest: '3~5분', inc: 'kg', incV: 1, light: false, from: 1,
          sw: { at: 10, name: '바벨 벤치프레스', w: 20, inc: 'pct', incV: 5 } },
        { id: 'tri', name: '케이블 트라이셉스 익스텐션', part: '삼두', day: 'S', equip: 'machine', w: null, reps: 5, sets: 3, rest: '2분', inc: 'kg', incV: 1, light: false, from: 1, sw: null },
        { id: 'side', name: '사이드 레터럴 레이즈', part: '어깨', day: 'S', equip: 'dumbbell', w: 2, reps: 10, sets: 3, rest: '1분', inc: 'kg', incV: 1, light: false, from: 1, sw: null },
        { id: 'rear', name: '벤트오버 레터럴 레이즈', part: '후면 어깨', day: 'S', equip: 'dumbbell', w: 2, reps: 10, sets: 3, rest: '1분', inc: 'kg', incV: 1, light: false, from: 1, sw: null },
      ],
    };
  }

  // 첫 판(cv 없음)으로 저장된 설정을 지금 규칙으로 옮긴다:
  // 고정 쉬는 요일·표시 단위 없앰, 가슴은 덤벨 1kg 증량 후 벤치프레스로 전환, 레터럴 레이즈 1kg 증량, 기구 종류·경량원판 추가.
  function migrate(cfg) {
    if (cfg.cv >= 2) return cfg;
    const defs = Object.fromEntries(defaultConfig(cfg.startDate).acc.map((a) => [a.id, a]));
    cfg.acc = cfg.acc.map((a) => {
      const def = defs[a.id];
      const b = Object.assign({ sw: null }, a);
      if (!b.equip) b.equip = def ? def.equip : 'dumbbell';
      if (def && (a.id === 'press' || a.id === 'side' || a.id === 'rear')) Object.assign(b, { inc: def.inc, incV: def.incV, light: def.light, sw: def.sw });
      return b;
    });
    if (!Array.isArray(cfg.plates)) cfg.plates = [0.5, 1];
    delete cfg.trainDays;
    delete cfg.roundTo;
    cfg.cv = 2;
    return cfg;
  }

  // ---------- 상태 머신 ----------
  // main.level: 데드리프트 = 시작무게 × 1.05^level. 묶음 = level start..start+3, 4번째(최고 중량)가 "4세션".
  // acc.step: 0·1·2 사다리 위치(실패하면 음수까지 내려감). done = 사다리 끝(3단계) 성공, 하체 묶음 완료 시 증량 대기.
  const toInt = (v, lo, hi, dflt) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
  function startPoint(cfg) {
    const f = (cfg && cfg.from) || {};
    return {
      no: toInt(f.no, 1, 9999, 1), k: toInt(f.k, 0, SLOTS - 1, 0), stage: toInt(f.stage, 1, MAIN_STAGES, 1),
      acc: f.acc && typeof f.acc === 'object' ? f.acc : {},
    };
  }
  // 상체·팔 사다리의 기본 위치는 하체 단계와 나란히 간다: 1~3단계 = 첫·둘째·셋째 횟수, 4단계 = 쉬는 날(셋째 횟수까지 성공, 증량 대기).
  function accAt(stage) { return stage >= MAIN_STAGES ? { step: ACC_TOP, done: true } : { step: stage - 1, done: false }; }

  function initState(cfg) {
    const sp = startPoint(cfg);
    const acc = {};
    for (const a of cfg.acc) {
      const o = Object.assign((a.from || 1) > sp.no ? accAt(1) : accAt(sp.stage), sp.acc[a.id] || {});
      const step = toInt(o.step, -9, ACC_TOP, 0);
      acc[a.id] = { w: a.w == null ? null : a.w, n: toInt(o.n, 0, 999, 0), step, done: !!o.done && step === ACC_TOP, fail: false, phase: a.sw && o.phase ? 1 : 0 };
    }
    const bundle = Math.max(1, Math.floor((sp.no - sp.stage) / MAIN_STAGES) + 1);
    return { main: { level: 0, start: 1 - sp.stage, bundle, fail: false }, acc };
  }

  // 전환 뒤에는 이름·증량·기구가 바뀐 종목으로 본다.
  function eff(a, s) {
    if (!s.phase || !a.sw) return a;
    return Object.assign({}, a, { name: a.sw.name, inc: a.sw.inc, incV: a.sw.incV, equip: 'barbell' });
  }
  function isLight(a, s) { return !!a.light && s.w != null && s.w < LIGHT.under - 1e-9; }
  function ladderReps(a, s) {
    return isLight(a, s) ? Math.max(1, LIGHT.reps + LIGHT.step * s.step) : Math.max(1, a.reps + s.step);
  }

  function mainPresc(cfg, m) {
    const dl = cfg.main.dl * Math.pow(1 + cfg.main.pct / 100, m.level);
    return { dl, sq: dl / cfg.main.ratio, level: m.level, bundle: m.bundle, stage: m.level - m.start + 1, top: m.level === m.start + MAIN_STAGES - 1, retry: m.fail };
  }
  // 보조 종목의 세션 처방. off = 아직 들어가지 않은 종목, skip = 하체 4단계 세션이라 쉼.
  function accPresc(a, s, no, top) {
    if (!s || no < (a.from || 1)) return { off: true };
    if (top) return { skip: true };
    const e = eff(a, s);
    return {
      name: e.name, equip: e.equip, inc: e.inc, incV: e.incV, phase: s.phase,
      w: s.w, n: s.n, reps: ladderReps(a, s), step: s.step, hold: s.done, retry: s.fail, light: isLight(a, s),
    };
  }
  function prescribe(cfg, st, no) {
    const main = mainPresc(cfg, st.main);
    const acc = {};
    for (const a of cfg.acc) acc[a.id] = accPresc(a, st.acc[a.id], no, main.top);
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

  function raise(a, s) {
    if (s.w == null) return { w: null, phase: s.phase };
    const e = eff(a, s);
    const w = isLight(a, s) ? s.w + LIGHT.add : e.inc === 'kg' ? s.w + e.incV : s.w * (1 + e.incV / 100);
    if (!s.phase && a.sw && w >= a.sw.at - 1e-9) return { w: a.sw.w, phase: 1 };
    return { w, phase: s.phase };
  }

  // 하체 한 세션의 결과로 다음 상태. bundleDone = 4단계를 성공해 묶음을 마침(상체·팔 증량 시점).
  function advanceMain(st, ok) {
    const m = Object.assign({}, st);
    let bundleDone = false;
    if (ok) {
      if (m.level === m.start + MAIN_STAGES - 1) { m.start += 1; m.level = m.start; m.bundle += 1; bundleDone = true; }
      else m.level += 1;
      m.fail = false;
    } else {
      m.level -= 1; m.fail = true;
    }
    return { m, bundleDone };
  }
  // 보조 종목 한 세션의 결과(r: true·false, 쉰 세션은 null)와 그 세션 하체의 묶음 완료 여부로 다음 상태.
  function advanceAcc(a, st, r, bundleDone) {
    const s = Object.assign({}, st);
    if (r != null) {
      if (r) { if (s.step < ACC_TOP) s.step += 1; else s.done = true; s.fail = false; }
      else { s.step -= 1; s.done = false; s.fail = true; }
    }
    if (bundleDone && s.done) {
      const up = raise(a, s);
      s.w = up.w; s.phase = up.phase; s.n += 1; s.step = 0; s.done = false;
    }
    return s;
  }
  function advance(cfg, st, out) {
    const { m, bundleDone } = advanceMain(st.main, out.main);
    const acc = {};
    for (const a of cfg.acc) acc[a.id] = st.acc[a.id] && advanceAcc(a, st.acc[a.id], out.acc[a.id], bundleDone);
    return { main: m, acc };
  }

  const slotType = (i) => (i % 2 === 0 ? 'D' : 'S');

  const ALL_OK = [{ type: 'D', res: {} }, { type: 'S', res: {} }];

  // 지금 시작 지점에서 모든 세션을 성공한다고 보고 세션 no의 상태·처방을 구한다. 시작 세션보다 앞이면 null.
  // 이미 하던 루틴을 이어서 시작할 때 무게·횟수를 미리 채우는 데 쓴다.
  function projectTo(cfg, no) {
    const sp = startPoint(cfg);
    if (!(no >= sp.no)) return null;
    let st = initState(cfg);
    for (let n = sp.no; n < no; n++) st = advance(cfg, st, evaluate(cfg, prescribe(cfg, st, n), ALL_OK));
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
      id: type === 'D' ? 'dl' : 'sq', name: type === 'D' ? '데드리프트' : '스쿼트', part: '하체', main: true, equip: 'barbell',
      w: type === 'D' ? mp.dl : mp.sq, n: 0, reps: cfg.main.reps, sets: cfg.main.sets, rest: cfg.main.rest, retry: mp.retry,
    };
  }
  function accRow(a, p) {
    if (p.skip) return { id: a.id, name: a.name, part: a.part, skip: true };
    return {
      id: a.id, name: p.name, part: a.part, equip: p.equip, phase: p.phase, w: p.w, n: p.n, inc: p.inc, incV: p.incV,
      reps: p.reps, sets: a.sets, rest: a.rest, hold: p.hold, retry: p.retry, light: p.light,
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
    const openAcc = (X, i, st) => { X.sess[i] = { no: sp.no + i, i, state: st, presc: null, res: [], done: false, out: null }; };
    const A = cfg.acc.map((a) => {
      const X = { a, i: 0, j: a.day === 'D' ? Math.ceil(sp.k / 2) : Math.floor(sp.k / 2), sess: [] };
      openAcc(X, 0, init.acc[a.id]);
      return X;
    });
    const accP = (X, i) => { const s = X.sess[i]; if (!s.presc) s.presc = accPresc(X.a, s.state, s.no, S[i].presc.top); return s.presc; };
    // 보조 종목이 세션 몫(3번)을 다 했거나 쉬는 세션이면, 그 세션의 하체가 끝난 뒤 다음 세션으로 넘긴다.
    function settle(X) {
      for (;;) {
        const i = X.i, s = X.sess[i];
        const p = accP(X, i);
        if (p.off || p.skip) X.j = Math.max(X.j, 3 * (i + 1));
        if (X.j < 3 * (i + 1) || !S[i].done) return;
        s.done = true;
        s.out = p.off || p.skip ? null : !s.res.includes(false);
        openAcc(X, i + 1, advanceAcc(X.a, s.state, s.out, S[i].bundleDone));
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
          const nx = advanceMain(cur.state, cur.out);
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
  const plateMemo = new Map();
  function plateMath(target, plates, equip) {
    if (!(target > 0) || (equip !== 'barbell' && equip !== 'machine')) return null;
    const key = target + '|' + (plates || []).join(',') + '|' + equip;
    if (plateMemo.has(key)) return plateMemo.get(key);
    const T = Math.round(target * 100);          // 0.01kg 단위 정수로 계산
    const base = Math.floor(T / 500) * 500;
    const r = T - base;
    let result = null;
    if (r > 0) {
      // [무게, 쓸 수 있는 장수]. 나머지가 5kg 미만이라 2.5kg은 2장이면 충분하다.
      const kinds = [[250, 2]].concat([...plateCounts(plates)].map(([p, n]) => [Math.round(p * 100), 2 * n])
        .filter(([p]) => p > 0 && p < 250).sort((a, b) => b[0] - a[0]));
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

  function plateText(sol) {
    if (!sol) return null;
    const kg = (x) => Number(x.toFixed(2)) + 'kg';
    const group = (arr) => { const m = new Map(); for (const p of arr) m.set(p, (m.get(p) || 0) + 1); return [...m]; };
    if (sol.extra === 5) return `${kg(sol.base + 5)}으로 맞추기`;
    let body;
    if (sol.equip === 'machine') body = group(sol.pieces).map(([p, n]) => `${kg(p)} ${n === 1 ? '한 짝' : n === 2 ? '두 짝' : n + '짝'}`).join(' + ');
    else {
      const same = sol.A.length === sol.B.length && sol.A.every((p, i) => p === sol.B[i]);
      if (same) body = group(sol.A).map(([p, n]) => `${kg(p)} ${n === 1 ? '한 쌍' : n + '쌍'}`).join(' + ');
      else if (!sol.B.length && sol.A.length === 1) body = `${kg(sol.A[0])} 한 짝(한쪽만)`;
      else {
        const side = (arr) => (arr.length ? group(arr).map(([p, n]) => kg(p) + (n > 1 ? '×' + n : '')).join('+') : '없음');
        body = `한쪽 ${side(sol.A)} · 반대쪽 ${side(sol.B)}`;
      }
    }
    return `${sol.base ? kg(sol.base) + ' + ' : ''}${body}${sol.over > 0 ? ` → ${kg(sol.actual)}` : ''}`;
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
    if (row.w != null) return roundW(row.w, unit) + 'kg';
    if (!row.n) return '—';
    if (row.inc === 'kg') return '+' + Number((row.n * row.incV).toFixed(2)) + 'kg';
    return '+' + Math.round((Math.pow(1 + row.incV / 100, row.n) - 1) * 100) + '%';
  }

  return {
    SLOTS, MAIN_STAGES, ACC_TOP, LIGHT, PLATE_OPTIONS, toNum, toStr, weekday, mondayOf, localToday, defaultConfig, migrate,
    startPoint, accAt, initState, prescribe, evaluate, advance, replay, projectTo, simulate, timeline, canLog, slotType, slotNo, slotPos, REST_SKIP,
    ladderReps, eff, dayRows, roundW, fmtW, plateCounts, plateMath, plateText,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RoutineLogic;
