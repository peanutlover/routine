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

// ---------- 기록 고정 · 검토 수정 ----------
const loggedRows = (c, logs, id) => {
  const sim = L.simulate(c, logs, null, { until: -Infinity });
  return [...sim.days.values()].filter((e) => e.kind === 'log').map((e) => rowOf(e, id)).filter((r) => r && r.result != null)
    .map((r) => `${L.fmtW(r)}x${r.reps}x${r.sets}`);
};
const futureRows = (c, logs, id, n = 6) => {
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 120 });
  return [...sim.days.values()].filter((e) => e.kind === 'plan').map((e) => rowOf(e, id)).filter((r) => r && r.avail === 'ok')
    .slice(0, n).map((r) => `${L.fmtW(r)}x${r.reps}`);
};

test('기록 고정: 장비 무게·진행 방식·횟수 단계·횟수·세트를 바꿔도 이미 한 기록은 그대로, 다음부터 지금 무게에서 바뀐 설정으로', () => {
  const base = () => { const c = cfg(); return { c, logs: L.snapLogs(c, days(54)) }; };
  const cases = [
    ['side', (c) => { c.gear.db = [2, 4, 6, 8, 10]; }, ['4kgx11', '4kgx11', '4kgx11', '4kgx12', '4kgx12', '4kgx12']],
    ['lat', (c) => { c.acc.find((a) => a.id === 'lat').ladder = [3, 4, 5, 6]; }, ['25.4kgx4', '25.4kgx4', '25.4kgx4', '25.4kgx5', '25.4kgx5', '25.4kgx5']],
    ['curl', (c) => { const a = c.acc.find((x) => x.id === 'curl'); a.prog = 'r'; a.reps = 8; }, ['6kgx8', '6kgx8', '6kgx8', '7kgx8', '7kgx8', '7kgx8']],
    ['dl', (c) => { c.main.prog = 'w'; c.main.ladder = [3, 4, 5]; }, ['46.3kgx3', '46.3kgx3', '46.3kgx3', '46.3kgx4', '46.3kgx4', '46.3kgx4']],
    ['dl', (c) => { c.main.reps = 6; c.main.sets = 4; }, ['46.3kgx6', '46.3kgx6', '46.3kgx6', '48.6kgx6', '48.6kgx6', '48.6kgx6']],
    ['lat', (c) => { c.acc.find((a) => a.id === 'lat').incV = 2.5; }, ['25.4kgx4', '25.4kgx4', '25.4kgx4', '25.4kgx5', '25.4kgx5', '25.4kgx5']],
  ];
  for (const [id, change, fut] of cases) {
    const { c, logs } = base();
    const before = loggedRows(c, logs, id);
    change(c);
    assert.deepEqual(loggedRows(c, logs, id), before, id);
    assert.deepEqual(futureRows(c, logs, id), fut, id);
  }
  // 지난 세션 계획표도 그때 무게
  const { c, logs } = base();
  c.main.dl = 50;                                         // 데드리프트 시작 무게는 바꾸면 지금 무게도 같은 비율로
  assert.deepEqual(L.replay(c, logs).map((s) => r1(s.presc.main.dl)), [40, 42, 44.1, 46.3, 42, 44.1, 46.3, 48.6, 44.1, 57.9]);
});

test('기록 고정: 남긴 상태가 없는 예전 기록은 지금 설정으로 채우고, 채워도 결과는 같다', () => {
  const c = cfg();
  const raw = days(30, {});
  raw[8].res = { dl: false };
  const before = L.replay(c, raw).map((s) => [r1(s.presc.main.dl), accCell(s, 'lat'), accCell(s, 'press')]);
  const logs = L.snapLogs(c, JSON.parse(JSON.stringify(raw)));
  assert.ok(logs.every((l) => l.s && l.s.main));
  assert.deepEqual(L.replay(c, logs).map((s) => [r1(s.presc.main.dl), accCell(s, 'lat'), accCell(s, 'press')]), before);
});

test('기록 고정: 지난 기록 결과를 고치면 뒤 기록은 다시 계산해 남긴다', () => {
  const c = cfg();
  const logs = L.snapLogs(c, days(18));
  logs[6].res = { dl: false };                            // 세션 2 첫 날 데드 실패로 고침
  L.snapLogs(c, logs, 7);
  const ss = L.replay(c, logs);
  assert.deepEqual(ss.map((s) => r1(s.presc.main.dl)), [40, 42, 40, 42]);
  assert.equal(ss[2].presc.main.retry, true);
});

