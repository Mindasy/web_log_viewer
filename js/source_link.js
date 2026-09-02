// source_link.js - 日志与代码行关联：源码索引 / source 解析 / 匹配跳转
// 导入途径：源码压缩包（CLI 生成的 source-bundle.zip 或用户自行打包）· 项目目录（webkitdirectory）

const SourceLink = {
  index: null,        // source-index.json（CLI 生成时存在）
  files: [],          // [{path, basename, size, lines, lang, data|file, _text}]
  _byBasename: null,  // Map basename -> [entry]
  _byPath: null,      // Map path -> entry
  mode: '',           // 'zip' | 'dir'
  bundleName: '',

  // 默认排除目录（与 tools/source_link/index_source.py 保持一致，路径片段匹配）
  EXCLUDE_DIRS: [
    '.git', '.svn', '.hg', '.idea', '.vscode', 'node_modules', 'bower_components',
    'vendor', '.venv', 'venv', 'site-packages', '__pycache__', '.gradle', '.m2',
    '.cargo', 'target', 'build', 'dist', 'out', 'bin', 'obj', 'CMakeFiles',
    '.next', '.nuxt', 'Pods', 'DerivedData', '.egg-info', '.pytest_cache',
    '.cache', 'logs', 'tmp', 'temp',
  ],

  // 默认排除文件（basename glob，忽略大小写）
  EXCLUDE_FILES: [
    '*.o', '*.obj', '*.a', '*.so', '*.dylib', '*.dll', '*.exe', '*.class',
    '*.pyc', '*.pyo', '*.jar', '*.war', '*.zip', '*.tar', '*.gz', '*.tgz',
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg', '*.woff', '*.woff2',
    '*.ttf', '*.eot', '*.map', '*.lock', 'package-lock.json', 'yarn.lock',
    'pnpm-lock.yaml', 'Cargo.lock', 'composer.lock', 'Gemfile.lock',
    '.DS_Store', 'Thumbs.db',
  ],

  // 源码白名单扩展名
  SOURCE_EXTS: [
    '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.java', '.py',
    '.go', '.rs', '.js', '.jsx', '.ts', '.tsx', '.kt', '.kts', '.swift', '.cs',
    '.rb', '.php', '.scala', '.lua', '.pl', '.sh', '.sql',
  ],

  LANG_MAP: {
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp',
    '.h': 'cpp', '.hh': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
    '.java': 'java', '.py': 'py', '.go': 'go', '.rs': 'rs',
    '.js': 'js', '.jsx': 'js', '.ts': 'ts', '.tsx': 'ts',
    '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift', '.cs': 'cs',
    '.rb': 'rb', '.php': 'php', '.scala': 'scala', '.lua': 'lua',
    '.pl': 'pl', '.sh': 'sh', '.sql': 'sql',
  },

  init() {
    const btn = document.getElementById('btn-source');
    if (btn) btn.addEventListener('click', () => SourceViewer.toggle());
    const archiveInput = document.getElementById('source-archive-input');
    if (archiveInput) {
      archiveInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) this.importArchive(f);
        archiveInput.value = '';
      });
    }
    const dirInput = document.getElementById('source-dir-input');
    if (dirInput) {
      dirInput.addEventListener('change', (e) => {
        this.importDirectory(e.target.files);
        dirInput.value = '';
      });
    }
    const btnArchive = document.getElementById('btn-source-import-archive');
    if (btnArchive) btnArchive.addEventListener('click', () => archiveInput && archiveInput.click());
    const btnDir = document.getElementById('btn-source-import-dir');
    if (btnDir) btnDir.addEventListener('click', () => dirInput && dirInput.click());
    const btnView = document.getElementById('btn-view-source');
    if (btnView) btnView.addEventListener('click', () => this.viewSelectedSource());
    // 反向索引 toggle「仅日志相关」
    const relatedCb = document.getElementById('sv-only-related');
    if (relatedCb) {
      relatedCb.addEventListener('change', () => this.setOnlyRelated(relatedCb.checked));
    }
  },

  // ===== 过滤规则（目录拖拽 / 无索引压缩包时使用） =====

  _fnmatch(name, pat) {
    // 支持 * 与 ? 的简单 glob（忽略大小写由调用方保证）
    const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return re.test(name);
  },

  _shouldSkip(relPath) {
    const parts = relPath.split('/');
    if (parts.some(p => this.EXCLUDE_DIRS.includes(p))) return true;
    const name = parts[parts.length - 1] || '';
    const lower = name.toLowerCase();
    for (const pat of this.EXCLUDE_FILES) {
      if (this._fnmatch(lower, pat.toLowerCase())) return true;
    }
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? '.' + name.slice(dot + 1).toLowerCase() : '';
    return !this.SOURCE_EXTS.includes(ext);
  },

  _langOf(path) {
    const dot = path.lastIndexOf('.');
    const ext = dot > 0 ? '.' + path.slice(dot + 1).toLowerCase() : '';
    return this.LANG_MAP[ext] || 'text';
  },

  // ===== 导入 =====

  // 目录索引分片大小（每片交给事件循环让出，避免阻塞 UI）
  DIR_BATCH: 1500,

  async importArchive(file, opts) {
    opts = opts || {};
    const onlyRelated = opts.onlyRelated !== undefined ? !!opts.onlyRelated : !!this._onlyRelated;
    const refSet = onlyRelated ? this._getLogRefSet() : null;
    Utils.showLoading('正在解压源码包...');
    try {
      const allFiles = await ArchiveHandler.extract(file);
      let index = null;
      const indexEntry = allFiles.find(f => f.name === 'source-index.json');
      if (indexEntry) {
        try { index = JSON.parse(new TextDecoder('UTF-8').decode(indexEntry.data)); }
        catch (e) { console.warn('source-index.json 解析失败，按默认规则过滤', e); }
      }
      const entries = [];
      const seen = new Set();
      for (const f of allFiles) {
        if (!f.isTextFile) continue;
        const path = f.name.replace(/^\.\//, '');
        if (!path || path === 'source-index.json' || seen.has(path)) continue;
        seen.add(path);
        if (this._shouldSkip(path)) continue;
        if (refSet && !this._matchesLogRef(path, refSet)) continue;
        entries.push({ path, data: f.data, size: f.data.length });
      }
      if (onlyRelated && !entries.length && seen.size > 0) {
        Utils.showToast('未匹配到日志引用的文件，回退为全量索引', 'warn', 3000);
        this.setOnlyRelated(false);
        return this.importArchive(file, { onlyRelated: false });
      }
      this._buildIndex(entries, index, 'zip', file.name, { refMode: onlyRelated });
      Utils.showToast(`已导入源码包 ${file.name}（${this.files.length} 个文件${onlyRelated ? '，日志相关' : ''}）`, 'success', 2500);
    } catch (e) {
      Utils.showToast('源码包导入失败: ' + e.message, 'error');
    }
    Utils.hideLoading();
  },

  async importDirectory(fileList, opts) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    opts = opts || {};
    const rootName = (arr[0].webkitRelativePath || arr[0].name || '项目').split('/')[0];
    const onlyRelated = opts.onlyRelated !== undefined ? !!opts.onlyRelated : !!this._onlyRelated;
    const refSet = onlyRelated ? this._getLogRefSet() : null;
    Utils.showLoading('正在索引项目目录 0/' + arr.length + '...');
    try {
      const seen = new Set();
      const candidates = [];
      for (let s = 0; s < arr.length; s += this.DIR_BATCH) {
        const end = Math.min(s + this.DIR_BATCH, arr.length);
        for (let k = s; k < end; k++) {
          const f = arr[k];
          const rel = (f.webkitRelativePath || f.name || '').replace(/\\/g, '/');
          // webkitRelativePath 形如 "rootName/src/main.cpp"，去掉根目录名
          const path = rel.split('/').slice(1).join('/');
          if (!path || seen.has(path)) continue;
          seen.add(path);
          if (this._shouldSkip(path)) continue;
          if (refSet && !this._matchesLogRef(path, refSet)) continue;
          candidates.push({ path, file: f, size: f.size });
        }
        await this._yield();
        Utils.showLoading(`正在索引项目目录 ${end}/${arr.length}...`);
      }
      if (onlyRelated && !candidates.length && seen.size > 0) {
        Utils.showToast('未匹配到日志引用的文件，回退为全量索引', 'warn', 3000);
        this.setOnlyRelated(false);
        return this.importDirectory(fileList, { onlyRelated: false });
      }
      this._buildIndex(candidates, null, 'dir', rootName, { refMode: onlyRelated });
      Utils.showToast(`已导入项目目录 ${rootName}（${this.files.length} 个源码文件${onlyRelated ? '，日志相关' : ''}）`, 'success', 2500);
    } catch (e) {
      Utils.showToast('项目目录导入失败: ' + e.message, 'error');
    }
    Utils.hideLoading();
  },

  // 让出主线程（分片间调度）
  _yield() {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 60 });
      else setTimeout(resolve, 0);
    });
  },

  // ===== 反向索引（仅日志相关文件） =====

  setOnlyRelated(checked) {
    this._onlyRelated = !!checked;
    const cb = document.getElementById('sv-only-related');
    if (cb) cb.checked = !!checked;
    const cnt = document.getElementById('sv-related-count');
    if (cnt) cnt.textContent = checked ? this._relatedCountText() : '';
  },

  // 日志 source 引用集（与 resolve 同一套键规则，大小写归一）
  _getLogRefSet() {
    if (this._logRefSetCache) return this._logRefSetCache;
    const set = new Set();
    const entries = (typeof LogParser !== 'undefined' && LogParser.entries) || [];
    for (const e of entries) {
      if (!e || !e.source) continue;
      const p = this.parseSource(e.source);
      if (!p.file) continue;
      const f = p.file.replace(/\\/g, '/');
      const lower = f.toLowerCase();
      set.add(lower);
      set.add(lower.split('/').pop());
      // Java 类/包名（无扩展名含点）→ 包路径映射键，如 com.example.Service → com/example/service.java
      const hasExt = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|java|py|go|rs|js|jsx|ts|tsx|kt|kts|swift|cs|rb|php|scala|lua|pl|sh|sql)$/i.test(f);
      if (!f.includes('/') && !hasExt && f.includes('.')) {
        set.add(f.replace(/\./g, '/').toLowerCase() + '.java');
      }
    }
    this._logRefSetCache = set;
    return set;
  },

  invalidateLogRef() {
    this._logRefSetCache = null;
  },

  _relatedCountText() {
    const n = this._getLogRefSet().size;
    return n ? `（日志引用 ${n} 个文件）` : '（日志无引用）';
  },

  // 目录/压缩包内的文件是否被日志引用（basename 或整路径命中）
  _matchesLogRef(path, refSet) {
    const lower = path.toLowerCase();
    const base = lower.split('/').pop();
    return refSet.has(base) || refSet.has(lower);
  },

  // 统一建索引：entries = [{path, data|file, size}]；index 为 CLI 生成的索引（可选）
  _buildIndex(entries, index, mode, bundleName, meta) {
    this.mode = mode;
    this.bundleName = bundleName || '';
    this._refMode = !!(meta && meta.refMode);
    this.files = [];
    this._byPath = new Map();
    this._byBasename = new Map();

    let indexed = 0;
    let skipped = 0;
    const excluded = [];

    for (const en of entries) {
      if (this._shouldSkip(en.path)) { skipped++; excluded.push(en.path); continue; }
      const ext = en.path.includes('.') ? '.' + en.path.split('.').pop().toLowerCase() : '';
      const fe = {
        path: en.path,
        basename: en.path.split('/').pop(),
        size: en.size || 0,
        lines: 0,
        lang: this._langOf(en.path),
      };
      if (en.data) fe.data = en.data;
      if (en.file) fe.file = en.file;
      this.files.push(fe);
      indexed++;
    }

    // 若 CLI 索引存在，用其补充元信息（lines/lang/size）
    if (index && Array.isArray(index.files)) {
      const byPath = new Map();
      for (const it of index.files) byPath.set(it.path, it);
      for (const fe of this.files) {
        const meta = byPath.get(fe.path);
        if (meta) {
          fe.lines = meta.lines || 0;
          fe.lang = meta.lang || fe.lang;
          fe.size = meta.size || fe.size;
        }
      }
      this.index = index;
    } else {
      this.index = null;
    }

    for (const fe of this.files) {
      this._byPath.set(fe.path, fe);
      if (!this._byBasename.has(fe.basename)) this._byBasename.set(fe.basename, []);
      this._byBasename.get(fe.basename).push(fe);
    }

    this.stats = { scanned: entries.length, indexed, skipped };
    this.excluded = excluded;
    if (SourceViewer) SourceViewer.renderTree();
  },

  clear() {
    this.index = null;
    this.files = [];
    this._byBasename = null;
    this._byPath = null;
    this.mode = '';
    this.bundleName = '';
    this._refMode = false;
    this.stats = null;
    this.excluded = null;
    this.invalidateLogRef();
    if (SourceViewer) SourceViewer.renderTree();
  },

  // ===== 内容读取（懒加载） =====

  async getFileText(entry) {
    if (entry._text !== undefined) return entry._text;
    let text = '';
    if (entry.data) {
      text = new TextDecoder('UTF-8').decode(entry.data);
    } else if (entry.file && typeof entry.file.text === 'function') {
      text = await entry.file.text();
    }
    entry._text = text;
    return text;
  },

  // ===== source 解析 =====

  parseSource(src) {
    const raw = (src || '').trim();
    if (!raw) return { file: '', method: '', line: 0, hasLine: false, raw: '' };
    // 已知源码扩展名结尾 → 视为纯文件（如 main.cpp、helper.go）
    if (/(\.(c|cc|cpp|cxx|h|hh|hpp|hxx|java|py|go|rs|js|jsx|ts|tsx|kt|kts|swift|cs|rb|php|scala|lua|pl|sh|sql))$/i.test(raw)) {
      return { file: raw, method: '', line: 0, hasLine: false, raw };
    }
    // 文件:方法:行号  (src/utils/helper.go:DoThing:1000 / com.example.Service:handle:42)
    let m = raw.match(/^(.+?):([A-Za-z_]\w*):(\d+)$/);
    if (m) return { file: m[1], method: m[2], line: parseInt(m[3], 10), hasLine: true, raw };
    // 文件:行号  (main.cpp:42)
    m = raw.match(/^(.+?):(\d+)$/);
    if (m) return { file: m[1], method: '', line: parseInt(m[2], 10), hasLine: true, raw };
    // 包.类.方法（方法名首字母小写，如 com.example.Service.methodName）
    m = raw.match(/^(.+?)\.([a-z][A-Za-z0-9_]*)$/);
    if (m) return { file: m[1], method: m[2], line: 0, hasLine: false, raw };
    // 其余（包名/类名/路径）→ 整体视为文件标识（如 com.example.Service）
    return { file: raw, method: '', line: 0, hasLine: false, raw };
  },

  // ===== 匹配（精确路径 → 尾部路径 → basename → Java 包名） =====

  resolve(parsed) {
    if (!parsed || !parsed.file) return null;
    const file = parsed.file.replace(/\\/g, '/');
    // 1. 精确路径
    let entry = this._byPath.get(file);
    if (entry) return this._mkResolved(entry, parsed, '精确路径');
    // 2. 尾部路径（src/main.cpp 与路径 .../src/main.cpp）
    for (const [p, en] of this._byPath) {
      if (p.endsWith('/' + file)) {
        return this._mkResolved(en, parsed, '路径匹配');
      }
    }
    // 3. basename（含目录名去掉后的文件名）
    const base = file.split('/').pop();
    const hits = base ? this._byBasename.get(base) : null;
    if (hits && hits.length) return this._mkResolved(hits[0], parsed, '文件名匹配', hits);
    // 4. Java 包名 → 路径（com.example.Service → com/example/Service.java）
    if (file.includes('.')) {
      const jpath = file.replace(/\./g, '/') + '.java';
      entry = this._byPath.get(jpath);
      if (entry) return this._mkResolved(entry, parsed, '包名映射');
    }
    return null;
  },

  _mkResolved(entry, parsed, mode, alternatives) {
    return { entry, line: parsed.line, method: parsed.method, hasLine: parsed.hasLine, mode, alternatives };
  },

  // 在文件内容中查找方法定义行（无行号时定位）
  findMethodLine(text, method) {
    if (!method || !text) return 0;
    const re = new RegExp('(^|[^A-Za-z0-9_$])' + Utils.escapeRegex(method) + '\\s*\\(', 'm');
    const m = text.match(re);
    if (!m) return 0;
    return text.slice(0, m.index).split('\n').length;
  },

  // ===== 入口：从详情面板选中行跳转 =====

  viewSelectedSource() {
    const entry = (App && App.getSelectedEntry) ? App.getSelectedEntry() : null;
    if (!entry || !entry.source) {
      Utils.showToast('请先选中一条含来源的日志', 'error');
      return;
    }
    this.openSource(entry.source);
  },

  openSource(src) {
    if (!this.files.length) {
      Utils.showToast('请先导入项目源码（📄 源码）', 'error');
      SourceViewer.show(true);
      return;
    }
    const parsed = this.parseSource(src);
    const resolved = this.resolve(parsed);
    SourceViewer.show();
    if (!resolved) {
      SourceViewer.showNotFound(src, parsed);
      return;
    }
    SourceViewer.open(resolved, parsed);
  }
};
