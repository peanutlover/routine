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

  function prescribe(cfg, st, no) {
    const m = st.main;
    const top = m.level === m.start + MAIN_STAGES - 1;
    const dl = cfg.main.dl * Math.pow(1 + cfg.main.pct / 100, m.level);
    const main = { dl, sq: dl / cfg.main.ratio, level: m.level, bundle: m.bundle, stage: m.level - m.start + 1, top, retry: m.fail };
    const acc = {};
    for (const a of cfg.acc) {
      const s = st.acc[a.id];
      if (!s || no < (a.from || 1)) { acc[a.id] = { off: true }; continue; }
      if (top) { acc[a.id] = { skip: true }; continue; }
      const e = eff(a, s);
      acc[a.id] = {
        name: e.name, equip: e.equip, inc: e.inc, incV: e.incV, phase: s.phase,
        w: s.w, n: s.n, reps: ladderReps(a, s), step: s.step, hold: s.done, retry: s.fail, light: isLight(a, s),
      };
    }
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

  function advance(cfg, st, out) {
    const nx = JSON.parse(JSON.stringify(st));
    const m = nx.main;
    let bundleDone = false;
    if (out.main) {
      if (m.level === m.start + MAIN_STAGES - 1) { m.start += 1; m.level = m.start; m.bundle += 1; bundleDone = true; }
      else m.level += 1;
      m.fail = false;
    } else {
      m.level -= 1; m.fail = true;
    }
    for (const a of cfg.acc) {
      const s = nx.acc[a.id], r = out.acc[a.id];
      if (!s || r == null) continue;
      if (r) { if (s.step < ACC_TOP) s.step += 1; else s.done = true; s.fail = false; }
      else { s.step -= 1; s.done = false; s.fail = true; }
    }
    if (bundleDone) {
      for (const a of cfg.acc) {
        const s = nx.acc[a.id];
        if (!s || !s.done) continue;
        const up = raise(a, s);
        s.w = up.w; s.phase = up.phase; s.n += 1; s.step = 0; s.done = false;
      }
    }
    return nx;
  }

  const slotType = (i) => (i % 2 === 0 ? 'D' : 'S');

  // 기록을 시작 지점부터 다시 돌려 세션별 처방을 만든다. 마지막 원소가 진행 중인(또는 다음) 세션.
  // 시작 세션은 k번째 운동부터 기록하고, 그 앞 운동(앱을 쓰기 전에 한 것)은 성공으로 본다. first = 세션에서 첫 기록의 순서.
  function replay(cfg, logs) {
    const sp = startPoint(cfg);
    const sessions = [];
    let st = initState(cfg);
    let i = 0;
    for (let no = sp.no; ; no++) {
      const first = no === sp.no ? sp.k : 0;
      const need = SLOTS - first;
      const chunk = logs.slice(i, i + need);
      const presc = prescribe(cfg, st, no);
      const sess = { no, first, state: st, presc, logs: chunk, done: chunk.length === need };
      sessions.push(sess);
      if (!sess.done) break;
      i += need;
      sess.out = evaluate(cfg, presc, chunk.map((lg, j) => ({ type: slotType(first + j), res: lg.res })));
      st = advance(cfg, st, sess.out);
    }
    return sessions;
  }

  const ALL_OK = [{ type: 'D', res: {} }, { type: 'S', res: {} }];

  // 진행 중인 세션 이후를 "남은 운동은 모두 성공"으로 가정해 예상한다.
  function future(cfg, sessions, count) {
    const cur = sessions[sessions.length - 1];
    const entries = cur.logs.map((lg, j) => ({ type: slotType(cur.first + j), res: lg.res }));
    let st = advance(cfg, cur.state, evaluate(cfg, cur.presc, entries));
    const out = [];
    for (let j = 1; j <= count; j++) {
      const presc = prescribe(cfg, st, cur.no + j);
      out.push({ no: cur.no + j, first: 0, state: st, presc, logs: [], projected: true });
      st = advance(cfg, st, evaluate(cfg, presc, ALL_OK));
    }
    return out;
  }

  // 지금 시작 지점에서 모든 세션을 성공한다고 보고 세션 no의 상태·처방을 구한다. 시작 세션보다 앞이면 null.
  // 이미 하던 루틴을 이어서 시작할 때 무게·횟수를 미리 채우는 데 쓴다.
  function projectTo(cfg, no) {
    const sp = startPoint(cfg);
    if (!(no >= sp.no)) return null;
    let st = initState(cfg);
    for (let n = sp.no; n < no; n++) st = advance(cfg, st, evaluate(cfg, prescribe(cfg, st, n), ALL_OK));
    return { state: st, presc: prescribe(cfg, st, no) };
  }

  // ---------- 달력 ----------
  // 고정 쉬는 요일 없음. 세션의 6번째 운동 다음 날만 쉰다.
  // kind: log(기록됨) plan(예정) gap(세션 간 휴식) miss(지난 날, 기록 없음 = 쉰 날). 시작일 이전은 맵에 없음.
  // slot: 시작 세션의 첫 운동을 0으로 센 칸 번호. i번째 기록의 칸 = 시작 지점의 k + i.
  function timeline(cfg, logs, today, opts = {}) {
    const days = new Map();
    const slotDate = [];
    const k0 = startPoint(cfg).k;
    const start = toNum(cfg.startDate);
    const T = toNum(today);
    let last = null;
    logs.forEach((lg, i) => { const d = toNum(lg.d); days.set(d, { kind: 'log', slot: k0 + i }); slotDate[k0 + i] = d; last = d; });
    logs.forEach((lg, i) => {
      if ((k0 + i + 1) % SLOTS !== 0) return;
      const g = toNum(lg.d) + 1;
      if (!days.has(g)) days.set(g, { kind: 'gap' });
    });
    const cursor = Math.max(T, start, last == null ? -Infinity : last + 1);
    for (let d = start; d < cursor; d++) if (!days.has(d)) days.set(d, { kind: 'miss' });
    let idx = k0 + logs.length;
    let forced = logs.length > 0 && idx % SLOTS === 0 ? last + 1 : null;
    const until = opts.until == null ? cursor + 6 : opts.until;
    const minSlots = opts.minSlots || 0;
    for (let d = cursor, guard = 0; (d <= until || idx < minSlots) && guard < 4000; d++, guard++) {
      if (d === forced) { if (!days.has(d)) days.set(d, { kind: 'gap' }); continue; }
      days.set(d, { kind: 'plan', slot: idx });
      slotDate[idx] = d;
      idx += 1;
      if (idx % SLOTS === 0) forced = d + 1;
    }
    return { days, slotDate, start, cursor, today: T, last, k0 };
  }

  // 그 날짜에 "다음 운동"을 기록할 수 있는가: 오늘의 예정일, 또는 마지막 기록 이후의 지난 날.
  // 지나간 휴식일도 실제로 운동했다면 기록할 수 있다 (지난 기록을 이어서 넣을 때).
  function canLog(tl, d) {
    const e = tl.days.get(d);
    if (!e || d > tl.today) return false;
    if (tl.last != null && d <= tl.last) return false;
    return e.kind === 'plan' || e.kind === 'miss' || (e.kind === 'gap' && d < tl.today);
  }

  // 칸 번호 → 세션 번호, 세션 안 순서(0~5)
  function slotNo(cfg, g) { return startPoint(cfg).no + Math.floor(g / SLOTS); }
  function slotPos(g) { return ((g % SLOTS) + SLOTS) % SLOTS; }

  // ---------- 경량원판 ----------
  // 5kg 단위는 일반 원판으로 끼우고, 나머지를 가진 경량원판(종류별 한 쌍)과 2.5kg 원판으로 채운다.
  // 2.5kg 한 짝은 머신(추에 올림)이나, 경량원판이 1.25kg뿐인 바벨에서만 쓴다.
  // 고르는 순서: 목표 무게 이상이면서 가장 가벼운 조합 → (바벨) 양쪽 무게 차이가 작은 조합 → 원판 수가 적은 조합.
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
      const kinds = [250].concat([...new Set((plates || []).map((p) => Math.round(p * 100)))].filter((p) => p > 0 && p < 250).sort((a, b) => b - a));
      const own = kinds.slice(1);
      const single25 = own.length === 1 && own[0] === 125;
      let min = Infinity;
      const combos = [];
      const walk = (i, total, pieces) => {
        if (i === kinds.length) {
          if (total < r) return;
          if (total < min) { min = total; combos.length = 0; }
          if (total === min) combos.push(pieces.slice());
          return;
        }
        // 2.5kg 한 짝(바벨 한쪽만)은 경량원판이 1.25kg뿐일 때만 허용. 그 밖의 바벨은 2.5kg을 한 쌍으로만 쓴다.
        const step = kinds[i] === 250 && equip === 'barbell' && !single25 ? 2 : 1;
        for (let c = 0; c <= 2; c += step) {
          for (let k = 0; k < c; k++) pieces.push(kinds[i]);
          walk(i + 1, total + c * kinds[i], pieces);
          pieces.length -= c;
        }
      };
      walk(0, 0, []);
      let best = null;
      for (const pieces of combos) {
        let A = pieces, B = [], diff = 0;
        if (equip === 'barbell') {
          let bestMask = 0;
          diff = Infinity;
          for (let mask = 0; mask < 1 << pieces.length; mask++) {
            let a = 0;
            for (let j = 0; j < pieces.length; j++) if (mask & (1 << j)) a += pieces[j];
            const d = Math.abs(min - 2 * a);
            if (d < diff) { diff = d; bestMask = mask; }
          }
          const L = [], R = [];
          pieces.forEach((p, j) => ((bestMask & (1 << j) ? L : R).push(p)));
          const sl = L.reduce((x, y) => x + y, 0);
          [A, B] = sl * 2 >= min ? [L, R] : [R, L];
        }
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
    if (sol.equip === 'machine') body = group(sol.pieces).map(([p, n]) => `${kg(p)} ${n === 2 ? '두 짝' : '한 짝'}`).join(' + ');
    else {
      const same = sol.A.length === sol.B.length && sol.A.every((p, i) => p === sol.B[i]);
      if (same) body = group(sol.A).map(([p, n]) => `${kg(p)} ${n === 1 ? '한 쌍' : n + '쌍'}`).join(' + ');
      else if (!sol.B.length && sol.A.length === 1) body = `${kg(sol.A[0])} 한 짝(한쪽만)`;
      else body = `한쪽 ${sol.A.map(kg).join('+')} · 반대쪽 ${sol.B.length ? sol.B.map(kg).join('+') : '없음'}`;
    }
    return `${sol.base ? kg(sol.base) + ' + ' : ''}${body}${sol.over > 0 ? ` → ${kg(sol.actual)}` : ''}`;
  }

  // ---------- 표시용 ----------
  function dayRows(cfg, presc, type) {
    const mm = presc.main;
    const rows = [{
      id: type === 'D' ? 'dl' : 'sq', name: type === 'D' ? '데드리프트' : '스쿼트', part: '하체', main: true, equip: 'barbell',
      w: type === 'D' ? mm.dl : mm.sq, n: 0, reps: cfg.main.reps, sets: cfg.main.sets, rest: cfg.main.rest, retry: mm.retry,
    }];
    for (const a of cfg.acc) {
      if (a.day !== type) continue;
      const p = presc.acc[a.id];
      if (p.off) continue;
      if (p.skip) { rows.push({ id: a.id, name: a.name, part: a.part, skip: true }); continue; }
      rows.push({
        id: a.id, name: p.name, part: a.part, equip: p.equip, phase: p.phase, w: p.w, n: p.n, inc: p.inc, incV: p.incV,
        reps: p.reps, sets: a.sets, rest: a.rest, hold: p.hold, retry: p.retry, light: p.light,
      });
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
    startPoint, accAt, initState, prescribe, evaluate, advance, replay, future, projectTo, timeline, canLog, slotType, slotNo, slotPos,
    ladderReps, eff, dayRows, roundW, fmtW, plateMath, plateText,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RoutineLogic;
