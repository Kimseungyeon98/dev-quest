/*
 * Dev Quest 서비스 워커: 잠든 서버가 깨어나는 동안에도 화면을 바로 보여 줘요.
 *
 * Railway Serverless 는 한동안 쓰지 않으면 서버를 재워요. 그 뒤 첫 요청은 서버가 깨어날 때까지 기다려야 해서
 * 화면이 하얗게 멈춰 있어요. 그래서 학습 사이트 파일(HTML·JS·CSS·이미지)을 이렇게 받아요:
 *  - 평소: 네트워크에서 받고(항상 최신) 받은 파일을 캐시에 넣어 둬요.
 *  - 서버가 늦으면(TIMEOUT 안에 답이 없으면): 캐시에 있던 파일로 화면을 먼저 보여 주고, 늦게 온 응답으로 캐시를 고쳐요.
 *    한 번 늦으면 잠시(SLEEPY_MS) 캐시를 먼저 써요 — 페이지가 파일을 여러 개 읽어도 파일마다 기다리지 않게요.
 *  - 화면이 뜨면 페이지(shared/dq.js)가 API 를 부르면서 "서버를 깨우는 중" 안내를 보여 줘요.
 * API(/api/)·헬스체크·다른 주소는 건드리지 않아요. 로그인 화면으로 넘기는 응답(리다이렉트)은 캐시하지 않아요.
 */
const CACHE = 'dq-site-v1';
const TIMEOUT = 3000;
const SLEEPY_MS = 30000;
let sleepyUntil = 0;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(api|actuator|logout)(\/|$)/.test(url.pathname) || url.pathname === '/sw.js') return;
  e.respondWith(networkFirst(e, req));
});

function cacheable(res) {
  return res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;
}

async function fromCache(req) {
  const cache = await caches.open(CACHE);
  // 페이지 주소는 ?next= 같은 쿼리가 달라도 같은 화면이에요
  return cache.match(req, { ignoreSearch: req.mode === 'navigate' });
}

async function networkFirst(e, req) {
  const network = fetch(req).then(async (res) => {
    if (res.status < 500) sleepyUntil = 0; // 서버가 깨어났어요
    if (cacheable(res)) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
    }
    return res;
  });
  network.catch(() => {}); // 아래에서 캐시로 답한 뒤에 실패해도 조용히

  const cached = await fromCache(req).catch(() => null);
  if (!cached) return network; // 처음 받는 파일은 기다릴 수밖에 없어요

  if (Date.now() < sleepyUntil) { e.waitUntil(network.catch(() => {})); return cached; }
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve('late'), TIMEOUT); });
  // 깨어나는 중인 서버 앞단이 502·503 을 줄 때도 캐시로 보여 줘요
  const first = await Promise.race([network.then((res) => (res.status >= 500 ? 'failed' : res), () => 'failed'), late]);
  clearTimeout(timer);
  if (first instanceof Response) return first;
  sleepyUntil = Date.now() + SLEEPY_MS;
  e.waitUntil(network.catch(() => {}));
  return cached;
}
