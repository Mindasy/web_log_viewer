// timeline.js - 时间线可视化

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

  init() {
    this.canvas = document.getElementById('timeline-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('timeline-tooltip');
    this.bindEvents();
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

    document.getElementById('btn-timeline-zoom-in').addEventListener('click', () => this.zoomIn(this.canvas.width / 2));
    document.getElementById('btn-timeline-zoom-out').addEventListener('click', () => this.zoomOut(this.canvas.width / 2));
    document.getElementById('btn-timeline-fit').addEventListener('click', () => this.fitToData());
  },

  show(entries) {
    this.entries = entries.filter(e => e.date);
    if (this.entries.length === 0) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = '#6c7086';
      this.ctx.font = '14px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('没有带时间戳的日志条目', this.canvas.width / 2, this.canvas.height / 2);
      return;
    }
    this.fitToData();
    this.draw();
  },

  fitToData() {
    this.zoomLevel = 1;
    this.offsetX = 0;
    this.draw();
  },

  zoomIn(mouseX) {
    const oldZoom = this.zoomLevel;
    this.zoomLevel = Math.min(this.zoomLevel * 1.5, 50);
    const ratio = mouseX / this.canvas.width;
    this.offsetX = this.offsetX * (this.zoomLevel / oldZoom) + mouseX * (1 - this.zoomLevel / oldZoom);
    this.draw();
  },

  zoomOut(mouseX) {
    const oldZoom = this.zoomLevel;
    this.zoomLevel = Math.max(this.zoomLevel / 1.5, 0.1);
    const ratio = mouseX / this.canvas.width;
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

    // 检测悬停
    const entry = this.findEntryAt(x, y);
    if (entry) {
      this.canvas.style.cursor = 'pointer';
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = (e.clientX + 15) + 'px';
      this.tooltip.style.top = (e.clientY - 10) + 'px';
      this.tooltip.innerHTML = `
        <div style="font-weight:600;color:${this.getLevelColor(entry.level)}">${entry.level || 'N/A'}</div>
        <div>${Utils.formatDate(entry.date)}</div>
        <div style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry.message || entry.raw}</div>
      `;
    } else {
      this.canvas.style.cursor = 'crosshair';
      this.tooltip.style.display = 'none';
    }
  },

  findEntryAt(x, y) {
    if (this.entries.length === 0) return null;
    const times = this.entries.map(e => e.date.getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = maxTime - minTime || 1;

    const margin = { top: 30, bottom: 20, left: 10, right: 10 };
    const plotWidth = this.canvas.width - margin.left - margin.right;
    const plotHeight = this.canvas.height - margin.top - margin.bottom;

    for (const entry of this.entries) {
      const t = entry.date.getTime();
      const px = margin.left + ((t - minTime) / timeRange) * plotWidth * this.zoomLevel + this.offsetX;
      const py = margin.top + Math.random() * plotHeight * 0.8 + plotHeight * 0.1;

      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist < 8) return entry;
    }
    return null;
  },

  draw() {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    // 背景
    this.ctx.fillStyle = '#1e1e2e';
    this.ctx.fillRect(0, 0, width, height);

    if (this.entries.length === 0) return;

    const times = this.entries.map(e => e.date.getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = maxTime - minTime || 1;

    const margin = { top: 30, bottom: 20, left: 10, right: 10 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    // 网格线
    this.ctx.strokeStyle = '#313244';
    this.ctx.lineWidth = 0.5;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = margin.top + (plotHeight / gridLines) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(margin.left, y);
      this.ctx.lineTo(width - margin.right, y);
      this.ctx.stroke();
    }

    // 时间轴
    this.ctx.strokeStyle = '#45475a';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(margin.left, height - margin.bottom);
    this.ctx.lineTo(width - margin.right, height - margin.bottom);
    this.ctx.stroke();

    // 时间刻度
    this.ctx.fillStyle = '#6c7086';
    this.ctx.font = '10px sans-serif';
    this.ctx.textAlign = 'center';
    const tickCount = Math.max(2, Math.floor(8 / this.zoomLevel));
    for (let i = 0; i <= tickCount; i++) {
      const t = minTime + (timeRange / tickCount) * i;
      const px = margin.left + ((t - minTime) / timeRange) * plotWidth * this.zoomLevel + this.offsetX;
      if (px >= margin.left && px <= width - margin.right) {
        this.ctx.fillText(Utils.formatDate(new Date(t), 'HH:mm:ss'), px, height - 5);
        this.ctx.beginPath();
        this.ctx.moveTo(px, height - margin.bottom);
        this.ctx.lineTo(px, height - margin.bottom + 4);
        this.ctx.stroke();
      }
    }

    // 绘制数据点
    const levelOrder = { FATAL: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4, TRACE: 5 };
    const sorted = [...this.entries].sort((a, b) => {
      const la = levelOrder[a.level] ?? 3;
      const lb = levelOrder[b.level] ?? 3;
      return la - lb;
    });

    for (const entry of sorted) {
      const t = entry.date.getTime();
      const px = margin.left + ((t - minTime) / timeRange) * plotWidth * this.zoomLevel + this.offsetX;

      if (px < margin.left - 5 || px > width - margin.right + 5) continue;

      const levelIdx = levelOrder[entry.level] ?? 3;
      const py = margin.top + (levelIdx / 5) * plotHeight * 0.7 + plotHeight * 0.15;

      // 绘制点
      this.ctx.fillStyle = this.getLevelColor(entry.level);
      this.ctx.beginPath();
      this.ctx.arc(px, py, 3, 0, Math.PI * 2);
      this.ctx.fill();

      // 高亮错误/致命
      if (entry.level === 'ERROR' || entry.level === 'FATAL') {
        this.ctx.strokeStyle = this.getLevelColor(entry.level);
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(px, py, 5, 0, Math.PI * 2);
        this.ctx.stroke();
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
    this.ctx.font = '10px sans-serif';
    for (const item of legendItems) {
      this.ctx.fillStyle = item.color;
      this.ctx.fillRect(legendX, legendY - 6, 10, 10);
      this.ctx.fillStyle = '#a6adc8';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(item.label, legendX + 13, legendY + 2);
      legendX += 55;
    }
  },

  getLevelColor(level) {
    const colors = {
      FATAL: '#eba0ac',
      ERROR: '#f38ba8',
      WARN: '#f9e2af',
      INFO: '#89dceb',
      DEBUG: '#94e2d5',
      TRACE: '#b4befe'
    };
    return colors[level] || '#a6adc8';
  },

  resize() {
    const panel = document.getElementById('timeline-panel');
    if (panel.style.display !== 'none') {
      this.canvas.width = this.canvas.clientWidth;
      this.canvas.height = this.canvas.clientHeight;
      this.draw();
    }
  }
};
