// 실행: node --test test/logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');

const TODAY = '2026-10-14'; // 수요일
const cfg = () => L.defaultConfig(TODAY);
const r1 = (x) => L.roundW(x, 0.1);

// 세션 하나(6회)를 같은 결과로 채운 기록
function sessionLogs(startNum, res = {}) {
  return Array.from({ length: 6 }, (_, k) => ({ d: L.toStr(startNum + k), res }));
}
function run(outcomes) {
  // outcomes: 세션별 결과 객체 배열 (예: [{}, {dl:false}])
  const c = cfg();
  let d = L.toNum(TODAY);
  const logs = [];
  for (const res of outcomes) { logs.push(...sessionLogs(d, res)); d += 7; }
  return { c, sessions: L.replay(c, logs) };
}
const accCell = (s, id) => (s.presc.acc[id].skip ? '휴식' : `${r1(s.presc.acc[id].w)}x${s.presc.acc[id].reps}`);

test('이번 주: 월화 비움, 수요일부터 데드·스쿼트 번갈아, 일요일도 운동, 6번째 다음 날 휴식', () => {
  const c = cfg();
  const tl = L.timeline(c, [], TODAY, { until: L.toNum('2026-10-25') });
  const mon = L.mondayOf(L.toNum(TODAY));
  assert.equal(tl.days.get(mon), undefined);
  assert.equal(tl.days.get(mon + 1), undefined);
  const week = [2, 3, 4, 5, 6].map((k) => tl.days.get(mon + k));
  assert.deepEqual(week.map((e) => e.kind), ['plan', 'plan', 'plan', 'plan', 'plan']);
  assert.deepEqual(week.map((e) => L.slotType(e.slot)), ['D', 'S', 'D', 'S', 'D']);
  assert.equal(tl.days.get(mon + 7).slot, 5);        // 다음 주 월 = 세션1의 6번째(스쿼트)
  assert.equal(tl.days.get(mon + 8).kind, 'gap');    // 화 = 세션 간 휴식
  assert.equal(tl.days.get(mon + 9).slot, 6);        // 수 = 세션2 시작
});

test('첫 세션 처방이 요청한 숫자와 같다', () => {
  const c = cfg();
  const [s1] = L.replay(c, []);
  const D = L.dayRows(c, s1.presc, 'D').map((r) => [r.name, L.fmtW(r), r.reps, r.sets, r.rest, r.mode]);
  const S = L.dayRows(c, s1.presc, 'S').map((r) => [r.name, L.fmtW(r), r.reps, r.sets, r.rest, r.mode]);
  assert.deepEqual(D, [
    ['데드리프트', '40kg', 5, 3, '5~8분', 'barbell'],
    ['랫풀다운', '23kg', 3, 3, '3~5분', 'stack'],
    ['덤벨컬', '3kg', 5, 3, '2분', 'dumbbell'],
    ['OHP', '10kg', 5, 3, '3~5분', 'fixedbar'],
  ]);
  assert.deepEqual(S, [
    ['스쿼트', '33.3kg', 5, 3, '5~8분', 'barbell'],
    ['덤벨프레스', '7kg', 3, 3, '3~5분', 'dumbbell'],
    ['머신 트라이셉스 익스텐션', '—', 5, 3, '2분', 'stack'],
    ['사이드 레터럴 레이즈', '2kg', 10, 3, '1분', 'dumbbell'],
    ['벤트오버 레터럴 레이즈', '2kg', 10, 3, '1분', 'dumbbell'],
  ]);
});
test('하체: 4세션까지 5%씩, 5세션은 2세션 무게, 9세션은 6세션 무게', () => {
  const { sessions } = run(Array(9).fill({}));
  const dl = sessions.map((s) => r1(s.presc.main.dl));
  assert.deepEqual(dl, [40, 42, 44.1, 46.3, 42, 44.1, 46.3, 48.6, 44.1, 46.3]);
  for (const s of sessions) assert.ok(Math.abs(s.presc.main.dl / s.presc.main.sq - 1.2) < 1e-9);
});

test('하체 실패: 직전(-5%) 무게로 한 세션 다시, 원래 4세션을 채우면 묶음 2번째 무게로', () => {
  const { sessions } = run([{}, { dl: false }, {}, {}, {}, {}]);
  assert.deepEqual(sessions.map((s) => r1(s.presc.main.dl)), [40, 42, 40, 42, 44.1, 46.3, 42]);
  assert.equal(sessions[2].presc.main.retry, true);
  assert.equal(sessions[5].presc.main.top, true);
  const sq = run([{}, { sq: false }]).sessions; // 스쿼트 실패도 같은 트랙
  assert.equal(r1(sq[2].presc.main.dl), 40);
});

