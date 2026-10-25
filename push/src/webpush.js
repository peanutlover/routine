// 웹 푸시 보내기: 내용 암호화(RFC 8291, aes128gcm)와 보내는 서버 서명(RFC 8292, VAPID). WebCrypto만 쓴다 (Cloudflare Workers · Node).
const te = new TextEncoder();

export function fromB64u(str) {
  const t = String(str).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function toB64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
// HKDF-SHA-256 (추출 + 확장)
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// 받는 브라우저의 공개키(p256dh)·인증 비밀(auth)로 암호화한 푸시 본문.
// 머리(salt 16 + 레코드 크기 4 + 키 길이 1 + 서버 임시 공개키 65) + 암호문. salt·서버 임시 키는 시험할 때만 넘긴다.
export async function encrypt(p256dh, auth, plaintext, opt = {}) {
  const uaPublic = fromB64u(p256dh), authSecret = fromB64u(auth);
  const salt = opt.salt || crypto.getRandomValues(new Uint8Array(16));
  const as = opt.keys || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = typeof plaintext === 'string' ? te.encode(plaintext) : plaintext;
  // 레코드 하나: 내용 + 마지막 레코드 표시(0x02), 채움 없음
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(data, new Uint8Array([2]))));
  const head = new Uint8Array(21 + asPublic.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  head.set(asPublic, 21);
  return concat(head, sealed);
}

// VAPID 서명 키: 공개키(65바이트 비압축)와 비밀값 d (둘 다 base64url)
export function vapidKey(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: toB64u(pub.slice(1, 33)), y: toB64u(pub.slice(33, 65)), d: privateKey, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
// Authorization 머리: 푸시 서비스 주소(aud)에 12시간 동안 쓸 수 있는 서명 토큰
export async function vapidHeader(key, publicKey, endpoint, subject, now = Date.now()) {
  const part = (o) => toB64u(te.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned)));
  return `vapid t=${unsigned}.${toB64u(sig)}, k=${publicKey}`;
}

// sub: 브라우저가 준 구독 {endpoint, keys:{p256dh, auth}}, payload: 서비스 워커가 받을 JSON
export async function sendPush(sub, payload, { key, publicKey, subject, ttl = 60, urgency = 'normal' }) {
  const body = await encrypt(sub.keys.p256dh, sub.keys.auth, JSON.stringify(payload));
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(key, publicKey, sub.endpoint, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
}
