// grid.js - 虚拟滚动日志表格

const LogGrid = {
  // DOM 元素
  viewport: null,
  gridBody: null,
  header: null,
  scrollbar: null,
  scrollbarThumb: null,

  // 虚拟滚动状态
  rowHeight: 24,
  visibleCount: 0,
  _virtualRow: 0,       // 当前视口顶部的逻辑行号（替代 scrollTop）
  totalRows: 0,
  renderedRange: { start: 0, end: 0 },

  // 数据
  entries: [],
  selectedIndex: -1,

  // 列定义
  columnDefs: [
    { key: 'index',     label: '#',     className: 'col-index',       minWidth: 60,  canHide: false, canSort: true },
    { key: 'bookmark',  label: '🔖',    className: 'col-bookmark',    minWidth: 32,  canHide: true,  canSort: false },
    { key: 'timestamp', label: '时间戳', className: 'col-timestamp',   minWidth: 100, canHide: true,  canSort: true },
    { key: 'level',     label: '级别',   className: 'col-level',       minWidth: 60,  canHide: true,  canSort: true },
    { key: 'pid',       label: '进程ID', className: 'col-pid',         minWidth: 60,  canHide: true,  canSort: true },
    { key: 'tid',       label: '线程ID', className: 'col-tid',         minWidth: 60,  canHide: true,  canSort: true },
    { key: 'source',    label: '来源',   className: 'col-source',      minWidth: 80,  canHide: true,  canSort: true },
    { key: 'message',   label: '消息',   className: 'col-message',     minWidth: 120, canHide: true,  canSort: false },
  ],

  // 动态列（来自 customFields）
  _dynamicColDefs: [],

  // 所有列定义（静态 + 动态）
  getAllColDefs() {
    return [...this.columnDefs, ...this._dynamicColDefs];
  },

  // 列隐藏状态
  hiddenColumns: new Set(),

  // 用户手动操作过的列（autoHideEmptyColumns 跳过它们，不再干预）
  _userModifiedColumns: new Set(),

  // 自定义列宽
  columnWidths: {},

  // 拖拽调整状态
  _headerResizeBound: false,

  init() {
    this.viewport = document.getElementById('grid-viewport');
    this.gridBody = document.getElementById('grid-body');
    this.header = document.getElementById('grid-header');
    this.initScrollbar();
    this.bindEvents();
    this.calculateVisibleCount();
    this.renderEmptyState();
  },

  // ===== 合成滚动条 =====
  initScrollbar() {
    this.scrollbar = document.getElementById('grid-scrollbar');
    this.scrollbarThumb = document.getElementById('grid-scrollbar-thumb');
    if (!this.scrollbar || !this.scrollbarThumb) return;

    // 点击轨道跳转
    this.scrollbar.addEventListener('mousedown', (e) => {
      if (e.target === this.scrollbarThumb) return;
      const rect = this.scrollbar.getBoundingClientRect();
      const frac = (e.clientY - rect.top) / rect.height;
      this._virtualRow = Math.round(frac * (this.totalRows - 1));
      this._virtualRow = Math.max(0, Math.min(this._virtualRow, this.totalRows - 1));
      this._syncNativeScroll();
      this.render();
    });

    // 拖拽滑块
    this.scrollbarThumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startRow = this._virtualRow;
      const trackHeight = this.gridBody.clientHeight || 1;

      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        const rowDelta = Math.round((dy / trackHeight) * Math.max(1, this.totalRows - 1));
        this._virtualRow = Math.max(0, Math.min(startRow + rowDelta, this.totalRows - 1));
        this._syncNativeScroll();
        this.render();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  },

  _renderScrollbar() {
    if (!this.scrollbar || !this.scrollbarThumb) return;
    if (this.totalRows <= 1) {
      this.scrollbar.style.display = 'none';
      return;
    }
    this.scrollbar.style.display = 'block';
    this.scrollbarThumb.style.display = 'block';

    // 与 grid-body 的可视区域对齐
    const panel = this.scrollbar.parentElement;
    if (panel) {
      const bodyRect = this.gridBody.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      this.scrollbar.style.top = (bodyRect.top - panelRect.top) + 'px';
      this.scrollbar.style.height = this.gridBody.clientHeight + 'px';
    }

    const trackH = this.gridBody.clientHeight || 1;
    const thumbRatio = Math.min(1, this.visibleCount / this.totalRows);
    const thumbH = Math.max(20, thumbRatio * trackH);
    const thumbPos = (this._virtualRow / Math.max(1, this.totalRows - 1)) * (trackH - thumbH);

    this.scrollbarThumb.style.height = thumbH + 'px';
    this.scrollbarThumb.style.transform = 'translateY(' + thumbPos + 'px)';
  },

  // 合成滚动条 → 原生 scrollTop 同步
  _syncNativeScroll() {
    const clientH = this.gridBody.clientHeight || 1;
    this.gridBody.scrollTop = ScrollMath.syncToNative(this._virtualRow, this.totalRows, clientH);
  },

  // 原生 scrollTop → 合成滚动条同步
  _syncFromNativeScroll() {
    const clientH = this.gridBody.clientHeight || 1;
    this._virtualRow = ScrollMath.syncFromNative(this.gridBody.scrollTop, this.totalRows, clientH);
  },

  _getCSSHeight() {
    return ScrollMath.getCSSHeight(this.totalRows);
  },

  renderEmptyState() {
    this.header.textContent = '';
    this.viewport.innerHTML = '<div class="grid-empty"><div class="grid-empty-icon">📄</div><div>请加载日志文件</div><div class="grid-empty-sub">拖拽文件到此处，或点击左上角 + 按钮</div></div>';
    this.viewport.style.height = 'auto';
  },

  isColumnVisible(key) {
    const def = this.getAllColDefs().find(d => d.key === key);
    if (!def || !def.canHide) return true;
    return !this.hiddenColumns.has(key);
  },

  renderHeader() {
    this.header.textContent = '';
    for (const def of this.getAllColDefs()) {
      if (!this.isColumnVisible(def.key)) continue;
      const col = document.createElement('div');
      col.className = `col ${def.className}`;
      col.dataset.col = def.key;
      const w = this.columnWidths[def.key];
      if (w) {
        col.style.width = w + 'px';
        col.style.minWidth = w + 'px';
        if (def.key !== 'message') col.style.flex = 'none';
      }
      const labelSpan = document.createElement('span');
      labelSpan.className = 'col-label';
      labelSpan.textContent = def.label;
      col.appendChild(labelSpan);

      if (def.canHide) {
        col.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showColumnMenu(e, def.key);
        });
      }

      if (def.canSort) {
        col.addEventListener('click', (e) => {
          if (e.target.closest('.col-resizer')) return;
          const colName = col.dataset.col;
          if (LogFilter.state.sortColumn === colName) {
            LogFilter.state.sortDirection = LogFilter.state.sortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            LogFilter.state.sortColumn = colName;
            LogFilter.state.sortDirection = 'asc';
          }
          this.header.querySelectorAll('.col').forEach(c => c.classList.remove('sorted'));
          col.classList.add('sorted');
          App.refresh();
        });
      }

      if (def.key !== 'bookmark') {
        const resizer = document.createElement('div');
        resizer.className = 'col-resizer';
        resizer.dataset.col = def.key;
        col.appendChild(resizer);
      }

      this.header.appendChild(col);
    }
    this.bindResizeEvents();
  },

  bindResizeEvents() {
    if (this._headerResizeBound) return;
    this._headerResizeBound = true;

    this.header.addEventListener('mousedown', (e) => {
      const resizer = e.target.closest('.col-resizer');
      if (!resizer) return;
      e.preventDefault();
      e.stopPropagation();
      const colKey = resizer.dataset.col;
      const colEl = resizer.parentElement;
      const startX = e.clientX;
      const startWidth = colEl.offsetWidth;
      const def = this.getAllColDefs().find(d => d.key === colKey);
      const minW = def ? def.minWidth : 40;

      const onMove = (ev) => {
        const diff = ev.clientX - startX;
        const newW = Math.max(minW, startWidth + diff);
        colEl.style.width = newW + 'px';
        colEl.style.minWidth = newW + 'px';
        if (colKey !== 'message') colEl.style.flex = 'none';
        this.columnWidths[colKey] = newW;
        this.header.querySelectorAll(`.${def.className}`).forEach(el => {
          el.style.width = newW + 'px';
          el.style.minWidth = newW + 'px';
        });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        this.render();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    // 双击自适应宽度（除消息列以外）
    this.header.addEventListener('dblclick', (e) => {
      const resizer = e.target.closest('.col-resizer');
      if (!resizer) return;
      const colKey = resizer.dataset.col;
      if (colKey === 'message') return;
      const def = this.columnDefs.find(d => d.key === colKey);
      if (!def) return;
      this.autoFitColumn(colKey);
    });
  },

  // 自适应列宽（使用 Canvas measureText 替代 DOM）
  autoFitColumn(colKey) {
    const def = this.getAllColDefs().find(d => d.key === colKey);
    if (!def) return;
    let maxWidth = 0;

    // 创建共享 Canvas 用于测量文本
    if (!this._measureCanvas) {
      this._measureCanvas = document.createElement('canvas');
      this._measureCtx = this._measureCanvas.getContext('2d');
    }
    const ctx = this._measureCtx;
    ctx.font = '12px monospace';

    const measure = (text) => {
      if (!text) return 0;
      return Math.ceil(ctx.measureText(text).width);
    };

    // 列头标签宽度
    const headerCol = this.header.querySelector(`.${def.className}`);
    if (headerCol) {
      const label = headerCol.querySelector('.col-label');
      if (label) maxWidth = Math.max(maxWidth, measure(label.textContent) + 24);
    }

    // 采样内容行
    const sampleSize = Math.min(this.entries.length, 200);
    const step = Math.max(1, Math.floor(this.entries.length / 200));
    for (let i = 0; i < sampleSize; i += step) {
      const entry = this.entries[i];
      let text = '';
      if (colKey === 'index') text = String(entry.index + 1);
      else if (colKey === 'bookmark') text = '';
      else text = entry[colKey] || '-';
      if (!text) continue;
      maxWidth = Math.max(maxWidth, measure(text) + 18);
    }

    maxWidth = Math.max(maxWidth, def.minWidth);
    maxWidth = Math.min(maxWidth, 600);

    this.header.querySelectorAll(`.${def.className}`).forEach(el => {
      el.style.width = maxWidth + 'px';
      el.style.minWidth = maxWidth + 'px';
      if (colKey !== 'message') el.style.flex = 'none';
    });
    this.columnWidths[colKey] = maxWidth;
    this.renderHeader();
    this.render();
  },

  // 判断字段值是否有实际内容（避免 0 / false 等 falsy 值被误判）
  _hasFieldValue(v) {
    return v !== undefined && v !== null && v !== '';
  },

  // 获取所有条目中有数据的字段集合
  getActiveFields() {
    const active = new Set();
    const stdFields = ['timestamp', 'level', 'pid', 'tid', 'tag', 'source', 'message'];
    const entries = this.entries || [];
    for (const entry of entries) {
      for (const field of stdFields) {
        if (this._hasFieldValue(entry[field])) active.add(field);
      }
      if (entry.customFields) {
        for (const key of Object.keys(entry.customFields)) {
          active.add(key);
        }
      }
      if (active.size >= stdFields.length + 10) break;
    }
    return active;
  },

  showColumnMenu(e, key) {
    const existing = document.getElementById('column-context-menu');
    if (existing) existing.remove();

    const activeFields = this.getActiveFields();

    const menu = document.createElement('div');
    menu.id = 'column-context-menu';
    menu.className = 'column-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    for (const def of this.getAllColDefs()) {
      if (!def.canHide) {
        const item = document.createElement('div');
        item.className = 'ctx-item ctx-item-disabled';
        item.textContent = `${def.label} (固定)`;
        menu.appendChild(item);
        continue;
      }
      // 动态列才需要检查是否有数据；标准列始终显示
      if (def.isDynamic && !activeFields.has(def.key)) continue;
      const item = document.createElement('div');
      item.className = 'ctx-item';
      const hidden = this.hiddenColumns.has(def.key);
      item.textContent = `${hidden ? '☐' : '☑'} ${def.label}`;
      item.addEventListener('click', () => {
        if (hidden) {
          this.hiddenColumns.delete(def.key);
        } else {
          this.hiddenColumns.add(def.key);
        }
        this._userModifiedColumns.add(def.key);
        this.renderHeader();
        this.render();
        menu.remove();
      });
      menu.appendChild(item);
    }

    const sep = document.createElement('div');
    sep.className = 'ctx-separator';
    menu.appendChild(sep);

    const showAll = document.createElement('div');
    showAll.className = 'ctx-item';
    showAll.textContent = '☑ 显示全部';
    showAll.addEventListener('click', () => {
      this.hiddenColumns.clear();
      this._userModifiedColumns.clear();
      this.renderHeader();
      this.render();
      menu.remove();
    });
    menu.appendChild(showAll);

    document.body.appendChild(menu);

    const close = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  },

  bindEvents() {
    this.gridBody.addEventListener('scroll', () => {
      this.header.scrollLeft = this.gridBody.scrollLeft;
      this.onScroll();
    });

    // 同步表头与表格主体的水平滚动
    this.header.addEventListener('scroll', () => {
      this.gridBody.scrollLeft = this.header.scrollLeft;
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (this.totalRows === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.selectRow(Math.min(this.selectedIndex + 1, this.totalRows - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.selectRow(Math.max(this.selectedIndex - 1, 0));
          break;
        case 'PageDown':
          e.preventDefault();
          this.selectRow(Math.min(this.selectedIndex + this.visibleCount, this.totalRows - 1));
          break;
        case 'PageUp':
          e.preventDefault();
          this.selectRow(Math.max(this.selectedIndex - this.visibleCount, 0));
          break;
        case 'Home':
          e.preventDefault();
          this.selectRow(0);
          break;
        case 'End':
          e.preventDefault();
          this.selectRow(this.totalRows - 1);
          break;
      }
    });

    window.addEventListener('resize', Utils.debounce(() => {
      this.calculateVisibleCount();
      this.render();
    }, 100));
  },

  onScroll() {
    if (this._scrollThrottled) return;
    this._scrollThrottled = true;
    requestAnimationFrame(() => {
      this._scrollThrottled = false;
      this._syncFromNativeScroll();
      this.render();
    });
  },

  calculateVisibleCount() {
    this.visibleCount = Math.ceil(this.gridBody.clientHeight / this.rowHeight) + 2;
  },

  // 扫描所有条目，收集 customFields 键名并生成动态列定义
  rebuildDynamicCols(entries) {
    const allKeys = new Set();
    for (let i = 0; i < entries.length; i++) {
      const cf = entries[i].customFields;
      if (cf) {
        for (const key of Object.keys(cf)) {
          allKeys.add(key);
        }
      }
    }
    const newDefs = [];
    // 保持插入顺序
    const seen = new Set();
    for (let i = 0; i < entries.length; i++) {
      const cf = entries[i].customFields;
      if (cf) {
        for (const key of Object.keys(cf)) {
          if (!seen.has(key)) {
            seen.add(key);
            const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
            newDefs.push({
              key: key,
              label: key,
              className: 'col-dynamic col-dynamic-' + safeKey,
              minWidth: 80,
              canHide: true,
              canSort: false,
              isDynamic: true
            });
          }
        }
      }
    }
    this._dynamicColDefs = newDefs;
  },

  setData(entries) {
    this.entries = entries;
    this.totalRows = entries.length;
    this._virtualRow = 0;
    this.selectedIndex = entries.length > 0 ? 0 : -1;
    this.gridBody.scrollTop = 0;
    this.rebuildDynamicCols(entries);
    this.autoHideEmptyColumns(entries);
    this.renderHeader();
    this.render();
    App.updateCurrentRow();
    this.updateStatusBar();
  },

  // 自动隐藏所有条目均为空的列（采样加速）
  // 注意：跳过用户手动操作过的列（_userModifiedColumns），不干预用户的选择
  autoHideEmptyColumns(entries) {
    const stdFields = ['timestamp', 'level', 'pid', 'tid', 'tag', 'source', 'message'];
    const scanLimit = Math.min(entries.length, 200);
    const step = Math.max(1, Math.floor(entries.length / 200));
    for (const field of stdFields) {
      if (this._userModifiedColumns.has(field)) continue;
      let hasValue = false;
      for (let i = 0; i < scanLimit; i += step) {
        if (this._hasFieldValue(entries[i][field])) {
          hasValue = true;
          break;
        }
      }
      if (!hasValue) {
        this.hiddenColumns.add(field);
      } else {
        this.hiddenColumns.delete(field);
      }
    }
  },

  _updateScrollButtons() {
    const btnTop = document.getElementById('btn-scroll-top');
    const btnBottom = document.getElementById('btn-scroll-bottom');
    if (!btnTop || !btnBottom) return;

    if (this.totalRows === 0) {
      btnTop.style.display = 'none';
      btnBottom.style.display = 'none';
      return;
    }

    btnTop.style.display = this._virtualRow <= 1 ? 'none' : 'flex';
    btnBottom.style.display = this._virtualRow >= this.totalRows - this.visibleCount - 1 ? 'none' : 'flex';
  },

  jumpToTop() {
    this.selectRow(0);
  },

  jumpToBottom() {
    this.selectRow(Math.max(0, this.totalRows - 1));
  },

  render() {
    this.calculateVisibleCount();

    if (this.totalRows === 0) {
      this.header.textContent = '';
      this.viewport.innerHTML = '<div class="grid-empty"><div class="grid-empty-icon">📭</div><div>没有匹配的日志条目</div><div class="grid-empty-sub">尝试调整筛选条件或加载其他文件</div></div>';
      this.viewport.style.height = 'auto';
      return;
    }

    const cssHeight = this._getCSSHeight();

    const start = this._virtualRow;
    const end = Math.min(start + this.visibleCount + 5, this.totalRows);
    this.renderedRange = { start, end };

    this.viewport.style.height = cssHeight + 'px';

    const hlCache = LogFilter.state.highlight && LogFilter.state.searchText
      ? LogFilter.computeBatchHighlights(this.entries, start, end) : null;

    const fragment = document.createDocumentFragment();

    const rowsHeight = (end - start) * this.rowHeight;
    const maxTopSpacerHeight = Math.max(0, cssHeight - rowsHeight);
    const nativeSt = this.gridBody.scrollTop;
    const topSpacerHeight = Math.min(nativeSt, maxTopSpacerHeight);
    const bottomSpacerHeight = Math.max(0, cssHeight - topSpacerHeight - rowsHeight);

    const topSpacer = document.createElement('div');
    topSpacer.style.height = topSpacerHeight + 'px';
    fragment.appendChild(topSpacer);

    for (let i = start; i < end; i++) {
      const entry = this.entries[i];
      const row = this.createRow(entry, i, hlCache);
      fragment.appendChild(row);
    }

    if (bottomSpacerHeight > 0) {
      const bottomSpacer = document.createElement('div');
      bottomSpacer.style.height = bottomSpacerHeight + 'px';
      fragment.appendChild(bottomSpacer);
    }

    this.viewport.textContent = '';
    this.viewport.appendChild(fragment);

    this._renderScrollbar();
    this._updateScrollButtons();
  },

  createRow(entry, displayIndex, hlCache) {
    const cn = ['grid-row'];
    if (displayIndex === this.selectedIndex) cn.push('selected');
    if (entry.bookmarked) cn.push('bookmarked');
    const cls = cn.join(' ');

    const w = (k) => {
      const v = this.columnWidths[k];
      return v ? ` style="width:${v}px;min-width:${v}px;flex:none"` : '';
    };

    let html = '';
    html += `<div class="col col-index"${w('index')} title="行号: ${entry.index + 1}">${entry.index + 1}</div>`;
    if (this.isColumnVisible('bookmark')) {
      html += `<div class="col col-bookmark"${w('bookmark')} title="${entry.bookmarked ? '已添加书签' : ''}">${entry.bookmarked ? '🔖' : ''}</div>`;
    }
    if (this.isColumnVisible('timestamp')) {
      html += `<div class="col col-timestamp"${w('timestamp')} title="${this.escapeHtml(entry.timestamp || '-')}">${this._hlText(entry.timestamp || '-', 'timestamp', entry.index, hlCache)}</div>`;
    }
    if (this.isColumnVisible('level')) {
      const lv = entry.level || '-';
      html += `<div class="col col-level level-${lv}"${w('level')} title="${lv}">${this._hlText(lv, 'level', entry.index, hlCache)}</div>`;
    }
    if (this.isColumnVisible('pid')) {
      html += `<div class="col col-pid"${w('pid')} title="${this.escapeHtml(entry.pid || '-')}">${this._hlText(entry.pid || '-', 'pid', entry.index, hlCache)}</div>`;
    }
    if (this.isColumnVisible('tid')) {
      html += `<div class="col col-tid"${w('tid')} title="${this.escapeHtml(entry.tid || '-')}">${this._hlText(entry.tid || '-', 'tid', entry.index, hlCache)}</div>`;
    }
    if (this.isColumnVisible('source')) {
      html += `<div class="col col-source"${w('source')} title="${this.escapeHtml(entry.source || '-')}">${this._hlText(entry.source || '-', 'source', entry.index, hlCache)}</div>`;
    }
    if (this.isColumnVisible('message')) {
      const msg = entry.message || entry.raw;
      html += `<div class="col col-message"${w('message')} title="${this.escapeHtml(msg || '-')}">${this._hlText(msg, 'message', entry.index, hlCache)}</div>`;
    }

    // 动态列（来自 customFields）
    for (const def of this._dynamicColDefs) {
      if (!this.isColumnVisible(def.key)) continue;
      const val = entry.customFields && entry.customFields[def.key] !== undefined ? entry.customFields[def.key] : '-';
      html += `<div class="col ${def.className}"${w(def.key)} title="${this.escapeHtml(val)}">${this.escapeHtml(val)}</div>`;
    }

    const row = document.createElement('div');
    row.className = cls;
    row.dataset.index = entry.index;
    row.dataset.displayIndex = displayIndex;
    row.innerHTML = html;
    row.addEventListener('click', () => {
      this.selectRow(displayIndex);
    });
    row.addEventListener('dblclick', () => {
      App.toggleBookmark(entry);
    });
    return row;
  },

  _hlText(text, field, entryIndex, hlCache) {
    if (!text) return '';
    if (!hlCache || !LogFilter.state.highlight || !LogFilter.state.searchText) {
      return this.escapeHtml(text);
    }
    if (LogFilter.state.highlightFields[field] === false) {
      return this.escapeHtml(text);
    }
    const entryHl = hlCache[entryIndex];
    if (!entryHl || !entryHl[field]) {
      return this.escapeHtml(text);
    }
    const highlights = entryHl[field];
    let result = '';
    let lastEnd = 0;
    for (let k = 0; k < highlights.length; k++) {
      const h = highlights[k];
      result += this.escapeHtml(text.slice(lastEnd, h.start));
      result += '<span class="highlight-match">' + this.escapeHtml(text.slice(h.start, h.end)) + '</span>';
      lastEnd = h.end;
    }
    result += this.escapeHtml(text.slice(lastEnd));
    return result;
  },

  // 共享 escapeHtml div（避免重复创建 DOM）
  _escapeDiv: null,

  escapeHtml(str) {
    if (!this._escapeDiv) this._escapeDiv = document.createElement('div');
    this._escapeDiv.textContent = str;
    return this._escapeDiv.innerHTML;
  },

  selectRow(displayIndex) {
    if (displayIndex < 0 || displayIndex >= this.totalRows) return;
    this.selectedIndex = displayIndex;

    // 行级比较：仅当目标行不在当前可视范围内才滚动
    const renderStart = this._virtualRow;
    const renderEnd = renderStart + this.visibleCount;
    const visibleRows = Math.max(1, renderEnd - renderStart);

    if (displayIndex < renderStart) {
      this._virtualRow = displayIndex;
    } else if (displayIndex >= renderEnd) {
      this._virtualRow = Math.min(displayIndex - visibleRows + 1, this.totalRows - visibleRows);
    }

    this._syncNativeScroll();
    this.render();
    App.updateCurrentRow();
    if (displayIndex >= 0 && displayIndex < this.entries.length) {
      App.showDetail(this.entries[displayIndex]);
    }
  },

  scrollToEntry(entry) {
    if (!entry) return;
    const idx = this.entries.findIndex(e => e.index === entry.index);
    if (idx >= 0) {
      this.selectRow(idx);
    }
  },

  updateStatusBar() {
    const total = LogParser.entries.length;
    const filtered = this.totalRows;
    document.getElementById('entry-count').textContent =
      `显示 ${Utils.formatNumber(filtered)} / ${Utils.formatNumber(total)} 条`;
    document.getElementById('status-text').textContent =
      total > 0 ? `已加载 ${Utils.formatNumber(total)} 条日志` : '就绪';
  },

  refresh() {
    const filtered = LogFilter.apply(LogParser.entries);
    this.setData(filtered);
  },

  getVisibleColumnDefs() {
    return this.getAllColDefs().filter(d => this.isColumnVisible(d.key));
  }
};