test('상체: 3·4·5회, 4세션 휴식, 하체 묶음 성공 후 증량 (등 5%, 팔·레터럴 1kg)', () => {
  const { sessions } = run(Array(5).fill({}));
  assert.deepEqual(sessions.map((s) => accCell(s, 'lat')), ['23x3', '23x4', '23x5', '휴식', '24.2x3', '24.2x4']);
  assert.deepEqual(sessions.slice(0, 3).map((s) => s.presc.acc.curl.reps), [5, 6, 7]);
  assert.equal(sessions[4].presc.acc.curl.w, 4);
  assert.deepEqual(sessions.map((s) => accCell(s, 'side')), ['2x10', '2x11', '2x12', '휴식', '3x10', '3x11']);
});

test('덤벨·일체형 바벨은 가진 무게 목록 안에서 다음 무게로 (2kg 다음이 4kg이면 4kg), 끝이면 그대로', () => {
  const { sessions } = run(Array(16).fill({}));
  assert.deepEqual(sessions.map((s) => accCell(s, 'press')).slice(12), ['10x3', '10x4', '10x5', '휴식', '12x3']);
  const c = cfg();
  c.gear.db = [2, 4, 6];
  c.gear.bars = [10, 15];
  const s = L.toNum(TODAY);
  const logs = Array.from({ length: 6 * 12 }, (_, i) => ({ d: L.toStr(s + i + Math.floor(i / 6)), res: {} }));
  const ss = L.replay(c, logs);
  assert.deepEqual(ss.map((x) => accCell(x, 'side')), ['2x10', '2x11', '2x12', '휴식', '4x10', '4x11', '4x12', '휴식', '6x10', '6x11', '6x12', '휴식', '6x10']);
  assert.deepEqual(ss.map((x) => accCell(x, 'ohp')).slice(4, 9), ['15x5', '15x7', '15x9', '휴식', '15x5']);
  assert.equal(ss[8].presc.acc.ohp.maxed, true);
  assert.match(L.loadInfo(L.dayRows(c, ss[8].presc, 'D').find((r) => r.id === 'ohp'), c).text, /가장 무거워요/);
});
test('상체 실패: 한 단계(-1회) 낮춰 다시, 사다리 끝을 성공하면 다음 세션 증량 (하체 묶음과 따로)', () => {
  const { sessions } = run([{}, { lat: false }, {}, {}, {}, {}, {}, {}, {}]);
  assert.deepEqual(sessions.map((s) => accCell(s, 'lat')), ['23x3', '23x4', '23x3', '휴식', '23x4', '23x5', '24.2x3', '휴식', '24.2x4', '24.2x5']);
  assert.equal(sessions[2].presc.acc.lat.retry, true);
  assert.deepEqual(sessions.slice(0, 5).map((s) => r1(s.presc.main.dl)), [40, 42, 44.1, 46.3, 42]);
});
test('OHP 일체형 바벨 10kg → 5·7·9회, 사다리 끝 성공 후 다음 바벨(15·20·25kg)', () => {
  const { sessions } = run(Array(12).fill({}));
  assert.deepEqual(sessions.map((s) => accCell(s, 'ohp')), ['10x5', '10x7', '10x9', '휴식', '15x5', '15x7', '15x9', '휴식', '20x5', '20x7', '20x9', '휴식', '25x5']);
});
test('하체 4세션 실패: 하체는 재도전, 상체는 자기 사다리대로 (이미 끝낸 종목은 증량)', () => {
  const { sessions } = run([{}, {}, {}, { dl: false }, {}, {}]);
  assert.equal(r1(sessions[4].presc.main.dl), 44.1);
  assert.equal(sessions[4].presc.main.retry, true);
  assert.deepEqual([r1(sessions[4].presc.acc.lat.w), sessions[4].presc.acc.lat.reps], [24.2, 3]);
  assert.equal(sessions[5].presc.acc.lat.skip, true);
});
test('무게 생략 종목은 증량분을 상대값으로 표시', () => {
  const { c, sessions } = run(Array(4).fill({}));
  const row = L.dayRows(c, sessions[4].presc, 'S').find((r) => r.id === 'tri');
  assert.equal(L.fmtW(row), '+1kg');
});