test('목록 방식: 목록 밖 무게는 반대로 가지 않고, 가장 가벼운 무게에서 실패하면 같은 칸에서 다시', () => {
  const c = cfg();
  const a = c.acc.find((x) => x.id === 'press');
  assert.equal(L.stepW(c, a, 'dumbbell', 32, 1), 32);    // 가장 무거운 30kg보다 무거우면 그대로
  assert.equal(L.stepW(c, a, 'dumbbell', 0.5, -1), 0.5);
  assert.equal(L.stepW(c, a, 'dumbbell', 7, 1), 8);
  c.gear.db = [2, 4, 6];                                  // 덤벨프레스 7kg인데 목록에 더 무거운 게 없으면 7kg 유지
  assert.ok(L.replay(c, days(30)).every((s) => s.presc.acc.press.skip || s.presc.acc.press.w === 7));
  const c2 = cfg();
  const side = c2.acc.find((x) => x.id === 'side'); side.prog = 'r'; side.w = 1;
  const logs = Array.from({ length: 18 }, (_, i) => ({ d: L.toStr(L.toNum(TODAY) + i + Math.floor(i / 6)), res: i < 6 && i % 2 ? { side: false } : {} }));
  assert.deepEqual(L.replay(c2, logs).map((s) => accCell(s, 'side')), ['1x10', '1x10', '2x10', '휴식']);
  assert.equal(L.fmtW({ w: 1.25, mode: 'plate' }), '1.25kg');
  assert.equal(L.fmtW({ w: 24.15, mode: 'stack' }), '24.2kg');
});

test('둘째 판 설정: OHP를 20kg 이상으로 시작했으면 이미 일반 바벨 (3·4·5회)', () => {
  const v2 = {
    cv: 2, startDate: TODAY, from: { no: 1, k: 0, stage: 1, acc: {} }, plates: [1.25],
    main: { dl: 40, ratio: 1.2, pct: 5, reps: 5, sets: 3, rest: '' },
    acc: [{ id: 'ohp', name: 'OHP', part: '어깨', day: 'D', equip: 'barbell', w: 22.5, reps: 3, sets: 3, rest: '', inc: 'pct', incV: 5, light: true, from: 1, sw: null }],
  };
  const m = L.migrate(v2);
  assert.deepEqual([m.acc[0].mode, m.acc[0].ladder], ['barbell', [3, 4, 5]]);
});

test('세션 중간에 넣은 종목은 그 세션의 남은 차례부터 (밀림 아님)', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const logs = [0, 1, 2].map((k) => P(s + k, k % 2 ? ALL_S : ALL_D));      // 세션 1의 3번째(데드)까지 함
  c.acc.push(Object.assign(L.accDefaults(L.EXTRA.find((x) => x.id === 'row')), { from: 1, fromK: 3 }));
  const sim = L.simulate(c, logs, L.toStr(s + 3), { until: s + 12 });
  const d5 = sim.days.get(s + 4);                                            // 세션 1의 5번째 = 데드 날
  assert.deepEqual([d5.type, rowOf(d5, 'row').avail, rowOf(d5, 'row').lag, rowOf(d5, 'row').reps], ['D', 'ok', false, 5]);
  const n1 = sim.days.get(s + 7);                                            // 세션 2 첫 데드 날: 첫 세션 몫(1번)을 마쳐 2번째 횟수
  assert.deepEqual([n1.no, rowOf(n1, 'row').accNo, rowOf(n1, 'row').reps, rowOf(n1, 'row').lag], [2, 2, 6, false]);
});

test('이어서 시작: 훈련방식을 바꾼 구간에서 시작하면 넣은 무게로, 무게 고정 하체면 마지막 단계에 상체가 쉰 뒤 첫 칸', () => {
  const c = cfg();
  const ohp = c.acc.find((a) => a.id === 'ohp');
  ohp.chg = [{ no: 3, mode: 'barbell', w: 20 }];
  c.from = { no: 8, k: 0, stage: 4, acc: { ohp: { step: 0, w: 22 } } };
  const [s] = L.replay(c, []);
  assert.equal(s.presc.acc.ohp.skip, true);
  const ss = L.replay(c, Array.from({ length: 6 }, (_, i) => ({ d: L.toStr(L.toNum(TODAY) + i), res: {} })));
  assert.deepEqual([ss[1].presc.acc.ohp.mode, ss[1].presc.acc.ohp.w, ss[1].presc.acc.ohp.reps], ['barbell', 22, 5]);
  const c2 = cfg();
  c2.main.prog = 'w'; c2.main.ladder = [3, 4, 5];
  assert.equal(L.restStage(c2), 3);
  assert.deepEqual(L.accAt(3, c2.acc[0], L.restStage(c2)), { step: 0 });
  assert.deepEqual(L.accAt(2, c2.acc[0], L.restStage(c2)), { step: 1 });
});

