/* remote_logs.js — 远程日志加载（v3-1）
 *
 * 从 Web Log Viewer 服务端（server.py 的 /api/logs）加载远端日志：
 *   - 复用服务端地址与标识探测（/source/ping，marker = wlv-source）
 *   - 列出候选日志文件（/api/logs/list），选择后逐个拉取
 *   - 文本走 /api/logs?file=…；压缩包走 &binary=1 + ArchiveHandler 解压
 *   - 解析统一交给 LogParser.mergeTexts（逐文件流式 + 跳过清单）
 *   - 实时追踪（v3-1 延伸）：对单个文件轮询 /api/logs?file=…&from=<byteOffset> 取增量，
 *     新行经 LogParser.appendTail 追加（服务端以 X-Log-Size/X-Log-Reset 反馈进度与轮转）
 */
const RemoteLogs = {
  _base: '',
  _token: '',
  _listData: null,
  _els: null,

  // 实时追踪状态
  _tailRel: null,        // 正在追踪的远端文件相对路径
  _tailOffset: null,     // 已读取到的字节偏移（下次请求的 from）
  _tailTimer: null,      // 轮询定时器
  _tailDecoder: null,    // 流式解码器（跨块处理多字节字符）
  _tailPending: '',      // 未收完的半行
  _tailBusy: false,      // 轮询进行中标志（防止重叠请求重复追加）
  TAIL_INTERVAL: 2000,   // 轮询间隔（毫秒）

  // 复用源码面板已配置的服务端地址（同源为空串）
  defaultBase() {
    if (typeof SourceLink !== 'undefined' && SourceLink._serverBase) return SourceLink._serverBase;
    try { return localStorage.getItem('sv-server-base') || ''; } catch (e) { return ''; }
  },

  _headers() {
    return this._token ? { 'X-Auth-Token': this._token } : {};
  },

  _normalizeBase(baseUrl) {
    return (baseUrl || this._base || '').trim().replace(/\/+$/, '');
  },

  // 探测服务端：返回 {ok, state, logs, source, logsRoot, project}
  // state: ready | no-logs | not-app | offline
  async probe(baseUrl) {
    const base = this._normalizeBase(baseUrl);
    this._base = base;
    try {
      const resp = await fetch(base + '/source/ping', { cache: 'no-store' });
      if (!resp.ok) return { ok: false, state: 'offline' };
      const info = await resp.json();
      if (!info || info.marker !== 'wlv-source') return { ok: false, state: 'not-app' };
      return {
        ok: true,
        state: info.logs ? 'ready' : 'no-logs',
        logs: !!info.logs,
        source: !!info.source,
        logsRoot: info.logsRoot || '',
        project: info.project || ''
      };
    } catch (e) {
      return { ok: false, state: 'offline' };
    }
  },

  _errorDetail(resp) {
    if (resp.status === 401) return '需要访问口令（token）';
    return `HTTP ${resp.status}`;
  },

  async _lazyError(resp) {
    let detail = this._errorDetail(resp);
    try {
      const body = await resp.json();
      if (body && body.error) detail = body.error;
    } catch (e) { /* 非 JSON 响应，保留默认说明 */ }
    return detail;
  },

  // 列出候选日志文件
  async list(baseUrl) {
    const base = this._normalizeBase(baseUrl);
    const resp = await fetch(base + '/api/logs/list', { cache: 'no-store', headers: this._headers() });
    if (!resp.ok) throw new Error(await this._lazyError(resp));
    return resp.json();
  },

  _fileUrl(base, rel, binary) {
    let url = base + '/api/logs?file=' + encodeURIComponent(rel) + (binary ? '&binary=1' : '');
    if (this._token) url += '&token=' + encodeURIComponent(this._token);
    return url;
  },

  // 读取单个日志文件文本（服务端以 UTF-8 返回）
  async readText(rel, baseUrl) {
    const base = this._normalizeBase(baseUrl);
    const resp = await fetch(this._fileUrl(base, rel, false), { cache: 'no-store', headers: this._headers() });
    if (!resp.ok) throw new Error(await this._lazyError(resp));
    return resp.text();
  },

  // 读取单个日志文件原始字节（压缩包）
  async readBytes(rel, baseUrl) {
    const base = this._normalizeBase(baseUrl);
    const resp = await fetch(this._fileUrl(base, rel, true), { cache: 'no-store', headers: this._headers() });
    if (!resp.ok) throw new Error(await this._lazyError(resp));
    return new Uint8Array(await resp.arrayBuffer());
  },

  // 增量读取：返回 { buf, size, reset }
  //   buf   — 自 from 字节偏移起的新增字节
  //   size  — 服务端当前文件总大小（下次请求的 from）
  //   reset — 文件被截断/轮转，已从头返回内容
  async readFrom(rel, from, baseUrl) {
    const base = this._normalizeBase(baseUrl);
    let url = base + '/api/logs?file=' + encodeURIComponent(rel) + '&from=' + from;
    if (this._token) url += '&token=' + encodeURIComponent(this._token);
    const resp = await fetch(url, { cache: 'no-store', headers: this._headers() });
    if (!resp.ok) throw new Error(await this._lazyError(resp));
    const size = parseInt(resp.headers.get('X-Log-Size') || '0', 10) || 0;
    const reset = resp.headers.get('X-Log-Reset') === '1';
    return { buf: new Uint8Array(await resp.arrayBuffer()), size, reset };
  },

  // 把所选远程文件取成 {name, text} 列表（压缩包先解压）
  async collect(rels) {
    const enc = (LogParser.config && LogParser.config.encoding && LogParser.config.encoding !== 'UTF-8')
      ? LogParser.config.encoding : 'UTF-8';
    const decoder = new TextDecoder(enc);
    const items = [];

    for (const rel of rels) {
      try {
        if (typeof ArchiveHandler !== 'undefined' && ArchiveHandler.isArchive(rel)) {
          const bytes = await this.readBytes(rel);
          const extracted = await ArchiveHandler.extract(new File([bytes], rel));
          const textFiles = extracted.filter(f => f.isTextFile);
          if (!textFiles.length) {
            // 解压成功但无文本 → 交由 mergeTexts 计入跳过
            items.push({ name: rel, text: '', size: bytes.length });
            continue;
          }
          for (const f of textFiles) {
            items.push({ name: rel + '/' + f.name, text: decoder.decode(f.data), size: f.data.length });
          }
        } else {
          const text = await this.readText(rel);
          items.push({ name: rel, text, size: text.length });
        }
      } catch (e) {
        // 读取失败 → 空文本，交由 mergeTexts 计入跳过清单（不中断其余文件）
        console.error('远程日志读取失败:', rel, e);
        items.push({ name: rel, text: '' });
      }
    }
    return items;
  },

  // 加载指定远程文件并交给 LogParser 解析；返回解析后的条目数
  async load(rels, append) {
    if (!rels || !rels.length) throw new Error('未选择任何文件');
    const items = await this.collect(rels);
    await LogParser.mergeTexts(items, {}, !!append);
    return LogParser.entries.length;
  },

  // ===== 实时追踪 =====

  isTailing() {
    return !!this._tailTimer;
  },

  _newTailDecoder() {
    const enc = (LogParser.config && LogParser.config.encoding && LogParser.config.encoding !== 'UTF-8')
      ? LogParser.config.encoding : 'UTF-8';
    return new TextDecoder(enc);
  },

  // 把一段解码后的文本并入半行缓冲，返回其中「完整的行」
  // initial=true 时若整段都没有换行，则视为单行文件整体返回（避免无法展示）
  _consumeChunk(text, initial) {
    const combined = this._tailPending + (text || '');
    const nl = combined.lastIndexOf('\n');
    if (nl < 0) {
      if (initial) { this._tailPending = ''; return [combined]; }
      this._tailPending = combined;
      return [];
    }
    this._tailPending = combined.slice(nl + 1);
    return LogParser._splitLines(combined.slice(0, nl));
  },

  // 开始追踪所选（且仅有的）1 个文件；再次调用则停止
  async startTail() {
    if (this.isTailing()) { this.stopTail(); return; }

    const rels = this._selectedList();
    if (rels.length !== 1) {
      Utils.showToast('实时追踪请只选择 1 个文件（用过滤缩小范围后单选）', 'error', 3500);
      return;
    }
    const rel = rels[0];
    if (typeof ArchiveHandler !== 'undefined' && ArchiveHandler.isArchive(rel)) {
      Utils.showToast('压缩包不支持实时追踪，请选择普通日志文件', 'error', 3500);
      return;
    }

    Utils.showLoading('正在打开实时追踪...');
    try {
      // 初始全量载入（from=0）：既得到内容，也拿到服务端字节大小作为起始偏移
      const { buf, size } = await this.readFrom(rel, 0);
      this._tailDecoder = this._newTailDecoder();
      this._tailPending = '';
      const first = buf.length ? this._tailDecoder.decode(buf, { stream: true }) : '';
      const lines = this._consumeChunk(first, true);
      await LogParser.mergeTexts([{ name: rel, text: lines.join('\n'), size }], {}, false);
      App.onDataLoaded();
      this._tailRel = rel;
      this._tailOffset = size;
    } catch (e) {
      Utils.hideLoading();
      Utils.showToast('实时追踪启动失败: ' + e.message, 'error', 4000);
      return;
    }
    Utils.hideLoading();

    this._tailTimer = setInterval(() => this._tailPoll(), this.TAIL_INTERVAL);
    this._syncTailBtn();
    this._setTailState(`追踪中：${rel}`, 'ready');
    Utils.showToast(`已开始实时追踪：${rel}（每 ${this.TAIL_INTERVAL / 1000}s 拉取增量）`, 'success', 3000);
  },

  stopTail(silent) {
    if (this._tailTimer) { clearInterval(this._tailTimer); this._tailTimer = null; }
    this._tailBusy = false;
    // 停止时把未换行的尾行补上，避免末尾一条丢失
    if (this._tailRel && this._tailPending && !silent) {
      const pending = this._tailPending;
      this._tailPending = '';
      if (LogParser.appendTail(this._tailRel, [pending]) > 0) App.refreshTail();
    }
    this._tailRel = null;
    this._tailOffset = null;
    this._tailPending = '';
    this._tailDecoder = null;
    this._syncTailBtn();
    this._setTailState('');
    if (!silent) Utils.showToast('已停止实时追踪');
  },

  // 单次轮询：取增量 → 流式解码 → 拆完整行 → 追加解析 → 收尾刷新
  // _tailBusy 防止网络较慢时上一次请求未返回就又发下一次，导致重复追加
  async _tailPoll() {
    const rel = this._tailRel;
    if (!rel || this._tailBusy) return;
    this._tailBusy = true;
    try {
      const { buf, size, reset } = await this.readFrom(rel, this._tailOffset);
      if (reset) {
        // 文件被截断/轮转：重置解码器与半行缓冲，从头接收
        this._tailDecoder = this._newTailDecoder();
        this._tailPending = '';
      }
      const text = buf.length ? this._tailDecoder.decode(buf, { stream: true }) : '';
      this._tailOffset = size;
      if (!text) return;

      const lines = this._consumeChunk(text, false);
      if (!lines.length) return;

      const added = LogParser.appendTail(rel, lines);
      if (added > 0) {
        App.refreshTail();
        this._setTailState(`追踪中：${rel}（+${added}）`, 'ready');
      }
    } catch (e) {
      this.stopTail(true);
      this._setTailState('追踪中断：' + e.message, 'offline');
      Utils.showToast('实时追踪中断: ' + e.message, 'error', 4000);
    } finally {
      this._tailBusy = false;
    }
  },

  _syncTailBtn() {
    const btn = this._els && this._els.tailBtn;
    if (!btn) return;
    btn.textContent = this.isTailing() ? '⏸ 停止' : '▶ 跟踪';
    btn.classList.toggle('active', this.isTailing());
  },

  _setTailState(text, kind) {
    const el = this._els && this._els.tailState;
    if (!el) return;
    el.textContent = text || '';
    el.className = 'rl-tail-state' + (kind ? ' rl-state-' + kind : '');
  },

  // ===== UI =====
  _RENDER_CAP: 500,   // 单次渲染上限：超出请用过滤缩小范围，避免大列表卡顿

  init() {
    const openBtn = document.getElementById('btn-remote-logs');
    if (!openBtn) return;
    this._els = {
      panel: document.getElementById('remote-logs-panel'),
      url: document.getElementById('rl-url'),
      token: document.getElementById('rl-token'),
      state: document.getElementById('rl-state'),
      rootLabel: document.getElementById('rl-root-label'),
      list: document.getElementById('rl-list'),
      append: document.getElementById('rl-append'),
      filter: document.getElementById('rl-filter'),
      chips: document.getElementById('rl-ext-chips'),
      count: document.getElementById('rl-sel-count'),
      selAll: document.getElementById('rl-select-all'),
      tailBtn: document.getElementById('btn-rl-tail'),
      tailState: document.getElementById('rl-tail-state'),
    };
    this._files = [];
    this._selected = new Set();
    this._filter = '';

    openBtn.addEventListener('click', () => this.open());
    document.getElementById('btn-close-remote-logs').addEventListener('click', () => this.close());
    document.getElementById('btn-rl-connect').addEventListener('click', () => this.connect());
    document.getElementById('btn-rl-refresh').addEventListener('click', () => this.refresh());
    document.getElementById('btn-rl-load').addEventListener('click', () => this.loadSelected());
    this._els.tailBtn.addEventListener('click', () => this.startTail());
    document.getElementById('btn-rl-sel-invert').addEventListener('click', () => this.invertFiltered());
    document.getElementById('btn-rl-sel-none').addEventListener('click', () => this.clearFiltered());
    this._els.selAll.addEventListener('change', () => this.setAllFiltered(this._els.selAll.checked));
    this._els.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.connect(); });
    this._els.token.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.connect(); });
    this._els.filter.addEventListener('input', () => { this._filter = this._els.filter.value; this._render(); });
    this._els.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this._els.filter.value = ''; this._filter = ''; this._render(); }
    });
    // 扩展名快捷筛选
    this._els.chips.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.rl-chip');
      if (btn) this._setFilterExt(btn.dataset.ext);
    });
    // 列表勾选（事件委托，兼容大列表）
    this._els.list.addEventListener('change', (e) => {
      const cb = e.target.closest && e.target.closest('.rl-check');
      if (!cb) return;
      if (cb.checked) this._selected.add(cb.value); else this._selected.delete(cb.value);
      this._syncHead();
    });
  },

  open() {
    this._els.panel.style.display = 'flex';
    if (!this._els.url.value) {
      this._els.url.value = this.defaultBase() || (location.protocol === 'file:' ? '' : location.origin);
    }
    if (!this._listData) this.connect();
  },

  close() {
    this._els.panel.style.display = 'none';
  },

  _setState(text, kind) {
    const el = this._els.state;
    if (!el) return;
    el.textContent = text ? `（${text}）` : '';
    el.className = 'sv-server-state' + (kind ? ' rl-state-' + kind : '');
  },

  async connect() {
    this._token = (this._els.token.value || '').trim();
    const base = (this._els.url.value || '').trim();
    this._setState('连接中...', '');
    Utils.showLoading('正在连接服务端...');
    const info = await this.probe(base);
    if (!info.ok) {
      Utils.hideLoading();
      const msg = info.state === 'not-app' ? '该地址不是 Web Log Viewer 服务端' : '未识别到服务端（/source/ping 无响应）';
      this._setState(msg, 'offline');
      Utils.showToast(msg, 'error', 3500);
      return;
    }
    if (!info.logs) {
      Utils.hideLoading();
      this._setState('服务端未启用日志接口', 'offline');
      Utils.showToast('服务端已识别，但未启用日志接口（请用 --logs-root/--project 启动 server.py）', 'warn', 4000);
      return;
    }
    this._els.rootLabel.textContent = info.logsRoot ? `日志根: ${info.logsRoot}` : '';
    const ok = await this.refresh(true);
    Utils.hideLoading();
    if (ok) this._setState(`已连接（${base || '同源'}）`, 'ready');
  },

  async refresh(silent) {
    const base = (this._els.url.value || '').trim();
    try {
      const data = await this.list(base);
      this._listData = data;
      this._setFiles((data && data.files) || []);
      if (!silent) Utils.showToast(`已列出 ${data.count} 个候选日志文件`, 'success', 2000);
      return true;
    } catch (e) {
      this._setState(String(e.message || e), 'offline');
      if (!silent) Utils.showToast('获取日志列表失败: ' + e.message, 'error', 3500);
      return false;
    }
  },

  // 列表数据更新：默认全选（少量文件直接加载更省事），并重置过滤
  _setFiles(files) {
    this._files = files;
    this._selected = new Set(files.map((f) => f.path));
    this._filter = '';
    if (this._els.filter) this._els.filter.value = '';
    this._render();
  },

  _esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  },

  _extOf(path) {
    const lower = String(path).toLowerCase();
    if (lower.endsWith('.tar.gz')) return '.tar.gz';
    const i = lower.lastIndexOf('.');
    const slash = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\'));
    return (i > slash) ? lower.slice(i) : '(无扩展名)';
  },

  // 过滤：空格分词，全部命中（AND），大小写不敏感
  _matches(f) {
    if (!this._filter) return true;
    const tokens = this._filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const hay = f.path.toLowerCase();
    return tokens.every((tk) => hay.includes(tk));
  },

  _filtered() {
    return this._files.filter((f) => this._matches(f));
  },

  _renderChips() {
    const counts = {};
    for (const f of this._files) {
      const ext = this._extOf(f.path);
      counts[ext] = (counts[ext] || 0) + 1;
    }
    const exts = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).slice(0, 10);
    this._els.chips.innerHTML = exts.map((ext) => {
      const active = this._filter === ext ? ' active' : '';
      return `<button class="rl-chip${active}" data-ext="${this._esc(ext)}" title="只看 ${this._esc(ext)}（${counts[ext]} 个）">`
        + `${this._esc(ext)}<span class="rl-chip-n">${counts[ext]}</span></button>`;
    }).join('');
  },

  _render() {
    const list = this._els.list;
    this._renderChips();

    if (!this._files.length) {
      list.innerHTML = '<div class="rl-empty">未找到候选日志文件（支持 .log/.txt/.out/.err/.json/.csv/.xml/.gz/.tgz/.tar/.zip）</div>';
      this._syncHead();
      return;
    }

    const filtered = this._filtered();
    if (!filtered.length) {
      list.innerHTML = '<div class="rl-empty">无匹配文件（清空过滤框或换个关键词）</div>';
      this._syncHead();
      return;
    }

    const cap = this._RENDER_CAP;
    const html = filtered.slice(0, cap).map((f) => {
      const size = (typeof Utils !== 'undefined' && Utils.formatBytes) ? Utils.formatBytes(f.size) : `${f.size}B`;
      const esc = this._esc(f.path);
      const checked = this._selected.has(f.path) ? ' checked' : '';
      return `<label class="rl-item"><input type="checkbox" class="rl-check" value="${esc}"${checked} />`
        + `<span class="rl-path" title="${esc}">${esc}</span>`
        + `<span class="rl-size">${size}</span></label>`;
    }).join('');

    let tail = '';
    if (filtered.length > cap) {
      tail = `<div class="rl-more">共匹配 ${filtered.length} 个，已显示前 ${cap} 个；请用过滤缩小范围（全选/加载作用于全部筛选结果）</div>`;
    } else if (this._listData && this._listData.truncated) {
      tail = `<div class="rl-more">服务端仅返回前 ${this._listData.limit} 个（已截断）</div>`;
    }
    list.innerHTML = html + tail;
    this._syncHead();
  },

  // 同步「全选」复选框与已选计数（基于当前筛选结果）
  _syncHead() {
    const filtered = this._filtered();
    const allSel = filtered.length > 0 && filtered.every((f) => this._selected.has(f.path));
    const some = filtered.some((f) => this._selected.has(f.path));
    if (this._els.selAll) {
      this._els.selAll.checked = allSel;
      this._els.selAll.indeterminate = !allSel && some;
    }
    if (this._els.count) {
      const scope = this._filter ? `，筛选 ${filtered.length}` : '';
      this._els.count.textContent = `已选 ${this._selected.size} / 共 ${this._files.length}${scope}`;
    }
  },

  // ===== 批量操作（均作用于当前筛选结果） =====
  setAllFiltered(checked) {
    for (const f of this._filtered()) {
      if (checked) this._selected.add(f.path); else this._selected.delete(f.path);
    }
    this._paintVisible();
    this._syncHead();
  },

  invertFiltered() {
    for (const f of this._filtered()) {
      if (this._selected.has(f.path)) this._selected.delete(f.path);
      else this._selected.add(f.path);
    }
    this._paintVisible();
    this._syncHead();
  },

  clearFiltered() {
    for (const f of this._filtered()) this._selected.delete(f.path);
    this._paintVisible();
    this._syncHead();
  },

  _paintVisible() {
    this._els.list.querySelectorAll('.rl-check').forEach((cb) => {
      cb.checked = this._selected.has(cb.value);
    });
  },

  _setFilterExt(ext) {
    this._filter = (this._filter === ext) ? '' : ext;
    if (this._els.filter) this._els.filter.value = this._filter;
    this._render();
  },

  _selectedList() {
    return this._files.filter((f) => this._selected.has(f.path)).map((f) => f.path);
  },

  async loadSelected() {
    // 手动加载会改写当前视图，先停止实时追踪避免追加错位
    if (this.isTailing()) this.stopTail(true);
    const rels = this._selectedList();
    if (!rels.length) {
      Utils.showToast('请先选择要加载的日志文件', 'error');
      return;
    }
    if (rels.length > 100) {
      Utils.showToast(`已选 ${rels.length} 个文件，加载可能较慢/占用较高；建议过滤后分批加载`, 'warn', 4000);
    }
    const append = !!(this._els.append && this._els.append.checked);
    Utils.showLoading(`正在加载 ${rels.length} 个远程文件...`);
    try {
      await this.load(rels, append);
      App.onDataLoaded();
    } catch (e) {
      Utils.showToast('远程日志加载失败: ' + e.message, 'error', 4000);
    }
    Utils.hideLoading();
  }
};