test('기록하지 않은 날은 쉰 날로 보고 다음 운동이 밀린다, 6번째 다음 날은 휴식', () => {
  const c = cfg();
  const start = L.toNum(TODAY);
  const logs = [{ d: L.toStr(start), res: {} }, { d: L.toStr(start + 1), res: {} }];
  const tl = L.timeline(c, logs, L.toStr(start + 3), { until: start + 14 }); // 금요일 기록 없음, 오늘 = 토
  assert.equal(tl.days.get(start + 2).kind, 'miss');
  assert.equal(tl.days.get(start + 3).slot, 2);
  assert.equal(L.canLog(tl, start + 2), true);   // 금요일에 한 운동을 늦게 기록할 수 있음
  assert.equal(L.canLog(tl, start + 1), false);
  const six = [0, 1, 2, 3, 5, 6].map((k) => ({ d: L.toStr(start + k), res: {} })); // 일요일 쉼
  const tl2 = L.timeline(c, six, L.toStr(start + 7), { until: start + 14 });
  assert.equal(tl2.days.get(start + 4).kind, 'miss');
  assert.equal(tl2.days.get(start + 7).kind, 'gap');
  assert.equal(L.canLog(tl2, start + 7), true);   // 휴식일에도 운동했다면 기록할 수 있음
  assert.equal(tl2.days.get(start + 8).slot, 6);
});

test('이어서 시작: 수요일에 세션 6 첫 운동(데드리프트)을 했다면 목요일은 스쿼트, 무게·디로드는 세션 6 기준', () => {
  const p = L.projectTo(cfg(), 6); // 1세션 무게에서 모두 성공했다고 본 세션 6
  assert.deepEqual([r1(p.presc.main.dl), p.presc.main.stage, p.presc.main.bundle], [44.1, 2, 2]);
  assert.deepEqual(['lat', 'curl', 'ohp', 'press', 'side'].map((id) => accCell(p, id)), ['24.2x4', '4x6', '15x7', '8x4', '3x11']);

  const c = cfg();
  c.startDate = '2026-10-14';
  c.from = { no: 6, k: 0, stage: 2, acc: {} }; // 상체·팔 단계는 하체 2단계에 맞춘 기본값(두 번째 횟수)
  c.main.dl = 44.1;
  for (const a of c.acc) { const s = p.state.acc[a.id]; a.w = s.w == null ? null : r1(s.w); }
  const wed = L.toNum('2026-10-14');
  const tl = L.timeline(c, [{ d: '2026-10-14', res: {} }], '2026-10-15', { until: wed + 8 });
  const at = (n) => { const e = tl.days.get(wed + n); return e.kind === 'gap' ? 'gap' : `${L.slotNo(c, e.slot)}-${L.slotPos(e.slot) + 1}${L.slotType(e.slot)}`; };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(at), ['6-1D', '6-2S', '6-3D', '6-4S', '6-5D', '6-6S', 'gap', '7-1D']);

  const logs = Array.from({ length: 24 }, (_, i) => ({ d: L.toStr(wed + i), res: {} }));
  const sessions = L.replay(c, logs);
  assert.deepEqual(sessions.map((s) => [s.no, r1(s.presc.main.dl), s.presc.main.stage]), [[6, 44.1, 2], [7, 46.3, 3], [8, 48.6, 4], [9, 44.1, 1], [10, 46.3, 2]]);
  assert.deepEqual(sessions.map((s) => accCell(s, 'lat')), ['24.2x4', '24.2x5', '휴식', '25.4x3', '25.4x4']);
  assert.deepEqual(sessions.map((s) => accCell(s, 'ohp')), ['15x7', '15x9', '휴식', '20x5', '20x7']);
});

test('이어서 시작: 세션 중간(4번째 운동, 스쿼트)부터면 남은 3번만 채우고 다음 날 휴식', () => {
  const c = cfg();
  c.from = { no: 3, k: 3, stage: 3, acc: {} };
  const s = L.toNum(TODAY);
  const tl = L.timeline(c, [], TODAY, { until: s + 10 });
  assert.deepEqual([0, 1, 2].map((j) => L.slotType(tl.days.get(s + j).slot)), ['S', 'D', 'S']);
  assert.equal(tl.days.get(s + 3).kind, 'gap');
  assert.equal(L.slotNo(c, tl.days.get(s + 4).slot), 4);
  const sessions = L.replay(c, [0, 1, 2].map((j) => ({ d: L.toStr(s + j), res: j === 1 ? { dl: false } : {} })));
  assert.deepEqual(sessions.map((x) => [x.no, x.first, x.done]), [[3, 3, true], [4, 0, false]]);
  assert.deepEqual([sessions[1].presc.main.stage, sessions[1].presc.main.retry], [2, true]); // 데드 실패 → 한 단계 낮춰 재도전
});

