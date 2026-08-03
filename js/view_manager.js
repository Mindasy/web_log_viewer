// view_manager.js - 视图模式管理器（视图栈 + 面包屑导航）

const ViewManager = {
  stack: [],           // 视图栈
  currentIndex: -1,    // 当前视图索引（-1 = 全局视图）
  MAX_DEPTH: 5,        // 最大视图深度

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
    // 设置视图数据
    App.setViewData(view.entries);
  },

  // 渲染面包屑
  renderBreadcrumb() {
    const container = document.getElementById('view-breadcrumb');
    if (!container) return;
    if (this.stack.length === 0) {
      container.style.display = 'none';
      return;
    }
    let html = '<span class="vb-crumb" data-index="-1">全部日志</span>';
    for (let i = 0; i < this.stack.length; i++) {
      const v = this.stack[i];
      const active = i === this.currentIndex ? ' active' : '';
      html += `<span class="vb-sep">›</span>`;
      html += `<span class="vb-crumb${active}" data-index="${i}">${this._escapeHtml(v.name)}</span>`;
    }
    container.innerHTML = html;
    container.style.display = 'flex';

    // 绑定点击事件
    container.querySelectorAll('.vb-crumb').forEach(el => {
      el.addEventListener('click', () => {
        this.gotoView(el.dataset.index);
      });
    });
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
  },

  _escapeHtml(str) {
    if (!str) return '';
    if (!this._escapeDiv) this._escapeDiv = document.createElement('div');
    this._escapeDiv.textContent = str;
    return this._escapeDiv.innerHTML;
  }
};