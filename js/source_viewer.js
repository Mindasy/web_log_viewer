// source_viewer.js - 源码查看器面板
// v2：文件树懒加载 + 过滤框；代码区完整虚拟滚动（任意大文件）；跨行块注释状态机高亮

const SourceViewer = {
  LINE_H: 20,        // 每行像素高（与 css .sv-line 同步）
  VIEW_BUFFER: 12,   // 可视区上下额外渲染行缓冲
  panel: null, treeWrap: null, treeEl: null, searchInput: null, wrapEl: null, codeEl: null,
  statusEl: null, fileLabel: null, lineInfo: null, projectLabel: null,
  _current: null,          // {entry, lines, line, mode, alternatives, parsed, foundByMethod}
  _expandedDirs: new Set(),
  _filter: '',
  _total: 0,
  _topSpacer: null, _linesWrap: null, _bottomSpacer: null,
  _scrollRaf: null,
  _lineBlocks: null,       // Uint8Array：每行起始是否处于块注释
  _needBlock: false,

  init() {
    this.panel = document.getElementById('source-viewer-panel');
    this.treeWrap = document.getElementById('sv-tree');
    this.treeEl = document.getElementById('sv-tree-list');
    this.searchInput = document.getElementById('sv-tree-search');
    this.wrapEl = document.getElementById('sv-code-wrap');
    this.codeEl = document.getElementById('sv-code');
    this.statusEl = document.getElementById('sv-status');
    this.fileLabel = document.getElementById('sv-file-label');
    this.lineInfo = document.getElementById('sv-line-info');
    this.projectLabel = document.getElementById('sv-project-label');
    const closeBtn = document.getElementById('btn-close-source-viewer');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (this.statusEl) this.statusEl.addEventListener('click', () => this._onStatusClick());
    if (this.searchInput) {
      this.searchInput.addEventListener('input', Utils.debounce(() => {
        this._filter = this.searchInput.value.trim();
        this.renderTree();
      }, 200));
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { this._filter = ''; this.searchInput.value = ''; this.renderTree(); }
      });
    }
    if (this.wrapEl) {
      this.wrapEl.addEventListener('scroll', () => {
        if (this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => {
          this._scrollRaf = null;
          this._applyView();
        });
      });
    }
  },

  toggle() {
    if (!this.panel) return;
    if (this.panel.style.display === 'none' || !this.panel.style.display) this.show(false);
    else this.close();
  },

  // 非模态停靠：不遮挡日志表格，可对照查看
  show(importHint) {
    if (!this.panel) return;
    this.panel.style.display = 'flex';
    this.renderTree();
    if (importHint || !(SourceLink.files || []).length) {
      this._current = null;
      this._resetCodeArea();
      this.setStatus(importHint ? '点击右上「📦 导入源码包」或「📁 导入目录」后，即可从日志详情跳转源码' : '');
    }
  },

  close() {
    if (this.panel) this.panel.style.display = 'none';
  },

  setStatus(html) {
    if (this.statusEl) this.statusEl.innerHTML = html || '';
  },

  // ===== 文件树（懒加载 + 过滤） =====

  _buildDirTree(files) {
    const root = { name: '', full: '', dirs: new Map(), files: [] };
    for (const fe of files) {
      const parts = fe.path.split('/');
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        let sub = cur.dirs.get(seg);
        if (!sub) {
          sub = { name: seg, full: cur.full ? cur.full + '/' + seg : seg, dirs: new Map(), files: [] };
          cur.dirs.set(seg, sub);
        }
        cur = sub;
      }
      cur.files.push(fe);
    }
    return root;
  },

  renderTree() {
    if (!this.treeEl) return;
    const files = SourceLink.files || [];
    this.treeEl.innerHTML = '';
    if (this.projectLabel) {
      const name = SourceLink.bundleName || '';
      const n = files.length;
      const refTag = SourceLink._refMode ? '（日志相关）' : '';
      this.projectLabel.textContent = name
        ? `${name} · ${n} 个源码文件${refTag}`
        : (n ? `${n} 个源码文件${refTag}` : '未导入源码');
      this.projectLabel.title = SourceLink.mode === 'dir' ? '项目目录' : '源码包';
    }
    if (!files.length) {
      this.treeEl.innerHTML = '<div class="sv-tree-empty">未导入源码<br/>点击右上「📦 导入源码包」<br/>或「📁 导入目录」</div>';
      return;
    }
    if (this._filter) this._renderFlat(files, this._filter.toLowerCase());
    else this._renderDirs(this._buildDirTree(files), 0);
  },

  _renderDirs(node, depth) {
    const frag = document.createDocumentFragment();
    const mk = (cls, text) => {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      return div;
    };
    const dirNames = [...node.dirs.keys()].sort();
    for (const name of dirNames) {
      const sub = node.dirs.get(name);
      const open = this._expandedDirs.has(sub.full);
      const li = document.createElement('div');
      li.className = 'sv-tree-group';
      const label = mk('sv-tree-group-label', `${open ? '▾ ' : '▸ '}${name}/`);
      label.title = sub.full;
      label.style.paddingLeft = (depth * 14 + 6) + 'px';
      label.addEventListener('click', () => {
        if (open) this._expandedDirs.delete(sub.full);
        else this._expandedDirs.add(sub.full);
        this.renderTree();
      });
      li.appendChild(label);
      if (open) {
        const inner = document.createElement('div');
        this._renderDirsInto(inner, sub, depth + 1);
        li.appendChild(inner);
      }
      frag.appendChild(li);
    }
    const fileNames = [...node.files].sort((a, b) => a.basename.localeCompare(b.basename));
    for (const fe of fileNames) {
      const item = mk('sv-tree-file' + (this._current && this._current.entry === fe ? ' active' : ''), fe.basename);
      item.title = fe.path;
      item.style.paddingLeft = (depth * 14 + 6) + 'px';
      item.addEventListener('click', () => this._openFile(fe));
      frag.appendChild(item);
    }
    this.treeEl.appendChild(frag);
  },

  // 递归渲染到指定容器（供展开目录逐层加载）
  _renderDirsInto(container, node, depth) {
    const subWrap = document.createElement('div');
    subWrap.className = 'sv-tree-sub';
    // 直接复用 _renderDirs 逻辑需要容器；简化：递归到 treeEl 追加
    this._renderDirsRecur(node, depth, subWrap);
    container.appendChild(subWrap);
  },

  _renderDirsRecur(node, depth, container) {
    const dirNames = [...node.dirs.keys()].sort();
    for (const name of dirNames) {
      const sub = node.dirs.get(name);
      const open = this._expandedDirs.has(sub.full);
      const label = document.createElement('div');
      label.className = 'sv-tree-group-label';
      label.textContent = `${open ? '▾ ' : '▸ '}${name}/`;
      label.title = sub.full;
      label.style.paddingLeft = (depth * 14 + 6) + 'px';
      label.addEventListener('click', () => {
        if (open) this._expandedDirs.delete(sub.full);
        else this._expandedDirs.add(sub.full);
        this.renderTree();
      });
      container.appendChild(label);
      if (open) {
        const subEl = document.createElement('div');
        subEl.className = 'sv-tree-sub';
        this._renderDirsRecur(sub, depth + 1, subEl);
        container.appendChild(subEl);
      }
    }
    const fileNames = [...node.files].sort((a, b) => a.basename.localeCompare(b.basename));
    for (const fe of fileNames) {
      const item = document.createElement('div');
      item.className = 'sv-tree-file' + (this._current && this._current.entry === fe ? ' active' : '');
      item.textContent = fe.basename;
      item.title = fe.path;
      item.style.paddingLeft = (depth * 14 + 6) + 'px';
      item.addEventListener('click', () => this._openFile(fe));
      container.appendChild(item);
    }
  },

  _renderFlat(files, filter) {
    const frag = document.createDocumentFragment();
    let hit = 0;
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    for (const fe of sorted) {
      const lower = fe.path.toLowerCase();
      if (!lower.includes(filter)) continue;
      hit++;
      const item = document.createElement('div');
      item.className = 'sv-tree-file sv-tree-file-flat' + (this._current && this._current.entry === fe ? ' active' : '');
      item.textContent = fe.path;
      item.title = fe.path;
      item.addEventListener('click', () => this._openFile(fe));
      frag.appendChild(item);
    }
    if (!hit) {
      frag.appendChild(this._mkEmpty('无匹配文件'));
    }
    this.treeEl.appendChild(frag);
  },

  _mkEmpty(text) {
    const el = document.createElement('div');
    el.className = 'sv-tree-empty';
    el.textContent = text;
    return el;
  },

  // 展开到指定文件路径的祖先目录并渲染
  _expandTo(path) {
    const parts = path.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i];
      this._expandedDirs.add(acc);
    }
    this._filter = '';
    if (this.searchInput) this.searchInput.value = '';
    this.renderTree();
    const t = this.treeEl.querySelector('.sv-tree-file.active');
    if (t) t.scrollIntoView({ block: 'nearest' });
  },

  _openFile(fe) {
    SourceViewer.open(
      { entry: fe, line: 0, method: '', hasLine: false, mode: '文件树', alternatives: null },
      { file: fe.path, method: '', line: 0, hasLine: false, raw: fe.path }
    );
  },

  // ===== 打开文件并定位（虚拟滚动） =====

  async open(resolved, parsed) {
    const entry = resolved.entry;
    let text = '';
    try {
      text = await SourceLink.getFileText(entry);
    } catch (e) {
      this.showNotFound(parsed.raw, parsed, '文件读取失败: ' + e.message);
      return;
    }
    const lines = text.split('\n');
    let line = resolved.line || 0;
    let foundByMethod = false;
    if (line <= 0 || line > lines.length) {
      const byMethod = SourceLink.findMethodLine(text, parsed.method || resolved.method);
      if (byMethod > 0) { line = byMethod; foundByMethod = true; }
    }
    if (line < 1) line = 1;
    if (line > lines.length) line = Math.max(1, lines.length);
    this._current = {
      entry, lines, line,
      mode: resolved.mode || '',
      alternatives: resolved.alternatives || null,
      parsed, foundByMethod,
    };
    this._total = lines.length;
    this._needBlock = ['c', 'cpp', 'java', 'js', 'ts', 'go', 'rs', 'kotlin', 'swift', 'cs', 'scala'].includes(entry.lang);
    this._lineBlocks = this._needBlock ? this._scanBlocks(lines) : null;
    this._renderHeader();
    this._initVirtualScroll();
    this._renderStatus();
    this._expandTo(entry.path);
  },

  _renderHeader() {
    const cur = this._current;
    if (!cur) return;
    const methodTxt = cur.parsed && cur.parsed.method ? ` · ${cur.parsed.method}` : '';
    if (this.fileLabel) this.fileLabel.textContent = cur.entry.path;
    if (this.lineInfo) {
      this.lineInfo.textContent = `行 ${cur.line}/${cur.lines.length}${methodTxt}` +
        (cur.foundByMethod ? '（定位到方法定义）' : '');
    }
  },

  // ===== 虚拟滚动 =====

  _resetCodeArea() {
    if (this.codeEl) this.codeEl.innerHTML = '';
    if (this.fileLabel) this.fileLabel.textContent = '';
    if (this.lineInfo) this.lineInfo.textContent = '';
    this._total = 0;
  },

  _initVirtualScroll() {
    if (!this.codeEl || !this.wrapEl) return;
    this.codeEl.innerHTML = '';
    this._topSpacer = document.createElement('div');
    this._topSpacer.className = 'sv-spacer';
    this._linesWrap = document.createElement('div');
    this._linesWrap.className = 'sv-lines';
    this._bottomSpacer = document.createElement('div');
    this._bottomSpacer.className = 'sv-spacer';
    this.codeEl.appendChild(this._topSpacer);
    this.codeEl.appendChild(this._linesWrap);
    this.codeEl.appendChild(this._bottomSpacer);
    // 定位目标行到视口中部
    const target = this._current ? this._current.line : 1;
    this.wrapEl.scrollTop = Math.max(0, (target - 1) * this.LINE_H - this.wrapEl.clientHeight / 2);
    this._applyView();
  },

  _applyView() {
    if (!this.wrapEl || !this._linesWrap || !this._topSpacer) return;
    const st = this.wrapEl.scrollTop;
    const vh = this.wrapEl.clientHeight || 400;
    const total = this._total;
    const first = Math.max(1, Math.floor(st / this.LINE_H) - this.VIEW_BUFFER + 1);
    const last = Math.min(total, Math.ceil((st + vh) / this.LINE_H) + this.VIEW_BUFFER);
    this._topSpacer.style.height = (Math.max(0, first - 1) * this.LINE_H) + 'px';
    this._bottomSpacer.style.height = (Math.max(0, total - last) * this.LINE_H) + 'px';
    this._renderLines(first, last);
  },

  _renderLines(first, last) {
    if (!this._linesWrap) return;
    const cur = this._current;
    const lines = cur ? cur.lines : [];
    const lang = cur ? cur.entry.lang : 'text';
    const frag = document.createDocumentFragment();
    for (let n = first; n <= last; n++) {
      const div = document.createElement('div');
      div.className = 'sv-line' + (n === cur.line ? ' sv-line-target' : '');
      div.dataset.num = n;
      const num = document.createElement('span');
      num.className = 'sv-line-num';
      num.textContent = n;
      const code = document.createElement('code');
      code.className = 'sv-code-text';
      const blockStart = this._lineBlocks ? !!this._lineBlocks[n - 1] : false;
      code.innerHTML = this._highlightLine(lines[n - 1] || '', lang, blockStart);
      div.appendChild(num);
      div.appendChild(code);
      div.addEventListener('click', () => this._onCodeLineClick(n));
      frag.appendChild(div);
    }
    this._linesWrap.innerHTML = '';
    this._linesWrap.appendChild(frag);
  },

  _onCodeLineClick(lineNum) {
    const cur = this._current;
    if (!cur) return;
    this.setStatus(
      `<span class="sv-status-mode">行 ${lineNum}</span>` +
      `<span class="sv-status-link" title="点击过滤该文件日志">该文件相关日志 ${this._countRelated(cur.entry)} 条</span>`
    );
  },

  // ===== 轻量语法高亮（字符串/行注释/块注释/预处理/数字/关键字） =====
  // 跨行块注释：预计算 _lineBlocks（每行起始状态），行内解析可独立完成

  _scanBlocks(lines) {
    const arr = new Uint8Array(lines.length);
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      arr[i] = inBlock ? 1 : 0;
      const line = lines[i] || '';
      let j = 0;
      while (j < line.length) {
        const c = line[j], c2 = line[j + 1];
        if (inBlock) {
          if (c === '*' && c2 === '/') { inBlock = false; j += 2; }
          else j++;
        } else if (c === '"' || c === "'") {
          const q = c; j++;
          while (j < line.length) {
            if (line[j] === '\\') j += 2;
            else if (line[j] === q) { j++; break; }
            else j++;
          }
        } else if (c === '/' && c2 === '/') {
          break;
        } else if (c === '/' && c2 === '*') {
          inBlock = true; j += 2;
        } else {
          j++;
        }
      }
    }
    return arr;
  },

  _highlightLine(text, lang, startBlock) {
    const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const hashComment = lang === 'py' || lang === 'sh' || lang === 'pl' || lang === 'rb';
    const dashComment = lang === 'sql';
    const isCppLike = lang === 'c' || lang === 'cpp';
    const kws = this._keywords(lang);
    const kwRe = kws.length ? new RegExp('\\b(' + kws.join('|') + ')\\b') : null;
    let out = '';
    let buf = '';
    const flush = () => {
      if (!buf) return;
      let t = esc(buf);
      t = t.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="sv-num">$1</span>');
      if (kwRe) t = t.replace(kwRe, '<span class="sv-key">$1</span>');
      out += t;
      buf = '';
    };
    const n = text.length;
    let j = 0;
    let inB = !!startBlock;
    // C/C++ 预处理行（行首 #，处于块注释外才染色）
    if (isCppLike && !inB && text.charCodeAt(0) === 35) { // '#'
      return '<span class="sv-pre">' + esc(text) + '</span>';
    }
    while (j < n) {
      const c = text[j], c2 = text[j + 1];
      if (inB) {
        if (c === '*' && c2 === '/') { buf += '*/'; j += 2; inB = false; flush(); continue; }
        buf += c; j++; continue;
      }
      if (c === '/' && c2 === '*') {
        flush();
        out += '<span class="sv-com">/*';
        buf = '';
        j += 2;
        inB = true;
        continue;
      }
      if (c === '/' && c2 === '/' && !hashComment) {
        flush();
        out += '<span class="sv-com">' + esc(text.slice(j)) + '</span>';
        break;
      }
      if (hashComment && c === '#') {
        flush();
        out += '<span class="sv-com">' + esc(text.slice(j)) + '</span>';
        break;
      }
      if (dashComment && c === '-' && c2 === '-') {
        flush();
        out += '<span class="sv-com">' + esc(text.slice(j)) + '</span>';
        break;
      }
      if (c === '"' || c === "'") {
        flush();
        const q = c;
        let k = j + 1;
        let str = q;
        while (k < n) {
          const cc = text[k];
          if (cc === '\\') { str += cc + (text[k + 1] || ''); k += 2; continue; }
          str += cc; k++;
          if (cc === q) break;
        }
        out += '<span class="sv-str">' + esc(str) + '</span>';
        j = k;
        continue;
      }
      buf += c; j++;
    }
    if (inB) {
      out += '<span class="sv-com">' + esc(buf) + '</span>';
      buf = '';
    }
    flush();
    return out;
  },

  _keywords(lang) {
    const map = {
      c: ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return', 'break',
        'continue', 'struct', 'union', 'enum', 'typedef', 'sizeof', 'static', 'const',
        'volatile', 'extern', 'register', 'auto', 'void', 'int', 'char', 'float', 'double',
        'long', 'short', 'unsigned', 'signed', 'goto', 'include', 'define', 'class', 'new'],
      cpp: ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return', 'break',
        'continue', 'struct', 'class', 'public', 'private', 'protected', 'virtual', 'static',
        'const', 'constexpr', 'namespace', 'using', 'template', 'typename', 'new', 'delete',
        'this', 'true', 'false', 'nullptr', 'void', 'int', 'char', 'float', 'double', 'bool',
        'long', 'short', 'unsigned', 'signed', 'auto', 'include', 'define', 'override', 'try',
        'catch', 'throw', 'friend', 'enum', 'typedef'],
      java: ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'return', 'break',
        'continue', 'class', 'interface', 'public', 'private', 'protected', 'static', 'final',
        'abstract', 'extends', 'implements', 'new', 'this', 'super', 'true', 'false', 'null',
        'void', 'int', 'long', 'float', 'double', 'boolean', 'char', 'byte', 'short', 'import',
        'package', 'try', 'catch', 'finally', 'throw', 'throws', 'synchronized', 'enum',
        'instanceof', 'String'],
      py: ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import', 'from',
        'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'break',
        'continue', 'global', 'nonlocal', 'yield', 'and', 'or', 'not', 'in', 'is', 'None',
        'True', 'False', 'self', 'print'],
      js: ['var', 'let', 'const', 'function', 'class', 'return', 'if', 'else', 'for', 'while',
        'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'typeof', 'instanceof',
        'this', 'null', 'undefined', 'true', 'false', 'try', 'catch', 'finally', 'throw',
        'async', 'await', 'export', 'import', 'extends', 'super', 'yield', 'in', 'of'],
      ts: ['var', 'let', 'const', 'function', 'class', 'interface', 'type', 'enum', 'return',
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
        'typeof', 'instanceof', 'this', 'null', 'undefined', 'true', 'false', 'try', 'catch',
        'finally', 'throw', 'async', 'await', 'export', 'import', 'extends', 'implements',
        'super', 'readonly', 'public', 'private', 'protected', 'static', 'abstract', 'yield',
        'in', 'of'],
      go: ['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'map',
        'chan', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue',
        'return', 'go', 'defer', 'select', 'fallthrough', 'goto', 'true', 'false', 'nil',
        'len', 'cap', 'new', 'make', 'append', 'string', 'int', 'bool', 'byte', 'rune',
        'float', 'error'],
      rs: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl', 'mod',
        'use', 'pub', 'crate', 'self', 'Self', 'if', 'else', 'match', 'loop', 'while', 'for',
        'return', 'break', 'continue', 'move', 'ref', 'as', 'where', 'async', 'await', 'true',
        'false', 'Option', 'Result', 'String', 'Vec'],
      sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case',
        'esac', 'function', 'return', 'break', 'continue', 'exit', 'local', 'export', 'echo',
        'read', 'source', 'cd'],
    };
    return map[lang] || [];
  },

  // ===== 状态栏 =====

  _countRelated(entry) {
    const base = entry.basename.toLowerCase();
    const pathLower = entry.path.toLowerCase();
    let n = 0;
    const entries = (typeof LogParser !== 'undefined' && LogParser.entries) || [];
    for (const e of entries) {
      if (!e || !e.source) continue;
      const p = SourceLink.parseSource(e.source);
      if (!p.file) continue;
      const f = p.file.replace(/\\/g, '/').toLowerCase();
      if (f.split('/').pop() === base || f === pathLower || f.endsWith('/' + pathLower)) n++;
    }
    return n;
  },

  _onStatusClick() {
    const cur = this._current;
    if (!cur) return;
    LogFilter.state.sourceFilter = cur.entry.basename;
    if (App && App.refresh) App.refresh();
    Utils.showToast(`已按文件 ${cur.entry.basename} 过滤日志`, 'success');
  },

  _renderStatus() {
    const cur = this._current;
    if (!cur) return;
    const related = this._countRelated(cur.entry);
    this.setStatus(
      `<span class="sv-status-mode">匹配方式: ${cur.mode || '-'}</span>` +
      `<span class="sv-status-link" title="点击过滤该文件的日志">该文件相关日志 ${related} 条</span>`
    );
  },

  showNotFound(src, parsed, extra) {
    this._current = null;
    if (this.codeEl) {
      this.codeEl.innerHTML = `<div class="sv-empty">未找到对应源码文件</div>` +
        `<div class="sv-empty-sub">来源标识: ${this._escapeHtml(src || parsed.raw || '-')}</div>` +
        `<div class="sv-empty-sub">${extra || '请确认已导入包含该文件的项目源码'}</div>`;
    }
    if (this.fileLabel) this.fileLabel.textContent = '';
    if (this.lineInfo) this.lineInfo.textContent = '';
    this.setStatus('');
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
