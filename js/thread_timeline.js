// thread_timeline.js - 线程时间线可视化（泳道图 + 方法时间线）

const ThreadTimeline = {
  canvas: null, ctx: null, tooltip: null,
  _dpr: 1, _rafId: 0, _mode: 'thread',

  entries: [], pid: '',
  threads: [], _threadNames: [], _visibleThreads: [],
  _hoveredThreadIdx: -1,

  zoomLevel: 1, offsetX: 0, scrollY: 0,
  minTime: 0, maxTime: 0, timeRange: 1,

  dragging: false, dragStartX: 0, dragStartY: 0,
  dragStartOffset: 0, dragStartScrollY: 0,
  hoveredEntry: null,

  // 线程详情模式
  _detailThread: null,         // 当前查看详情的线程名
  _detailMethods: [],          // [{ name, entries, color }]
  _detailVisibleMethods: [],
  _detailMethodSearch: '',

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
    this._detailThread = null;
    this._detailMethods = [];
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
    const targets = this._detailThread ? this._detailMethods : this.threads;
    for (const target of targets) {
      const count = target.entries.length;
      const positions = new Float64Array(count);
      const levels = new Uint8Array(count);
      for (let j = 0; j < count; j++) {
        const e = target.entries[j];
        const t = (e.date.getTime() - this.minTime) / this.timeRange;
        positions[j] = this.MARGIN.left + this.LABEL_WIDTH + t * plotW;
        levels[j] = levelMap[e.level] ?? 6;
      }
      target._positions = positions;
      target._levels = levels;
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
    this._clampScrollY();
    this._draw();
  },

  // ===== 线程详情（方法时间线） =====

  openThreadDetail(threadName) {
    const thread = this.threads.find(t => t.name === threadName);
    if (!thread) return;
    this._detailThread = threadName;
    this._detailMethodSearch = '';
    // 清除之前的过滤条件，进入全新上下文
    LogFilter.state.sourceFilter = '';
    this._groupByMethod(thread.entries);
    this._clampScrollY();
    this._updateDetailHeader();
    this._draw();
  },

  closeThreadDetail() {
    this._detailThread = null;
    this._detailMethods = [];
    this._detailVisibleMethods = [];
    this.scrollY = 0;
    // 清除时间线触发的过滤条件，恢复 grid 显示全部数据
    LogFilter.state.threadFilter = '';
    LogFilter.state.sourceFilter = '';
    this._updateDetailHeader();
    this._draw();
    App.refresh();
  },

  _groupByMethod(entries) {
    const map = new Map();
    for (const e of entries) {
      const method = this._extractMethod(e);
      if (!map.has(method)) map.set(method, []);
      map.get(method).push(e);
    }
    const names = [...map.keys()].sort((a, b) => {
      if (a === '(unknown)') return 1;
      if (b === '(unknown)') return -1;
      return a.localeCompare(b);
    });
    this._detailMethods = names.map((name, i) => ({
      name,
      entries: map.get(name),
      color: this.PALETTE[i % this.PALETTE.length],
      _positions: null,
      _levels: null,
    }));
    // 预计算位置
    const plotW = this._getPlotWidth();
    if (plotW <= 0) return;
    const levelMap = { FATAL:0, ERROR:1, WARN:2, INFO:3, DEBUG:4, TRACE:5 };
    for (const m of this._detailMethods) {
      const count = m.entries.length;
      const positions = new Float64Array(count);
      const levels = new Uint8Array(count);
      for (let j = 0; j < count; j++) {
        const e = m.entries[j];
        const t = (e.date.getTime() - this.minTime) / this.timeRange;
        positions[j] = this.MARGIN.left + this.LABEL_WIDTH + t * plotW;
        levels[j] = levelMap[e.level] ?? 6;
      }
      m._positions = positions;
      m._levels = levels;
    }
    this._detailVisibleMethods = [...names];
  },

  _filterDetailMethods(searchText) {
    this._detailMethodSearch = searchText;
    if (!searchText) {
      this._detailVisibleMethods = this._detailMethods.map(m => m.name);
    } else {
      const re = new RegExp(Utils.escapeRegex(searchText), 'i');
      this._detailVisibleMethods = this._detailMethods
        .filter(m => re.test(m.name)).map(m => m.name);
    }
    this._clampScrollY();
    this._draw();
  },

  _extractMethod(entry) {
    const src = entry.source || '';
    if (!src) return '(unknown)';
    // file:func:linenum 格式，如 "com.example.Service:handle:42" 或 "test.cpp:testFunc:1000"
    if (src.includes(':')) {
      const parts = src.split(':');
      const filePart = parts[0] || '';
      const funcPart = parts[1] || '';
      let className;
      if (filePart.includes('/')) {
        // 文件路径格式如 "src/utils/helper.go" → 取文件名（不含扩展名）
        const pathParts = filePart.split('/');
        const fileName = pathParts[pathParts.length - 1];
        const dotIdx = fileName.lastIndexOf('.');
        className = dotIdx > 0 ? fileName.substring(0, dotIdx) : fileName;
      } else {
        const dotParts = filePart.split('.');
        if (dotParts.length === 2) {
          // 两段如 "test.cpp" → 取文件名（不含扩展名）
          className = dotParts[0];
        } else if (dotParts.length >= 3) {
          // 三段以上如 "com.example.Service" → 取最后一段（类名）
          className = dotParts[dotParts.length - 1];
        } else {
          className = filePart;
        }
      }
      if (funcPart) return className + '.' + funcPart;
      return className;
    }
    // 点号格式，如 "com.example.Service.methodName"
    const parts = src.split('.');
    if (parts.length >= 4) {
      // 4段以上：取最后两段作为 "类名.方法名"
      return parts.slice(-2).join('.');
    }
    // 3段以下：取最后一段（类名或简单名称）
    return parts[parts.length - 1];
  },

  _updateDetailHeader() {
    const backBtn = document.getElementById('btn-timeline-back');
    const detailLabel = document.getElementById('timeline-detail-label');
    const methodSearch = document.getElementById('timeline-method-search');
    if (backBtn) backBtn.style.display = this._detailThread ? 'inline-flex' : 'none';
    if (detailLabel) {
      detailLabel.style.display = this._detailThread ? 'inline' : 'none';
      detailLabel.textContent = this._detailThread ? `线程: ${this._detailThread}` : '';
    }
    if (methodSearch) methodSearch.style.display = this._detailThread ? 'inline-block' : 'none';
  },

  // ===== 缩放/平移 =====

  fitToData() {
    this.zoomLevel = 1;
    this.offsetX = 0;
    this.scrollY = 0;
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

  // ===== 垂直滚动 =====

  _getContentHeight() {
    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    return list.length * this.SWIMLANE_H;
  },

  _getViewportH() {
    const ch = this.canvas.height / this._dpr;
    return ch - this.MARGIN.top - this.MARGIN.bottom;
  },

  _clampScrollY() {
    const contentH = this._getContentHeight();
    const viewH = this._getViewportH();
    this.scrollY = Math.max(0, Math.min(this.scrollY, Math.max(0, contentH - viewH)));
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
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const contentH = this._getContentHeight();
      const viewH = this._getViewportH();
      const canScrollV = contentH > viewH;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + 滚轮 = 缩放
        e.deltaY < 0 ? this.zoomIn(mx) : this.zoomOut(mx);
      } else if (e.shiftKey) {
        // Shift + 滚轮 = 水平平移
        this.offsetX -= e.deltaY * 2;
        this._draw();
      } else if (canScrollV) {
        // 垂直滚动
        this.scrollY = Math.max(0, Math.min(this.scrollY + e.deltaY, contentH - viewH));
        this._draw();
      } else {
        // 无溢出时 = 缩放
        e.deltaY < 0 ? this.zoomIn(mx) : this.zoomOut(mx);
      }
    });
    this.canvas.addEventListener('click', e => {
      if (this.hoveredEntry) {
        LogGrid.scrollToEntry(this.hoveredEntry);
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;

      if (this._detailThread) {
        // 详情模式：点击方法标签 → 过滤
        const mi = this._getItemIdx(y);
        if (mi >= 0 && x <= this.LABEL_WIDTH) {
          const name = this._detailVisibleMethods[mi];
          if (name && name !== '(unknown)') {
            LogFilter.state.sourceFilter = Utils.escapeRegex(name);
            App.refresh();
          }
        }
        return;
      }

      // 线程模式：点击线程标签
      const ti = this._getItemIdx(y);
      if (ti >= 0 && x <= this.LABEL_WIDTH) {
        const name = this._visibleThreads[ti];
        if (name && name !== 'unknown') {
          if (e.detail === 2 || e.altKey) {
            // 双击或 Alt+点击 → 打开线程详情
            this.openThreadDetail(name);
          } else {
            LogFilter.state.threadFilter = Utils.escapeRegex(name);
            App.refresh();
          }
        }
      }
    });

    // 双击进入线程详情
    this.canvas.addEventListener('dblclick', e => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (this._detailThread) return;
      const ti = this._getItemIdx(y);
      if (ti >= 0 && x > this.LABEL_WIDTH) {
        const name = this._visibleThreads[ti];
        if (name && name !== 'unknown') {
          this.openThreadDetail(name);
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

  _onMD(e) {
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartOffset = this.offsetX;
    this.dragStartScrollY = this.scrollY;
  },

  _onMM(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    if (this.dragging) {
      this.offsetX = this.dragStartOffset + (e.clientX - this.dragStartX);
      const contentH = this._getContentHeight();
      const viewH = this._getViewportH();
      if (contentH > viewH) {
        this.scrollY = Math.max(0, Math.min(
          this.dragStartScrollY - (e.clientY - this.dragStartY),
          contentH - viewH));
      }
      this._draw();
      return;
    }

    const ti = this._getItemIdx(y);
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
      const method = this._detailThread ? this._extractMethod(entry) : '';
      this.tooltip.innerHTML =
        `<div style="font-weight:600;color:${lc};font-size:12px">${entry.level||'N/A'}</div>
        <div style="font-size:11px;color:#a6adc8">${esc(entry.thread||entry.tid||'-')}</div>
        ${method ? `<div style="font-size:11px;color:#89dceb">${esc(method)}</div>` : ''}
        <div style="font-size:11px">${Utils.formatDate(entry.date)}</div>
        <div style="font-size:11px;color:#6c7086">行 #${entry.index+1}</div>
        <div style="max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${esc(entry.message||entry.raw)}</div>`;
    } else {
      const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
      this.canvas.style.cursor = ti >= 0 && x <= this.LABEL_WIDTH ? 'pointer' : 'crosshair';
      this.tooltip.style.display = 'none';
    }

    if (prevHovered !== this._hoveredThreadIdx) this._draw();
  },

  _getItemIdx(y) {
    const adjustedY = y - this.MARGIN.top + this.scrollY;
    const idx = Math.floor(adjustedY / this.SWIMLANE_H);
    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    return (idx >= 0 && idx < list.length) ? idx : -1;
  },

  _findEntryAt(x, y) {
    const ti = this._getItemIdx(y);
    if (ti < 0) return null;
    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    const name = list[ti];
    const source = this._detailThread
      ? this._detailMethods.find(m => m.name === name)
      : this.threads.find(t => t.name === name);
    if (!source || !source._positions) return null;
    const pos = source._positions;
    const hr = Math.max(6, 10 / this.zoomLevel);
    const px = (x - this.offsetX) / this.zoomLevel;
    const n = pos.length;
    if (n === 0) return null;

    // 先尝试精确位置匹配
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
        if (bestDist < hr + 4) return source.entries[best];
        break;
      }
    }

    // 段块模式：鼠标在两条目之间（段块中间），找所在段
    // hi < lo 此时 hi = 最后一个 < px - hr 的索引, lo = 第一个 > px + hr 的索引
    if (hi >= 0 && lo < n) {
      // 鼠标在 pos[hi] 和 pos[lo] 之间，属于 pos[hi] 的段
      if (px > pos[hi] && px < pos[lo]) {
        return source.entries[hi];
      }
    }
    // 边缘情况：鼠标在最后一个位置之后
    if (hi === n - 1 && px > pos[hi] && px < pos[hi] + hr * 4) {
      return source.entries[hi];
    }
    // 边缘情况：鼠标在第一个位置之前
    if (lo === 0 && px < pos[0] && px > pos[0] - hr * 4) {
      return source.entries[0];
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
    ctx.fillStyle = '#11121a'; ctx.fillRect(0, 0, cw, ch);

    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    if (list.length === 0) {
      ctx.fillStyle = '#6c7086'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this._detailThread ? '没有匹配的方法' : '没有匹配的线程', cw / 2, ch / 2);
      ctx.restore(); return;
    }

    const plotW = this._getPlotWidth();
    if (plotW <= 0) { ctx.restore(); return; }
    if (this._precomputedPlotW !== plotW) this._precomputePositions();

    this._drawGrid(ctx, cw, ch, plotW);
    this._drawSummary(ctx, cw, plotW);

    // 视口裁剪：只绘制可见的泳道
    const viewTop = this.scrollY;
    const viewBottom = this.scrollY + this._getViewportH();
    const firstVisible = Math.floor(viewTop / this.SWIMLANE_H);
    const lastVisible = Math.min(list.length - 1,
      Math.ceil(viewBottom / this.SWIMLANE_H));

    for (let i = firstVisible; i <= lastVisible; i++) {
      const y = this.MARGIN.top + i * this.SWIMLANE_H - this.scrollY;
      if (y + this.SWIMLANE_H < this.MARGIN.top || y > ch - this.MARGIN.bottom) continue;
      this._drawItem(ctx, i, cw, plotW, y);
    }

    // 垂直滚动条
    this._drawScrollbar(ctx, cw, ch);

    this._drawTimeAxis(ctx, cw, ch, plotW);
    ctx.restore();
  },

  _drawSummary(ctx, cw, plotW) {
    const y = 8, labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    ctx.fillStyle = '#a6adc8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';

    const rangeMs = this.timeRange;
    let rangeStr;
    if (rangeMs < 1000) rangeStr = rangeMs + 'ms';
    else if (rangeMs < 60000) rangeStr = (rangeMs / 1000).toFixed(1) + 's';
    else if (rangeMs < 3600000) rangeStr = (rangeMs / 60000).toFixed(1) + 'min';
    else rangeStr = (rangeMs / 3600000).toFixed(1) + 'h';

    if (this._detailThread) {
      const total = this._detailMethods.reduce((s, m) => s + m.entries.length, 0);
      ctx.fillText(
        `${this._detailMethods.length} 方法 · ${total.toLocaleString()} 条日志 · ${rangeStr} · 线程: ${this._detailThread}`,
        labelEnd + 8, y + 12);
    } else {
      const total = this.threads.reduce((s, t) => s + t.entries.length, 0);
      ctx.fillText(
        `${this._threadNames.length} 线程 · ${total.toLocaleString()} 条日志 · ${rangeStr}`,
        labelEnd + 8, y + 12);
    }
  },

  _drawGrid(ctx, cw, ch, plotW) {
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    const plotX2 = cw - this.MARGIN.right;
    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;

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

    // 交替背景 + 分隔线（只绘制可见范围）
    const viewTop = this.scrollY;
    const viewBottom = this.scrollY + this._getViewportH();
    const firstV = Math.floor(viewTop / this.SWIMLANE_H);
    const lastV = Math.min(list.length - 1, Math.ceil(viewBottom / this.SWIMLANE_H));

    for (let i = firstV; i <= lastV; i++) {
      const y = this.MARGIN.top + i * this.SWIMLANE_H - this.scrollY;
      if (y + this.SWIMLANE_H < this.MARGIN.top || y > ch - this.MARGIN.bottom) continue;
      if (i % 2 === 0) {
        ctx.fillStyle = '#141520';
        ctx.fillRect(labelEnd, y, plotX2 - labelEnd, this.SWIMLANE_H);
      }
      ctx.strokeStyle = '#1e2030'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(labelEnd, y + this.SWIMLANE_H); ctx.lineTo(plotX2, y + this.SWIMLANE_H); ctx.stroke();
    }
  },

  _drawItem(ctx, idx, cw, plotW, y) {
    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    const name = list[idx];
    const source = this._detailThread
      ? this._detailMethods.find(m => m.name === name)
      : this.threads.find(t => t.name === name);
    if (!source) return;

    const cy = y + this.SWIMLANE_H / 2;
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    const plotX2 = cw - this.MARGIN.right;
    const isHovered = idx === this._hoveredThreadIdx;

    if (isHovered) {
      ctx.fillStyle = 'rgba(122,162,247,0.08)';
      ctx.fillRect(labelEnd, y, plotX2 - labelEnd, this.SWIMLANE_H);
      ctx.fillStyle = 'rgba(122,162,247,0.06)';
      ctx.fillRect(0, y, labelEnd, this.SWIMLANE_H);
    }

    // 标签
    ctx.fillStyle = isHovered ? '#fff' : source.color;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    const dn = name.length > 20 ? name.slice(0, 19) + '…' : name;
    ctx.fillText(dn, labelEnd - 8, cy + 4);

    ctx.fillStyle = isHovered ? '#a6adc8' : '#565f89';
    ctx.font = '9px sans-serif';
    ctx.fillText(String(source.entries.length), labelEnd - 8, cy - 8);

    if (!source._positions) return;
    const pos = source._positions, levels = source._levels;
    const count = pos.length;
    const z = this.zoomLevel, ox = this.offsetX;

    if (z < 0.3) {
      this._drawDensity(ctx, pos, levels, count, cy, labelEnd, plotX2, z, ox);
      return;
    }

    // 段块模式：相邻条目之间画彩色矩形，形成连续时间线
    const barH = this.SWIMLANE_H * 0.55;
    const barY = cy - barH / 2;
    const minW = Math.max(1, 1 / z * 0.3); // 最小宽度随缩放调整

    const buckets = {};
    for (let j = 0; j < count; j++) {
      const x1 = pos[j] * z + ox;
      if (x1 > plotX2 + 5) break;
      const x2 = Math.max(x1 + minW,
        (j + 1 < count) ? pos[j + 1] * z + ox : x1 + minW);
      if (x2 < labelEnd - 5) continue;
      const lvl = levels[j];
      const lvlName = ['FATAL','ERROR','WARN','INFO','DEBUG','TRACE'][lvl] || 'other';
      if (!buckets[lvlName]) buckets[lvlName] = [];
      buckets[lvlName].push(Math.max(x1, labelEnd), Math.min(x2, plotX2));
    }

    for (const [lvl, segs] of Object.entries(buckets)) {
      const color = this.LEVEL_COLORS[lvl] || '#a6adc8';
      // ERROR/FATAL 发光效果
      if (lvl === 'ERROR' || lvl === 'FATAL') {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;
        for (let k = 0; k < segs.length; k += 2) {
          ctx.fillRect(segs[k] - 1, barY - 1, segs[k + 1] - segs[k] + 2, barH + 2);
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = color;
      for (let k = 0; k < segs.length; k += 2) {
        ctx.fillRect(segs[k], barY, segs[k + 1] - segs[k], barH);
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

  _drawScrollbar(ctx, cw, ch) {
    const contentH = this._getContentHeight();
    const viewH = this._getViewportH();
    if (contentH <= viewH) return;

    const trackX = cw - 6;
    const trackH = viewH;
    const trackY = this.MARGIN.top;
    const thumbH = Math.max(20, (viewH / contentH) * trackH);
    const thumbY = trackY + (this.scrollY / contentH) * trackH;

    ctx.fillStyle = '#252636';
    ctx.fillRect(trackX, trackY, 4, trackH);
    ctx.fillStyle = '#45475a';
    ctx.fillRect(trackX, thumbY, 4, thumbH);
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
        this._detailThread = null;
        this._detailMethods = [];
        this._updateDetailHeader();
        if (this._mode === 'level') Timeline.show(LogParser.entries);
        else this._refreshFromPidSelect();
      });
    });
    const pidSel = document.getElementById('timeline-pid-select');
    if (pidSel) pidSel.addEventListener('change', () => this._refreshFromPidSelect());
    const ts = document.getElementById('timeline-thread-search');
    if (ts) ts.addEventListener('input', Utils.debounce(() => this._filterThreads(ts.value), 200));

    const backBtn = document.getElementById('btn-timeline-back');
    if (backBtn) backBtn.addEventListener('click', () => this.closeThreadDetail());

    const ms = document.getElementById('timeline-method-search');
    if (ms) ms.addEventListener('input', Utils.debounce(() => this._filterDetailMethods(ms.value), 200));
  },

  _refreshFromPidSelect() {
    this._detailThread = null;
    this._detailMethods = [];
    this._updateDetailHeader();
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
      this._clampScrollY();
      if (this.entries.length > 0) this._draw();
    }
  }
};

function esc(s) {
  if (!s) return '';
  if (!esc._d) esc._d = document.createElement('div');
  esc._d.textContent = String(s);
  return esc._d.innerHTML;
}