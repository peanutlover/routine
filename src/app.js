/* 웨이트트레이닝 루틴 — 화면과 저장. 로직은 RoutineLogic(logic.js)에 있다. */
(() => {
  'use strict';
  const L = RoutineLogic;
  const KEY = 'routine5.v1';
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const TYPE_NAME = { D: '데드리프트', S: '스쿼트' };
  const $ = (id) => document.getElementById(id);
  const PAIR_MAX = 5;        // 경량원판 종류별 최대 쌍 수
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let today = L.localToday();
  let data = loadLocal() || fresh();
  let tab = 'week';
  let weekMon = L.mondayOf(L.toNum(today));
  let sheet = null;          // { mode:'new'|'edit', day, slot, res, confirmDel }
  let pendingDel = null;     // 설정에서 삭제 확인 대기 중인 보조 종목 id
  let pendingMode = null;    // 설정에서 훈련방식 바꾸기 확인 대기 { id, mode, w, name }
  let confirmReset = false;
  let remote = null;         // Claude 계정 저장소(db) 문서, 없으면 이 기기에만 저장
  let toastTimer = 0;

  function fresh() { return { v: 1, updatedAt: 0, started: false, cfg: L.defaultConfig(today), logs: [] }; }

  // ---------- 저장 ----------
  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const x = JSON.parse(raw), out = sanitize(x);
      // 예전 판 데이터: 오래 쉬면 처음부터 다시 하는 규칙을 적용하기 시작한 날을 바로 남겨 둔다 (열 때마다 늦춰지지 않게).
      if (out && !(x.cfg && x.cfg.restFrom)) { try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* 저장소를 쓸 수 없는 환경 */ } }
      return out;
    } catch (e) { return null; }
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 저장소를 쓸 수 없는 환경 */ }
  }
  // 숫자 목록 (무게·횟수). int면 정수, sorted면 겹침 없이 오름차순.
  function numList(v, { int = false, sorted = true, max = 60 } = {}) {
    const arr = (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[^0-9.]+/)).map(Number)
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000).map((n) => (int ? Math.round(n) : Math.round(n * 100) / 100)).filter((n) => n > 0);
    return (sorted ? [...new Set(arr)].sort((a, b) => a - b) : arr).slice(0, max);
  }
  function sanitize(x) {
    if (!x || typeof x !== 'object' || !x.cfg || !Array.isArray(x.logs)) return null;
    const base = L.defaultConfig(today);
    const c = L.migrate(JSON.parse(JSON.stringify(x.cfg)));
    const g = c.gear && typeof c.gear === 'object' ? c.gear : {};
    const bandNames = Array.isArray(g.bands) ? [...new Set(g.bands.filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean))].slice(0, 20) : base.gear.bands;
    const cfg = {
      cv: c.cv,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(c.startDate) ? c.startDate : today,
      restFrom: /^\d{4}-\d{2}-\d{2}$/.test(c.restFrom) ? c.restFrom : null,
      from: sanitizeFrom(c.from),
      restSec: sanitizeRest(c.restSec),
      plates: Array.isArray(c.plates) ? [...L.plateCounts(c.plates)].flatMap(([p, n]) => Array(Math.min(n, PAIR_MAX)).fill(p)).sort((a, b) => a - b) : base.plates,
      gear: {
        db: Array.isArray(g.db) ? numList(g.db) : base.gear.db,
        bars: Array.isArray(g.bars) ? numList(g.bars) : base.gear.bars,
        one: Array.isArray(g.one) ? numList(g.one) : base.gear.one,
        bands: bandNames,
      },
      main: sanitizeMain(sanitizeProg(Object.assign({}, base.main, c.main || {}))),
      acc: Array.isArray(c.acc) ? c.acc.filter((a) => a && a.id && (a.day === 'D' || a.day === 'S')).map(sanitizeAcc) : base.acc,
    };
    const seen = new Set();
    const logs = x.logs
      .filter((l) => l && /^\d{4}-\d{2}-\d{2}$/.test(l.d) && !seen.has(l.d) && seen.add(l.d))
      .map((l) => {
        const o = { d: l.d, res: l.res && typeof l.res === 'object' ? l.res : {} };
        if (l.p) o.p = 1;
        if (l.b && typeof l.b === 'object') {
          const b = {};
          for (const [id, v] of Object.entries(l.b)) if (Array.isArray(v)) b[id] = v.filter((s) => typeof s === 'string');
          if (Object.keys(b).length) o.b = b;
        }
        const s = sanitizeSnap(l.s);
        if (s) o.s = s;
        return o;
      })
      .sort((a, b) => (a.d < b.d ? -1 : 1));
    // 오래 쉬면 처음부터 다시 하는 규칙은 이 판을 처음 연 뒤의 운동부터 적용한다 (그 전에 한 기록은 그대로).
    if (!cfg.restFrom) cfg.restFrom = L.toStr(Math.max(L.toNum(today), logs.length ? L.toNum(logs[logs.length - 1].d) + 1 : -Infinity));
    // 예전 판에서 한 기록에도 그날의 상태를 남겨 둔다 (이제부터 설정을 바꿔도 지난 기록은 그대로).
    L.snapLogs(cfg, logs);
    return { v: 1, updatedAt: +x.updatedAt || 0, started: !!x.started || logs.length > 0, cfg, logs };
  }
  // 기록에 남긴 그날의 상태 (logic.js snapLogs 참고). 모양이 맞지 않는 것은 버리고 다시 계산한다.
  function sanitizeSnap(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    const wv = (v) => (fin(v) && v > 0 ? v : null);
    const cnt = (v, d) => (fin(v) && v >= 1 ? Math.round(v) : d);
    const m = s.main;
    if (!m || typeof m !== 'object' || ![m.l, m.s, m.t, m.b].every(fin)) return null;
    const out = { main: { l: Math.round(m.l), s: Math.round(m.s), t: Math.round(m.t), b: Math.max(1, Math.round(m.b)), f: m.f ? 1 : 0, top: m.top ? 1 : 0,
      k: m.k === 'w' ? 'w' : 'r', W: wv(m.W), r: cnt(m.r, 5), e: cnt(m.e, 3) } };
    if (wv(m.Q)) out.main.Q = m.Q;
    for (const [id, v] of Object.entries(s)) {
      if (id === 'main' || !v || typeof v !== 'object' || !L.MODE_KEYS.includes(v.m) || ![v.t, v.n].every(fin)) continue;
      out[id] = { m: v.m, w: wv(v.w), t: Math.round(v.t), n: Math.round(v.n), k: v.k === 'r' ? 'r' : 'w', W: wv(v.W), r: cnt(v.r, 5), e: cnt(v.e, 3), f: v.f ? 1 : 0 };
      if (v.i === 'kg' || v.i === 'pct') Object.assign(out[id], { i: v.i, v: fin(v.v) && v.v >= 0 ? v.v : 5 });
    }
    return out;
  }
  // 하체 증량 방식: 데드리프트·스쿼트마다 % 또는 kg, 기록 중에 바꾼 내역 ichg [{no, id, inc}]
  function sanitizeMain(m) {
    const inc = m.inc && typeof m.inc === 'object' ? m.inc : {};
    // 'pct' 또는 kg 숫자 (예전 판의 'kg'는 그때 kg 값으로)
    const kg = Number(m.kg) > 0 ? Number(m.kg) : 5;
    const one = (v) => (v === 'kg' ? kg : Number(v) > 0 && Number(v) <= 50 ? Number(v) : 'pct');
    m.inc = { dl: one(inc.dl), sq: one(inc.sq) };
    delete m.kg;
    m.ichg = Array.isArray(m.ichg) ? m.ichg.filter((x) => x && Number(x.no) >= 1 && L.LIFTS.includes(x.id))
      .map((x) => ({ no: Math.floor(Number(x.no)), id: x.id, inc: one(x.inc) })).sort((p, q) => p.no - q.no) : [];
    return m;
  }
  // 진행 방식: r 횟수 고정 · w 무게 고정(횟수 단계 ladder)
  function sanitizeProg(o) {
    o.prog = o.prog === 'r' ? 'r' : 'w';
    o.reps = Math.max(1, Math.round(Number(o.reps)) || 5);
    o.sets = Math.max(1, Math.round(Number(o.sets)) || 3);
    o.ladder = numList(o.ladder, { int: true, sorted: false, max: 12 });
    if (!o.ladder.length) o.ladder = [o.reps];
    return o;
  }
  function sanitizeAcc(a) {
    const b = sanitizeProg(Object.assign({ name: '종목', part: '', mode: 'dumbbell', w: null, prog: 'w', reps: 5, sets: 3, rest: '', inc: 'pct', incV: 5, from: 1 }, a));
    if (!L.MODE_KEYS.includes(b.mode)) b.mode = 'dumbbell';
    b.w = Number(b.w) > 0 ? Number(b.w) : null;
    if (b.mode === 'band') b.w = null;
    b.inc = b.inc === 'kg' ? 'kg' : 'pct';
    b.incV = Number(b.incV) >= 0 ? Number(b.incV) : 5;
    b.stack = numList(b.stack);
    b.bands = Array.isArray(b.bands) ? b.bands.filter((s) => typeof s === 'string') : [];
    b.chg = Array.isArray(b.chg) ? b.chg.filter((x) => x && Number(x.no) >= 1 && L.MODE_KEYS.includes(x.mode)).map((x) => {
      const o = { no: Math.floor(Number(x.no)), mode: x.mode, w: x.mode !== 'band' && Number(x.w) > 0 ? Number(x.w) : null };
      if (typeof x.name === 'string' && x.name.trim()) o.name = x.name.trim();
      return o;
    }).sort((p, q) => p.no - q.no) : [];
    b.from = Math.max(1, Math.floor(Number(b.from)) || 1);
    // 세션 중간에 넣은 종목: 넣을 때 그 세션에서 지난 운동 수 (그 세션의 남은 차례만 한다)
    const k = Math.floor(Number(b.fromK));
    if (k >= 1 && k <= 5) b.fromK = k; else delete b.fromK;
    for (const key of ['equip', 'light', 'sw', 'phase']) delete b[key];
    return b;
  }
  // 종목별 휴식 타이머 시간(초). 타이머에서 처음 정하면 저장된다.
  function sanitizeRest(r) {
    const out = {};
    if (r && typeof r === 'object') for (const [id, v] of Object.entries(r)) { const n = Math.round(Number(v)); if (n >= 5 && n <= 3600) out[id] = n; }
    return out;
  }
  // 시작 지점: 적힌 값만 남긴다 (빠진 상체 단계는 하체 단계에 맞춘 기본값을 쓴다).
  function sanitizeFrom(f) {
    const sp = L.startPoint({ from: f });
    const acc = {};
    for (const [id, o] of Object.entries(sp.acc)) {
      if (!o || typeof o !== 'object') continue;
      const b = {};
      if (Number.isFinite(Number(o.step)) && o.step !== null && o.step !== '') b.step = Math.max(-9, Math.min(20, Math.floor(o.step)));
      if (Number(o.n) > 0) b.n = Math.floor(o.n);
      if (Number(o.w) > 0) b.w = Number(o.w);   // 훈련방식을 바꾼 구간에서 시작할 때 그 지점의 무게
      acc[id] = b;
    }
    return { no: sp.no, k: sp.k, stage: sp.stage, acc };
  }

  let writing = false, again = false;
  async function pushRemote() {
    if (!remote) return;
    if (writing) { again = true; return; }
    writing = true;
    try { await remote.set(JSON.parse(JSON.stringify(data))); }
    catch (e) {
      const code = e && e.code;
      if (code === 'unavailable') { again = true; await new Promise((r) => setTimeout(r, 800 + Math.random() * 800)); }
      else { remote = null; renderSettingsStorage(); }
    }
    writing = false;
    if (again && remote) { again = false; pushRemote(); }
  }

  async function connectRemote() {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') return;
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      const ref = db.doc('data/users/' + uid + '/routine');
      const snap = await ref.get();
      const theirs = snap.exists ? sanitize(snap.data()) : null;
      remote = ref;
      // 이 기기에서 아직 시작하지 않았으면(시작 전에 운동만 골라 둔 상태 포함) 계정에 있는 기록을 쓴다.
      if (theirs && theirs.started && (!data.started || theirs.updatedAt > data.updatedAt)) { data = theirs; saveLocal(); render(); if (tab === 'settings') renderSettings(); }
      else if (data.started && (!theirs || data.updatedAt > theirs.updatedAt)) pushRemote();
      renderSettingsStorage();
    } catch (e) { remote = null; }
  }

  function commit(msg) {
    data.started = true;
    data.updatedAt = Date.now();
    saveLocal();
    pushRemote();
    render();
    if (msg) toast(msg);
  }

  // ---------- 계산 ----------
  // sim: 기록을 처음부터 다시 돌린 결과(달력·처방). until 날짜까지, minSessions 세션까지 예상(모두 성공 가정)을 채운다.
  function model(until, minSessions = 0) {
    const sim = L.simulate(data.cfg, data.logs, today, { until, minSessions });
    return { cfg: data.cfg, sim, tl: sim, cur: sim.cur };
  }

  const r2 = (x) => Math.round(x * 100) / 100;   // 입력한 무게는 0.01kg까지 그대로 (1.25kg 원판 등)
  const md = (n) => { const s = L.toStr(n); return +s.slice(5, 7) + '.' + +s.slice(8, 10); };
  const longDate = (n) => { const s = L.toStr(n); return `${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일 (${DOW[L.weekday(n)]})`; };
  // 1단계 아래(실패하거나 오래 쉬어 내려간 단계)는 1단계 바로 아래를 −1단계로 센다.
  const stageText = (main) => `묶음 ${main.bundle} · ${main.stage >= 1 ? main.stage : '−' + (1 - main.stage)}단계`;
  function wHtml(row) {
    const s = L.fmtW(row);
    return s.endsWith('kg') ? `${esc(s.slice(0, -2))}<span class="unit">kg</span>` : esc(s);
  }
  // 그 날 무게를 무엇으로 맞추는지 (원판·무게추·밴드). 덤벨처럼 무게 그대로인 종목은 null.
  function plates(row) {
    if (row.skip) return null;
    return L.loadInfo(row, data.cfg);
  }
  const modeName = (m) => (L.MODES[m] ? L.MODES[m].name : '');
  // 받침에 따라 조사 고르기: josa('덤벨컬', '을', '를') → 덤벨컬을, josa('바벨', '으로', '로') → 바벨로
  function josa(word, withB, noB) {
    const c = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
    if (!(c >= 0 && c <= 11171)) return word + noB;
    const b = c % 28;
    return word + (b && !(withB === '으로' && b === 8) ? withB : noB);
  }
  const toMode = (m) => josa(modeName(m), '으로', '로');
  const BALANCE_NOTE = '<strong>좌우 균형:</strong> 원판을 더 끼운 쪽은 끝까지 밀어 넣고 바깥으로 움직이지 않게 마구리로 고정하세요. 반대쪽은 원판을 조금 바깥쪽에 둔 채 마구리를 끼우세요.';
  const STEPS = ['', '한', '두'];
  function flags(row) {
    let f = '';
    if (row.retry) f += '<span class="flag retry">재도전</span>';
    if (row.rested) f += `<span class="flag rest">쉬어서 ${STEPS[row.rested] || row.rested} 단계 낮춤</span>`;
    if (row.lag) f += `<span class="flag lag">밀림 · 세션 ${row.accNo} 몫</span>`;
    return f;
  }

  // ---------- 오래 쉬면 처음부터 (알림) ----------
  // 오늘 할 종목마다 쉰 날 수(마지막으로 한 다음 날부터 어제까지)를 보고, 오늘 처음부터 다시 하게 된 종목과
  // 이틀·오늘 하루 더 쉬면 처음부터 다시 하게 되는 종목을 알린다. 같은 내용은 종목 이름을 묶어 한 줄로.
  function gapNotes(sim) {
    const g = sim.gaps;
    if (!data.started || !g || g.day !== L.toNum(today)) return [];
    const more = (k) => (k === 2 ? '이틀 더' : '오늘 하루 더');
    const out = new Map();
    const add = (text, name) => { if (!out.has(text)) out.set(text, []); out.get(text).push(name); };
    for (const x of g.items) {
      const name = x.main ? '데드리프트·스쿼트' : x.name;
      if (x.dropped) {
        const k = L.GAP2 - x.rest;
        add(`${x.rest}일 쉬어서 ${x.today ? '오늘 ' : ''}세션을 처음부터 다시 해요. ${STEPS[x.dropped]} 단계 낮췄어요.${x.dropped < 2 && (k === 1 || k === 2) ? ` ${more(k)} 쉬면 한 단계 더 낮아져요.` : ''}`, name);
      } else {
        const k = L.GAP1 - x.rest;
        if (k === 1 || k === 2) add(`쉰 지 ${x.rest}일째예요. ${more(k)} 쉬면 세션이 처음부터 다시 시작되고 한 단계 낮아져요.`, name);
      }
    }
    return [...out].map(([text, names]) => ({ text, names }));
  }
  function renderGaps(m) {
    const el = $('gapNote');
    const notes = gapNotes(m.sim);
    el.hidden = !notes.length;
    el.innerHTML = notes.length ? `<p><strong>오래 쉬면 세션을 처음부터 다시 해요</strong></p>
      <ul>${notes.map((n) => `<li><b>${esc(n.names.join(' · '))}</b> ${esc(n.text)}</li>`).join('')}</ul>
      <p class="small">한 종목을 ${L.GAP1}일 이상 쉬면 그 종목의 세션을 처음부터 다시 하고 한 단계, ${L.GAP2}일 이상이면 두 단계 낮춰요.</p>` : '';
  }

  // ---------- 그리기 ----------
  function render() {
    // 시작 전에는 시작일이 늘 오늘이다 (운동을 골라 두고 며칠 뒤에 시작해도 오늘부터).
    if (!data.started && !data.logs.length && data.cfg.startDate !== today) data.cfg.startDate = today;
    const m = model(weekMon + 6);
    renderHeader(m);
    if (tab === 'week') { renderGaps(m); renderWeek(m); }
    if (tab === 'plan') renderPlan();
    if (tab === 'chart') renderChart();
    if (tab === 'settings' && !$('view-settings').childElementCount) renderSettings();
    $('welcome').hidden = data.started || tab !== 'week';
    if (!data.started) renderPick();
    if (sheet) renderSheet(m);
    pushRest();
  }

  function renderHeader(m) {
    const cur = m.cur;
    $('status').innerHTML = `<strong>세션 ${cur.no}</strong> · ${cur.n}/6 완료<br>${esc(stageText(cur.presc))}`;
    const showWeek = tab === 'week';
    document.querySelector('.weeknav').hidden = !showWeek;
    $('strip').hidden = !showWeek;
    if (!showWeek) return;
    $('range').textContent = `${md(weekMon)} – ${md(weekMon + 6)}`;
    $('thisWeek').disabled = weekMon === L.mondayOf(m.tl.today);
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = weekMon + i;
      const e = m.tl.days.get(d);
      let cls = '';
      if (e && (e.kind === 'plan' || e.kind === 'log')) {
        cls = e.type;
        if (e.kind === 'log') cls += e.rows.some((r) => r.result === false) ? ' fail' : ' done';
      } else if (e && e.kind === 'gap') cls = 'rest';
      else if (e && e.kind === 'miss') cls = 'miss';
      html += `<button type="button" role="listitem" data-act="jump" data-day="${d}" class="${d === m.tl.today ? 'is-today' : ''}">
        <span class="dow">${DOW[L.weekday(d)]}</span><span class="dnum">${+L.toStr(d).slice(8, 10)}</span><span class="mark ${cls}"></span></button>`;
    }
    $('strip').innerHTML = html;
  }

  // rows: 그 날 할 운동(avail ok·skip·wait). logged면 종목별 결과(✓·✗·안 함)를 붙인다.
  function exTable(rows, logged, type) {
    const live = rows.filter((r) => r.avail === 'ok');
    const skipped = rows.filter((r) => r.avail === 'skip');
    const waiting = rows.filter((r) => r.avail === 'wait');
    let h = `<table class="ex"><thead><tr><th>종목</th><th class="c-w">무게</th><th class="c-r">회×세트</th><th class="c-t">휴식</th>${logged ? '<th class="c-s"><span hidden>결과</span></th>' : ''}</tr></thead><tbody>`;
    let unbalanced = false;
    for (const r of live) {
      const mark = !logged ? '' : r.result === true ? '<span class="ok-t" aria-label="성공">✓</span>'
        : r.result === false ? '<span class="bad-t" aria-label="실패">✗</span>' : '<span class="no-t" aria-label="안 함">–</span>';
      const undone = logged && r.result == null;
      const pl = undone ? null : plates(r);
      if (pl && pl.unbalanced) unbalanced = true;
      h += `<tr class="${r.main ? 'main' : ''}${pl ? ' with-plate' : ''}${undone ? ' undone' : ''}"><td><div class="nm">${esc(r.name)}${flags(r)}</div><div class="pt">${esc(r.main ? '하체 메인' : [r.part, modeName(r.mode)].filter(Boolean).join(' · '))}${undone ? ' · 안 함 → 다음 ' + TYPE_NAME[type] + ' 날로' : ''}</div></td>
        <td class="c-w">${wHtml(r)}</td><td class="c-r">${r.reps}×${r.sets}</td><td class="c-t">${esc(r.rest)}</td>${logged ? `<td class="c-s">${mark}</td>` : ''}</tr>`;
      if (pl) h += `<tr class="plate"><td colspan="${logged ? 5 : 4}"><span class="pl">${pl.label}</span>${esc(pl.text)}</td></tr>`;
    }
    h += '</tbody></table>';
    if (unbalanced) h += `<div class="skipnote balance">${BALANCE_NOTE}</div>`;
    if (waiting.length) h += `<div class="skipnote">이번 차례는 이미 해서 하체가 따라올 때까지 쉬어요: ${waiting.map((r) => esc(r.name)).join(', ')}</div>`;
    if (skipped.length) h += `<div class="skipnote">하체가 마지막 단계인 세션이라 상체·팔은 쉬어요: ${skipped.map((r) => esc(r.name)).join(', ')}</div>`;
    return h;
  }

  function renderWeek(m) {
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = weekMon + i;
      const e = m.tl.days.get(d);
      const isToday = d === m.tl.today;
      const date = `<div class="daydate"><span class="dow">${DOW[L.weekday(d)]}</span><span class="md num">${md(d)}</span></div>`;
      const todayTag = isToday ? '<span class="tag today">오늘</span>' : '';
      if (!e) {
        // 아직 기록이 없을 때 시작일 이전의 지난 날: 이미 하던 루틴이면 이 날을 시작 지점으로 옮겨 이어서 기록한다.
        const past = d < m.tl.start && d <= m.tl.today && !data.logs.length;
        html += `<section class="day quiet${isToday ? ' is-today' : ''}" id="d${d}"><div class="dayhead">${date}<div class="dayinfo">${todayTag ? `<div class="tagline">${todayTag}</div>` : ''}<div class="meta">${d < m.tl.start ? '프로그램 시작 전' : ''}${past ? ' · 이미 하던 루틴이면 이 날부터 이어서 기록할 수 있어요' : ''}</div></div></div>
          ${past ? `<div class="dayfoot"><button class="btn ghost" type="button" data-act="startAt" data-day="${d}">이 날 운동했어요 · 이어서 시작</button></div>` : ''}</section>`;
        continue;
      }
      if (e.kind === 'gap') {
        const can = L.canLog(m.tl, d);
        html += `<section class="day quiet${isToday ? ' is-today' : ''}" id="d${d}"><div class="dayhead">${date}<div class="dayinfo"><div class="tagline">${todayTag}<span class="tag rest">휴식</span></div><div class="meta">세션 6번째 운동을 마친 다음 날이라 쉬어요</div></div></div>
          ${can ? `<div class="dayfoot">${isToday ? timerButton() : ''}<button class="btn ghost" type="button" data-act="log" data-day="${d}">${isToday ? '오늘 운동한다면' : '이 날도 운동했다면'} · 기록하기</button><span class="hint">기록하면 운동한 날로 계산해요</span></div>` : ''}</section>`;
        continue;
      }
      if (e.kind === 'miss') {
        const can = L.canLog(m.tl, d);
        html += `<section class="day quiet" id="d${d}"><div class="dayhead">${date}<div class="dayinfo"><div class="tagline"><span class="tag line">기록 없음</span></div><div class="meta">쉰 날로 보고 이날 운동을 다음 날로 미뤘어요</div></div></div>
          ${can ? `<div class="dayfoot"><button class="btn ghost" type="button" data-act="log" data-day="${d}">이 날 운동했어요 · 기록하기</button></div>` : ''}</section>`;
        continue;
      }
      const type = e.type;
      const isLog = e.kind === 'log';
      const ok = e.rows.filter((r) => r.avail === 'ok');
      const failed = isLog && ok.some((r) => r.result === false);
      const partial = isLog && ok.some((r) => r.result == null);
      const projected = e.kind === 'plan' && e.no > m.cur.no;
      let tags = todayTag + `<span class="tag ${type}">${TYPE_NAME[type]}</span>`;
      if (isLog) tags += failed ? '<span class="tag bad">일부 실패</span>' : partial ? '<span class="tag line">일부만 함</span>' : '<span class="tag ok">완료</span>';
      if (projected) tags += '<span class="tag line">예상</span>';
      let meta = `세션 ${e.no} · ${e.pos + 1}/6 · ${stageText(e.main)}`;
      if (e.rows[0].restart) meta += ` · 하체를 ${e.rows[0].restart}일 쉬어서 세션을 처음부터`;
      if (isLog && e.rows[0].result == null) meta += ` · ${TYPE_NAME[type]}를 안 해서 다음 날도 ${TYPE_NAME[type]} 날`;
      if (e.restSkipped) meta += ' · 지난 세션 중 2일 이상 쉬어서 정식 휴식 없이 이어가요';
      let foot = '';
      if (isLog) foot = `<button class="btn ghost" type="button" data-act="edit" data-day="${d}">결과 고치기</button>`;
      else if (L.canLog(m.tl, d)) foot = `<button class="btn" type="button" data-act="log" data-day="${d}">운동 기록하기</button><span class="hint">끝나면 한 종목만 골라도 저장돼요</span>`;
      if (isToday) foot = timerButton() + foot;
      html += `<section class="day${isToday ? ' is-today' : ''}" id="d${d}"><div class="dayhead">${date}<div class="dayinfo"><div class="tagline">${tags}</div><div class="meta">${esc(meta)}</div></div></div>
        <div class="daybody">${exTable(e.rows, isLog, type)}</div>${foot ? `<div class="dayfoot">${foot}</div>` : ''}</section>`;
    }
    $('days').innerHTML = html;
  }

  function renderPlan() {
    const base = model(L.mondayOf(L.toNum(today)) + 6);
    const count = base.cur.i + 1 + 8;
    const m = model(L.toNum(today), count);
    const { sim, cfg } = m;
    let h = '<thead><tr><th>세션</th><th>하체 단계</th><th>데드리프트</th><th>스쿼트</th>';
    for (const a of cfg.acc) h += `<th class="wrap-h">${esc(a.name)}<br><span class="sdate">${a.day === 'D' ? '데드 날' : '스쿼트 날'}</span></th>`;
    h += '</tr></thead><tbody>';
    const mark = (v) => (v === true ? '<span class="res ok-t">✓</span>' : v === false ? '<span class="res bad-t">✗</span>' : '');
    for (let i = 0; i < count && sim.main[i]; i++) {
      const s = sim.main[i];
      const p = sim.view(s.no);
      const real = i < sim.real.main;
      const isCur = i === sim.real.main;
      const dates = s.firstDay == null ? '' : `${md(s.firstDay)}–${s.lastDay !== s.firstDay ? md(s.lastDay) : ''}`;
      const cls = [isCur ? 'cur' : i > sim.real.main ? 'proj' : '', p.main.stage === 1 && i > 0 ? 'bundle-start' : ''].join(' ');
      h += `<tr class="${cls}"><td><div class="sno">${s.no}</div><div class="sdate">${isCur ? `진행 중 ${m.cur.n}/6` : dates}</div></td>`;
      h += `<td class="stage">${esc(stageText(p.main))}${p.main.retry ? '<br>재도전' : ''}${p.main.rested ? '<br>쉬어서 낮춤' : ''}</td>`;
      h += `<td><span class="w">${L.roundW(p.main.dl)}</span>${mark(real ? s.out : null)}</td>`;
      h += `<td><span class="w">${L.roundW(p.main.sq)}</span>${mark(real ? s.out : null)}</td>`;
      for (const a of cfg.acc) {
        const q = p.acc[a.id];
        if (q.off || q.pending) { h += '<td></td>'; continue; }
        if (q.skip) { h += '<td class="rest">휴식</td>'; continue; }
        const ai = sim.real.acc[a.id];
        const out = i < ai ? sim.acc[a.id][i].out : null;
        const behind = i === ai && ai < sim.real.main ? '<span class="rp"> 밀림</span>' : '';
        const w = L.fmtW(q).replace('kg', '');
        const switched = q.mode !== a.mode || q.name !== a.name ? `<span class="rp"> ${esc(q.name !== a.name ? q.name : modeName(q.mode))}</span>` : '';
        const rested = q.rested ? '<span class="rp"> 쉬어서 낮춤</span>' : '';
        h += `<td><span class="w">${esc(w)}</span> <span class="rp">×${q.reps}</span>${mark(out)}${behind}${rested}${switched}</td>`;
      }
      h += '</tr>';
    }
    $('planTable').innerHTML = h + '</tbody>';
  }

  // ---------- 기록 그래프 ----------
  // 실제로 한 기록(성공·실패)만 그린다. 색은 종목에 고정(하체 → 설정의 보조 종목 순서)이라 숨기거나 늘어도 바뀌지 않는다.
  // 한눈에: 종목마다 무게·증량 폭이 달라 y축 크기는 버리고, 종목마다 처음 기록을 맨 아래·가장 많이 오른 때를 맨 위로 맞춰 겹쳐 그린다.
  //         오른 정도는 첫 기록 대비 누적 증량 %로 재고, 덤벨→바벨처럼 종목이 바뀌면 그 전 증량을 이어 받는다.
  let chartMode = 'all';
  const chartOff = new Set();
  const PALETTE = 8;
  function chartData() {
    const cfg = data.cfg;
    const slot = new Map([['main', 1]]);
    cfg.acc.forEach((a, i) => slot.set(a.id, i + 2 <= PALETTE ? i + 2 : 0));
    const color = (ent) => `var(--c${slot.get(ent) || 0})`;
    const sim = model(L.toNum(today)).sim;
    const each = new Map(), all = new Map(), recs = [];
    const logged = [...sim.days.entries()].filter(([, e]) => e.kind === 'log').sort((a, b) => a[0] - b[0]);
    for (const [d, e] of logged) {
      for (const r of e.rows) {
        if (r.result == null) continue;
        const ent = r.main ? 'main' : r.id;
        const key = r.main ? r.id : r.id + '.' + r.mode;
        const rel = r.w == null;
        const y = rel ? (r.inc === 'kg' ? r.n * r.incV : (Math.pow(1 + r.incV / 100, r.n) - 1) * 100) : L.roundW(r.w);
        const text = `${r.band ? (r.bands && r.bands.length ? r.bands.join('+') : '밴드') : L.fmtW(r)} × ${r.reps}회 × ${r.sets}세트 · ${r.result ? '성공' : '실패'}`;
        recs.push({ d, name: r.name, text });
        if (r.band) continue;   // 고무밴드는 무게가 없어 표로만 본다
        if (!each.has(key)) each.set(key, { key, ent, mode: r.mode, name: r.name, color: color(ent), unit: rel ? (r.inc === 'kg' ? '+kg' : '+%') : 'kg', pts: [] });
        each.get(key).pts.push({ x: d, y, ok: r.result, text });
        if (rel || !slot.get(ent)) continue;
        const w = r.main ? e.main.dl : r.w;
        const phase = r.mode;
        let s = all.get(ent);
        if (!s) {
          const a = cfg.acc.find((x) => x.id === ent);
          s = { key: ent, name: r.main ? '데드리프트·스쿼트' : a.name, color: color(ent), slot: slot.get(ent), pts: [], g: 1, prev: w, phase };
          all.set(ent, s);
        } else {
          if (phase === s.phase) s.g *= w / s.prev;
          s.prev = w; s.phase = phase;
        }
        const pct = Math.round((s.g - 1) * 100);
        s.pts.push({ x: d, g: s.g, ok: r.result, v: `${pct > 0 ? '+' : ''}${pct}%`, text: `${r.main ? `데드 ${L.roundW(e.main.dl)}kg` : L.fmtW(r)} · ${r.result ? '성공' : '실패'}` });
      }
    }
    // 한 종목을 여러 훈련방식으로 했으면 종목별 그래프를 방식마다 나눠 이름에 붙인다.
    const modes = new Map();
    for (const s of each.values()) if (s.ent !== 'main') modes.set(s.ent, (modes.get(s.ent) || 0) + 1);
    for (const s of each.values()) if (modes.get(s.ent) > 1) s.name += ` · ${modeName(s.mode)}`;
    for (const s of all.values()) {
      const top = Math.max(...s.pts.map((p) => p.g));
      for (const p of s.pts) p.y = top > 1 + 1e-9 ? (p.g - 1) / (top - 1) : 0;
    }
    const first = new Map();
    for (const s of each.values()) first.set(s.key, s.pts[0].x);
    const order = (x) => (x.key === 'dl' ? 0 : x.key === 'sq' ? 1 : (slot.get(x.ent) || 99));
    return { each: [...each.values()].sort((a, b) => order(a) - order(b) || first.get(a.key) - first.get(b.key)), all: [...all.values()].sort((a, b) => a.slot - b.slot), recs };
  }
  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / Math.max(1, n);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= raw) || 10 * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
    return out;
  }
  // 그래프 자리. 그린 뒤 drawPlot으로 채운다 (폭을 알아야 해서). fmt: kg · pct(누적 %) · rel(무게 생략 종목의 +kg). labels: 선 끝에 이름.
  function plotHtml({ h, fmt, labels }) {
    return `<div class="plot" data-h="${h}" data-labels="${labels ? 1 : 0}" data-fmt="${fmt}"></div>`;
  }
  // series: [{key, name, color, pts:[{x(일 번호), y, ok, text}]}]
  function drawPlot(el, series) {
    const W = Math.max(240, el.clientWidth), H = Number(el.dataset.h);
    const norm = el.dataset.fmt === 'norm';
    const fmt = el.dataset.fmt === 'rel' ? (v) => `+${Number(v.toFixed(1))}` : (v) => `${Number(v.toFixed(1))}`;
    const labels = el.dataset.labels === '1' && series.length <= 4;
    const xs = [...new Set(series.flatMap((s) => s.pts.map((p) => p.x)))].sort((a, b) => a - b);
    const ys = series.flatMap((s) => s.pts.map((p) => p.y));
    if (!xs.length) { el.innerHTML = ''; return; }
    let x0 = xs[0], x1 = xs[xs.length - 1];
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (norm) { y0 = 0; y1 = 1; }
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
    const ticks = norm ? [0, 1] : niceTicks(y0, y1, 3);
    const tickText = (t) => (norm ? (t ? '최고' : '처음') : fmt(t));
    const ml = 8 + Math.max(...ticks.map((t) => tickText(t).length * (norm ? 12 : 6.5))), mr = labels ? 92 : 10, mt = 10, mb = 22;
    const sx = (x) => ml + ((x - x0) / (x1 - x0)) * (W - ml - mr);
    const sy = (y) => mt + (1 - (y - y0) / (y1 - y0)) * (H - mt - mb);
    let g = '';
    for (const t of ticks) g += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${sy(t)}" y2="${sy(t)}"/><text class="axis" x="${ml - 6}" y="${sy(t) + 4}" text-anchor="end">${esc(tickText(t))}</text>`;
    const xt = xs.length <= 4 ? xs : [xs[0], xs[Math.round((xs.length - 1) / 3)], xs[Math.round((2 * (xs.length - 1)) / 3)], xs[xs.length - 1]];
    for (const x of [...new Set(xt)]) g += `<text class="axis" x="${sx(x)}" y="${H - 6}" text-anchor="middle">${md(x)}</text>`;
    for (const s of series) {
      if (s.pts.length > 1) g += `<path d="${s.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      // 점이 빽빽하면 실패한 날과 마지막 기록만 점으로 찍는다.
      const dense = s.pts.length * 10 > W - ml - mr;
      for (const [i, p] of s.pts.entries()) if (!dense || !p.ok || i === s.pts.length - 1) g += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="${p.ok ? s.color : 'var(--surface)'}" stroke="${p.ok ? 'var(--surface)' : s.color}" stroke-width="2"/>`;
    }
    if (labels) {
      const ends = series.map((s) => ({ s, y: sy(s.pts[s.pts.length - 1].y) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
      for (const e of ends) g += `<text class="dlabel" x="${W - mr + 8}" y="${e.y + 4}">${esc(e.s.name.length > 9 ? e.s.name.slice(0, 8) + '…' : e.s.name)}</text>`;
    }
    g += `<line class="cross" x1="0" x2="0" y1="${mt}" y2="${H - mb}" visibility="hidden"/>`;
    const name = series.length === 1 ? series[0].name : '여러 종목';
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" tabindex="0" role="img" aria-label="${esc(name)} 날짜별 기록 그래프. 화살표 키로 날짜를 옮겨 값을 볼 수 있어요">${g}</svg><div class="tip" hidden></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = el.querySelector('.cross');
    let cur = -1;
    const show = (i) => {
      cur = Math.max(0, Math.min(xs.length - 1, i));
      const x = xs[cur], px = sx(x);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const head = document.createElement('div'); head.className = 'td'; head.textContent = longDate(x); tip.append(head);
      for (const s of series) {
        // 그 날 기록이 없는 종목은 그때까지의 마지막 기록을 보여준다.
        const p = s.pts.filter((q) => q.x <= x).pop();
        if (!p) continue;
        const row = document.createElement('div'); row.className = 'tr';
        const key = document.createElement('i'); key.style.background = s.color;
        const box = document.createElement('div');
        const b = document.createElement('b'); b.textContent = p.v || fmt(p.y) + (el.dataset.fmt === 'kg' ? 'kg' : '');
        const sm = document.createElement('span'); sm.textContent = ` ${series.length > 1 ? s.name + ' · ' : ''}${p.text}${p.x < x ? ` (${md(p.x)})` : ''}`;
        box.append(b, sm); row.append(key, box); tip.append(row);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(0, px + 12 + tw > W ? px - tw - 12 : px + 12), Math.max(0, W - tw))}px`;
    };
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    const near = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let best = 0;
      xs.forEach((x, i) => { if (Math.abs(sx(x) - px) < Math.abs(sx(xs[best]) - px)) best = i; });
      show(best);
    };
    svg.addEventListener('pointermove', near);
    svg.addEventListener('pointerdown', near);
    svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hide(); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); show(cur < 0 ? xs.length - 1 : cur + (ev.key === 'ArrowRight' ? 1 : -1)); }
      else if (ev.key === 'Escape') hide();
    });
    svg.addEventListener('focus', () => show(cur < 0 ? xs.length - 1 : cur));
  }
  let chartSeries = [];
  function renderChart() {
    const view = $('view-chart');
    const { each, all, recs } = chartData();
    if (!recs.length) {
      view.innerHTML = '<div class="notice"><p><strong>아직 기록이 없어요.</strong> 운동을 기록하면 종목별 무게 변화가 날짜별 그래프로 나와요.</p></div>';
      return;
    }
    const seg = (v, t) => `<button type="button" data-act="chartMode" data-v="${v}" aria-pressed="${chartMode === v}">${t}</button>`;
    let h = `<div class="chartbar"><div class="seg" role="group" aria-label="그래프 보기">${seg('all', '한눈에')}${seg('each', '종목별')}</div>
      <span class="small">속 빈 점 = 실패한 날</span></div>`;
    if (chartMode === 'all') {
      const shown = all.filter((s) => !chartOff.has(s.key));
      chartSeries = [shown];
      h += `<div class="chartcard"><div class="charthead"><h2>모든 종목 증량 추이</h2><span class="from">높이 = 종목마다 처음 → 최고</span></div>
        <p class="small">종목마다 무게와 증량 폭이 달라 y축 크기는 맞추지 않았어요. 처음 기록을 맨 아래, 가장 많이 오른 때를 맨 위로 맞춰 겹쳤어요. 실제로 몇 % 올랐는지는 그래프를 누르면 보여요. 하체는 데드리프트와 스쿼트가 같이 오르내려 한 줄이고, 무게 생략 종목은 종목별 보기에 있어요.</p>
        <div class="legend2" role="group" aria-label="종목 보이기·숨기기">${all.map((s) => `<button type="button" data-act="chartToggle" data-key="${esc(s.key)}" aria-pressed="${!chartOff.has(s.key)}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('')}</div>
        ${shown.length ? plotHtml({ h: 280, fmt: 'norm', labels: true }) : '<p class="small">보일 종목을 위에서 골라 주세요.</p>'}</div>`;
    } else {
      chartSeries = each.map((s) => [s]);
      h += '<div class="charts">';
      for (const s of each) {
        const first = s.pts[0], last = s.pts[s.pts.length - 1];
        const val = (v) => (s.unit === 'kg' ? `${Number(v.toFixed(1))}kg` : s.unit === '+kg' ? `+${Number(v.toFixed(1))}kg` : `+${Math.round(v)}%`);
        h += `<div class="chartcard"><div class="charthead"><h2>${esc(s.name)}</h2><span><span class="now">${esc(val(last.y))}</span> <span class="from">처음 ${esc(val(first.y))} · ${s.pts.length}회</span></span></div>
          ${plotHtml({ h: 150, fmt: s.unit === 'kg' ? 'kg' : 'rel', labels: false })}</div>`;
      }
      h += '</div>';
    }
    h += `<details class="recs chartcard"><summary>표로 보기 · 기록 ${recs.length}개</summary><table class="rectable"><thead><tr><th>날짜</th><th>종목</th><th>기록</th></tr></thead><tbody>${recs.slice().reverse().map((r) => `<tr><td>${md(r.d)}</td><td>${esc(r.name)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table></details>`;
    view.innerHTML = h;
    view.querySelectorAll('.plot').forEach((el, i) => drawPlot(el, chartSeries[i]));
  }
  let chartResize = 0;
  window.addEventListener('resize', () => { clearTimeout(chartResize); chartResize = setTimeout(() => { if (tab === 'chart') renderChart(); }, 150); });

  // ---------- 휴식 타이머 ----------
  // 오늘 할 종목마다 따로 쓰는 휴식 타이머. 순서는 자유. 세트를 마치면 그 종목의 휴식 시작을 누르고,
  // 휴식이 "세트 수 − 1"번 끝나면 그 종목은 완료. 끝나는 시각을 저장해 화면이 꺼졌다 켜져도 남은 시간이 맞는다.
  // 진행 상태는 이 기기에만(그날 하루), 종목별 휴식 시간은 설정(data.cfg.restSec)에 저장한다.
  const TKEY = 'routine5.timer';
  let timer = loadTimer();
  let tickId = 0, audio = null, wake = null;
  function loadTimer() {
    try { const t = JSON.parse(localStorage.getItem(TKEY)); if (t && t.day === today && t.items) return t; } catch (e) { /* 저장소 없음 */ }
    return { day: today, items: {} };
  }
  function saveTimer() { try { localStorage.setItem(TKEY, JSON.stringify(timer)); } catch (e) { /* 저장소 없음 */ } }
  function tState(id) {
    if (timer.day !== today) timer = { day: today, items: {} };
    return timer.items[id] || (timer.items[id] = { n: 0, endAt: 0, dur: 0 });
  }
  const restNeed = (r) => Math.max(1, r.sets - 1);
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  // 설정의 휴식 글("3~5분", "90초")에서 처음 보여 줄 시간을 고른다 (짧은 쪽).
  function defaultRest(text) {
    const m = /(\d+(?:\.\d+)?)\s*(?:[~\-]\s*\d+(?:\.\d+)?)?\s*(분|초)?/.exec(text || '');
    if (!m) return 120;
    const v = parseFloat(m[1]);
    return Math.max(15, Math.round((m[2] === '초' ? v : v * 60) / 15) * 15);
  }
  const restSec = (id) => (data.cfg.restSec || {})[id];
  // 오늘 할 종목: 오늘 카드(예정·기록)의 종목, 오늘이 휴식일이면 기록할 수 있는 다음 차례.
  function timerInfo(m) {
    const T = L.toNum(today);
    const e = m.sim.days.get(T);
    const info = e && (e.kind === 'plan' || e.kind === 'log') ? e : L.canLog(m.sim, T) ? m.sim.next : null;
    return info ? { info, rows: info.rows.filter((r) => r.avail === 'ok') } : null;
  }
  const running = () => Object.values(timer.items).some((t) => t.endAt > Date.now());
  function timerButton() {
    return `<button class="btn ghost" type="button" data-act="timer">${running() ? '휴식 타이머 · 진행 중' : '휴식 타이머'}</button>`;
  }
  function openTimer() {
    sheet = { kind: 'timer', editing: null, opener: document.activeElement };
    $('sheet').hidden = false;
    renderTimer(model(weekMon + 6));
    const first = $('panel').querySelector('button, select');
    if (first) first.focus();
  }
  function renderTimer(m) {
    const t = timerInfo(m);
    let h = '<div><h2 id="sheetTitle">휴식 타이머</h2>';
    if (!t) {
      h += `<div class="sub">${longDate(L.toNum(today))}</div></div><p class="small">오늘은 할 운동이 없어요.</p><button class="btn ghost" type="button" data-act="close">닫기</button>`;
      $('panel').innerHTML = h;
      return;
    }
    const { info, rows } = t;
    const now = Date.now();
    const doneCount = rows.filter((r) => tState(r.id).n >= restNeed(r)).length;
    h += `<div class="sub">${longDate(L.toNum(today))} · ${TYPE_NAME[info.type]} 날 · 완료 ${doneCount}/${rows.length}종목</div></div>
      <p class="small">세트를 마치면 그 종목의 <strong>휴식 시작</strong>을 눌러요. 종목 순서는 자유예요. 휴식이 세트 수보다 한 번 적게 끝나면(3세트면 2번) 그 종목은 완료예요.</p>`;
    if (pushCan() && !pushOn()) h += '<p class="small note">앱을 닫아도 휴식이 끝날 때 알림을 받으려면 설정 → 알림을 켜 주세요.</p>';
    else if (!pushCan() && window.ROUTINE_STANDALONE && isIOS()) h += '<p class="small note">홈 화면에 추가한 앱으로 열면 앱을 닫아도 휴식이 끝날 때 알림을 받을 수 있어요.</p>';
    h += '<div class="tmrs">';
    for (const r of rows) {
      const st = tState(r.id);
      const need = restNeed(r);
      const sec = restSec(r.id);
      const run = st.endAt > now;
      const done = !run && st.n >= need;
      const editing = sec == null || sheet.editing === r.id;
      const setNo = Math.min(r.sets, st.n + 1);
      let dots = '';
      for (let i = 0; i < r.sets; i++) dots += `<i class="${i < st.n + (done ? 1 : 0) ? 'on' : ''}"></i>`;
      h += `<section class="tmr${run ? ' run' : ''}${done ? ' done' : ''}" aria-label="${esc(r.name)}">
        <div class="tmhead"><div><div class="nm">${esc(r.name)}</div><div class="rx"><b>${wHtml(r)}</b> · ${r.reps}회 × ${r.sets}세트</div></div>
          <div class="tmset"><span class="dots" aria-hidden="true">${dots}</span><span>${done ? '완료' : run ? `${st.n + 1}세트 끝 · 휴식 중` : `${setNo}세트째`}</span></div></div>`;
      if (editing) {
        const cur = sec == null ? defaultRest(r.rest) : sec;
        const mins = Array.from({ length: 11 }, (_, i) => `<option value="${i}" ${i === Math.floor(cur / 60) ? 'selected' : ''}>${i}분</option>`).join('');
        const secs = [0, 15, 30, 45].map((v) => `<option value="${v}" ${v === cur % 60 ? 'selected' : ''}>${v}초</option>`).join('');
        h += `<div class="tmedit"><span class="small">${sec == null ? `휴식 시간을 정해 주세요${r.rest ? ` (설정: ${esc(r.rest)})` : ''}` : '휴식 시간 바꾸기'}</span>
          <div class="tmpick"><select id="tm-m-${esc(r.id)}" aria-label="분">${mins}</select><select id="tm-s-${esc(r.id)}" aria-label="초">${secs}</select>
          <button class="btn" type="button" data-act="tSave" data-id="${esc(r.id)}">저장</button></div></div>`;
      } else if (run) {
        const left = Math.max(0, (st.endAt - now) / 1000);
        h += `<div class="tmclock num" id="tc-${esc(r.id)}" role="timer" aria-live="off">${clock(Math.ceil(left))}</div>
          <div class="tmbar"><span id="tb-${esc(r.id)}" style="width:${(100 * (1 - left / st.dur)).toFixed(1)}%"></span></div>
          <div class="btnrow"><button class="btn ghost" type="button" data-act="tSkip" data-id="${esc(r.id)}">휴식 끝내기</button></div>`;
      } else if (done) {
        h += `<div class="tmdone"><span class="ok-t">✓ ${r.sets}세트 완료</span><button class="btn ghost" type="button" data-act="tReset" data-id="${esc(r.id)}">처음부터</button></div>`;
      } else {
        const last = r.sets <= 1;
        h += `<button class="btn block tmgo" type="button" data-act="tStart" data-id="${esc(r.id)}">${last ? '세트 완료로 표시' : `${st.n + 1}세트 끝 · 휴식 시작 ${clock(sec)}`}</button>
          <div class="tmmore"><button class="linkbtn" type="button" data-act="tEdit" data-id="${esc(r.id)}">휴식 ${clock(sec)} 바꾸기</button>${st.n ? `<button class="linkbtn" type="button" data-act="tUndo" data-id="${esc(r.id)}">한 세트 되돌리기</button>` : ''}</div>`;
      }
      h += '</section>';
    }
    h += `</div><button class="btn ghost" type="button" data-act="close">닫기 · 타이머는 계속 돌아요${pushOn() ? ' · 끝나면 알림' : ''}</button>`;
    const panel = $('panel');
    const top = panel.scrollTop;
    panel.innerHTML = h;
    panel.scrollTop = top;
  }
  function beep() {
    try {
      if (!audio) return;
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      const t0 = audio.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      for (let i = 0; i < 3; i++) { g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.25); }
      o.start(t0); o.stop(t0 + 1.1);
    } catch (e) { /* 소리를 못 내는 환경 */ }
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (e) { /* 진동 없음 */ }
  }
  async function keepAwake(on) {
    try {
      if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      else if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { wake = null; }
  }
  // 끝난 휴식을 세고, 열린 타이머 화면의 시계만 갱신한다.
  function tick() {
    const now = Date.now();
    let finished = null;
    for (const [id, st] of Object.entries(timer.items)) {
      if (st.endAt && st.endAt <= now) {
        st.endAt = 0; st.n += 1; finished = id;
        if (document.visibilityState === 'visible') pushCancel(id);   // 앱이 소리로 알렸으니 알림은 보내지 않는다
      }
    }
    if (finished) {
      saveTimer();
      beep();
      const m = model(weekMon + 6), t = timerInfo(m);
      const r = t && t.rows.find((x) => x.id === finished);
      if (r) toast(tState(r.id).n >= restNeed(r) ? `${r.name} 휴식 끝 · 마지막 세트 하고 완료예요` : `${r.name} 휴식 끝 · ${tState(r.id).n + 1}세트 시작`);
      if (sheet && sheet.kind === 'timer') renderTimer(m);
      if (tab === 'week') renderWeek(m);
    } else if (sheet && sheet.kind === 'timer') {
      for (const [id, st] of Object.entries(timer.items)) {
        if (!(st.endAt > now)) continue;
        const left = (st.endAt - now) / 1000;
        const c = $('tc-' + id), b = $('tb-' + id);
        if (c) c.textContent = clock(Math.ceil(left));
        if (b) b.style.width = `${(100 * (1 - left / st.dur)).toFixed(1)}%`;
      }
    }
    if (!running()) { clearInterval(tickId); tickId = 0; keepAwake(false); }
  }
  function startTick() { if (!tickId) tickId = setInterval(tick, 250); keepAwake(true); }
  function timerAct(act, id) {
    const m = model(weekMon + 6), t = timerInfo(m);
    const r = t && t.rows.find((x) => x.id === id);
    if (!r) return;
    const st = tState(id);
    if (act === 'tStart') {
      if (!audio) { try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); } catch (e) { audio = null; } }
      if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
      if (r.sets <= 1) st.n = restNeed(r);
      else { st.dur = restSec(id); st.endAt = Date.now() + st.dur * 1000; startTick(); pushTimer(r, st); }
    } else if (act === 'tSkip') { st.endAt = 0; st.n += 1; pushCancel(id); }
    else if (act === 'tUndo') { st.n = Math.max(0, st.n - 1); pushCancel(id); }
    else if (act === 'tReset') { st.n = 0; st.endAt = 0; pushCancel(id); }
    else if (act === 'tEdit') sheet.editing = id;
    else if (act === 'tSave') {
      const sec = Number($('tm-m-' + id).value) * 60 + Number($('tm-s-' + id).value);
      if (!(sec >= 5)) { toast('휴식 시간을 5초 이상으로 골라 주세요'); return; }
      data.cfg.restSec = Object.assign({}, data.cfg.restSec, { [id]: sec });
      sheet.editing = null;
      saveTimer();
      commit(`${r.name} 휴식 ${clock(sec)}로 저장했어요`);
      return;
    }
    saveTimer();
    renderTimer(m);
    if (tab === 'week') renderWeek(m);
    const again = $('panel').querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (again) again.focus();
  }

  // ---------- 알림 (앱을 닫아도: 휴식 타이머 끝 · 쉬는 날) ----------
  // 알림 서버(push/, Cloudflare Workers)에 보낼 시각과 내용을 맡기면 그때 웹 푸시로 보낸다.
  // 아이폰은 홈 화면에 추가한 앱(iOS 16.4 이상), 안드로이드는 Chrome·삼성 인터넷 등에서 켤 수 있다. Claude 링크에서는 쓸 수 없다.
  // 기기마다 따로 켠다: 이 기기의 id·켜짐 여부는 PKEY에만 둔다 (기록 데이터와 따로).
  const PUSH_API = 'https://routine-push.peanutlover.workers.dev/api';
  const VAPID = 'BBb9z0ezYxfSrktik_pHH6Z1D4C7ZBO5BxTkWa-ZTxYXjOgDLSXvhE73lA68Iqq5bU2cTqflqNHAHS2pl28th5E';
  const PKEY = 'routine5.push';
  let push = loadPush();     // { id, on, ep: 구독 주소, rest: 마지막으로 맡긴 쉬는 날 알림 }
  let pushBusy = false;
  function loadPush() {
    try { const p = JSON.parse(localStorage.getItem(PKEY)); if (p && typeof p === 'object') return p; } catch (e) { /* 저장소 없음 */ }
    return { on: false };
  }
  function savePush() { try { localStorage.setItem(PKEY, JSON.stringify(push)); } catch (e) { /* 저장소 없음 */ } }
  const pushCan = () => !!(window.ROUTINE_STANDALONE && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  const pushOn = () => !!(push.on && push.id && pushCan() && Notification.permission === 'granted');
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function keyBytes(s) {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
  }
  // text/plain으로 보내 미리 묻는 요청(CORS preflight) 없이 바로 간다. keepalive: 앱을 닫는 순간에 보낸 것도 가게.
  async function pushApi(body) {
    const res = await fetch(PUSH_API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ id: push.id }, body)), keepalive: true });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error || 'push ' + res.status), { code: out.error });
    return out;
  }
  // 이 기기 구독을 만들거나(다른 서버 키로 만든 구독이면 새로) 그대로 쓰고 서버에 알린다.
  async function pushSubscribe() {
    const reg = await navigator.serviceWorker.ready;
    const key = keyBytes(VAPID);
    let sub = await reg.pushManager.getSubscription();
    const k = sub && sub.options && sub.options.applicationServerKey;
    if (sub && k && b64u(new Uint8Array(k)) !== VAPID) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    if (!push.id) { const b = new Uint8Array(18); crypto.getRandomValues(b); push.id = b64u(b); }
    await pushApi({ sub: sub.toJSON() });
    push.ep = sub.endpoint;
    savePush();
  }
  async function pushEnable() {
    if (!pushCan() || pushBusy) return;
    pushBusy = true;
    renderPushCard();
    try {
      const perm = await Notification.requestPermission();   // 누른 그 자리에서 물어야 한다 (아이폰)
      if (perm !== 'granted') { toast(perm === 'denied' ? '알림이 막혀 있어요. 휴대폰 설정에서 허용해 주세요' : '알림을 허용해야 켤 수 있어요'); return; }
      await pushSubscribe();
      push.on = true; push.rest = null; savePush();
      pushRest();
      toast('알림을 켰어요. 테스트 알림으로 확인해 보세요');
    } catch (e) {
      toast(e && e.code === 'endpoint' ? '이 브라우저의 알림은 지원하지 않아요' : '알림을 켜지 못했어요. 인터넷 연결을 확인해 주세요');
    } finally { pushBusy = false; renderPushCard(); }
  }
  async function pushDisable() {
    if (pushBusy) return;
    pushBusy = true;
    renderPushCard();
    try { if (push.id) await pushApi({ off: true }); } catch (e) { /* 서버에 못 알려도 구독을 끊으면 오지 않는다 */ }
    try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* 이미 없음 */ }
    push.on = false; push.rest = null; push.ep = null; savePush();
    pushBusy = false;
    renderPushCard();
    toast('이 기기 알림을 껐어요');
  }
  function pushTest() {
    pushApi({ put: [{ tag: 'test', in: 5000, title: '웨이트 루틴', body: '알림이 이렇게 와요. 휴식 타이머가 끝나면 이렇게 알려줘요.', ttl: 120, urgent: true }] })
      .then(() => toast('5초 뒤에 알림이 와요. 화면을 끄거나 다른 앱으로 가 보세요'))
      .catch(() => toast('알림 서버에 연결하지 못했어요'));
  }
  // 켜 둔 기기는 열 때마다 구독이 그대로인지 보고, 없어졌거나 바뀌었으면 다시 알린다.
  async function pushRefresh(force) {
    if (!pushOn()) return;
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (force || !sub || sub.endpoint !== push.ep) { await pushSubscribe(); push.rest = null; savePush(); pushRest(); }
    } catch (e) { /* 다음에 다시 */ }
  }
  // 휴식이 끝나는 시각(+1.5초)에 알림. 앱을 보고 있는 채로 끝나면 앱이 소리로 알리고 그 알림은 취소한다.
  function pushTimer(r, st) {
    if (!pushOn()) return;
    const n = st.n + 1;
    pushApi({ put: [{ tag: 't:' + r.id, in: Math.max(0, st.endAt - Date.now()) + 1500, title: `${r.name} 휴식 끝`,
      body: `${n >= restNeed(r) ? '마지막 세트 하고 완료예요' : `${n + 1}세트 시작`} · ${L.fmtW(r)} × ${r.reps}회`, ttl: 60, urgent: true }] })
      .catch(() => toast('알림 서버에 연결하지 못했어요 · 앱을 켜 두면 소리로 알려줘요'));
  }
  function pushCancel(id) { if (pushOn()) pushApi({ del: ['t:' + id] }).catch(() => {}); }
  // 쉬는 날 알림: 오늘부터 운동하지 않으면 쉰 지 3·4일째(10일 규칙은 8·9일째) 되는 날 아침 9시에 보낼 알림.
  // 운동할 날(sim.gaps) 할 종목마다 쉰 날 수로 계산하고, 내용이 바뀔 때만 서버에 통째로 다시 맡긴다.
  function restPushItems(sim) {
    const g = sim.gaps, out = [], now = Date.now();
    if (!g || !g.items.length) return out;
    const names = (n) => (n.length <= 2 ? n.join(' · ') : `${n[0]} 외 ${n.length - 1}종목`);
    for (let k = 0; k <= L.GAP2; k++) {
      const lines = new Map();   // 쉰 날 수마다 종목 이름
      for (const x of g.items) {
        const R = x.rest + k;
        if (![L.GAP1 - 2, L.GAP1 - 1, L.GAP2 - 2, L.GAP2 - 1].includes(R)) continue;
        if (!lines.has(R)) lines.set(R, []);
        lines.get(R).push(x.main ? '데드리프트·스쿼트' : x.name);
      }
      if (!lines.size) continue;
      const what = (R) => `${R === L.GAP1 - 2 || R === L.GAP2 - 2 ? '이틀' : '오늘 하루'} 더 쉬면 ${R < L.GAP1 ? '세션이 처음부터 다시 시작되고 한 단계' : '한 단계 더'} 낮아져요`;
      const s = L.toStr(g.day + k);
      const at = new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 9, 0, 0).getTime();
      if (at < now + 60000) continue;
      const one = lines.size === 1 && [...lines][0];
      out.push(one
        ? { tag: 'r:' + s, at, ttl: 6 * 3600, title: `쉰 지 ${one[0]}일째예요`, body: `${what(one[0])} · ${names(one[1])}` }
        : { tag: 'r:' + s, at, ttl: 6 * 3600, title: '쉬는 날 알림', body: [...lines].map(([R, n]) => `${names(n)} 쉰 지 ${R}일째 · ${what(R)}`).join('\n') });
    }
    return out;
  }
  let restWait = 0;
  function pushRest() {
    if (!pushOn()) return;
    clearTimeout(restWait);
    restWait = setTimeout(() => {
      const items = data.started ? restPushItems(logSim()) : [];
      const key = JSON.stringify(items);
      if (key === push.rest) return;
      pushApi({ group: 'rest', put: items })
        .then((out) => { push.rest = key; savePush(); if (out && out.sub === false) pushRefresh(true); })
        .catch(() => { /* 다음에 열 때 다시 */ });
    }, 1000);
  }
  function pushCard() {
    const b = (act, label, main) => `<button class="btn${main ? '' : ' ghost'}" type="button" data-act="${act}" ${pushBusy ? 'disabled' : ''}>${label}</button>`;
    let note = '', btns = '';
    if (!window.ROUTINE_STANDALONE) note = 'Claude 링크에서는 알림을 보낼 수 없어요. GitHub 주소로 연 앱에서 켜 주세요.';
    else if (!pushCan()) note = isIOS() ? '아이폰은 홈 화면에 추가한 앱에서만 켤 수 있어요. Safari 공유 버튼 → 홈 화면에 추가 → 그 아이콘으로 열어 주세요 (iOS 16.4 이상).' : '이 브라우저는 알림을 지원하지 않아요. Chrome이나 삼성 인터넷으로 열어 주세요.';
    else if (Notification.permission === 'denied') { note = '알림이 막혀 있어요. 휴대폰 설정에서 이 앱(브라우저)의 알림을 허용한 뒤 다시 켜 주세요.'; btns = b('pushOn', '알림 켜기', true); }
    else if (pushOn()) { note = '이 기기에서 켜져 있어요.'; btns = b('pushTest', '테스트 알림 (5초 뒤)') + b('pushOff', '알림 끄기'); }
    else btns = b('pushOn', '알림 켜기', true);
    return `<div class="card" id="pushCard"><h2>알림</h2>
      <p class="small">앱을 닫아도(다른 앱을 쓰거나 화면이 꺼져도) 휴식 타이머가 끝나면 알림이 와요. 운동을 쉰 지 3·4일째 되는 날에는 아침 9시에 알려줘요. 기기마다 따로 켜요.</p>
      ${note ? `<p class="small">${note}</p>` : ''}${btns ? `<div class="btnrow">${btns}</div>` : ''}</div>`;
  }
  function renderPushCard() { const el = $('pushCard'); if (el) el.outerHTML = pushCard(); }

  // ---------- 기록 시트 ----------
  function openSheet(mode, day) {
    const li = mode === 'new' ? data.logs.length : data.logs.findIndex((l) => L.toNum(l.d) === day);
    if (li < 0) return;
    const res = {};
    if (mode === 'edit') {
      const e = model(weekMon + 6).sim.days.get(day);
      for (const r of e.rows) if (r.avail === 'ok' && r.result != null) res[r.id] = r.result;
    }
    sheet = { kind: 'log', mode, day, li, res, confirmDel: false, opener: document.activeElement };
    $('sheet').hidden = false;
    renderSheet(model(weekMon + 6));
    const first = $('panel').querySelector('button');
    if (first) first.focus();
  }
  function closeSheet() {
    const back = sheet && sheet.opener;
    sheet = null;
    $('sheet').hidden = true;
    $('panel').innerHTML = '';
    if (back && document.contains(back)) back.focus();
  }
  // 새 기록은 마지막 기록 다음 차례, 고치기는 그 날 기록 당시의 차례.
  // 지난 날을 새로 기록할 때는 그 날까지 쉰 날 수로 다시 계산한다 (오래 쉬면 처음부터 다시 하는 규칙이 날짜마다 달라서).
  function sheetInfo(m) {
    if (sheet.mode !== 'new') return m.sim.days.get(sheet.day);
    if (sheet.day === m.sim.cursor) return m.sim.next;
    return L.simulate(data.cfg, data.logs, L.toStr(sheet.day), { until: -Infinity }).next;
  }
  function renderSheet(m) {
    if (sheet.kind === 'start') { renderStart(); return; }
    if (sheet.kind === 'timer') { renderTimer(m); return; }
    if (sheet.kind === 'add') { renderAdd(); return; }
    const info = sheetInfo(m);
    const rows = info.rows.filter((r) => r.avail === 'ok');
    const others = info.rows.filter((r) => r.avail !== 'ok');
    const any = rows.some((r) => typeof sheet.res[r.id] === 'boolean');
    const isLast = sheet.mode === 'edit' && sheet.li === data.logs.length - 1;
    let h = `<div><h2 id="sheetTitle">${longDate(sheet.day)} · ${TYPE_NAME[info.type]}</h2>
      <div class="sub">세션 ${info.no} · ${info.pos + 1}/6 · ${esc(stageText(info.main))}</div></div>
      <p class="small">목표 횟수×세트를 모두 채웠으면 성공, 한 세트라도 못 채웠으면 실패예요. <strong>하지 않은 종목은 비워 두세요.</strong> 다음 ${TYPE_NAME[info.type]} 날로 밀려요. 누른 버튼을 한 번 더 누르면 선택이 풀려요.</p>`;
    const restarted = rows.filter((r) => r.restart);
    if (restarted.length) h += `<p class="small note">오래 쉬어서 세션을 처음부터 다시 해요: ${restarted.map((r) => `${esc(r.main ? '데드리프트·스쿼트' : r.name)} ${r.restart}일 쉼 → ${STEPS[r.rested] || r.rested} 단계 낮춤`).join(', ')}</p>`;
    h += `
      <div class="lrows">`;
    for (const r of rows) {
      const v = sheet.res[r.id];
      const pl = plates(r);
      h += `<div class="lrow"><div><div class="nm">${esc(r.name)}${flags(r)}</div><div class="rx"><b>${wHtml(r)}</b> · ${r.reps}회 × ${r.sets}세트</div>
        ${pl ? `<div class="rx pl-line"><span class="pl">${pl.label}</span>${esc(pl.text)}</div>` : ''}${pl && pl.unbalanced ? `<div class="rx bal">${BALANCE_NOTE}</div>` : ''}</div>
        <div class="seg" role="group" aria-label="${esc(r.name)} 결과">
          <button type="button" class="y" data-act="res" data-id="${esc(r.id)}" data-v="1" aria-pressed="${v === true}">성공</button>
          <button type="button" class="n" data-act="res" data-id="${esc(r.id)}" data-v="0" aria-pressed="${v === false}">실패</button>
        </div></div>`;
    }
    h += '</div>';
    if (others.length) h += `<p class="small">오늘은 쉬는 종목: ${others.map((r) => esc(r.name)).join(', ')}</p>`;
    h += `<div class="btnrow"><button class="btn ghost" type="button" data-act="allok">모두 성공</button></div>
      <button class="btn block" type="button" data-act="saveLog" ${any ? '' : 'disabled'}>${sheet.mode === 'new' ? '기록 저장' : '고친 결과 저장'}</button>`;
    if (!any) h += '<p class="small">한 종목 이상 성공·실패를 고르면 저장할 수 있어요.</p>';
    if (isLast) {
      h += sheet.confirmDel
        ? `<div class="confirm"><span>이 날 기록을 지울까요? 계획이 다시 계산돼요.</span><button class="btn danger" type="button" data-act="delLog">지우기</button><button class="btn ghost" type="button" data-act="keepLog">취소</button></div>`
        : '<button class="btn danger" type="button" data-act="askDel">이 날 기록 지우기</button>';
    }
    h += '<button class="btn ghost" type="button" data-act="close">닫기</button>';
    $('panel').innerHTML = h;
  }
  function saveLog() {
    const m = model(weekMon + 6);
    const info = sheetInfo(m);
    const res = {};
    for (const r of info.rows) if (r.avail === 'ok' && typeof sheet.res[r.id] === 'boolean') res[r.id] = sheet.res[r.id];
    if (!Object.keys(res).length) { toast('한 종목 이상 성공·실패를 골라 주세요'); return; }
    const left = info.rows.filter((r) => r.avail === 'ok' && !(r.id in res)).length;
    // 고무밴드 종목은 그날 쓴 밴드를 함께 남긴다.
    const bands = {};
    for (const r of info.rows) if (r.band && r.id in res) bands[r.id] = (r.bands || []).slice();
    // 그날의 상태·무게·횟수도 남긴다 (나중에 설정을 바꿔도 이 기록은 그대로).
    const s = L.snapOf(info.rows, (r) => r.id in res);
    const entry = (d) => Object.assign({ d, res, p: 1 }, Object.keys(bands).length ? { b: bands } : {}, { s });
    if (sheet.mode === 'new') {
      data.logs.push(entry(L.toStr(sheet.day)));
      const after = L.simulate(data.cfg, data.logs, today, { until: -Infinity });
      let msg;
      if (after.cur.no > m.cur.no) {
        const done = after.main[after.cur.i - 1];
        msg = `세션 ${done.no} 완료${done.out ? '' : '(하체 실패)'} · 다음 세션 데드리프트 ${L.roundW(after.cur.presc.dl)}kg`;
      } else msg = info.rows[0].id in res ? `${after.cur.n}/6 기록했어요` : `기록했어요 · ${TYPE_NAME[info.type]}는 다음 날로 밀려요`;
      if (left) msg += ` · 안 한 ${left}종목은 다음 ${TYPE_NAME[info.type]} 날로`;
      closeSheet(); commit(msg);
    } else {
      const old = data.logs[sheet.li];
      // 이미 남긴 종목은 그때 상태를 그대로 두고, 이번에 새로 고른 종목만 지금 상태로 남긴다.
      if (old.s) for (const k of Object.keys(s)) if (old.s[k]) s[k] = old.s[k];
      data.logs[sheet.li] = entry(old.d);
      // 이 날 결과가 바뀌었으니 뒤 기록은 지금 설정으로 다시 계산해 남긴다.
      L.snapLogs(data.cfg, data.logs, sheet.li + 1);
      closeSheet(); commit('결과를 고쳤어요. 이후 계획을 다시 계산했어요');
    }
  }

  // ---------- 이어서 시작 (시작 지점) ----------
  // 이미 하던 루틴을 이어서 기록할 때: 그 날 운동이 몇 세션의 몇 번째였는지, 그때 하체 단계·무게·횟수를 정한다.
  const stageName = (s) => (data.cfg.main.prog === 'w'
    ? `${s}단계 · ${L.ladderReps(data.cfg.main, s - 1)}회${s === 1 ? ' · 묶음 시작' : ''}`
    : ['1단계 · 묶음 시작', '2단계', '3단계', '4단계 · 가장 무거운 날'][s - 1]);
  function openStart(day) {
    const cfg = data.cfg;
    const sp = L.startPoint(cfg);
    const st = L.initState(cfg);
    const T = L.toNum(today);
    // 기록이 있으면 첫 기록 날이 시작 지점이다 (그 기록이 새 세션·순서로 다시 계산된다).
    if (data.logs.length) day = L.toNum(data.logs[0].d);
    else if (day == null) day = L.toNum(cfg.startDate) < T ? L.toNum(cfg.startDate) : T - 1;
    const acc = {};
    for (const a of cfg.acc) { const s = st.acc[a.id]; acc[a.id] = { w: s.w, mode: s.mode, step: s.step, n: s.n }; }
    sheet = { kind: 'start', day, no: sp.no, k: sp.k, stage: Math.min(sp.stage, L.mainTop(cfg)), dl: cfg.main.dl, acc, note: '', err: '', opener: document.activeElement };
    $('sheet').hidden = false;
    renderStart();
    const first = $('panel').querySelector('input:not([disabled]), select');
    if (first) first.focus();
  }
  // 세션 번호를 바꾸면 지금 시작 지점에서 모두 성공했다고 보고 그 세션의 단계·무게·횟수를 채운다.
  function refillStart() {
    const cfg = data.cfg;
    const p = L.projectTo(cfg, sheet.no);
    if (!p) {
      sheet.stage = ((sheet.no - 1) % L.mainTop(cfg)) + 1;
      stageDefaults();
      // 그 세션의 훈련방식 (기록 중에 바꿨으면 바꾼 방식)
      for (const a of cfg.acc) { const seg = L.segAt(a, sheet.no), o = sheet.acc[a.id]; if (o.mode !== seg.mode) Object.assign(o, { mode: seg.mode, w: seg.w }); }
      sheet.note = `지금 시작 지점(세션 ${L.startPoint(cfg).no})보다 앞 세션이라 무게는 채우지 못했어요. 그 세션의 무게로 고쳐 주세요.`;
      return;
    }
    sheet.stage = p.presc.main.stage;
    sheet.dl = r2(p.presc.main.dl);
    for (const a of cfg.acc) {
      const s = p.state.acc[a.id];
      sheet.acc[a.id] = { w: s.w == null ? null : r2(s.w), mode: s.mode, step: s.step, n: s.n };
    }
    sheet.note = `세션 ${L.startPoint(cfg).no}부터 모두 성공했다고 보고 채웠어요. 실제와 다르면 고쳐 주세요.`;
  }
  // 하체 단계를 직접 바꾸면 상체·팔 횟수도 그 단계에 맞춘다.
  function stageDefaults() {
    for (const a of data.cfg.acc) Object.assign(sheet.acc[a.id], L.accAt((a.from || 1) > sheet.no ? 1 : sheet.stage, a, L.restStage(data.cfg)));
  }
  // 보조 종목 사다리 칸 고르기: 무게 고정은 횟수, 횟수 고정은 무게로 보여준다.
  function stepOptions(a, o) {
    const label = (step) => (a.prog === 'r' ? L.fmtW({ w: L.stepW(data.cfg, a, o.mode, o.w, step), mode: o.mode, n: step, inc: a.inc, incV: a.incV }) : `${L.ladderReps(a, step)}회`);
    const opts = [];
    for (let step = Math.min(-2, o.step); step <= L.accTop(a); step++) {
      if (step < 0 && label(step) === label(step + 1)) continue;
      opts.push([String(step), `${label(step)} · ${step < 0 ? '낮춘 단계' : `${step + 1}단계`}`]);
    }
    return opts.map(([v, t]) => `<option value="${v}" ${v === String(o.step) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  }
  function renderStart() {
    const cfg = data.cfg;
    const d = sheet;
    const T = L.toNum(today);
    const n = data.logs.length;
    let h = `<div><h2 id="sheetTitle">이어서 시작하기</h2><div class="sub">이미 하던 루틴을 이 날부터 이어서 기록해요</div></div>
      <p class="small">기록을 시작할 날의 운동이 몇 세션의 몇 번째였는지와 그때 무게를 넣어 주세요. 세션 번호를 바꾸면 지금 설정에서 모두 성공했다고 보고 무게·횟수를 채워요.</p>
      ${n ? `<p class="small note">이미 기록한 ${n}일은 그대로 두고, 첫 기록(${longDate(d.day)})이 여기서 고른 운동이 되도록 다시 계산해요. 그보다 앞 날짜부터 넣으려면 기록을 지운 뒤 가장 이른 날부터 다시 넣어 주세요.</p>` : ''}
      <div class="row2"><label class="field"><span>${n ? '날짜 (첫 기록)' : '날짜'}</span><input type="date" id="st-day" data-sk="day" value="${L.toStr(d.day)}" max="${L.toStr(T)}" ${n ? 'disabled' : ''}></label>
      <label class="field"><span>세션 번호</span><input type="number" inputmode="numeric" min="1" step="1" id="st-no" data-sk="no" value="${d.no}"></label></div>
      <div class="row2"><label class="field"><span>이 날 운동</span><select id="st-k" data-sk="k">${[0, 1, 2, 3, 4, 5].map((k) => `<option value="${k}" ${k === d.k ? 'selected' : ''}>${k + 1}번째 · ${TYPE_NAME[L.slotType(k)]}</option>`).join('')}</select></label>
      <label class="field"><span>하체 단계</span><select id="st-stage" data-sk="stage">${Array.from({ length: L.mainTop(cfg) }, (_, i) => i + 1).map((s) => `<option value="${s}" ${s === d.stage ? 'selected' : ''}>${stageName(s)}</option>`).join('')}</select></label></div>
      ${d.note ? `<p class="small note">${esc(d.note)}</p>` : ''}
      <div class="row2"><label class="field"><span>데드리프트 (kg)</span><input type="number" inputmode="decimal" step="0.1" min="1" id="st-dl" data-sk="dl" value="${d.dl}"></label>
      <div class="field"><span>스쿼트</span><div class="derived" id="st-sq"></div></div></div>
      <div class="stacc"><div class="sthead">상체·팔 <span>· 이 세션의 무게와 횟수</span></div>`;
    for (const a of cfg.acc) {
      const o = d.acc[a.id];
      const off = (a.from || 1) > d.no;
      const seg = L.segAt(a, d.no);
      h += `<div class="strow"><div class="stname"><span class="tag ${a.day}">${a.day === 'D' ? '데드 날' : '스쿼트 날'}</span><b>${esc(seg.name)}</b><span class="small">${esc(modeName(o.mode))}</span>${off ? `<span class="small">세션 ${a.from}부터</span>` : ''}</div>`;
      if (o.mode === 'band') { h += '<p class="small">고무밴드는 증량 없이 기록만 해요.</p></div>'; continue; }
      h += `<div class="row2">${o.w == null ? '<div class="field"><span>무게</span><div class="derived">생략</div></div>'
          : wField(`st-w-${a.id}`, o.mode, o.w, a.prog === 'r' ? '1단계 무게' : '무게', `data-sk="w" data-id="${esc(a.id)}"`)}
        <label class="field"><span>${a.prog === 'r' ? '무게 단계' : '횟수'}</span><select id="st-step-${esc(a.id)}" data-sk="step" data-id="${esc(a.id)}">${stepOptions(a, o)}</select></label></div></div>`;
    }
    h += '</div>';
    if (L.prescribe(cfg, L.initState(Object.assign({}, cfg, { from: { no: d.no, k: d.k, stage: d.stage, acc: {} } })), d.no).main.top) h += '<p class="small">하체가 가장 무거운 단계라 이 세션의 상체·팔은 쉬어요. 무게·횟수는 다음 세션에서 이어갈 단계로 골라 주세요.</p>';
    if (d.err) h += `<p class="small err" role="alert">${esc(d.err)}</p>`;
    h += `<button class="btn block" type="button" data-act="saveStart">이 지점부터 이어가기</button>
      <button class="btn ghost" type="button" data-act="close">닫기</button>`;
    const panel = $('panel');
    const top = panel.scrollTop;
    const focusId = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.id : '';
    panel.innerHTML = h;
    panel.scrollTop = top;
    if (focusId && $(focusId)) $(focusId).focus();
    startSquat();
  }
  function startSquat() {
    const el = $('st-sq');
    if (el) el.innerHTML = sheet.dl > 0 ? `<b>${L.roundW(sheet.dl / data.cfg.main.ratio)}kg</b> (÷ ${data.cfg.main.ratio})` : '—';
  }
  // 이어서 시작 시트의 입력: 숫자는 입력하는 대로 반영하고, 구조가 바뀌는 값(세션·단계·종목)은 다시 그린다.
  function startInput(el, done) {
    const d = sheet;
    const f = el.dataset.sk;
    const o = el.dataset.id ? d.acc[el.dataset.id] : null;
    const a = el.dataset.id ? data.cfg.acc.find((x) => x.id === el.dataset.id) : null;
    d.err = '';
    if (f === 'dl') { d.dl = Number(el.value); startSquat(); return; }
    if (f === 'w' && o) {
      o.w = Number(el.value);
      if (done && a && a.prog === 'r') { const sel = $('st-step-' + a.id); if (sel) sel.innerHTML = stepOptions(a, o); }
      return;
    }
    if (!done) return;
    if (f === 'day') { if (el.value) d.day = L.toNum(el.value); return; }
    if (f === 'no') {
      const v = Math.floor(Number(el.value));
      if (!(v >= 1)) { el.value = d.no; toast('세션 번호는 1 이상이에요'); return; }
      d.no = v; refillStart();
    } else if (f === 'k') d.k = Number(el.value);
    else if (f === 'stage') { d.stage = Number(el.value); stageDefaults(); d.note = ''; }
    else if (f === 'step' && o) { o.step = Number(el.value); return; }
    renderStart();
  }
  function saveStart() {
    const cfg = data.cfg;
    const d = sheet;
    const T = L.toNum(today);
    const fail = (msg) => { d.err = msg; renderStart(); const e = $('panel').querySelector('.err'); if (e) e.scrollIntoView({ block: 'nearest' }); };
    if (!(d.day <= T)) return fail('오늘이나 지난 날짜를 골라 주세요.');
    if (data.logs.length) {
      d.day = L.toNum(data.logs[0].d);
      if (d.k % 2 !== L.startPoint(cfg).k % 2) return fail(`이미 기록한 운동과 데드리프트·스쿼트 순서가 어긋나요. 이 날 운동을 ${TYPE_NAME[L.slotType(L.startPoint(cfg).k)]} 날(${L.startPoint(cfg).k % 2 ? '2·4·6' : '1·3·5'}번째)로 골라 주세요.`);
    }
    if (!(d.dl > 0)) return fail('데드리프트 무게를 넣어 주세요.');
    for (const a of cfg.acc) { const w = d.acc[a.id].w; if (w != null && d.acc[a.id].mode !== 'band' && !(w > 0)) return fail(`${a.name} 무게를 확인해 주세요.`); }
    cfg.startDate = L.toStr(d.day);
    cfg.main.dl = r2(d.dl);
    const acc = {};
    for (const a of cfg.acc) {
      const o = d.acc[a.id];
      acc[a.id] = { step: o.step, n: o.n || 0 };
      if (o.w == null || o.mode === 'band') continue;
      // 처음 설정 구간이면 종목의 시작 무게로, 훈련방식을 바꾼 구간이면 시작 지점의 무게로 남긴다.
      if (L.segAt(a, d.no).no === 1) { if (a.w != null) a.w = r2(o.w); } else acc[a.id].w = r2(o.w);
    }
    cfg.from = { no: d.no, k: d.k, stage: d.stage, acc };
    // 시작 지점이 바뀌면 기록이 다른 세션·순서로 다시 계산되므로 남긴 상태도 새로 남긴다.
    if (data.logs.length) L.snapLogs(cfg, data.logs, 0);
    const day = d.day;
    closeSheet();
    weekMon = L.mondayOf(day);
    commit(`세션 ${d.no}의 ${d.k + 1}번째 운동부터 이어가요`);
    if (tab === 'settings') renderSettings();
    // 지난 날을 시작으로 잡았으면 그 날 한 운동 결과를 바로 체크한다.
    if (day < T && L.canLog(model(weekMon + 6).tl, day)) openSheet('new', day);
  }

  // ---------- 종목 입력 (설정 카드 · 운동 추가 시트 공통) ----------
  const listOf = (mode) => L.gearList(data.cfg, mode);
  const same = (x, y) => x != null && y != null && Math.abs(x - y) < 1e-9;
  // 무게 입력: 목록 방식(덤벨·일체형 바벨·원판 한 장)은 가진 무게에서 고르고, 나머지는 숫자로 (비우면 생략).
  function wField(id, mode, w, label, attrs) {
    if (mode === 'band') return '';
    if (L.MODES[mode].list) {
      const list = listOf(mode);
      if (!list.length) return `<div class="field"><span>${esc(label)}</span><div class="derived">설정 → 장비에 ${esc(modeName(mode))} 무게를 넣어 주세요</div></div>`;
      const vals = w != null && !list.some((v) => same(v, w)) ? [w].concat(list).sort((a, b) => a - b) : list;
      return `<label class="field"><span>${esc(label)}</span><select id="${esc(id)}" ${attrs}>${vals.map((v) => `<option value="${v}" ${same(v, w) ? 'selected' : ''}>${v}kg${list.some((u) => same(u, v)) ? '' : ' (목록에 없음)'}</option>`).join('')}</select></label>`;
    }
    return `<label class="field"><span>${esc(label)} (kg)</span><input type="number" inputmode="decimal" step="0.5" min="0" id="${esc(id)}" ${attrs} value="${w == null ? '' : w}" placeholder="생략"></label>`;
  }
  // 훈련방식을 바꿀 때의 무게: 목록 방식이면 가장 가까운 가진 무게, 바벨은 빈 봉(20kg) 이상, 밴드는 없음.
  function snapW(mode, w) {
    if (mode === 'band') return null;
    if (mode === 'barbell' && w != null && w < 20) return 20;
    const list = listOf(mode);
    if (!L.MODES[mode].list || !list.length) return w;
    if (w == null) return list[0];
    return list.reduce((b, v) => (Math.abs(v - w) < Math.abs(b - w) ? v : b));
  }
  // 지금 쓰는 훈련방식 구간: 기록 중에 바꿨으면 마지막으로 바꾼 것, 아니면 처음 설정.
  function curSeg(a) {
    const c = (a.chg || []).slice().sort((p, q) => p.no - q.no).pop();
    return c ? { no: c.no, mode: c.mode, w: c.w, name: c.name || a.name, chg: c } : { no: 0, mode: a.mode, w: a.w, name: a.name, chg: null };
  }
  // 종목의 지금 (오늘 예상은 빼고 기록만으로 계산):
  //   no = 훈련방식·무게를 지금 바꾸면 적용되는 세션 (진행 중인 세션을 이미 한 번이라도 했으면 다음 세션),
  //   logged = 지금 훈련방식 구간에 이미 한 기록이 있는가, w = 진행 중인(다음) 세션의 무게.
  //   오래 쉬어서 처음부터 다시 하는 세션도 그 전에 한 기록(past)이 있으면 이미 한 것으로 본다.
  const logSim = () => L.simulate(data.cfg, data.logs, today, { until: -Infinity });
  function exNow(a, sim = logSim()) {
    const ss = sim.acc[a.id] || [];
    const sess = ss[sim.real.acc[a.id]];
    const st = sess && sess.state;
    const c = curSeg(a);
    const did = (s) => s.res.length > 0 || s.past > 0;
    // 진행 중인 세션이 상체·팔이 쉬는 세션이면 실제로 하는 다음 세션부터라고 알린다.
    const v = sess && !did(sess) ? sim.view(sess.no) : null;
    const rest = !!(v && v.acc[a.id] && v.acc[a.id].skip);
    return {
      no: sess ? sess.no + (did(sess) || rest ? 1 : 0) : sim.cur.no,
      logged: ss.some((s) => s.no >= (c.no || 1) && did(s)),
      w: st && st.w != null ? r2(a.prog === 'r' ? L.stepW(data.cfg, a, st.mode, st.w, st.step) : st.w) : null,
    };
  }
  const changeNo = (a) => exNow(a).no;
  // 하체 증량 방식을 바꾸면 적용할 세션: 진행 중인 하체 세션이 있으면 그다음 세션, 아직 시작 전이면 그 세션.
  function mainChangeNo(sim = logSim()) { return sim.cur.no + (sim.cur.n > 0 ? 1 : 0); }
  const incName = (i) => (i === 'pct' ? `${data.cfg.main.pct}%` : `${i}kg`);
  // 하체 증량 방식 바꾸기. 기록이 없으면 처음부터, 있으면 mainChangeNo 세션부터. 적용할 세션 번호(처음부터면 null).
  function setMainInc(id, v) {
    const m = data.cfg.main;
    if (!data.logs.length) { m.inc[id] = v; m.ichg = m.ichg.filter((c) => c.id !== id); return null; }
    const no = mainChangeNo();
    m.ichg = m.ichg.filter((c) => !(c.id === id && c.no >= no));
    if (L.mainInc(data.cfg, id, no) !== v) m.ichg.push({ no, id, inc: v });
    m.ichg.sort((p, q) => p.no - q.no);
    return no;
  }
  function progNote(x) {
    if (x.mode === 'band') return '고무밴드는 힘을 정확히 잴 수 없어 증량하지 않고 기록만 해요. 밴드를 바꾸면 그다음 기록부터 바뀐 밴드로 남아요.';
    const up = L.MODES[x.mode].list ? `가진 ${modeName(x.mode)} 중 다음 무게` : x.inc === 'kg' ? `+${x.incV}kg` : `+${x.incV}%`;
    return x.prog === 'r'
      ? `횟수는 그대로 두고 세션마다 한 칸(${up})씩 무게를 올려 3단계까지 가요. 3단계를 성공하면 2단계 무게부터 새 묶음이에요.`
      : `무게는 그대로 두고 세션마다 다음 횟수로 가요. 마지막 ${L.ladderOf(x).slice(-1)[0]}회를 성공하면 다음 세션에 한 칸(${up}) 올려 첫 횟수부터 다시 해요.`;
  }
  function exForm(x, key, opt = {}) {
    const id = (f) => `${key}-${f}`;
    const cont = L.MODES[x.mode].cont;
    const modeSel = opt.modeSel || x.mode;
    let h = `<div class="row2"><label class="field"><span>훈련방식</span><select id="${esc(id('mode'))}" data-f="mode">${L.MODE_KEYS.map((k) => `<option value="${k}" ${k === modeSel ? 'selected' : ''}>${L.MODES[k].name}</option>`).join('')}</select></label>
      <label class="field"><span>부위</span><input type="text" id="${esc(id('part'))}" data-f="part" value="${esc(x.part)}"></label></div>`;
    if (opt.pend) h += opt.pend;
    if (x.mode === 'band') {
      const names = data.cfg.gear.bands;
      h += `<div class="field"><span>쓰는 밴드 (여러 개 고를 수 있어요)</span><div class="chips">${names.length
        ? names.map((n, i) => `<label class="chip"><input type="checkbox" id="${esc(id('band' + i))}" data-f="band" value="${esc(n)}" ${x.bands.includes(n) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')
        : '<span class="small">설정 → 장비에서 밴드를 추가해 주세요</span>'}</div></div>`;
    } else {
      h += `<div class="row2">${wField(id('w'), x.mode, x.w, opt.wLabel || '시작 무게', 'data-f="w"')}${x.mode === 'stack'
        ? `<label class="field"><span>무게추 단계 (kg, 쉼표로)</span><input type="text" inputmode="decimal" id="${esc(id('stack'))}" data-f="stack" value="${esc(x.stack.join(', '))}" placeholder="예: 20, 23, 26, 29"></label>` : ''}</div>`;
      if (x.mode === 'stack' && !x.stack.length) h += '<p class="small">머신에 달린 무게추 무게를 차례로 넣어 주세요. 비워 두면 5kg 간격으로 보고 계산해요.</p>';
    }
    const sets = `<label class="field"><span>세트</span><input type="number" inputmode="numeric" min="1" id="${esc(id('sets'))}" data-f="sets" value="${x.sets}"></label>`;
    const rest = `<label class="field"><span>휴식</span><input type="text" id="${esc(id('rest'))}" data-f="rest" value="${esc(x.rest)}"></label>`;
    const reps = `<label class="field"><span>횟수</span><input type="number" inputmode="numeric" min="1" id="${esc(id('reps'))}" data-f="reps" value="${x.reps}"></label>`;
    if (x.mode === 'band') h += `<div class="row3">${reps}${sets}${rest}</div>`;
    else {
      h += `<div class="row2"><label class="field"><span>진행 방식</span><select id="${esc(id('prog'))}" data-f="prog"><option value="w" ${x.prog !== 'r' ? 'selected' : ''}>무게 고정</option><option value="r" ${x.prog === 'r' ? 'selected' : ''}>횟수 고정</option></select></label>
        ${x.prog === 'r' ? reps : `<label class="field"><span>횟수 단계 (쉼표로)</span><input type="text" inputmode="numeric" id="${esc(id('ladder'))}" data-f="ladder" value="${esc(L.ladderOf(x).join(', '))}" placeholder="예: 3, 4, 5"></label>`}</div>
        <div class="row2 pair"><div class="row2">${sets}${rest}</div>${cont ? `<div class="row2"><label class="field"><span>증량 방식</span><select id="${esc(id('inc'))}" data-f="inc"><option value="pct" ${x.inc === 'pct' ? 'selected' : ''}>%</option><option value="kg" ${x.inc === 'kg' ? 'selected' : ''}>kg</option></select></label>
          <label class="field"><span>증량 값</span><input type="number" inputmode="decimal" step="0.5" min="0" id="${esc(id('incv'))}" data-f="incV" value="${x.incV}"></label></div>` : ''}</div>`;
    }
    h += `<p class="small prognote">${esc(progNote(x))}</p>`;
    return h;
  }
  // 기록이 있는 종목의 훈련방식·무게 바꾸기 확인 (wOnly = 훈련방식은 그대로 무게만)
  function pendBox(a, pm, no) {
    const btns = '<div class="btnrow"><button class="btn" type="button" data-act="pmOk">바꾸기</button><button class="btn ghost" type="button" data-act="pmCancel">취소</button></div>';
    if (pm.wOnly) {
      return `<div class="swbox" role="group" aria-label="무게 바꾸기"><p class="small"><strong>세션 ${no}부터 새 무게로 할까요?</strong> 이미 한 기록은 그대로 두고, 이 종목의 세션 ${no}부터 새 무게의 첫 단계로 시작해요.</p>
        <div class="row2">${wField('pm-w', pm.mode, pm.w, '새 무게', 'data-pm="w"')}</div>${btns}</div>`;
    }
    return `<div class="swbox" role="group" aria-label="훈련방식 바꾸기"><p class="small"><strong>${esc(toMode(pm.mode))} 바꿀까요?</strong> 이 종목의 세션 ${no}부터 새 무게의 첫 단계로 시작하고, 지난 기록은 그대로 남아요.</p>
      <div class="row2"><label class="field"><span>이름</span><input type="text" id="pm-name" data-pm="name" value="${esc(pm.name)}"></label>${wField('pm-w', pm.mode, pm.w, '시작 무게', 'data-pm="w"')}</div>${btns}</div>`;
  }

  // ---------- 설정 ----------
  function renderSettings() {
    const cfg = data.cfg;
    const sp = L.startPoint(cfg);
    const wl = sp.no > 1 ? `세션 ${sp.no} 무게` : '시작 무게';
    const sim = data.logs.length ? logSim() : null;
    let h = `<div class="card"><h2>시작 지점</h2>
      <p class="startsum"><b>${longDate(L.toNum(cfg.startDate))}</b> · 세션 ${sp.no}의 ${sp.k + 1}번째 운동(${TYPE_NAME[L.slotType(sp.k)]}) · 하체 ${sp.stage}단계</p>
      <p class="small">이미 하던 루틴이 있으면 시작 지점을 그 세션으로 옮기세요. 그 날부터 오늘까지 한 운동은 이번 주 화면에서 지난 날을 눌러 날짜순으로 기록하면 돼요. 아래 무게는 시작 지점 세션의 무게예요.</p>
      <div class="btnrow"><button class="btn ghost" type="button" data-act="startSheet">시작 지점 바꾸기 · 이어서 시작</button></div>
      <p class="small">쉬는 요일은 따로 없어요. 세션의 6번째 운동을 마친 다음 날 하루 쉬고, 기록하지 않은 날은 쉰 날로 봐요. 설정을 바꿔도 이미 한 기록의 무게·횟수는 그대로 두고, 그다음부터 바뀐 설정으로 계산해요. 데드리프트 시작 무게를 바꾸면 지금 무게도 같은 비율로 바뀌어요.</p></div>`;
    h += pushCard();

    const cnt = L.plateCounts(cfg.plates);
    h += `<div class="card"><h2>가지고 있는 경량원판</h2>
      <p class="small">종류마다 몇 쌍 있는지 골라 주세요. 1쌍 = 2장이에요. 2.5kg 이상 원판은 개수 제한 없이 있다고 보고, 2.5kg은 필요하면 한 짝(한쪽만)도 쓰게 안내해요.</p>
      <div class="plates">${[...L.PLATE_OPTIONS].map((p) => {
        const n = cnt.get(p) || 0;
        const opts = Array.from({ length: PAIR_MAX + 1 }, (_, i) => `<option value="${i}"${i === n ? ' selected' : ''}>${i ? i + '쌍' : '없음'}</option>`).join('');
        return `<label class="${n ? 'on' : ''}"><span>${p}kg</span><select id="set-plate-${String(p).replace('.', '_')}" data-k="plate" data-w="${p}" aria-label="${p}kg 원판 쌍 수">${opts}</select></label>`;
      }).join('')}</div>
      <p class="small">바벨·머신 종목에는 5kg 단위 무게와 나머지를 채울 경량원판을 함께 보여줘요. 목표 무게 이상이 되는 가장 가벼운 조합을 고르고, 바벨은 그다음으로 좌우가 고른 조합을 골라요.</p></div>`;

    const g = cfg.gear;
    const gearRow = (k, label) => `<label class="field"><span>${label} (kg, 쉼표로 구분)</span><input type="text" inputmode="decimal" id="set-gear-${k}" data-k="gear.${k}" value="${esc(g[k].join(', '))}"></label>`;
    h += `<div class="card"><h2>장비</h2>
      <p class="small">헬스장마다 다른 무게를 넣어 주세요. 덤벨·일체형 바벨·원판 한 장 종목은 이 무게들 안에서 다음 무게로 올라가요(원판을 더 끼울 수 없으니까요). 머신 무게추는 종목마다 따로 넣어요.</p>
      ${gearRow('db', '덤벨')}${gearRow('bars', '일체형 바벨')}${gearRow('one', '한 장으로 드는 원판')}
      <div class="field"><span>고무밴드</span><div class="bands">${g.bands.map((n, i) => `<div class="bandrow"><input type="text" id="set-band-${i}" data-k="band.${i}" value="${esc(n)}" aria-label="${i + 1}번째 밴드 이름"><button class="btn ghost" type="button" data-act="delBand" data-i="${i}" aria-label="${esc(n)} 빼기">빼기</button></div>`).join('') || '<span class="small">밴드가 없어요</span>'}</div></div>
      <div class="btnrow"><button class="btn ghost" type="button" data-act="addBand">+ 밴드 추가</button></div></div>`;

    const mm = cfg.main;
    const LIFT_NAME = { dl: '데드리프트', sq: '스쿼트' };
    const incOf = (id) => L.mainInc(cfg, id, Infinity);
    const incSel = (id) => `<label class="field"><span>${LIFT_NAME[id]} 증량</span><select id="set-minc-${id}" data-k="main.inc.${id}">${['pct', ...new Set([...L.MAIN_KG, incOf(id)].filter((i) => i !== 'pct'))].map((i) => `<option value="${i}" ${incOf(id) === i ? 'selected' : ''}>${incName(i)}씩</option>`).join('')}</select></label>`;
    const ups = L.LIFTS.map((id) => incName(incOf(id)));
    const upTxt = ups[0] === ups[1] ? ups[0] : `데드리프트 ${ups[0]}·스쿼트 ${ups[1]}`;
    const incNote = sim ? `증량 방식을 바꾸면 진행 중인 세션은 그대로 하고 세션 ${mainChangeNo(sim)}부터 새 방식으로 올라가요.` : '';
    h += `<div class="card"><h2>하체 메인 · 데드리프트와 스쿼트</h2>
      <div class="row2"><label class="field"><span>데드리프트 ${wl} (kg)</span><input type="number" inputmode="decimal" step="0.1" min="1" id="set-dl" data-k="main.dl" value="${mm.dl}"></label>
      <div class="field"><span>스쿼트 ${wl}</span><div class="derived" id="sqDerived"></div></div></div>
      <div class="row2"><label class="field"><span>진행 방식</span><select id="set-mprog" data-k="main.prog"><option value="r" ${mm.prog !== 'w' ? 'selected' : ''}>횟수 고정</option><option value="w" ${mm.prog === 'w' ? 'selected' : ''}>무게 고정</option></select></label>
      ${mm.prog === 'w' ? `<label class="field"><span>횟수 단계 (쉼표로)</span><input type="text" inputmode="numeric" id="set-mladder" data-k="main.ladder" value="${esc(L.ladderOf(mm).join(', '))}"></label>`
        : `<label class="field"><span>횟수</span><input type="number" inputmode="numeric" min="1" id="set-mreps" data-k="main.reps" value="${mm.reps}"></label>`}</div>
      <div class="row2"><label class="field"><span>세트</span><input type="number" inputmode="numeric" min="1" id="set-msets" data-k="main.sets" value="${mm.sets}"></label>
      <label class="field"><span>휴식</span><input type="text" id="set-mrest" data-k="main.rest" value="${esc(mm.rest)}"></label></div>
      <div class="row2">${incSel('dl')}${incSel('sq')}</div>
      <p class="small">${mm.prog === 'w'
        ? `무게는 그대로 두고 세션마다 다음 횟수로 가요. 마지막 ${L.ladderOf(mm).slice(-1)[0]}회를 성공하면 ${upTxt} 올려 첫 횟수부터 해요. 마지막 횟수 세션은 상체·팔이 쉬어요(단계가 3개 이상일 때).`
        : `횟수는 그대로 두고 세션마다 ${upTxt}씩 올려 4단계까지 가고, 4단계를 성공하면 2단계 무게로 내려 새 묶음을 시작해요.`} 실패하거나 오래 쉬어 낮출 때도 같은 폭으로 내려요. ${incNote}</p></div>`;

    h += `<div class="card"><h2>상체·팔 보조 운동</h2><p class="small">훈련방식·무게는 언제든 바꿀 수 있어요. 이미 한 기록이 있으면 그 종목의 다음 세션부터 새 무게로 시작하고 지난 기록은 그대로 둬요. 진행 방식·횟수·세트·장비 무게를 바꿔도 지난 기록은 그대로이고, 지금 무게에서 바뀐 설정으로 이어가요. 바벨·머신 무게를 비워 두면 "무게 생략"으로 두고 증량분만 +1kg처럼 표시해요.</p>`;
    for (const a of cfg.acc) {
      const del = pendingDel === a.id;
      const cur = curSeg(a);
      const pm = pendingMode && pendingMode.id === a.id ? pendingMode : null;
      // 이미 한 기록이 있으면 지금(진행 중인 세션) 무게를 보여 주고, 바꾸면 다음 세션부터 적용한다.
      const now = sim ? exNow(a, sim) : null;
      const logged = !!(now && now.logged);
      const x = Object.assign({}, a, { mode: cur.mode, w: logged ? now.w : cur.w, name: cur.name });
      h += `<div class="acc" data-ex="${esc(a.id)}"><div class="acc-head"><span class="tag ${a.day}">${a.day === 'D' ? '데드 날' : '스쿼트 날'}</span>
        <input type="text" id="acc-${esc(a.id)}-name" data-f="name" value="${esc(cur.name)}" aria-label="종목 이름">
        <button class="btn ${del ? 'danger' : 'ghost'}" type="button" data-act="delAcc" data-id="${esc(a.id)}">${del ? '한 번 더 누르면 삭제' : '삭제'}</button></div>
        ${cur.no ? `<p class="small">세션 ${cur.no}부터 ${esc(toMode(cur.mode))} 바꿔서 하고 있어요.</p>` : ''}
        ${exForm(x, 'acc-' + a.id, { wLabel: logged ? '지금 무게' : cur.no ? `세션 ${cur.no} 무게` : wl, modeSel: pm && pm.mode, pend: pm && pendBox(a, pm, now ? now.no : changeNo(a)) })}</div>`;
    }
    h += `<div class="btnrow"><button class="btn ghost" type="button" data-act="addAcc" data-day="D">+ 데드 날 운동</button><button class="btn ghost" type="button" data-act="addAcc" data-day="S">+ 스쿼트 날 운동</button></div></div>`;

    h += `<div class="card"><h2>규칙</h2><ul class="rules">
      <li>한 세션은 운동 6회(데드리프트 날 → 스쿼트 날 번갈아 3회씩). 6번째 운동을 마친 다음 날 하루 쉬어요. 고정으로 쉬는 요일은 없어요.</li>
      <li>기록하지 않고 지나간 날은 쉰 날로 보고, 그날 운동을 다음 날로 미뤄요. 운동하고 깜빡했다면 그날을 눌러 나중에 기록할 수 있어요.</li>
      <li>기록할 때 한 종목만 골라도 저장돼요. 고르지 않은 종목은 안 한 것으로 보고 다음 같은 날(데드 날·스쿼트 날)로 밀려요. 하체를 안 했으면 다음 날도 같은 하체 날이에요.</li>
      <li>상체·팔은 자기 하체 날에만 하고 하체보다 앞서 가지 않아요. 밀린 종목은 지난 세션 몫부터 차례로 하고, 하체를 따라가느라 쉬는 날은 휴식으로 봐요.</li>
      <li>한 세션(운동 6회)을 하는 동안 2일 이상 쉬었다면 세션 뒤 정식 휴식은 건너뛰어요.</li>
      <li>한 종목을 ${L.GAP1}일 이상 쉬면(그 종목을 마지막으로 한 다음 날부터 센 날 수) 성공·실패와 상관없이 그 종목의 세션을 처음부터 다시 하고 한 단계 낮춰요. 횟수 고정은 무게 한 단계(−5% 등), 무게 고정은 횟수 한 단계예요. ${L.GAP2}일 이상이면 한 단계 더 낮춰요. 그 뒤로도 실패하면 다음 세션에 한 단계 낮추는 건 그대로예요.</li>
      <li>하체는 데드리프트·스쿼트 중 더 오래 쉰 쪽으로 세고, 하체 세션을 처음부터 다시 하면 그 세션의 상체·팔도 처음부터 해요(무게는 종목마다 쉰 날 수대로). 상체·팔이 쉬는 하체 마지막 단계 세션은 쉬는 날로 세지 않고, 고무밴드는 낮추지 않아요. 쉰 지 ${L.GAP1 - 2}·${L.GAP1 - 1}일째 되는 날엔 이번 주 화면 위에 알려줘요.</li>
      <li>휴식일에도 운동했다면 기록할 수 있고, 기록하면 운동한 날로 계산해요.</li>
      <li>이미 하던 루틴이면 시작 지점을 그 세션·순서·무게로 옮기고, 그 뒤 지난 날들을 날짜순으로 기록해 이어가요.</li>
      <li>데드리프트 = 스쿼트 × 1.2. 둘은 한 묶음으로 같이 오르내려요. 하체를 하나라도 실패하면 다음 세션은 한 단계 낮춰 다시 해요.</li>
      <li>데드리프트·스쿼트는 종목마다 5%씩, 5kg씩 또는 6kg씩 올릴 수 있어요. 세션 중에 바꾸면 그 세션은 그대로 하고, 다음 세션부터 앞 세션 무게에서 새 방식으로 오르내려요. 바벨·머신 보조 종목도 종목마다 %·kg을 골라요(진행 중인 세션 무게는 그대로).</li>
      <li>무게 고정 종목은 세션마다 다음 횟수로, 횟수 고정 종목은 세션마다 한 칸 무거운 무게로 가요. 실패하면 한 단계 낮춰 다시 하고, 사다리 끝을 성공하면 다음 세션에 증량해요. 하체가 마지막 단계인 세션(횟수 고정은 4단계)은 상체·팔이 쉬어요.</li>
      <li>바벨·머신·원판 여러 장은 %·kg으로 올리고 원판·무게추 조합을 알려줘요. 덤벨·일체형 바벨·원판 한 장은 가진 무게 중 다음 무게로 올라가요. 고무밴드는 증량 없이 기록만 해요.</li>
      <li>진행 방식·횟수·세트·장비 무게 같은 설정을 중간에 바꿔도 이미 한 기록은 그대로 두고, 지금 무게와 성공·실패에서 바뀐 설정으로 다음을 계산해요.</li>
    </ul></div>`;

    h += `<div class="card"><h2>데이터</h2><p class="small" id="storageNote"></p>
      <div class="btnrow"><button class="btn ghost" type="button" data-act="copyBackup">백업 복사</button><button class="btn ghost" type="button" data-act="importBackup">붙여 넣은 백업 불러오기</button></div>
      <label class="field"><span>백업 내용 (다른 기기로 옮길 때 여기에 붙여 넣기)</span><textarea id="backupBox" spellcheck="false"></textarea></label>
      ${confirmReset
        ? '<div class="confirm"><span>모든 기록을 지우고 오늘부터 다시 시작할까요? 설정은 그대로예요.</span><button class="btn danger" type="button" data-act="reset">지우고 다시 시작</button><button class="btn ghost" type="button" data-act="cancelReset">취소</button></div>'
        : '<div class="btnrow"><button class="btn danger" type="button" data-act="askReset">기록 지우고 처음부터</button></div>'}
    </div>`;
    const view = $('view-settings');
    const focusId = document.activeElement && view.contains(document.activeElement) ? document.activeElement.id : '';
    view.innerHTML = h;
    if (focusId && $(focusId)) $(focusId).focus();
    renderDerived();
    renderSettingsStorage();
  }
  function renderDerived() {
    const el = $('sqDerived');
    if (el) el.innerHTML = `<b>${L.roundW(data.cfg.main.dl / data.cfg.main.ratio)}kg</b> (데드리프트 ÷ ${data.cfg.main.ratio})`;
  }
  function renderSettingsStorage() {
    const el = $('storageNote');
    if (!el) return;
    el.textContent = remote
      ? '기록은 지금 로그인한 Claude 계정에 저장돼서 다른 기기에서 열어도 이어져요. 이 기기에도 사본을 남겨요.'
      : '기록은 이 기기의 브라우저에만 저장돼요. 브라우저 데이터를 지우면 사라지니 가끔 백업을 복사해 두세요.';
  }

  // 시작 전(기록 없음)에는 설정을 바꿔도 "시작"으로 치지 않는다.
  function save(msg) {
    if (data.started) { commit(msg); return; }
    data.updatedAt = Date.now();
    saveLocal();
    render();
    if (msg) toast(msg);
  }

  // 종목 입력(설정 카드·운동 추가 시트). 구조가 바뀌는 값(훈련방식·진행 방식·증량 방식)은 다시 그린다.
  function exInput(el) {
    const box = el.closest('[data-ex]');
    const draft = box.dataset.ex === 'draft';
    const a = draft ? sheet && sheet.x : data.cfg.acc.find((x) => x.id === box.dataset.ex);
    if (!a) return;
    const seg = draft ? null : curSeg(a).chg;     // 바꾼 훈련방식이 있으면 무게·이름은 그 구간 것
    const f = el.dataset.f, v = el.value;
    const back = (msg, val) => { el.value = val; toast(msg); };
    let redraw = false;
    if (f === 'name') {
      const t = v.trim();
      if (!t) { el.value = (seg && seg.name) || a.name; return; }
      if (seg) { if (t === a.name) delete seg.name; else seg.name = t; } else a.name = t;
    } else if (f === 'part' || f === 'rest') a[f] = v.trim();
    else if (f === 'day') a.day = v === 'S' ? 'S' : 'D';
    else if (f === 'mode') {
      if (!L.MODE_KEYS.includes(v)) return;
      if (draft) { a.mode = v; a.w = snapW(v, a.w); }
      else {
        const cur = curSeg(a), now = exNow(a);
        // 지금 구간에 이미 한 기록이 있으면 다음 세션부터 (확인 상자). 지금 무게에서 가장 가까운 무게를 제안한다.
        if (now.logged) {
          pendingMode = v === cur.mode ? null : { id: a.id, mode: v, w: snapW(v, now.w != null ? now.w : cur.w), name: cur.name };
          renderSettings();
          return;
        }
        // 기록이 없으면 바로 바꾼다: 기록 중에 바꾼 구간이면 그 구간을, 아니면 처음 설정을.
        if (cur.chg && data.logs.length) { cur.chg.mode = v; cur.chg.w = snapW(v, cur.chg.w); }
        else { a.mode = v; a.w = snapW(v, a.w); a.chg = []; }
      }
      if (v === 'band' && !a.bands.length && data.cfg.gear.bands.length) a.bands = [data.cfg.gear.bands[0]];
      redraw = true;
    } else if (f === 'w') {
      const t = seg || a;
      const now = draft ? null : exNow(a);
      const shownW = now && now.logged ? now.w : t.w;
      if (v === '' && L.MODES[t.mode].list) { el.value = shownW == null ? '' : shownW; return; }
      const nw = v === '' ? null : Number(v);
      if (v !== '' && !(nw > 0)) return back('무게는 0보다 커야 해요. 비우면 생략이에요', shownW == null ? '' : shownW);
      // 이미 한 기록이 있으면 지난 기록은 그대로 두고 다음 세션부터 새 무게로 (확인 상자)
      if (now && now.logged) {
        const cur = curSeg(a);
        pendingMode = same(nw, shownW) || (nw == null && shownW == null) ? null : { id: a.id, mode: cur.mode, w: nw, name: cur.name, wOnly: true };
        renderSettings();
        return;
      }
      t.w = nw;
    } else if (f === 'stack') { a.stack = numList(v); el.value = a.stack.join(', '); redraw = true; }
    else if (f === 'band') a.bands = [...box.querySelectorAll('[data-f="band"]:checked')].map((i) => i.value);
    else if (f === 'prog') { a.prog = v === 'r' ? 'r' : 'w'; redraw = true; }
    else if (f === 'ladder') {
      const l = numList(v, { int: true, sorted: false, max: 12 });
      if (!l.length) return back('횟수를 쉼표로 나눠 넣어 주세요 (예: 3, 4, 5)', L.ladderOf(a).join(', '));
      a.ladder = l; el.value = l.join(', ');
    } else if (f === 'reps' || f === 'sets') {
      const n = Math.round(Number(v));
      if (!(n >= 1)) return back('1 이상의 숫자를 넣어 주세요', a[f]);
      a[f] = n;
    } else if (f === 'inc') { a.inc = v === 'kg' ? 'kg' : 'pct'; redraw = true; }
    else if (f === 'incV') { const n = Number(v); if (v === '' || !(n >= 0)) return back('숫자를 확인해 주세요', a.incV); a.incV = n; }
    const note = box.querySelector('.prognote');
    if (note) note.textContent = progNote(Object.assign({}, a, draft ? {} : { mode: curSeg(a).mode }));
    if (draft) { if (redraw) renderAdd(); return; }
    save();
    if (redraw) renderSettings();
  }
  // 기록이 있는 종목의 훈련방식 바꾸기 확정: 그 종목의 다음(또는 지금) 세션부터 새 방식·무게로.
  function confirmMode() {
    const pm = pendingMode;
    const a = pm && data.cfg.acc.find((x) => x.id === pm.id);
    if (!a) { pendingMode = null; renderSettings(); return; }
    if (L.MODES[pm.mode].list && !(pm.w > 0)) { toast(`설정 → 장비에 ${modeName(pm.mode)} 무게를 먼저 넣어 주세요`); return; }
    const no = changeNo(a);
    const c = { no, mode: pm.mode, w: pm.mode === 'band' ? null : pm.w };
    const name = (pm.name || '').trim();
    if (name && name !== a.name) c.name = name;
    a.chg = (a.chg || []).filter((x) => x.no < no).concat(c);
    if (pm.mode === 'band' && !a.bands.length && data.cfg.gear.bands.length) a.bands = [data.cfg.gear.bands[0]];
    pendingMode = null;
    save(pm.wOnly ? `${c.name || a.name} · 세션 ${no}부터 ${c.w == null ? '무게 생략' : L.fmtW({ w: c.w, mode: c.mode })}으로 해요` : `${c.name || a.name} · 세션 ${no}부터 ${toMode(pm.mode)} 해요`);
    renderSettings();
  }

  function applySetting(el) {
    const k = el.dataset.k;
    const cfg = data.cfg;
    const num = (v) => (v === '' ? NaN : Number(v));
    if (k === 'plate') {
      const p = Number(el.dataset.w);
      const n = Math.max(0, Math.min(PAIR_MAX, Math.floor(Number(el.value)) || 0));
      cfg.plates = cfg.plates.filter((x) => x !== p).concat(Array(n).fill(p)).sort((a, b) => a - b);
      el.closest('label').classList.toggle('on', n > 0);
    } else if (k.startsWith('gear.')) {
      const g = k.slice(5);
      const l = numList(el.value);
      if (!l.length) { el.value = cfg.gear[g].join(', '); toast('무게를 하나 이상 쉼표로 나눠 넣어 주세요'); return; }
      cfg.gear[g] = l;
      el.value = l.join(', ');
      save();
      renderSettings();
      return;
    } else if (k.startsWith('band.')) {
      const i = Number(k.slice(5));
      const old = cfg.gear.bands[i];
      const t = el.value.trim();
      if (!t || cfg.gear.bands.some((n, j) => j !== i && n === t)) { el.value = old; toast(t ? '같은 이름의 밴드가 있어요' : '밴드 이름을 넣어 주세요'); return; }
      cfg.gear.bands[i] = t;
      for (const a of cfg.acc) a.bands = a.bands.map((n) => (n === old ? t : n));
      save();
      renderSettings();
      return;
    } else if (k.startsWith('main.')) {
      const f = k.slice(5);
      if (f === 'rest') cfg.main.rest = el.value.trim();
      else if (f === 'prog') { cfg.main.prog = el.value === 'w' ? 'w' : 'r'; save(); renderSettings(); return; }
      else if (f.startsWith('inc.')) {
        const id = f.slice(4), v = Number(el.value) > 0 ? Number(el.value) : 'pct';
        const no = setMainInc(id, v);
        save(`${id === 'dl' ? '데드리프트' : '스쿼트'}는 ${no ? `세션 ${no}부터 ` : ''}${incName(v)}씩 올려요`);
        renderSettings();
        return;
      }
      else if (f === 'ladder') {
        const l = numList(el.value, { int: true, sorted: false, max: 12 });
        if (!l.length) { el.value = L.ladderOf(cfg.main).join(', '); toast('횟수를 쉼표로 나눠 넣어 주세요 (예: 3, 4, 5)'); return; }
        cfg.main.ladder = l; el.value = l.join(', ');
        save(); renderSettings(); return;
      } else {
        const v = num(el.value);
        if (!(v > 0)) { el.value = cfg.main[f]; toast('0보다 큰 숫자를 넣어 주세요'); return; }
        cfg.main[f] = f === 'dl' ? v : Math.round(v);
      }
    }
    renderDerived();
    save();
  }

  // ---------- 운동 추가 (처음 고를 때 · 설정) ----------
  const PRESETS = L.CATALOG.concat(L.EXTRA);
  function draftEx(preset, day) {
    const base = preset ? JSON.parse(JSON.stringify(preset))
      : { name: '', part: '', mode: 'dumbbell', w: null, prog: 'w', reps: 8, ladder: [8, 10, 12], sets: 3, rest: '2분', inc: 'kg', incV: 1 };
    const x = Object.assign({ stack: [], bands: [] }, base, { day: day || base.day || 'D' });
    delete x.id;
    x.w = snapW(x.mode, x.w);
    if (x.mode === 'band' && !x.bands.length && data.cfg.gear.bands.length) x.bands = [data.cfg.gear.bands[0]];
    return x;
  }
  function openAdd(day) {
    sheet = { kind: 'add', pick: '', x: draftEx(null, day), err: '', opener: document.activeElement };
    $('sheet').hidden = false;
    renderAdd();
    const first = $('ad-pick');
    if (first) first.focus();
  }
  function renderAdd() {
    const x = sheet.x;
    const no = data.started ? model(weekMon + 6).cur.no : 0;
    const have = new Set(data.cfg.acc.map((a) => a.name));
    let h = `<div><h2 id="sheetTitle">운동 추가</h2><div class="sub">${no ? `지금 세션(${no})부터 들어가요` : '처음부터 들어가요'}</div></div>
      <label class="field"><span>운동 고르기</span><select id="ad-pick" data-addpick="1"><option value="">직접 입력</option>${PRESETS.map((p) => `<option value="${esc(p.id)}" ${sheet.pick === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(modeName(p.mode))}${have.has(p.name) ? ' (이미 있음)' : ''}</option>`).join('')}</select></label>
      <div class="exform" data-ex="draft">
        <div class="row2"><label class="field"><span>이름</span><input type="text" id="ad-name" data-f="name" value="${esc(x.name)}" placeholder="예: 바벨 컬"></label>
        <label class="field"><span>하는 날</span><select id="ad-day" data-f="day"><option value="D" ${x.day === 'D' ? 'selected' : ''}>데드리프트 날</option><option value="S" ${x.day === 'S' ? 'selected' : ''}>스쿼트 날</option></select></label></div>
        ${exForm(x, 'ad')}
      </div>
      ${sheet.err ? `<p class="small err" role="alert">${esc(sheet.err)}</p>` : ''}
      <button class="btn block" type="button" data-act="addSave">추가하기</button>
      <button class="btn ghost" type="button" data-act="close">닫기</button>`;
    const panel = $('panel');
    const top = panel.scrollTop;
    const focusId = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.id : '';
    panel.innerHTML = h;
    panel.scrollTop = top;
    if (focusId && $(focusId)) $(focusId).focus();
  }
  function addSave() {
    const x = sheet.x;
    const fail = (msg) => { sheet.err = msg; renderAdd(); };
    if (!x.name.trim()) return fail('이름을 넣어 주세요.');
    if (L.MODES[x.mode].list && !(x.w > 0)) return fail(`설정 → 장비에 ${modeName(x.mode)} 무게를 먼저 넣어 주세요.`);
    const used = new Set(data.cfg.acc.map((a) => a.id));
    // 기록이 있으면 예전에 지운 종목의 기록이 다시 붙지 않도록 새 id를 쓴다.
    const id = sheet.pick && !used.has(sheet.pick) && !data.logs.length ? sheet.pick : 'x' + Date.now().toString(36);
    // 진행 중인 세션에 넣으면 그 세션의 남은 차례부터 한다 (이미 지난 차례를 밀린 것으로 보지 않게).
    const cur = data.started ? model(weekMon + 6).cur : null;
    const no = cur ? cur.no : 1;
    const a = sanitizeAcc(Object.assign({}, x, { id, name: x.name.trim(), from: no, fromK: cur ? cur.n : 0, chg: [] }));
    data.cfg.acc.push(a);
    closeSheet();
    save(data.started ? `${a.name} · 세션 ${no}부터 들어가요` : `${a.name} · ${TYPE_NAME[a.day]} 날에 넣었어요`);
    if (tab === 'settings') renderSettings();
  }
  // 처음 시작 전: 요일별로 할 운동을 빼고 더한다 (이미 시작한 사람에게는 보이지 않는다).
  function renderPick() {
    const el = $('pick');
    if (!el) return;
    if (data.started) { el.innerHTML = ''; return; }
    let h = '<div class="pickhead"><strong>요일별 운동 고르기</strong><span class="small">데드리프트 날·스쿼트 날에 같이 할 운동을 빼거나 더하세요. 무게·훈련방식은 설정에서 자세히 바꿀 수 있어요.</span></div><div class="pickdays">';
    for (const day of ['D', 'S']) {
      h += `<div class="pickday"><div class="pickdayhead"><span class="tag ${day}">${TYPE_NAME[day]} 날</span></div><ul>
        <li class="fixed"><span>${TYPE_NAME[day]}<span class="small"> · 하체 메인</span></span></li>`;
      for (const a of data.cfg.acc.filter((x) => x.day === day)) {
        h += `<li><span>${esc(a.name)}<span class="small"> · ${esc(modeName(a.mode))}</span></span><button class="iconbtn sm" type="button" data-act="pickDel" data-id="${esc(a.id)}" aria-label="${esc(a.name)} 빼기">×</button></li>`;
      }
      h += `</ul><button class="btn ghost" type="button" data-act="addAcc" data-day="${day}">+ ${TYPE_NAME[day]} 날 운동 추가</button></div>`;
    }
    el.innerHTML = h + '</div>';
  }

  // ---------- 알림 ----------
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function setTab(next) {
    tab = next;
    for (const name of ['week', 'plan', 'chart', 'settings']) {
      $('view-' + name).hidden = name !== tab;
      $('tab-' + name).setAttribute('aria-selected', String(name === tab));
    }
    if (tab === 'settings') { pendingDel = null; confirmReset = false; renderSettings(); }
    render();
    window.scrollTo(0, 0);
  }

  // ---------- 이벤트 ----------
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) { if (ev.target === $('sheet')) closeSheet(); return; }
    const act = b.dataset.act;
    const day = b.dataset.day == null ? null : Number(b.dataset.day);
    if (act === 'tab') setTab(b.dataset.tab);
    else if (act === 'start') commit('오늘부터 시작했어요');
    else if (act === 'jump') { const el = $('d' + day); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (act === 'log') openSheet('new', day);
    else if (act === 'startSheet') openStart(null);
    else if (act === 'startAt') openStart(day);
    else if (act === 'saveStart') saveStart();
    else if (act === 'edit') openSheet('edit', day);
    else if (act === 'close') closeSheet();
    else if (act === 'res') {
      const id = b.dataset.id, v = b.dataset.v === '1';
      if (sheet.res[id] === v) delete sheet.res[id]; else sheet.res[id] = v;   // 다시 누르면 선택 해제
      renderSheet(model(weekMon + 6));
      const again = $('panel').querySelector(`[data-act="res"][data-id="${CSS.escape(id)}"][data-v="${b.dataset.v}"]`);
      if (again) again.focus();
    }
    else if (act === 'allok') { for (const r of sheetInfo(model(weekMon + 6)).rows) if (r.avail === 'ok') sheet.res[r.id] = true; renderSheet(model(weekMon + 6)); }
    else if (act === 'saveLog') saveLog();
    else if (act === 'timer') openTimer();
    else if (act.startsWith('t') && /^t(Start|Skip|Undo|Reset|Edit|Save)$/.test(act)) timerAct(act, b.dataset.id);
    else if (act === 'chartMode') { chartMode = b.dataset.v === 'each' ? 'each' : 'all'; renderChart(); }
    else if (act === 'chartToggle') { const k = b.dataset.key; if (chartOff.has(k)) chartOff.delete(k); else chartOff.add(k); renderChart(); }
    else if (act === 'askDel') { sheet.confirmDel = true; renderSheet(model(weekMon + 6)); }
    else if (act === 'keepLog') { sheet.confirmDel = false; renderSheet(model(weekMon + 6)); }
    else if (act === 'delLog') { data.logs.pop(); closeSheet(); commit('기록을 지웠어요'); }
    else if (act === 'addAcc') openAdd(b.dataset.day);
    else if (act === 'addSave') addSave();
    else if (act === 'pickDel') { const a = data.cfg.acc.find((x) => x.id === b.dataset.id); data.cfg.acc = data.cfg.acc.filter((x) => x.id !== b.dataset.id); save(a ? `${josa(a.name, '을', '를')} 뺐어요` : ''); }
    else if (act === 'pmOk') confirmMode();
    else if (act === 'pushOn') pushEnable();
    else if (act === 'pushOff') pushDisable();
    else if (act === 'pushTest') pushTest();
    else if (act === 'pmCancel') { pendingMode = null; renderSettings(); }
    else if (act === 'addBand') {
      const names = data.cfg.gear.bands;
      let n = names.length + 1;
      while (names.includes(`${n}번밴드`)) n++;
      names.push(`${n}번밴드`);
      save(`${n}번밴드를 추가했어요`); renderSettings();
      const el = $(`set-band-${names.length - 1}`); if (el) el.focus();
    } else if (act === 'delBand') {
      const name = data.cfg.gear.bands[Number(b.dataset.i)];
      if (name == null) return;
      data.cfg.gear.bands = data.cfg.gear.bands.filter((n) => n !== name);
      for (const a of data.cfg.acc) a.bands = a.bands.filter((n) => n !== name);
      save(`${josa(name, '을', '를')} 뺐어요. 지난 기록에는 남아 있어요`); renderSettings();
    } else if (act === 'delAcc') {
      const id = b.dataset.id;
      if (pendingDel !== id) { pendingDel = id; renderSettings(); return; }
      data.cfg.acc = data.cfg.acc.filter((a) => a.id !== id);
      if (pendingMode && pendingMode.id === id) pendingMode = null;
      pendingDel = null; save('종목을 지웠어요'); renderSettings();
    } else if (act === 'copyBackup') {
      const text = JSON.stringify(data);
      const box = $('backupBox');
      try { await navigator.clipboard.writeText(text); toast('백업을 복사했어요. 메모 앱 등에 붙여 넣어 두세요'); }
      catch (e) { box.value = text; box.focus(); box.select(); toast('아래 칸의 내용을 길게 눌러 복사하세요'); }
    } else if (act === 'importBackup') {
      let parsed = null;
      try { parsed = sanitize(JSON.parse($('backupBox').value)); } catch (e) { parsed = null; }
      if (!parsed) { toast('백업 내용을 읽지 못했어요. 복사한 글 전체를 붙여 넣어 주세요'); return; }
      data = parsed; commit('백업을 불러왔어요'); renderSettings();
    } else if (act === 'askReset') { confirmReset = true; renderSettings(); }
    else if (act === 'cancelReset') { confirmReset = false; renderSettings(); }
    else if (act === 'reset') {
      data.logs = []; data.cfg.startDate = today; confirmReset = false;
      // 기록 중에 바꾼 훈련방식은 지금 방식을 처음 설정으로 삼는다.
      for (const a of data.cfg.acc) { const c = curSeg(a); if (c.no) Object.assign(a, { mode: c.mode, w: c.w, name: c.name, chg: [] }); }
      weekMon = L.mondayOf(L.toNum(today));
      commit('기록을 지우고 오늘부터 다시 시작해요'); renderSettings();
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t.dataset) return;
    if (t.dataset.sk) { if (sheet && sheet.kind === 'start') startInput(t, true); }
    else if (t.dataset.f && t.closest('[data-ex]')) exInput(t);
    else if (t.dataset.pm && pendingMode) { if (t.dataset.pm === 'name') pendingMode.name = t.value; else pendingMode.w = t.value === '' ? null : Number(t.value) > 0 ? Number(t.value) : pendingMode.w; }
    else if (t.dataset.addpick && sheet && sheet.kind === 'add') { sheet.pick = t.value; sheet.x = draftEx(PRESETS.find((x) => x.id === t.value) || null, sheet.x.day); sheet.err = ''; renderAdd(); }
    else if (t.dataset.k) applySetting(t);
  });
  document.addEventListener('input', (ev) => { const t = ev.target; if (t.dataset && t.dataset.sk && sheet && sheet.kind === 'start') startInput(t, false); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && sheet) closeSheet(); });
  $('prevWeek').addEventListener('click', () => { weekMon -= 7; render(); });
  $('nextWeek').addEventListener('click', () => { weekMon += 7; render(); });
  $('thisWeek').addEventListener('click', () => { weekMon = L.mondayOf(L.toNum(today)); render(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const now = L.localToday();
    if (now !== today) { today = now; weekMon = L.mondayOf(L.toNum(today)); timer = loadTimer(); render(); }
    if (Object.values(timer.items).some((t) => t.endAt)) { tick(); if (running()) startTick(); }
    pushRefresh();
  });

  render();
  if (Object.values(timer.items).some((t) => t.endAt)) { tick(); if (running()) startTick(); }
  const boot = $('boot');
  if (boot) boot.remove();
  window.onerror = null;
  connectRemote();
  if (window.ROUTINE_STANDALONE && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    pushRefresh();
  }
})();
