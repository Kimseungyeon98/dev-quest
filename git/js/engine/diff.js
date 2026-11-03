/* 텍스트 diff / 3-way merge / diffstat — git(xdiff)과 최대한 같은 결과를 내도록 구현 */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});

  /* 줄 단위 분해: 각 줄은 개행 문자를 포함한다 (마지막 줄은 개행이 없을 수 있음) */
  function splitLines(text) {
    if (!text) return [];
    return text.match(/[^\n]*\n|[^\n]+$/g) || [];
  }

  /* ---------- Myers diff ---------- */
  function myersBlocks(A, B) {
    const N = A.length, M = B.length;
    if (N === 0 && M === 0) return [];
    if (N === 0) return [{ a0: 0, a1: 0, b0: 0, b1: M }];
    if (M === 0) return [{ a0: 0, a1: N, b0: 0, b1: 0 }];
    const max = N + M;
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
        else x = v[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= N && y >= M) { found = d; break; }
      }
    }
    const matches = [];
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const vv = trace[d];
      const k = x - y;
      let prevK;
      if (k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1])) prevK = k + 1; else prevK = k - 1;
      const prevX = vv[off + prevK];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { x--; y--; matches.push([x, y]); }
      x = prevX; y = prevY;
    }
    while (x > 0 && y > 0) { x--; y--; matches.push([x, y]); }
    matches.reverse();

    const blocks = [];
    let pa = 0, pb = 0;
    for (const [mx, my] of matches) {
      if (mx > pa || my > pb) blocks.push({ a0: pa, a1: mx, b0: pb, b1: my });
      pa = mx + 1; pb = my + 1;
    }
    if (pa < N || pb < M) blocks.push({ a0: pa, a1: N, b0: pb, b1: M });
    return blocks;
  }

  /* ---------- xdiff 의 xdl_change_compact 이식 (변경 덩어리 슬라이딩 + indent heuristic) ---------- */
  function getIndent(line) {
    let ret = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (!(c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v')) return ret;
      if (c === ' ') ret += 1;
      else if (c === '\t') ret += 8 - (ret % 8);
      if (ret >= 200) return 200;
    }
    return -1;
  }

  function measureSplit(x, split) {
    const m = { endOfFile: false, indent: -1, preBlank: 0, preIndent: -1, postBlank: 0, postIndent: -1 };
    if (split >= x.nrec) { m.endOfFile = true; m.indent = -1; }
    else { m.endOfFile = false; m.indent = getIndent(x.recs[split]); }
    for (let i = split - 1; i >= 0; i--) {
      m.preIndent = getIndent(x.recs[i]);
      if (m.preIndent !== -1) break;
      m.preBlank += 1;
      if (m.preBlank === 20) { m.preIndent = 0; break; }
    }
    for (let i = split + 1; i < x.nrec; i++) {
      m.postIndent = getIndent(x.recs[i]);
      if (m.postIndent !== -1) break;
      m.postBlank += 1;
      if (m.postBlank === 20) { m.postIndent = 0; break; }
    }
    return m;
  }

  function scoreAddSplit(m, s) {
    if (m.preIndent === -1 && m.preBlank === 0) s.penalty += 1;
    if (m.endOfFile) s.penalty += 21;
    const postBlank = (m.indent === -1) ? 1 + m.postBlank : 0;
    const totalBlank = m.preBlank + postBlank;
    s.penalty += -30 * totalBlank;
    s.penalty += 6 * postBlank;
    const indent = m.indent !== -1 ? m.indent : m.postIndent;
    const anyBlanks = totalBlank !== 0;
    s.effectiveIndent += indent;
    if (indent === -1) { /* no adjustment */ }
    else if (m.preIndent === -1) { /* no adjustment */ }
    else if (indent > m.preIndent) s.penalty += anyBlanks ? 10 : -4;
    else if (indent === m.preIndent) { /* no adjustment */ }
    else if (m.postIndent !== -1 && m.postIndent > indent) s.penalty += anyBlanks ? 17 : 24;
    else s.penalty += anyBlanks ? 17 : 23;
  }

  function scoreCmp(s1, s2) {
    const cmpIndents = (s1.effectiveIndent > s2.effectiveIndent) - (s1.effectiveIndent < s2.effectiveIndent);
    return 60 * cmpIndents + (s1.penalty - s2.penalty);
  }

  function groupInit(x, g) { g.start = g.end = 0; while (x.rchg[g.end + 1]) g.end++; }
  function groupNext(x, g) {
    if (g.end === x.nrec) return -1;
    g.start = g.end + 1;
    for (g.end = g.start; x.rchg[g.end + 1]; g.end++);
    return 0;
  }
  function groupPrevious(x, g) {
    if (g.start === 0) return -1;
    g.end = g.start - 1;
    for (g.start = g.end; x.rchg[g.start]; g.start--);
    return 0;
  }
  function groupSlideDown(x, g) {
    if (g.end < x.nrec && x.recs[g.start] === x.recs[g.end]) {
      x.rchg[g.start + 1] = 0; g.start++;
      x.rchg[g.end + 1] = 1; g.end++;
      while (x.rchg[g.end + 1]) g.end++;
      return 0;
    }
    return -1;
  }
  function groupSlideUp(x, g) {
    if (g.start > 0 && x.recs[g.start - 1] === x.recs[g.end - 1]) {
      g.start--; x.rchg[g.start + 1] = 1;
      g.end--; x.rchg[g.end + 1] = 0;
      while (x.rchg[g.start]) g.start--;
      return 0;
    }
    return -1;
  }

  function changeCompact(x, xo) {
    const g = { start: 0, end: 0 }, go = { start: 0, end: 0 };
    groupInit(x, g); groupInit(xo, go);
    for (;;) {
      if (g.end !== g.start) {
        let groupsize, earliestEnd, endMatchingOther;
        do {
          groupsize = g.end - g.start;
          endMatchingOther = -1;
          while (!groupSlideUp(x, g)) { if (groupPrevious(xo, go)) throw new Error('diff: group sync broken (up)'); }
          earliestEnd = g.end;
          if (go.end > go.start) endMatchingOther = g.end;
          for (;;) {
            if (groupSlideDown(x, g)) break;
            if (groupNext(xo, go)) throw new Error('diff: group sync broken (down)');
            if (go.end > go.start) endMatchingOther = g.end;
          }
        } while (groupsize !== g.end - g.start);

        if (g.end === earliestEnd) {
          /* no shifting was possible */
        } else if (endMatchingOther !== -1) {
          while (go.end === go.start) {
            if (groupSlideUp(x, g)) throw new Error('diff: match disappeared');
            if (groupPrevious(xo, go)) throw new Error('diff: group sync broken (match)');
          }
        } else {
          let shift = earliestEnd;
          if (g.end - groupsize - 1 > shift) shift = g.end - groupsize - 1;
          if (g.end - 100 > shift) shift = g.end - 100;
          let bestShift = -1, bestScore = null;
          for (; shift <= g.end; shift++) {
            const sc = { effectiveIndent: 0, penalty: 0 };
            scoreAddSplit(measureSplit(x, shift), sc);
            scoreAddSplit(measureSplit(x, shift - groupsize), sc);
            if (bestShift === -1 || scoreCmp(sc, bestScore) <= 0) { bestScore = sc; bestShift = shift; }
          }
          while (g.end > bestShift) {
            if (groupSlideUp(x, g)) throw new Error('diff: best shift unreached');
            if (groupPrevious(xo, go)) throw new Error('diff: group sync broken (best)');
          }
        }
      }
      if (groupNext(x, g)) break;
      if (groupNext(xo, go)) throw new Error('diff: group sync broken (next)');
    }
  }

  /* 변경 블록 목록: a[a0..a1) 이 b[b0..b1) 로 바뀜 */
  function diffBlocks(a, b) {
    const n = a.length, m = b.length;
    let pre = 0;
    while (pre < n && pre < m && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
    const inner = myersBlocks(a.slice(pre, n - suf), b.slice(pre, m - suf));
    if (inner.length === 0) return [];
    const xa = { recs: a, nrec: n, rchg: new Uint8Array(n + 2) };
    const xb = { recs: b, nrec: m, rchg: new Uint8Array(m + 2) };
    inner.forEach((bl) => {
      for (let i = bl.a0 + pre; i < bl.a1 + pre; i++) xa.rchg[i + 1] = 1;
      for (let j = bl.b0 + pre; j < bl.b1 + pre; j++) xb.rchg[j + 1] = 1;
    });
    changeCompact(xa, xb);
    changeCompact(xb, xa);
    const blocks = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if ((i < n && xa.rchg[i + 1]) || (j < m && xb.rchg[j + 1])) {
        const a0 = i, b0 = j;
        while (i < n && xa.rchg[i + 1]) i++;
        while (j < m && xb.rchg[j + 1]) j++;
        blocks.push({ a0, a1: i, b0, b1: j });
      } else { i++; j++; }
    }
    return blocks;
  }

  function countChanges(blocks) {
    let added = 0, deleted = 0;
    blocks.forEach((bl) => { deleted += bl.a1 - bl.a0; added += bl.b1 - bl.b0; });
    return { added, deleted };
  }

  /* ---------- unified diff ---------- */
  function funcLine(aLines, start, limit) {
    for (let l = start; l > limit && l >= 0; l--) {
      if (l >= aLines.length) continue;
      const line = aLines[l];
      if (/^[A-Za-z_$]/.test(line)) {
        let s = line.replace(/\n$/, '').replace(/\s+$/, '');
        if (s.length > 80) s = s.slice(0, 80);
        return s;
      }
    }
    return null;
  }

  function rangeStr(start, len) {
    // start: 1-based 시작 줄 (len==0 이면 직전 줄 번호)
    if (len === 1) return String(start);
    return `${start},${len}`;
  }

  /* 변경 블록들을 hunk 로 묶어 unified diff 본문(@@ ... 포함)을 만든다 */
  function unifiedBody(aLines, bLines, ctx = 3) {
    const blocks = diffBlocks(aLines, bLines);
    if (blocks.length === 0) return '';
    const out = [];
    let i = 0;
    let lastFunc = null;
    let funcLimit = -1;
    let delta = 0; // 이전 블록들로 인한 (b - a) 오프셋
    const deltaBefore = blocks.map((bl) => {
      const d = delta;
      delta += (bl.b1 - bl.b0) - (bl.a1 - bl.a0);
      return d;
    });
    while (i < blocks.length) {
      let j = i;
      while (j + 1 < blocks.length && blocks[j + 1].a0 - blocks[j].a1 <= 2 * ctx) j++;
      const first = blocks[i], last = blocks[j];
      const aStart = Math.max(first.a0 - ctx, 0);
      const aEnd = Math.min(last.a1 + ctx, aLines.length);
      const bStart = aStart + deltaBefore[i];
      const lines = [];
      let aCount = 0, bCount = 0;
      let cursor = aStart;
      for (let k = i; k <= j; k++) {
        const bl = blocks[k];
        for (; cursor < bl.a0; cursor++) { lines.push(' ' + aLines[cursor]); aCount++; bCount++; }
        for (let p = bl.a0; p < bl.a1; p++) { lines.push('-' + aLines[p]); aCount++; }
        for (let p = bl.b0; p < bl.b1; p++) { lines.push('+' + bLines[p]); bCount++; }
        cursor = bl.a1;
      }
      for (; cursor < aEnd; cursor++) { lines.push(' ' + aLines[cursor]); aCount++; bCount++; }
      const oldStart = aCount === 0 ? aStart : aStart + 1;
      const newStart = bCount === 0 ? bStart : bStart + 1;
      const fl = funcLine(aLines, aStart - 1, funcLimit);
      if (fl !== null) lastFunc = fl;
      funcLimit = aStart - 1;
      let header = `@@ -${rangeStr(oldStart, aCount)} +${rangeStr(newStart, bCount)} @@`;
      if (lastFunc) header += ' ' + lastFunc;
      out.push(header);
      lines.forEach((ln) => {
        if (ln.endsWith('\n')) out.push(ln.slice(0, -1));
        else { out.push(ln); out.push('\\ No newline at end of file'); }
      });
      i = j + 1;
    }
    return out.join('\n') + '\n';
  }

  /* ---------- 3-way merge ---------- */
  function ensureNl(lines) {
    return lines.map((l, idx) => (idx === lines.length - 1 && !l.endsWith('\n') ? l + '\n' : l));
  }

  function merge3(base, ours, theirs, labels) {
    const lo = (labels && labels.ours) || "HEAD";
    const lt = (labels && labels.theirs) || "theirs";
    const dO = diffBlocks(base, ours);
    const dT = diffBlocks(base, theirs);
    let i = 0, j = 0, pos = 0;
    const items = []; // {k:"keep"|"one"|"conf", lines | o,t}

    function applyBlocks(blocks, newLines, rs, re) {
      const res = [];
      let c = rs;
      blocks.forEach((bl) => {
        for (; c < bl.a0; c++) res.push(base[c]);
        for (let p = bl.b0; p < bl.b1; p++) res.push(newLines[p]);
        c = bl.a1;
      });
      for (; c < re; c++) res.push(base[c]);
      return res;
    }
    function keepTo(upto) {
      if (pos < upto) { items.push({ k: "keep", lines: base.slice(pos, upto) }); pos = upto; }
    }

    while (i < dO.length || j < dT.length) {
      const o = dO[i], t = dT[j];
      if (o && (!t || o.a1 < t.a0)) {
        keepTo(o.a0);
        items.push({ k: "one", lines: ours.slice(o.b0, o.b1) });
        pos = o.a1; i++;
        continue;
      }
      if (t && (!o || t.a1 < o.a0)) {
        keepTo(t.a0);
        items.push({ k: "one", lines: theirs.slice(t.b0, t.b1) });
        pos = t.a1; j++;
        continue;
      }
      const oBlocks = [o], tBlocks = [t];
      let rs = Math.min(o.a0, t.a0);
      let re = Math.max(o.a1, t.a1);
      i++; j++;
      let grew = true;
      while (grew) {
        grew = false;
        while (i < dO.length && dO[i].a0 <= re) { oBlocks.push(dO[i]); re = Math.max(re, dO[i].a1); i++; grew = true; }
        while (j < dT.length && dT[j].a0 <= re) { tBlocks.push(dT[j]); re = Math.max(re, dT[j].a1); j++; grew = true; }
      }
      keepTo(rs);
      const oRes = applyBlocks(oBlocks, ours, rs, re);
      const tRes = applyBlocks(tBlocks, theirs, rs, re);
      if (oRes.length === tRes.length && oRes.every((l, k) => l === tRes[k])) items.push({ k: "one", lines: oRes });
      else items.push({ k: "conf", o: oRes, t: tRes });
      pos = re;
    }
    keepTo(base.length);

    // 1) refine: 양쪽이 모두 비어있지 않은 충돌은 공통 줄을 충돌 밖으로 빼서 쪼갠다
    const refined = [];
    items.forEach((it) => {
      if (it.k !== "conf" || it.o.length === 0 || it.t.length === 0) { refined.push(it); return; }
      const blocks = diffBlocks(it.o, it.t);
      if (blocks.length === 0) { refined.push({ k: "one", lines: it.o }); return; }
      let prev = 0;
      blocks.forEach((bl) => {
        if (bl.a0 > prev) refined.push({ k: "keep", lines: it.o.slice(prev, bl.a0) });
        refined.push({ k: "conf", o: it.o.slice(bl.a0, bl.a1), t: it.t.slice(bl.b0, bl.b1) });
        prev = bl.a1;
      });
      if (prev < it.o.length) refined.push({ k: "keep", lines: it.o.slice(prev) });
    });
    // 인접한 keep 합치기
    const merged = [];
    refined.forEach((it) => {
      const last = merged[merged.length - 1];
      if (it.k === "keep" && last && last.k === "keep") last.lines = last.lines.concat(it.lines);
      else merged.push(it.k === "keep" ? { k: "keep", lines: it.lines.slice() } : it);
    });
    // 2) simplify: 충돌 사이 간격이 3줄 이하이면 하나로 합친다
    for (let x = 0; x + 2 < merged.length; ) {
      const a = merged[x], b = merged[x + 1], c = merged[x + 2];
      if (a.k === "conf" && b.k === "keep" && c.k === "conf" && b.lines.length <= 3) {
        merged.splice(x, 3, { k: "conf", o: a.o.concat(b.lines, c.o), t: a.t.concat(b.lines, c.t) });
      } else x++;
    }

    const out = [];
    let conflicts = 0;
    merged.forEach((it) => {
      if (it.k === "conf" && labels && labels.favor === "ours") { it.o.forEach((l) => out.push(l)); } else if (it.k === "conf" && labels && labels.favor === "theirs") { it.t.forEach((l) => out.push(l)); } else if (it.k === "conf") {
        out.push('<<<<<<< ' + lo + '\n');
        ensureNl(it.o).forEach((l) => out.push(l));
        out.push('=======\n');
        ensureNl(it.t).forEach((l) => out.push(l));
        out.push('>>>>>>> ' + lt + '\n');
        conflicts++;
      } else it.lines.forEach((l) => out.push(l));
    });
    return { lines: out, text: out.join(""), conflicts };
  }

  function mergeText(baseText, oursText, theirsText, labels) {
    return merge3(splitLines(baseText), splitLines(oursText), splitLines(theirsText), labels);
  }

  /* ---------- 유사도 (rename 감지) ---------- */
  function utf8Len(s) { return globalThis.GitEngine.sha1.utf8(s).length; }

  function similarityScore(aText, bText) {
    const MAX_SCORE = 60000;
    const sizeA = utf8Len(aText), sizeB = utf8Len(bText);
    const maxSize = Math.max(sizeA, sizeB);
    if (maxSize === 0) return MAX_SCORE;
    const map = new Map();
    splitLines(aText).forEach((l) => { const n = utf8Len(l); map.set(l, (map.get(l) || 0) + n); });
    let common = 0;
    const mapB = new Map();
    splitLines(bText).forEach((l) => { const n = utf8Len(l); mapB.set(l, (mapB.get(l) || 0) + n); });
    map.forEach((cntA, l) => { const cntB = mapB.get(l); if (cntB) common += Math.min(cntA, cntB); });
    return Math.floor(common * MAX_SCORE / maxSize);
  }

  /* ---------- diffstat ---------- */
  function decimalWidth(n) { return String(n).length; }
  function scaleLinear(it, width, maxChange) {
    if (!it) return 0;
    return 1 + Math.floor(it * (width - 1) / maxChange);
  }

  /* files: [{name, added, deleted, binary}] → git --stat 출력 문자열 */
  function formatStat(files, opts) {
    opts = opts || {};
    if (files.length === 0) return '';
    let width = opts.width || 80;
    let maxLen = 0, maxChange = 0, bins = 0;
    files.forEach((f) => {
      maxLen = Math.max(maxLen, f.name.length);
      if (!f.binary) maxChange = Math.max(maxChange, f.added + f.deleted);
    });
    let numberWidth = decimalWidth(maxChange);
    if (width < 16 + 6 + numberWidth) width = 16 + 6 + numberWidth;
    let graphWidth = maxChange + 4 > 0 ? maxChange : 0;
    const binWidth = 0;
    graphWidth = maxChange + 4 > binWidth ? maxChange : binWidth - 4;
    let nameWidth = maxLen;
    if (nameWidth + numberWidth + 6 + graphWidth > width) {
      if (graphWidth > Math.floor(width * 3 / 8) - numberWidth - 6) {
        graphWidth = Math.floor(width * 3 / 8) - numberWidth - 6;
        if (graphWidth < 6) graphWidth = 6;
      }
      if (nameWidth > width - numberWidth - 6 - graphWidth) nameWidth = width - numberWidth - 6 - graphWidth;
      else graphWidth = width - numberWidth - 6 - nameWidth;
    }
    const lines = [];
    let totAdd = 0, totDel = 0;
    files.forEach((f) => {
      let name = f.name;
      if (name.length > nameWidth) {
        // 앞부분을 "..." 로 줄이고 가능하면 '/' 경계에서 자른다
        const cut = name.length - (nameWidth - 3);
        name = name.slice(cut);
        const idx = name.indexOf('/');
        if (idx >= 0) name = name.slice(idx);
        name = '...' + name;
      }
      totAdd += f.added; totDel += f.deleted;
      if (f.binary) {
        lines.push(` ${name.padEnd(nameWidth)} | Bin`);
        return;
      }
      let add = f.added, del = f.deleted;
      if (graphWidth <= maxChange) {
        let total = scaleLinear(add + del, graphWidth, maxChange);
        if (total < 2 && add && del) total = 2;
        if (add < del) { add = scaleLinear(add, graphWidth, maxChange); del = total - add; }
        else { del = scaleLinear(del, graphWidth, maxChange); add = total - del; }
      }
      const num = String(f.added + f.deleted).padStart(numberWidth);
      lines.push(` ${name.padEnd(nameWidth)} | ${num}${(f.added + f.deleted) ? ' ' : ''}${'+'.repeat(add)}${'-'.repeat(del)}`);
    });
    lines.push(summaryLine(files.length, totAdd, totDel));
    return lines.join('\n') + '\n';
  }

  function summaryLine(nFiles, add, del) {
    let s = ` ${nFiles} file${nFiles === 1 ? '' : 's'} changed`;
    if (add || !del) s += `, ${add} insertion${add === 1 ? '' : 's'}(+)`;
    if (del || !add) s += `, ${del} deletion${del === 1 ? '' : 's'}(-)`;
    return s;
  }

  G.Diff = { splitLines, diffBlocks, countChanges, unifiedBody, merge3, mergeText, similarityScore, formatStat, summaryLine };
})();
