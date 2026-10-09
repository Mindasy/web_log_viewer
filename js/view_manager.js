// view_manager.js - 视图模式管理器（视图栈 + 面包屑导航）

const ViewManager = {
  stack: [],           // 视图栈
  currentIndex: -1,    // 当前视图索引（-1 = 全局视图）
  MAX_DEPTH: 10,       // 最大视图深度

  // 视图快照包含的结构性过滤字段（搜索属临时查询，不纳入快照）
  SNAPSHOT_KEYS: [
    'pidFilter', 'threadFilter', 'sourceFilter', 'messageFilter',
    'methodFilter', 'sourceFileFilter', 'timeFrom', 'timeTo',
    'sortColumn', 'sortDirection'
  ],

  // 视图对象结构
  // { name: string, entries: [], snapshot: object, timestamp: number }

  // 深拷贝结构性过滤条件（levels 单独拷贝），作为视图的过滤快照
  _captureSnapshot(src) {
    const s = src || LogFilter.state;
    const snap = { levels: { ...(s.levels || {}) } };
    for (const k of this.SNAPSHOT_KEYS) {
      const v = s[k];
      snap[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : (v === undefined ? '' : v);
    }
    return snap;
  },

  // 将快照整体回写到 LogFilter.state（搜索始终清空）
  _restoreSnapshot(snap) {
    const st = LogFilter.state;
    for (const k of this.SNAPSHOT_KEYS) {
      st[k] = (snap && snap[k] !== undefined) ? snap[k] : '';
    }
    st.levels = (snap && snap.levels) ? { ...snap.levels } : { ...st.levels };
    st.searchText = '';
    LogFilter.resetSearch();
  },

  // 清空全部结构性过滤条件（回到全局视图）
  _clearFilterState() {
    const st = LogFilter.state;
    for (const k of this.SNAPSHOT_KEYS) st[k] = '';
    st.sortColumn = null;
    for (const k of Object.keys(st.levels || {})) st.levels[k] = true;
    st.searchText = '';
    LogFilter.resetSearch();
  },

  // 把当前 state 的结构条件固化到当前视图快照（视图内编辑可持久）
  captureToCurrentView() {
    if (this.currentIndex < 0 || !this.stack[this.currentIndex]) return;
    this.stack[this.currentIndex].snapshot = this._captureSnapshot();
  },

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
      snapshot: this._captureSnapshot(filterSnapshot),
      timestamp: Date.now(),
    });
    this.currentIndex = this.stack.length - 1;
    // 创建视图后清空当前搜索内容（过滤状态已固化到视图数据）
    LogFilter.state.searchText = '';
    LogFilter.resetSearch();
    // 用快照回写结构性条件，保证界面显示与视图一致
    this._restoreSnapshot(this.stack[this.currentIndex].snapshot);
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
    // 清空全部结构性过滤条件
    this._clearFilterState();
    App.onViewChanged();
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
    // 整体恢复该视图的过滤快照（含级别/来源/方法/时间/排序等全部结构条件）
    this._restoreSnapshot(view.snapshot);
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
    // 清空全部结构性过滤条件并同步过滤栏（线程定位撤销快照一并失效）
    this._clearFilterState();
    App.onViewChanged();
  },

  _escapeHtml(str) {
    if (!str) return '';
    if (!this._escapeDiv) this._escapeDiv = document.createElement('div');
    this._escapeDiv.textContent = str;
    return this._escapeDiv.innerHTML;
  }
};