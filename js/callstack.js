// callstack.js - 函数调用栈解析与调用栈视图（issue #56）

const CallStack = {
  tree: null,
  fileName: '',
  viewEl: null, treeEl: null, emptyEl: null, fileLabel: null, fileInput: null,
  _selectedNode: null,
  _collapsed: new Set(),
  _countCache: null,
  _viewMode: 'tree',        // 'tree' | 'flow'
  flowEl: null, flowSvg: null, flowDetail: null, tipEl: null,
  searchWrap: null, searchInput: null, searchCount: null,
  _flowFilter: '',           // 流程图搜索关键词
  _detailNode: null,
  _flowNodes: [],           // [{node, x, y, w, h}]

  init() {
    this.viewEl = document.getElementById('callstack-view');
    this.treeEl = document.getElementById('callstack-tree');
    this.emptyEl = document.getElementById('callstack-empty');
    this.fileLabel = document.getElementById('callstack-file-label');
    this.fileInput = document.getElementById('callstack-file-input');
    this.flowEl = document.getElementById('callstack-flow');
    this.flowSvg = document.getElementById('callstack-flow-canvas');
    this.flowDetail = document.getElementById('callstack-flow-detail');
    this.tipEl = document.getElementById('callstack-tip');
    this.searchWrap = document.getElementById('cs-flow-search-wrap');
    this.searchInput = document.getElementById('cs-flow-search');
    this.searchCount = document.getElementById('cs-flow-search-count');
    const loadBtn = document.getElementById('btn-callstack-load');
    if (loadBtn) loadBtn.addEventListener('click', () => this.fileInput && this.fileInput.click());
    if (this.fileInput) {
      this.fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) this.loadFile(f);
        this.fileInput.value = '';
      });
    }
    const modeBtn = document.getElementById('btn-callstack-view-mode');
    if (modeBtn) modeBtn.addEventListener('click', () => this.toggleViewMode());
    if (this.flowDetail) {
      this.flowDetail.addEventListener('click', (e) => {
        if (e.target.classList.contains('cs-detail-close')) this.showNodeDetail(null);
      });
    }
    // 流程图搜索
    if (this.searchInput) {
      this.searchInput.addEventListener('input', Utils.debounce(() => {
        this._flowFilter = this.searchInput.value.trim();
        this.renderFlow();
      }, 200));
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._jumpToNextHit(1);
        else if (e.key === 'Escape') { this._flowFilter = ''; this.searchInput.value = ''; this.renderFlow(); }
      });
    }
  },

  _jumpToNextHit(dir) {
    const hits = this.flowSvg.querySelectorAll('.cs-flow-seg.search-hit');
    if (!hits.length) return;
    const cur = this.flowSvg.querySelector('.cs-flow-seg.search-current');
    let idx = cur ? Array.from(hits).indexOf(cur) : -1;
    idx = (idx + dir + hits.length) % hits.length;
    hits.forEach(n => n.classList.remove('search-current'));
    const target = hits[idx];
    target.classList.add('search-current');
    target.scrollIntoView({ block: 'center', inline: 'center' });
    if (this.searchCount) this.searchCount.textContent = `${idx + 1}/${hits.length}`;
  },

  toggleViewMode() {
    this._viewMode = this._viewMode === 'tree' ? 'flow' : 'tree';
    const btn = document.getElementById('btn-callstack-view-mode');
    if (btn) {
      btn.textContent = this._viewMode === 'tree' ? '▤ 流程图' : '☰ 树状';
      btn.classList.toggle('active', this._viewMode === 'flow');
    }
    // 切换视图不更新背景日志
    if (this._viewMode === 'flow') {
      if (this.tipEl) this.tipEl.textContent = '搜索过滤函数段 · Enter 跳转下一处 · Esc 清除';
      this.flowEl.style.display = 'flex';
      this.treeEl.style.display = 'none';
      if (this.searchWrap) this.searchWrap.style.display = '';
      this.renderFlow();
    } else {
      if (this.tipEl) this.tipEl.textContent = '查看调用栈结构 · 日志详情请切换流程图模式';
      this.flowEl.style.display = 'none';
      this.treeEl.style.display = '';
      if (this.searchWrap) this.searchWrap.style.display = 'none';
      this._flowFilter = '';
      if (this.searchInput) this.searchInput.value = '';
      this.render();
    }
  },

  activate() {
    if (!this.viewEl) return;
    // 调用栈模式下隐藏 canvas 与提示条，让调用栈视图占满面板
    const canvas = document.getElementById('timeline-canvas');
    const hint = document.getElementById('timeline-hint');
    if (canvas) canvas.style.display = 'none';
    if (hint) hint.style.display = 'none';
    this.viewEl.style.display = 'flex';
    // 按当前视图模式渲染（不更新背景日志）
    if (this._viewMode === 'flow') {
      this.flowEl.style.display = 'flex';
      this.treeEl.style.display = 'none';
      if (this.searchWrap) this.searchWrap.style.display = '';
      this.renderFlow();
    } else {
      this.flowEl.style.display = 'none';
      this.treeEl.style.display = '';
      if (this.searchWrap) this.searchWrap.style.display = 'none';
      if (this.tree) this.render();
      else if (this.emptyEl) this.emptyEl.style.display = 'block';
    }
  },

  deactivate() {
    if (this.viewEl) this.viewEl.style.display = 'none';
    const canvas = document.getElementById('timeline-canvas');
    const hint = document.getElementById('timeline-hint');
    if (canvas) canvas.style.display = '';
    if (hint) hint.style.display = '';
  },

  // 解析调用栈文本 → 树（缩进树 或 A <- B <- C 箭头链）
  parse(text) {
    const lines = text.split(/\r?\n/);
    const root = { name: '（根）', parent: null, children: [], depth: -1 };
    const stack = [root];
    let unit = null;
    // 文件同时含缩进树与箭头链时，以缩进树为准（跳过箭头链行，避免其成为根）
    let hasIndent = false;
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (raw.length - raw.trimStart().length > 0) { hasIndent = true; break; }
    }
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      let depth;
      if (/^\t/.test(line)) {
        depth = line.match(/^\t*/)[0].length;
      } else {
        // 自适应缩进单位：取首个非零缩进的宽度作为一级缩进
        if (indent > 0 && unit === null) unit = indent;
        depth = unit ? Math.round(indent / unit) : 0;
      }
      // 箭头链格式 "A <- B <- C"：C 调用 B，B 调用 A，展开为嵌套
      const chain = trimmed.split(/\s*<-\s*/).map(s => s.trim()).filter(Boolean);
      if (chain.length > 1) {
        // 缩进树模式下，箭头链行仅作补充（跳过，避免与树冲突）
        if (hasIndent) continue;
        while (stack.length - 1 > depth) stack.pop();
        if (stack.length - 1 < depth) this._descend(stack, depth);
        let parent = stack[stack.length - 1];
        for (let i = chain.length - 1; i >= 0; i--) {
          const node = { name: chain[i], parent, children: [], depth: parent.depth + 1 };
          parent.children.push(node);
          parent = node;
        }
        continue;
      }
      while (stack.length - 1 > depth) stack.pop();
      if (stack.length - 1 < depth) this._descend(stack, depth);
      const parent = stack[stack.length - 1];
      const node = { name: trimmed, parent, children: [], depth };
      parent.children.push(node);
      stack.push(node);
    }
    this._compact(root);
    return root;
  },

  // 缩进跳跃时沿最后一个子节点下探
  _descend(stack, depth) {
    while (stack.length - 1 < depth) {
      const parent = stack[stack.length - 1];
      const last = parent.children[parent.children.length - 1];
      if (!last) break;
      stack.push(last);
    }
  },

  // 移除深度异常的孤立节点（把子节点深度校正为 parent.depth+1）
  _compact(node) {
    for (const c of node.children) {
      if (c.depth !== node.depth + 1) c.depth = node.depth + 1;
      this._compact(c);
    }
  },

  _countNodes(node) {
    let n = 1;
    for (const c of node.children) n += this._countNodes(c);
    return n;
  },

  // 统计每个函数节点的日志匹配数。
  // 匹配策略：节点名命中 日志方法名 的 完整名 / 简单函数名 / 类名 之一（忽略大小写）。
  _computeCounts() {
    this._countCache = new Map();
    const index = new Map();      // 节点名(原样) -> [nodes]
    const lowerIndex = new Map(); // 节点名(小写) -> [nodes]
    const walk = (node) => {
      node._matchedMethod = null;
      if (!index.has(node.name)) index.set(node.name, []);
      index.get(node.name).push(node);
      const lk = node.name.toLowerCase();
      if (!lowerIndex.has(lk)) lowerIndex.set(lk, []);
      lowerIndex.get(lk).push(node);
      for (const c of node.children) walk(c);
    };
    if (this.tree) walk(this.tree);
    const entries = LogParser.entries || [];
    const seen = new Set();
    for (let i = 0; i < entries.length; i++) {
      const name = Utils.extractMethodName(entries[i].source);
      seen.clear();
      const push = (nodes) => { if (nodes) for (const n of nodes) seen.add(n); };
      push(index.get(name));
      const dotIdx = name.lastIndexOf('.');
      if (dotIdx >= 0) {
        const simple = name.slice(dotIdx + 1);
        const klass = name.slice(0, dotIdx);
        push(index.get(simple));
        push(index.get(klass));
        push(lowerIndex.get(simple.toLowerCase()));
        push(lowerIndex.get(klass.toLowerCase()));
      }
      push(lowerIndex.get(name.toLowerCase()));
      for (const n of seen) {
        if (!n._matchedMethod) n._matchedMethod = name;
        this._countCache.set(n, (this._countCache.get(n) || 0) + 1);
      }
    }
  },

  async loadFile(file) {
    const text = await file.text();
    this.tree = this.parse(text);
    this.fileName = file.name;
    this._collapsed.clear();
    this._selectedNode = null;
    this._countCache = null;
    if (this.fileLabel) {
      this.fileLabel.textContent = `已加载: ${file.name}（${this._countNodes(this.tree)} 个函数）`;
    }
    if (this._viewMode === 'flow') this.renderFlow();
    else this.render();
    Utils.showToast(`已加载调用栈文件 ${file.name}`, 'success', 2000);
  },

  render() {
    if (!this.treeEl) return;
    if (!this.tree) {
      if (this.emptyEl) this.emptyEl.style.display = 'block';
      return;
    }
    this._computeCounts();
    this.treeEl.innerHTML = '';
    this.treeEl.appendChild(this._renderNode(this.tree));
    if (this.emptyEl) this.emptyEl.style.display = 'none';
  },

  // ===== 流程图模式（基于日志：时间→进程→线程→函数→日志） =====

  // 从日志构建流程图数据：PID → 线程 → 函数段序列
  _buildFlowGroups() {
    const entries = LogParser.entries || [];
    if (!entries.length) return [];
    const pidMap = new Map();   // pid -> Map(thread -> entries[])
    for (const e of entries) {
      if (!e || !e.source) continue;   // 跳过无 source 的无效条目（空行等）
      const pid = (e.pid != null && e.pid !== '') ? String(e.pid) : '?';
      if (!pidMap.has(pid)) pidMap.set(pid, new Map());
      const tm = pidMap.get(pid);
      const tid = (e.thread || e.tid || '?').toString();
      if (!tm.has(tid)) tm.set(tid, []);
      tm.get(tid).push(e);
    }
    const groups = [];
    for (const [pid, tm] of pidMap) {
      const threads = [];
      for (const [tid, list] of tm) {
        // 按时间排序
        list.sort((a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0));
        // 按函数名切分为段（A->B->A 模式中同名函数不同段分开）
        const segs = [];
        let cur = null;
        for (const e of list) {
          const fn = Utils.extractMethodName(e.source) || '?';
          if (cur && cur.func === fn) {
            cur.count++;
            cur.entries.push(e);
            this._aggregateLevel(cur, e.level);
          } else {
            cur = { func: fn, count: 1, entries: [e], levels: {} };
            this._aggregateLevel(cur, e.level);
            segs.push(cur);
          }
        }
        threads.push({ name: tid, segments: segs });
      }
      // 线程排序：按首段时间
      threads.sort((a, b) => this._segTime(a) - this._segTime(b));
      groups.push({ pid, threads });
    }
    // PID 排序
    groups.sort((a, b) => {
      const na = parseInt(a.pid, 10), nb = parseInt(b.pid, 10);
      return (isNaN(na) ? 1e9 : na) - (isNaN(nb) ? 1e9 : nb);
    });
    return groups;
  },

  _segTime(thread) {
    const first = thread.segments[0];
    if (first && first.entries[0] && first.entries[0].date) return first.entries[0].date.getTime();
    return 1e12;
  },

  // 统计函数段的日志级别分布
  _aggregateLevel(seg, level) {
    const lv = (level || '').toUpperCase() || 'INFO';
    seg.levels[lv] = (seg.levels[lv] || 0) + 1;
  },

  // 计算函数段状态：FATAL/ERROR > WARN > INFO > TRACE/DEBUG > 无
  _segStatus(seg) {
    const lv = seg.levels || {};
    if (lv.FATAL) return 'fatal';
    if (lv.ERROR) return 'error';
    if (lv.WARN) return 'warn';
    if (lv.INFO) return 'info';
    if (lv.TRACE || lv.DEBUG) return 'trace';
    return 'none';
  },

  // 状态徽标文案（包含关键级别数量）
  _segStatusBadge(seg) {
    const lv = seg.levels || {};
    const parts = [];
    for (const k of ['FATAL', 'ERROR', 'WARN']) {
      if (lv[k]) parts.push(`${k}×${lv[k]}`);
    }
    return parts.join(' ');
  },

  renderFlow() {
    if (!this.flowSvg) return;
    const groups = this._buildFlowGroups();
    if (!groups.length) {
      if (this.emptyEl) this.emptyEl.style.display = 'block';
      return;
    }
    if (this.emptyEl) this.emptyEl.style.display = 'none';
    this.flowSvg.innerHTML = '';
    this._selectedSeg = null;
    const self = this;
    const filter = this._flowFilter.toLowerCase();
    let hitCount = 0;

    for (const group of groups) {
      const gEl = document.createElement('div');
      gEl.className = 'cs-flow-group';
      const gTitle = document.createElement('div');
      gTitle.className = 'cs-flow-group-title';
      gTitle.textContent = `📦 PID ${group.pid}`;
      gEl.appendChild(gTitle);

      for (const thread of group.threads) {
        const lane = document.createElement('div');
        lane.className = 'cs-flow-lane';
        const laneTitle = document.createElement('div');
        laneTitle.className = 'cs-flow-lane-title';
        laneTitle.textContent = `🧵 ${thread.name}`;
        lane.appendChild(laneTitle);

        const body = document.createElement('div');
        body.className = 'cs-flow-lane-body';
        let prevSegEl = null;
        thread.segments.forEach((seg, idx) => {
          const isHit = !filter || seg.func.toLowerCase().includes(filter);
          if (isHit) hitCount++;
          if (!isHit) return;   // 搜索时跳过不匹配的段（不渲染箭头）
          if (prevSegEl) {
            const arrow = document.createElement('span');
            arrow.className = 'cs-flow-arrow';
            arrow.textContent = '→';
            body.appendChild(arrow);
          }
          const segEl = document.createElement('div');
          segEl.className = 'cs-flow-seg';
          const status = this._segStatus(seg);
          segEl.classList.add('status-' + status);
          if (filter && isHit) segEl.classList.add('search-hit');
          // 状态色条（左侧竖条）
          const bar = document.createElement('span');
          bar.className = 'cs-seg-bar';
          bar.textContent = '';
          segEl.appendChild(bar);
          // 状态图标（ERROR/WARN 用醒目符号）
          const icon = document.createElement('span');
          icon.className = 'cs-seg-status';
          icon.textContent = status === 'fatal' ? '✖' : status === 'error' ? '✕' : status === 'warn' ? '⚠' : '';
          if (icon.textContent) segEl.appendChild(icon);
          const fn = document.createElement('span');
          fn.className = 'fn';
          fn.textContent = seg.func;
          const cnt = document.createElement('span');
          cnt.className = 'fcnt';
          cnt.textContent = `${seg.count} 条`;
          segEl.appendChild(fn);
          segEl.appendChild(cnt);
          const badge = this._segStatusBadge(seg);
          if (badge) {
            const b = document.createElement('span');
            b.className = 'cs-seg-badge';
            b.textContent = badge;
            segEl.appendChild(b);
          }
          const t0 = seg.entries[0] && seg.entries[0].date ? Utils.formatDate(seg.entries[0].date, 'HH:mm:ss') : '';
          const t1 = seg.entries[seg.entries.length - 1] && seg.entries[seg.entries.length - 1].date
            ? Utils.formatDate(seg.entries[seg.entries.length - 1].date, 'HH:mm:ss') : '';
          const badgeTxt = badge ? ' · ' + badge : '';
          segEl.title = `${seg.func} · ${seg.count} 条日志 · ${t0} ~ ${t1}${badgeTxt}`;
          segEl.dataset.key = `${group.pid}|${thread.name}|${idx}`;
          segEl.addEventListener('click', () => self._onFlowSegClick(seg, group.pid, thread.name, segEl));
          body.appendChild(segEl);
          prevSegEl = segEl;
        });
        lane.appendChild(body);
        // 搜索时若无匹配段则隐藏泳道
        if (filter && !body.querySelector('.cs-flow-seg')) lane.classList.add('search-hidden');
        gEl.appendChild(lane);
      }
      // 搜索时若组内全部泳道隐藏则隐藏组
      if (filter && !gEl.querySelector('.cs-flow-seg')) gEl.classList.add('search-hidden');
      this.flowSvg.appendChild(gEl);
    }
    // 更新搜索计数
    if (this.searchCount) {
      this.searchCount.textContent = filter ? `${hitCount} 处` : '';
    }
    if (filter && this.searchInput) this.searchInput.classList.add('highlight');
    else if (this.searchInput) this.searchInput.classList.remove('highlight');
  },

  _onFlowSegClick(seg, pid, threadName, el) {
    // 点击不更新背景日志，仅在下方面板展示该段日志
    if (this._selectedSeg === seg) {
      this._selectedSeg = null;
      this.showSegDetail(null);
      el.classList.remove('selected');
      return;
    }
    this._selectedSeg = seg;
    this.flowSvg.querySelectorAll('.cs-flow-seg.selected').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
    this.showSegDetail(seg, pid, threadName);
  },

  // 下方日志面板：展示该函数段的日志列表
  showSegDetail(seg, pid, threadName) {
    if (!this.flowDetail) return;
    if (!seg) {
      this.flowDetail.style.display = 'none';
      this.flowDetail.innerHTML = '';
      return;
    }
    const entries = seg.entries || [];
    const t0 = entries[0] && entries[0].date ? Utils.formatDate(entries[0].date, 'HH:mm:ss') : '';
    let html = '<div class="cs-detail-header">';
    html += `<span class="fn">${seg.func}</span>`;
    html += `<span class="cs-detail-count">${entries.length} 条 · ${threadName}</span>`;
    html += `<span class="cs-detail-close" title="关闭">✕</span></div>`;
    if (!entries.length) {
      html += '<div class="cs-detail-empty">该函数没有日志</div>';
    } else {
      html += '<div class="cs-detail-list">';
      for (const e of entries.slice(0, 200)) {
        const time = e.date ? Utils.formatDate(e.date, 'HH:mm:ss') : '--:--:--';
        html += `<div class="cs-detail-item" data-idx="${e.index}">`;
        html += `<span class="d-time">${time}</span>`;
        html += `<span class="d-level" style="background:${this._levelColor(e.level)}">${e.level}</span>`;
        html += `<span class="d-msg"></span>`;
        // v2：source 可解析时提供「查看代码」入口
        if (e.source && typeof SourceLink !== 'undefined' && SourceLink.parseSource(e.source).file) {
          html += `<span class="d-src" data-idx="${e.index}" title="查看对应源代码行">📄</span>`;
        }
        html += `</div>`;
      }
      html += '</div>';
    }
    this.flowDetail.innerHTML = html;
    this.flowDetail.style.display = 'flex';
    const items = this.flowDetail.querySelectorAll('.cs-detail-item');
    items.forEach((item, i) => {
      const e = entries[i];
      const msg = item.querySelector('.d-msg');
      if (msg && e) msg.textContent = e.message || e.raw || '';
      const srcBtn = item.querySelector('.d-src');
      if (srcBtn && e) {
        srcBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          SourceLink.openSource(e.source);
        });
      }
      item.addEventListener('click', () => this._locateEntry(e));
    });
  },

  _levelColor(level) {
    const map = {
      FATAL: '#c0392b', ERROR: '#e74c3c', WARN: '#f39c12',
      INFO: '#2ecc71', DEBUG: '#3498db', TRACE: '#95a5a6',
    };
    return map[level] || '#95a5a6';
  },

  _locateEntry(entry) {
    if (!entry) return;
    if (App && App.gotoEntry) App.gotoEntry(entry);
    else if (App && App.jumpToEntry) App.jumpToEntry(entry);
  },

  _renderNode(node) {
    const ul = document.createElement('ul');
    for (const child of node.children) {
      const li = document.createElement('li');
      li.className = 'cs-node';
      if (child === this._selectedNode) li.classList.add('selected');
      const line = document.createElement('div');
      line.className = 'cs-line';
      const isCollapsed = this._collapsed.has(child);
      const toggle = document.createElement('span');
      toggle.className = 'cs-toggle';
      if (child.children.length > 0) {
        toggle.textContent = isCollapsed ? '▸' : '▾';
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this._collapsed.has(child)) this._collapsed.delete(child);
          else this._collapsed.add(child);
          this.render();
        });
      } else {
        toggle.textContent = '·';
      }
      const name = document.createElement('span');
      name.className = 'cs-name';
      name.textContent = child.name;
      const count = document.createElement('span');
      count.className = 'cs-count';
      const c = this._countCache ? (this._countCache.get(child) || 0) : 0;
      if (c > 0) {
        count.textContent = `${c} 条`;
        line.classList.add('has-logs');
        line.title = '点击过滤对应日志';
        line.addEventListener('click', () => this.selectNode(child));
      }
      line.appendChild(toggle);
      line.appendChild(name);
      line.appendChild(count);
      li.appendChild(line);
      if (child.children.length > 0 && !isCollapsed) {
        li.appendChild(this._renderNode(child));
      }
      ul.appendChild(li);
    }
    return ul;
  },

  selectNode(node) {
    // 树状模式：仅高亮选中，不更新背景日志（日志详情在流程图模式的下方面板）
    this._selectedNode = (this._selectedNode === node) ? null : node;
    this.render();
  },

  // 根到节点的完整调用路径
  _getPath(node) {
    const path = [];
    let cur = node;
    while (cur && cur.parent) {
      path.unshift(cur.name);
      cur = cur.parent;
    }
    return path;
  }
};
