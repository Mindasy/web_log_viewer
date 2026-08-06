// view_manager.js - 视图模式管理器（视图栈 + 面包屑导航）

const ViewManager = {
  stack: [],           // 视图栈
  currentIndex: -1,    // 当前视图索引（-1 = 全局视图）
  MAX_DEPTH: 10,       // 最大视图深度

  // 视图对象结构
  // { name: string, entries: [], searchText: string, pidFilter: string,
  //   threadFilter: string, levelFilter: object, timestamp: number }

  // 创建并推入新视图
  pushView(name, entries, filterSnapshot) {
    if (this.currentIndex >= this.MAX_DEPTH - 1) {
      Utils.showToast(`已达到最大视图深度 (${this.MAX_DEPTH} 层)`, 'warn');
      return false;
    }
    // 如果当前不在栈顶，截断后面的视图
    if (this.currentIndex < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.currentIndex + 1);
    }
    this.stack.push({
      name,
      entries,
      searchText: filterSnapshot.searchText || '',
      pidFilter: filterSnapshot.pidFilter || '',
      threadFilter: filterSnapshot.threadFilter || '',
      levelFilter: filterSnapshot.levels ? { ...filterSnapshot.levels } : {},
      timestamp: Date.now(),
    });
    this.currentIndex = this.stack.length - 1;
    // 创建视图后清空当前搜索内容（过滤状态已固化到视图数据）
    LogFilter.state.searchText = '';
    LogFilter.resetSearch();
    this._syncFilterInputs(this.stack[this.currentIndex]);
    App.setViewData(this.stack[this.currentIndex].entries);
    this.renderBreadcrumb();
    return true;
  },

  // 回退到上一级
  popView() {
    if (this.currentIndex <= 0) {
      this._resetToGlobal();
      return false;
    }
    this.currentIndex--;
    this._applyView();
    this.renderBreadcrumb();
    return true;
  },

  // 跳转到指定层级
  gotoView(index) {
    const idx = Number(index);
    if (idx < -1 || idx >= this.stack.length) return false;
    if (idx === -1) {
      this._resetToGlobal();
      return true;
    }
    this.currentIndex = idx;
    this._applyView();
    this.renderBreadcrumb();
    return true;
  },

  // 获取当前视图的 entries
  getCurrentEntries() {
    if (this.currentIndex < 0 || this.stack.length === 0) {
      return LogParser.entries;
    }
    return this.stack[this.currentIndex].entries;
  },

  // 是否在视图模式中
  isInView() {
    return this.currentIndex >= 0 && this.stack.length > 0;
  },

  // 在视图内搜索（返回过滤结果，不创建新视图）
  searchInView(searchText) {
    const viewEntries = this.getCurrentEntries();
    if (!searchText) return viewEntries;
    const re = LogFilter.buildSearchRegex(searchText);
    if (!re) return viewEntries;
    const results = [];
    for (const e of viewEntries) {
      if (re.test(e.raw)) results.push(e);
    }
    return results;
  },

  // 恢复全局视图
  _resetToGlobal() {
    this.currentIndex = -1;
    // 清空过滤状态
    LogFilter.state.searchText = '';
    LogFilter.state.pidFilter = '';
    LogFilter.state.threadFilter = '';
    LogFilter.resetSearch();
    // 同步 DOM 输入框
    this._syncFilterInputs({ pidFilter: '', threadFilter: '' });
    App.refresh();
    this.renderBreadcrumb();
  },

  // 应用当前视图
  _applyView() {
    if (this.currentIndex < 0) {
      this._resetToGlobal();
      return;
    }
    const view = this.stack[this.currentIndex];
    // 恢复过滤状态（但不触发搜索，因为视图数据已确定）
    LogFilter.state.searchText = '';
    LogFilter.state.pidFilter = view.pidFilter;
    LogFilter.state.threadFilter = view.threadFilter;
    LogFilter.resetSearch();
    // 同步 DOM 输入框，保持界面一致性
    this._syncFilterInputs(view);
    // 设置视图数据
    App.setViewData(view.entries);
  },

  // 同步 DOM 过滤输入框到视图状态
  _syncFilterInputs(view) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const pidInput = document.getElementById('filter-pid');
    if (pidInput) pidInput.value = view.pidFilter || '';
    const threadInput = document.getElementById('filter-thread');
    if (threadInput) threadInput.value = view.threadFilter || '';
  },

  // 渲染面包屑
  renderBreadcrumb() {
    const container = document.getElementById('view-breadcrumb');
    if (!container) return;
    if (this.stack.length === 0) {
      container.style.display = 'none';
      return;
    }
    const globalActive = this.currentIndex === -1 ? ' active' : '';
    let html = `<span class="vb-crumb${globalActive}" data-index="-1">全部日志</span>`;
    for (let i = 0; i < this.stack.length; i++) {
      const v = this.stack[i];
      const active = i === this.currentIndex ? ' active' : '';
      html += `<span class="vb-sep">›</span>`;
      // 视图项：名称 + 复制按钮 + 仅当前选中视图显示 ✕ 关闭按钮
      html += `<span class="vb-crumb${active}" data-index="${i}">${this._escapeHtml(v.name)}` +
        `<span class="vb-copy" data-index="${i}" title="复制视图名称">⧉</span>` +
        (active ? `<span class="vb-close-single" data-index="${i}" title="关闭该视图及之后的所有视图">✕</span>` : '') +
        `</span>`;
    }
    // 关闭全部视图：清空视图栈并退出视图界面（隐藏面包屑）
    html += `<span class="vb-close-all" title="关闭全部视图">✕</span>`;
    container.innerHTML = html;
    container.style.display = 'flex';

    // 点击面包屑跳转
    container.querySelectorAll('.vb-crumb').forEach(el => {
      el.addEventListener('click', () => {
        this.gotoView(el.dataset.index);
      });
    });
    // 复制视图名称
    container.querySelectorAll('.vb-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = this.stack[Number(btn.dataset.index)];
        if (!v) return;
        this._copyText(v.name);
      });
    });
    // 每个视图的 ✕：关闭该视图及之后的所有视图（阻止冒泡到跳转）
    container.querySelectorAll('.vb-close-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeViewAt(Number(btn.dataset.index));
      });
    });
    // 关闭全部视图
    const closeAll = container.querySelector('.vb-close-all');
    if (closeAll) {
      closeAll.addEventListener('click', () => {
        this.clear();
      });
    }
  },

  // 复制文本到剪贴板（带降级方案）
  _copyText(text) {
    const done = () => Utils.showToast(`已复制视图名称: ${text}`, 'success', 1500);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this._copyFallback(text, done));
    } else {
      this._copyFallback(text, done);
    }
  },

  _copyFallback(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      Utils.showToast('复制失败', 'error');
    }
    document.body.removeChild(ta);
  },

  // 关闭第 i 个视图及其之后的所有视图（栈截断）
  closeViewAt(i) {
    if (i < 0 || i >= this.stack.length) return;
    this.stack = this.stack.slice(0, i);
    if (this.stack.length === 0) {
      this._resetToGlobal();
      return;
    }
    // 当前视图若位于被关闭区间，落到新的栈顶
    if (this.currentIndex >= this.stack.length) {
      this.currentIndex = this.stack.length - 1;
    }
    if (this.currentIndex >= 0) {
      this._applyView();
    }
    this.renderBreadcrumb();
  },

  // 清除所有视图
  clear() {
    this.stack = [];
    this.currentIndex = -1;
    this.renderBreadcrumb();
    LogFilter.state.searchText = '';
    LogFilter.state.pidFilter = '';
    LogFilter.state.threadFilter = '';
    LogFilter.resetSearch();
    // 同步过滤输入框，保持界面一致（清除/重新加载后不残留旧过滤文本）
    this._syncFilterInputs({ pidFilter: '', threadFilter: '' });
  },

  _escapeHtml(str) {
    if (!str) return '';
    if (!this._escapeDiv) this._escapeDiv = document.createElement('div');
    this._escapeDiv.textContent = str;
    return this._escapeDiv.innerHTML;
  }
};