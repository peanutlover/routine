// 실행: node build.mjs                       → index.html (직접 호스팅·홈 화면 앱용)
//       node build.mjs --artifact <경로>     → Claude 아티팩트용 조각 HTML도 함께 만든다
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TITLE = '웨이트트레이닝 루틴';
const SHORT = '웨이트 루틴'; // 홈 화면 아이콘 이름
const FONTS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">',
].join('\n');

const app = [
  FONTS,
  `<style>\n${read('./src/style.css')}</style>`,
  read('./src/body.html'),
  `<script>\n${read('./src/logic.js')}\n${read('./src/app.js')}</script>`,
].join('\n');

const standalone = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="데드리프트·스쿼트 5% 증량과 디로딩, 상체 3·4·5회 진행을 자동으로 계산하는 주간 운동 루틴">
<meta name="theme-color" content="#edf0f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1114" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${SHORT}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<script>window.ROUTINE_STANDALONE = true;</script>
</head>
<body>
${app}
</body>
</html>
`;
writeFileSync(new URL('./index.html', import.meta.url), standalone);
console.log('index.html', standalone.length, 'bytes');

const i = process.argv.indexOf('--artifact');
if (i > 0 && process.argv[i + 1]) {
  const fragment = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<title>${TITLE}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${app}`;
  writeFileSync(process.argv[i + 1], fragment);
  console.log(process.argv[i + 1], fragment.length, 'bytes');
}
