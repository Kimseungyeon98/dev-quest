/* 저장소를 로컬 웹 서버로 열어요: node algo/tools/serve.js [포트]  →  http://localhost:8000/
 * Algorithm Quest 의 Java 실행기(CheerpJ)는 file:// 주소에서 동작하지 않아서 웹 서버가 필요해요. (다른 과목은 파일로 열어도 돼요)
 * 기본으로 이 컴퓨터(127.0.0.1)에서만 열려요. 같은 네트워크의 다른 기기에서 열려면 HOST=0.0.0.0 을 주세요. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const port = Number(process.argv[2] || process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/* 요청 경로 → 저장소 안의 실제 파일 경로. 저장소 밖이거나 잘못된 주소면 null */
function resolveFile(url) {
  let rel;
  try { rel = decodeURIComponent(url.split('?')[0].split('#')[0]); } catch (e) { return null; } // 잘못된 %인코딩
  if (rel.includes('\0')) return null;
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  const inside = path.relative(root, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return file;
}

http.createServer((req, res) => {
  let file = resolveFile(req.url);
  if (!file) { send(res, 400, 'Bad request'); return; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) { send(res, 404, 'Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
}).listen(port, host, () => console.log(`Dev Quest: http://localhost:${port}/` + (host === '127.0.0.1' ? '' : `  (${host} 에서 열림)`)));
