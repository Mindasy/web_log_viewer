// filter.js - 过滤和搜索引擎

const SEARCH_MAX_LENGTH = 200;

const LogFilter = {
  // 过滤状态
  state: {
    searchText: '',
    useRegex: false,
    caseSensitive: false,
    wholeWord: false,
    highlight: true,
    highlightFields: {
      timestamp: true,
      level: true,
      pid: true,
      tid: true,
      source: true,
      message: true
    },
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

  // 正则缓存（避免每次高亮都重新创建 RegExp）
  _regexCache: null,
  _regexCacheKey: '',

  // 应用所有过滤（单次遍历合并）
  apply(entries) {
    const st = this.state;
    const hasSearch = !!st.searchText;
    const searchRe = hasSearch ? this.buildSearchRegex() : null;
    const threadRe = st.threadFilter ? this.buildRegex(st.threadFilter) : null;
    const sourceRe = st.sourceFilter ? this.buildRegex(st.sourceFilter) : null;
    const msgRe = st.messageFilter ? this.buildRegex(st.messageFilter) : null;
    const fromTime = st.timeFrom ? new Date(st.timeFrom).getTime() : null;
    const toTime = st.timeTo ? new Date(st.timeTo).getTime() : null;
    const srcFile = st.sourceFileFilter;

    const result = [];
    if (hasSearch) this.searchMatches = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];

      if (st.levels[e.level] === false) continue;

      if (hasSearch) {
        const text = this.getSearchableText(e);
        if (!searchRe.test(text)) continue;
        this.searchMatches.push(e);
      }

      if (threadRe && !threadRe.test(e.thread)) continue;
      if (sourceRe && !sourceRe.test(e.source)) continue;
      if (msgRe && !msgRe.test(e.message)) continue;
      if (fromTime && (!e.date || e.date.getTime() < fromTime)) continue;
      if (toTime && (!e.date || e.date.getTime() > toTime)) continue;
      if (srcFile && e.sourceFile !== srcFile) continue;

      result.push(e);
    }

    if (st.sortColumn) {
      return this.sortEntries(result);
    }
    return result;
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

  // 构建搜索正则（不带 g flag，避免 test() 跨字符串陷阱）
  buildSearchRegex() {
    if (!this.state.searchText) return null;
    const text = this.state.searchText.length > SEARCH_MAX_LENGTH
      ? this.state.searchText.slice(0, SEARCH_MAX_LENGTH)
      : this.state.searchText;
    const key = `${text}|${this.state.useRegex}|${this.state.caseSensitive}|${this.state.wholeWord}`;
    if (this._regexCache && this._regexCacheKey === key) {
      return this._regexCache;
    }
    let pattern = text;
    if (!this.state.useRegex) {
      pattern = Utils.escapeRegex(pattern);
    }
    if (this.state.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    this._regexCacheKey = key;
    try {
      this._regexCache = new RegExp(pattern, this.state.caseSensitive ? '' : 'i');
      return this._regexCache;
    } catch {
      this._regexCache = null;
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

  // 获取可搜索文本（结果缓存在 entry 上避免重复拼接）
  getSearchableText(entry) {
    if (entry._searchText) return entry._searchText;
    const parts = [entry.timestamp, entry.level, entry.thread, entry.source, entry.message, entry.raw];
    if (entry.customFields) {
      for (const val of Object.values(entry.customFields)) {
        if (val) parts.push(String(val));
      }
    }
    entry._searchText = parts.filter(Boolean).join(' ');
    return entry._searchText;
  },

  // 排序（原位排序，不创建副本）
  sortEntries(entries) {
    if (entries.length <= 1) return entries;
    const col = this.state.sortColumn;
    const dir = this.state.sortDirection === 'asc' ? 1 : -1;
    entries.sort((a, b) => {
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
    return entries;
  },

  // 获取高亮区域（使用独立的 g flag 正则）
  getHighlights(text, field) {
    if (!this.state.highlight || !this.state.searchText) return [];
    if (field && !this.state.highlightFields[field]) return [];
    const re = this._buildHighlightRegex();
    if (!re) return [];
    const matches = [];
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length });
      if (match.index === re.lastIndex) re.lastIndex++;
    }
    return matches;
  },

  _buildHighlightRegex() {
    if (!this.state.searchText) return null;
    const text = this.state.searchText.length > SEARCH_MAX_LENGTH
      ? this.state.searchText.slice(0, SEARCH_MAX_LENGTH)
      : this.state.searchText;
    let pattern = text;
    if (!this.state.useRegex) {
      pattern = Utils.escapeRegex(pattern);
    }
    if (this.state.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    try {
      return new RegExp(pattern, this.state.caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  },

  // 批量计算高亮（用于一次渲染周期内的所有可见行）
  computeBatchHighlights(entries, start, end) {
    if (!this.state.highlight || !this.state.searchText) return null;
    const cache = Object.create(null);
    const re = this._buildHighlightRegex();
    if (!re) return null;
    for (let i = start; i < end; i++) {
      const entry = entries[i];
      const entryHl = Object.create(null);
      for (const field of ['timestamp', 'level', 'pid', 'tid', 'source', 'message']) {
        if (this.state.highlightFields[field] === false) continue;
        const text = entry[field] || (field === 'message' ? entry.raw : '');
        if (!text) continue;
        re.lastIndex = 0;
        const matches = [];
        let match;
        while ((match = re.exec(text)) !== null) {
          matches.push({ start: match.index, end: match.index + match[0].length });
          if (match.index === re.lastIndex) re.lastIndex++;
        }
        if (matches.length > 0) entryHl[field] = matches;
      }
      // 自定义字段高亮
      if (entry.customFields) {
        for (const key of Object.keys(entry.customFields)) {
          const text = entry.customFields[key];
          if (!text) continue;
          re.lastIndex = 0;
          const matches = [];
          let match;
          while ((match = re.exec(text)) !== null) {
            matches.push({ start: match.index, end: match.index + match[0].length });
            if (match.index === re.lastIndex) re.lastIndex++;
          }
          if (matches.length > 0) entryHl['cf:' + key] = matches;
        }
      }
      if (Object.keys(entryHl).length > 0) cache[entry.index] = entryHl;
    }
    return cache;
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