test('이어서 시작: 하체 4단계 세션부터면 상체는 쉬고, 다음 세션은 넣은 무게의 첫 칸부터', () => {
  const c = cfg();
  c.from = { no: 4, k: 0, stage: 4, acc: {} };
  c.main.dl = 46.3;
  const p = L.projectTo(cfg(), 4);
  for (const a of c.acc) { const s = p.state.acc[a.id]; a.w = s.w == null ? null : r1(s.w); }
  const sessions = L.replay(c, Array.from({ length: 6 }, (_, i) => ({ d: L.toStr(L.toNum(TODAY) + i), res: {} })));
  assert.equal(sessions[0].presc.acc.lat.skip, true);
  assert.deepEqual([sessions[1].no, r1(sessions[1].presc.main.dl), sessions[1].presc.main.bundle], [5, 42, 2]);
  assert.deepEqual(['lat', 'curl', 'ohp', 'side'].map((id) => accCell(sessions[1], id)), ['24.2x3', '4x5', '15x5', '3x10']);
});
test('이어서 시작: 상체 횟수 단계를 따로 정할 수 있다', () => {
  const c = cfg();
  c.from = { no: 13, k: 1, stage: 1, acc: { press: { step: 2 }, lat: { step: -1 } } };
  const [s] = L.replay(c, []);
  const press = L.dayRows(c, s.presc, 'S').find((r) => r.id === 'press');
  assert.deepEqual([press.name, press.mode, press.w, press.reps], ['덤벨프레스', 'dumbbell', 7, 5]);
  assert.equal(s.presc.acc.lat.reps, 2);
});
test('지난 날 기록: 마지막 기록 뒤의 지난 날은 차례로 넣고, 지나간 휴식일도 운동했다면 기록할 수 있다', () => {
  const c = cfg();
  c.startDate = '2026-10-05';
  const s = L.toNum('2026-10-05');
  const logs = Array.from({ length: 6 }, (_, i) => ({ d: L.toStr(s + i), res: {} }));
  const tl = L.timeline(c, logs, TODAY, { until: s + 14 });
  assert.equal(tl.days.get(s + 6).kind, 'gap');
  assert.equal(L.canLog(tl, s + 6), true);
  assert.equal(L.canLog(tl, s + 7), true);
  assert.equal(L.canLog(tl, s + 5), false);
  assert.equal(L.canLog(tl, s - 1), false); // 시작일 이전은 시작 지점을 옮겨서 넣는다
  const tl2 = L.timeline(c, logs.concat({ d: L.toStr(s + 6), res: {} }), TODAY, { until: s + 14 });
  const today = tl2.days.get(L.toNum(TODAY));
  assert.deepEqual([tl2.days.get(s + 6).kind, L.slotNo(c, tl2.days.get(s + 6).slot), tl2.days.get(s + 7).kind], ['log', 2, 'miss']);
  assert.deepEqual([L.slotNo(c, today.slot), L.slotPos(today.slot), L.slotType(today.slot)], [2, 1, 'S']);
});

test('경량원판: 5kg 단위 + 나머지를 가진 원판으로 채우기 (요청 예시)', () => {
  const t = (w, plates, equip = 'barbell') => L.plateText(L.plateMath(w, plates, equip));
  assert.equal(L.plateMath(45, [0.5, 1], 'barbell'), null);
  assert.equal(t(46, [0.5, 1]), '45kg + 0.5kg 한 쌍');
  assert.equal(t(47, [0.5, 1]), '45kg + 1kg 한 쌍');
  assert.equal(t(46, [1]), '45kg + 1kg 한 짝(한쪽만)');
  assert.equal(L.plateMath(46, [1], 'barbell').unbalanced, true);
  assert.equal(t(46, [1.25]), '45kg + 1.25kg 한 짝(한쪽만) → 46.25kg');
  assert.equal(t(48, [1.25]), '45kg + 한쪽 2.5kg · 반대쪽 1.25kg → 48.75kg');
  assert.equal(t(48, [0.5, 1]), '45kg + 1kg 한 쌍 + 0.5kg 한 쌍');
  assert.equal(t(46, [0.5, 1], 'machine'), '45kg + 1kg 한 장');               // 기구는 한 장을 추에 올림
  assert.equal(L.plateMath(46, [0.5, 1], 'machine').unbalanced, false);
  assert.equal(t(23, [0.5, 1], 'machine'), '20kg + 2.5kg 한 장 + 0.5kg 한 장');
  assert.equal(t(49.6, [0.5, 1]), '50kg으로 맞추기');
  assert.equal(t(46.3, [0.5, 1]), '45kg + 한쪽 1kg · 반대쪽 0.5kg → 46.5kg');
  assert.equal(L.plateMath(9, [0.5, 1], 'dumbbell'), null);
  // 개수(쌍): 같은 무게가 n번 = n쌍
  assert.equal(t(47, [0.5]), '45kg + 2.5kg 한 짝(한쪽만) → 47.5kg');          // 0.5kg 한 쌍으로는 2kg을 못 채움
  assert.equal(t(47, [0.5, 0.5]), '45kg + 0.5kg 2쌍');
  assert.equal(t(49, [1, 1]), '45kg + 1kg 2쌍');
  assert.equal(t(48, [1, 1]), '45kg + 한쪽 1kg×2 · 반대쪽 1kg');
  assert.equal(t(48, [1, 1], 'machine'), '45kg + 1kg 3장');
  assert.equal(t(49, [0.25, 0.25, 0.25, 0.25, 0.25]), '45kg + 한쪽 2.5kg · 반대쪽 0.25kg×6');
  // 2.5kg 한 짝은 경량원판이 1.25kg뿐일 때만 (바벨). 머신은 추에 올리므로 늘 허용.
  // 2.5kg 한 짝은 가진 경량원판과 상관없이 쓸 수 있다 (무게 차이를 줄이려고)
  assert.equal(t(46, []), '45kg + 2.5kg 한 짝(한쪽만) → 47.5kg');
  assert.equal(t(47.5, [1]), '45kg + 2.5kg 한 짝(한쪽만)');
  assert.equal(t(47.5, [], 'machine'), '45kg + 2.5kg 한 장');
});

