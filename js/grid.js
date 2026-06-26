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

  // 列定义
  columnDefs: [
    { key: 'index',     label: '#',     className: 'col-index',       minWidth: 60,  canHide: false },
    { key: 'bookmark',  label: '🔖',    className: 'col-bookmark',    minWidth: 32,  canHide: true },
    { key: 'timestamp', label: '时间戳', className: 'col-timestamp',   minWidth: 100, canHide: true },
    { key: 'level',     label: '级别',   className: 'col-level',       minWidth: 60,  canHide: true },
    { key: 'pid',       label: '进程ID', className: 'col-pid',         minWidth: 60,  canHide: true },
    { key: 'tid',       label: '线程ID', className: 'col-tid',         minWidth: 60,  canHide: true },
    { key: 'source',    label: '来源',   className: 'col-source',      minWidth: 80,  canHide: true },
    { key: 'message',   label: '消息',   className: 'col-message',     minWidth: 120, canHide: true },
  ],

  // 列隐藏状态
  hiddenColumns: new Set(),

  // 自定义列宽
  columnWidths: {},

  // 拖拽调整状态
  _headerResizeBound: false,

  // 初始化
  init() {
    this.viewport = document.getElementById('grid-viewport');
    this.gridBody = document.getElementById('grid-body');
    this.header = document.getElementById('grid-header');
    this.bindEvents();
    this.calculateVisibleCount();
    this.renderHeader();
  },

  // 列头是否可见
  isColumnVisible(key) {
    const def = this.columnDefs.find(d => d.key === key);
    if (!def || !def.canHide) return true;
    return !this.hiddenColumns.has(key);
  },

  // 渲染列头
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

      // 用于 bookmark 列和图标的列用 textContent，避免事件冲突
      col.appendChild(labelSpan);

      // 可隐藏列添加右键菜单
      if (def.canHide) {
        col.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showColumnMenu(e, def.key);
        });
      }

      // 排序点击
      if (def.key !== 'bookmark') {
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

      // 添加拖拽调整手柄（index 和 bookmark 列不允许拖拽）
      if (def.key !== 'index' && def.key !== 'bookmark') {
        const resizer = document.createElement('div');
        resizer.className = 'col-resizer';
        resizer.dataset.col = def.key;
        col.appendChild(resizer);
      }

      this.header.appendChild(col);
    }
    this.bindResizeEvents();
  },

  // 绑定拖拽事件
  bindResizeEvents() {
    if (this._headerResizeBound) return;
    this._headerResizeBound = true;

    this.header.addEventListener('mousedown', (e) => {
      const resizer = e.target.closest('.col-resizer');
      if (!resizer) return;
      e.preventDefault();
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
        this.header.querySelectorAll(`.col.${def.className}`).forEach(el => {
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
  },

  // 列上下文菜单
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

  // 绑定事件
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

  // 滚动事件处理
  onScroll() {
    const newScrollTop = this.gridBody.scrollTop;
    if (Math.abs(newScrollTop - this.scrollTop) < this.rowHeight) return;
    this.scrollTop = newScrollTop;
    this.render();
  },

  // 计算可见行数
  calculateVisibleCount() {
    this.visibleCount = Math.ceil(this.gridBody.clientHeight / this.rowHeight) + 2;
  },

  // 设置数据
  setData(entries) {
    this.entries = entries;
    this.totalRows = entries.length;
    this.scrollTop = 0;
    this.selectedIndex = entries.length > 0 ? 0 : -1;
    this.gridBody.scrollTop = 0;
    this.render();
    this.updateStatusBar();
  },

  // 渲染
  render() {
    this.calculateVisibleCount();

    if (this.totalRows === 0) {
      this.viewport.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">没有匹配的日志条目</div>';
      this.viewport.style.height = 'auto';
      return;
    }

    const totalHeight = this.totalRows * this.rowHeight;
    const start = Math.floor(this.scrollTop / this.rowHeight);
    const end = Math.min(start + this.visibleCount + 5, this.totalRows);
    this.renderedRange = { start, end };

    this.viewport.style.height = totalHeight + 'px';

    // 批量预计算可见行的高亮（一次正则编译，重用所有行）
    const hlCache = LogFilter.state.highlight && LogFilter.state.searchText
      ? LogFilter.computeBatchHighlights(this.entries, start, end) : null;

    const fragment = document.createDocumentFragment();

    const topSpacer = document.createElement('div');
    topSpacer.style.height = (start * this.rowHeight) + 'px';
    fragment.appendChild(topSpacer);

    for (let i = start; i < end; i++) {
      const entry = this.entries[i];
      const row = this.createRow(entry, i, hlCache);
      fragment.appendChild(row);
    }

    this.viewport.textContent = '';
    this.viewport.appendChild(fragment);
  },

  // 创建行
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

    // 索引列（不可隐藏）
    {
      const col = document.createElement('div');
      col.className = 'col col-index';
      col.textContent = entry.index + 1;
      const w = this.columnWidths['index'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    // 书签列
    if (this.isColumnVisible('bookmark')) {
      const col = document.createElement('div');
      col.className = 'col col-bookmark';
      col.textContent = entry.bookmarked ? '🔖' : '';
      const w = this.columnWidths['bookmark'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    // 时间戳列
    if (this.isColumnVisible('timestamp')) {
      const col = document.createElement('div');
      col.className = 'col col-timestamp';
      col.innerHTML = this._hlText(entry.timestamp || '-', 'timestamp', entry.index, hlCache);
      const w = this.columnWidths['timestamp'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    // 级别列
    if (this.isColumnVisible('level')) {
      const col = document.createElement('div');
      col.className = `col col-level level-${entry.level}`;
      col.innerHTML = this._hlText(entry.level || '-', 'level', entry.index, hlCache);
      const w = this.columnWidths['level'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    // 进程ID列
    if (this.isColumnVisible('pid')) {
      const col = document.createElement('div');
      col.className = 'col col-pid';
      col.innerHTML = this._hlText(entry.pid || '-', 'pid', entry.index, hlCache);
      const w = this.columnWidths['pid'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    // 线程ID列
    if (this.isColumnVisible('tid')) {
      const col = document.createElement('div');
      col.className = 'col col-tid';
      col.innerHTML = this._hlText(entry.tid || '-', 'tid', entry.index, hlCache);
      const w = this.columnWidths['tid'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    // 来源列
    if (this.isColumnVisible('source')) {
      const col = document.createElement('div');
      col.className = 'col col-source';
      col.innerHTML = this._hlText(entry.source || '-', 'source', entry.index, hlCache);
      const w = this.columnWidths['source'];
      if (w) { col.style.width = w + 'px'; col.style.minWidth = w + 'px'; }
      row.appendChild(col);
    }

    // 消息列
    if (this.isColumnVisible('message')) {
      const col = document.createElement('div');
      col.className = 'col col-message';
      col.innerHTML = this._hlText(entry.message || entry.raw, 'message', entry.index, hlCache);
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

  // 使用缓存高亮文本（无需正则执行，直接按位置切割）
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

  // 选择行
  selectRow(displayIndex) {
    if (displayIndex < 0 || displayIndex >= this.totalRows) return;
    this.selectedIndex = displayIndex;

    const rowTop = displayIndex * this.rowHeight;
    const rowBottom = rowTop + this.rowHeight;
    const viewTop = this.scrollTop;
    const viewBottom = this.scrollTop + this.gridBody.clientHeight;
    const maxScroll = Math.max(0, this.totalRows * this.rowHeight - this.gridBody.clientHeight);

    if (rowTop < viewTop) {
      this.scrollTop = Math.max(0, rowTop);
    } else if (rowBottom > viewBottom) {
      this.scrollTop = Math.min(rowBottom - this.gridBody.clientHeight, maxScroll);
    }

    this.gridBody.scrollTop = this.scrollTop;
    this.render();

    if (displayIndex >= 0 && displayIndex < this.entries.length) {
      App.showDetail(this.entries[displayIndex]);
    }
  },

  // 滚动到指定条目
  scrollToEntry(entry) {
    if (!entry) return;
    const idx = this.entries.findIndex(e => e.index === entry.index);
    if (idx >= 0) {
      this.selectRow(idx);
    }
  },

  // 更新状态栏
  updateStatusBar() {
    const total = LogParser.entries.length;
    const filtered = this.totalRows;
    document.getElementById('entry-count').textContent =
      `显示 ${Utils.formatNumber(filtered)} / ${Utils.formatNumber(total)} 条`;
    document.getElementById('status-text').textContent =
      total > 0 ? `已加载 ${Utils.formatNumber(total)} 条日志` : '就绪';
  },

  // 刷新（重新应用过滤）
  refresh() {
    const filtered = LogFilter.apply(LogParser.entries);
    this.setData(filtered);
  },

  // 获取可见列配置列表
  getVisibleColumnDefs() {
    return this.columnDefs.filter(d => this.isColumnVisible(d.key));
  }
};
