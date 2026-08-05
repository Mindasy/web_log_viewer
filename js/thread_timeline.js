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
  _selectedEntry: null,        // 当前网格选中行（联动标记）

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
    // 恢复用户自定义的 label 列宽度
    const savedLabelW = parseInt(localStorage.getItem('tl-label-width'), 10);
    if (savedLabelW >= 90 && savedLabelW <= 320) this.LABEL_WIDTH = savedLabelW;
    this._refreshTheme();
    this._bindCanvasEvents();
    this._bindHeaderEvents();
  },

  // ===== 主题适配 =====

  // 读取主题色（Canvas 无法直接使用 CSS var()，需手动解析）
  _refreshTheme() {
    const g = name => Utils.getCSSVar(name) || '';
    this._tc = {
      bg: g('--bg-primary') || '#11121a',
      bgLabel: g('--bg-tertiary') || '#161822',
      bgAlt: g('--bg-secondary') || '#141520',
      border: g('--border-color') || '#252636',
      borderSoft: g('--scrollbar-thumb') || '#1e2030',
      text: g('--text-primary') || '#a6adc8',
      textMuted: g('--text-muted') || '#6c7086',
      accent: g('--accent') || '#7aa2f7',
    };
    this._levelColors = {
      FATAL: g('--fatal') || '#eba0ac',
      ERROR: g('--error') || '#f38ba8',
      WARN: g('--warning') || '#f9e2af',
      INFO: g('--info') || '#89dceb',
      DEBUG: g('--debug') || '#94e2d5',
      TRACE: g('--trace') || '#b4befe',
    };
  },

  // 主题切换时重绘
  onThemeChange() {
    this._refreshTheme();
    if (this.canvas) this._draw();
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
    LogFilter.state.methodFilter = '';
    // 同步背景日志：只显示该线程的日志
    LogFilter.state.threadFilter = Utils.escapeRegex(threadName);
    this._groupByMethod(thread.entries);
    this._clampScrollY();
    this._updateDetailHeader();
    this._draw();
    App.refresh();
  },

  closeThreadDetail() {
    this._detailThread = null;
    this._detailMethods = [];
    this._detailVisibleMethods = [];
    this.scrollY = 0;
    // 清除时间线触发的过滤条件，恢复 grid 显示全部数据
    LogFilter.state.threadFilter = '';
    LogFilter.state.sourceFilter = '';
    LogFilter.state.methodFilter = '';
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
    return Utils.extractMethodName(entry.source);
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

  // 设置联动标记（网格选中行 → 时间线高亮）
  setSelectedEntry(entry) {
    this._selectedEntry = entry || null;
    this._draw();
  },

  // 在时间线中定位指定条目：滚动泳道 + 水平居中 + 标记
  locateEntry(entry) {
    if (!entry || !entry.date) return false;
    this._selectedEntry = entry;
    const sources = this._detailThread ? this._detailMethods : this.threads;
    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    const lane = sources.find(s => s.entries.includes(entry));
    if (!lane) {
      this._draw();
      return false;
    }

    // 垂直滚动到所在泳道
    const idx = list.indexOf(lane.name);
    if (idx >= 0) {
      const viewH = this._getViewportH();
      const laneTop = idx * this.SWIMLANE_H;
      if (laneTop < this.scrollY || laneTop + this.SWIMLANE_H > this.scrollY + viewH) {
        this.scrollY = Math.max(0, Math.min(laneTop - viewH / 2, this._getContentHeight() - viewH));
      }
    }

    // 水平居中该条目的时间位置
    const plotW = this._getPlotWidth();
    if (plotW > 0) {
      const t = (entry.date.getTime() - this.minTime) / this.timeRange;
      const targetX = this.MARGIN.left + this.LABEL_WIDTH + t * plotW;
      const cx = (this.canvas.width / this._dpr) / 2;
      this.offsetX = cx - targetX * this.zoomLevel;
    }
    this._draw();
    return true;
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

  // 自适应时间刻度：根据可视时间窗口生成对齐的刻度，避免放大后刻度消失
  _getTimeTicks() {
    const visibleRange = this.timeRange / Math.max(this.zoomLevel, 0.0001);
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
      10000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000,
      7200000, 14400000, 21600000, 43200000, 86400000, 172800000,
      432000000, 864000000, 1728000000, 2592000000];
    let step = steps[steps.length - 1];
    const target = visibleRange / 8;
    for (const s of steps) {
      if (s >= target) { step = s; break; }
    }
    const fmt = this._getTickFormat(step, visibleRange);
    const ticks = [];
    // 覆盖平移后可能进入视口的时间范围（缩小时可视窗口超出数据范围）
    const t0 = Math.floor((this.minTime - visibleRange) / step) * step;
    const t1 = this.maxTime + visibleRange;
    for (let t = t0; t <= t1; t += step) {
      ticks.push({ t, fmt });
    }
    return ticks;
  },

  // 根据刻度步长选择标签格式（跨天窗口自动带上日期）
  _getTickFormat(step, visibleRange) {
    const multiDay = visibleRange >= 86400000;
    if (step >= 86400000) return 'MM-dd';
    if (step >= 3600000) return multiDay ? 'MM-dd HH:mm' : 'HH:mm';
    if (step >= 60000) return multiDay ? 'MM-dd HH:mm' : 'HH:mm';
    if (step >= 1000) return 'HH:mm:ss';
    return 'HH:mm:ss.SSS';
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

  // 当前是否激活线程模式（线程/级别共用同一 canvas，未激活时不处理事件）
  _isActive() {
    const btn = document.querySelector('.timeline-mode-btn.active');
    return !!(btn && btn.dataset.mode === 'thread');
  },

  _bindCanvasEvents() {
    this.canvas.addEventListener('mousedown', e => {
      if (!this._isActive()) return;
      this._onMD(e);
    });
    this.canvas.addEventListener('mousemove', e => {
      if (!this._isActive()) return;
      this._onMM(e);
    });
    this.canvas.addEventListener('mouseup', () => {
      if (!this._isActive()) return;
      this.dragging = false;
      if (this._labelResizing) {
        this._labelResizing = false;
        this._suppressClick = true;
        localStorage.setItem('tl-label-width', String(this.LABEL_WIDTH));
      }
    });
    this.canvas.addEventListener('mouseleave', () => {
      if (!this._isActive()) return;
      this.dragging = false;
      this._labelResizing = false;
      this._hoveredThreadIdx = -1;
      this.tooltip.style.display = 'none';
      this._draw();
    });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!this._isActive()) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
      const overLabel = mx < labelEnd;
      const contentH = this._getContentHeight();
      const viewH = this._getViewportH();

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + 滚轮 = 缩放（任意区域，锚点取绘图区起点避免异常偏移）
        const anchor = Math.max(labelEnd, mx);
        e.deltaY < 0 ? this.zoomIn(anchor) : this.zoomOut(anchor);
      } else if (e.shiftKey) {
        // Shift + 滚轮 = 水平平移
        this.offsetX -= e.deltaY * 2;
        this._draw();
      } else if (overLabel) {
        // 标签列：垂直滚动线程/方法列表（不与缩放冲突）
        if (contentH > viewH) {
          this.scrollY = Math.max(0, Math.min(this.scrollY + e.deltaY, contentH - viewH));
          this._draw();
        }
      } else {
        // 绘图区：滚轮 = 缩放时间轴
        e.deltaY < 0 ? this.zoomIn(mx) : this.zoomOut(mx);
      }
    });
    this.canvas.addEventListener('click', e => {
      if (!this._isActive()) return;
      // 拖拽 label 列宽度刚结束 → 忽略本次 click，避免误触
      if (this._suppressClick) {
        this._suppressClick = false;
        return;
      }
      if (this.hoveredEntry) {
        // 点击条目 → 跳转到对应日志行（面板停靠保留，函数/方法视图不被掩盖）
        if (LogGrid.scrollToEntry(this.hoveredEntry)) {
          Utils.showToast(`已定位到日志第 ${this.hoveredEntry.index + 1} 行`, 'success', 2000);
        }
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;

      if (this._detailThread) {
        // 详情模式：点击方法标签 → 过滤（按方法名精确匹配，避免 source 格式差异）
        const mi = this._getItemIdx(y);
        if (mi >= 0 && x <= this.LABEL_WIDTH) {
          const name = this._detailVisibleMethods[mi];
          if (name && name !== '(unknown)') {
            LogFilter.state.methodFilter = name;
            LogFilter.state.sourceFilter = '';
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
            LogFilter.state.methodFilter = '';
            LogFilter.state.sourceFilter = '';
            LogFilter.state.threadFilter = Utils.escapeRegex(name);
            App.refresh();
          }
        }
      }
    });

    // 双击进入线程详情 / 双击 label 边界重置列宽
    this.canvas.addEventListener('dblclick', e => {
      if (!this._isActive()) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (y >= this.MARGIN.top && Math.abs(x - this.LABEL_WIDTH) <= 8) {
        // 双击边界 → 重置 label 列宽
        this.LABEL_WIDTH = 160;
        this._precomputedPlotW = 0;
        localStorage.setItem('tl-label-width', String(this.LABEL_WIDTH));
        this._draw();
        return;
      }
      if (this._detailThread) return;
      const ti = this._getItemIdx(y);
      if (ti >= 0 && x > this.LABEL_WIDTH) {
        const name = this._visibleThreads[ti];
        if (name && name !== 'unknown') {
          this.openThreadDetail(name);
        }
      }
    });

    document.getElementById('btn-timeline-zoom-in').addEventListener('click', () => {
      if (!this._isActive()) return;
      this.zoomIn(this.canvas.width / this._dpr / 2);
    });
    document.getElementById('btn-timeline-zoom-out').addEventListener('click', () => {
      if (!this._isActive()) return;
      this.zoomOut(this.canvas.width / this._dpr / 2);
    });
    document.getElementById('btn-timeline-fit').addEventListener('click', () => {
      if (!this._isActive()) return;
      this.fitToData();
    });
  },

  _onMD(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    // 点击 label 列边界 → 进入宽度拖拽
    if (y >= this.MARGIN.top && Math.abs(x - this.LABEL_WIDTH) <= 8) {
      this._labelResizing = true;
      this._labelDragStartX = e.clientX;
      this._labelDragStartW = this.LABEL_WIDTH;
      this.canvas.style.cursor = 'col-resize';
      return;
    }
    this.dragging = true;
    // 区域化拖拽：绘图区 = 水平平移，标签列 = 垂直滚动（互不冲突）
    this._dragMode = (x < this.MARGIN.left + this.LABEL_WIDTH) ? 'vscroll' : 'hpan';
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartOffset = this.offsetX;
    this.dragStartScrollY = this.scrollY;
  },

  _onMM(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    if (this.dragging) {
      if (this._dragMode === 'hpan') {
        // 绘图区拖拽：仅水平平移时间轴
        this.offsetX = this.dragStartOffset + (e.clientX - this.dragStartX);
      } else {
        // 标签列拖拽：仅垂直滚动列表
        const contentH = this._getContentHeight();
        const viewH = this._getViewportH();
        if (contentH > viewH) {
          this.scrollY = Math.max(0, Math.min(
            this.dragStartScrollY - (e.clientY - this.dragStartY),
            contentH - viewH));
        }
      }
      this._draw();
      return;
    }

    // 拖拽 label 列宽度
    if (this._labelResizing) {
      const w = Math.max(90, Math.min(320,
        this._labelDragStartW + (e.clientX - this._labelDragStartX)));
      if (w !== this.LABEL_WIDTH) {
        this.LABEL_WIDTH = w;
        this._precomputedPlotW = 0;
        this._draw();
      }
      return;
    }

    // 悬停在 label 列边界 → 显示拖拽光标
    const nearLabelEdge = y >= this.MARGIN.top - 2 && Math.abs(x - this.LABEL_WIDTH) <= 8;
    if (nearLabelEdge) {
      this.canvas.style.cursor = 'col-resize';
      this.tooltip.style.display = 'none';
      this.hoveredEntry = null;
      if (this._hoveredThreadIdx !== -1) {
        this._hoveredThreadIdx = -1;
        this._draw();
      }
      return;
    }

    const ti = this._getItemIdx(y);
    const prevHovered = this._hoveredThreadIdx;
    this._hoveredThreadIdx = (ti >= 0) ? ti : -1;

    const entry = this._findEntryAt(x, y);
    this.hoveredEntry = entry;

    if (entry) {
      this.canvas.style.cursor = 'pointer';
      const lc = this._levelColors[entry.level] || this._tc.textMuted;
      const method = this._detailThread ? this._extractMethod(entry) : '';
      const tc = this._tc;
      this.tooltip.innerHTML =
        `<div style="font-weight:600;color:${lc};font-size:12px">${entry.level||'N/A'}</div>
        <div style="font-size:11px;color:${tc.text}">${esc(entry.thread||entry.tid||'-')}</div>
        ${method ? `<div style="font-size:11px;color:${tc.accent}">${esc(method)}</div>` : ''}
        <div style="font-size:11px;color:${tc.text}">${Utils.formatDate(entry.date)}</div>
        <div style="font-size:11px;color:${tc.textMuted}">行 #${entry.index+1}</div>
        <div style="max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:${tc.text}">${esc(entry.message||entry.raw)}</div>
        <div style="font-size:10px;color:${tc.textMuted};margin-top:3px">点击定位到左侧日志表格</div>`;
      this.tooltip.style.display = 'block';
      this._positionTooltip(e);
    } else {
      const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
      this.canvas.style.cursor = ti >= 0 && x <= this.LABEL_WIDTH ? 'pointer' : 'crosshair';
      this.tooltip.style.display = 'none';
    }

    if (prevHovered !== this._hoveredThreadIdx) this._draw();
  },

  // 定位 tooltip：贴近右/下边缘时自动翻转方向，确保完整可见
  _positionTooltip(e) {
    const MARGIN = 15;
    const tip = this.tooltip;
    const vw = window.innerWidth, vh = window.innerHeight;
    const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 100;
    let left = e.clientX + MARGIN;
    let top = e.clientY - 10;
    if (left + tw > vw - 8) left = Math.max(8, e.clientX - tw - MARGIN);
    if (top + th > vh - 8) top = Math.max(8, vh - th - 8);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
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
    ctx.fillStyle = this._tc.bg; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = this._tc.textMuted; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(msg, cw / 2, ch / 2);
    ctx.restore();
  },

  _drawNow() {
    this._refreshDpr();
    const ctx = this.ctx, dpr = this._dpr;
    const cw = this.canvas.width / dpr, ch = this.canvas.height / dpr;

    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = this._tc.bg; ctx.fillRect(0, 0, cw, ch);

    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    if (list.length === 0) {
      ctx.fillStyle = this._tc.textMuted; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
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

    // label 列宽度拖拽手柄（边界线 + 顶部握把）
    this._drawLabelResizeHandle(ctx, cw, ch);

    // 联动标记：当前网格选中行
    this._drawSelectedMarker(ctx, cw, ch, plotW);

    // 垂直滚动条
    this._drawScrollbar(ctx, cw, ch);

    this._drawTimeAxis(ctx, cw, ch, plotW);
    ctx.restore();
  },

  // label 列宽度拖拽手柄：边界竖线 + 顶部握把 + 悬停提示
  _drawLabelResizeHandle(ctx, cw, ch) {
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    if (labelEnd < 0 || labelEnd > cw) return;
    ctx.save();
    ctx.strokeStyle = this._tc.accent; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(labelEnd, this.MARGIN.top); ctx.lineTo(labelEnd, ch - this.MARGIN.bottom);
    ctx.stroke();
    // 顶部握把
    ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(labelEnd - 4, 6); ctx.lineTo(labelEnd + 4, 6);
    ctx.moveTo(labelEnd - 4, 11); ctx.lineTo(labelEnd + 4, 11);
    ctx.stroke();
    ctx.restore();
  },

  _drawSummary(ctx, cw, plotW) {
    const y = 8, labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    ctx.fillStyle = this._tc.text; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';

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

    ctx.fillStyle = this._tc.bgLabel; ctx.fillRect(0, 0, labelEnd, ch);
    ctx.strokeStyle = this._tc.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(labelEnd, 0); ctx.lineTo(labelEnd, ch); ctx.stroke();

    // 垂直时间网格线（自适应可视窗口）
    const ticks = this._getTimeTicks();
    ctx.strokeStyle = this._tc.borderSoft; ctx.lineWidth = 0.5;
    for (const { t } of ticks) {
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
        ctx.fillStyle = this._tc.bgAlt;
        ctx.fillRect(labelEnd, y, plotX2 - labelEnd, this.SWIMLANE_H);
      }
      ctx.strokeStyle = this._tc.borderSoft; ctx.lineWidth = 0.5;
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
      ctx.fillStyle = this._tc.accent + '14';
      ctx.fillRect(labelEnd, y, plotX2 - labelEnd, this.SWIMLANE_H);
      ctx.fillStyle = this._tc.accent + '10';
      ctx.fillRect(0, y, labelEnd, this.SWIMLANE_H);
    }

    // 标签
    ctx.fillStyle = isHovered ? this._tc.text : source.color;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    const dn = name.length > 20 ? name.slice(0, 19) + '…' : name;
    ctx.fillText(dn, labelEnd - 8, cy + 4);

    ctx.fillStyle = isHovered ? this._tc.text : this._tc.textMuted;
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
      const color = this._levelColors[lvl] || this._tc.textMuted;
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

  // 联动标记：高亮当前网格选中行对应的时间点（白色圆环 + 十字准线）
  _drawSelectedMarker(ctx, cw, ch, plotW) {
    const sel = this._selectedEntry;
    if (!sel || !sel.date) return;
    const sources = this._detailThread ? this._detailMethods : this.threads;
    const list = this._detailThread ? this._detailVisibleMethods : this._visibleThreads;
    const lane = sources.find(s => s.entries.includes(sel));
    if (!lane || !lane._positions) return;
    const idx = list.indexOf(lane.name);
    if (idx < 0) return;

    const y = this.MARGIN.top + idx * this.SWIMLANE_H - this.scrollY + this.SWIMLANE_H / 2;
    if (y < this.MARGIN.top - 8 || y > ch - this.MARGIN.bottom + 8) return;

    const t = (sel.date.getTime() - this.minTime) / this.timeRange;
    const x = (this.MARGIN.left + this.LABEL_WIDTH + t * plotW) * this.zoomLevel + this.offsetX;
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    if (x < labelEnd || x > cw - this.MARGIN.right) return;

    ctx.save();
    // 半透明光晕
    ctx.fillStyle = this._tc.accent + '2e';
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
    // 主题强调色圆环 + 白色内芯
    ctx.strokeStyle = this._tc.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.stroke();
    // 十字准线
    ctx.strokeStyle = this._tc.accent; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 13); ctx.lineTo(x, y - 9);
    ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 13);
    ctx.moveTo(x - 13, y); ctx.lineTo(x - 9, y);
    ctx.moveTo(x + 9, y); ctx.lineTo(x + 13, y);
    ctx.stroke();
    ctx.restore();
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
      const color = this._levelColors[['FATAL','ERROR','WARN','INFO','DEBUG','TRACE'][lvl]] || this._tc.textMuted;
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

    ctx.fillStyle = this._tc.border;
    ctx.fillRect(trackX, trackY, 4, trackH);
    ctx.fillStyle = this._tc.textMuted;
    ctx.fillRect(trackX, thumbY, 4, thumbH);
  },

  _drawTimeAxis(ctx, cw, ch, plotW) {
    const axisY = ch - this.MARGIN.bottom + 8;
    const labelEnd = this.MARGIN.left + this.LABEL_WIDTH;
    const plotX2 = cw - this.MARGIN.right;
    const tc = this._tc;

    ctx.strokeStyle = tc.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(labelEnd, axisY); ctx.lineTo(plotX2, axisY); ctx.stroke();

    const DAY = 86400000;
    const rangeMs = this.timeRange;

    // 日期维度：跨天时绘制午夜分隔线 + 日期标签
    const dayCount = rangeMs / DAY;
    if (dayCount >= 1) {
      const d0 = new Date(this.minTime);
      const firstMidnight = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime() + DAY;
      const stepDays = dayCount > 31 ? Math.ceil(dayCount / 20) : 1;
      ctx.save();
      ctx.strokeStyle = tc.border; ctx.globalAlpha = 0.6; ctx.setLineDash([3, 3]);
      for (let t = firstMidnight; t <= this.maxTime; t += DAY * stepDays) {
        const px = labelEnd + ((t - this.minTime) / rangeMs) * plotW * this.zoomLevel + this.offsetX;
        if (px < labelEnd || px > plotX2) continue;
        ctx.beginPath(); ctx.moveTo(px, this.MARGIN.top); ctx.lineTo(px, axisY); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 0.75;
      ctx.fillStyle = tc.textMuted;
      ctx.font = '9px monospace';
      for (let t = firstMidnight; t <= this.maxTime; t += DAY * stepDays) {
        const px = labelEnd + ((t - this.minTime) / rangeMs) * plotW * this.zoomLevel + this.offsetX;
        if (px < labelEnd || px > plotX2) continue;
        ctx.fillText(Utils.formatDate(new Date(t), 'MM-dd'), px, axisY - 8);
      }
      ctx.restore();
    }

    // 时间刻度：根据可视窗口自适应（放大后仍保持合理的刻度密度）
    const ticks = this._getTimeTicks();
    ctx.textAlign = 'center';
    for (const { t, fmt } of ticks) {
      const px = labelEnd + ((t - this.minTime) / this.timeRange) * plotW * this.zoomLevel + this.offsetX;
      if (px < labelEnd || px > plotX2) continue;
      ctx.fillStyle = tc.text;
      ctx.font = '10px monospace';
      ctx.fillText(Utils.formatDate(new Date(t), fmt), px, axisY + 14);
      ctx.strokeStyle = tc.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, axisY - 2); ctx.lineTo(px, axisY + 4); ctx.stroke();
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
        // 切换后同步当前网格选中行标记
        if (App && App.syncTimelineSelection) App.syncTimelineSelection();
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
    // 同步背景日志：时间线的 PID 上下文与网格过滤一致
    if (LogFilter.state.pidFilter !== pid) {
      LogFilter.state.pidFilter = pid;
      if (App && App.refresh) App.refresh();
    }
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