test('예전 설정(첫 판)을 새 규칙으로 옮긴다', () => {
  const old = cfg();
  delete old.cv; delete old.plates; delete old.gear;
  old.trainDays = [1, 2, 3, 4, 5, 6]; old.roundTo = 0.1;
  for (const a of old.acc) { delete a.mode; delete a.prog; delete a.ladder; }
  const m = L.migrate(old);
  assert.equal(m.cv, 3);
  assert.equal(m.trainDays, undefined);
  assert.deepEqual(m.plates, [0.5, 1]);
  assert.deepEqual(m.acc.find((a) => a.id === 'lat').ladder, [3, 4, 5]);
  delete m.from;
  const logs = sessionLogs(L.toNum(TODAY));
  assert.deepEqual(L.replay(m, logs).map((s) => [s.no, s.first, r1(s.presc.main.dl)]), [[1, 0, 40], [2, 0, 42]]);
  assert.equal(L.timeline(m, logs, TODAY).days.get(L.toNum(TODAY)).slot, 0);
});

test('둘째 판 설정: 저중량 OHP → 일체형 바벨 5·7·9회, 케이블 → 머신 무게추·이름 변경, 자동 전환 없앰', () => {
  const v2 = {
    cv: 2, startDate: TODAY, from: { no: 1, k: 0, stage: 1, acc: {} }, plates: [1.25],
    main: { dl: 40, ratio: 1.2, pct: 5, reps: 5, sets: 3, rest: '5~8분' },
    acc: [
      { id: 'ohp', name: 'OHP', part: '어깨', day: 'D', equip: 'barbell', w: 10, reps: 3, sets: 3, rest: '', inc: 'pct', incV: 5, light: true, from: 1, sw: null },
      { id: 'press', name: '덤벨프레스', part: '가슴', day: 'S', equip: 'dumbbell', w: 7, reps: 3, sets: 3, rest: '', inc: 'kg', incV: 1, light: false, from: 1, sw: { at: 10, name: '바벨 벤치프레스', w: 20, inc: 'pct', incV: 5 } },
      { id: 'tri', name: '케이블 트라이셉스 익스텐션', part: '삼두', day: 'S', equip: 'machine', w: null, reps: 5, sets: 3, rest: '', inc: 'kg', incV: 1, light: false, from: 1, sw: null },
    ],
  };
  const m = L.migrate(v2);
  const by = (id) => m.acc.find((a) => a.id === id);
  assert.deepEqual([by('ohp').mode, by('ohp').ladder], ['fixedbar', [5, 7, 9]]);
  assert.deepEqual([by('press').mode, by('press').sw, by('press').ladder], ['dumbbell', undefined, [3, 4, 5]]);
  assert.deepEqual([by('tri').mode, by('tri').name], ['stack', '머신 트라이셉스 익스텐션']);
  assert.deepEqual(m.main.prog, 'r');
  assert.ok(m.gear.db.length && m.gear.bands.length === 3);
});
// ---------- 일부만 기록 · 밀림 · 휴식 ----------
const ALL_D = { dl: true, lat: true, curl: true, ohp: true };
const ALL_S = { sq: true, press: true, tri: true, side: true, rear: true };
const P = (d, res) => ({ d: L.toStr(d), res, p: 1 });
const rowOf = (e, id) => e.rows.find((r) => r.id === id);

