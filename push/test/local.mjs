// 로컬 끝까지 시험: cd push && npx wrangler dev --port 8787 을 띄운 뒤  node test/local.mjs
// 가짜 푸시 서비스(8790)를 띄워 서버가 보낸 요청을 받아 VAPID 서명을 확인하고 내용을 풀어 본다.
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createECDH, createDecipheriv, hkdfSync, randomBytes, createPublicKey, verify } from 'node:crypto';

const API = 'http://127.0.0.1:8787/api';
const ORIGIN = 'http://localhost:8765';
const vars = Object.fromEntries(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').trim().split('\n').map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));

const got = [];
const status = new Map();   // 경로별로 돌려줄 상태 (410 = 구독 끝남)
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks), t: Date.now() }); res.writeHead(status.get(req.url) || 201); res.end(); });
});
await new Promise((r) => srv.listen(8790, r));

const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = randomBytes(16);
const sub = (path) => ({ endpoint: 'http://localhost:8790' + path, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
function open(body) {
  const salt = body.subarray(0, 16), n = body[20], asPub = body.subarray(21, 21 + n), ct = body.subarray(21 + n);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const p = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(p.subarray(0, p.length - 1).toString('utf8'));
}
function checkVapid(h, endpoint) {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.equal(claims.sub, 'https://peanutlover.github.io/routine/');
  assert.ok(claims.exp * 1000 > Date.now() && claims.exp * 1000 <= Date.now() + 12 * 3600e3 + 5000);
  const pub = Buffer.from(m[4], 'base64url');
  assert.equal(m[4], vars.VAPID_PUBLIC);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
}
const api = async (body, origin = ORIGIN) => {
  const res = await fetch(API, { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain' }, origin ? { Origin: origin } : {}), body: JSON.stringify(body) });
  return { status: res.status, acao: res.headers.get('access-control-allow-origin'), json: await res.json().catch(() => null) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const id = () => randomBytes(18).toString('base64url');
const R = {};

// 1) 구독 + 1.5초 뒤 타이머 알림
const A = id();
let r = await api({ id: A, sub: sub('/push/a'), put: [{ tag: 't:lat', in: 1500, title: '랫풀다운 휴식 끝', body: '2세트 시작', ttl: 60, urgent: true }] });
assert.deepEqual([r.status, r.acao, r.json], [200, ORIGIN, { ok: true, n: 1, sub: true }]);
const t0 = Date.now();
await wait(3500);
const a = got.filter((x) => x.path === '/push/a');
assert.equal(a.length, 1);
R.delayMs = a[0].t - t0;
assert.ok(R.delayMs >= 1300 && R.delayMs < 3000, 'delay ' + R.delayMs);
assert.deepEqual(open(a[0].body), { title: '랫풀다운 휴식 끝', body: '2세트 시작', tag: 't:lat' });
assert.equal(a[0].headers['content-encoding'], 'aes128gcm');
assert.equal(a[0].headers.ttl, '60');
assert.equal(a[0].headers.urgency, 'high');
checkVapid(a[0].headers.authorization, 'http://localhost:8790/push/a');
R.timer = 'ok';

// 2) 취소, 덮어쓰기, 묶음(group) 바꾸기
r = await api({ id: A, put: [{ tag: 't:curl', in: 1500, title: 'x', body: 'x' }, { tag: 't:ohp', in: 4000, title: 'ohp-old', body: '' }] });
r = await api({ id: A, del: ['t:curl'], put: [{ tag: 't:ohp', in: 1200, title: 'ohp-new', body: '' }] });
r = await api({ id: A, group: 'rest', put: [{ tag: 'r:1', in: 1300, title: 'r1', body: '' }, { tag: 'r:2', in: 1400, title: 'r2', body: '' }] });
r = await api({ id: A, group: 'rest', put: [{ tag: 'r:3', in: 1500, title: 'r3', body: '', ttl: 21600 }] });
assert.equal(r.json.n, 2);
await wait(5000);
R.second = got.filter((x) => x.path === '/push/a').slice(1).map((x) => open(x.body).title);
assert.deepEqual(R.second, ['ohp-new', 'r3']);

// 3) 구독이 끝났다고(410) 하면 그 기기 것을 모두 지운다
const B = id();
status.set('/push/gone', 410);
await api({ id: B, sub: sub('/push/gone'), put: [{ tag: 't:x', in: 300, title: 'x', body: '' }, { tag: 'r:9', in: 600000, title: 'later', body: '' }] });
await wait(2000);
r = await api({ id: B });
assert.deepEqual(r.json, { ok: true, n: 0, sub: false });
R.gone = 'ok';

// 4) 끄기, 막아야 하는 요청
r = await api({ id: A, off: true });
assert.deepEqual(r.json, { ok: true, n: 0, sub: false });
assert.equal((await api({ id: A }, null)).status, 403);                       // Origin 없음
assert.equal((await api({ id: A }, 'https://evil.example')).status, 403);     // 다른 사이트
assert.equal((await api({ id: 'short' })).status, 400);
assert.equal((await api({ id: A, sub: Object.assign(sub('/x'), { endpoint: 'https://evil.example/push' }) })).json.error, 'endpoint');
const pre = await fetch(API, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
assert.deepEqual([pre.status, pre.headers.get('access-control-allow-origin'), pre.headers.get('access-control-allow-methods')], [204, ORIGIN, 'POST']);
R.guards = 'ok';
console.log(JSON.stringify(R));
srv.close();
