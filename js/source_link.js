// source_link.js - 日志与代码行关联：源码索引 / source 解析 / 匹配跳转
// 数据源抽象（4 种模式）：
//   zip    源码压缩包（CLI 生成的 source-bundle.zip 或用户自行打包）
//   dir    项目目录（webkitdirectory）
//   server 同源服务端（server.py --project 提供 /source/index.json + /source/files/<path>）
//   http   任意 HTTP 索引 URL（托管 source-index.json + 源码文件）

const SourceLink = {
  files: [],          // [{path, basename, size, lines, lang, data|file|url, _text}]
  _byBasename: null,  // Map basename -> [entry]
  _byPath: null,      // Map path -> entry
  mode: '',           // 数据源：'zip' | 'dir' | 'server' | 'http'
  bundleName: '',

  // 解码文本缓存上限：超过后淘汰最久未用者，避免长时间浏览源码内存持续增长
  TEXT_CACHE_MAX: 6,
  _textLRU: [],       // 最近使用的文件条目（队首最新）

  // 用户自定义排除规则（面板内增删，跨导入保留）
  _userExcludeDirs: [],
  _userExcludeFiles: [],
  // 导入时的原始条目（供排除规则变更后重新过滤）
  _rawEntries: null,
  // 服务端探测状态：''（未探测）| 'ready' | 'disabled' | 'offline'
  _serverState: '',
  // 已配置的服务端地址（'' = 同源；静态 file:// 打开时需填具体地址）
  _serverBase: '',

  // 数据源模式的展示标签（徽标 / 切换提示共用）
  MODE_LABELS: {
    zip: '📦 本地包',
    dir: '📁 本地目录',
    server: '🖥 服务端',
    http: '🔗 HTTP 索引',
  },
  MODE_TITLES: {
    zip: '本地源码包（zip/tar.gz）',
    dir: '本地项目目录',
    server: '服务端源码（server.py --project）',
    http: 'HTTP 索引 URL',
  },

  // 默认排除目录（与 server.py 及前端规则保持一致，路径片段匹配）
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
    // 远程数据源：服务端（同源 /source/*）与任意 HTTP 索引 URL
    const remoteUrlEl = document.getElementById('sv-remote-url');
    const btnServer = document.getElementById('btn-source-import-server');
    if (btnServer) btnServer.addEventListener('click', () => {
      this.importFromServer(remoteUrlEl ? remoteUrlEl.value.trim() : '');
    });
    const btnHttp = document.getElementById('btn-source-import-http');
    if (btnHttp) btnHttp.addEventListener('click', () => {
      this.importFromHttp(remoteUrlEl ? remoteUrlEl.value.trim() : '');
    });
    // 恢复上次配置的服务端地址并探测（静态打开时靠它识别服务端）
    try {
      const saved = localStorage.getItem('sv-server-base');
      if (saved) {
        this._serverBase = saved;
        if (remoteUrlEl) remoteUrlEl.value = saved;
      }
    } catch (e) { /* localStorage 不可用 */ }
    this.detectServer();
  },

  // ===== 过滤规则（目录拖拽 / 无索引压缩包时使用） =====

  _fnmatch(name, pat) {
    // 支持 * 与 ? 的简单 glob（忽略大小写由调用方保证）
    const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return re.test(name);
  },

  _shouldSkip(relPath) {
    const parts = relPath.split('/');
    if (parts.some(p => this.EXCLUDE_DIRS.includes(p) || this._userExcludeDirs.includes(p))) return true;
    const name = parts[parts.length - 1] || '';
    const lower = name.toLowerCase();
    for (const pat of this.EXCLUDE_FILES.concat(this._userExcludeFiles)) {
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

  // 数据源切换提示（同模式重导入 / 首次导入时为空串）
  _switchNote(prevMode) {
    const cur = this.mode;
    if (!prevMode || prevMode === cur) return '';
    const a = this.MODE_LABELS[prevMode] || prevMode;
    const b = this.MODE_LABELS[cur] || cur;
    return `（数据源已切换：${a} → ${b}）`;
  },

  // 是否已导入源码：用于跳转入口显隐（未导入时不显示链接，避免"能点却不能跳"）
  isLoaded() {
    return this.files.length > 0;
  },

  // ===== 导入 =====

  // 目录索引分片大小（每片交给事件循环让出，避免阻塞 UI）
  DIR_BATCH: 1500,

  async importArchive(file, opts) {
    opts = opts || {};
    const onlyRelated = opts.onlyRelated !== undefined ? !!opts.onlyRelated : !!this._onlyRelated;
    const refSet = onlyRelated ? this._getLogRefSet() : null;
    const prevMode = this.mode;
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
      Utils.showToast(`已导入源码包 ${file.name}（${this.files.length} 个文件${onlyRelated ? '，日志相关' : ''}）${this._switchNote(prevMode)}`, 'success', 2500);
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
    const prevMode = this.mode;
    Utils.showLoading('正在索引项目目录 0/' + arr.length + '...');
    // 超大目录：提示改用服务端模式（不阻断，仅建议）
    if (arr.length > 20000) {
      Utils.showToast(`目录含 ${Utils.formatNumber(arr.length)} 个文件，建议改用「服务端」模式（server.py --project）以提速`, 'warn', 4000);
    }
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
      Utils.showToast(`已导入项目目录 ${rootName}（${this.files.length} 个源码文件${onlyRelated ? '，日志相关' : ''}）${this._switchNote(prevMode)}`, 'success', 2500);
    } catch (e) {
      Utils.showToast('项目目录导入失败: ' + e.message, 'error');
    }
    Utils.hideLoading();
  },

  // ===== 远程数据源：server（同源 /source/*）与 http（任意索引 URL） =====

  // 从服务端加载源码；baseUrl 为空表示当前站点同源（静态 file:// 打开时需填写具体地址）。
  // 先通过 /source/ping 识别是否为 Web Log Viewer 服务端（特殊标志），再拉取索引。
  async importFromServer(baseUrl, opts) {
    const base = (baseUrl || this._serverBase || '').replace(/\/+$/, '');
    const state = await this.detectServer(base, true);
    if (state === 'disabled') {
      Utils.showToast('该地址是 Web Log Viewer 服务端，但未启用源码服务（请用 --project 启动）', 'warn', 4000);
      return;
    }
    if (state !== 'ready') {
      Utils.showToast('未识别到服务端（/source/ping 无响应或非本应用）', 'error', 3500);
      return;
    }
    this._persistServerBase(base);
    const fileUrl = (rel) => base + '/source/files/' + rel.split('/').map(encodeURIComponent).join('/');
    return this._importFromIndexUrl(base + '/source/index.json', fileUrl, 'server', opts);
  },

  _persistServerBase(base) {
    try { localStorage.setItem('sv-server-base', base || ''); } catch (e) { /* ignore */ }
  },

  // 从任意 HTTP 索引 URL 加载；源码文件按索引所在目录的相对路径拉取
  async importFromHttp(indexUrl, opts) {
    const url = (indexUrl || '').trim();
    if (!url) {
      Utils.showToast('请填写索引 URL（source-index.json）', 'error');
      return;
    }
    const dir = url.replace(/[^/]*$/, '');
    const fileUrl = (rel) => dir + rel.split('/').map(encodeURIComponent).join('/');
    return this._importFromIndexUrl(url, fileUrl, 'http', opts);
  },

  async _importFromIndexUrl(indexUrl, fileUrl, mode, opts) {
    opts = opts || {};
    const onlyRelated = opts.onlyRelated !== undefined ? !!opts.onlyRelated : !!this._onlyRelated;
    const refSet = onlyRelated ? this._getLogRefSet() : null;
    const prevMode = this.mode;
    Utils.showLoading('正在拉取源码索引...');
    try {
      const resp = await fetch(indexUrl, { cache: 'no-store' });
      if (!resp.ok) {
        // 服务端可能返回 JSON 说明（如「请用 --project 启动」），透出给用户
        let detail = `HTTP ${resp.status}`;
        try {
          const body = await resp.json();
          if (body && body.error) detail = `${body.error}（HTTP ${resp.status}）`;
        } catch (e) { /* 非 JSON 响应，保留状态码 */ }
        throw new Error(detail);
      }
      const index = await resp.json();
      if (!index || !Array.isArray(index.files)) throw new Error('索引格式不正确（缺少 files）');
      const entries = [];
      for (const f of index.files) {
        if (!f || !f.path) continue;
        if (this._shouldSkip(f.path)) continue;
        if (refSet && !this._matchesLogRef(f.path, refSet)) continue;
        entries.push({ path: f.path, size: f.size || 0, url: fileUrl(f.path) });
      }
      if (onlyRelated && !entries.length && index.files.length) {
        Utils.showToast('未匹配到日志引用的文件，回退为全量索引', 'warn', 3000);
        this.setOnlyRelated(false);
        return this._importFromIndexUrl(indexUrl, fileUrl, mode, { onlyRelated: false });
      }
      const name = index.project || (mode === 'server' ? '服务端源码' : indexUrl);
      this._buildIndex(entries, index, mode, name, { refMode: onlyRelated });
      if (mode === 'server') {
        this._serverState = 'ready';
        this.updateServerState();
      }
      const label = mode === 'server' ? '服务端' : 'HTTP 索引';
      Utils.showToast(`已从${label}加载 ${this.files.length} 个源码文件${onlyRelated ? '（日志相关）' : ''}${this._switchNote(prevMode)}`, 'success', 2500);
    } catch (e) {
      Utils.showToast(`${mode === 'server' ? '服务端' : 'HTTP'} 源码加载失败: ${e.message}`, 'error', 3500);
    }
    Utils.hideLoading();
  },

  // ===== 服务端识别（特殊标志 /source/ping，供「🖥 服务端」按钮与状态提示） =====

  // baseUrl 省略时用已配置地址（'' = 同源）；force=true 强制重探
  async detectServer(baseUrl, force) {
    const base = (baseUrl !== undefined && baseUrl !== null)
      ? String(baseUrl).trim().replace(/\/+$/, '')
      : (this._serverBase || '');
    if (!force && this._serverState && base === this._serverBase) {
      this.updateServerState();
      return this._serverState;
    }
    this._serverBase = base;
    let state = 'offline';
    try {
      const resp = await fetch(base + '/source/ping', { cache: 'no-store' });
      if (resp.ok) {
        const info = await resp.json();
        // 必须命中特殊标志，避免把任意 HTTP 服务误判为本服务端
        if (info && info.marker === 'wlv-source') {
          state = info.source ? 'ready' : 'disabled';
        }
      }
    } catch (e) {
      state = 'offline';
    }
    this._serverState = state;
    this.updateServerState();
    return state;
  },

  updateServerState() {
    const el = document.getElementById('sv-server-state');
    const btn = document.getElementById('btn-source-import-server');
    const where = this._serverBase || '同源';
    const map = {
      ready: { text: `服务端可用（${where}）`, title: `已识别服务端（${where}），可加载源码` },
      disabled: { text: `服务端未启用源码（${where}）`, title: `已识别服务端（${where}），但未带 --project 启动` },
      offline: {
        text: this._serverBase ? `未识别到 server：${this._serverBase}` : '未配置 server',
        title: '静态打开时请在输入框填写服务端地址（如 http://localhost:8765）',
      },
    };
    const m = map[this._serverState];
    if (el) el.textContent = m ? `（${m.text}）` : '';
    if (btn) btn.title = m ? m.title : '从服务端加载源码（需先用 server.py --project 启动）';
  },

  // ===== 排除规则管理（面板内增删 → 重新过滤） =====

  // 规则含 * 或 ? 视为文件 glob，否则视为目录名
  addExcludeRule(rule) {
    const r = (rule || '').trim();
    if (!r) return false;
    if (/[*?]/.test(r)) {
      if (!this._userExcludeFiles.includes(r)) this._userExcludeFiles.push(r);
    } else {
      const d = r.replace(/\/+$/, '');
      if (!d) return false;
      if (!this._userExcludeDirs.includes(d)) this._userExcludeDirs.push(d);
    }
    this.reapplyExclusions();
    return true;
  },

  removeExcludeRule(type, value) {
    const list = type === 'file' ? this._userExcludeFiles : this._userExcludeDirs;
    const i = list.indexOf(value);
    if (i >= 0) {
      list.splice(i, 1);
      this.reapplyExclusions();
    }
  },

  clearExcludeRules() {
    if (!this._userExcludeDirs.length && !this._userExcludeFiles.length) return;
    this._userExcludeDirs = [];
    this._userExcludeFiles = [];
    this.reapplyExclusions();
  },

  // 用更新后的规则重新过滤当前数据源（保留原始条目）
  reapplyExclusions() {
    if (!this._rawEntries) {
      if (SourceViewer) SourceViewer.renderExcludeBar();
      return;
    }
    // 元信息已固化在 _rawEntries 上，无需再传 index
    this._buildIndex(this._rawEntries, null, this.mode, this.bundleName, { refMode: this._refMode });
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
    // 保留原始条目：排除规则变更后可重新过滤（来源内容仅此一份引用，不额外持有）
    this._rawEntries = entries;
    this._textLRU = [];

    // CLI 索引的元信息（行数/语言/大小）直接固化到原始条目上，
    // 避免长期保留整份 index（与 files 等量、且路径字符串重复的元数据副本）
    if (index && Array.isArray(index.files)) {
      const byPath = new Map();
      for (const it of index.files) byPath.set(it.path, it);
      for (const en of entries) {
        const m = byPath.get(en.path);
        if (!m) continue;
        if (m.lines) en.lines = m.lines;
        if (m.lang) en.lang = m.lang;
        if (m.size) en.size = m.size;
      }
    }

    this.files = [];
    this._byPath = new Map();
    this._byBasename = new Map();

    for (const en of entries) {
      if (this._shouldSkip(en.path)) continue;
      const fe = {
        path: en.path,
        basename: en.path.split('/').pop(),
        size: en.size || 0,
        lines: en.lines || 0,
        lang: en.lang || this._langOf(en.path),
      };
      if (en.data) fe.data = en.data;
      if (en.file) fe.file = en.file;
      if (en.url) fe.url = en.url;
      this.files.push(fe);
    }

    for (const fe of this.files) {
      this._byPath.set(fe.path, fe);
      if (!this._byBasename.has(fe.basename)) this._byBasename.set(fe.basename, []);
      this._byBasename.get(fe.basename).push(fe);
    }

    if (SourceViewer) SourceViewer.renderTree();
    // 导入/排除规则变更后，同步刷新网格与详情里的源码跳转入口显隐
    if (typeof App !== 'undefined' && App.refreshSourceLinks) App.refreshSourceLinks();
  },

  clear() {
    this.files = [];
    this._byBasename = null;
    this._byPath = null;
    this.mode = '';
    this.bundleName = '';
    this._refMode = false;
    this._rawEntries = null;
    this._textLRU = [];
    this.invalidateLogRef();
    if (SourceViewer) SourceViewer.renderTree();
    if (typeof App !== 'undefined' && App.refreshSourceLinks) App.refreshSourceLinks();
  },

  // ===== 内容读取（懒加载） =====

  // 记录最近使用，超出上限时淘汰最久未用条目的解码文本（zip 模式仍可从 data 重新解码）
  _touchText(entry) {
    const lru = this._textLRU;
    const i = lru.indexOf(entry);
    if (i >= 0) lru.splice(i, 1);
    lru.unshift(entry);
    while (lru.length > this.TEXT_CACHE_MAX) {
      const old = lru.pop();
      if (old && old !== entry) old._text = undefined;
    }
  },

  async getFileText(entry) {
    if (entry._text !== undefined) {
      this._touchText(entry);
      return entry._text;
    }
    let text = '';
    if (entry.data) {
      text = new TextDecoder('UTF-8').decode(entry.data);
    } else if (entry.file && typeof entry.file.text === 'function') {
      text = await entry.file.text();
    } else if (entry.url) {
      const resp = await fetch(entry.url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      text = await resp.text();
    }
    entry._text = text;
    this._touchText(entry);
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