test('고르지 않은 종목은 밀린다: 덤벨프레스를 한 번 빼면 다음 세션 첫 스쿼트 날에 지난 세션 몫을 채운다', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const noPress = { sq: true, tri: true, side: true, rear: true };
  const logs = [P(s, ALL_D), P(s + 1, noPress), P(s + 2, ALL_D), P(s + 3, ALL_S), P(s + 4, ALL_D), P(s + 5, ALL_S)];
  const sim = L.simulate(c, logs, L.toStr(s + 6), { until: s + 14 });
  assert.deepEqual([sim.cur.no, sim.cur.n], [2, 0]);                       // 하체는 세션 1을 마침
  assert.equal(sim.days.get(s + 6).kind, 'gap');
  assert.deepEqual([sim.real.acc.press, sim.real.acc.side], [0, 1]);     // 덤벨프레스는 아직 세션 1, 다른 종목은 세션 2
  const day1 = sim.days.get(s + 1);
  assert.equal(rowOf(day1, 'press').result, null);                       // 안 한 종목
  const s3 = rowOf(sim.days.get(s + 3), 'press');
  assert.deepEqual([s3.avail, s3.lag, s3.accNo, s3.reps], ['ok', true, 1, 3]);
  const n1 = rowOf(sim.days.get(s + 8), 'press');                        // 세션 2의 첫 스쿼트 날: 세션 1의 3번째(3회)
  assert.deepEqual([sim.days.get(s + 8).no, n1.avail, n1.lag, n1.accNo, n1.reps], [2, 'ok', true, 1, 3]);
  const n2 = rowOf(sim.days.get(s + 10), 'press');                       // 그다음부터 세션 2 몫(4회), 계속 한 번씩 밀려 감
  assert.deepEqual([n2.accNo, n2.reps, n2.lag], [2, 4, true]);
  assert.deepEqual([rowOf(sim.days.get(s + 8), 'side').accNo, rowOf(sim.days.get(s + 8), 'side').reps], [2, 11]); // 다른 종목은 제 차례
});

test('하체를 고르지 않으면 다음 날도 같은 하체 날, 이미 한 보조 종목은 하체보다 앞서지 않고 쉰다', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const sim = L.simulate(c, [P(s, { lat: true, curl: true })], L.toStr(s + 1), { until: s + 7 });
  const today = sim.days.get(s + 1);
  assert.deepEqual([today.type, today.g, sim.cur.n], ['D', 0, 0]);
  assert.deepEqual(['dl', 'lat', 'curl', 'ohp'].map((id) => rowOf(today, id).avail), ['ok', 'wait', 'wait', 'ok']);
  assert.equal(rowOf(today, 'ohp').reps, 5);
  const d3 = sim.days.get(s + 3);                                          // 다음 데드 날에는 랫풀다운·덤벨컬도 제 차례(세션 1의 2번째)
  assert.deepEqual([d3.type, rowOf(d3, 'lat').avail, rowOf(d3, 'lat').lag], ['D', 'ok', false]);
});

test('세션 6회 중 2일 이상 쉬었으면 정식 휴식을 건너뛰고, 1일이면 쉰다', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const two = [0, 2, 4, 5, 6, 7].map((k, i) => P(s + k, i % 2 ? ALL_S : ALL_D));    // 1일·3일 쉼
  const sim = L.simulate(c, two, L.toStr(s + 8), { until: s + 10 });
  assert.deepEqual([sim.days.get(s + 1).kind, sim.days.get(s + 3).kind], ['miss', 'miss']);
  assert.equal(sim.main[0].rests, 2);
  const nx = sim.days.get(s + 8);
  assert.deepEqual([nx.kind, nx.no, nx.pos, nx.restSkipped], ['plan', 2, 0, true]);
  const one = [0, 2, 3, 4, 5, 6].map((k, i) => P(s + k, i % 2 ? ALL_S : ALL_D));    // 1일만 쉼
  assert.equal(L.simulate(c, one, L.toStr(s + 7), { until: s + 9 }).days.get(s + 7).kind, 'gap');
});

