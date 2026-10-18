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
  let confirmReset = false;
  let remote = null;         // Claude 계정 저장소(db) 문서, 없으면 이 기기에만 저장
  let toastTimer = 0;

  function fresh() { return { v: 1, updatedAt: 0, started: false, cfg: L.defaultConfig(today), logs: [] }; }

  // ---------- 저장 ----------
  function loadLocal() {
    try { const raw = localStorage.getItem(KEY); return raw ? sanitize(JSON.parse(raw)) : null; } catch (e) { return null; }
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 저장소를 쓸 수 없는 환경 */ }
  }
  function sanitize(x) {
    if (!x || typeof x !== 'object' || !x.cfg || !Array.isArray(x.logs)) return null;
    const base = L.defaultConfig(today);
    const c = L.migrate(JSON.parse(JSON.stringify(x.cfg)));
    const EQUIP = ['barbell', 'machine', 'dumbbell'];
    const cfg = {
      cv: c.cv,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(c.startDate) ? c.startDate : today,
      from: sanitizeFrom(c.from),
      plates: Array.isArray(c.plates) ? [...L.plateCounts(c.plates)].flatMap(([p, n]) => Array(Math.min(n, PAIR_MAX)).fill(p)).sort((a, b) => a - b) : base.plates,
      main: Object.assign({}, base.main, c.main || {}),
      acc: Array.isArray(c.acc)
        ? c.acc.filter((a) => a && a.id && (a.day === 'D' || a.day === 'S')).map((a) => {
          const b = Object.assign({ name: '종목', part: '', equip: 'dumbbell', w: null, reps: 5, sets: 3, rest: '', inc: 'pct', incV: 5, light: false, from: 1, sw: null }, a);
          if (!EQUIP.includes(b.equip)) b.equip = 'dumbbell';
          if (b.sw && !(b.sw.at > 0 && b.sw.w > 0)) b.sw = null;
          return b;
        })
        : base.acc,
    };
    const seen = new Set();
    const logs = x.logs
      .filter((l) => l && /^\d{4}-\d{2}-\d{2}$/.test(l.d) && !seen.has(l.d) && seen.add(l.d))
      .map((l) => Object.assign({ d: l.d, res: l.res && typeof l.res === 'object' ? l.res : {} }, l.p ? { p: 1 } : {}))
      .sort((a, b) => (a.d < b.d ? -1 : 1));
    return { v: 1, updatedAt: +x.updatedAt || 0, started: !!x.started || logs.length > 0, cfg, logs };
  }
  // 시작 지점: 적힌 값만 남긴다 (빠진 상체 단계는 하체 단계에 맞춘 기본값을 쓴다).
  function sanitizeFrom(f) {
    const sp = L.startPoint({ from: f });
    const acc = {};
    for (const [id, o] of Object.entries(sp.acc)) {
      if (!o || typeof o !== 'object') continue;
      const b = {};
      if (Number.isFinite(Number(o.step)) && o.step !== null && o.step !== '') b.step = Math.max(-9, Math.min(L.ACC_TOP, Math.floor(o.step)));
      if (o.done != null) b.done = !!o.done;
      if (o.phase) b.phase = 1;
      if (Number(o.n) > 0) b.n = Math.floor(o.n);
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
      if (theirs && theirs.started && theirs.updatedAt > data.updatedAt) { data = theirs; saveLocal(); render(); }
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

  const md = (n) => { const s = L.toStr(n); return +s.slice(5, 7) + '.' + +s.slice(8, 10); };
  const longDate = (n) => { const s = L.toStr(n); return `${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일 (${DOW[L.weekday(n)]})`; };
  const stageText = (main) => (main.stage >= 1 ? `묶음 ${main.bundle} · ${main.stage}단계` : `묶음 ${main.bundle} · 회복`);
  function wHtml(row) {
    const s = L.fmtW(row);
    return s.endsWith('kg') ? `${esc(s.slice(0, -2))}<span class="unit">kg</span>` : esc(s);
  }
  // 바벨·기구 종목의 원판 안내 (5kg 단위 + 경량원판). 덤벨이나 무게 생략 종목은 null.
  function plates(row) {
    if (row.skip || row.w == null) return null;
    const sol = L.plateMath(L.roundW(row.w), data.cfg.plates, row.equip);
    return sol ? { sol, text: L.plateText(sol), label: row.equip === 'machine' ? '추' : '원판' } : null;
  }
  const BALANCE_NOTE = '<strong>좌우 균형:</strong> 원판을 더 끼운 쪽은 끝까지 밀어 넣고 바깥으로 움직이지 않게 마구리로 고정하세요. 반대쪽은 원판을 조금 바깥쪽에 둔 채 마구리를 끼우세요.';
  function flags(row) {
    let f = '';
    if (row.retry) f += '<span class="flag retry">재도전</span>';
    if (row.hold) f += '<span class="flag hold">유지</span>';
    if (row.lag) f += `<span class="flag lag">밀림 · 세션 ${row.accNo} 몫</span>`;
    return f;
  }

  // ---------- 그리기 ----------
  function render() {
    const m = model(weekMon + 6);
    renderHeader(m);
    if (tab === 'week') renderWeek(m);
    if (tab === 'plan') renderPlan();
    if (tab === 'chart') renderChart();
    if (tab === 'settings' && !$('view-settings').childElementCount) renderSettings();
    $('welcome').hidden = data.started || tab !== 'week';
    if (sheet) renderSheet(m);
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
      if (pl && pl.sol.unbalanced) unbalanced = true;
      h += `<tr class="${r.main ? 'main' : ''}${pl ? ' with-plate' : ''}${undone ? ' undone' : ''}"><td><div class="nm">${esc(r.name)}${flags(r)}</div><div class="pt">${esc(r.main ? '하체 메인' : r.part)}${undone ? ' · 안 함 → 다음 ' + TYPE_NAME[type] + ' 날로' : ''}</div></td>
        <td class="c-w">${wHtml(r)}</td><td class="c-r">${r.reps}×${r.sets}</td><td class="c-t">${esc(r.rest)}</td>${logged ? `<td class="c-s">${mark}</td>` : ''}</tr>`;
      if (pl) h += `<tr class="plate"><td colspan="${logged ? 5 : 4}"><span class="pl">${pl.label}</span>${esc(pl.text)}</td></tr>`;
    }
    h += '</tbody></table>';
    if (unbalanced) h += `<div class="skipnote balance">${BALANCE_NOTE}</div>`;
    if (waiting.length) h += `<div class="skipnote">이번 차례는 이미 해서 하체가 따라올 때까지 쉬어요: ${waiting.map((r) => esc(r.name)).join(', ')}</div>`;
    if (skipped.length) h += `<div class="skipnote">하체 4단계(가장 무거운 세션)라 상체·팔은 쉬어요: ${skipped.map((r) => esc(r.name)).join(', ')}</div>`;
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
          ${can ? `<div class="dayfoot"><button class="btn ghost" type="button" data-act="log" data-day="${d}">${isToday ? '오늘 운동한다면' : '이 날도 운동했다면'} · 기록하기</button><span class="hint">기록하면 운동한 날로 계산해요</span></div>` : ''}</section>`;
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
      if (isLog && e.rows[0].result == null) meta += ` · ${TYPE_NAME[type]}를 안 해서 다음 날도 ${TYPE_NAME[type]} 날`;
      if (e.restSkipped) meta += ' · 지난 세션 중 2일 이상 쉬어서 정식 휴식 없이 이어가요';
      let foot = '';
      if (isLog) foot = `<button class="btn ghost" type="button" data-act="edit" data-day="${d}">결과 고치기</button>`;
      else if (L.canLog(m.tl, d)) foot = `<button class="btn" type="button" data-act="log" data-day="${d}">운동 기록하기</button><span class="hint">끝나면 한 종목만 골라도 저장돼요</span>`;
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
    for (const a of cfg.acc) h += `<th class="wrap-h">${esc(a.name)}${a.sw ? ` → ${esc(a.sw.name)}` : ''}<br><span class="sdate">${a.day === 'D' ? '데드 날' : '스쿼트 날'}</span></th>`;
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
      h += `<td class="stage">${esc(stageText(p.main))}${p.main.retry ? '<br>재도전' : ''}</td>`;
      h += `<td><span class="w">${L.roundW(p.main.dl)}</span>${mark(real ? s.out : null)}</td>`;
      h += `<td><span class="w">${L.roundW(p.main.sq)}</span>${mark(real ? s.out : null)}</td>`;
      for (const a of cfg.acc) {
        const q = p.acc[a.id];
        if (q.off || q.pending) { h += '<td></td>'; continue; }
        if (q.skip) { h += '<td class="rest">휴식</td>'; continue; }
        const ai = sim.real.acc[a.id];
        const out = i < ai ? sim.acc[a.id][i].out : null;
        const behind = i === ai && ai < sim.real.main ? '<span class="rp"> 밀림</span>' : '';
        const w = L.fmtW({ w: q.w, n: q.n, inc: q.inc, incV: q.incV }).replace('kg', '');
        const switched = a.sw && q.phase ? `<span class="rp"> ${esc(a.sw.name)}</span>` : '';
        h += `<td><span class="w">${esc(w)}</span> <span class="rp">×${q.reps}</span>${mark(out)}${behind}${switched}</td>`;
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
        const key = r.main ? r.id : r.id + (r.phase ? '.b' : '');
        const rel = r.w == null;
        const y = rel ? (r.inc === 'kg' ? r.n * r.incV : (Math.pow(1 + r.incV / 100, r.n) - 1) * 100) : L.roundW(r.w);
        const text = `${L.fmtW(r)} × ${r.reps}회 × ${r.sets}세트 · ${r.result ? '성공' : '실패'}`;
        recs.push({ d, name: r.name, text });
        if (!each.has(key)) each.set(key, { key, ent, name: r.name, color: color(ent), unit: rel ? (r.inc === 'kg' ? '+kg' : '+%') : 'kg', pts: [] });
        each.get(key).pts.push({ x: d, y, ok: r.result, text });
        if (rel || !slot.get(ent)) continue;
        const w = r.main ? e.main.dl : r.w;
        const phase = r.phase || 0;
        let s = all.get(ent);
        if (!s) {
          const a = cfg.acc.find((x) => x.id === ent);
          s = { key: ent, name: r.main ? '데드리프트·스쿼트' : a.sw ? `${a.name}→${a.sw.name}` : a.name, color: color(ent), slot: slot.get(ent), pts: [], g: 1, prev: w, phase };
          all.set(ent, s);
        } else {
          if (phase === s.phase) s.g *= w / s.prev;
          s.prev = w; s.phase = phase;
        }
        const pct = Math.round((s.g - 1) * 100);
        s.pts.push({ x: d, g: s.g, ok: r.result, v: `${pct > 0 ? '+' : ''}${pct}%`, text: `${r.main ? `데드 ${L.roundW(e.main.dl)}kg` : L.fmtW(r)} · ${r.result ? '성공' : '실패'}` });
      }
    }
    for (const s of all.values()) {
      const top = Math.max(...s.pts.map((p) => p.g));
      for (const p of s.pts) p.y = top > 1 + 1e-9 ? (p.g - 1) / (top - 1) : 0;
    }
    const order = (x) => (x.key === 'dl' ? 0 : x.key === 'sq' ? 1 : (slot.get(x.ent) || 99) * 2 + (x.key.endsWith('.b') ? 1 : 0));
    return { each: [...each.values()].sort((a, b) => order(a) - order(b)), all: [...all.values()].sort((a, b) => a.slot - b.slot), recs };
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
  function sheetInfo(m) {
    return sheet.mode === 'new' ? m.sim.next : m.sim.days.get(sheet.day);
  }
  function renderSheet(m) {
    if (sheet.kind === 'start') { renderStart(); return; }
    const info = sheetInfo(m);
    const rows = info.rows.filter((r) => r.avail === 'ok');
    const others = info.rows.filter((r) => r.avail !== 'ok');
    const any = rows.some((r) => typeof sheet.res[r.id] === 'boolean');
    const isLast = sheet.mode === 'edit' && sheet.li === data.logs.length - 1;
    let h = `<div><h2 id="sheetTitle">${longDate(sheet.day)} · ${TYPE_NAME[info.type]}</h2>
      <div class="sub">세션 ${info.no} · ${info.pos + 1}/6 · ${esc(stageText(info.main))}</div></div>
      <p class="small">목표 횟수×세트를 모두 채웠으면 성공, 한 세트라도 못 채웠으면 실패예요. <strong>하지 않은 종목은 비워 두세요.</strong> 다음 ${TYPE_NAME[info.type]} 날로 밀려요. 누른 버튼을 한 번 더 누르면 선택이 풀려요.</p>
      <div class="lrows">`;
    for (const r of rows) {
      const v = sheet.res[r.id];
      const pl = plates(r);
      h += `<div class="lrow"><div><div class="nm">${esc(r.name)}${flags(r)}</div><div class="rx"><b>${wHtml(r)}</b> · ${r.reps}회 × ${r.sets}세트</div>
        ${pl ? `<div class="rx pl-line"><span class="pl">${pl.label}</span>${esc(pl.text)}</div>` : ''}${pl && pl.sol.unbalanced ? `<div class="rx bal">${BALANCE_NOTE}</div>` : ''}</div>
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
    if (sheet.mode === 'new') {
      data.logs.push({ d: L.toStr(sheet.day), res, p: 1 });
      const after = L.simulate(data.cfg, data.logs, today, { until: -Infinity });
      let msg;
      if (after.cur.no > m.cur.no) {
        const done = after.main[after.cur.i - 1];
        msg = `세션 ${done.no} 완료${done.out ? '' : '(하체 실패)'} · 다음 세션 데드리프트 ${L.roundW(after.cur.presc.dl)}kg`;
      } else msg = info.rows[0].id in res ? `${after.cur.n}/6 기록했어요` : `기록했어요 · ${TYPE_NAME[info.type]}는 다음 날로 밀려요`;
      if (left) msg += ` · 안 한 ${left}종목은 다음 ${TYPE_NAME[info.type]} 날로`;
      closeSheet(); commit(msg);
    } else {
      data.logs[sheet.li] = { d: data.logs[sheet.li].d, res, p: 1 };
      closeSheet(); commit('결과를 고쳤어요. 이후 계획을 다시 계산했어요');
    }
  }

  // ---------- 이어서 시작 (시작 지점) ----------
  // 이미 하던 루틴을 이어서 기록할 때: 그 날 운동이 몇 세션의 몇 번째였는지, 그때 하체 단계·무게·횟수를 정한다.
  const stageName = (s) => ['1단계 · 묶음 시작', '2단계', '3단계', '4단계 · 가장 무거운 날'][s - 1];
  function openStart(day) {
    const cfg = data.cfg;
    const sp = L.startPoint(cfg);
    const st = L.initState(cfg);
    const T = L.toNum(today);
    // 기록이 있으면 첫 기록 날이 시작 지점이다 (그 기록이 새 세션·순서로 다시 계산된다).
    if (data.logs.length) day = L.toNum(data.logs[0].d);
    else if (day == null) day = L.toNum(cfg.startDate) < T ? L.toNum(cfg.startDate) : T - 1;
    const acc = {};
    for (const a of cfg.acc) { const s = st.acc[a.id]; acc[a.id] = { w: a.w, step: s.step, done: s.done, phase: s.phase, n: s.n }; }
    sheet = { kind: 'start', day, no: sp.no, k: sp.k, stage: sp.stage, dl: cfg.main.dl, acc, note: '', err: '', opener: document.activeElement };
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
      sheet.stage = ((sheet.no - 1) % L.MAIN_STAGES) + 1;
      stageDefaults();
      sheet.note = `지금 시작 지점(세션 ${L.startPoint(cfg).no})보다 앞 세션이라 무게는 채우지 못했어요. 그 세션의 무게로 고쳐 주세요.`;
      return;
    }
    sheet.stage = p.presc.main.stage;
    sheet.dl = L.roundW(p.presc.main.dl);
    for (const a of cfg.acc) {
      const s = p.state.acc[a.id];
      sheet.acc[a.id] = { w: s.w == null ? null : L.roundW(s.w), step: s.step, done: s.done, phase: s.phase, n: s.n };
    }
    sheet.note = `세션 ${L.startPoint(cfg).no}부터 모두 성공했다고 보고 채웠어요. 실제와 다르면 고쳐 주세요.`;
  }
  // 하체 단계를 직접 바꾸면 상체·팔 횟수도 그 단계에 맞춘다.
  function stageDefaults() {
    for (const a of data.cfg.acc) Object.assign(sheet.acc[a.id], L.accAt((a.from || 1) > sheet.no ? 1 : sheet.stage));
  }
  function stepOptions(a, o) {
    const reps = (step) => L.ladderReps(a, { w: o.w, step });
    const cur = o.done ? 'h' : String(o.step);
    const opts = [];
    for (let step = Math.min(-2, o.step); step <= L.ACC_TOP; step++) {
      if (step < 0 && reps(step) >= reps(step + 1)) continue;
      opts.push([String(step), `${reps(step)}회 · ${step < 0 ? '낮춘 단계' : `${step + 1}단계`}`]);
    }
    opts.push(['h', `${reps(L.ACC_TOP)}회 유지 · 증량 대기`]);
    return opts.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`).join('');
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
      <label class="field"><span>하체 단계</span><select id="st-stage" data-sk="stage">${[1, 2, 3, 4].map((s) => `<option value="${s}" ${s === d.stage ? 'selected' : ''}>${stageName(s)}</option>`).join('')}</select></label></div>
      ${d.note ? `<p class="small note">${esc(d.note)}</p>` : ''}
      <div class="row2"><label class="field"><span>데드리프트 (kg)</span><input type="number" inputmode="decimal" step="0.1" min="1" id="st-dl" data-sk="dl" value="${d.dl}"></label>
      <div class="field"><span>스쿼트</span><div class="derived" id="st-sq"></div></div></div>
      <div class="stacc"><div class="sthead">상체·팔 <span>· 이 세션의 무게와 횟수</span></div>`;
    for (const a of cfg.acc) {
      const o = d.acc[a.id];
      const off = (a.from || 1) > d.no;
      const name = a.sw && o.phase ? a.sw.name : a.name;
      h += `<div class="strow"><div class="stname"><span class="tag ${a.day}">${a.day === 'D' ? '데드 날' : '스쿼트 날'}</span><b>${esc(name)}</b>${off ? `<span class="small">세션 ${a.from}부터</span>` : ''}</div>
        <div class="row2">${o.w == null ? '<div class="field"><span>무게</span><div class="derived">생략</div></div>'
          : `<label class="field"><span>무게 (kg)</span><input type="number" inputmode="decimal" step="0.1" min="0.1" id="st-w-${esc(a.id)}" data-sk="w" data-id="${esc(a.id)}" value="${o.w}"></label>`}
        <label class="field"><span>횟수</span><select id="st-step-${esc(a.id)}" data-sk="step" data-id="${esc(a.id)}">${stepOptions(a, o)}</select></label></div>
        ${a.sw ? `<label class="field"><span>종목</span><select id="st-phase-${esc(a.id)}" data-sk="phase" data-id="${esc(a.id)}"><option value="0" ${o.phase ? '' : 'selected'}>${esc(a.name)}</option><option value="1" ${o.phase ? 'selected' : ''}>${esc(a.sw.name)}</option></select></label>` : ''}</div>`;
    }
    h += '</div>';
    if (d.stage === L.MAIN_STAGES) h += '<p class="small">하체 4단계 세션이라 이 세션의 상체·팔은 쉬어요. 횟수는 다음 묶음에서 이어갈 단계로 골라 주세요.</p>';
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
      if (done && a && a.light) { const sel = $('st-step-' + a.id); if (sel) sel.innerHTML = stepOptions(a, o); }
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
    else if (f === 'step' && o) { if (el.value === 'h') { o.step = L.ACC_TOP; o.done = true; } else { o.step = Number(el.value); o.done = false; } return; }
    else if (f === 'phase' && o && a && a.sw) { o.phase = el.value === '1' ? 1 : 0; if (o.phase && o.w != null) o.w = a.sw.w; }
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
    for (const a of cfg.acc) { const w = d.acc[a.id].w; if (w != null && !(w > 0)) return fail(`${a.name} 무게를 확인해 주세요.`); }
    cfg.startDate = L.toStr(d.day);
    cfg.main.dl = L.roundW(d.dl);
    const acc = {};
    for (const a of cfg.acc) {
      const o = d.acc[a.id];
      if (a.w != null && o.w != null) a.w = L.roundW(o.w);
      acc[a.id] = { step: o.step, done: !!o.done && o.step === L.ACC_TOP, phase: a.sw && o.phase ? 1 : 0, n: o.n || 0 };
    }
    cfg.from = { no: d.no, k: d.k, stage: d.stage, acc };
    const day = d.day;
    closeSheet();
    weekMon = L.mondayOf(day);
    commit(`세션 ${d.no}의 ${d.k + 1}번째 운동부터 이어가요`);
    if (tab === 'settings') renderSettings();
    // 지난 날을 시작으로 잡았으면 그 날 한 운동 결과를 바로 체크한다.
    if (day < T && L.canLog(model(weekMon + 6).tl, day)) openSheet('new', day);
  }

  // ---------- 설정 ----------
  function renderSettings() {
    const cfg = data.cfg;
    const sp = L.startPoint(cfg);
    const wl = sp.no > 1 ? `세션 ${sp.no} 무게` : '시작 무게';
    const equipOpts = (v) => [['barbell', '바벨'], ['machine', '머신·케이블'], ['dumbbell', '덤벨']].map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('');
    let h = `<div class="card"><h2>시작 지점</h2>
      <p class="startsum"><b>${longDate(L.toNum(cfg.startDate))}</b> · 세션 ${sp.no}의 ${sp.k + 1}번째 운동(${TYPE_NAME[L.slotType(sp.k)]}) · 하체 ${sp.stage}단계</p>
      <p class="small">이미 하던 루틴이 있으면 시작 지점을 그 세션으로 옮기세요. 그 날부터 오늘까지 한 운동은 이번 주 화면에서 지난 날을 눌러 날짜순으로 기록하면 돼요. 아래 무게는 시작 지점 세션의 무게예요.</p>
      <div class="btnrow"><button class="btn ghost" type="button" data-act="startSheet">시작 지점 바꾸기 · 이어서 시작</button></div>
      <p class="small">쉬는 요일은 따로 없어요. 세션의 6번째 운동을 마친 다음 날 하루 쉬고, 기록하지 않은 날은 쉰 날로 봐요. 무게·횟수를 바꾸면 지난 기록까지 포함해 전체 계획을 다시 계산해요.</p></div>`;

    const cnt = L.plateCounts(cfg.plates);
    h += `<div class="card"><h2>가지고 있는 경량원판</h2>
      <p class="small">종류마다 몇 쌍 있는지 골라 주세요. 1쌍 = 2장이에요. 2.5kg 이상 원판은 개수 제한 없이 있다고 보고, 2.5kg은 필요하면 한 짝(한쪽만)도 쓰게 안내해요.</p>
      <div class="plates">${[...L.PLATE_OPTIONS].map((p) => {
        const n = cnt.get(p) || 0;
        const opts = Array.from({ length: PAIR_MAX + 1 }, (_, i) => `<option value="${i}"${i === n ? ' selected' : ''}>${i ? i + '쌍' : '없음'}</option>`).join('');
        return `<label class="${n ? 'on' : ''}"><span>${p}kg</span><select id="set-plate-${String(p).replace('.', '_')}" data-k="plate" data-w="${p}" aria-label="${p}kg 원판 쌍 수">${opts}</select></label>`;
      }).join('')}</div>
      <p class="small">바벨·머신 종목에는 5kg 단위 무게와 나머지를 채울 경량원판을 함께 보여줘요. 목표 무게 이상이 되는 가장 가벼운 조합을 고르고, 바벨은 그다음으로 좌우가 고른 조합을 골라요.</p></div>`;

    h += `<div class="card"><h2>하체 메인 · 데드리프트와 스쿼트</h2>
      <div class="row2"><label class="field"><span>데드리프트 ${wl} (kg)</span><input type="number" inputmode="decimal" step="0.1" min="1" id="set-dl" data-k="main.dl" value="${cfg.main.dl}"></label>
      <div class="field"><span>스쿼트 ${wl}</span><div class="derived" id="sqDerived"></div></div></div>
      <div class="row3"><label class="field"><span>횟수</span><input type="number" inputmode="numeric" min="1" id="set-mreps" data-k="main.reps" value="${cfg.main.reps}"></label>
      <label class="field"><span>세트</span><input type="number" inputmode="numeric" min="1" id="set-msets" data-k="main.sets" value="${cfg.main.sets}"></label>
      <label class="field"><span>휴식</span><input type="text" id="set-mrest" data-k="main.rest" value="${esc(cfg.main.rest)}"></label></div></div>`;

    h += '<div class="card"><h2>상체·팔 보조 운동</h2><p class="small">무게를 비워 두면 "무게 생략"으로 두고 증량분만 +1kg처럼 표시해요.</p>';
    cfg.acc.forEach((a, i) => {
      const del = pendingDel === a.id;
      h += `<div class="acc"><div class="acc-head"><span class="tag ${a.day}">${a.day === 'D' ? '데드 날' : '스쿼트 날'}</span>
        <input type="text" id="acc-${esc(a.id)}-name" data-k="acc.${i}.name" value="${esc(a.name)}" aria-label="종목 이름">
        <button class="btn ${del ? 'danger' : 'ghost'}" type="button" data-act="delAcc" data-id="${esc(a.id)}">${del ? '한 번 더 누르면 삭제' : '삭제'}</button></div>
        <div class="row3"><label class="field"><span>부위</span><input type="text" id="acc-${esc(a.id)}-part" data-k="acc.${i}.part" value="${esc(a.part)}"></label>
        <label class="field"><span>${wl} (kg)</span><input type="number" inputmode="decimal" step="0.1" min="0" id="acc-${esc(a.id)}-w" data-k="acc.${i}.w" value="${a.w == null ? '' : a.w}" placeholder="생략"></label>
        <label class="field"><span>1단계 횟수</span><input type="number" inputmode="numeric" min="1" id="acc-${esc(a.id)}-reps" data-k="acc.${i}.reps" value="${a.reps}"></label></div>
        <div class="row2 pair"><div class="row2"><label class="field"><span>세트</span><input type="number" inputmode="numeric" min="1" id="acc-${esc(a.id)}-sets" data-k="acc.${i}.sets" value="${a.sets}"></label>
        <label class="field"><span>휴식</span><input type="text" id="acc-${esc(a.id)}-rest" data-k="acc.${i}.rest" value="${esc(a.rest)}"></label></div>
        <div class="row2"><label class="field"><span>증량 방식</span><select id="acc-${esc(a.id)}-inc" data-k="acc.${i}.inc"><option value="pct" ${a.inc === 'pct' ? 'selected' : ''}>%</option><option value="kg" ${a.inc === 'kg' ? 'selected' : ''}>kg</option></select></label>
        <label class="field"><span>증량 값</span><input type="number" inputmode="decimal" step="0.5" min="0" id="acc-${esc(a.id)}-incv" data-k="acc.${i}.incV" value="${a.incV}"></label></div></div>
        <label class="field"><span>기구</span><select id="acc-${esc(a.id)}-equip" data-k="acc.${i}.equip">${equipOpts(a.equip)}</select></label>
        <label class="check"><input type="checkbox" id="acc-${esc(a.id)}-light" data-k="acc.${i}.light" ${a.light ? 'checked' : ''}><span>저중량 규칙 — 20kg 미만일 때 5·7·9회로 가고 묶음 성공 시 +5kg. 20kg부터는 위 횟수·증량으로 돌아가요.</span></label>
        <label class="check"><input type="checkbox" id="acc-${esc(a.id)}-sw" data-k="acc.${i}.sw" ${a.sw ? 'checked' : ''}><span>무게가 오르면 바벨 종목으로 바꾸기</span></label>
        ${a.sw && (sp.acc[a.id] || {}).phase ? `<p class="small">시작 지점 세션에서 이미 ${esc(a.sw.name)}(으)로 바꾼 상태라, 위 무게는 ${esc(a.sw.name)} 무게예요.</p>` : ''}
        ${a.sw ? `<div class="swbox"><div class="row2"><label class="field"><span>바꾸는 시점 (이 무게가 될 차례에)</span><input type="number" inputmode="decimal" step="0.5" min="0.5" id="acc-${esc(a.id)}-swat" data-k="acc.${i}.sw.at" value="${a.sw.at}"></label>
          <label class="field"><span>바꿀 종목</span><input type="text" id="acc-${esc(a.id)}-swname" data-k="acc.${i}.sw.name" value="${esc(a.sw.name)}"></label></div>
          <div class="row3"><label class="field"><span>시작 무게 (kg)</span><input type="number" inputmode="decimal" step="0.5" min="0.5" id="acc-${esc(a.id)}-sww" data-k="acc.${i}.sw.w" value="${a.sw.w}"></label>
          <label class="field"><span>증량 방식</span><select id="acc-${esc(a.id)}-swinc" data-k="acc.${i}.sw.inc"><option value="pct" ${a.sw.inc === 'pct' ? 'selected' : ''}>%</option><option value="kg" ${a.sw.inc === 'kg' ? 'selected' : ''}>kg</option></select></label>
          <label class="field"><span>증량 값</span><input type="number" inputmode="decimal" step="0.5" min="0" id="acc-${esc(a.id)}-swincv" data-k="acc.${i}.sw.incV" value="${a.sw.incV}"></label></div></div>` : ''}</div>`;
    });
    h += `<div class="btnrow"><button class="btn ghost" type="button" data-act="addAcc" data-day="D">+ 데드 날 종목</button><button class="btn ghost" type="button" data-act="addAcc" data-day="S">+ 스쿼트 날 종목</button></div></div>`;

    h += `<div class="card"><h2>규칙</h2><ul class="rules">
      <li>한 세션은 운동 6회(데드리프트 날 → 스쿼트 날 번갈아 3회씩). 6번째 운동을 마친 다음 날 하루 쉬어요. 고정으로 쉬는 요일은 없어요.</li>
      <li>기록하지 않고 지나간 날은 쉰 날로 보고, 그날 운동을 다음 날로 미뤄요. 운동하고 깜빡했다면 그날을 눌러 나중에 기록할 수 있어요.</li>
      <li>기록할 때 한 종목만 골라도 저장돼요. 고르지 않은 종목은 안 한 것으로 보고 다음 같은 날(데드 날·스쿼트 날)로 밀려요. 하체를 안 했으면 다음 날도 같은 하체 날이에요.</li>
      <li>상체·팔은 자기 하체 날에만 하고 하체보다 앞서 가지 않아요. 밀린 종목은 지난 세션 몫부터 차례로 하고, 하체를 따라가느라 쉬는 날은 휴식으로 봐요.</li>
      <li>한 세션(운동 6회)을 하는 동안 2일 이상 쉬었다면 세션 뒤 정식 휴식은 건너뛰어요.</li>
      <li>휴식일에도 운동했다면 기록할 수 있고, 기록하면 운동한 날로 계산해요.</li>
      <li>이미 하던 루틴이면 시작 지점을 그 세션·순서·무게로 옮기고, 그 뒤 지난 날들을 날짜순으로 기록해 이어가요.</li>
      <li>데드리프트 = 스쿼트 × 1.2. 둘은 한 묶음으로 같이 오르내려요.</li>
      <li>하체는 세션마다 5%씩 올려 4단계까지 가고, 4단계를 성공하면 그 묶음의 2단계 무게로 내려 새 묶음을 시작해요.</li>
      <li>하체를 하나라도 실패하면 다음 세션은 한 단계(−5%) 낮춰 다시 하고, 원래 4단계를 채울 때까지 이어가요.</li>
      <li>상체·팔은 세션마다 1회씩 늘려 3단계(예: 3·4·5회)까지 가고, 하체 4단계 날은 쉬어요. 실패하면 한 단계(−1회) 낮춰요.</li>
      <li>상체·팔은 3단계를 성공한 뒤 하체가 4단계를 성공하면 다음 세션부터 증량해요. 그 전까지는 마지막 횟수를 유지해요.</li>
      <li>가슴은 덤벨프레스를 1kg씩 올리다가 10kg(양손 20kg)이 될 차례에 바벨 벤치프레스 20kg으로 바꿔 5%씩 올려요.</li>
    </ul></div>`;

    h += `<div class="card"><h2>데이터</h2><p class="small" id="storageNote"></p>
      <div class="btnrow"><button class="btn ghost" type="button" data-act="copyBackup">백업 복사</button><button class="btn ghost" type="button" data-act="importBackup">붙여 넣은 백업 불러오기</button></div>
      <label class="field"><span>백업 내용 (다른 기기로 옮길 때 여기에 붙여 넣기)</span><textarea id="backupBox" spellcheck="false"></textarea></label>
      ${confirmReset
        ? '<div class="confirm"><span>모든 기록을 지우고 오늘부터 다시 시작할까요? 설정은 그대로예요.</span><button class="btn danger" type="button" data-act="reset">지우고 다시 시작</button><button class="btn ghost" type="button" data-act="cancelReset">취소</button></div>'
        : '<div class="btnrow"><button class="btn danger" type="button" data-act="askReset">기록 지우고 처음부터</button></div>'}
    </div>`;
    $('view-settings').innerHTML = h;
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

  function applySetting(el) {
    const k = el.dataset.k;
    const cfg = data.cfg;
    const num = (v) => (v === '' ? NaN : Number(v));
    if (k === 'plate') {
      const p = Number(el.dataset.w);
      const n = Math.max(0, Math.min(PAIR_MAX, Math.floor(Number(el.value)) || 0));
      cfg.plates = cfg.plates.filter((x) => x !== p).concat(Array(n).fill(p)).sort((a, b) => a - b);
      el.closest('label').classList.toggle('on', n > 0);
    } else if (/^acc\.\d+\.sw\./.test(k)) {
      const [, i, , f] = k.split('.');
      const sw = cfg.acc[+i] && cfg.acc[+i].sw;
      if (!sw) return;
      if (f === 'name') sw.name = el.value.trim() || sw.name;
      else if (f === 'inc') sw.inc = el.value === 'kg' ? 'kg' : 'pct';
      else {
        const v = num(el.value);
        if (!(f === 'incV' ? v >= 0 : v > 0)) { el.value = sw[f]; toast('숫자를 확인해 주세요'); return; }
        sw[f] = v;
      }
    } else if (k.startsWith('main.')) {
      const f = k.slice(5);
      if (f === 'rest') cfg.main.rest = el.value.trim();
      else {
        const v = num(el.value);
        if (!(v > 0)) { el.value = cfg.main[f]; toast('0보다 큰 숫자를 넣어 주세요'); return; }
        cfg.main[f] = f === 'dl' ? v : Math.round(v);
      }
    } else if (k.startsWith('acc.')) {
      const [, i, f] = k.split('.');
      const a = cfg.acc[+i];
      if (!a) return;
      if (f === 'name') a.name = el.value.trim() || a.name;
      else if (f === 'part' || f === 'rest') a[f] = el.value.trim();
      else if (f === 'inc') a.inc = el.value === 'kg' ? 'kg' : 'pct';
      else if (f === 'equip') a.equip = ['barbell', 'machine', 'dumbbell'].includes(el.value) ? el.value : 'dumbbell';
      else if (f === 'light') a.light = el.checked;
      else if (f === 'sw') {
        a.sw = el.checked ? { at: a.w != null ? a.w + 3 : 10, name: '바벨 종목', w: 20, inc: 'pct', incV: 5 } : null;
        renderDerived(); commit(); renderSettings();
        const box = $(`acc-${a.id}-sw`);
        if (box) box.focus();
        return;
      }
      else if (f === 'w') {
        const v = num(el.value);
        if (el.value !== '' && !(v > 0)) { el.value = a.w == null ? '' : a.w; toast('무게는 0보다 커야 해요. 비우면 생략이에요'); return; }
        a.w = el.value === '' ? null : v;
      } else {
        const v = num(el.value);
        const ok = f === 'incV' ? v >= 0 : v >= 1;
        if (!ok) { el.value = a[f]; toast('숫자를 확인해 주세요'); return; }
        a[f] = f === 'incV' ? v : Math.round(v);
      }
    }
    renderDerived();
    commit();
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
    else if (act === 'chartMode') { chartMode = b.dataset.v === 'each' ? 'each' : 'all'; renderChart(); }
    else if (act === 'chartToggle') { const k = b.dataset.key; if (chartOff.has(k)) chartOff.delete(k); else chartOff.add(k); renderChart(); }
    else if (act === 'askDel') { sheet.confirmDel = true; renderSheet(model(weekMon + 6)); }
    else if (act === 'keepLog') { sheet.confirmDel = false; renderSheet(model(weekMon + 6)); }
    else if (act === 'delLog') { data.logs.pop(); closeSheet(); commit('기록을 지웠어요'); }
    else if (act === 'addAcc') {
      const no = model(weekMon + 6).cur.no;
      data.cfg.acc.push({ id: 'x' + Date.now().toString(36), name: '새 종목', part: '', day: b.dataset.day, equip: 'dumbbell', w: 5, reps: 5, sets: 3, rest: '2분', inc: 'kg', incV: 1, light: false, from: no, sw: null });
      commit(`세션 ${no}부터 들어가요`); renderSettings();
    } else if (act === 'delAcc') {
      const id = b.dataset.id;
      if (pendingDel !== id) { pendingDel = id; renderSettings(); return; }
      data.cfg.acc = data.cfg.acc.filter((a) => a.id !== id);
      pendingDel = null; commit('종목을 지웠어요'); renderSettings();
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
      weekMon = L.mondayOf(L.toNum(today));
      commit('기록을 지우고 오늘부터 다시 시작해요'); renderSettings();
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t.dataset) return;
    if (t.dataset.sk) { if (sheet && sheet.kind === 'start') startInput(t, true); }
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
    if (now !== today) { today = now; weekMon = L.mondayOf(L.toNum(today)); render(); }
  });

  render();
  const boot = $('boot');
  if (boot) boot.remove();
  window.onerror = null;
  connectRemote();
  if (window.ROUTINE_STANDALONE && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
})();
