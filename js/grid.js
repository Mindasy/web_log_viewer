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

  // 初始化
  init() {
    this.viewport = document.getElementById('grid-viewport');
    this.gridBody = document.getElementById('grid-body');
    this.header = document.getElementById('grid-header');
    this.bindEvents();
    this.calculateVisibleCount();
  },

  // 绑定事件
  bindEvents() {
    // 使用 grid-body 原生滚动
    this.gridBody.addEventListener('scroll', () => {
      this.onScroll();
    });

    // 键盘导航
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

    // 列头排序
    this.header.querySelectorAll('.col').forEach(col => {
      col.addEventListener('click', () => {
        const colName = col.dataset.col;
        if (colName === 'bookmark') return;
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
    });

    // 窗口大小变化
    window.addEventListener('resize', Utils.debounce(() => {
      this.calculateVisibleCount();
      this.render();
    }, 100));
  },

  // 滚动事件处理
  onScroll() {
    const newScrollTop = this.gridBody.scrollTop;
    if (Math.abs(newScrollTop - this.scrollTop) < this.rowHeight) return; // 滚动距离不够一行，跳过
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

    // 设置 viewport 总高度，撑开原生滚动条
    this.viewport.style.height = totalHeight + 'px';

    // 构建新内容
    const fragment = document.createDocumentFragment();

    // 顶部占位
    const topSpacer = document.createElement('div');
    topSpacer.style.height = (start * this.rowHeight) + 'px';
    fragment.appendChild(topSpacer);

    // 渲染可见行
    for (let i = start; i < end; i++) {
      const entry = this.entries[i];
      const row = this.createRow(entry, i);
      fragment.appendChild(row);
    }

    // 替换内容（保持 viewport 高度不变，滚动位置由 grid-body 维护）
    this.viewport.textContent = '';
    this.viewport.appendChild(fragment);
  },

  // 创建行
  createRow(entry, displayIndex) {
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

    // 索引列
    const colIndex = document.createElement('div');
    colIndex.className = 'col col-index';
    colIndex.textContent = entry.index + 1;
    row.appendChild(colIndex);

    // 书签列
    const colBookmark = document.createElement('div');
    colBookmark.className = 'col col-bookmark';
    colBookmark.textContent = entry.bookmarked ? '🔖' : '';
    row.appendChild(colBookmark);

    // 时间戳列
    const colTs = document.createElement('div');
    colTs.className = 'col col-timestamp';
    colTs.textContent = entry.timestamp || '-';
    row.appendChild(colTs);

    // 级别列
    const colLevel = document.createElement('div');
    colLevel.className = `col col-level level-${entry.level}`;
    colLevel.textContent = entry.level || '-';
    row.appendChild(colLevel);

    // 进程ID列
    const colPid = document.createElement('div');
    colPid.className = 'col col-pid';
    colPid.textContent = entry.pid || '-';
    row.appendChild(colPid);

    // 线程ID列
    const colTid = document.createElement('div');
    colTid.className = 'col col-tid';
    colTid.textContent = entry.tid || '-';
    row.appendChild(colTid);

    // 来源列
    const colSource = document.createElement('div');
    colSource.className = 'col col-source';
    colSource.textContent = entry.source || '-';
    row.appendChild(colSource);

    // 消息列（带高亮）
    const colMsg = document.createElement('div');
    colMsg.className = 'col col-message';
    colMsg.innerHTML = this.highlightText(entry.message || entry.raw);
    row.appendChild(colMsg);

    // 点击事件
    row.addEventListener('click', () => {
      this.selectRow(displayIndex);
      App.showDetail(entry);
    });

    // 双击 - 切换书签
    row.addEventListener('dblclick', () => {
      App.toggleBookmark(entry);
    });

    return row;
  },

  // 高亮文本
  highlightText(text) {
    if (!text) return '';
    const highlights = LogFilter.getHighlights(text);
    if (highlights.length === 0) return this.escapeHtml(text);

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

    // 确保选中行可见
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

    // 同步原生滚动位置
    this.gridBody.scrollTop = this.scrollTop;
    this.render();

    // 更新详情
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
  }
};