test('휴식일에 운동을 기록하면 운동한 날로 계산한다', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const six = [0, 1, 2, 3, 4, 5].map((k) => P(s + k, k % 2 ? ALL_S : ALL_D));
  const sim = L.simulate(c, six, L.toStr(s + 6), { until: s + 9 });
  assert.equal(sim.days.get(s + 6).kind, 'gap');
  assert.equal(L.canLog(sim, s + 6), true);                                 // 오늘이 휴식일이어도 기록 가능
  assert.deepEqual([sim.next.no, sim.next.pos, sim.next.type], [2, 0, 'D']);
  const sim2 = L.simulate(c, six.concat(P(s + 6, ALL_D)), L.toStr(s + 7), { until: s + 9 });
  assert.deepEqual([sim2.days.get(s + 6).kind, sim2.days.get(s + 6).no, sim2.cur.n], ['log', 2, 1]);
  assert.deepEqual([sim2.days.get(s + 7).type, sim2.days.get(s + 7).pos], ['S', 1]);
});

test('밀린 종목도 세션 결과·증량 규칙은 그대로: 4단계 세션은 쉬고 묶음 성공 뒤 증량', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const logs = [P(s, ALL_D), P(s + 1, { sq: true, tri: true, side: true, rear: true })];
  const sim = L.simulate(c, logs, L.toStr(s + 2), { minSessions: 7 });
  const v = (no) => sim.view(no).acc.press;
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((no) => (v(no).skip ? '휴식' : `${v(no).w}x${v(no).reps}`)), ['7x3', '7x4', '7x5', '휴식', '8x3', '8x4']);
  assert.deepEqual([1, 2, 3, 4, 5].map((no) => r1(sim.view(no).main.dl)), [40, 42, 44.1, 46.3, 42]);
});

// ---------- 훈련방식 · 진행 방식 ----------
const days = (n, res = {}) => Array.from({ length: n }, (_, i) => ({ d: L.toStr(L.toNum(TODAY) + i + Math.floor(i / 6)), res }));

test('머신 무게추: 20kg에서 5% → 21kg이면 무게추 20kg + 1.25kg 한 장, 다음 추가 더 가까우면 그 추', () => {
  const st = [20, 23, 26, 29];
  assert.equal(L.stackText(L.stackMath(21, st, [1.25])), '무게추 20kg에 꽂고 그 위에 1.25kg 한 장 올리기 → 21.25kg');
  assert.equal(L.stackText(L.stackMath(22.6, st, [1.25])), '무게추 23kg에 꽂기 (목표 22.6kg)');
  assert.equal(L.stackText(L.stackMath(23, st, [1.25])), '무게추 23kg에 꽂기');
  assert.equal(L.stackText(L.stackMath(24.5, st, [0.5, 1])), '무게추 23kg에 꽂고 그 위에 1kg 한 장 + 0.5kg 한 장 올리기 → 24.5kg');
  assert.match(L.stackText(L.stackMath(40, st, [1.25])), /가장 무거운 29kg/);
  const c = cfg();
  const lat = c.acc.find((a) => a.id === 'lat');
  lat.w = 20; lat.stack = st;
  const ss = L.replay(c, days(30));
  const row = L.dayRows(c, ss[4].presc, 'D').find((r) => r.id === 'lat');
  assert.equal(r1(row.w), 21);
  assert.deepEqual(L.loadInfo(row, c), { label: '머신', text: '무게추 20kg에 꽂고 그 위에 1.25kg 한 장 올리기 → 21.25kg' });
});

test('원판 여러 장(중량 풀업)은 큰 원판 + 경량원판을 매달고, 원판 한 장은 가진 원판 무게 안에서', () => {
  assert.equal(L.chainText(26, [1.25]), '20kg 한 장 + 5kg 한 장 + 1.25kg 한 장 매달기 → 26.25kg');
  assert.equal(L.chainText(7.5, [1.25]), '5kg 한 장 + 2.5kg 한 장 매달기');
  const c = cfg();
  c.acc.push(L.accDefaults(L.EXTRA.find((x) => x.id === 'lying')));
  c.gear.one = [5, 10, 15];
  const ss = L.replay(c, days(30));
  assert.deepEqual(ss.map((s) => accCell(s, 'lying')).slice(0, 6), ['5x8', '5x10', '5x12', '휴식', '10x8', '10x10']);
});

test('횟수 고정 보조 종목: 횟수는 그대로, 무게가 3단계(기본·+1칸·+2칸) 오르고 끝나면 +1칸부터 새 묶음', () => {
  const c = cfg();
  const curl = c.acc.find((a) => a.id === 'curl');
  curl.prog = 'r'; curl.reps = 8;
  const ss = L.replay(c, days(42));
  assert.deepEqual(ss.map((s) => accCell(s, 'curl')), ['3x8', '4x8', '5x8', '휴식', '4x8', '5x8', '6x8', '휴식']);
  const lat = c.acc.find((a) => a.id === 'lat');
  lat.prog = 'r'; lat.reps = 5;
  const s2 = L.replay(c, days(12));
  assert.deepEqual(s2.map((s) => accCell(s, 'lat')), ['23x5', '24.2x5', '25.4x5']);
});