test('기록 고정: 무게 생략 종목(+1kg 표시)과 하체 단계도 그때대로, 진행 방식을 바꾸면 다음 세션은 한 칸 무거운 무게', () => {
  const c = cfg();
  const logs = L.snapLogs(c, days(30));
  const tri = () => loggedRows(c, logs, 'tri');
  const stages = () => [...L.simulate(c, logs, null, { until: -Infinity }).days.values()].filter((e) => e.kind === 'log').map((e) => e.main.stage).join('');
  const [t0, s0] = [tri(), stages()];
  c.acc.find((a) => a.id === 'tri').incV = 2.5;
  c.main.prog = 'w'; c.main.ladder = [3, 4, 5, 6];
  assert.deepEqual([tri(), stages()], [t0, s0]);
  // 세션 5(42kg·1단계)까지 횟수 고정으로 했고 지금 무게 고정으로 바꿈 → 세션 6은 44.1kg 첫 횟수
  const ss = L.replay(c, logs);
  assert.deepEqual([r1(ss[4].presc.main.dl), r1(ss[5].presc.main.dl), ss[5].presc.main.reps], [42, 44.1, 3]);
});

// ---------- 오래 쉬면 처음부터 ----------
// 세션 1(0~5일) 매일, 6일 휴식, 세션 2를 7일부터 n번 (7 D, 8 S, 9 D, 10 S, 11 D, 12 S)
const gapLogs = (n) => [0, 1, 2, 3, 4, 5].map((k) => P(L.toNum(TODAY) + k, k % 2 ? ALL_S : ALL_D))
  .concat(Array.from({ length: n }, (_, i) => P(L.toNum(TODAY) + 7 + i, i % 2 ? ALL_S : ALL_D)));
const stagesFrom = (sim, from, to) => Array.from({ length: to - from + 1 }, (_, i) => sim.view(from + i)).map((v) => `${v.main.stage}:${r1(v.main.dl)}`);

test('오래 쉬면 처음부터: 스쿼트 2번 한 세션 2에서 3번째를 10일 넘게 안 하면 2번 한 것은 지우고 두 단계 낮춰 0·1·2·3·4단계로', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const logs = gapLogs(5);                                   // 스쿼트는 8·10일, 마지막 운동은 11일(데드)
  const back = (d) => L.simulate(c, logs, L.toStr(s + d), { until: s + d + 60 });
  const e4 = back(15).days.get(s + 15);                      // 스쿼트를 4일 쉼: 그대로 6번째(스쿼트)
  assert.deepEqual([e4.type, e4.no, e4.pos, r1(e4.main.dl), e4.rows[0].rested], ['S', 2, 5, 42, 0]);
  const e5 = back(16).days.get(s + 16);                      // 5일: 세션 2를 데드리프트부터 다시, 한 단계(−5%) 낮춤
  assert.deepEqual([e5.type, e5.no, e5.pos, r1(e5.main.dl), e5.main.stage, e5.rows[0].rested, e5.rows[0].restart], ['D', 2, 0, 40, 1, 1, 5]);
  const sim = back(21);                                      // 10일: 두 단계 → 세션 2가 0단계(1단계 직전 무게)
  const e10 = sim.days.get(s + 21);
  assert.deepEqual([e10.no, e10.pos, r1(e10.main.dl), e10.main.stage, e10.rows[0].rested], [2, 0, 38.1, 0, 2]);
  assert.deepEqual(stagesFrom(sim, 2, 7), ['0:38.1', '1:40', '2:42', '3:44.1', '4:46.3', '1:42']);   // 묶음을 채우려면 0·1·2·3·4단계
  assert.equal(sim.cur.n, 0);
  // 다음 날 스쿼트가 그동안 쉰 날 수로 또 낮아지지 않는다
  const e11 = sim.days.get(s + 22);
  assert.deepEqual([e11.type, e11.no, e11.pos, r1(e11.main.dl), e11.rows[0].restart], ['S', 2, 1, 38.1, 0]);
});

test('오래 쉬면 처음부터: 하체 세션을 다시 하면 그 세션의 상체·팔도 처음부터, 무게는 종목마다 쉰 날 수대로', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const sim = L.simulate(c, gapLogs(5), L.toStr(s + 21), { until: s + 30 });
  const d1 = sim.days.get(s + 21), s1 = sim.days.get(s + 22);
  // 데드 날 종목은 11일에 마지막으로 해서 9일 쉼 → 한 단계, 스쿼트 날 종목은 10일이 마지막이라 다음 날 11일 쉼 → 두 단계
  assert.deepEqual(['lat', 'curl', 'ohp'].map((id) => [rowOf(d1, id).avail, rowOf(d1, id).reps, rowOf(d1, id).rested]), [['ok', 3, 1], ['ok', 5, 1], ['ok', 5, 1]]);
  assert.deepEqual(['press', 'side'].map((id) => [rowOf(s1, id).avail, rowOf(s1, id).reps, rowOf(s1, id).rested, rowOf(s1, id).restart]), [['ok', 2, 2, 11], ['ok', 9, 2, 11]]);
  const v3 = sim.view(3);                                    // 다음 세션은 다시 단계대로 (실패 없음)
  assert.deepEqual([v3.acc.lat.reps, v3.acc.press.reps, v3.acc.lat.rested], [4, 3, 0]);
  // 하체만 4일 쉬면 그대로 (상체도)
  const e = L.simulate(c, gapLogs(5), L.toStr(s + 15), { until: s + 16 }).days.get(s + 15);
  assert.ok(e.rows.every((r) => !r.rested));
});

