/* 로그인 · 회원가입 화면 */
(function () {
  'use strict';

  const DQ = window.DevQuest;
  const $ = (id) => document.getElementById(id);
  const USERNAME_RE = /^[A-Za-z0-9_]{4,20}$/;
  const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
  let mode = 'login';

  /* 로그인 뒤 돌아갈 주소. 다른 사이트로 보내지 않도록 같은 사이트의 경로만 받아요 */
  function nextUrl() {
    const n = new URLSearchParams(location.search).get('next') || '/';
    if (!n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\') || n.startsWith('/api/') || n.startsWith('/login')) return '/';
    return n;
  }

  function setMode(m) {
    mode = m;
    const signup = m === 'signup';
    $('tabLogin').setAttribute('aria-selected', String(!signup));
    $('tabSignup').setAttribute('aria-selected', String(signup));
    $('usernameHint').hidden = !signup;
    $('passwordHint').hidden = !signup;
    $('confirmRow').hidden = !signup;
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
    $('submit').textContent = signup ? '가입하고 시작하기' : '로그인';
    document.title = (signup ? '회원가입' : '로그인') + ' — Dev Quest';
    showError('');
    $('username').focus();
  }

  function showError(msg, field) {
    $('error').textContent = msg;
    ['username', 'password', 'password2'].forEach((id) => $(id).removeAttribute('aria-invalid'));
    if (field && $(field)) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
  }

  /* 서버와 같은 규칙으로 먼저 확인해요 (서버도 다시 확인해요) */
  function validate(username, password) {
    if (!username) return ['아이디를 입력해 주세요.', 'username'];
    if (!password) return ['비밀번호를 입력해 주세요.', 'password'];
    if (mode === 'signup') {
      if (!USERNAME_RE.test(username)) return ['아이디는 영문·숫자·_ 4~20자예요.', 'username'];
      if (!PASSWORD_RE.test(password)) return ['비밀번호는 8~64자이고, 영문과 숫자를 모두 넣어 주세요.', 'password'];
      if (password !== $('password2').value) return ['비밀번호 확인이 일치하지 않아요.', 'password2'];
    }
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const username = $('username').value.trim();
    const password = $('password').value;
    const bad = validate(username, password);
    if (bad) { showError(bad[0], bad[1]); return; }
    showError('');
    $('submit').disabled = true;
    const r = await DQ.api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
      method: 'POST', body: { username, password, rememberMe: $('rememberMe').checked },
    });
    if (r.ok) { location.replace(nextUrl()); return; }
    $('submit').disabled = false;
    const msg = (r.data && r.data.error) || (r.status === 403 ? '보안 토큰이 만료됐어요. 페이지를 새로고침해 주세요.' : '잠시 후 다시 시도해 주세요.');
    showError(msg, r.data && r.data.field);
    if (mode === 'login' && r.status === 401) { $('password').value = ''; $('password').focus(); }
  }

  $('tabLogin').addEventListener('click', () => setMode('login'));
  $('tabSignup').addEventListener('click', () => setMode('signup'));
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setMode(mode === 'login' ? 'signup' : 'login'); $(mode === 'login' ? 'tabLogin' : 'tabSignup').focus(); }
  });
  $('form').addEventListener('submit', submit);

  // 이미 로그인돼 있으면(자동 로그인 포함) 바로 돌아가요
  DQ.api('/api/me').then((r) => { if (r.ok) location.replace(nextUrl()); });
  if (location.hash === '#signup') setMode('signup'); else $('username').focus();
})();
