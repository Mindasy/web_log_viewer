// filter.js - 过滤和搜索引擎

const LogFilter = {
  // 过滤状态
  state: {
    searchText: '',
    useRegex: false,
    caseSensitive: false,
    wholeWord: false,
    highlight: true,
    levels: { FATAL: true, ERROR: true, WARN: true, INFO: true, DEBUG: true, TRACE: true },
    threadFilter: '',
    sourceFilter: '',
    messageFilter: '',
    timeFrom: null,
    timeTo: null,
    sourceFileFilter: '',
    sortColumn: null,
    sortDirection: 'asc'
  },

  // 搜索结果
  searchMatches: [],
  currentMatchIndex: -1,

  // 应用所有过滤
  apply(entries) {
    let filtered = entries;

    // 级别过滤
    filtered = filtered.filter(e => this.state.levels[e.level] !== false);

    // 搜索文本
    if (this.state.searchText) {
      filtered = this.filterBySearch(filtered);
    }

    // 线程过滤
    if (this.state.threadFilter) {
      const re = this.buildRegex(this.state.threadFilter);
      filtered = filtered.filter(e => re.test(e.thread));
    }

    // 来源过滤
    if (this.state.sourceFilter) {
      const re = this.buildRegex(this.state.sourceFilter);
      filtered = filtered.filter(e => re.test(e.source));
    }

    // 消息过滤
    if (this.state.messageFilter) {
      const re = this.buildRegex(this.state.messageFilter);
      filtered = filtered.filter(e => re.test(e.message));
    }

    // 时间范围过滤
    if (this.state.timeFrom) {
      const from = new Date(this.state.timeFrom).getTime();
      filtered = filtered.filter(e => e.date && e.date.getTime() >= from);
    }
    if (this.state.timeTo) {
      const to = new Date(this.state.timeTo).getTime();
      filtered = filtered.filter(e => e.date && e.date.getTime() <= to);
    }

    // 来源文件过滤
    if (this.state.sourceFileFilter) {
      filtered = filtered.filter(e => e.sourceFile === this.state.sourceFileFilter);
    }

    // 排序
    if (this.state.sortColumn) {
      filtered = this.sortEntries(filtered);
    }

    return filtered;
  },

  // 搜索过滤
  filterBySearch(entries) {
    const re = this.buildSearchRegex();
    if (!re) return entries;

    this.searchMatches = [];
    const results = [];

    for (const entry of entries) {
      const text = this.getSearchableText(entry);
      if (re.test(text)) {
        results.push(entry);
        this.searchMatches.push(entry);
      }
    }

    return results;
  },

  // 构建搜索正则
  buildSearchRegex() {
    if (!this.state.searchText) return null;
    let pattern = this.state.searchText;
    if (!this.state.useRegex) {
      pattern = Utils.escapeRegex(pattern);
    }
    if (this.state.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    const flags = this.state.caseSensitive ? 'g' : 'gi';
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  },

  // 构建通用正则
  buildRegex(text) {
    if (!text) return /.*/;
    try {
      return new RegExp(Utils.escapeRegex(text), 'i');
    } catch {
      return /.*/;
    }
  },

  // 获取可搜索文本
  getSearchableText(entry) {
    return [entry.timestamp, entry.level, entry.thread, entry.source, entry.message, entry.raw]
      .filter(Boolean).join(' ');
  },

  // 排序
  sortEntries(entries) {
    const col = this.state.sortColumn;
    const dir = this.state.sortDirection === 'asc' ? 1 : -1;
    return [...entries].sort((a, b) => {
      let va = a[col] || '';
      let vb = b[col] || '';
      if (col === 'index') {
        va = a.index;
        vb = b.index;
      }
      if (col === 'timestamp' && a.date && b.date) {
        return (a.date.getTime() - b.date.getTime()) * dir;
      }
      if (typeof va === 'string') {
        return va.localeCompare(vb) * dir;
      }
      return (va - vb) * dir;
    });
  },

  // 获取高亮区域
  getHighlights(text) {
    if (!this.state.highlight || !this.state.searchText) return [];
    const re = this.buildSearchRegex();
    if (!re) return [];
    const matches = [];
    let match;
    const regex = new RegExp(re.source, re.flags); // 重新创建以重置lastIndex
    while ((match = regex.exec(text)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length });
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
    return matches;
  },

  // 导航到下一个搜索结果
  nextMatch() {
    if (this.searchMatches.length === 0) return -1;
    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchMatches.length;
    return this.currentMatchIndex;
  },

  // 导航到上一个搜索结果
  prevMatch() {
    if (this.searchMatches.length === 0) return -1;
    this.currentMatchIndex = this.currentMatchIndex <= 0
      ? this.searchMatches.length - 1
      : this.currentMatchIndex - 1;
    return this.currentMatchIndex;
  },

  // 获取当前匹配条目
  getCurrentMatch() {
    if (this.currentMatchIndex < 0 || this.currentMatchIndex >= this.searchMatches.length) return null;
    return this.searchMatches[this.currentMatchIndex];
  },

  // 重置搜索
  resetSearch() {
    this.searchMatches = [];
    this.currentMatchIndex = -1;
  },

  // 过滤相似条目
  filterSimilar(entry) {
    if (!entry) return;
    // 按消息模式过滤
    const msg = entry.message.replace(/\d+/g, '\\d+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.state.searchText = msg;
    this.state.useRegex = true;
    this.state.messageFilter = '';
    this.state.threadFilter = '';
    this.state.sourceFilter = '';
    return this.apply(LogParser.entries);
  }
};
