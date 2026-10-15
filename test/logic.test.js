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
  const D = L.dayRows(c, s1.presc, 'D').map((r) => [r.name, L.fmtW(r), r.reps, r.sets, r.rest]);
  const S = L.dayRows(c, s1.presc, 'S').map((r) => [r.name, L.fmtW(r), r.reps, r.sets, r.rest]);
  assert.deepEqual(D, [
    ['데드리프트', '40kg', 5, 3, '5~8분'],
    ['랫풀다운', '23kg', 3, 3, '3~5분'],
    ['덤벨컬', '3kg', 5, 3, '2분'],
    ['OHP', '10kg', 5, 3, '3~5분'],
  ]);
  assert.deepEqual(S, [
    ['스쿼트', '33.3kg', 5, 3, '5~8분'],
    ['덤벨프레스', '7kg', 3, 3, '3~5분'],
    ['케이블 트라이셉스 익스텐션', '—', 5, 3, '2분'],
    ['사이드 레터럴 레이즈', '2kg', 10, 3, '1분'],
    ['벤트오버 레터럴 레이즈', '2kg', 10, 3, '1분'],
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

test('가슴: 덤벨프레스 7kg부터 1kg씩, 10kg이 될 차례에 바벨 벤치프레스 20kg으로 바꾸고 5% 증량', () => {
  const { c, sessions } = run(Array(16).fill({}));
  const press = sessions.map((s) => accCell(s, 'press'));
  assert.deepEqual(press, ['7x3', '7x4', '7x5', '휴식', '8x3', '8x4', '8x5', '휴식', '9x3', '9x4', '9x5', '휴식', '20x3', '20x4', '20x5', '휴식', '21x3']);
  const before = L.dayRows(c, sessions[8].presc, 'S').find((r) => r.id === 'press');
  const after = L.dayRows(c, sessions[12].presc, 'S').find((r) => r.id === 'press');
  assert.deepEqual([before.name, before.equip], ['덤벨프레스', 'dumbbell']);
  assert.deepEqual([after.name, after.equip], ['바벨 벤치프레스', 'barbell']);
});

test('상체 실패: -1회로 돌아가 5회 묶음을 완성, 하체와 독립', () => {
  const { sessions } = run([{}, { lat: false }, {}, {}, {}, {}, {}, {}, {}]);
  assert.deepEqual(sessions.map((s) => accCell(s, 'lat')), ['23x3', '23x4', '23x3', '휴식', '23x4', '23x5', '23x5', '휴식', '24.2x3', '24.2x4']);
  assert.equal(sessions[6].presc.acc.lat.hold, true);
  assert.deepEqual(sessions.slice(0, 5).map((s) => r1(s.presc.main.dl)), [40, 42, 44.1, 46.3, 42]);
});

test('저중량 규칙: OHP 10kg → 5·7·9회, 묶음 성공 시 +5kg, 20kg부터 3·4·5회와 5%', () => {
  const { sessions } = run(Array(12).fill({}));
  assert.deepEqual(sessions.map((s) => accCell(s, 'ohp')), ['10x5', '10x7', '10x9', '휴식', '15x5', '15x7', '15x9', '휴식', '20x3', '20x4', '20x5', '휴식', '21x3']);
});

test('하체 4세션 실패 시 상체는 증량하지 않고 유지', () => {
  const { sessions } = run([{}, {}, {}, { dl: false }, {}, {}]);
  assert.equal(r1(sessions[4].presc.main.dl), 44.1);
  assert.deepEqual([sessions[4].presc.acc.lat.w, sessions[4].presc.acc.lat.reps, sessions[4].presc.acc.lat.hold], [23, 5, true]);
  assert.equal(sessions[5].presc.acc.lat.skip, true);
  assert.equal(r1(sessions[6].presc.acc.lat.w), 24.2);
  assert.equal(r1(sessions[6].presc.main.dl), 42);
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
  assert.equal(L.canLog(tl2, start + 7), false);  // 오늘이 휴식일이면 기록하지 않음
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
  assert.deepEqual(sessions.map((s) => accCell(s, 'ohp')), ['15x7', '15x9', '휴식', '20x3', '20x4']);
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

test('이어서 시작: 하체 4단계 세션부터면 상체는 쉬고, 성공하면 묶음 2단계 무게로 내려 상체 증량', () => {
  const c = cfg();
  c.from = { no: 4, k: 0, stage: 4, acc: {} };
  c.main.dl = 46.3;
  const sessions = L.replay(c, Array.from({ length: 6 }, (_, i) => ({ d: L.toStr(L.toNum(TODAY) + i), res: {} })));
  assert.equal(sessions[0].presc.acc.lat.skip, true);
  assert.deepEqual([sessions[1].no, r1(sessions[1].presc.main.dl), sessions[1].presc.main.bundle], [5, 42, 2]);
  assert.deepEqual(['lat', 'curl', 'ohp', 'side'].map((id) => accCell(sessions[1], id)), ['24.2x3', '4x5', '15x5', '3x10']);
});

test('이어서 시작: 상체 횟수 단계·벤치프레스 전환 상태를 따로 정할 수 있다', () => {
  const p = L.projectTo(cfg(), 13);
  assert.deepEqual([p.state.acc.press.phase, p.state.acc.press.w, p.presc.acc.press.name], [1, 20, '바벨 벤치프레스']);
  const c = cfg();
  c.from = { no: 13, k: 1, stage: 1, acc: { press: { step: 0, phase: 1 }, lat: { step: -1 } } };
  c.acc.find((a) => a.id === 'press').w = 20;
  const [s] = L.replay(c, []);
  const press = L.dayRows(c, s.presc, 'S').find((r) => r.id === 'press');
  assert.deepEqual([press.name, press.equip, press.w, press.reps], ['바벨 벤치프레스', 'barbell', 20, 3]);
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
  assert.equal(t(46, [0.5, 1], 'machine'), '45kg + 1kg 한 짝');               // 기구는 한 짝을 추에 올림
  assert.equal(L.plateMath(46, [0.5, 1], 'machine').unbalanced, false);
  assert.equal(t(23, [0.5, 1], 'machine'), '20kg + 2.5kg 한 짝 + 0.5kg 한 짝');
  assert.equal(t(49.6, [0.5, 1]), '50kg으로 맞추기');
  assert.equal(t(46.3, [0.5, 1]), '45kg + 한쪽 1kg · 반대쪽 0.5kg → 46.5kg');
  assert.equal(L.plateMath(9, [0.5, 1], 'dumbbell'), null);
  // 2.5kg 한 짝은 경량원판이 1.25kg뿐일 때만 (바벨). 머신은 추에 올리므로 늘 허용.
  // 2.5kg 한 짝은 가진 경량원판과 상관없이 쓸 수 있다 (무게 차이를 줄이려고)
  assert.equal(t(46, []), '45kg + 2.5kg 한 짝(한쪽만) → 47.5kg');
  assert.equal(t(47.5, [1]), '45kg + 2.5kg 한 짝(한쪽만)');
  assert.equal(t(47.5, [], 'machine'), '45kg + 2.5kg 한 짝');
});

test('예전 설정(첫 판)을 새 규칙으로 옮긴다', () => {
  const old = cfg();
  delete old.cv; delete old.plates;
  old.trainDays = [1, 2, 3, 4, 5, 6]; old.roundTo = 0.1;
  for (const a of old.acc) { delete a.equip; delete a.sw; if (['press', 'side', 'rear'].includes(a.id)) { a.inc = 'pct'; a.incV = 5; } }
  const m = L.migrate(old);
  assert.equal(m.cv, 2);
  assert.equal(m.trainDays, undefined);
  assert.deepEqual(m.plates, [0.5, 1]);
  const press = m.acc.find((a) => a.id === 'press');
  assert.deepEqual([press.inc, press.incV, press.sw.name, press.equip], ['kg', 1, '바벨 벤치프레스', 'dumbbell']);
  assert.equal(m.acc.find((a) => a.id === 'side').inc, 'kg');
  // 시작 지점(from)이 없는 예전 설정은 세션 1의 첫 운동부터로 본다
  delete m.from;
  const logs = sessionLogs(L.toNum(TODAY));
  assert.deepEqual(L.replay(m, logs).map((s) => [s.no, s.first, r1(s.presc.main.dl)]), [[1, 0, 40], [2, 0, 42]]);
  assert.equal(L.timeline(m, logs, TODAY).days.get(L.toNum(TODAY)).slot, 0);
});
