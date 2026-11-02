/* Dev Quest 공용 모듈: 난이도·XP·레벨·티어 계산과 과목 상단 바.
 * 모든 과목이 같은 규칙으로 점수를 계산해서 허브와 각 과목 화면이 항상 같은 값을 보여 줘요.
 *
 * 규칙
 *  - 난이도(초급/중급/고급)마다 XP 가중치가 달라요. (초급 100 · 중급 150 · 고급 250)
 *  - 레벨업에 필요한 XP 는 레벨이 오를수록 늘어나요.
 *  - 티어는 "전체 XP 가중치 대비 내가 얻은 XP 비율"로 정해요. */
(function () {
  'use strict';

  const DIFFICULTY = {
    easy: { label: '초급', stars: '★☆☆', xp: 100, cls: 'diff-easy' },
    medium: { label: '중급', stars: '★★☆', xp: 150, cls: 'diff-medium' },
    hard: { label: '고급', stars: '★★★', xp: 250, cls: 'diff-hard' },
  };
  const DIFF_KEYS = ['easy', 'medium', 'hard'];

  /* 'easy' | 'medium' | 'hard' 또는 숫자 난이도(1~5)를 3단계로 맞춘다 */
  function diffKey(d) {
    if (typeof d === 'number') return d <= 2 ? 'easy' : d === 3 ? 'medium' : 'hard';
    return DIFFICULTY[d] ? d : 'easy';
  }
  function diffMeta(d) { return DIFFICULTY[diffKey(d)]; }

  /* 레벨 L → L+1 에 필요한 XP */
  const needFor = (L) => 200 + 50 * L;
  function levelInfo(xp) {
    let level = 1, rest = xp;
    while (rest >= needFor(level)) { rest -= needFor(level); level++; }
    return { level, into: rest, need: needFor(level), total: xp };
  }

  const TIERS = [
    { id: 'seed', name: '새싹', icon: '🌱', min: 0, color: '#8b949e' },
    { id: 'bronze', name: '브론즈', icon: '🥉', min: 0.05, color: '#cd7f32' },
    { id: 'silver', name: '실버', icon: '🥈', min: 0.2, color: '#c0c7d0' },
    { id: 'gold', name: '골드', icon: '🥇', min: 0.4, color: '#e3b341' },
    { id: 'platinum', name: '플래티넘', icon: '💠', min: 0.6, color: '#56d4dd' },
    { id: 'diamond', name: '다이아', icon: '💎', min: 0.8, color: '#79c0ff' },
    { id: 'master', name: '마스터', icon: '👑', min: 0.97, color: '#f778ba' },
  ];
  function tierFor(ratio) {
    let idx = 0;
    TIERS.forEach((t, i) => { if (ratio >= t.min - 1e-9) idx = i; });
    return { tier: TIERS[idx], next: TIERS[idx + 1] || null, index: idx };
  }

  /* items: [{id, difficulty}], doneIds: 완료한 id 배열 */
  function stats(items, doneIds) {
    const done = new Set(doneIds || []);
    const by = { easy: { done: 0, total: 0 }, medium: { done: 0, total: 0 }, hard: { done: 0, total: 0 } };
    let xp = 0, maxXp = 0, doneCount = 0;
    items.forEach((it) => {
      const k = diffKey(it.difficulty);
      by[k].total++; maxXp += DIFFICULTY[k].xp;
      if (done.has(it.id)) { by[k].done++; xp += DIFFICULTY[k].xp; doneCount++; }
    });
    const ratio = maxXp ? xp / maxXp : 0;
    const t = tierFor(ratio);
    return {
      total: items.length, done: doneCount, xp, maxXp, ratio, by,
      level: levelInfo(xp), tier: t.tier, nextTier: t.next,
      toNext: t.next ? Math.max(0, Math.ceil(t.next.min * maxXp - xp)) : 0,
    };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* 과목 상단 바. 페이지에 <header id="dqbar"></header> 를 두고 호출해요.
   * data-dq-slot="lead" / "actions" 가 붙은 자식은 해당 자리로 옮겨 줘요. */
  function mountBar(courseId) {
    const host = document.getElementById('dqbar');
    const course = (window.DEV_QUEST_COURSES || []).find((c) => c.id === courseId) || { name: courseId, icon: '', tagline: '', accent: '#58a6ff' };
    const slots = {};
    Array.from(host.querySelectorAll('[data-dq-slot]')).forEach((n) => { (slots[n.dataset.dqSlot] = slots[n.dataset.dqSlot] || []).push(n); });
    host.className = 'dqbar';
    host.style.setProperty('--dq-accent', course.accent);
    document.documentElement.style.setProperty('--dq-accent', course.accent);
    host.innerHTML = `
      <div class="dq-lead"></div>
      <a class="dq-home" href="../index.html" title="Dev Quest 홈" aria-label="Dev Quest 홈으로">⌂</a>
      <div class="dq-brand"><span class="dq-ico">${esc(course.icon)}</span><span class="dq-name">${esc(course.name)}</span><small class="dq-tag">${esc(course.tagline)}</small></div>
      <div class="dq-actions"></div>
      <div class="dq-level">
        <span class="dq-tier"></span>
        <span class="dq-lv"></span>
        <div class="dq-xp"><i></i></div>
        <span class="dq-xptext"></span>
      </div>`;
    (slots.lead || []).forEach((n) => host.querySelector('.dq-lead').appendChild(n));
    (slots.actions || []).forEach((n) => host.querySelector('.dq-actions').appendChild(n));
    return {
      update(s) {
        const tier = host.querySelector('.dq-tier');
        tier.innerHTML = `${s.tier.icon}<span class="dq-tn"> ${esc(s.tier.name)}</span>`;
        tier.style.color = s.tier.color;
        host.querySelector('.dq-lv').textContent = `Lv.${s.level.level}`;
        host.querySelector('.dq-xp i').style.width = `${Math.round((s.level.into / s.level.need) * 100)}%`;
        host.querySelector('.dq-xptext').textContent = `${s.level.into} / ${s.level.need} XP`;
        host.querySelector('.dq-level').title = `${s.done} / ${s.total} 퀘스트 완료 · 총 ${s.xp} XP (전체 ${s.maxXp} XP 중 ${Math.round(s.ratio * 100)}%)`;
      },
    };
  }

  /* ---------- 퀘스트 목록 (사이드바) 공용 마크업 ----------
   * 세 과목이 똑같은 모양의 분류/항목을 쓰도록 HTML 조각을 만들어 줘요. 스타일은 dq.css 의 .dq-cat / .dq-item.
   * item: { id, title, icon?, difficulty?, done?, locked?, active? } */
  function itemHtml(it) {
    const d = it.difficulty != null ? diffMeta(it.difficulty) : null;
    return `<button type="button" class="dq-item${it.done ? ' done' : ''}${it.active ? ' active' : ''}${it.locked ? ' locked' : ''}" data-id="${esc(it.id)}"${it.locked ? ' aria-disabled="true"' : ''}>`
      + `<span class="dq-i-ico">${it.icon || (it.locked ? '🔒' : '▶')}</span><span class="dq-i-ti">${esc(it.title)}</span>`
      + (d ? `<span class="dq-i-lv ${d.cls}" title="난이도: ${d.label}">${d.stars}</span>` : '')
      + `<span class="dq-i-ck">${it.done ? '✓' : ''}</span></button>`;
  }
  /* cat: { id, icon, label, desc?, done, total }, bodyHtml: itemHtml 들을 이어 붙인 문자열 */
  function catHtml(cat, bodyHtml, open) {
    return `<details class="dq-cat" data-cat="${esc(cat.id)}"${open ? ' open' : ''}><summary><span>${esc(cat.icon)}</span><span>${esc(cat.label)}</span><span class="dq-cat-count">${cat.done}/${cat.total}</span></summary>`
      + (cat.desc ? `<div class="dq-cat-desc">${esc(cat.desc)}</div>` : '') + bodyHtml + '</details>';
  }

  window.DevQuest = { DIFFICULTY, DIFF_KEYS, diffKey, diffMeta, levelInfo, needFor, TIERS, tierFor, stats, mountBar, esc, itemHtml, catHtml };
})();
