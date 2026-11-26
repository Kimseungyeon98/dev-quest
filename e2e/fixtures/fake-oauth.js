// 브라우저 테스트용 가짜 OAuth2 로그인 서비스 (구글·깃허브 대신). playwright.config.js 의 webServer 가 띄워요.
//   /authorize  로그인 화면: 아이디(subject)·이메일·이름을 입력하고 [로그인] → 돌아갈 주소로 code 를 붙여 보내요
//   /token      code → access token,  /userinfo  token → 사용자 정보
const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.FAKE_OAUTH_PORT || 9099);
const codes = new Map();
let seq = 0;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });
}
function json(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if (url.pathname === '/authorize' && req.method === 'GET') {
    const p = url.searchParams;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Fake 로그인</title>
      <h1>Fake 로그인</h1>
      <form method="post" action="/authorize">
        <input type="hidden" name="redirect_uri" value="${esc(p.get('redirect_uri'))}">
        <input type="hidden" name="state" value="${esc(p.get('state'))}">
        <label>아이디 <input name="sub" id="sub"></label>
        <label>이메일 <input name="email" id="email"></label>
        <label>이름 <input name="name" id="name"></label>
        <button id="login">로그인</button>
      </form>`);
  }
  if (url.pathname === '/authorize' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req));
    const code = `c${++seq}`;
    codes.set(code, { id: f.get('sub'), email: f.get('email') || undefined, name: f.get('name') || undefined });
    res.writeHead(302, { Location: `${f.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(f.get('state'))}` });
    return res.end();
  }
  if (url.pathname === '/token') {
    const f = new URLSearchParams(await readBody(req));
    return codes.has(f.get('code')) ? json(res, 200, { access_token: 't-' + f.get('code'), token_type: 'Bearer', expires_in: 3600 }) : json(res, 400, { error: 'invalid_grant' });
  }
  if (url.pathname === '/userinfo') {
    const u = codes.get(String(req.headers.authorization || '').replace('Bearer t-', ''));
    return u ? json(res, 200, u) : json(res, 401, { error: 'invalid_token' });
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`fake oauth on ${PORT}`));
