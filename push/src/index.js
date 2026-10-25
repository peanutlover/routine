// 웨이트 루틴 알림 서버 (Cloudflare Workers). 앱이 정해 준 시각에 웹 푸시를 보낸다: 휴식 타이머 끝, 쉬는 날 알림.
// 기기마다 앱이 만든 무작위 id 하나 → Durable Object(PushBox) 하나. 그 안에 구독 정보와 보낼 알림 목록을 두고 가장 이른 시각에 알람을 맞춘다.
//
// POST /api  본문(JSON, Content-Type은 text/plain도 됨)
//   { id,                      기기 id (영문·숫자·-_ 16~64자)
//     sub?: {endpoint, keys},  브라우저 구독 (켤 때·바뀌었을 때)
//     group?: 이름,            이 이름으로 넣어 둔 알림을 put으로 통째로 바꾼다 (쉬는 날 알림)
//     put?: [{tag, at | in, title, body, ttl?, urgent?}],  at = 보낼 시각(ms), in = 지금부터 ms 뒤. 같은 tag는 덮어쓴다
//     del?: [tag],             취소
//     off?: true }             이 기기 알림을 모두 지운다
//   → { ok, n: 남은 알림 수, sub: 구독이 있는가 }
// 늦게 깨어나 ttl(초)보다 더 지난 알림은 보내지 않는다. 푸시 서비스가 구독이 끝났다고(404·410) 하면 그 기기 것을 모두 지운다.
import { sendPush, vapidKey } from './webpush.js';

const ID = /^[A-Za-z0-9_-]{16,64}$/;
// 브라우저들이 쓰는 푸시 서비스 (아이폰·맥 Safari, Chrome·삼성 인터넷·Edge(안드로이드), Firefox, Edge(윈도우))
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const MAX_ITEMS = 40;
const MAX_AHEAD = 31 * 86400000;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) });

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allow = String(env.ALLOW_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allow.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }, h || {}) });
    }
    if (req.method === 'GET' && url.pathname === '/') return new Response('routine push\n', { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname !== '/api' || req.method !== 'POST') return json({ error: 'not_found' }, 404, h || {});
    if (!h) return json({ error: 'origin' }, 403);
    let body;
    try { body = JSON.parse(await req.text()); } catch (e) { return json({ error: 'json' }, 400, h); }
    if (!body || typeof body !== 'object' || !ID.test(String(body.id || ''))) return json({ error: 'id' }, 400, h);
    const box = env.BOX.get(env.BOX.idFromName(body.id));
    const res = await box.fetch('https://box/', { method: 'POST', body: JSON.stringify(body) });
    return json(await res.json(), res.status, h);
  },
};

function checkSub(sub, env) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.keys
    || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return 'sub';
  let u;
  try { u = new URL(sub.endpoint); } catch (e) { return 'endpoint'; }
  const local = env.DEV === '1' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (!local && (u.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(u.hostname)))) return 'endpoint';
  return null;
}
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

export class PushBox {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.key = null;
  }

  async fetch(req) {
    const b = await req.json();
    const st = this.ctx.storage;
    if (b.off) {
      await st.deleteAlarm();
      await st.deleteAll();
      return json({ ok: true, n: 0, sub: false });
    }
    if (b.sub) {
      const err = checkSub(b.sub, this.env);
      if (err) return json({ error: err }, 400);
      await st.put('sub', { endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } });
    }
    const items = (await st.get('items')) || {};
    const now = Date.now();
    const group = typeof b.group === 'string' ? b.group.slice(0, 20) : null;
    if (group) for (const [tag, x] of Object.entries(items)) if (x.group === group) delete items[tag];
    for (const tag of Array.isArray(b.del) ? b.del : []) delete items[String(tag)];
    for (const x of Array.isArray(b.put) ? b.put.slice(0, MAX_ITEMS) : []) {
      if (!x || !x.tag) continue;
      const at = Number.isFinite(x.in) ? now + Math.max(0, x.in) : Number(x.at);
      if (!Number.isFinite(at) || at > now + MAX_AHEAD) continue;
      items[String(x.tag).slice(0, 64)] = {
        at, group, urgent: !!x.urgent, ttl: clamp(x.ttl, 0, 86400, 60),
        title: String(x.title || '').slice(0, 120), body: String(x.body || '').slice(0, 500),
      };
    }
    const order = Object.keys(items).sort((p, q) => items[p].at - items[q].at);
    for (const tag of order.slice(MAX_ITEMS)) delete items[tag];
    await st.put('items', items);
    await this.arm(items);
    return json({ ok: true, n: Object.keys(items).length, sub: !!(await st.get('sub')) });
  }

  async arm(items) {
    let next = Infinity;
    for (const x of Object.values(items)) next = Math.min(next, x.at);
    if (next === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, Date.now()));
  }

  async alarm() {
    const st = this.ctx.storage;
    const items = (await st.get('items')) || {};
    const sub = await st.get('sub');
    const now = Date.now();
    let gone = false;
    for (const [tag, x] of Object.entries(items)) {
      if (x.at > now + 500) continue;
      delete items[tag];
      if (!sub || gone || now - x.at > x.ttl * 1000) continue;
      try {
        if (!this.key) this.key = await vapidKey(this.env.VAPID_PUBLIC, this.env.VAPID_PRIVATE);
        const res = await sendPush(sub, { title: x.title, body: x.body, tag }, {
          key: this.key, publicKey: this.env.VAPID_PUBLIC, subject: this.env.VAPID_SUBJECT, ttl: x.ttl, urgency: x.urgent ? 'high' : 'normal',
        });
        if (res.status === 404 || res.status === 410) gone = true;
        else if (!res.ok) console.log('push failed', res.status, await res.text());
      } catch (e) {
        console.log('push error', String(e));
      }
    }
    if (gone) {
      await st.deleteAlarm();
      await st.deleteAll();
      return;
    }
    await st.put('items', items);
    await this.arm(items);
  }
}