test('오래 쉬면 처음부터: 한 종목만 계속 안 하면 그 종목만, 쉬는 날에 그 종목을 안 했으면 10일째 한 단계 더', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const noCurl = { dl: true, lat: true, ohp: true };
  // 덤벨컬은 0일에만 하고 2·4일(세션 1)은 안 함 → 6일째 운동(세션 2 첫 데드, 7일)에 6일 쉼
  const logs = [0, 1, 2, 3, 4, 5].map((k) => P(s + k, k % 2 ? ALL_S : k ? noCurl : ALL_D));
  const sim = L.simulate(c, logs.concat(P(s + 7, noCurl)), L.toStr(s + 8), { until: s + 12 });
  const d7 = sim.days.get(s + 7);
  assert.deepEqual([rowOf(d7, 'curl').rested, rowOf(d7, 'curl').restart, rowOf(d7, 'curl').reps, rowOf(d7, 'lat').rested], [1, 6, 4, 0]);
  assert.equal(rowOf(d7, 'curl').result, null);                // 이 날도 안 함 → 같은 쉬는 기간
  const d9 = sim.days.get(s + 9);                            // 8일 쉼: 아직 한 단계
  assert.deepEqual([rowOf(d9, 'curl').rested, rowOf(d9, 'curl').restart], [1, 0]);
  const sim2 = L.simulate(c, logs.concat(P(s + 7, noCurl), P(s + 8, ALL_S), P(s + 9, noCurl), P(s + 10, ALL_S)), L.toStr(s + 11), { until: s + 12 });
  const d11 = sim2.days.get(s + 11);                         // 10일 쉼 → 두 단계 (5회 → 3회)
  assert.deepEqual([rowOf(d11, 'curl').rested, rowOf(d11, 'curl').restart, rowOf(d11, 'curl').reps, rowOf(d11, 'curl').lag], [2, 10, 3, true]);
  assert.deepEqual(sim2.days.get(s + 11).rows.filter((r) => r.rested).map((r) => r.id), ['curl']);
});

test('오래 쉬면 처음부터: 하체 마지막 단계 세션(상체·팔이 쉼)은 쉬는 날로 세지 않고, 그 세션 중에 오래 쉬면 하체가 내려와 상체도 한다', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const logs = [];
  let d = s;
  for (let i = 0; i < 4; i++) { for (let k = 0; k < 6; k++) logs.push(P(d++, k % 2 ? ALL_S : ALL_D)); d++; }
  const sim = L.simulate(c, logs, L.toStr(d), { until: d + 3 });   // 세션 4(4단계)는 상체가 쉬고 지금은 세션 5
  assert.ok(sim.days.get(d).rows.every((r) => !r.rested));
  assert.equal(rowOf(sim.days.get(d), 'lat').reps, 3);
  // 세션 4 세 번째 운동 뒤 7일 쉼 → 하체 3단계로, 상체·팔은 이번 세션을 쉬지 않고 한 단계 낮춰서
  const part = logs.slice(0, 21);
  const back = L.toNum(part[20].d) + 8;
  const e = L.simulate(c, part, L.toStr(back), { until: back + 2 }).days.get(back);
  assert.deepEqual([e.no, e.pos, e.main.stage, e.main.top, rowOf(e, 'lat').avail, rowOf(e, 'lat').reps, rowOf(e, 'lat').rested], [4, 0, 3, false, 'ok', 2, 1]);
});

test('오래 쉬면 처음부터: 무게 고정 하체는 횟수 한 단계, 고무밴드는 낮추지 않고, 규칙이 생기기 전(restFrom 이전) 기록은 그대로', () => {
  const s = L.toNum(TODAY);
  const c = cfg();
  c.main.prog = 'w'; c.main.ladder = [3, 4, 5];
  const pull = L.accDefaults(L.EXTRA.find((x) => x.id === 'pullup'));
  pull.bands = ['1번밴드'];
  c.acc.push(pull);
  const logs = gapLogs(2).map((l) => Object.assign({}, l, { res: Object.assign({ pullup: true }, l.res) }));   // 세션 2: 데드·스쿼트 1번씩(4회)
  const e = L.simulate(c, logs, L.toStr(s + 15), { until: s + 16 }).days.get(s + 15);
  assert.deepEqual([e.type, e.pos, r1(e.main.dl), e.main.reps, e.rows[0].rested], ['D', 0, 40, 3, 1]);    // 4회 → 3회 (무게 그대로)
  assert.deepEqual([rowOf(e, 'pullup').rested, rowOf(e, 'pullup').reps], [0, 5]);
  const old = cfg();
  old.restFrom = L.toStr(s + 16);                           // 15일에는 아직 규칙 없음
  assert.ok(L.simulate(old, gapLogs(2), L.toStr(s + 15), { until: s + 15 }).days.get(s + 15).rows.every((r) => !r.rested));
  assert.equal(L.simulate(old, gapLogs(2), L.toStr(s + 16), { until: s + 16 }).days.get(s + 16).rows[0].rested, 1);
});

