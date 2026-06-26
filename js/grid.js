// grid.js - 虚拟滚动日志表格

const LogGrid = {
  // DOM 元素
  viewport: null,
  gridBody: null,
  header: null,

  // 虚拟滚动状态
  rowHeight: 22,
  visibleCount: 0,
  scrollTop: 0,
  totalRows: 0,
  renderedRange: { start: 0, end: 0 },

  // 数据
  entries: [],
  selectedIndex: -1,

  // CSS safe 像素上限（超过此值浏览器精度丢失）
  MAX_SAFE_PX: 33000000,

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

  // 列隐藏状态
  hiddenColumns: new Set(),

  // 自定义列宽
  columnWidths: {},

  // 拖拽调整状态
  _headerResizeBound: false,

  init() {
    this.viewport = document.getElementById('grid-viewport');
    this.gridBody = document.getElementById('grid-body');
    this.header = document.getElementById('grid-header');
    this.bindEvents();
    this.calculateVisibleCount();
    this.renderHeader();
  },

  isColumnVisible(key) {
    const def = this.columnDefs.find(d => d.key === key);
    if (!def || !def.canHide) return true;
    return !this.hiddenColumns.has(key);
  },

  renderHeader() {
    this.header.textContent = '';
    for (const def of this.columnDefs) {
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
      const def = this.columnDefs.find(d => d.key === colKey);
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

  // 自适应列宽
  autoFitColumn(colKey) {
    const def = this.columnDefs.find(d => d.key === colKey);
    if (!def) return;
    let maxWidth = 0;

    // 检查列头标签宽度
    const headerCol = this.header.querySelector(`.${def.className}`);
    if (headerCol) {
      const label = headerCol.querySelector('.col-label');
      if (label) {
        const dummy = document.createElement('span');
        dummy.className = 'col-label';
        dummy.style.cssText = 'position:fixed;visibility:hidden;left:-9999px;white-space:nowrap;font-size:12px;';
        dummy.textContent = label.textContent;
        document.body.appendChild(dummy);
        maxWidth = Math.max(maxWidth, dummy.offsetWidth + 20);
        document.body.removeChild(dummy);
      }
    }

    // 遍历可见行中的内容，取最大宽度
    const visibleCol = this.header.querySelector(`.${def.className}`);
    const sampleSize = Math.min(this.entries.length, 200);
    const step = Math.max(1, Math.floor(this.entries.length / 200));
    for (let i = 0; i < sampleSize; i += step) {
      const entry = this.entries[i];
      let text = '';
      if (colKey === 'index') text = String(entry.index + 1);
      else if (colKey === 'bookmark') text = '';
      else text = entry[colKey] || '-';
      if (!text) continue;
      const dummy = document.createElement('span');
      dummy.style.cssText = 'position:fixed;visibility:hidden;left:-9999px;white-space:nowrap;font-size:12px;font-family:var(--font-mono, monospace);';
      dummy.textContent = text;
      document.body.appendChild(dummy);
      maxWidth = Math.max(maxWidth, dummy.offsetWidth + 16);
      document.body.removeChild(dummy);
    }

    maxWidth = Math.max(maxWidth, def.minWidth);
    const maxAllowed = 600;
    maxWidth = Math.min(maxWidth, maxAllowed);

    this.header.querySelectorAll(`.${def.className}`).forEach(el => {
      el.style.width = maxWidth + 'px';
      el.style.minWidth = maxWidth + 'px';
      if (colKey !== 'message') el.style.flex = 'none';
    });
    this.columnWidths[colKey] = maxWidth;
    this.render();
  },

  showColumnMenu(e, key) {
    const existing = document.getElementById('column-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'column-context-menu';
    menu.className = 'column-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    for (const def of this.columnDefs) {
      if (!def.canHide) {
        const item = document.createElement('div');
        item.className = 'ctx-item ctx-item-disabled';
        item.textContent = `${def.label} (固定)`;
        menu.appendChild(item);
        continue;
      }
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
      this.onScroll();
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

  // 锚点：记录最近一次渲染时 当前scrollTop ↔ 逻辑行号 的映射
  _scrollAnchor: { cssScrollTop: 0, logicalRow: 0 },

  // 锚点最大信任距离（CSS px），超过此值时用纯比例重新校准
  _anchorMaxTrust: 3000,

  get _cssHeight() {
    return Math.min(this.totalRows * this.rowHeight, this.MAX_SAFE_PX);
  },

  get _cssRange() {
    return Math.max(1, this._cssHeight - (this.gridBody.clientHeight || 1));
  },

  get _logicalRange() {
    return Math.max(1, this.totalRows * this.rowHeight - (this.gridBody.clientHeight || 1));
  },

  onScroll() {
    const newScrollTop = this.gridBody.scrollTop;
    const cssRowH = this._cssRowHeight();
    const maxScroll = Math.max(0, this._cssHeight - (this.gridBody.clientHeight || 1));

    if (newScrollTop <= 1) {
      this.scrollTop = 0;
      this._scrollAnchor = { cssScrollTop: 0, logicalRow: 0 };
      this._onScrollFinish();
      return;
    }
    if (newScrollTop >= maxScroll - 1) {
      this.scrollTop = maxScroll;
      this._scrollAnchor = { cssScrollTop: maxScroll, logicalRow: Math.max(0, this.totalRows - 1) };
      this._onScrollFinish();
      return;
    }

    if (Math.abs(newScrollTop - this.scrollTop) < cssRowH) return;
    this.scrollTop = newScrollTop;
    this._onScrollFinish();
  },

  _onScrollFinish() {
    this.render();
  },

  _cssRowHeight() {
    return this._cssHeight / Math.max(1, this.totalRows);
  },

  calculateVisibleCount() {
    this.visibleCount = Math.ceil(this.gridBody.clientHeight / this.rowHeight) + 2;
  },

  setData(entries) {
    this.entries = entries;
    this.totalRows = entries.length;
    this.scrollTop = 0;
    this.selectedIndex = entries.length > 0 ? 0 : -1;
    this.gridBody.scrollTop = 0;
    this._scrollAnchor = { cssScrollTop: 0, logicalRow: 0 };
    this.render();
    App.updateCurrentRow();
    this.updateStatusBar();
  },

  // 通过锚点偏移估算逻辑行号（小滚动用），大滚动回退纯比例
  _cssToLogicalStart(cssScrollTop) {
    if (this.totalRows === 0) return 0;

    const anchor = this._scrollAnchor;
    const cssDelta = cssScrollTop - anchor.cssScrollTop;

    // 滚动距离小 → 用锚点偏移推算（精度高）
    if (Math.abs(cssDelta) < this._anchorMaxTrust) {
      const avgCssRowH = this._cssRowHeight();
      const rowDelta = Math.round(cssDelta / avgCssRowH);
      const estimated = anchor.logicalRow + rowDelta;
      return Math.max(0, Math.min(estimated, this.totalRows - 1));
    }

    // 滚动距离大 → 纯比例重新校准
    const frac = Math.min(1, Math.max(0, cssScrollTop / this._cssRange));
    const logicalScrollTop = frac * this._logicalRange;
    return Math.min(
      Math.max(0, Math.floor(logicalScrollTop / this.rowHeight)),
      Math.max(0, this.totalRows - 1)
    );
  },

  // 将逻辑行号映射为 css scrollTop
  _logicalToCssScrollTop(displayIndex) {
    const fraction = Math.min(1, Math.max(0, (displayIndex * this.rowHeight) / this._logicalRange));
    return fraction * this._cssRange;
  },

  _updateScrollButtons() {
    const maxScroll = Math.max(0, this._cssHeight - (this.gridBody.clientHeight || 1));
    const btnTop = document.getElementById('btn-scroll-top');
    const btnBottom = document.getElementById('btn-scroll-bottom');
    if (!btnTop || !btnBottom) return;

    if (this.totalRows === 0) {
      btnTop.style.display = 'none';
      btnBottom.style.display = 'none';
      return;
    }

    btnTop.style.display = this.scrollTop <= 1 ? 'none' : 'flex';
    btnBottom.style.display = this.scrollTop >= maxScroll - 1 ? 'none' : 'flex';
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
      this.viewport.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">没有匹配的日志条目</div>';
      this.viewport.style.height = 'auto';
      return;
    }

    const cssHeight = this._cssHeight;

    // 通过 CSS scrollTop 比例映射到逻辑行号
    const start = this._cssToLogicalStart(this.scrollTop);
    const end = Math.min(start + this.visibleCount + 5, this.totalRows);
    this.renderedRange = { start, end };

    this.viewport.style.height = cssHeight + 'px';

    const hlCache = LogFilter.state.highlight && LogFilter.state.searchText
      ? LogFilter.computeBatchHighlights(this.entries, start, end) : null;

    const fragment = document.createDocumentFragment();

    const rowsHeight = (end - start) * this.rowHeight;
    const maxTopSpacerHeight = Math.max(0, cssHeight - rowsHeight);
    const topSpacerHeight = Math.min(this.scrollTop, maxTopSpacerHeight);
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

    // 更新锚点：记录当前位置 → 逻辑行号的映射
    this._scrollAnchor = { cssScrollTop: this.scrollTop, logicalRow: start };
  },

  createRow(entry, displayIndex, hlCache) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    row.dataset.index = entry.index;
    row.dataset.displayIndex = displayIndex;

    if (displayIndex === this.selectedIndex) {
      row.classList.add('selected');
    }
    if (entry.bookmarked) {
      row.classList.add('bookmarked');
    }

    {
      const col = document.createElement('div');
      col.className = 'col col-index';
      col.textContent = entry.index + 1;
      col.title = `行号: ${entry.index + 1}`;
      const w = this.columnWidths['index'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    if (this.isColumnVisible('bookmark')) {
      const col = document.createElement('div');
      col.className = 'col col-bookmark';
      col.textContent = entry.bookmarked ? '🔖' : '';
      col.title = entry.bookmarked ? '已添加书签' : '';
      const w = this.columnWidths['bookmark'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    if (this.isColumnVisible('timestamp')) {
      const col = document.createElement('div');
      col.className = 'col col-timestamp';
      col.innerHTML = this._hlText(entry.timestamp || '-', 'timestamp', entry.index, hlCache);
      col.title = entry.timestamp || '-';
      const w = this.columnWidths['timestamp'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    if (this.isColumnVisible('level')) {
      const col = document.createElement('div');
      col.className = `col col-level level-${entry.level}`;
      col.innerHTML = this._hlText(entry.level || '-', 'level', entry.index, hlCache);
      col.title = entry.level || '-';
      const w = this.columnWidths['level'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    if (this.isColumnVisible('pid')) {
      const col = document.createElement('div');
      col.className = 'col col-pid';
      col.innerHTML = this._hlText(entry.pid || '-', 'pid', entry.index, hlCache);
      col.title = entry.pid || '-';
      const w = this.columnWidths['pid'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    if (this.isColumnVisible('tid')) {
      const col = document.createElement('div');
      col.className = 'col col-tid';
      col.innerHTML = this._hlText(entry.tid || '-', 'tid', entry.index, hlCache);
      col.title = entry.tid || '-';
      const w = this.columnWidths['tid'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    if (this.isColumnVisible('source')) {
      const col = document.createElement('div');
      col.className = 'col col-source';
      col.innerHTML = this._hlText(entry.source || '-', 'source', entry.index, hlCache);
      col.title = entry.source || '-';
      const w = this.columnWidths['source'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    if (this.isColumnVisible('message')) {
      const col = document.createElement('div');
      col.className = 'col col-message';
      col.innerHTML = this._hlText(entry.message || entry.raw, 'message', entry.index, hlCache);
      col.title = entry.message || entry.raw || '-';
      const w = this.columnWidths['message'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    row.addEventListener('click', () => {
      this.selectRow(displayIndex);
      App.showDetail(entry);
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
    for (const h of highlights) {
      result += this.escapeHtml(text.slice(lastEnd, h.start));
      result += `<span class="highlight-match">${this.escapeHtml(text.slice(h.start, h.end))}</span>`;
      lastEnd = h.end;
    }
    result += this.escapeHtml(text.slice(lastEnd));
    return result;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  selectRow(displayIndex) {
    if (displayIndex < 0 || displayIndex >= this.totalRows) return;
    this.selectedIndex = displayIndex;

    const totalHeight = this.totalRows * this.rowHeight;
    const clientH = this.gridBody.clientHeight || 1;
    const cssHeight = Math.min(totalHeight, this.MAX_SAFE_PX);
    const maxScroll = Math.max(0, cssHeight - clientH);

    const targetScrollTop = this._logicalToCssScrollTop(displayIndex);

    // 确保选中行在可见区域内
    const cssRowH = this._cssRowHeight();
    const rowTop = displayIndex * cssRowH;
    const rowBottom = rowTop + cssRowH;
    const viewTop = this.scrollTop;
    const viewBottom = this.scrollTop + clientH;

    if (rowTop < viewTop) {
      this.scrollTop = Math.max(0, rowTop);
    } else if (rowBottom > viewBottom) {
      this.scrollTop = Math.min(rowBottom - clientH, maxScroll);
    } else {
      this.scrollTop = Math.min(targetScrollTop, maxScroll);
    }

    this.gridBody.scrollTop = this.scrollTop;
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
    return this.columnDefs.filter(d => this.isColumnVisible(d.key));
  }
};