test('무게 고정 사다리 길이는 설정대로 (3·4·5·6회면 6회를 성공한 다음 세션에 증량)', () => {
  const c = cfg();
  c.acc.find((a) => a.id === 'press').ladder = [3, 4, 5, 6];
  const ss = L.replay(c, days(48));
  assert.deepEqual(ss.map((s) => accCell(s, 'press')), ['7x3', '7x4', '7x5', '휴식', '7x6', '8x3', '8x4', '휴식', '8x5']);
});

test('하체도 무게 고정으로: 무게는 그대로 횟수 단계를 오르고, 끝을 성공하면 5% 올려 첫 횟수부터', () => {
  const c = cfg();
  c.main.prog = 'w'; c.main.ladder = [3, 4, 5];
  const ss = L.replay(c, [...days(18), ...days(6, { dl: false }).map((l, i) => ({ d: L.toStr(L.toNum(TODAY) + 21 + i), res: l.res }))]);
  assert.deepEqual(ss.map((s) => [r1(s.presc.main.dl), s.presc.main.reps]), [[40, 3], [40, 4], [40, 5], [42, 3], [42, 2]]);
  assert.equal(ss[2].presc.main.top, true);                    // 마지막 횟수 세션은 상체가 쉰다
  assert.equal(ss[2].presc.acc.lat.skip, true);
  assert.equal(ss[4].presc.main.retry, true);                  // 실패하면 한 단계(−1회) 낮춰 다시
});

test('고무밴드는 증량 없이 기록만: 몇 달을 해도 그대로, 기록한 날 쓴 밴드를 남긴다', () => {
  const c = cfg();
  const pull = L.accDefaults(L.EXTRA.find((x) => x.id === 'pullup'));
  pull.bands = ['1번밴드', '2번밴드'];
  c.acc.push(pull);
  const logs = days(36).map((l) => Object.assign(l, { p: 1, res: { dl: true, sq: true, pullup: true }, b: { pullup: ['1번밴드', '2번밴드'] } }));
  pull.bands = ['2번밴드'];                                     // 나중에 1번 밴드를 뺌
  const sim = L.simulate(c, logs, L.toStr(L.toNum(TODAY) + 50), { until: L.toNum(TODAY) + 52 });
  const logged = [...sim.days.values()].filter((e) => e.kind === 'log' && e.type === 'D').map((e) => rowOf(e, 'pullup')).filter((r) => r && r.avail === 'ok');
  assert.ok(logged.length >= 6);
  assert.ok(logged.every((r) => r.reps === 5 && r.w == null && r.bands.join() === '1번밴드,2번밴드'));
  assert.equal(L.fmtW(logged[0]), '밴드');
  const next = rowOf(sim.next, 'pullup') || rowOf([...sim.days.values()].find((e) => e.kind === 'plan' && e.type === 'D'), 'pullup');
  assert.deepEqual([next.reps, next.bands], [5, ['2번밴드']]);
  assert.deepEqual(L.loadInfo(next, c), { label: '밴드', text: '2번밴드' });
});

test('훈련방식 바꾸기: 그 종목의 세션 N부터 새 방식·무게로 첫 칸부터, 지난 세션은 그대로', () => {
  const c = cfg();
  const ohp = c.acc.find((a) => a.id === 'ohp');
  ohp.chg = [{ no: 6, mode: 'barbell', w: 20 }];
  ohp.ladder = [3, 4, 5];
  const ss = L.replay(c, days(54));
  assert.deepEqual(ss.map((s) => accCell(s, 'ohp')), ['10x3', '10x4', '10x5', '휴식', '15x3', '20x3', '20x4', '휴식', '20x5', '21x3']);
  const row = L.dayRows(c, ss[5].presc, 'D').find((r) => r.id === 'ohp');
  assert.deepEqual([row.mode, row.name], ['barbell', 'OHP']);
  assert.equal(L.loadInfo(L.dayRows(c, ss[9].presc, 'D').find((r) => r.id === 'ohp'), c).text, '20kg + 1.25kg 한 짝(한쪽만) → 21.25kg');
  const p = L.projectTo(c, 7);
  assert.deepEqual([p.state.acc.ohp.mode, p.state.acc.ohp.w, p.presc.acc.ohp.reps], ['barbell', 20, 4]);
});