test('오래 쉬면 처음부터: 처음부터 다시 한 날을 기록하면 그때 무게가 남아 설정을 바꿔도 그대로, 알림은 쉰 지 3·4일째부터', () => {
  const c = cfg();
  const s = L.toNum(TODAY);
  const sheet = L.simulate(c, gapLogs(5), L.toStr(s + 17), { until: -Infinity }).next;    // 17일(6일 쉼)에 한 운동
  const logs = L.snapLogs(c, gapLogs(5)).concat(Object.assign(P(s + 17, ALL_D), { s: L.snapOf(sheet.rows, (r) => r.id in ALL_D) }));
  const before = loggedRows(c, logs, 'dl').concat(loggedRows(c, logs, 'lat'));
  assert.deepEqual(loggedRows(c, logs, 'dl').slice(-1), ['40kgx5x3']);
  c.main.prog = 'w'; c.main.ladder = [4, 5, 6];
  c.acc.find((a) => a.id === 'lat').ladder = [5, 6, 7];
  assert.deepEqual(loggedRows(c, logs, 'dl').concat(loggedRows(c, logs, 'lat')), before);
  // 알림용: 다음 운동 날 할 종목의 쉰 날 수
  const gaps = (d) => L.simulate(cfg(), gapLogs(5), L.toStr(s + d), { until: -Infinity }).gaps;
  const g3 = gaps(14);
  assert.equal(g3.day, s + 14);
  assert.deepEqual(g3.items.map((x) => [x.id, x.rest, x.dropped]), [['sq', 3, 0], ['press', 3, 0], ['tri', 3, 0], ['side', 3, 0], ['rear', 3, 0]]);
  assert.deepEqual(gaps(16).items.slice(0, 2).map((x) => [x.id, x.rest, x.dropped, x.today]), [['dl', 5, 1, true], ['lat', 4, 0, false]]);
});

// 앱처럼 하루씩 기록한다: 그날 할 종목을 모두 하고(fail(no, id)면 실패) 그날 상태를 남긴다.
function logDaily(c, logs, days, fail = () => false, ovw = () => null, ovr = () => null, ovt = () => null) {
  let d = logs.length ? L.toNum(logs[logs.length - 1].d) + 1 : L.toNum(c.startDate);
  for (let k = 0; k < days; d++) {
    const n = L.simulate(c, logs, L.toStr(d), { until: -Infinity }).next;
    const res = {};
    for (const r of n.rows) if (r.avail === 'ok') res[r.id] = !fail(n.no, r.id);
    const w = {};
    for (const r of n.rows) if (r.id in res && ovw(n.no, r.id, n)) w[r.id] = ovw(n.no, r.id, n);
    const rr = {};
    for (const r of n.rows) if (r.id in res && ovr(n.no, r.id, n)) rr[r.id] = ovr(n.no, r.id, n);
    const tt = {};
    for (const r of n.rows) if (r.id in res && ovt(n.no, r.id, n) != null) tt[r.id] = ovt(n.no, r.id, n);
    logs.push(Object.assign({ d: L.toStr(d), res, p: 1, s: L.snapOf(n.rows, (r) => r.id in res) }, Object.keys(w).length ? { w } : {}, Object.keys(rr).length ? { r: rr } : {}, Object.keys(tt).length ? { t: tt } : {},
      n.pos === 0 && n.order === 'S' ? { o: 'S' } : {}));
    k++;
  }
  return logs;
}
const mainBy = (c, logs, until) => {
  const sim = L.simulate(c, logs, null, { until, minSessions: 0 });
  return sim.main.map((s) => sim.view(s.no).main).map((m) => [r1(m.dl), r1(m.sq)]);
};

test('하체 증량 방식: 스쿼트만 5kg씩, 데드리프트는 5%씩. 실패하면 5kg 낮춘다', () => {
  const c = cfg();
  c.main.dl = 102; c.acc = [];
  c.main.inc.sq = 5;
  const w = mainBy(c, [], L.toNum(TODAY) + 60).slice(0, 6);
  assert.deepEqual(w.map((x) => x[1]), [85, 90, 95, 100, 90, 95]);
  assert.deepEqual(w.map((x) => x[0]), [102, 107.1, 112.5, 118.1, 107.1, 112.5]);
  const logs = logDaily(c, [], 12, (no, id) => no === 2 && id === 'sq');
  const v = L.simulate(c, logs, null, { until: -Infinity });
  assert.equal(r1(v.view(3).main.sq), 85);      // 세션 2(90kg) 실패 → 85kg
});

