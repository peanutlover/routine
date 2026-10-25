// 실행: node --test push/test/webpush.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, createDecipheriv, hkdfSync, verify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { encrypt, vapidKey, vapidHeader, fromB64u, toB64u } from '../src/webpush.js';

test('RFC 8291 예제: 같은 키·salt면 RFC에 적힌 푸시 본문과 똑같다', async () => {
  const asPublic = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
  const pub = fromB64u(asPublic);
  const jwk = { kty: 'EC', crv: 'P-256', x: toB64u(pub.slice(1, 33)), y: toB64u(pub.slice(33, 65)), d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' };
  const keys = {
    publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
  };
  const out = await encrypt('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    'When I grow up, I want to be a watermelon', { salt: fromB64u('DGv6ra1nlYgDCS1FRnbzlw'), keys });
  const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  assert.equal(toB64u(out), expected.replace(/\s+/g, ''));
});

// 받는 쪽(브라우저)처럼 node:crypto로 따로 풀어 본다.
function decrypt(body, uaPrivate, uaPublic, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const secret = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('무작위 키로 암호화한 한글 알림을 받는 쪽에서 풀 수 있다', async () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const msg = JSON.stringify({ title: '랫풀다운 휴식 끝', body: '2세트 시작', tag: 't:lat' });
  for (let i = 0; i < 5; i++) {
    const body = await encrypt(toB64u(ua.getPublicKey()), toB64u(auth), msg);
    assert.equal(decrypt(Buffer.from(body), ua.getPrivateKey(), ua.getPublicKey(), auth), msg);
  }
});

test('VAPID: 푸시 서비스 주소(origin)로 12시간짜리 ES256 서명, 공개키로 확인된다', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = toB64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
  const now = Date.UTC(2026, 9, 25, 3, 0, 0);
  const h = await vapidHeader(await vapidKey(pub, jwk.d), pub, 'https://web.push.apple.com/QGuQyavXutnMH-abc', 'https://peanutlover.github.io/routine/', now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(m[2], 'base64url')), { aud: 'https://web.push.apple.com', exp: now / 1000 + 12 * 3600, sub: 'https://peanutlover.github.io/routine/' });
  assert.equal(m[4], pub);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
});
