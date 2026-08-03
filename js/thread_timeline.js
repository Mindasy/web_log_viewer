// thread_timeline.js - 线程时间线可视化（泳道图）

const ThreadTimeline = {
  canvas: null, ctx: null, tooltip: null,
  _dpr: 1, _rafId: 0, _mode: 'thread',

  entries: [], pid: '',
  threads: [], _threadNames: [], _visibleThreads: [],
  _hoveredThreadIdx: -1,

  zoomLevel: 1, offsetX: 0,
  minTime: 0, maxTime: 0, timeRange: 1,

  dragging: false, dragStartX: 0, dragStartOffset: 0,
  hoveredEntry: null,

  MARGIN: { top: 40, bottom: 38, left: 0, right: 10 },
  LABEL_WIDTH: 160,
  SWIMLANE_H: 32,
  DOT_R: 3,

  PALETTE: [
    '#7aa2f7','#9ece6a','#e0af68','#bb9af7','#f7768e','#2ac3de',
    '#ff9e64','#73daca','#c0caf5','#a9b1d6','#565f89','#db4b4b',
  ],

  LEVEL_COLORS: {
    FATAL:'#eba0ac', ERROR:'#f38ba8', WARN:'#f9e2af',
    INFO:'#89dceb', DEBUG:'#94e2d5', TRACE:'#b4befe'
  },

  // ===== 初始化 =====

  init() {
    this.canvas = document.getElementById('timeline-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('timeline-tooltip');
    this._dpr = window.devicePixelRatio || 1;
    this._bindCanvasEvents();
    this._bindHeaderEvents();
  },

  // ===== 数据准备 =====

  show(pid, entries) {
    this.pid = pid;
    this.entries = entries.filter(e => e.date);
    this._refreshDpr();

    if (this.entries.length === 0) {
      this._drawEmpty('没有带时间戳的日志条目');
      return;
    }

    this._groupByThread();
    this._buildTimeRange();
    this._precomputePositions();
    this._filterThreads(document.getElementById('timeline-thread-search')?.value || '');
    this.fitToData();
  },

  _groupByThread() {
    const map = new Map();
    for (const e of this.entries) {
      const key = e.thread || e.tid || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    // 线程内按时间排序
    for (const arr of map.values()) {
      arr.sort((a, b) => a.date.getTime() - b.date.getTime());
    }
    this._threadNames = [...map.keys()].sort((a, b) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    this.threads = this._threadNames.map((name, i) => ({
      name,
      entries: map.get(name),
      color: this.PALETTE[i % this.PALETTE.length],
      _positions: null,
      _levels: null,
    }));
  },

  _buildTimeRange() {
    let minT = Infinity, maxT = -Infinity;
    for (const t of this.threads) {
      for (const e of t.entries) {
        const ts = e.date.getTime();
        if (ts < minT) minT = ts;
        if (ts > maxT) maxT = ts;
      }
    }
    this.minTime = minT;
    this.maxTime = maxT;
    this.timeRange = Math.max(1, maxT - minT);
  },

  _precomputePositions() {
    const plotW = this._getPlotWidth();
    if (plotW <= 0) return;
    const levelMap = { FATAL:0, ERROR:1, WARN:2, INFO:3, DEBUG:4, TRACE:5 };
    for (const thread of this.threads) {
      const count = thread.entries.length;
      const positions = new Float64Array(count);
      const levels = new Uint8Array(count);
      for (let j = 0; j < count; j++) {
        const e = thread.entries[j];
        const t = (e.date.getTime() - this.minTime) / this.timeRange;
        positions[j] = this.MARGIN.left + this.LABEL_WIDTH + t * plotW;
        levels[j] = levelMap[e.level] ?? 6;
      }
      thread._positions = positions;
      thread._levels = levels;
    }
    this._precomputedPlotW = plotW;
  },

  _filterThreads(searchText) {
    if (!searchText) {
      this._visibleThreads = [...this._threadNames];
    } else {
      const re = new RegExp(Utils.escapeRegex(searchText), 'i');
      this._visibleThreads = this._threadNames.filter(n => re.test(n));
    }
    this._hoveredThreadIdx = -1;
    this._draw();
  },

  // ===== 缩放/平移 =====

  fitToData() {
    this.zoomLevel = 1;
    this.offsetX = 0;
    this._draw();
  },

  zoomIn(mx) {
    const old = this.zoomLevel;
    this.zoomLevel = Math.min(old * 1.5, 80);
    this.offsetX = this.offsetX * (this.zoomLevel / old) + mx * (1 - this.zoomLevel / old);
    this._draw();
  },

  zoomOut(mx) {
    const old = this.zoomLevel;
    this.zoomLevel = Math.max(old / 1.5, 0.05);
    this.offsetX = this.offsetX * (this.zoomLevel / old) + mx * (1 - this.zoomLevel / old);
    this._draw();
  },

  // ===== Canvas 事件 =====

  _bindCanvasEvents() {
    this.canvas.addEventListener('mousedown', e => this._onMD(e));
    this.canvas.addEventListener('mousemove', e => this._onMM(e));
    this.canvas.addEventListener('mouseup', () => { this.dragging = false; });
    this.canvas.addEventListener('mouseleave', () => {
      this.dragging = false;
      this._hoveredThreadIdx = -1;
      this.tooltip.style.display = 'none';
      this._draw();
    });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const mx = e.clientX - this.canvas.getBoundingClientRect().left;
      e.deltaY < 0 ? this.zoomIn(mx) : this.zoomOut(mx);
    });
    this.canvas.addEventListener('click', e => {
      if (this.hoveredEntry) {
        LogGrid.scrollToEntry(this.hoveredEntry);
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const ti = this._getThreadIdx(y);
      if (ti >= 0 && x <= this.LABEL_WIDTH) {
        const name = this._visibleThreads[ti];
        if (name && name !== 'unknown') {
          LogFilter.state.threadFilter = Utils.escapeRegex(name);
          App.refresh();
        }
      }
    });
    document.getElementById('btn-timeline-zoom-in').addEventListener('click',
      () => this.zoomIn(this.canvas.width / this._dpr / 2));
    document.getElementById('btn-timeline-zoom-out').addEventListener('click',
      () => this.zoomOut(this.canvas.width / this._dpr / 2));
    document.getElementById('btn-timeline-fit').addEventListener('click',
      () => this.fitToData());
  },

  _onMD(e) { this.dragging = true; this.dragStartX = e.clientX; this.dragStartOffset = this.offsetX; },

  _onMM(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    if (this.dragging) {
      this.offsetX = this.dragStartOffset + (e.clientX - this.dragStartX);
      this._draw();
      return;
    }

    const ti = this._getThreadIdx(y);
    const prevHovered = this._hoveredThreadIdx;
    this._hoveredThreadIdx = (ti >= 0) ? ti : -1;

    const entry = this._findEntryAt(x, y);
    this.hoveredEntry = entry;

    if (entry) {
      this.canvas.style.cursor = 'pointer';
      const lc = this.LEVEL_COLORS[entry.level] || '#a6adc8';
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = (e.clientX + 15) + 'px';
      this.tooltip.style.top = (e.clientY - 10) + 'px';
      this.tooltip.innerHTML =
        `<div style="font-weight:600;color:${lc};font-size:12px">${entry.level||'N/A'}</div>
        <div style="font-size:11px;color:#a6adc8">${esc(entry.thread||entry.tid||'-')}</div>
        <div style="font-size:11px">${Utils.formatDate(entry.date)}</div>
        <div style="font-size:11px;color:#6c7086">行 #${entry.index+1}</div>
        <div style="max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${esc(entry.message||entry.raw)}</div>`;
    } else {
      this.canvas.style.cursor = ti >= 0 && x <= this.LABEL_WIDTH ? 'pointer' : 'crosshair';
      this.tooltip.style.display = 'none';
    }

    // 只在 hover 线程变化时重绘
    if (prevHovered !== this._hoveredThreadIdx) this._draw();
  },

  _getThreadIdx(y) {
    const idx = Math.floor((y - this.MARGIN.top) / this.SWIMLANE_H);
    return (idx >= 0 && idx < this._visibleThreads.length) ? idx : -1;
  },

  _findEntryAt(x, y) {
    const ti = this._getThreadIdx(y);
    if (ti < 0) return null;
    const thread = this.threads.find(t => t.name === this._visibleThreads[ti]);
    if (!thread || !thread._positions) return null;
    const pos = thread._positions;
    const hr = Math.max(6, 10 / this.zoomLevel);
    const px = (x - this.offsetX) / this.zoomLevel;
    // 二分查找
    const n = pos.length;
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pos[mid] < px - hr) lo = mid + 1;
      else if (pos[mid] > px + hr) hi = mid - 1;
      else {
        let best = mid, bestDist = Math.abs(pos[mid] - px);
        for (let k = mid - 1; k >= 0 && pos[k] >= px - hr; k--) {
          const d = Math.abs(pos[k] - px);
          if (d < bestDist) { bestDist = d; best = k; }
        }
        for (let k = mid + 1; k < n && pos[k] <= px + hr; k++) {
          const d = Math.abs(pos[k] - px);
          if (d < bestDist) { bestDist = d; best = k; }
        }
        if (bestDist < hr + 4) return thread.entries[best];
        break;
      }
    }
    return null;
  },

  // ===== 绘制 =====

  _refreshDpr() {
    const r = this.canvas.getBoundingClientRect();
    const nw = Math.round(r.width * this._dpr);
    const nh = Math.round(r.height * this._dpr);
    if (this.canvas.width !== nw || this.canvas.height !== nh) {
      this.canvas.width = nw;
      this.canvas.height = nh;
    }
  },

  _getPlotWidth() {
    const cw = this.canvas.width / this._dpr;
    return cw - this.MARGIN.left - this.MARGIN.right - this.LABEL_WIDTH;
  },

  _draw() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => { this._rafId = 0; this._drawNow(); });
  },

  _drawEmpty(msg) {
    const dpr = this._dpr, cw = this.canvas.width / dpr, ch = this.canvas.height / dpr;
    const ctx = this.ctx;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#11121a'; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#6c7086'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(msg, cw / 2, ch / 2);
    ctx.restore();
  },

  _drawNow() {
    this._refreshDpr();
    const ctx = this.ctx, dpr = this._dpr;
    const cw = this.canvas.width / dpr, ch = this.canvas.height / dpr;

    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // 背景
    ctx.fillStyle = '#11121a'; ctx.fillRect(0, 0, cw, ch);

    if (this._visibleThreads.length === 0) {
      ctx.fillStyle = '#6c7086'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('没有匹配的线程', cw / 2, ch / 2);
      ctx.restore(); return;
    }

    const plotW = this._getPlotWidth();
    if (plotW <= 0) { ctx.restore(); return; }

    if (this._precomputedPlotW !== plotW) this._precomputePositions();

    this._drawGrid(ctx, cw, ch, plotW);
    this._drawSummary(ctx, cw, plotW);

    for (let i = 0; i < this._visibleThreads.length; i++) {
      this._drawSwimlane(ctx, i, cw, plotW);
    }

    this._drawTimeAxis(ctx, cw, ch, plotW);
    ctx.restore();
  },

  // 摘要栏：显示时间范围、总条目数、线程数
  _drawSummary(ctx, cw, plotW) {
    const y = 8;
    ctx.fillStyle = '#a6adc8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    const rangeMs = this.timeRange;
    let rangeStr;
    if (rangeMs < 1000) rangeStr = rangeMs + 'ms';
    else if (rangeMs < 60000) rangeStr = (rangeMs / 1000).toFixed(1) + 's';
    else if (rangeMs < 3600000) rangeStr = (rangeMs / 60000).toFixed(1) + 'min';
    else rangeStr = (rangeMs / 3600000).toFixed(1) + 'h';
    const totalEntries = this.threads.reduce((s, t) => s + t.entries.length, 0);
    ctx.fillText(
      `${this._threadNames.length} 线程 · ${totalEntries.toLocaleString()} 条日志 · ${rangeStr}`,
      labelEnd + 8, y + 12);
  },

  _drawGrid(ctx, cw, ch, plotW) {
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    const plotX2 = cw - this.MARGIN.right;

    // 标签区域背景
    ctx.fillStyle = '#161822'; ctx.fillRect(0, 0, labelEnd, ch);
    ctx.strokeStyle = '#252636'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(labelEnd, 0); ctx.lineTo(labelEnd, ch); ctx.stroke();

    // 垂直时间网格线
    const tickCount = Math.max(2, Math.floor(8 / this.zoomLevel));
    ctx.strokeStyle = '#1e2030'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= tickCount; i++) {
      const t = this.minTime + (this.timeRange / tickCount) * i;
      const px = labelEnd + ((t - this.minTime) / this.timeRange) * plotW * this.zoomLevel + this.offsetX;
      if (px >= labelEnd && px <= plotX2) {
        ctx.beginPath(); ctx.moveTo(px, this.MARGIN.top); ctx.lineTo(px, ch - this.MARGIN.bottom); ctx.stroke();
      }
    }

    // 交替泳道背景 + 分隔线
    for (let i = 0; i < this._visibleThreads.length; i++) {
      const y = this.MARGIN.top + i * this.SWIMLANE_H;
      if (i % 2 === 0) {
        ctx.fillStyle = '#141520'; ctx.fillRect(labelEnd, y, plotX2 - labelEnd, this.SWIMLANE_H);
      }
      ctx.strokeStyle = '#1e2030'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(labelEnd, y + this.SWIMLANE_H); ctx.lineTo(plotX2, y + this.SWIMLANE_H); ctx.stroke();
    }
  },

  _drawSwimlane(ctx, idx, cw, plotW) {
    const threadName = this._visibleThreads[idx];
    const thread = this.threads.find(t => t.name === threadName);
    if (!thread) return;

    const y = this.MARGIN.top + idx * this.SWIMLANE_H;
    const cy = y + this.SWIMLANE_H / 2;
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    const plotX2 = cw - this.MARGIN.right;
    const isHovered = idx === this._hoveredThreadIdx;

    // hover 高亮背景
    if (isHovered) {
      ctx.fillStyle = 'rgba(122,162,247,0.08)';
      ctx.fillRect(labelEnd, y, plotX2 - labelEnd, this.SWIMLANE_H);
      ctx.fillStyle = 'rgba(122,162,247,0.06)';
      ctx.fillRect(0, y, labelEnd, this.SWIMLANE_H);
    }

    // 线程标签
    ctx.fillStyle = isHovered ? '#fff' : thread.color;
    ctx.font = `bold 11px monospace`;
    ctx.textAlign = 'right';
    const dn = threadName.length > 20 ? threadName.slice(0, 19) + '…' : threadName;
    ctx.fillText(dn, labelEnd - 8, cy + 4);

    // 计数
    ctx.fillStyle = isHovered ? '#a6adc8' : '#565f89';
    ctx.font = '9px sans-serif';
    ctx.fillText(String(thread.entries.length), labelEnd - 8, cy - 8);

    if (!thread._positions) return;
    const pos = thread._positions, levels = thread._levels;
    const count = pos.length;
    const z = this.zoomLevel, ox = this.offsetX;

    // 密度模式（zoom < 0.3）
    if (z < 0.3) {
      this._drawDensity(ctx, pos, levels, count, cy, labelEnd, plotX2, z, ox);
      return;
    }

    // 逐点绘制 — 按颜色批量路径
    const buckets = {};
    for (let j = 0; j < count; j++) {
      const px = pos[j] * z + ox;
      if (px < labelEnd - 5 || px > plotX2 + 5) continue;
      const lvl = levels[j];
      const lvlName = ['FATAL','ERROR','WARN','INFO','DEBUG','TRACE'][lvl] || 'other';
      if (!buckets[lvlName]) buckets[lvlName] = [];
      buckets[lvlName].push(px);
    }

    const r = this.DOT_R;
    for (const [lvl, xs] of Object.entries(buckets)) {
      const color = this.LEVEL_COLORS[lvl] || '#a6adc8';
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < xs.length; k++) {
        ctx.moveTo(xs[k] + r, cy);
        ctx.arc(xs[k], cy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      if (lvl === 'ERROR' || lvl === 'FATAL') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let k = 0; k < xs.length; k++) {
          ctx.moveTo(xs[k] + r + 2, cy);
          ctx.arc(xs[k], cy, r + 2.5, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
    }
  },

  _drawDensity(ctx, pos, levels, count, cy, x1, x2, z, ox) {
    const colMap = {};
    for (let j = 0; j < count; j++) {
      const px = Math.round(pos[j] * z + ox);
      if (px < x1 || px > x2) continue;
      const key = px + ':' + levels[j];
      colMap[key] = (colMap[key] || 0) + 1;
    }
    const maxH = this.SWIMLANE_H * 0.8;
    let maxCount = 1;
    for (const v of Object.values(colMap)) { if (v > maxCount) maxCount = v; }

    for (const [key, cnt] of Object.entries(colMap)) {
      const [pxStr, lvlStr] = key.split(':');
      const px = parseInt(pxStr), lvl = parseInt(lvlStr);
      const h = Math.max(1, (cnt / maxCount) * maxH);
      const color = this.LEVEL_COLORS[['FATAL','ERROR','WARN','INFO','DEBUG','TRACE'][lvl]] || '#a6adc8';
      ctx.fillStyle = color;
      ctx.fillRect(px - 0.5, cy - h / 2, 1, h);
    }
  },

  _drawTimeAxis(ctx, cw, ch, plotW) {
    const axisY = ch - this.MARGIN.bottom + 8;
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    const plotX2 = cw - this.MARGIN.right;

    ctx.strokeStyle = '#45475a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(labelEnd, axisY); ctx.lineTo(plotX2, axisY); ctx.stroke();

    ctx.fillStyle = '#a6adc8'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    const tickCount = Math.max(2, Math.floor(8 / this.zoomLevel));
    const rangeMs = this.timeRange;
    let fmt;
    if (rangeMs < 60 * 1000) fmt = 'HH:mm:ss';
    else if (rangeMs < 24 * 3600 * 1000) fmt = 'HH:mm';
    else fmt = 'MM-dd HH:mm';

    for (let i = 0; i <= tickCount; i++) {
      const t = this.minTime + (this.timeRange / tickCount) * i;
      const px = labelEnd + ((t - this.minTime) / this.timeRange) * plotW * this.zoomLevel + this.offsetX;
      if (px >= labelEnd && px <= plotX2) {
        ctx.fillText(Utils.formatDate(new Date(t), fmt), px, axisY + 14);
        ctx.strokeStyle = '#45475a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, axisY - 2); ctx.lineTo(px, axisY + 4); ctx.stroke();
      }
    }
  },

  // ===== Header 事件 =====

  _bindHeaderEvents() {
    document.querySelectorAll('.timeline-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.timeline-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._mode = btn.dataset.mode;
        if (this._mode === 'level') Timeline.show(LogParser.entries);
        else this._refreshFromPidSelect();
      });
    });
    const pidSel = document.getElementById('timeline-pid-select');
    if (pidSel) pidSel.addEventListener('change', () => this._refreshFromPidSelect());
    const ts = document.getElementById('timeline-thread-search');
    if (ts) ts.addEventListener('input', Utils.debounce(() => this._filterThreads(ts.value), 200));
  },

  _refreshFromPidSelect() {
    const pid = document.getElementById('timeline-pid-select')?.value || '';
    const entries = pid ? LogParser.entries.filter(e => e.pid === pid) : LogParser.entries;
    this.show(pid, entries);
  },

  _collectPids() {
    const s = new Set();
    for (const e of LogParser.entries) { if (e.pid) s.add(e.pid); }
    return [...s].sort((a, b) => Number(a) - Number(b));
  },

  _populatePidSelect() {
    const sel = document.getElementById('timeline-pid-select');
    if (!sel) return;
    const pids = this._collectPids();
    let html = '<option value="">全部进程</option>';
    for (const p of pids) html += `<option value="${esc(p)}">PID: ${esc(p)}</option>`;
    sel.innerHTML = html;
    sel.disabled = pids.length === 0;
  },

  resize() {
    const panel = document.getElementById('timeline-panel');
    if (panel && panel.style.display !== 'none') {
      this._refreshDpr();
      this._precomputedPlotW = 0;
      if (this.entries.length > 0) this._draw();
    }
  }
};

// 全局 escape helper
function esc(s) {
  if (!s) return '';
  if (!esc._d) esc._d = document.createElement('div');
  esc._d.textContent = String(s);
  return esc._d.innerHTML;
}