test('하체 증량 방식: 세션 중에 바꾸면 그 세션은 그대로, 다음 세션부터 앞 세션 무게에서 새 방식으로', () => {
  const c = cfg();
  c.main.dl = 102; c.acc = [];
  const logs = logDaily(c, [], 8);                 // 세션 1(6회) + 세션 2 두 번 (85, 89.25)
  const before = loggedRows(c, logs, 'sq');
  c.main.ichg.push({ no: 3, id: 'sq', inc: 5 });
  assert.deepEqual(loggedRows(c, logs, 'sq'), before);
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 40 });
  assert.equal(r1(sim.next.main.sq), 89.3);       // 진행 중인 세션 2는 그대로
  assert.deepEqual([3, 4, 5].map((no) => r1(sim.view(no).main.sq)), [94.3, 99.3, 89.3]);   // 89.25 + 5, + 10, 다음 묶음 2단계
  assert.deepEqual([3, 4].map((no) => r1(sim.view(no).main.dl)), [112.5, 118.1]);          // 데드리프트는 그대로 5%
  // 세션 3·4를 기록한 뒤 다시 5%로 (세션 5부터): 99.25kg에서 5%씩. 새 묶음은 4단계에서 두 단계 아래(2단계)부터.
  logDaily(c, logs, 4 + 12);
  c.main.ichg.push({ no: 5, id: 'sq', inc: 'pct' });
  const s2 = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 60 });
  assert.equal(s2.view(4).main.sq, 99.25);
  assert.deepEqual([5, 6].map((no) => r1(s2.view(no).main.sq)), [r1(99.25 / 1.05 / 1.05), r1(99.25 / 1.05)]);
});

test('보조 종목 증량 방식(% → kg)을 세션 중에 바꾸면 그 세션 무게는 그대로, 다음 세션은 그 무게 + kg', () => {
  const c = cfg();
  const bench = L.accDefaults(L.EXTRA.find((x) => x.id === 'bench'));
  Object.assign(bench, { w: 40, prog: 'r', reps: 5 });
  c.acc = [bench];
  const logs = logDaily(c, [], 9);                // 벤치 세션 1(40) 끝, 세션 2(42) 한 번
  bench.inc = 'kg'; bench.incV = 5;
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 30 });
  assert.deepEqual([1, 2, 3].map((no) => r1(sim.acc.bench[no - 1].presc.w)), [40, 42, 47]);
});

test('하체 증량 방식: 6kg씩, 예전 판의 kg는 5kg로 읽는다', () => {
  const c = cfg();
  c.main.dl = 102; c.acc = [];
  c.main.inc.dl = 6;
  assert.deepEqual(mainBy(c, [], L.toNum(TODAY) + 40).slice(0, 5).map((x) => x[0]), [102, 108, 114, 120, 108]);
  c.main.inc.sq = 'kg';
  assert.deepEqual(mainBy(c, [], L.toNum(TODAY) + 40).slice(0, 3).map((x) => x[1]), [85, 90, 95]);
});

test('스쿼트 시작 무게를 따로 넣으면 그 무게부터, 비우면 데드리프트 ÷ 1.2', () => {
  const c = cfg();
  c.main.dl = 102; c.acc = [];
  assert.deepEqual(mainBy(c, [], L.toNum(TODAY) + 20).slice(0, 2), [[102, 85], [107.1, 89.3]]);
  c.main.sq = 80;
  assert.deepEqual(mainBy(c, [], L.toNum(TODAY) + 20).slice(0, 2), [[102, 80], [107.1, 84]]);
  c.main.inc.sq = 5;
  assert.deepEqual(mainBy(c, [], L.toNum(TODAY) + 20).slice(0, 3).map((x) => x[1]), [80, 85, 90]);
  // 기록한 날 스쿼트 무게는 그대로 (나중에 시작 무게를 바꿔도)
  const logs = logDaily(c, [], 4);
  const before = loggedRows(c, logs, 'sq');
  c.main.sq = 70;
  assert.deepEqual(loggedRows(c, logs, 'sq'), before);
});

// 세션 2 첫 스쿼트(세션의 2번째 운동)만 무게를 바꿔서 하고 결과는 ok
function overSq(w, ok) {
  const c = cfg();
  c.main.dl = 102; c.acc = [];
  let done = false;
  const logs = logDaily(c, [], 12, (no, id) => !ok && no === 2 && id === 'sq' && !done && (done = true),
    (no, id, n) => (no === 2 && id === 'sq' && n.pos === 1 ? w : null));
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 30 });
  const day = [...sim.days.values()].find((e) => e.kind === 'log' && e.no === 2 && e.pos === 1);
  const sq = day.rows.find((r) => r.id === 'sq');
  const s2 = [...sim.days.values()].filter((e) => e.kind === 'log' && e.no === 2 && e.type === 'S').map((e) => r1(e.rows[0].w));
  return { shown: [r1(sq.w), r1(sq.plan)], s2, next: [r1(sim.view(3).main.dl), r1(sim.view(3).main.sq)] };
}

