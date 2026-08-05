// timeline.js - 时间线可视化（优化版）

const Timeline = {
  canvas: null,
  ctx: null,
  tooltip: null,
  entries: [],
  zoomLevel: 1,
  offsetX: 0,
  dragging: false,
  dragStartX: 0,
  dragStartOffset: 0,
  hoveredEntry: null,
  _selectedEntry: null,        // 当前网格选中行（联动标记）

  // 缓存
  _minTime: 0,
  _maxTime: 0,
  _timeRange: 1,
  _sortedEntries: [],
  _positions: [],
  _dpr: 1,

  init() {
    this.canvas = document.getElementById('timeline-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('timeline-tooltip');
    this._dpr = window.devicePixelRatio || 1;
    this._refreshTheme();
    this.bindEvents();
  },

  // 读取主题色（Canvas 无法直接使用 CSS var()，需手动解析）
  _refreshTheme() {
    const g = name => Utils.getCSSVar(name) || '';
    this._tc = {
      bg: g('--bg-primary') || '#1e1e2e',
      border: g('--border-color') || '#313244',
      borderSoft: g('--scrollbar-thumb') || '#45475a',
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
    if (this.canvas && this.entries.length > 0) this.draw();
  },

  bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => { this.dragging = false; });
    this.canvas.addEventListener('mouseleave', () => {
      this.dragging = false;
      this.tooltip.style.display = 'none';
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      if (e.deltaY < 0) this.zoomIn(mouseX);
      else this.zoomOut(mouseX);
    });
    this.canvas.addEventListener('click', (e) => {
      if (this.hoveredEntry) {
        // 点击条目 → 跳转到对应日志行（面板停靠保留，便于继续查看时间线）
        if (LogGrid.scrollToEntry(this.hoveredEntry)) {
          Utils.showToast(`已定位到日志第 ${this.hoveredEntry.index + 1} 行`, 'success', 2000);
        }
      }
    });

    document.getElementById('btn-timeline-zoom-in').addEventListener('click', () => this.zoomIn(this.canvas.width / this._dpr / 2));
    document.getElementById('btn-timeline-zoom-out').addEventListener('click', () => this.zoomOut(this.canvas.width / this._dpr / 2));
    document.getElementById('btn-timeline-fit').addEventListener('click', () => this.fitToData());
  },

  show(entries) {
    this.entries = entries.filter(e => e.date);
    this._refreshDpr();
    const dpr = this._dpr;
    if (this.entries.length === 0) {
      const cw = this.canvas.width / dpr;
      const ch = this.canvas.height / dpr;
      this.ctx.save();
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, cw, ch);
      this.ctx.fillStyle = this._tc.bg;
      this.ctx.fillRect(0, 0, cw, ch);
      this.ctx.fillStyle = this._tc.textMuted;
      this.ctx.font = '14px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('没有带时间戳的日志条目', cw / 2, ch / 2);
      this.ctx.restore();
      return;
    }

    this._buildCache();
    this.fitToData();
  },

  _buildCache() {
    const entries = this.entries;
    if (entries.length === 0) return;

    let minT = Infinity, maxT = -Infinity;
    for (let i = 0; i < entries.length; i++) {
      const t = entries[i].date.getTime();
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    this._minTime = minT;
    this._maxTime = maxT;
    this._timeRange = Math.max(1, maxT - minT);

    // 按级别排序（致命/错误优先绘制在最上层）
    const levelOrder = { FATAL: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4, TRACE: 5 };
    this._sortedEntries = entries.slice().sort((a, b) => {
      const la = levelOrder[a.level] ?? 3;
      const lb = levelOrder[b.level] ?? 3;
      return la - lb;
    });
  },

  _precomputePositions() {
    const entries = this._sortedEntries;
    const n = entries.length;
    if (n === 0) return;

    const margin = { top: 30, bottom: 20, left: 10, right: 10 };
    const clientW = this.canvas.width / this._dpr;
    const clientH = this.canvas.height / this._dpr;
    const plotWidth = clientW - margin.left - margin.right;
    const plotHeight = clientH - margin.top - margin.bottom;

    // 统计每个级别的数量用于确定 y 布局
    const levelCount = {};
    const levelOrder = { FATAL: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4, TRACE: 5 };
    for (const e of entries) {
      const lv = levelOrder[e.level] ?? 3;
      levelCount[lv] = (levelCount[lv] || 0) + 1;
    }

    const pos = new Array(n);
    const lvCounter = {};
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      const t = e.date.getTime();
      const lv = levelOrder[e.level] ?? 3;
      const cnt = lvCounter[lv] || 0;
      lvCounter[lv] = cnt + 1;

      const bandTop = margin.top + (lv / 5) * plotHeight * 0.7 + plotHeight * 0.15;
      const bandHeight = 15;
      const count = levelCount[lv] || 1;
      const yOff = count > 1 ? (cnt / (count - 1) - 0.5) * bandHeight : 0;

      const px = margin.left + ((t - this._minTime) / this._timeRange) * plotWidth;
      const py = bandTop + yOff;

      pos[i] = { px, py, entry: e };
    }
    this._positions = pos;
  },

  _refreshDpr() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const newW = Math.round(w * this._dpr);
    const newH = Math.round(h * this._dpr);
    if (this.canvas.width !== newW || this.canvas.height !== newH) {
      this.canvas.width = newW;
      this.canvas.height = newH;
    }
  },

  fitToData() {
    this.zoomLevel = 1;
    this.offsetX = 0;
    this.draw();
  },

  // 设置联动标记（网格选中行 → 时间线高亮）
  setSelectedEntry(entry) {
    this._selectedEntry = entry || null;
    this.draw();
  },

  // 在时间线中定位指定条目：水平居中 + 标记
  locateEntry(entry) {
    if (!entry || !entry.date) return false;
    this._selectedEntry = entry;
    const margin = { top: 30, bottom: 20, left: 10, right: 10 };
    const clientW = this.canvas.width / this._dpr;
    const plotWidth = clientW - margin.left - margin.right;
    if (plotWidth > 0) {
      const t = (entry.date.getTime() - this._minTime) / this._timeRange;
      const targetX = margin.left + t * plotWidth;
      const cx = clientW / 2;
      this.offsetX = cx - targetX * this.zoomLevel;
    }
    this.draw();
    return true;
  },

  zoomIn(mouseX) {
    const oldZoom = this.zoomLevel;
    this.zoomLevel = Math.min(this.zoomLevel * 1.5, 50);
    this.offsetX = this.offsetX * (this.zoomLevel / oldZoom) + mouseX * (1 - this.zoomLevel / oldZoom);
    this.draw();
  },

  zoomOut(mouseX) {
    const oldZoom = this.zoomLevel;
    this.zoomLevel = Math.max(this.zoomLevel / 1.5, 0.1);
    this.offsetX = this.offsetX * (this.zoomLevel / oldZoom) + mouseX * (1 - this.zoomLevel / oldZoom);
    this.draw();
  },

  onMouseDown(e) {
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartOffset = this.offsetX;
  },

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.dragging) {
      this.offsetX = this.dragStartOffset + (e.clientX - this.dragStartX);
      this.draw();
      return;
    }

    const entry = this.findEntryAt(x, y);
    this.hoveredEntry = entry;

    if (entry) {
      this.canvas.style.cursor = 'pointer';
      this.tooltip.innerHTML = `
        <div style="font-weight:600;color:${this.getLevelColor(entry.level)}">${entry.level || 'N/A'}</div>
        <div style="color:${this._tc.text}">行 #${entry.index + 1} ${Utils.formatDate(entry.date)}</div>
        <div style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${this._tc.text}">${this.escapeHtml(entry.message || entry.raw)}</div>
        <div style="font-size:10px;color:${this._tc.textMuted};margin-top:3px">点击定位到左侧日志表格</div>
      `;
      this.tooltip.style.display = 'block';
      this._positionTooltip(e);
    } else {
      this.canvas.style.cursor = 'crosshair';
      this.tooltip.style.display = 'none';
    }
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

  findEntryAt(x, y) {
    const pos = this._positions;
    if (pos.length === 0) return null;

    const clientW = this.canvas.width / this._dpr;
    const w = clientW - 20;

    for (let i = pos.length - 1; i >= 0; i--) {
      const p = pos[i];
      const px = p.px * this.zoomLevel + this.offsetX;
      if (px < -5 || px > w + 5) continue;
      const dist = Math.sqrt((x - px) ** 2 + (y - p.py) ** 2);
      if (dist < 8) return p.entry;
    }
    return null;
  },

  draw() {
    const entries = this._sortedEntries;
    if (entries.length === 0) return;

    this._refreshDpr();

    const ctx = this.ctx;
    const dpr = this._dpr;
    const clientW = this.canvas.width / dpr;
    const clientH = this.canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, clientW, clientH);

    // 背景
    ctx.fillStyle = this._tc.bg;
    ctx.fillRect(0, 0, clientW, clientH);

    const margin = { top: 30, bottom: 20, left: 10, right: 10 };
    const plotWidth = clientW - margin.left - margin.right;
    const plotHeight = clientH - margin.top - margin.bottom;

    // 网格线
    ctx.strokeStyle = this._tc.borderSoft;
    ctx.lineWidth = 0.5;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = margin.top + (plotHeight / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(clientW - margin.right, y);
      ctx.stroke();
    }

    // 时间轴
    ctx.strokeStyle = this._tc.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, clientH - margin.bottom);
    ctx.lineTo(clientW - margin.right, clientH - margin.bottom);
    ctx.stroke();

    // 日期维度：跨天时绘制午夜分隔线
    const DAY = 86400000;
    const rangeMs = this._timeRange;
    if (rangeMs >= DAY) {
      const d0 = new Date(this._minTime);
      const firstMidnight = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime() + DAY;
      const stepDays = (rangeMs / DAY) > 31 ? Math.ceil((rangeMs / DAY) / 20) : 1;
      ctx.save();
      ctx.strokeStyle = this._tc.border;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([3, 3]);
      for (let t = firstMidnight; t <= this._maxTime; t += DAY * stepDays) {
        const px = margin.left + ((t - this._minTime) / this._timeRange) * plotWidth * this.zoomLevel + this.offsetX;
        if (px < margin.left || px > clientW - margin.right) continue;
        ctx.beginPath();
        ctx.moveTo(px, margin.top);
        ctx.lineTo(px, clientH - margin.bottom);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 时间刻度：根据跨度自适应格式（跨天显示日期维度）
    ctx.fillStyle = this._tc.textMuted;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const tickCount = Math.max(2, Math.floor(8 / this.zoomLevel));
    const multiDay = rangeMs >= DAY;
    let tickFmt;
    if (rangeMs < 60 * 1000) tickFmt = 'HH:mm:ss';
    else if (!multiDay) tickFmt = 'HH:mm:ss';
    else if (rangeMs < 7 * DAY) tickFmt = 'MM-dd HH:mm';
    else tickFmt = 'MM-dd';
    for (let i = 0; i <= tickCount; i++) {
      const t = this._minTime + (this._timeRange / tickCount) * i;
      const px = margin.left + ((t - this._minTime) / this._timeRange) * plotWidth * this.zoomLevel + this.offsetX;
      if (px >= margin.left && px <= clientW - margin.right) {
        ctx.fillText(Utils.formatDate(new Date(t), tickFmt), px, clientH - 5);
        ctx.beginPath();
        ctx.moveTo(px, clientH - margin.bottom);
        ctx.lineTo(px, clientH - margin.bottom + 4);
        ctx.stroke();
      }
    }

    // 预计算并缓存位置
    this._precomputePositions();
    const pos = this._positions;

    // 绘制数据点
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const p = pos[i];
      const px = p.px * this.zoomLevel + this.offsetX;

      if (px < margin.left - 5 || px > clientW - margin.right + 5) continue;

      ctx.fillStyle = this.getLevelColor(entry.level);
      ctx.beginPath();
      ctx.arc(px, p.py, 3, 0, Math.PI * 2);
      ctx.fill();

      if (entry.level === 'ERROR' || entry.level === 'FATAL') {
        ctx.strokeStyle = this.getLevelColor(entry.level);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, p.py, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 联动标记：当前网格选中行（主题强调色圆环 + 十字准线）
    if (this._selectedEntry) {
      const selPos = this._positions.find(p => p.entry.index === this._selectedEntry.index);
      if (selPos) {
        const sx = selPos.px * this.zoomLevel + this.offsetX;
        if (sx >= margin.left - 5 && sx <= clientW - margin.right + 5) {
          ctx.save();
          ctx.fillStyle = this._tc.accent + '2e';
          ctx.beginPath(); ctx.arc(sx, selPos.py, 10, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = this._tc.accent; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, selPos.py, 6, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = this._tc.accent; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, selPos.py - 13); ctx.lineTo(sx, selPos.py - 9);
          ctx.moveTo(sx, selPos.py + 9); ctx.lineTo(sx, selPos.py + 13);
          ctx.moveTo(sx - 13, selPos.py); ctx.lineTo(sx - 9, selPos.py);
          ctx.moveTo(sx + 9, selPos.py); ctx.lineTo(sx + 13, selPos.py);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 图例
    const legendY = 12;
    let legendX = margin.left;
    const legendItems = [
      { label: 'FATAL', color: this.getLevelColor('FATAL') },
      { label: 'ERROR', color: this.getLevelColor('ERROR') },
      { label: 'WARN', color: this.getLevelColor('WARN') },
      { label: 'INFO', color: this.getLevelColor('INFO') },
      { label: 'DEBUG', color: this.getLevelColor('DEBUG') },
      { label: 'TRACE', color: this.getLevelColor('TRACE') },
    ];
    ctx.font = '10px sans-serif';
    for (const item of legendItems) {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, legendY - 6, 10, 10);
      ctx.fillStyle = this._tc.text;
      ctx.textAlign = 'left';
      ctx.fillText(item.label, legendX + 13, legendY + 2);
      legendX += 55;
    }

    ctx.restore();
  },

  getLevelColor(level) {
    return this._levelColors[level] || this._tc.textMuted;
  },

  escapeHtml(str) {
    if (!str) return '';
    if (!this._escapeDiv) this._escapeDiv = document.createElement('div');
    this._escapeDiv.textContent = str;
    return this._escapeDiv.innerHTML;
  },

  resize() {
    const panel = document.getElementById('timeline-panel');
    if (panel.style.display !== 'none') {
      this._refreshDpr();
      if (this.entries.length > 0) {
        this._positions = [];
        this.draw();
      }
    }
  }
};