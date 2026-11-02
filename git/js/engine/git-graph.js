/* git log --graph 의 ASCII 그래프 (git 의 graph.c 로직 이식) */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});

  const COLORS = ['\x1b[31m', '\x1b[32m', '\x1b[33m', '\x1b[34m', '\x1b[35m', '\x1b[36m', '\x1b[1;31m', '\x1b[1;32m', '\x1b[1;33m', '\x1b[1;34m', '\x1b[1;35m', '\x1b[1;36m'];
  const RESET = '\x1b[m';
  const ST = { PADDING: 0, SKIP: 1, PRE_COMMIT: 2, COMMIT: 3, POST_MERGE: 4, COLLAPSING: 5 };

  class Graph {
    constructor(opts) {
      opts = opts || {};
      this.useColor = !!opts.color;
      this.commit = null;
      this.parents = [];
      this.numParents = 0;
      this.width = 0;
      this.expansionRow = 0;
      this.state = ST.PADDING;
      this.prevState = ST.PADDING;
      this.commitIndex = 0;
      this.prevCommitIndex = 0;
      this.mergeLayout = 0;
      this.edgesAdded = 0;
      this.prevEdgesAdded = 0;
      this.columns = [];
      this.newColumns = [];
      this.mapping = [];
      this.oldMapping = [];
      this.mappingSize = 0;
      this.defaultColumnColor = COLORS.length - 1;
      this.lineBuf = '';
      this.lineWidth = 0;
    }

    /* ---- 줄 쓰기 헬퍼 ---- */
    col(column, ch) {
      if (this.useColor) this.lineBuf += COLORS[column.color] + ch + RESET; else this.lineBuf += ch;
      this.lineWidth++;
    }
    add(ch) { this.lineBuf += ch; this.lineWidth++; }
    addN(ch, n) { for (let i = 0; i < n; i++) this.add(ch); }
    startLine() { this.lineBuf = ''; this.lineWidth = 0; }
    padHorizontally() { if (this.lineWidth < this.width) this.addN(' ', this.width - this.lineWidth); }

    /* ---- 색 / 컬럼 ---- */
    incrementColor() { this.defaultColumnColor = (this.defaultColumnColor + 1) % COLORS.length; }
    currentColor() { return this.defaultColumnColor; }
    findCommitColor(c) {
      for (let i = 0; i < this.numColumns(); i++) if (this.columns[i].commit === c) return this.columns[i].color;
      return this.currentColor();
    }
    numColumns() { return this.columns.length; }
    findNewColumnByCommit(c) {
      for (let i = 0; i < this.newColumns.length; i++) if (this.newColumns[i].commit === c) return i;
      return -1;
    }

    updateState(s) { this.prevState = this.state; this.state = s; }

    /* 다음 커밋으로 상태 갱신 */
    update(commit, parents) {
      this.commit = commit;
      this.parents = parents;
      this.numParents = parents.length;
      this.prevCommitIndex = this.commitIndex;
      this.updateColumns();
      this.expansionRow = 0;
      if (this.state !== ST.PADDING) this.state = ST.SKIP;
      else if (this.numParents >= 3 && this.commitIndex < this.columns.length - 1) this.state = ST.PRE_COMMIT;
      else this.state = ST.COMMIT;
    }

    insertIntoNewColumns(commit, idx) {
      let i = this.findNewColumnByCommit(commit);
      if (i < 0) {
        i = this.newColumns.length;
        this.newColumns.push({ commit, color: this.findCommitColor(commit) });
      }
      let mappingIdx;
      if (this.numParents > 1 && idx > -1 && this.mergeLayout === -1) {
        const dist = idx - i;
        const shift = dist > 1 ? 2 * dist - 3 : 1;
        this.mergeLayout = dist > 0 ? 0 : 1;
        this.edgesAdded = this.numParents + this.mergeLayout - 2;
        mappingIdx = this.width + (this.mergeLayout - 1) * shift;
        this.width += 2 * this.mergeLayout;
      } else if (this.edgesAdded > 0 && i === this.mapping[this.width - 2]) {
        mappingIdx = this.width - 2;
        this.edgesAdded--;
      } else {
        mappingIdx = this.width;
        this.width += 2;
      }
      this.mapping[mappingIdx] = i;
    }

    updateColumns() {
      const tmp = this.columns;
      this.columns = this.newColumns;
      this.newColumns = [];
      void tmp;
      const numColumns = this.columns.length;
      const maxNew = numColumns + this.numParents;
      this.oldMapping = this.mapping;
      this.mapping = new Array(2 * maxNew).fill(-1);
      this.mappingSize = 2 * maxNew;
      this.width = 0;
      this.prevEdgesAdded = this.edgesAdded;
      this.edgesAdded = 0;
      let seenThis = false;
      let isCommitInColumns = true;
      for (let i = 0; i <= numColumns; i++) {
        let colCommit;
        if (i === numColumns) {
          if (seenThis) break;
          isCommitInColumns = false;
          colCommit = this.commit;
        } else colCommit = this.columns[i].commit;
        if (colCommit === this.commit) {
          seenThis = true;
          this.commitIndex = i;
          this.mergeLayout = -1;
          for (const p of this.parents) {
            if (this.numParents > 1 || !isCommitInColumns) this.incrementColor();
            this.insertIntoNewColumns(p, i);
          }
          if (this.numParents === 0) this.width += 2;
        } else {
          this.insertIntoNewColumns(colCommit, -1);
        }
      }
      while (this.mappingSize > 1 && this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
      void isCommitInColumns; // 너비는 insertIntoNewColumns 에서 누적된 값을 그대로 쓴다 (실제 git 과 동일한 결과)
    }

    updateWidth(isCommitInExisting) {
      let maxCols = this.columns.length + this.numParents;
      if (this.numParents < 1) maxCols++;
      if (isCommitInExisting) maxCols--;
      this.width = maxCols * 2;
    }

    isMappingCorrect() {
      for (let i = 0; i < this.mappingSize; i++) {
        const target = this.mapping[i];
        if (target < 0) continue;
        if (target === Math.floor(i / 2)) continue;
        return false;
      }
      return true;
    }

    needsPreCommitLine() {
      return this.numParents >= 3 && this.commitIndex < this.columns.length - 1 && this.expansionRow < (this.numParents - 2) * 2;
    }

    /* ---- 각 상태별 줄 출력 ---- */
    paddingLineOut() {
      for (let i = 0; i < this.newColumns.length; i++) { this.col(this.newColumns[i], '|'); this.add(' '); }
    }
    skipLineOut() {
      this.lineBuf += '...';
      this.lineWidth += 3;
      if (this.needsPreCommitLine()) this.updateState(ST.PRE_COMMIT); else this.updateState(ST.COMMIT);
    }
    preCommitLineOut() {
      let seenThis = false;
      const numExpansionRows = (this.numParents - 2) * 2;
      for (let i = 0; i < this.columns.length; i++) {
        const c = this.columns[i];
        if (c.commit === this.commit) {
          seenThis = true;
          this.col(c, '|');
          this.addN(' ', this.expansionRow);
        } else if (seenThis && this.expansionRow === 0) {
          if (this.prevState === ST.POST_MERGE && this.prevCommitIndex < i) this.col(c, '\\'); else this.col(c, '|');
        } else if (seenThis && this.expansionRow > 0) this.col(c, '\\');
        else this.col(c, '|');
        this.add(' ');
      }
      this.expansionRow++;
      if (this.expansionRow >= numExpansionRows) this.updateState(ST.COMMIT);
    }
    drawOctopusMerge() {
      const dashlessParents = 2;
      const dashfulParents = this.numParents - dashlessParents;
      const firstCol = this.commitIndex + dashlessParents - this.edgesAdded;
      for (let i = 0; i < dashfulParents; i++) {
        this.col(this.newColumns[i + firstCol], '-');
        this.col(this.newColumns[i + firstCol], i === dashfulParents - 1 ? '.' : '-');
      }
    }
    commitLineOut() {
      let seenThis = false;
      for (let i = 0; i <= this.columns.length; i++) {
        let colCommit;
        const c = this.columns[i];
        if (i === this.columns.length) {
          if (seenThis) break;
          colCommit = this.commit;
        } else colCommit = c.commit;
        if (colCommit === this.commit) {
          seenThis = true;
          this.add('*');
          if (this.numParents > 2) this.drawOctopusMerge();
        } else if (seenThis && this.edgesAdded > 1) this.col(c, '\\');
        else if (seenThis && this.edgesAdded === 1) {
          if (this.prevState === ST.POST_MERGE && this.prevEdgesAdded > 0 && this.prevCommitIndex < i) this.col(c, '\\');
          else this.col(c, '|');
        } else if (this.prevState === ST.COLLAPSING && this.oldMapping[2 * i + 1] === i && this.mapping[2 * i] < i) this.col(c, '/');
        else this.col(c, '|');
        this.add(' ');
      }
      if (this.numParents > 1) this.updateState(ST.POST_MERGE);
      else if (this.isMappingCorrect()) this.updateState(ST.PADDING);
      else this.updateState(ST.COLLAPSING);
    }
    postMergeLineOut() {
      let seenThis = false;
      const mergeChars = ['/', '|', '\\'];
      for (let i = 0; i <= this.columns.length; i++) {
        let colCommit;
        const c = this.columns[i];
        if (i === this.columns.length) {
          if (seenThis) break;
          colCommit = this.commit;
        } else colCommit = c.commit;
        if (colCommit === this.commit) {
          seenThis = true;
          let idx = this.mergeLayout;
          for (let pi = 0; pi < this.parents.length; pi++) {
            const parCol = this.findNewColumnByCommit(this.parents[pi]);
            const ch = mergeChars[idx];
            this.col(this.newColumns[parCol], ch);
            if (idx === 2) {
              if (this.edgesAdded > 0 || pi + 1 < this.parents.length) this.add(' ');
            } else idx++;
          }
        } else if (seenThis) {
          if (this.edgesAdded > 0) this.col(c, '\\'); else this.col(c, '|');
          this.add(' ');
        } else {
          this.col(c, '|');
          if (this.mergeLayout !== 0 || i !== this.commitIndex - 1) this.add(' ');
        }
      }
      if (this.isMappingCorrect()) this.updateState(ST.PADDING); else this.updateState(ST.COLLAPSING);
    }
    collapsingLineOut() {
      let usedHorizontal = false;
      let horizontalEdge = -1;
      let horizontalEdgeTarget = -1;
      const tmp = this.mapping;
      this.mapping = this.oldMapping.length >= 0 ? new Array(this.mappingSize).fill(-1) : tmp;
      this.oldMapping = tmp;
      for (let i = 0; i < this.mappingSize; i++) {
        const target = this.oldMapping[i];
        if (target === undefined || target < 0) continue;
        if (target * 2 === i) {
          this.mapping[i] = target;
        } else if (this.mapping[i - 1] === undefined || this.mapping[i - 1] < 0) {
          this.mapping[i - 1] = target;
          if (horizontalEdge === -1) {
            horizontalEdge = i;
            horizontalEdgeTarget = target;
            for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
          }
        } else if (this.mapping[i - 1] === target) {
          /* 같은 부모를 가리키는 선과 합쳐진다 */
        } else {
          this.mapping[i - 2] = target;
          if (horizontalEdge === -1) horizontalEdge = i;
        }
      }
      if (this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
      for (let i = 0; i < this.mappingSize; i++) {
        const target = this.mapping[i];
        if (target === undefined || target < 0) this.add(' ');
        else if (target * 2 === i) this.col(this.newColumns[target], '|');
        else if (target === horizontalEdgeTarget && i !== horizontalEdge - 1) {
          if (i !== target * 2 + 3) this.mapping[i] = -1;
          usedHorizontal = true;
          this.col(this.newColumns[target], '_');
        } else {
          if (usedHorizontal && i < horizontalEdge) this.mapping[i] = -1;
          this.col(this.newColumns[target], '/');
        }
      }
      if (this.isMappingCorrect()) this.updateState(ST.PADDING);
    }

    /* 다음 그래프 줄을 반환 { text, isCommitLine } */
    nextLine() {
      this.startLine();
      let shown = false;
      switch (this.state) {
        case ST.PADDING: this.paddingLineOut(); this.prevState = ST.PADDING; break;
        case ST.SKIP: this.skipLineOut(); break;
        case ST.PRE_COMMIT: this.preCommitLineOut(); break;
        case ST.COMMIT: this.commitLineOut(); shown = true; break;
        case ST.POST_MERGE: this.postMergeLineOut(); break;
        case ST.COLLAPSING: this.collapsingLineOut(); break;
        default: break;
      }
      this.padHorizontally();
      return { text: this.lineBuf, isCommitLine: shown };
    }
    /* 메시지 본문 줄 앞에 붙는 그래프 */
    paddingLine() {
      if (this.state !== ST.COMMIT) return this.nextLine().text;
      this.startLine();
      for (let i = 0; i < this.columns.length; i++) {
        const c = this.columns[i];
        this.col(c, '|');
        if (c.commit === this.commit && this.numParents > 2) this.addN(' ', (this.numParents - 2) * 2);
        else this.add(' ');
      }
      this.padHorizontally();
      return this.lineBuf;
    }
    isCommitFinished() { return this.state === ST.PADDING; }
  }

  G.Graph = Graph;
})();