test('기록할 때 무게를 바꾸면: 무겁게 성공 → 그 무게 기준, 무겁게 실패 → 계획 무게 기준', () => {
  const up = overSq(95, true);
  assert.deepEqual(up.shown, [95, 89.3]);
  assert.deepEqual(up.s2, [95, 95, 95]);                   // 그 세션의 남은 스쿼트도 95kg
  assert.deepEqual(up.next, [112.5, r1(95 * 1.05)]);       // 데드리프트는 그대로
  const upFail = overSq(95, false);
  assert.deepEqual(upFail.shown, [95, 89.3]);
  assert.deepEqual(upFail.s2, [95, 89.3, 89.3]);           // 실패했으니 남은 운동은 계획 무게
  assert.deepEqual(upFail.next, [102, 85]);                // 세션 실패 → 계획 무게(89.25)에서 한 단계 아래
});

test('기록할 때 무게를 바꾸면: 가볍게 하면 성공·실패 모두 그 무게 기준', () => {
  const dn = overSq(80, true);
  assert.deepEqual(dn.shown, [80, 89.3]);
  assert.deepEqual(dn.next, [112.5, 84]);
  const dnFail = overSq(80, false);
  assert.deepEqual(dnFail.next, [102, r1(80 / 1.05)]);
});

test('기록할 때 무게를 바꾸면: 보조 종목(무게 고정·횟수 고정)도 그 무게에서 이어 가고, 고쳐 저장해도 그대로', () => {
  const c = cfg();
  const bench = L.accDefaults(L.EXTRA.find((x) => x.id === 'bench'));
  Object.assign(bench, { w: 40, prog: 'r', reps: 5 });
  c.acc = c.acc.filter((a) => a.id === 'ohp').concat(bench);
  const logs = logDaily(c, [], 9, () => false, (no, id) => (no === 1 && id === 'bench' ? 45 : no === 1 && id === 'ohp' ? 15 : null));
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 30 });
  assert.deepEqual([1, 2, 3].map((no) => r1(sim.acc.bench[no - 1].presc.w)), [45, 47.3, 49.6]);
  assert.equal(sim.acc.ohp[1].presc.w, 15);
  const again = L.snapLogs(c, logs.map((l) => Object.assign({}, l)), 0);
  assert.deepEqual(loggedRows(c, again, 'bench'), loggedRows(c, logs, 'bench'));
});

test('새 세션에서 스쿼트를 먼저 하면 S·D 번갈아, 보조 종목도 자기 하체 날에 따라가고 기록한 세션 순서는 그대로', () => {
  const c = cfg();
  const s0 = L.toNum(TODAY);
  const logs = logDaily(c, [], 6);                       // 세션 1 (D S D S D S)
  c.order = { no: 2, o: 'S' };
  const tl = L.simulate(c, logs, L.toStr(s0 + 6), { until: s0 + 20 });
  const s2 = [...tl.days.values()].filter((e) => e.kind === 'plan' && e.no === 2);
  assert.deepEqual(s2.map((e) => e.type).join(''), 'SDSDSD');
  assert.deepEqual(s2[0].rows.map((r) => r.id), ['sq', 'press', 'tri', 'side', 'rear']);
  assert.ok(s2[0].rows.every((r) => r.avail === 'ok'));
  assert.deepEqual(s2[1].rows.map((r) => [r.id, r.avail]), [['dl', 'ok'], ['lat', 'ok'], ['curl', 'ok'], ['ohp', 'ok']]);
  const s3 = [...tl.days.values()].filter((e) => e.kind === 'plan' && e.no === 3);
  assert.equal(s3.map((e) => e.type).join(''), 'DSDSDS');   // 고르지 않은 세션은 데드리프트 먼저
  // 세션 2를 스쿼트부터 기록한 뒤 고른 것을 지워도 기록은 그대로
  logDaily(c, logs, 7);
  assert.equal(logs.filter((l) => l.o).length, 1);
  c.order = null;
  const after = L.simulate(c, logs, null, { until: -Infinity });
  const s2l = [...after.days.values()].filter((e) => e.kind === 'log' && e.no === 2);
  assert.equal(s2l.map((e) => e.type).join(''), 'SDSDSD');
  assert.ok(s2l.every((e) => e.rows.every((r) => r.avail === 'ok' && r.result === true)));
  assert.equal(after.cur.no, 3);
  assert.equal(after.main[1].out, true);
  for (const id of ['lat', 'press']) assert.equal(after.acc[id][1].done, true);
});

