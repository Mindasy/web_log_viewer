// source_viewer.js - 源码查看器面板（文件树 + 行号代码区 + 目标行高亮）

const SourceViewer = {
  panel: null, treeEl: null, codeEl: null, statusEl: null,
  fileLabel: null, lineInfo: null, projectLabel: null,
  _current: null,          // {entry, lines, line, mode, alternatives, parsed, foundByMethod}
  _expandedDirs: new Set(),

  init() {
    this.panel = document.getElementById('source-viewer-panel');
    this.treeEl = document.getElementById('sv-tree');
    this.codeEl = document.getElementById('sv-code');
    this.statusEl = document.getElementById('sv-status');
    this.fileLabel = document.getElementById('sv-file-label');
    this.lineInfo = document.getElementById('sv-line-info');
    this.projectLabel = document.getElementById('sv-project-label');
    const closeBtn = document.getElementById('btn-close-source-viewer');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (this.statusEl) this.statusEl.addEventListener('click', () => this._onStatusClick());
  },

  toggle() {
    if (!this.panel) return;
    if (this.panel.style.display === 'none' || !this.panel.style.display) {
      this.show(false);
    } else {
      this.close();
    }
  },

  // 非模态停靠：不遮挡日志表格，可对照查看
  show(importHint) {
    if (!this.panel) return;
    this.panel.style.display = 'flex';
    this.renderTree();
    if (importHint || !(SourceLink.files || []).length) {
      this._current = null;
      if (this.codeEl) this.codeEl.innerHTML = '';
      if (this.fileLabel) this.fileLabel.textContent = '';
      if (this.lineInfo) this.lineInfo.textContent = '';
      this.setStatus(importHint ? '点击右上「📦 导入源码包」或「📁 导入目录」后，即可从日志详情跳转源码' : '');
    }
  },

  close() {
    if (this.panel) this.panel.style.display = 'none';
  },

  setStatus(html) {
    if (this.statusEl) this.statusEl.innerHTML = html || '';
  },

  // ===== 文件树 =====

  renderTree() {
    if (!this.treeEl) return;
    const files = SourceLink.files || [];
    this.treeEl.innerHTML = '';
    if (SourceLink.projectLabelEl) { /* noop */ }
    if (this.projectLabel) {
      const name = SourceLink.bundleName || '';
      const n = files.length;
      this.projectLabel.textContent = name
        ? `${name} · ${n} 个源码文件`
        : (n ? `${n} 个源码文件` : '未导入源码');
      this.projectLabel.title = SourceLink.mode === 'dir' ? '项目目录' : '源码包';
    }
    if (!files.length) {
      this.treeEl.innerHTML = '<div class="sv-tree-empty">未导入源码<br/>点击右上「📦 导入源码包」<br/>或「📁 导入目录」</div>';
      return;
    }
    const groups = new Map();
    for (const fe of files) {
      const parts = fe.path.split('/');
      const group = parts.length > 1 ? parts[0] : '(根)';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(fe);
    }
    const ul = document.createElement('ul');
    ul.className = 'sv-tree-root';
    for (const [group, list] of groups) {
      const isDir = group !== '(根)';
      const isOpen = this._expandedDirs.has(group);
      const li = document.createElement('li');
      li.className = 'sv-tree-group';
      const label = document.createElement('div');
      label.className = 'sv-tree-group-label';
      label.textContent = (isDir ? (isOpen ? '▾ ' : '▸ ') : '') + (isDir ? group + '/' : '(根)');
      li.appendChild(label);
      if (!isDir || isOpen) {
        const sub = document.createElement('ul');
        list.sort((a, b) => a.basename.localeCompare(b.basename));
        for (const fe of list) {
          const item = document.createElement('li');
          item.className = 'sv-tree-file' + (this._current && this._current.entry === fe ? ' active' : '');
          item.textContent = fe.path.split('/').pop();
          item.title = fe.path;
          item.addEventListener('click', () => this._openFile(fe));
          sub.appendChild(item);
        }
        li.appendChild(sub);
      }
      if (isDir) {
        label.addEventListener('click', () => {
          if (this._expandedDirs.has(group)) this._expandedDirs.delete(group);
          else this._expandedDirs.add(group);
          this.renderTree();
        });
      } else {
        label.style.cursor = 'default';
      }
      ul.appendChild(li);
    }
    this.treeEl.appendChild(ul);
  },

  _openFile(fe) {
    SourceViewer.open(
      { entry: fe, line: 0, method: '', hasLine: false, mode: '文件树', alternatives: null },
      { file: fe.path, method: '', line: 0, hasLine: false, raw: fe.path }
    );
  },

  // ===== 打开文件并定位 =====

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
    this._renderHeader();
    this._renderCode(lines, line, entry);
    this._renderStatus();
    this.renderTree();
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

  // ===== 代码区渲染 =====

  _renderCode(lines, targetLine, entry) {
    if (!this.codeEl) return;
    this.codeEl.innerHTML = '';
    const total = lines.length;
    const BIG = 20000;
    let start = 1, end = total;
    if (total > BIG) {
      start = Math.max(1, targetLine - 200);
      end = Math.min(total, targetLine + 200);
    }
    const frag = document.createDocumentFragment();
    if (start > 1) frag.appendChild(this._omittedBar(start - 1, '上方省略'));
    for (let n = start; n <= end; n++) {
      const div = document.createElement('div');
      div.className = 'sv-line' + (n === targetLine ? ' sv-line-target' : '');
      div.dataset.num = n;
      const num = document.createElement('span');
      num.className = 'sv-line-num';
      num.textContent = n;
      const code = document.createElement('code');
      code.className = 'sv-code-text';
      code.innerHTML = this._highlightLine(lines[n - 1] || '', entry.lang);
      div.appendChild(num);
      div.appendChild(code);
      div.addEventListener('click', () => this._onCodeLineClick(n));
      frag.appendChild(div);
    }
    if (end < total) frag.appendChild(this._omittedBar(total - end, '下方省略'));
    this.codeEl.appendChild(frag);
    this.codeEl.dataset.total = total;
    if (targetLine >= 1) {
      const t = this.codeEl.querySelector(`.sv-line[data-num="${targetLine}"]`);
      if (t) t.scrollIntoView({ block: 'center' });
    }
  },

  _omittedBar(count, label) {
    const bar = document.createElement('div');
    bar.className = 'sv-omitted';
    bar.textContent = `${label} ${count} 行`;
    return bar;
  },

  _onCodeLineClick(lineNum) {
    const cur = this._current;
    if (!cur) return;
    this.setStatus(
      `<span class="sv-status-mode">行 ${lineNum}</span>` +
      `<span class="sv-status-link" title="点击过滤该文件日志">该文件相关日志 ${this._countRelated(cur.entry)} 条</span>`
    );
  },

  // ===== 轻量语法高亮（字符串/注释/数字/关键字） =====

  _highlightLine(text, lang) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const placeholders = [];
    let s = text;
    // 1. 字符串
    s = s.replace(/("[^"\n]*"|'[^'\n]*')/g, (m) => {
      const idx = placeholders.push('<span class="sv-str">' + esc(m) + '</span>') - 1;
      return '\u0000' + idx + '\u0000';
    });
    // 2. 注释
    if (lang === 'py' || lang === 'sh' || lang === 'pl' || lang === 'rb') {
      s = s.replace(/(^|\s)(#[^\n]*)/g, (m, pre, com) => {
        const idx = placeholders.push(pre + '<span class="sv-com">' + esc(com) + '</span>') - 1;
        return '\u0000' + idx + '\u0000';
      });
    } else if (lang === 'sql') {
      s = s.replace(/(^|\s)(--[^\n]*)/g, (m, pre, com) => {
        const idx = placeholders.push(pre + '<span class="sv-com">' + esc(com) + '</span>') - 1;
        return '\u0000' + idx + '\u0000';
      });
    } else {
      s = s.replace(/(\/\/[^\n]*)/g, (m) => {
        const idx = placeholders.push('<span class="sv-com">' + esc(m) + '</span>') - 1;
        return '\u0000' + idx + '\u0000';
      });
    }
    // 3. 数字
    s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="sv-num">$1</span>');
    // 4. 关键字
    const kws = this._keywords(lang);
    if (kws.length) {
      const re = new RegExp('\\b(' + kws.join('|') + ')\\b', 'g');
      s = s.replace(re, '<span class="sv-key">$1</span>');
    }
    // 5. 还原占位符
    s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => placeholders[parseInt(n, 10)]);
    return s;
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
