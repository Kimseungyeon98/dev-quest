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

  /* mode: 'login' | 'signup' | 'recover'(비밀번호 재설정) */
  function setMode(m) {
    mode = m;
    const signup = m === 'signup', recover = m === 'recover';
    document.querySelector('.tabs').hidden = recover;
    $('recoverHead').hidden = !recover;
    $('tabLogin').setAttribute('aria-selected', String(m === 'login'));
    $('tabSignup').setAttribute('aria-selected', String(signup));
    $('usernameHint').hidden = !signup;
    $('recoverRow').hidden = !recover;
    $('passwordLabel').textContent = recover ? '새 비밀번호' : '비밀번호';
    $('passwordHint').hidden = !(signup || recover);
    $('confirmRow').hidden = !(signup || recover);
    $('password').autocomplete = signup || recover ? 'new-password' : 'current-password';
    $('submit').textContent = signup ? '가입하고 시작하기' : recover ? '새 비밀번호로 바꾸기' : '로그인';
    $('forgotBtn').hidden = recover;
    $('backBtn').hidden = !recover;
    $('noCodeHint').hidden = !recover;
    document.title = (signup ? '회원가입' : recover ? '비밀번호 재설정' : '로그인') + ' — Dev Quest';
    showError('');
    $('username').focus();
  }

  function showError(msg, field) {
    $('error').textContent = msg;
    ['username', 'recoveryCode', 'password', 'password2'].forEach((id) => $(id).removeAttribute('aria-invalid'));
    if (field && $(field)) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
  }

  /* 서버와 같은 규칙으로 먼저 확인해요 (서버도 다시 확인해요) */
  function validate(username, password) {
    if (!username) return ['아이디를 입력해 주세요.', 'username'];
    if (!password) return ['비밀번호를 입력해 주세요.', 'password'];
    if (mode === 'recover' && !$('recoveryCode').value.trim()) return ['복구 코드를 입력해 주세요.', 'recoveryCode'];
    if (mode === 'signup' || mode === 'recover') {
      if (mode === 'signup' && !USERNAME_RE.test(username)) return ['아이디는 영문·숫자·_ 4~20자예요.', 'username'];
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
    const rememberMe = $('rememberMe').checked;
    const r = mode === 'recover'
      ? await DQ.api('/api/auth/recover', { method: 'POST', body: { username, recoveryCode: $('recoveryCode').value, newPassword: password, rememberMe } })
      : await DQ.api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: { username, password, rememberMe } });
    if (r.ok) {
      // 가입·재설정하면 새 복구 코드를 한 번만 보여 주고 넘어가요
      if (r.data && r.data.recoveryCode) {
        DQ.showRecoveryCode(r.data.recoveryCode, {
          username: r.data.username,
          title: mode === 'recover' ? '비밀번호를 바꿨어요 — 새 복구 코드를 저장해 두세요' : '가입 완료! 복구 코드를 저장해 두세요',
          doneLabel: '시작하기',
          onDone: () => location.replace(nextUrl()),
        });
        return;
      }
      location.replace(nextUrl());
      return;
    }
    $('submit').disabled = false;
    const msg = (r.data && r.data.error) || (r.status === 403 ? '보안 토큰이 만료됐어요. 페이지를 새로고침해 주세요.' : '잠시 후 다시 시도해 주세요.');
    showError(msg, r.data && r.data.field);
    if (mode === 'login' && r.status === 401) { $('password').value = ''; $('password').focus(); }
    if (mode === 'recover' && r.status === 401) { $('recoveryCode').focus(); }
  }

  $('tabLogin').addEventListener('click', () => setMode('login'));
  $('tabSignup').addEventListener('click', () => setMode('signup'));
  $('forgotBtn').addEventListener('click', () => setMode('recover'));
  $('backBtn').addEventListener('click', () => setMode('login'));
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { setMode(mode === 'login' ? 'signup' : 'login'); $(mode === 'login' ? 'tabLogin' : 'tabSignup').focus(); }
  });
  $('form').addEventListener('submit', submit);

  // 이미 로그인돼 있으면(자동 로그인 포함) 바로 돌아가요
  DQ.api('/api/me').then((r) => { if (r.ok) location.replace(nextUrl()); });
  // 주소의 #signup / #recover 로 바로 그 화면을 열어요 (같은 페이지에서 #만 바뀌어도)
  function modeFromHash() {
    if (location.hash === '#signup') setMode('signup');
    else if (location.hash === '#recover') setMode('recover');
    else if (mode !== 'login') setMode('login');
  }
  window.addEventListener('hashchange', modeFromHash);
  if (new URLSearchParams(location.search).get('bye')) {
    DQ.notice('탈퇴했어요. 그동안 Dev Quest 를 이용해 주셔서 고마워요.');
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 무시 */ }
  }
  if (location.hash) modeFromHash(); else $('username').focus();
})();