// 덤벨컬(데드 날, 무게 고정 4·6·8회)만 남기고, 세션 no의 첫 덤벨컬을 reps회로 해서 ok
function overCurl(no, reps, ok) {
  const c = cfg();
  c.acc = c.acc.filter((a) => a.id === 'curl');
  Object.assign(c.acc[0], { ladder: [4, 6, 8] });
  let done = false;
  const first = (n, id) => n.no === no && id === 'curl' && n.pos === 0;
  const logs = logDaily(c, [], 7 * no + 2, (nn, id) => !ok && nn === no && id === 'curl' && !done && (done = true),
    () => null, (nn, id, n) => (first(n, id) ? reps : null));
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 7 * no + 40, minSessions: no + 4 });
  return { s: Array.from({ length: no + 3 }, (_, i) => sim.view(i + 1).acc.curl).map((p) => (p.skip ? '쉼' : `${p.w}x${p.reps}`)), rows: [...sim.days.values()].filter((e) => e.kind === 'log' && e.no === no && e.type === 'D').map((e) => e.rows.find((r) => r.id === 'curl').reps) };
}

test('기록할 때 횟수를 바꾸면: 무게 고정 사다리에서 바꾼 횟수 기준으로 원래 간격만큼 오르내린다', () => {
  // 4·6·8회의 6회 차례(세션 2)에 10회 성공 → 남은 운동 10회, 다음 세션 12회, 그다음 무게를 올리고 4회부터
  const up = overCurl(2, 10, true);
  assert.deepEqual(up.rows, [10, 10, 10]);
  assert.deepEqual(up.s, ['3x4', '3x6', '3x12', '쉼', '4x4']);    // 세션 목록은 그 세션 첫 기록 때 계획(6회)
  // 4회 차례(세션 1)에 8회 실패 → 8회에서 한 단계(2회) 아래 6회
  const dn = overCurl(1, 8, false);
  assert.deepEqual(dn.s.slice(0, 2), ['3x4', '3x6']);
  // 첫 칸 아래는 첫 두 칸 간격만큼: 4·6·8회의 −1단계 = 2회
  assert.equal(L.ladderReps({ ladder: [4, 6, 8] }, -1), 2);
  assert.equal(L.ladderReps({ ladder: [3, 4, 5] }, -2), 1);
});

test('기록할 때 세트·횟수(횟수 고정)를 바꾸면 그날 기록만 바뀐다', () => {
  const c = cfg();
  c.acc = [];
  const logs = logDaily(c, [], 1);
  logs[0].r = { dl: 8 }; logs[0].e = { dl: 5 };
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 3 });
  const r = sim.days.get(L.toNum(TODAY)).rows[0];
  assert.deepEqual([r.reps, r.sets, r.planR, r.planE], [8, 5, 5, 3]);
  assert.deepEqual([sim.next.rows[0].reps, sim.next.rows[0].sets], [5, 3]);
});

test('기록할 때 횟수 단계를 옮기면 그 단계부터 계획을 다시 이어 간다', () => {
  const c = cfg();
  c.acc = c.acc.filter((a) => a.id === 'press');            // 덤벨프레스 3·4·5회 (스쿼트 날)
  const first = (no) => (nn, id, n) => (nn === no && id === 'press' && n.pos === 1 ? 0 : null);
  const logs = logDaily(c, [], 9, () => false, () => null, () => null, first(2));   // 세션 2(4회 차례)의 첫 덤벨프레스를 1단계(3회)로
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 60, minSessions: 6 });
  const day = [...sim.days.values()].find((e) => e.kind === 'log' && e.no === 2 && e.pos === 1).rows.find((r) => r.id === 'press');
  assert.deepEqual([day.reps, day.planR, day.planT, day.rstep], [3, 4, 1, 0]);
  const s2 = [...sim.days.values()].filter((e) => e.no === 2 && e.type === 'S').map((e) => e.rows.find((r) => r.id === 'press').reps);
  assert.deepEqual(s2, [3, 3, 3]);
  // 세션 3: 4회, 세션 4는 하체 4단계라 쉼, 세션 5: 5회, 세션 6: 무게를 올려 3회
  assert.deepEqual([3, 4, 5, 6].map((no) => { const p = sim.view(no).acc.press; return p.skip ? '쉼' : `${p.w}x${p.reps}`; }), ['7x4', '쉼', '7x5', '8x3']);
});

test('무게 고정 하체의 단계를 옮기면 데드리프트·스쿼트가 같이 옮겨 간다', () => {
  const c = cfg();
  c.acc = []; c.main.prog = 'w'; c.main.ladder = [3, 4, 5];
  const logs = logDaily(c, [], 7, () => false, () => null, () => null, (no, id, n) => (no === 2 && n.pos === 0 ? 0 : null));
  const sim = L.simulate(c, logs, null, { until: L.toNum(TODAY) + 30 });
  const reps = [...sim.days.values()].filter((e) => e.no === 2).map((e) => e.rows[0].reps);
  assert.deepEqual(reps, [3, 3, 3, 3, 3, 3]);
  assert.equal(sim.view(3).main.reps, 4);
});
