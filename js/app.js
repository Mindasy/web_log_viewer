// app.js - 主应用控制器

const App = {
  // 书签
  bookmarks: [],

  // 实时追踪
  tailTimer: null,
  tailFile: null,
  tailLastSize: 0,

  // 待解析的文件（向导用）
  pendingFiles: null,

  // 待保存的 Pattern 配置（解析完后弹出确认面板）
  pendingSaveConfig: null,

  // Pattern 管理器状态
  _pmList: [],
  _editingFromMain: false,

  // 初始化
  async init() {
    LogGrid.init();
    Timeline.init();
    // 首次启动：将内置预设 Pattern 写入 DB
    await this.seedPresetPatterns();
    this.bindToolbar();
    this.bindFilterBar();
    this.bindDetailPanel();
    this.bindPopups();
    this.bindDragDrop();
    this.bindKeyboardShortcuts();
    this.bindParserConfig();
    ParseWizard.init();
  },

  // 首次启动时将内置预设 Pattern 写入数据库
  async seedPresetPatterns() {
    try {
      const existing = await PatternDB.getAll();
      if (existing.length > 0) return; // 已经 seed 过

      const presets = [
        { name: 'Log4j / Logback', regex: LogParser.presets.log4j.regex.source, dateFormat: LogParser.presets.log4j.dateFormat, description: '内置预设', groupsJSON: JSON.stringify(LogParser.presets.log4j.groups) },
        { name: 'Log4j2', regex: LogParser.presets.log4j2.regex.source, dateFormat: LogParser.presets.log4j2.dateFormat, description: '内置预设', groupsJSON: JSON.stringify(LogParser.presets.log4j2.groups) },
        { name: 'Bracket Log', regex: LogParser.presets.bracketLog.regex.source, dateFormat: LogParser.presets.bracketLog.dateFormat, description: '内置预设 - 括号格式', groupsJSON: JSON.stringify(LogParser.presets.bracketLog.groups) },
        { name: 'Syslog', regex: LogParser.presets.syslog.regex.source, dateFormat: LogParser.presets.syslog.dateFormat, description: '内置预设', groupsJSON: JSON.stringify(LogParser.presets.syslog.groups) },
        { name: 'Apache/Nginx', regex: LogParser.presets.apache.regex.source, dateFormat: LogParser.presets.apache.dateFormat, description: '内置预设', groupsJSON: JSON.stringify(LogParser.presets.apache.groups) },
        { name: '通用时间戳', regex: LogParser.presets.generic.regex.source, dateFormat: LogParser.presets.generic.dateFormat, description: '内置预设', groupsJSON: JSON.stringify(LogParser.presets.generic.groups) },
      ];

      for (const p of presets) {
        const dup = await PatternDB.getByName(p.name);
        if (!dup) {
          await PatternDB.add(p);
        }
      }
    } catch {
      // 静默处理
    }
  },

  // ===== 工具栏事件 =====
  bindToolbar() {
    document.getElementById('btn-open').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    document.getElementById('btn-merge').addEventListener('click', () => {
      document.getElementById('merge-file-input').click();
    });

    document.getElementById('btn-reload').addEventListener('click', () => this.reloadFile());

    document.getElementById('btn-tail').addEventListener('click', () => this.toggleTail());

    document.getElementById('btn-export').addEventListener('click', () => this.exportLogs());

    document.getElementById('btn-clear').addEventListener('click', () => this.clearAll());

    document.getElementById('btn-bookmark').addEventListener('click', () => this.addBookmark());

    document.getElementById('btn-bookmarks-panel').addEventListener('click', () => this.toggleBookmarksPanel());

    document.getElementById('btn-stats').addEventListener('click', () => this.toggleStatsPanel());

    document.getElementById('btn-timeline').addEventListener('click', () => this.toggleTimelinePanel());

    document.getElementById('btn-toggle-files').addEventListener('click', () => this.toggleFilesPanel());
    document.getElementById('btn-parser-config').addEventListener('click', () => this.showParserConfig());
    document.getElementById('btn-open-pm-main').addEventListener('click', () => this.openMainPatternManager());
    document.getElementById('btn-column-settings').addEventListener('click', () => this.toggleColumnSettings());

    document.getElementById('btn-close-files').addEventListener('click', () => {
      document.getElementById('files-panel').classList.remove('expanded');
    });

    // 文件面板拖拽调整宽度
    this.initFilesPanelResizer();

    // 文件输入
    document.getElementById('file-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.openFiles(e.target.files);
        e.target.value = '';
      }
    });

    document.getElementById('merge-file-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.mergeFiles(e.target.files);
        e.target.value = '';
      }
    });
  },

  // ===== 过滤栏事件 =====
  bindFilterBar() {
    const searchInput = document.getElementById('search-input');

    searchInput.addEventListener('input', Utils.debounce(() => {
      LogFilter.state.searchText = searchInput.value;
      LogFilter.resetSearch();
      this.refresh();
    }, LogParser.entries.length > 50000 ? 400 : 200));

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.searchPrev();
        } else {
          this.searchNext();
        }
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        LogFilter.state.searchText = '';
        LogFilter.resetSearch();
        this.refresh();
      }
    });

    document.getElementById('btn-search').addEventListener('click', () => this.searchNext());

    // 搜索选项按钮
    const toggleBtns = [
      { id: 'btn-regex', key: 'useRegex' },
      { id: 'btn-case-sensitive', key: 'caseSensitive' },
      { id: 'btn-whole-word', key: 'wholeWord' },
      { id: 'btn-highlight', key: 'highlight' },
    ];

    toggleBtns.forEach(({ id, key }) => {
      const btn = document.getElementById(id);
      btn.addEventListener('click', (e) => {
        if (key === 'highlight' && (e.shiftKey || e.altKey)) {
          App.toggleHighlightSettings();
          return;
        }
        LogFilter.state[key] = !LogFilter.state[key];
        btn.classList.toggle('active', LogFilter.state[key]);
        LogFilter.resetSearch();
        this.refresh();
      });
    });

    // 级别过滤
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const checkbox = chip.querySelector('input');
        checkbox.checked = !checkbox.checked;
        const level = chip.dataset.level;
        LogFilter.state.levels[level] = checkbox.checked;
        this.refresh();
      });
    });

    // 高级过滤
    document.getElementById('btn-advanced-filter').addEventListener('click', () => {
      const panel = document.getElementById('advanced-filters');
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    });

    const advancedInputs = [
      { id: 'filter-thread', key: 'threadFilter' },
      { id: 'filter-source', key: 'sourceFilter' },
      { id: 'filter-message', key: 'messageFilter' },
    ];

    advancedInputs.forEach(({ id, key }) => {
      const input = document.getElementById(id);
      input.addEventListener('input', Utils.debounce(() => {
        LogFilter.state[key] = input.value;
        this.refresh();
      }, 300));
    });

    document.getElementById('filter-time-from').addEventListener('change', (e) => {
      LogFilter.state.timeFrom = e.target.value;
      this.refresh();
    });

    document.getElementById('filter-time-to').addEventListener('change', (e) => {
      LogFilter.state.timeTo = e.target.value;
      this.refresh();
    });

    // ===== 跳转到行 =====
    const gotoInput = document.getElementById('goto-line-input');
    gotoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.gotoLine();
      }
    });
    document.getElementById('btn-goto-line').addEventListener('click', () => this.gotoLine());
  },

  // ===== 主界面 Pattern 管理器 =====
  async openMainPatternManager() {
    // 互斥：关闭解析器配置面板
    document.getElementById('parser-config-panel').style.display = 'none';
    document.getElementById('pattern-manager-main').style.display = 'flex';
    Utils.showOverlay();
    await this.loadMainPatternList();
    this.renderMainPatternList();
  },

  closeMainPatternManager() {
    document.getElementById('pattern-manager-main').style.display = 'none';
    Utils.hideOverlay();
  },

  async autoSavePatternFromWizard(config) {
    try {
      const regex = config.customRegex;
      const dateFmt = config.customDateFormat || '';
      const all = await PatternDB.getAll();
      const existing = all.find(p => p.regex === regex);
      if (existing) {
        if (dateFmt && existing.dateFormat !== dateFmt) {
          await PatternDB.update(existing.id, { dateFormat: dateFmt });
        }
        LogParser.config.activePatternId = existing.id;
        LogParser.config.activePatternName = existing.name;
        return;
      }
      const name = `Auto-${new Date().toLocaleDateString()}-${all.length + 1}`;
      const newId = await PatternDB.add({ name, regex, dateFormat: dateFmt, description: '自动保存' });
      LogParser.config.activePatternId = newId;
      LogParser.config.activePatternName = name;
    } catch {
      // 静默处理
    }
  },

  // 显示保存确认面板（解析完成后）
  showSavePanel() {
    if (!this.pendingSaveConfig) return;
    const cfg = this.pendingSaveConfig;
    document.getElementById('psp-regex').value = cfg.customRegex || '';
    document.getElementById('psp-date-format').value = cfg.customDateFormat || '';
    document.getElementById('psp-name').value = '';
    document.getElementById('psp-desc').value = '';
    document.getElementById('psp-stats').textContent = '解析已完成，是否将此正则保存为 Pattern？';
    document.getElementById('pattern-save-panel').style.display = 'flex';
    Utils.showOverlay();
  },

  hideSavePanel() {
    document.getElementById('pattern-save-panel').style.display = 'none';
    Utils.hideOverlay();
    this.pendingSaveConfig = null;
  },

  async confirmSavePattern() {
    const cfg = this.pendingSaveConfig;
    if (!cfg) return;
    const name = document.getElementById('psp-name').value.trim();
    const desc = document.getElementById('psp-desc').value.trim();
    if (!name) { Utils.showToast('请输入 Pattern 名称', 'error'); return; }

    try {
      const existing = await PatternDB.getByName(name);
      if (existing) {
        await PatternDB.update(existing.id, {
          regex: cfg.customRegex,
          dateFormat: cfg.customDateFormat,
          description: desc || existing.description
        });
        LogParser.config.activePatternId = existing.id;
      } else {
        const newId = await PatternDB.add({
          name,
          regex: cfg.customRegex,
          dateFormat: cfg.customDateFormat,
          description: desc
        });
        LogParser.config.activePatternId = newId;
      }
      LogParser.config.activePatternName = name;
      Utils.showToast(`Pattern "${name}" 已保存`, 'success');
    } catch (e) {
      Utils.showToast('保存失败: ' + e.message, 'error');
    }
    this.hideSavePanel();
  },

  async loadMainPatternList() {
    try {
      this._pmList = await PatternDB.getAll();
    } catch (e) {
      this._pmList = [];
    }
  },

  renderMainPatternList() {
    const container = document.getElementById('pm-list');
    if (!container) return;

    if (!this._pmList || this._pmList.length === 0) {
      container.innerHTML = '<div class="pattern-empty">暂无保存的 Pattern，点击「新建」创建第一个</div>';
      return;
    }

    const list = this._pmList;
    container.innerHTML = list.map(p => {
      const desc = p.description || '';
      const date = p.createdAt ? new Date(p.createdAt).toLocaleString() : '';
      const isActive = p.id === LogParser.config.activePatternId;
      const regexFull = p.regex || '';
      const regexPreview = regexFull.length > 60 ? regexFull.substring(0, 60) + '...' : regexFull;
      return `<div class="pattern-card${isActive ? ' active' : ''}" data-id="${p.id}">
        <div class="pattern-card-info">
          <div class="pattern-card-name">${isActive ? '✅ ' : ''}${this.escapeHtml(p.name)}</div>
          <div class="pattern-card-desc">${this.escapeHtml(desc)}</div>
          <div class="pattern-card-meta">
            <code class="pattern-card-regex">${this.escapeHtml(regexPreview)}</code>
            ${date ? `<span class="pattern-card-date">${date}</span>` : ''}
          </div>
          <div class="pattern-card-body hidden" data-expand="${p.id}">
            <div class="pattern-card-regex-full">${this.escapeHtml(regexFull)}</div>
            ${p.dateFormat ? `<div class="pattern-card-date">日期格式: ${this.escapeHtml(p.dateFormat)}</div>` : ''}
          </div>
        </div>
        <div class="pattern-card-actions">
          <button class="btn-mini btn-view" data-id="${p.id}" title="查看正则">👁️</button>
          <button class="btn-mini btn-load" data-id="${p.id}" title="加载此 Pattern">📥</button>
          <button class="btn-mini btn-edit" data-id="${p.id}" title="编辑">✏️</button>
          <button class="btn-mini btn-del" data-id="${p.id}" title="删除">🗑️</button>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        const body = container.querySelector(`[data-expand="${id}"]`);
        if (body) body.classList.toggle('hidden');
      });
    });
    container.querySelectorAll('.btn-load').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        const p = list.find(x => x.id === id);
        if (p) {
          this.closeMainPatternManager();
          this.loadPatternAndReparse(p);
        }
      });
    });
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        const p = list.find(x => x.id === id);
        if (p) this.showInlineEditor(p);
      });
    });
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        this.deletePatternInMain(id);
      });
    });
  },

  showInlineEditor(pattern) {
    document.getElementById('pm-editor-title').textContent = pattern ? '编辑 Pattern' : '新建 Pattern';
    document.getElementById('pm-edit-name').value = pattern ? (pattern.name || '') : '';
    document.getElementById('pm-edit-desc').value = pattern ? (pattern.description || '') : '';
    document.getElementById('pm-edit-regex').value = pattern ? (pattern.regex || '') : '';
    document.getElementById('pm-edit-datefmt').value = pattern ? (pattern.dateFormat || '') : '';
    document.getElementById('pm-edit-id').textContent = pattern ? pattern.id : '';
    this._editingPatternId = pattern ? pattern.id : null;
    document.getElementById('pm-editor').style.display = 'flex';
  },

  hideInlineEditor() {
    document.getElementById('pm-editor').style.display = 'none';
    this._editingPatternId = null;
  },

  async savePatternInline() {
    const name = document.getElementById('pm-edit-name').value.trim();
    const regex = document.getElementById('pm-edit-regex').value.trim();
    const desc = document.getElementById('pm-edit-desc').value.trim();
    const dateFmt = document.getElementById('pm-edit-datefmt').value.trim();

    if (!name) { Utils.showToast('请输入名称', 'error'); return; }
    if (!regex) { Utils.showToast('请输入正则表达式', 'error'); return; }

    try {
      if (this._editingPatternId) {
        await PatternDB.update(this._editingPatternId, { name, regex, description: desc, dateFormat: dateFmt });
        Utils.showToast('Pattern 已更新', 'success');
      } else {
        await PatternDB.add({ name, regex, description: desc, dateFormat: dateFmt });
        Utils.showToast('Pattern 已创建', 'success');
      }
      this.hideInlineEditor();
      await this.loadMainPatternList();
      this.renderMainPatternList();
    } catch (e) {
      Utils.showToast('保存失败: ' + e.message, 'error');
    }
  },

  async editPatternInMain(pattern) {
    this.showInlineEditor(pattern);
  },

  async deletePatternInMain(id) {
    if (!confirm('确定要删除这个 Pattern 吗？')) return;
    try {
      await PatternDB.remove(id);
      if (LogParser.config.activePatternId === id) {
        LogParser.config.activePatternId = null;
        LogParser.config.activePatternName = '';
      }
      Utils.showToast('已删除', 'success');
      await this.loadMainPatternList();
      this.renderMainPatternList();
    } catch (e) {
      Utils.showToast('删除失败: ' + e.message, 'error');
    }
  },

  // ===== 详情面板 =====
  bindDetailPanel() {
    document.getElementById('btn-close-detail').addEventListener('click', () => {
      document.getElementById('detail-panel').classList.remove('expanded');
    });

    document.getElementById('btn-copy-entry').addEventListener('click', () => {
      const raw = document.getElementById('detail-raw').textContent;
      if (raw && raw !== '-') Utils.copyToClipboard(raw);
    });

    // 字段独立复制：事件委托
    document.getElementById('detail-content').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-copy-field');
      if (!btn) return;
      const valueEl = btn.parentElement.querySelector('.detail-value');
      if (!valueEl) return;
      const text = valueEl.textContent;
      if (!text || text === '-') return;
      const label = btn.dataset.label || btn.dataset.field || '字段';
      Utils.copyToClipboard(text, label);
    });

    document.getElementById('btn-filter-similar').addEventListener('click', () => {
      const selected = this.getSelectedEntry();
      if (selected) {
        LogFilter.filterSimilar(selected);
        this.refresh();
      }
    });

    document.getElementById('btn-toggle-bookmark').addEventListener('click', () => {
      const selected = this.getSelectedEntry();
      if (selected) this.toggleBookmark(selected);
    });

    // 拖拽调整详情面板宽度
    const resizer = document.getElementById('detail-resizer');
    let resizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      resizing = true;
      startX = e.clientX;
      const panel = document.getElementById('detail-panel');
      startWidth = panel.offsetWidth;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const panel = document.getElementById('detail-panel');
      const newWidth = startWidth - (e.clientX - startX);
      if (newWidth >= 250 && newWidth <= 600) {
        panel.style.width = newWidth + 'px';
        panel.style.minWidth = newWidth + 'px';
      }
    });

    document.addEventListener('mouseup', () => { resizing = false; });
  },

  // ===== 弹出面板 =====
  bindPopups() {
    // 书签面板
    document.getElementById('btn-close-bookmarks').addEventListener('click', () => {
      document.getElementById('bookmarks-panel').style.display = 'none';
      Utils.hideOverlay();
    });

    document.getElementById('btn-clear-bookmarks').addEventListener('click', () => {
      this.bookmarks = [];
      LogParser.entries.forEach(e => (e.bookmarked = false));
      this.renderBookmarks();
      LogGrid.render();
    });

    document.getElementById('btn-export-bookmarks').addEventListener('click', () => {
      const content = this.bookmarks.map(b => b.raw).join('\n');
      Utils.downloadFile(content, 'bookmarks.log');
    });

    // 统计面板
    document.getElementById('btn-close-stats').addEventListener('click', () => {
      document.getElementById('stats-panel').style.display = 'none';
      Utils.hideOverlay();
    });

    // 时间线面板
    document.getElementById('btn-close-timeline').addEventListener('click', () => {
      document.getElementById('timeline-panel').style.display = 'none';
      Utils.hideOverlay();
    });

    // 高亮设置面板
    document.getElementById('btn-close-highlight-settings').addEventListener('click', () => {
      document.getElementById('highlight-settings-panel').style.display = 'none';
      Utils.hideOverlay();
    });
    document.getElementById('hs-enabled').addEventListener('change', (e) => {
      LogFilter.state.highlight = e.target.checked;
      App.refresh();
    });
    document.querySelectorAll('#hs-field-list input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const field = e.target.dataset.field;
        LogFilter.state.highlightFields[field] = e.target.checked;
        App.refresh();
      });
    });

    // 列设置面板
    document.getElementById('btn-close-column-settings').addEventListener('click', () => {
      document.getElementById('column-settings-panel').style.display = 'none';
      Utils.hideOverlay();
    });
    document.querySelectorAll('#cs-column-list .cs-column[data-col] input').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const col = e.target.closest('.cs-column').dataset.col;
        if (e.target.checked) {
          LogGrid.hiddenColumns.delete(col);
        } else {
          LogGrid.hiddenColumns.add(col);
        }
        LogGrid.renderHeader();
        App.refresh();
      });
    });

    // 解析器配置面板
    document.getElementById('btn-close-parser-config').addEventListener('click', () => {
      document.getElementById('parser-config-panel').style.display = 'none';
      Utils.hideOverlay();
    });

    document.getElementById('parser-preset').addEventListener('change', (e) => {
      const val = e.target.value;
      document.getElementById('custom-regex-section').style.display = val === 'custom' ? 'block' : 'none';
      document.getElementById('smart-rule-section').style.display = val === 'smart' ? 'block' : 'none';
    });

    document.getElementById('btn-apply-parser').addEventListener('click', () => {
      const preset = document.getElementById('parser-preset').value;
      const customRegex = document.getElementById('custom-regex').value;
      const customDateFormat = document.getElementById('custom-date-format').value;
      const encoding = document.getElementById('parser-encoding').value;

      LogParser.config = { preset, customRegex, customDateFormat, encoding, activePatternId: null, activePatternName: '' };
      document.getElementById('parser-config-panel').style.display = 'none';
      Utils.hideOverlay();

      if (LogParser.fileInfo) {
        this.reloadFile();
      }
    });

    // 当前活跃 Pattern - 重新解析
    document.getElementById('btn-ap-reparse').addEventListener('click', () => {
      const regex = document.getElementById('active-pattern-regex').value.trim();
      if (!regex) { Utils.showToast('请输入正则表达式', 'error'); return; }
      LogParser.config.preset = 'custom';
      LogParser.config.customRegex = regex;
      LogParser.config.customDateFormat = document.getElementById('custom-date-format').value.trim();
      document.getElementById('parser-config-panel').style.display = 'none';
      Utils.hideOverlay();
      this.reloadFile();
    });

    // 当前活跃 Pattern - 保存到 DB
    document.getElementById('btn-ap-save-to-db').addEventListener('click', () => {
      this.saveActivePatternToDB();
    });

    // 活跃正则编辑时实时保存到 config
    document.getElementById('active-pattern-regex').addEventListener('input', Utils.debounce(() => {
      const val = document.getElementById('active-pattern-regex').value.trim();
      if (val) {
        LogParser.config.customRegex = val;
        LogParser.config.preset = 'custom';
      }
    }, 500));

    // ===== 主界面 Pattern 管理器事件 =====
    document.getElementById('btn-pm-close').addEventListener('click', () => this.closeMainPatternManager());
    document.getElementById('btn-pm-new').addEventListener('click', () => this.showInlineEditor(null));
    document.getElementById('btn-pm-import').addEventListener('click', () => {
      ParseWizard.showImportDialog();
      const importBtn = document.getElementById('btn-pi-import');
      const newImport = importBtn.cloneNode(true);
      importBtn.parentNode.replaceChild(newImport, importBtn);
      newImport.onclick = async () => {
        await ParseWizard.doImportPatterns();
        await this.loadMainPatternList();
        this.renderMainPatternList();
      };
    });
    document.getElementById('btn-pm-export').addEventListener('click', () => ParseWizard.exportPatterns());
    document.getElementById('btn-pm-save').addEventListener('click', () => this.savePatternInline());
    document.getElementById('btn-pm-cancel').addEventListener('click', () => this.hideInlineEditor());
    document.getElementById('btn-pm-editor-close').addEventListener('click', () => this.hideInlineEditor());

    // Pattern 保存确认面板事件
    document.getElementById('btn-psp-close').addEventListener('click', () => this.hideSavePanel());
    document.getElementById('btn-psp-skip').addEventListener('click', () => this.hideSavePanel());
    document.getElementById('btn-psp-save').addEventListener('click', () => this.confirmSavePattern());

    // 智能规则生成器事件
    this.bindSmartRuleGenerator();
  },

  // ===== 智能规则生成器 =====
  bindSmartRuleGenerator() {
    const sampleInput = document.getElementById('smart-sample');

    // 自动分析
    document.getElementById('btn-analyze-sample').addEventListener('click', () => {
      const line = sampleInput.value.trim();
      if (!line) {
        Utils.showToast('请先粘贴一行日志样本', 'error');
        return;
      }
      this.runSmartAnalysis(line);
    });

    // 从当前选中行粘贴
    document.getElementById('btn-paste-from-grid').addEventListener('click', () => {
      const entry = this.getSelectedEntry();
      if (entry && entry.raw) {
        sampleInput.value = entry.raw;
        this.runSmartAnalysis(entry.raw);
      } else {
        Utils.showToast('请先在日志表格中选中一行', 'error');
      }
    });

    // 样本输入框回车触发分析
    sampleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        this.runSmartAnalysis(sampleInput.value.trim());
      }
    });

    // 应用智能规则
    document.getElementById('btn-apply-smart-rule').addEventListener('click', () => {
      const regex = SmartRuleGenerator.generatedRegex;
      const dateFormat = SmartRuleGenerator.generatedDateFormat;
      if (!regex) {
        Utils.showToast('请先生成规则', 'error');
        return;
      }
      LogParser.config = {
        preset: 'custom',
        customRegex: regex,
        customDateFormat: dateFormat,
        encoding: document.getElementById('parser-encoding').value,
        activePatternId: null,
        activePatternName: ''
      };
      document.getElementById('parser-config-panel').style.display = 'none';
      Utils.hideOverlay();

      if (LogParser.fileInfo) {
        this.reloadFile();
      } else {
        Utils.showToast('规则已保存，打开文件时将使用此规则', 'success');
      }
    });

    // 复制正则
    document.getElementById('btn-copy-regex').addEventListener('click', () => {
      const regex = document.getElementById('generated-regex').textContent;
      if (regex) Utils.copyToClipboard(regex);
    });
  },

  // 运行智能分析
  runSmartAnalysis(line) {
    if (!line) return;

    const result = SmartRuleGenerator.analyze(line);

    // 显示分词结果
    this.renderTokens(result.tokens);
    document.getElementById('token-view-section').style.display = 'block';

    // 显示字段分配下拉
    this.renderFieldAssigns(result.tokens);
    document.getElementById('field-assign-section').style.display = 'block';

    // 生成并显示正则
    SmartRuleGenerator.regenerateRegex();
    this.updateRegexPreview();

    // 显示正则预览
    document.getElementById('regex-preview-section').style.display = 'block';

    // 测试正则
    this.runRegexTest();

    // 启用应用按钮
    document.getElementById('btn-apply-smart-rule').disabled = false;
  },

  // 渲染分词结果
  renderTokens(tokens) {
    const container = document.getElementById('token-list');
    const fieldColors = {
      timestamp: 'timestamp', level: 'level',
      pid: 'pid', tid: 'tid', tag: 'tag', source: 'source', message: 'message'
    };

    container.innerHTML = tokens.map((t, i) => {
      const assigned = SmartRuleGenerator.assignments;
      let fieldType = 'ignored';
      let tag = '';
      for (const [field, idx] of Object.entries(assigned)) {
        if (idx === i) {
          fieldType = fieldColors[field] || 'ignored';
          tag = field;
          break;
        }
      }
      return `<span class="token-chip ${fieldType}" data-idx="${i}" title="点击切换字段类型">
        ${tag ? `<span class="token-tag">${tag}</span>` : ''}${this.escapeHtml(t.text)}
      </span>`;
    }).join('');

    // 点击token切换字段类型
    container.querySelectorAll('.token-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = parseInt(chip.dataset.idx);
        this.cycleTokenField(idx);
      });
    });
  },

  // 循环切换token字段类型
  cycleTokenField(tokenIdx) {
    const fieldCycle = ['timestamp', 'level', 'pid', 'tid', 'tag', 'source', 'message', null]; // null = 取消分配
    const current = Object.entries(SmartRuleGenerator.assignments).find(([, idx]) => idx === tokenIdx);
    const currentField = current ? current[0] : null;
    const currentCycleIdx = fieldCycle.indexOf(currentField);
    const nextIdx = (currentCycleIdx + 1) % fieldCycle.length;
    const nextField = fieldCycle[nextIdx];

    if (nextField === null) {
      SmartRuleGenerator.unassignField(tokenIdx);
    } else {
      SmartRuleGenerator.assignField(tokenIdx, nextField);
    }

    // 重新渲染
    this.renderTokens(SmartRuleGenerator.tokens);
    this.renderFieldAssigns(SmartRuleGenerator.tokens);
    this.updateRegexPreview();
    this.runRegexTest();
  },

  // 渲染字段分配下拉
  renderFieldAssigns(tokens) {
    const fields = ['timestamp', 'level', 'pid', 'tid', 'tag', 'source', 'message'];
    const assignments = SmartRuleGenerator.assignments;

    // 构建token选项
    const tokenOptions = tokens.map((t, i) =>
      `<option value="${i}">[${i}] ${this.escapeHtml(t.text.substring(0, 40))}${t.text.length > 40 ? '...' : ''}</option>`
    ).join('');

    fields.forEach(field => {
      const select = document.querySelector(`.field-assign-select[data-field="${field}"]`);
      if (!select) return;
      const currentIdx = assignments[field];
      select.innerHTML = '<option value="-1">未分配</option>' + tokenOptions;
      if (currentIdx !== undefined) {
        select.value = currentIdx;
      } else {
        select.value = '-1';
      }

      // 移除旧事件，添加新事件
      const newSelect = select.cloneNode(true);
      select.parentNode.replaceChild(newSelect, select);
      newSelect.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value);
        if (idx >= 0) {
          SmartRuleGenerator.assignField(idx, field);
        } else {
          SmartRuleGenerator.unassignField(assignments[field]);
        }
        this.renderTokens(SmartRuleGenerator.tokens);
        this.renderFieldAssigns(SmartRuleGenerator.tokens);
        this.updateRegexPreview();
        this.runRegexTest();
      });
    });

    // 日期格式
    const dateInput = document.querySelector('.field-date-format[data-field="dateFormat"]');
    if (dateInput) {
      dateInput.value = SmartRuleGenerator.generatedDateFormat || '';
      const newDateInput = dateInput.cloneNode(true);
      dateInput.parentNode.replaceChild(newDateInput, dateInput);
      newDateInput.addEventListener('input', Utils.debounce(() => {
        SmartRuleGenerator.generatedDateFormat = newDateInput.value;
      }, 300));
    }
  },

  // 更新正则预览
  updateRegexPreview() {
    const regex = SmartRuleGenerator.generatedRegex;
    document.getElementById('generated-regex').textContent = regex || '点击token分配字段以生成正则';
    document.getElementById('regex-preview-section').style.display = 'block';
  },

  // 测试正则
  runRegexTest() {
    const regex = SmartRuleGenerator.generatedRegex;
    const container = document.getElementById('regex-test-results');
    if (!regex) {
      container.innerHTML = '';
      document.getElementById('regex-test-section').style.display = 'none';
      return;
    }

    document.getElementById('regex-test-section').style.display = 'block';

    // 从已加载的日志中采样测试
    const samples = LogParser.rawLines.filter(l => l.trim()).slice(0, 10);
    if (samples.length === 0) {
      // 使用样本行本身
      const sampleLine = document.getElementById('smart-sample').value.trim();
      if (sampleLine) samples.push(sampleLine);
    }

    const results = SmartRuleGenerator.testRegex(regex, samples);
    const matchCount = results.filter(r => r.match).length;

    container.innerHTML = `
      <div style="margin-bottom:4px;font-size:11px;color:var(--text-muted)">
        匹配: ${matchCount}/${results.length} 行
      </div>
      ${results.map(r => `
        <div class="test-result-row ${r.match ? 'match' : 'no-match'}">
          <span class="test-icon">${r.match ? '✅' : '❌'}</span>
          <span class="test-line">${this.escapeHtml(r.line.substring(0, 100))}</span>
          ${r.match && r.fields ? `<span class="test-fields">${Object.entries(r.fields).map(([k, v]) => `${k}=${(v || '').substring(0, 20)}`).join(', ')}</span>` : ''}
        </div>
      `).join('')}
    `;
  },

  // ===== 拖放 =====
  bindDragDrop() {
    const dropZone = document.createElement('div');
    dropZone.id = 'drop-zone';
    dropZone.textContent = '📂 拖放日志文件到此处';
    document.body.appendChild(dropZone);

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) dropZone.style.display = 'flex';
    });

    document.addEventListener('dragleave', (e) => {
      dragCounter--;
      if (dragCounter === 0) dropZone.style.display = 'none';
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropZone.style.display = 'none';
      if (e.dataTransfer.files.length > 0) {
        this.openFiles(e.dataTransfer.files);
      }
    });
  },

  // ===== 键盘快捷键 =====
  bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+O: 打开文件
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        document.getElementById('file-input').click();
      }
      // Ctrl+B: 添加书签
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        this.addBookmark();
      }
      // Ctrl+F: 聚焦搜索
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        document.getElementById('search-input').focus();
      }
      // F3: 下一个搜索结果
      if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) this.searchPrev();
        else this.searchNext();
      }
      // Ctrl+S: 导出
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.exportLogs();
      }
      // Ctrl+G: 跳转到行
      if (e.ctrlKey && e.key === 'g') {
        e.preventDefault();
        document.getElementById('goto-line-input').focus();
        document.getElementById('goto-line-input').select();
      }
    });
  },

  // ===== 解析器配置 =====
  bindParserConfig() {
    // 双击状态栏打开配置
    document.getElementById('status-encoding').addEventListener('click', () => {
      this.showParserConfig();
    });
  },

  // ===== 文件操作 =====
  async openFiles(files) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);

    // 如果已有数据，直接合并（使用当前解析配置），跳过向导
    if (LogParser.entries.length > 0) {
      Utils.showLoading('正在合并文件...');
      try {
        await LogParser.mergeFiles(arr, {}, true);
        this.onDataLoaded();
      } catch (err) {
        Utils.showToast('合并失败: ' + err.message, 'error');
      }
      Utils.hideLoading();
      return;
    }

    // 首次打开：弹出解析向导
    this.pendingFiles = arr;
    ParseWizard.show(this.pendingFiles);
  },

  async mergeFiles(files) {
    Utils.showLoading('正在合并日志文件...');
    try {
      await LogParser.mergeFiles(Array.from(files), {}, LogParser.entries.length > 0);
      this.onDataLoaded();
    } catch (err) {
      Utils.showToast('合并失败: ' + err.message, 'error');
    }
    Utils.hideLoading();
  },

  async reloadFile() {
    if (!LogParser.fileInfo) {
      Utils.showToast('没有已加载的文件', 'error');
      return;
    }
    await this.reparseWithCurrentConfig();
  },

  async reparseWithCurrentConfig() {
    Utils.showLoading('正在重新解析...');
    try {
      const entryCount = await LogParser.reparse(LogParser.config);
      Utils.hideLoading();
      if (entryCount >= 0) {
        this.onDataLoaded();
      } else {
        Utils.showToast('重新解析失败，正则可能不匹配', 'error');
      }
    } catch (e) {
      Utils.hideLoading();
      Utils.showToast('重新解析失败: ' + e.message, 'error');
    }
  },

  onDataLoaded() {
    this.bookmarks = [];
    LogFilter.resetSearch();
    LogFilter.state.sortColumn = null;
    LogFilter.state.sortDirection = 'asc';
    document.getElementById('grid-header').querySelectorAll('.col').forEach(c => c.classList.remove('sorted'));
    this.refresh();
    this.updateFileInfo();
    this.renderFilesList();
    Utils.showToast(`已加载 ${Utils.formatNumber(LogParser.entries.length)} 条日志`, 'success');
  },

  // ===== 实时追踪 =====
  // 实时追踪用于监控正在写入的日志文件（如应用运行时日志）。
  // 由于浏览器安全限制，无法直接访问本地文件系统进行 tail -f 操作。
  // 当前为模拟模式，实际使用时需要配合后端 API 或本地服务实现真正的文件轮询。
  toggleTail() {
    const btn = document.getElementById('btn-tail');
    if (this.tailTimer) {
      clearInterval(this.tailTimer);
      this.tailTimer = null;
      this.tailFile = null;
      btn.textContent = '▶️ 实时追踪';
      btn.style.color = '';
      document.getElementById('status-text').textContent = '就绪';
      Utils.showToast('已停止实时追踪');
    } else {
      if (!LogParser.fileInfo) {
        Utils.showToast('请先打开文件', 'error');
        return;
      }
      btn.textContent = '⏸️ 停止追踪';
      btn.style.color = 'var(--success)';
      document.getElementById('status-text').textContent = '实时追踪中（模拟）';
      Utils.showToast('实时追踪：浏览器端无法直接 tail 本地文件。如需真正实时追踪，请配合后端轮询接口使用。当前为模拟演示。', 'success');
      this.tailTimer = setInterval(() => {
        document.getElementById('status-text').textContent = '实时追踪中（模拟）';
      }, 2000);
    }
  },

  // ===== 导出 =====
  exportLogs() {
    const filtered = LogFilter.apply(LogParser.entries);
    if (filtered.length === 0) {
      Utils.showToast('没有可导出的日志', 'error');
      return;
    }
    const content = filtered.map(e => e.raw).join('\n');
    const filename = (LogParser.fileInfo?.name || 'logs') + '.export.log';
    Utils.downloadFile(content, filename);
    Utils.showToast(`已导出 ${Utils.formatNumber(filtered.length)} 条日志`);
  },

  // ===== 清除 =====
  clearAll() {
    LogParser.clear();
    this.bookmarks = [];
    LogFilter.resetSearch();
    LogGrid.setData([]);
    document.getElementById('detail-panel').classList.remove('expanded');
    document.getElementById('status-file').textContent = '未打开文件';
    document.getElementById('status-encoding').textContent = 'UTF-8';
    document.getElementById('entry-count').textContent = '';
    document.getElementById('status-text').textContent = '就绪';
    Utils.showToast('已清除所有日志');
  },

  // ===== 书签 =====
  addBookmark() {
    const entry = this.getSelectedEntry();
    if (!entry) {
      Utils.showToast('请先选择一条日志', 'error');
      return;
    }
    this.toggleBookmark(entry);
  },

  toggleBookmark(entry) {
    if (!entry) return;
    entry.bookmarked = !entry.bookmarked;
    if (entry.bookmarked) {
      if (!this.bookmarks.find(b => b.index === entry.index)) {
        this.bookmarks.push(entry);
      }
    } else {
      this.bookmarks = this.bookmarks.filter(b => b.index !== entry.index);
    }
    LogGrid.render();
    this.renderBookmarks();
  },

  toggleBookmarksPanel() {
    const panel = document.getElementById('bookmarks-panel');
    if (panel.style.display === 'none') {
      this.renderBookmarks();
      panel.style.display = 'flex';
      Utils.showOverlay();
    } else {
      panel.style.display = 'none';
      Utils.hideOverlay();
    }
  },

  renderBookmarks() {
    const list = document.getElementById('bookmarks-list');
    if (this.bookmarks.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">暂无书签</div>';
      return;
    }
    list.innerHTML = this.bookmarks.map((b, i) => `
      <div class="bookmark-item" data-index="${b.index}">
        <span class="bm-index">#${b.index + 1}</span>
        <span class="bm-level level-${b.level}">${b.level || '-'}</span>
        <span class="bm-message">${this.escapeHtml(b.message || b.raw)}</span>
        <span class="bm-remove" data-idx="${i}" title="移除书签">✕</span>
      </div>
    `).join('');

    // 点击书签跳转
    list.querySelectorAll('.bookmark-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('bm-remove')) return;
        const idx = parseInt(item.dataset.index);
        const entry = LogParser.entries.find(e => e.index === idx);
        if (entry) {
          LogGrid.scrollToEntry(entry);
          document.getElementById('bookmarks-panel').style.display = 'none';
          Utils.hideOverlay();
        }
      });
    });

    // 移除书签
    list.querySelectorAll('.bm-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.dataset.idx);
        const entry = this.bookmarks[i];
        if (entry) {
          entry.bookmarked = false;
          this.bookmarks.splice(i, 1);
          this.renderBookmarks();
          LogGrid.render();
        }
      });
    });
  },

  // ===== 统计面板 =====
  toggleStatsPanel() {
    const panel = document.getElementById('stats-panel');
    if (panel.style.display === 'none') {
      const stats = LogStats.calculate(LogParser.entries);
      LogStats.render(stats);
      panel.style.display = 'flex';
      Utils.showOverlay();
    } else {
      panel.style.display = 'none';
      Utils.hideOverlay();
    }
  },

  // ===== 时间线面板 =====
  toggleTimelinePanel() {
    const panel = document.getElementById('timeline-panel');
    if (panel.style.display === 'none') {
      panel.style.display = 'flex';
      Utils.showOverlay();
      // 延迟设置canvas尺寸
      setTimeout(() => {
        const canvas = document.getElementById('timeline-canvas');
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        Timeline.show(LogParser.entries);
      }, 50);
    } else {
      panel.style.display = 'none';
      Utils.hideOverlay();
    }
  },

  // ===== 解析器配置 =====
  showParserConfig() {
    // 互斥：关闭 Pattern 管理器
    document.getElementById('pattern-manager-main').style.display = 'none';
    const panel = document.getElementById('parser-config-panel');
    const preset = LogParser.config.preset;
    document.getElementById('parser-preset').value = preset;
    document.getElementById('custom-regex').value = LogParser.config.customRegex || '';
    document.getElementById('custom-date-format').value = LogParser.config.customDateFormat || '';
    document.getElementById('parser-encoding').value = LogParser.config.encoding;
    document.getElementById('custom-regex-section').style.display = preset === 'custom' ? 'block' : 'none';
    document.getElementById('smart-rule-section').style.display = preset === 'smart' ? 'block' : 'none';

    // 显示当前活跃 Pattern
    this.updateActivePatternDisplay();
    // 加载最近 Pattern 列表
    this.loadPatternQuickList();

    panel.style.display = 'flex';
    Utils.showOverlay();
  },

  updateActivePatternDisplay() {
    const nameEl = document.getElementById('active-pattern-name');
    const regexEl = document.getElementById('active-pattern-regex');
    const metaEl = document.getElementById('active-pattern-meta');

    const name = LogParser.config.activePatternName || '';
    const cfg = LogParser.config;

    if (cfg.activePatternId && name) {
      nameEl.textContent = `📌 ${name}`;
    } else if (cfg.preset === 'custom' && cfg.customRegex) {
      nameEl.textContent = '📝 自定义正则';
    } else if (cfg.preset !== 'auto') {
      nameEl.textContent = `📋 ${cfg.preset}`;
    } else {
      nameEl.textContent = '🤖 自动检测';
    }

    // 显示当前实际使用的正则
    const activeRegex = this.getActiveRegex();
    regexEl.value = activeRegex || '';
    metaEl.textContent = cfg.preset === 'custom' && cfg.customDateFormat
      ? `日期格式: ${cfg.customDateFormat}` : '';
  },

  getActiveRegex() {
    const cfg = LogParser.config;
    if (cfg.customRegex) return cfg.customRegex;
    if (cfg.preset && cfg.preset !== 'auto' && cfg.preset !== 'json') {
      const p = LogParser.presets[cfg.preset];
      return p ? p.regex.source : '';
    }
    return '';
  },

  async loadPatternQuickList() {
    const container = document.getElementById('pattern-quick-list');
    if (!container) return;
    try {
      const list = await PatternDB.getAll();
      if (list.length === 0) {
        container.innerHTML = '<div class="pq-empty">暂无保存的 Pattern</div>';
        return;
      }
      const recent = list.slice(0, 6);
      container.innerHTML = recent.map(p => {
        const isActive = p.id === LogParser.config.activePatternId;
        const preview = (p.regex || '').substring(0, 40) + ((p.regex || '').length > 40 ? '...' : '');
        const cls = isActive ? 'pq-item active' : 'pq-item';
        return `<div class="${cls}" data-id="${p.id}" data-regex="${this.escapeHtml(p.regex || '')}" data-date="${this.escapeHtml(p.dateFormat || '')}" title="${this.escapeHtml(preview)}">
          <span class="pq-name">${isActive ? '✅ ' : ''}${this.escapeHtml(p.name)}</span>
          <button class="pq-load" data-id="${p.id}">📥</button>
        </div>`;
      }).join('');

      container.querySelectorAll('.pq-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('pq-load')) return;
          const regex = item.dataset.regex;
          const date = item.dataset.date;
          if (regex) {
            document.getElementById('active-pattern-regex').value = regex;
            document.getElementById('custom-regex').value = regex;
            document.getElementById('custom-date-format').value = date || '';
            document.getElementById('parser-preset').value = 'custom';
            document.getElementById('custom-regex-section').style.display = 'block';
            LogParser.config.customRegex = regex;
            LogParser.config.customDateFormat = date || '';
            LogParser.config.preset = 'custom';
          }
        });
        const loadBtn = item.querySelector('.pq-load');
        if (loadBtn) {
          loadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(loadBtn.dataset.id);
            const p = list.find(x => x.id === id);
            if (p) this.loadPatternAndReparse(p);
          });
        }
      });
    } catch {
      container.innerHTML = '<div class="pq-empty">加载失败</div>';
    }
  },

  async loadPatternAndReparse(pattern) {
    LogParser.config.preset = 'custom';
    LogParser.config.customRegex = pattern.regex || '';
    LogParser.config.customDateFormat = pattern.dateFormat || '';
    LogParser.config.customGroups = null;
    if (pattern.groupsJSON) {
      try { LogParser.config.customGroups = JSON.parse(pattern.groupsJSON); } catch {}
    }
    LogParser.config.activePatternId = pattern.id;
    LogParser.config.activePatternName = pattern.name || '';

    document.getElementById('parser-config-panel').style.display = 'none';
    Utils.hideOverlay();

    Utils.showToast(`已加载 Pattern: ${pattern.name}`, 'success');
    this.reloadFile();
  },

  async saveActivePatternToDB() {
    const regex = document.getElementById('active-pattern-regex').value.trim();
    const dateFmt = document.getElementById('custom-date-format').value.trim();
    if (!regex) { Utils.showToast('请输入正则表达式', 'error'); return; }

    const name = prompt('请输入 Pattern 名称:', LogParser.config.activePatternName || '');
    if (!name) return;

    try {
      if (LogParser.config.activePatternId) {
        await PatternDB.update(LogParser.config.activePatternId, { name, regex, dateFormat: dateFmt });
      } else {
        const existing = await PatternDB.getByName(name);
        if (existing) {
          await PatternDB.update(existing.id, { name, regex, dateFormat: dateFmt });
          LogParser.config.activePatternId = existing.id;
        } else {
          const newId = await PatternDB.add({ name, regex, dateFormat: dateFmt, description: '' });
          LogParser.config.activePatternId = newId;
        }
      }
      LogParser.config.activePatternName = name;
      Utils.showToast(`Pattern "${name}" 已保存`, 'success');
      this.updateActivePatternDisplay();
      this.loadPatternQuickList();
    } catch (e) {
      Utils.showToast('保存失败: ' + e.message, 'error');
    }
  },

  // ===== 详情面板 =====
  showDetail(entry) {
    if (!entry) return;
    const panel = document.getElementById('detail-panel');
    panel.classList.add('expanded');

    document.getElementById('detail-timestamp').textContent = entry.timestamp || '-';
    document.getElementById('detail-level').textContent = entry.level || '-';
    document.getElementById('detail-level').className = `level-${entry.level}`;
    document.getElementById('detail-pid').textContent = entry.pid || '-';
    document.getElementById('detail-tid').textContent = entry.tid || '-';
    document.getElementById('detail-source').textContent = entry.source || '-';
    document.getElementById('detail-message').textContent = entry.message || '-';
    document.getElementById('detail-raw').textContent = entry.raw || '-';
  },

  getSelectedEntry() {
    if (LogGrid.selectedIndex >= 0 && LogGrid.selectedIndex < LogGrid.entries.length) {
      return LogGrid.entries[LogGrid.selectedIndex];
    }
    return null;
  },

  // ===== 搜索导航 =====
  searchNext() {
    const idx = LogFilter.nextMatch();
    if (idx >= 0) {
      const entry = LogFilter.getCurrentMatch();
      if (entry) LogGrid.scrollToEntry(entry);
    }
    this.updateSearchStats();
  },

  searchPrev() {
    const idx = LogFilter.prevMatch();
    if (idx >= 0) {
      const entry = LogFilter.getCurrentMatch();
      if (entry) LogGrid.scrollToEntry(entry);
    }
    this.updateSearchStats();
  },

  // ===== 跳转到指定行 =====
  gotoLine() {
    const input = document.getElementById('goto-line-input');
    const val = input.value.trim();
    if (!val) return;

    const hasSearch = LogFilter.searchMatches.length > 0;

    if (val.startsWith('#')) {
      // #N: 跳转到搜索结果中的第 N 个
      if (!hasSearch) {
        Utils.showToast('没有搜索结果', 'error');
        return;
      }
      const searchIdx = parseInt(val.substring(1), 10);
      if (isNaN(searchIdx) || searchIdx < 1 || searchIdx > LogFilter.searchMatches.length) {
        Utils.showToast(`搜索结果序号无效 (1-${LogFilter.searchMatches.length})`, 'error');
        return;
      }
      LogFilter.currentMatchIndex = searchIdx - 1;
      const entry = LogFilter.searchMatches[searchIdx - 1];
      LogGrid.scrollToEntry(entry);
      this.updateSearchStats();
      Utils.showToast(`已跳转到第 ${searchIdx} 个搜索结果（原始行号 ${entry.index + 1}）`, 'success');
      return;
    }

    if (val.startsWith('@')) {
      // @N: 跳转到第 N 个书签
      if (this.bookmarks.length === 0) {
        Utils.showToast('没有书签', 'error');
        return;
      }
      const bmIdx = parseInt(val.substring(1), 10);
      if (isNaN(bmIdx) || bmIdx < 1 || bmIdx > this.bookmarks.length) {
        Utils.showToast(`书签序号无效 (1-${this.bookmarks.length})`, 'error');
        return;
      }
      const entry = this.bookmarks[bmIdx - 1];
      LogGrid.scrollToEntry(entry);
      Utils.showToast(`已跳转到第 ${bmIdx} 个书签（原始行号 ${entry.index + 1}）`, 'success');
      return;
    }

    const lineNum = parseInt(val, 10);
    if (isNaN(lineNum) || lineNum < 1) {
      Utils.showToast('请输入有效的行号', 'error');
      return;
    }

    if (hasSearch) {
      // 有搜索结果时：按原始行号在搜索结果中查找
      const matchIdx = LogFilter.searchMatches.findIndex(e => (e.index + 1) === lineNum);
      if (matchIdx === -1) {
        Utils.showToast(`搜索结果中未找到原始行号 ${lineNum}`, 'error');
        return;
      }
      LogFilter.currentMatchIndex = matchIdx;
      const entry = LogFilter.searchMatches[matchIdx];
      LogGrid.scrollToEntry(entry);
      this.updateSearchStats();
      Utils.showToast(`已跳转到原始行号 ${lineNum}（搜索结果第 ${matchIdx + 1}/${LogFilter.searchMatches.length} 个）`, 'success');
    } else {
      // 无搜索结果时：按原始行号在全量数据中查找
      const entry = LogParser.entries.find(e => (e.index + 1) === lineNum);
      if (!entry) {
        Utils.showToast(`未找到原始行号 ${lineNum}（有效范围 1-${LogParser.entries.length}）`, 'error');
        return;
      }
      LogGrid.scrollToEntry(entry);
      Utils.showToast(`已跳转到原始行号 ${lineNum}`, 'success');
    }
  },

  updateSearchStats() {
    const stats = document.getElementById('search-stats');
    if (LogFilter.searchMatches.length > 0) {
      stats.textContent = `${LogFilter.currentMatchIndex + 1}/${LogFilter.searchMatches.length}`;
    } else if (LogFilter.state.searchText) {
      stats.textContent = '0/0';
    } else {
      stats.textContent = '';
    }
  },

  // ===== 更新文件信息 =====
  updateFileInfo() {
    if (LogParser.fileInfo) {
      document.getElementById('status-file').textContent =
        `${LogParser.fileInfo.name} (${Utils.formatBytes(LogParser.fileInfo.size)})`;
    }
    document.getElementById('status-encoding').textContent = LogParser.config.encoding || 'UTF-8';
  },

  // ===== 文件列表面板 =====
  initFilesPanelResizer() {
    const panel = document.getElementById('files-panel');
    const resizer = document.getElementById('files-resizer');
    if (!resizer) return;
    let startX, startWidth;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev) => {
        const diff = ev.clientX - startX;
        const newW = Math.max(120, Math.min(600, startWidth + diff));
        panel.style.width = newW + 'px';
        panel.classList.add('expanded');
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  },

  toggleFilesPanel() {
    const panel = document.getElementById('files-panel');
    panel.classList.toggle('expanded');
    if (panel.classList.contains('expanded')) {
      this.renderFilesList();
    }
  },

  // ===== 高亮设置面板 =====
  toggleHighlightSettings() {
    const panel = document.getElementById('highlight-settings-panel');
    if (panel.style.display === 'none' || !panel.style.display) {
      document.getElementById('hs-enabled').checked = LogFilter.state.highlight;
      document.querySelectorAll('#hs-field-list input[type="checkbox"]').forEach(cb => {
        const field = cb.dataset.field;
        cb.checked = LogFilter.state.highlightFields[field] !== false;
      });
      panel.style.display = 'flex';
      Utils.showOverlay();
    } else {
      panel.style.display = 'none';
      Utils.hideOverlay();
    }
  },

  // ===== 列设置面板 =====
  toggleColumnSettings() {
    const panel = document.getElementById('column-settings-panel');
    if (panel.style.display === 'none' || !panel.style.display) {
      document.querySelectorAll('#cs-column-list .cs-column[data-col] input').forEach(cb => {
        const col = cb.closest('.cs-column').dataset.col;
        cb.checked = !LogGrid.hiddenColumns.has(col);
      });
      panel.style.display = 'flex';
      Utils.showOverlay();
    } else {
      panel.style.display = 'none';
      Utils.hideOverlay();
    }
  },

  renderFilesList() {
    const container = document.getElementById('files-list');
    const sourceFiles = LogParser.sourceFiles || [];

    if (sourceFiles.length === 0) {
      container.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px">暂无文件</div>';
      return;
    }

    const fileStats = {};
    for (const entry of LogParser.entries) {
      const src = entry.sourceFile || 'unknown';
      fileStats[src] = (fileStats[src] || 0) + 1;
    }

    const zipGroups = {};
    const standaloneFiles = [];
    const seenNames = new Set();

    for (const sf of sourceFiles) {
      if (seenNames.has(sf.name)) continue;
      seenNames.add(sf.name);

      if (sf.zipName) {
        if (!zipGroups[sf.zipName]) zipGroups[sf.zipName] = [];
        zipGroups[sf.zipName].push(sf);
      } else {
        standaloneFiles.push(sf);
      }
    }

    let html = '';

    for (const [zipName, files] of Object.entries(zipGroups)) {
      html += `<div class="file-group-header" title="${this.escapeHtml(zipName)}">
        <span class="file-icon">📦</span>
        <span class="file-name">${this.escapeHtml(zipName)}</span>
        <span class="file-badge">ZIP</span>
      </div>`;
      for (const sf of files) {
        const count = fileStats[sf.name] || 0;
        html += `<div class="file-item file-item-child" data-file="${this.escapeHtml(sf.name)}" title="${this.escapeHtml(sf.displayName || sf.name)} (${Utils.formatNumber(count)}条)">
          <span class="file-icon">└ 📄</span>
          <span class="file-name">${this.escapeHtml(sf.displayName || sf.name)}</span>
          <span class="file-count">${Utils.formatNumber(count)}</span>
        </div>`;
      }
    }

    for (const sf of standaloneFiles) {
      const count = fileStats[sf.name] || 0;
      html += `<div class="file-item" data-file="${this.escapeHtml(sf.name)}" title="${this.escapeHtml(sf.name)} (${Utils.formatNumber(count)}条)">
        <span class="file-icon">📄</span>
        <span class="file-name">${this.escapeHtml(sf.name)}</span>
        <span class="file-count">${Utils.formatNumber(count)}</span>
      </div>`;
    }

    container.innerHTML = html;

    container.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', () => {
        const fileName = item.dataset.file;
        const wasActive = item.classList.contains('active');
        container.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
        if (!wasActive) {
          item.classList.add('active');
          LogFilter.state.sourceFileFilter = fileName;
        } else {
          LogFilter.state.sourceFileFilter = '';
        }
        this.refresh();
      });
    });
  },

  // ===== 刷新 =====
  refresh() {
    LogGrid.refresh();
    this.updateSearchStats();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // ===== Pattern Manager =====

  bindPatternManagerEvents() {
    document.getElementById('btn-pattern-close').addEventListener('click', () => this.closePatternManager());
    document.getElementById('btn-pattern-add').addEventListener('click', () => this.showPatternEditor(null));
    document.getElementById('btn-pattern-export').addEventListener('click', () => this.exportPatterns());
    document.getElementById('btn-pattern-import').addEventListener('click', () => this.showImportDialog());
    document.getElementById('btn-pattern-editor-close').addEventListener('click', () => this.hidePatternEditor());
    document.getElementById('btn-pe-save').addEventListener('click', () => this.savePattern());
    document.getElementById('btn-pe-test').addEventListener('click', () => this.testPatternInEditor());
    document.getElementById('btn-pattern-import-close').addEventListener('click', () => this.hideImportDialog());
    document.getElementById('btn-pi-import').addEventListener('click', () => this.doImportPatterns());
    document.getElementById('btn-pi-file').addEventListener('click', () => document.getElementById('pi-file').click());
    document.getElementById('pi-file').addEventListener('change', (e) => this.onImportFileSelected(e));
  },

  async openPatternManager() {
    document.getElementById('parse-wizard').style.display = 'none';
    document.getElementById('pattern-manager').style.display = 'block';
    this.patternManagerOpen = true;
    await this.loadPatternList();
    this.renderPatternList();
  },

  closePatternManager() {
    document.getElementById('pattern-manager').style.display = 'none';
    document.getElementById('parse-wizard').style.display = 'flex';
    this.patternManagerOpen = false;
  },

  async loadPatternList() {
    try {
      this.patternList = await PatternDB.getAll();
    } catch (e) {
      this.patternList = [];
      Utils.showToast('加载 Pattern 列表失败: ' + e.message, 'error');
    }
  },

  renderPatternList() {
    const container = document.getElementById('pattern-list');
    const empty = document.getElementById('pattern-empty');
    if (!container) return;

    if (this.patternList.length === 0) {
      container.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    container.innerHTML = this.patternList.map(p => {
      const desc = p.description || '';
      const date = p.createdAt ? new Date(p.createdAt).toLocaleString() : '';
      const regexPreview = (p.regex || '').substring(0, 60) + ((p.regex || '').length > 60 ? '...' : '');
      return `<div class="pattern-card" data-id="${p.id}">
        <div class="pattern-card-info">
          <div class="pattern-card-name">${this.escapeHtml(p.name)}</div>
          <div class="pattern-card-desc">${this.escapeHtml(desc)}</div>
          <div class="pattern-card-meta">
            <code class="pattern-card-regex">${this.escapeHtml(regexPreview)}</code>
            ${date ? `<span class="pattern-card-date">${date}</span>` : ''}
          </div>
        </div>
        <div class="pattern-card-actions">
          <button class="btn-mini btn-load" data-id="${p.id}" title="加载到预设面板">📥</button>
          <button class="btn-mini btn-edit" data-id="${p.id}" title="编辑">✏️</button>
          <button class="btn-mini btn-del" data-id="${p.id}" title="删除">🗑️</button>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.btn-load').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        this.loadPatternToPreset(id);
      });
    });
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        const p = this.patternList.find(x => x.id === id);
        if (p) this.showPatternEditor(p);
      });
    });
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        this.deletePattern(id);
      });
    });
  },

  showPatternEditor(pattern) {
    this.patternEditingId = pattern ? pattern.id : null;
    document.getElementById('pattern-editor-title').textContent = pattern ? '编辑 Pattern' : '新建 Pattern';
    document.getElementById('pe-name').value = pattern ? (pattern.name || '') : '';
    document.getElementById('pe-desc').value = pattern ? (pattern.description || '') : '';
    document.getElementById('pe-regex').value = pattern ? (pattern.regex || '') : '';
    document.getElementById('pe-date-format').value = pattern ? (pattern.dateFormat || '') : '';
    document.getElementById('pe-sample').value = pattern ? (pattern.sampleLine || '') : '';
    document.getElementById('pattern-editor-overlay').style.display = 'flex';
  },

  hidePatternEditor() {
    document.getElementById('pattern-editor-overlay').style.display = 'none';
    this.patternEditingId = null;
  },

  async savePattern() {
    const name = document.getElementById('pe-name').value.trim();
    const regex = document.getElementById('pe-regex').value.trim();

    if (!name) { Utils.showToast('请输入名称', 'error'); return; }
    if (!regex) { Utils.showToast('请输入正则表达式', 'error'); return; }

    const data = {
      name,
      description: document.getElementById('pe-desc').value.trim(),
      regex,
      dateFormat: document.getElementById('pe-date-format').value.trim(),
      sampleLine: document.getElementById('pe-sample').value.trim()
    };

    try {
      if (this.patternEditingId) {
        await PatternDB.update(this.patternEditingId, data);
        Utils.showToast('Pattern 已更新', 'success');
      } else {
        await PatternDB.add(data);
        Utils.showToast('Pattern 已保存', 'success');
      }
      this.hidePatternEditor();
      await this.loadPatternList();
      this.renderPatternList();
    } catch (e) {
      Utils.showToast('保存失败: ' + e.message, 'error');
    }
  },

  async deletePattern(id) {
    if (!confirm('确定要删除这个 Pattern 吗？')) return;
    try {
      await PatternDB.remove(id);
      if (LogParser.config.activePatternId === id) {
        LogParser.config.activePatternId = null;
        LogParser.config.activePatternName = '';
      }
      Utils.showToast('已删除', 'success');
      await this.loadPatternList();
      this.renderPatternList();
    } catch (e) {
      Utils.showToast('删除失败: ' + e.message, 'error');
    }
  },

  async loadPatternToPreset(id) {
    const p = this.patternList.find(x => x.id === id);
    if (!p) return;

    document.getElementById('pattern-manager').style.display = 'none';
    document.getElementById('parse-wizard').style.display = 'flex';

    this.currentMode = 'preset';
    document.querySelectorAll('.wizard-tab').forEach(t => t.classList.remove('active'));
    const presetTab = document.querySelector('.wizard-tab[data-mode="preset"]');
    if (presetTab) presetTab.classList.add('active');
    document.querySelectorAll('.wizard-panel').forEach(pn => pn.style.display = 'none');
    document.getElementById('wizard-panel-preset').style.display = 'block';

    document.getElementById('wizard-preset-select').value = 'auto';

    const presetRegexEl = document.getElementById('wizard-preset-regex');
    const presetDateEl = document.getElementById('wizard-preset-date-format');
    if (presetRegexEl) presetRegexEl.value = p.regex || '';
    if (presetDateEl) presetDateEl.value = p.dateFormat || '';

    this.savedPresetPatterns['__loaded'] = p.regex || '';
    this.savedPresetDateFormats['__loaded'] = p.dateFormat || '';

    this.patternManagerOpen = false;
    this.testCurrentRule();
    Utils.showToast(`已加载 Pattern: ${p.name}`, 'success');
  },

  testPatternInEditor() {
    const regexStr = document.getElementById('pe-regex').value.trim();
    const sample = document.getElementById('pe-sample').value.trim() || this.getCurrentSample();

    if (!regexStr) { Utils.showToast('请输入正则表达式', 'error'); return; }

    let regex;
    try { regex = new RegExp(regexStr); } catch (e) {
      Utils.showToast('正则无效: ' + e.message, 'error');
      return;
    }

    const match = sample.match(regex);
    if (match && match.groups) {
      const fields = Object.entries(match.groups);
      let msg = '✅ 匹配成功:\n';
      msg += fields.map(([k, v]) => `  ${k}: ${(v || '').substring(0, 80)}`).join('\n');
      Utils.showToast(msg, 'success');
    } else if (match) {
      Utils.showToast('⚠️ 匹配成功，但没有命名捕获组 (使用 (?<name>...) 语法)', 'success');
    } else {
      Utils.showToast('❌ 样本行不匹配', 'error');
    }
  },

  async exportPatterns() {
    try {
      const json = await PatternDB.exportAll();
      Utils.downloadFile(json, 'weblogviewer-patterns.json', 'application/json');
      Utils.showToast('导出成功', 'success');
    } catch (e) {
      Utils.showToast('导出失败: ' + e.message, 'error');
    }
  },

  showImportDialog() {
    document.getElementById('pi-json').value = '';
    document.getElementById('pattern-import-overlay').style.display = 'flex';
  },

  hideImportDialog() {
    document.getElementById('pattern-import-overlay').style.display = 'none';
  },

  async doImportPatterns() {
    let jsonStr = document.getElementById('pi-json').value.trim();
    if (!jsonStr) { Utils.showToast('请粘贴 JSON 内容或选择文件', 'error'); return; }
    try {
      const count = await PatternDB.importFromJSON(jsonStr);
      Utils.showToast(`成功导入 ${count} 个 Pattern`, 'success');
      this.hideImportDialog();
      await this.loadPatternList();
      this.renderPatternList();
    } catch (e) {
      Utils.showToast('导入失败: ' + e.message, 'error');
    }
  },

  async onImportFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
      document.getElementById('pi-json').value = text;
    } catch (err) {
      Utils.showToast('读取文件失败: ' + err.message, 'error');
    }
  }
};

// ===== 解析向导控制器 =====
const ParseWizard = {
  files: [],
  rawLines: [],
  currentSampleIdx: 0,
  currentMode: 'preset', // 'preset' | 'smart' | 'regex'
  smartTokens: [],
  smartAssignments: {},
  savedPresetPatterns: {}, // 用户手动修改的预设正则，key=preset名
  savedPresetDateFormats: {}, // 用户手动修改的预设日期格式，key=preset名
  patternEditingId: null,    // 当前编辑中的 Pattern id，null=新建
  patternList: [],           // 已加载的 Pattern 列表缓存
  patternManagerOpen: false,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    // 关闭
    document.getElementById('btn-close-wizard').addEventListener('click', () => this.hide());

    // 模式切换
    document.querySelectorAll('.wizard-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.currentMode = tab.dataset.mode;
        document.querySelectorAll('.wizard-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.wizard-panel').forEach(p => p.style.display = 'none');
        document.getElementById(`wizard-panel-${this.currentMode}`).style.display = 'block';

        if (this.currentMode === 'smart') {
          this.runSmartAnalysis();
        }
        if (this.currentMode === 'regex') {
          this.updateFieldPatternRegex();
        }
        if (this.currentMode === 'preset') {
          this.updatePresetRegex();
        }
        this.testCurrentRule();
      });
    });

    // 样本导航
    document.getElementById('btn-prev-sample').addEventListener('click', () => this.navSample(-1));
    document.getElementById('btn-next-sample').addEventListener('click', () => this.navSample(1));
    document.getElementById('btn-use-selected').addEventListener('click', () => {
      this.currentSampleIdx = this.findBestSample();
      this.showSample();
      if (this.currentMode === 'smart') this.runSmartAnalysis();
    });

    // 测试匹配
    document.getElementById('btn-wizard-test').addEventListener('click', () => this.testCurrentRule());

    // 应用并解析
    document.getElementById('btn-wizard-apply').addEventListener('click', () => this.applyAndParse());

    // 跳过
    document.getElementById('btn-wizard-skip').addEventListener('click', () => this.skipAndParse());

    // 预设选择变化时自动测试 + 更新pattern
    document.getElementById('wizard-preset-select').addEventListener('change', () => {
      this.updatePresetRegex();
      this.testCurrentRule();
    });

    // 预设正则手动编辑时实时测试
    const presetRegexEl = document.getElementById('wizard-preset-regex');
    if (presetRegexEl) {
      presetRegexEl.addEventListener('input', Utils.debounce(() => {
        const preset = document.getElementById('wizard-preset-select').value;
        if (preset !== 'auto' && preset !== 'json') {
          this.savedPresetPatterns[preset] = presetRegexEl.value;
        }
        this.testCurrentRule();
      }, 300));
    }

    // 预设日期格式编辑
    const presetDateFormatEl = document.getElementById('wizard-preset-date-format');
    if (presetDateFormatEl) {
      presetDateFormatEl.addEventListener('input', Utils.debounce(() => {
        const preset = document.getElementById('wizard-preset-select').value;
        if (preset !== 'auto' && preset !== 'json') {
          this.savedPresetDateFormats[preset] = presetDateFormatEl.value;
        }
        this.testCurrentRule();
      }, 300));
    }

    // 手动正则输入时实时测试 + 语法高亮（元素可能不存在）
    const regexInput = document.getElementById('wizard-custom-regex');
    if (regexInput) {
      regexInput.addEventListener('input', Utils.debounce(() => {
        this.updateRegexHighlight();
        this.updateRegexStatus();
        this.analyzeRegexGroups();
        this.testCurrentRule();
      }, 200));

      // 同步滚动
      regexInput.addEventListener('scroll', () => {
        const highlight = document.getElementById('regex-highlight-layer');
        if (highlight) {
          highlight.scrollTop = regexInput.scrollTop;
          highlight.scrollLeft = regexInput.scrollLeft;
        }
      });

      // Tab 键支持
      regexInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = regexInput.selectionStart;
          const end = regexInput.selectionEnd;
          regexInput.value = regexInput.value.substring(0, start) + '  ' + regexInput.value.substring(end);
          regexInput.selectionStart = regexInput.selectionEnd = start + 2;
          regexInput.dispatchEvent(new Event('input'));
        }
      });
    }

    // 快捷插入按钮（元素可能不存在）
    document.querySelectorAll('.quick-insert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const insert = btn.dataset.insert;
        const input = document.getElementById('wizard-custom-regex');
        if (!input) return;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const before = input.value.substring(0, start);
        const after = input.value.substring(end);
        const needSep = before.length > 0 && !before.endsWith('\\') && !before.endsWith(' ');
        const sep = needSep ? '\\s+' : '';
        input.value = before + sep + insert + after;
        input.focus();
        input.selectionStart = input.selectionEnd = start + sep.length + insert.length;
        input.dispatchEvent(new Event('input'));
      });
    });

    // 智能模式：日期格式
    const wizardDateFormat = document.getElementById('wizard-date-format');
    if (wizardDateFormat) {
      wizardDateFormat.addEventListener('input', Utils.debounce(() => {
        SmartRuleGenerator.generatedDateFormat = wizardDateFormat.value;
        this.testCurrentRule();
      }, 300));
    }

    // 正则提示展开/收起（元素可能不存在）
    const btnToggleHint = document.getElementById('btn-toggle-regex-hint');
    if (btnToggleHint) {
      btnToggleHint.addEventListener('click', () => {
        const body = document.getElementById('regex-hint-body');
        if (!body) return;
        if (body.classList.contains('collapsed')) {
          body.classList.remove('collapsed');
          btnToggleHint.textContent = '收起';
        } else {
          body.classList.add('collapsed');
          btnToggleHint.textContent = '展开';
        }
      });
    }

    // ===== 字段模式输入（简化正则） =====
    const fpInputs = ['fp-timestamp', 'fp-level', 'fp-pid', 'fp-tid', 'fp-tag', 'fp-source', 'fp-message', 'fp-separator'];
    fpInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', Utils.debounce(() => {
          this.updateFieldPatternRegex();
          this.testCurrentRule();
        }, 200));
      }
    });

    // 字段模式预设下拉
    document.querySelectorAll('.fp-preset').forEach(select => {
      select.addEventListener('change', () => {
        const targetId = select.dataset.target;
        const targetInput = document.getElementById(targetId);
        if (targetInput && select.value) {
          targetInput.value = select.value;
          targetInput.dispatchEvent(new Event('input'));
        }
      });
    });

    // 复制字段模式生成的正则
    const btnCopyFp = document.getElementById('btn-copy-fp-regex');
    if (btnCopyFp) {
      btnCopyFp.addEventListener('click', () => {
        const el = document.getElementById('fp-generated-regex');
        const regex = el ? (el.value || el.textContent) : '';
        if (regex) Utils.copyToClipboard(regex);
      });
    }

    // 括号模式切换
    const bracketCheckbox = document.getElementById('fp-bracket-mode');
    if (bracketCheckbox) {
      bracketCheckbox.addEventListener('change', () => {
        this.updateFieldPatternRegex();
        this.testCurrentRule();
      });
    }

    // 正则编辑/锁定按钮
    const btnEditFp = document.getElementById('btn-edit-fp-regex');
    const fpTextareaEl = document.getElementById('fp-generated-regex');
    if (btnEditFp && fpTextareaEl) {
      btnEditFp.addEventListener('click', () => {
        const isReadonly = fpTextareaEl.hasAttribute('readonly');
        if (isReadonly) {
          fpTextareaEl.removeAttribute('readonly');
          btnEditFp.textContent = '🔒';
          btnEditFp.title = '锁定正则';
        } else {
          fpTextareaEl.setAttribute('readonly', '');
          btnEditFp.textContent = '✏️';
          btnEditFp.title = '编辑正则';
          this.updateFieldPatternRegex();
        }
      });
      fpTextareaEl.addEventListener('input', Utils.debounce(() => {
        if (!fpTextareaEl.hasAttribute('readonly')) {
          this.testCurrentRule();
        }
      }, 300));
    }

    // Pattern 管理面板事件
    App.bindPatternManagerEvents();
  },

  // 显示向导
  async show(files) {
    this.files = files;
    this.currentSampleIdx = 0;
    this.currentMode = 'preset';
    this.smartTokens = [];
    this.smartAssignments = {};

    // 读取文件内容
    Utils.showLoading('正在读取文件...');
    try {
      const allLines = [];
      for (const file of files) {
        const text = await this.readFilePreview(file);
        const lines = text.split(/\r?\n/);
        allLines.push(...lines);
        if (allLines.length > 200) break; // 只读前200行用于向导
      }
      this.rawLines = allLines.filter(l => l.trim());
    } catch (err) {
      this.rawLines = [];
    }
    Utils.hideLoading();

    if (this.rawLines.length === 0) {
      Utils.showToast('文件为空或无法读取', 'error');
      return;
    }

    // 找最佳样本行（第一个非空且有足够内容的行）
    this.currentSampleIdx = this.findBestSample();

    // 显示文件信息
    const fileInfo = document.getElementById('wizard-file-info');
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    fileInfo.innerHTML = `
      ${files.map(f => `<div>📄 ${this.escapeHtml(f.name)} (${Utils.formatBytes(f.size)})</div>`).join('')}
      <div style="color:var(--text-muted);font-size:10px;margin-top:2px">
        共 ${Utils.formatNumber(this.rawLines.length)} 行 (预览前200行)
      </div>
    `;

    // 显示样本
    this.showSample();

    // 重置UI
    document.querySelectorAll('.wizard-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.wizard-tab[data-mode="preset"]').classList.add('active');
    document.querySelectorAll('.wizard-panel').forEach(p => p.style.display = 'none');
    document.getElementById('wizard-panel-preset').style.display = 'block';
    document.getElementById('wizard-preset-select').value = 'auto';
    document.getElementById('wizard-encoding').value = 'UTF-8';
    const customRegexEl = document.getElementById('wizard-custom-regex');
    if (customRegexEl) customRegexEl.value = '';
    document.getElementById('wizard-regex-date-format').value = '';
    const wizardDateFormatEl = document.getElementById('wizard-date-format');
    if (wizardDateFormatEl) wizardDateFormatEl.value = '';
    document.getElementById('wizard-test-fields').innerHTML = '';
    document.getElementById('wizard-test-stats').innerHTML = '';

    // 重置保存的预设pattern
    this.savedPresetPatterns = {};
    this.savedPresetDateFormats = {};

    // 初始化字段模式输入
    document.getElementById('fp-timestamp').value = '';
    document.getElementById('fp-level').value = '';
    document.getElementById('fp-pid').value = '';
    document.getElementById('fp-tid').value = '';
    document.getElementById('fp-tag').value = '';
    document.getElementById('fp-source').value = '';
    document.getElementById('fp-message').value = '';
    document.getElementById('fp-separator').value = '\\s+';
    // 重置预设下拉
    document.querySelectorAll('.fp-preset').forEach(s => s.value = '');
    // 重置括号模式
    const bracketCheckbox = document.getElementById('fp-bracket-mode');
    if (bracketCheckbox) bracketCheckbox.checked = false;
    const fpTextarea = document.getElementById('fp-generated-regex');
    if (fpTextarea) {
      fpTextarea.value = '选择范式或输入正则片段，自动生成完整正则';
      fpTextarea.setAttribute('readonly', '');
    }

    // 显示面板
    document.getElementById('parse-wizard').style.display = 'flex';
    Utils.showOverlay();

    // 初始化预设正则和自动测试
    this.updatePresetRegex();
    this.updateWizardActivePattern();
    setTimeout(() => this.testCurrentRule(), 100);
  },

  // 更新向导中当前 Pattern 信息显示
  updateWizardActivePattern() {
    const section = document.getElementById('wizard-active-pattern');
    const nameEl = document.getElementById('wap-name');
    const regexEl = document.getElementById('wap-regex-preview');
    if (!section || !nameEl || !regexEl) return;

    const regex = this.getCurrentRegex();
    if (regex) {
      section.style.display = 'block';
      const src = this.savedPresetPatterns['__loaded'] ? '从库加载' : (this.currentMode === 'smart' ? '智能识别' : (this.currentMode === 'regex' ? '手动正则' : '预设编辑'));
      nameEl.textContent = src;
      regexEl.textContent = regex.length > 80 ? regex.substring(0, 80) + '...' : regex;
    } else {
      section.style.display = 'none';
    }
  },

  hide() {
    document.getElementById('parse-wizard').style.display = 'none';
    Utils.hideOverlay();
    App.pendingFiles = null;
  },

  // 读取文件预览
  async readFilePreview(file) {
    // 检测 ZIP 文件
    if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      return this.readZipPreview(file);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      // 只读前 200KB
      const blob = file.slice(0, 200 * 1024);
      reader.readAsText(blob, 'UTF-8');
    });
  },

  // 读取 ZIP 文件预览
  async readZipPreview(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip 库未加载');
    }
    try {
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
      const zip = await JSZip.loadAsync(arrayBuffer);
      const allNames = Object.keys(zip.files);
      const textFiles = allNames.filter(name => {
        const entry = zip.files[name];
        if (entry.dir) return false;
        const lower = name.toLowerCase();
        return /\.(log|txt|json|xml|csv|out|err|trace|conf|cfg|properties|yml|yaml)$/.test(lower) ||
               !/\.(exe|dll|so|dylib|class|jar|war|ear|png|jpg|gif|bmp|ico|mp3|mp4|avi|pdf|doc|xls|ppt|zip|gz|tar|bz2|7z)$/.test(lower);
      });

      if (textFiles.length === 0) {
        throw new Error('ZIP 文件中未找到文本文件');
      }

      // 读取第一个文本文件的前 200KB 作为预览
      const firstFile = textFiles[0];
      const content = await zip.files[firstFile].async('string');
      const lines = content.split(/\r?\n/).slice(0, 200).join('\n');
      return `[ZIP 预览: ${firstFile}]\n${lines}`;
    } catch (e) {
      throw new Error('ZIP 预览失败: ' + e.message);
    }
  },

  // 找最佳样本行
  findBestSample() {
    // 优先找包含时间戳的行
    for (let i = 0; i < this.rawLines.length; i++) {
      if (Utils.detectFormat(this.rawLines[i])) return i;
    }
    // 其次找非空行
    for (let i = 0; i < this.rawLines.length; i++) {
      if (this.rawLines[i].trim().length > 20) return i;
    }
    return 0;
  },

  // 导航样本
  navSample(delta) {
    this.currentSampleIdx = Math.max(0, Math.min(this.currentSampleIdx + delta, this.rawLines.length - 1));
    this.showSample();
    if (this.currentMode === 'smart') this.runSmartAnalysis();
    this.testCurrentRule();
  },

  // 显示当前样本
  showSample() {
    const line = this.getCurrentSample();
    document.getElementById('wizard-sample-line').textContent = line || '(空行)';
    document.getElementById('wizard-sample-index').textContent =
      `第 ${this.currentSampleIdx + 1} / ${this.rawLines.length} 行`;
  },

  getCurrentSample() {
    return this.rawLines[this.currentSampleIdx] || '';
  },

  // 智能分析
  runSmartAnalysis() {
    const line = this.getCurrentSample();
    if (!line) return;

    const result = SmartRuleGenerator.analyze(line);
    this.smartTokens = result.tokens;
    this.smartAssignments = { ...result.assignments };

    // 渲染token
    const container = document.getElementById('wizard-token-list');
    const fieldColors = { timestamp: 'timestamp', level: 'level', pid: 'pid', tid: 'tid', tag: 'tag', source: 'source', message: 'message' };

    container.innerHTML = this.smartTokens.map((t, i) => {
      let fieldType = 'ignored';
      let tag = '';
      for (const [field, idx] of Object.entries(this.smartAssignments)) {
        if (idx === i) { fieldType = fieldColors[field] || 'ignored'; tag = field; break; }
      }
      return `<span class="token-chip ${fieldType}" data-idx="${i}" title="点击切换字段类型">
        ${tag ? `<span class="token-tag">${tag}</span>` : ''}${this.escapeHtml(t.text)}
      </span>`;
    }).join('');

    // 点击切换
    container.querySelectorAll('.token-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = parseInt(chip.dataset.idx);
        this.cycleSmartToken(idx);
      });
    });

    // 日期格式
    const wdf = document.getElementById('wizard-date-format');
    if (wdf) wdf.value = SmartRuleGenerator.generatedDateFormat || '';

    // 生成正则并测试
    SmartRuleGenerator.regenerateRegex();
    this.testCurrentRule();
  },

  // 循环切换智能token
  cycleSmartToken(tokenIdx) {
    const fieldCycle = ['timestamp', 'level', 'pid', 'tid', 'tag', 'source', 'message', null];
    const current = Object.entries(this.smartAssignments).find(([, idx]) => idx === tokenIdx);
    const currentField = current ? current[0] : null;
    const nextIdx = (fieldCycle.indexOf(currentField) + 1) % fieldCycle.length;
    const nextField = fieldCycle[nextIdx];

    if (nextField === null) {
      SmartRuleGenerator.unassignField(tokenIdx);
    } else {
      SmartRuleGenerator.assignField(tokenIdx, nextField);
    }
    this.smartAssignments = { ...SmartRuleGenerator.assignments };
    this.runSmartAnalysis(); // 重新渲染
  },

  // ===== 正则编辑器语法高亮 =====
  updateRegexHighlight() {
    try {
      const textarea = document.getElementById('wizard-custom-regex');
      const highlight = document.getElementById('regex-highlight-layer');
      const lineNumbers = document.getElementById('regex-line-numbers');
      if (!textarea || !highlight || !lineNumbers) return;
      const text = textarea.value || '';

      // 更新行号
      const lines = text.split('\n');
      lineNumbers.innerHTML = lines.map((_, i) => i + 1).join('<br>');

      // 语法高亮
      const escaped = this.escapeHtml(text);
      const highlighted = this.applyRegexHighlight(escaped);
      highlight.innerHTML = highlighted;

      // 同步滚动位置
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    } catch (e) {
      // 静默处理高亮错误，不影响其他功能
    }
  },

  // 正则语法高亮规则
  applyRegexHighlight(text) {
    // 使用 tokenizer 方式逐字符处理，避免复杂正则冲突
    const result = [];
    let i = 0;
    const len = text.length;

    while (i < len) {
      // 转义序列 \x
      if (text[i] === '\\' && i + 1 < len) {
        result.push('<span class="hl-escape">' + text[i] + text[i + 1] + '</span>');
        i += 2;
        continue;
      }

      // 命名捕获组 (?<name>
      if (text.startsWith('(?&lt;', i)) {
        const end = text.indexOf('&gt;', i);
        if (end !== -1) {
          result.push('<span class="hl-group">' + text.substring(i, end + 4) + '</span>');
          i = end + 4;
          continue;
        }
      }

      // 非捕获组/断言 (?:  (?=  (?!  (?<=  (?<!
      if (text.startsWith('(?:', i) || text.startsWith('(?=', i) || text.startsWith('(?!', i) ||
          text.startsWith('(?&lt;=', i) || text.startsWith('(?&lt;!', i)) {
        result.push('<span class="hl-group" style="opacity:0.6">' + text[i] + '</span>');
        i++;
        continue;
      }

      // 量词 {n} {n,m}
      if (text[i] === '{') {
        const close = text.indexOf('}', i);
        if (close !== -1 && /^\{\d+(?:,\d*)?\}$/.test(text.substring(i, close + 1))) {
          result.push('<span class="hl-quantifier">' + text.substring(i, close + 1) + '</span>');
          i = close + 1;
          continue;
        }
      }

      // 量词 * + ?
      if ('*+?'.includes(text[i]) && (i === 0 || text[i - 1] !== '\\')) {
        result.push('<span class="hl-quantifier">' + text[i] + '</span>');
        i++;
        continue;
      }

      // 字符类 [...]
      if (text[i] === '[') {
        const close = text.indexOf(']', i);
        if (close !== -1) {
          result.push('<span class="hl-class">' + text.substring(i, close + 1) + '</span>');
          i = close + 1;
          continue;
        }
      }

      // 锚点 ^ $
      if ((text[i] === '^' || text[i] === '$') && (i === 0 || text[i - 1] !== '\\')) {
        result.push('<span class="hl-anchor">' + text[i] + '</span>');
        i++;
        continue;
      }

      // 管道符 |
      if (text[i] === '|') {
        result.push('<span class="hl-anchor">|</span>');
        i++;
        continue;
      }

      // 括号
      if (text[i] === '(' || text[i] === ')') {
        result.push('<span class="hl-group">' + text[i] + '</span>');
        i++;
        continue;
      }

      // 普通字符
      result.push(text[i]);
      i++;
    }

    return result.join('');
  },

  // 更新正则状态栏
  updateRegexStatus() {
    try {
      const textarea = document.getElementById('wizard-custom-regex');
      if (!textarea) return;
      const text = textarea.value || '';

      // 字符数
      const charCount = document.getElementById('regex-char-count');
      if (charCount) charCount.textContent = text.length + ' 字符';

      // 捕获组数量
      const namedCount = (text.match(/\(\?<\w+>/g) || []).length;
      const plainCount = (text.match(/\((?![?])/g) || []).length - namedCount;
      const totalGroups = namedCount + plainCount;
      const groupBadge = document.getElementById('regex-group-count');
      if (groupBadge) {
        if (totalGroups > 0) {
          groupBadge.textContent = `${totalGroups} 组 (${namedCount} 命名)`;
          groupBadge.style.display = 'inline';
        } else {
          groupBadge.style.display = 'none';
        }
      }

      // 正则有效性
      const validity = document.getElementById('regex-validity');
      if (validity) {
        if (!text.trim()) {
          validity.textContent = '';
          validity.className = '';
        } else {
          try {
            new RegExp(text);
            validity.textContent = '✓ 有效';
            validity.className = 'valid';
          } catch (e) {
            validity.textContent = '✗ ' + (e.message || '').substring(0, 30);
            validity.className = 'invalid';
          }
        }
      }
    } catch (e) {
      // 静默处理
    }
  },

  // 分析正则中的捕获组，显示说明和列名映射
  analyzeRegexGroups() {
    try {
      if (this.currentMode !== 'regex') {
        const section = document.getElementById('regex-groups-section');
        if (section) section.style.display = 'none';
        return;
      }

      const textarea = document.getElementById('wizard-custom-regex');
      if (!textarea) return;
      const regexStr = textarea.value.trim();
      if (!regexStr) {
        const section = document.getElementById('regex-groups-section');
        if (section) section.style.display = 'none';
        return;
      }

      // 解析命名捕获组 (?<name>...) 和普通捕获组 (...)
      const namedGroups = [];
      const unnamedGroups = [];
      const namedRegex = /\(\?<(\w+)>/g;
      let m;
      while ((m = namedRegex.exec(regexStr)) !== null) {
        namedGroups.push({ name: m[1], pos: m.index });
      }

      // 找普通捕获组（排除非捕获组和命名组）
      // 不使用 lookbehind，改用逐字符扫描
      let plainIdx = 0;
      for (let i = 0; i < regexStr.length; i++) {
        if (regexStr[i] === '(') {
          // 跳过转义的 \(
          if (i > 0 && regexStr[i - 1] === '\\') continue;
          // 跳过非捕获组 (?: (?= (?! (?<= (?<!
          if (regexStr[i + 1] === '?') continue;
          // 检查是否已被命名组占用
          const isNamed = namedGroups.some(ng => ng.pos === i);
          if (!isNamed) {
            unnamedGroups.push({ index: plainIdx + 1, pos: i });
            plainIdx++;
          }
        }
      }

      // 尝试匹配样本行获取值
      let match;
      try {
        const regex = new RegExp(regexStr);
        const sample = this.getCurrentSample();
        match = sample.match(regex);
      } catch {}

      // 渲染捕获组列表
      const container = document.getElementById('regex-groups-list');
      if (!container) return;
      const allGroups = [];

      // 命名组
      namedGroups.forEach((ng, i) => {
        const value = match?.groups?.[ng.name] || '';
        allGroups.push({
          type: 'named',
          name: ng.name,
          index: i + 1,
          value: value,
          hint: this.suggestGroupHint(ng.name, value)
        });
      });

      // 未命名组
      unnamedGroups.forEach((ug, i) => {
        const value = match ? (match[ug.index] || '') : '';
        allGroups.push({
          type: 'unnamed',
          name: '',
          index: namedGroups.length + i + 1,
          value: value,
          hint: this.suggestGroupHint('', value)
        });
      });

      if (allGroups.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:4px">未检测到捕获组 — 使用 (?&lt;列名&gt;...) 语法定义命名捕获组</div>';
        const section = document.getElementById('regex-groups-section');
        if (section) section.style.display = 'block';
        return;
      }

      container.innerHTML = allGroups.map((g, i) => {
        if (g.type === 'named') {
          return `<div class="regex-group-row" data-group-idx="${i}">
            <span class="grp-index">#${g.index}</span>
            <input class="grp-name-input named" value="${this.escapeHtml(g.name)}" data-group-idx="${i}" placeholder="列名" title="修改列名" />
            <span class="grp-value" title="${this.escapeHtml(g.value)}">${this.escapeHtml(g.value.substring(0, 30)) || '(未匹配)'}</span>
            <span class="grp-hint">${g.hint}</span>
          </div>`;
        } else {
          return `<div class="regex-group-row" data-group-idx="${i}">
            <span class="grp-index">#${g.index}</span>
            <input class="grp-name-input" value="" data-group-idx="${i}" placeholder="输入列名..." title="为此捕获组命名" />
            <span class="grp-value" title="${this.escapeHtml(g.value)}">${this.escapeHtml(g.value.substring(0, 30)) || '(未匹配)'}</span>
            <span class="grp-unnamed">未命名 — 输入列名以提取</span>
          </div>`;
        }
      }).join('');

      const section = document.getElementById('regex-groups-section');
      if (section) section.style.display = 'block';

      // 绑定列名输入事件
      container.querySelectorAll('.grp-name-input').forEach(input => {
        input.addEventListener('input', Utils.debounce(() => {
          this.rebuildRegexWithCustomNames(allGroups);
        }, 300));
      });
    } catch (e) {
      // 静默处理
    }
  },

  // 根据自定义列名重建正则
  rebuildRegexWithCustomNames(allGroups) {
    const inputs = document.querySelectorAll('#regex-groups-list .grp-name-input');
    const customNames = [];
    inputs.forEach(inp => {
      customNames.push(inp.value.trim());
    });

    const regexEl = document.getElementById('wizard-custom-regex');
    if (!regexEl) return;
    let regexStr = regexEl.value.trim();
    if (!regexStr) return;

    // 先移除所有已有的命名组标记，变成普通捕获组
    // 策略：把 (?<name> 替换为 ( ，然后根据自定义名称重建
    let cleaned = regexStr.replace(/\(\?<\w+>/g, '(');

    // 现在 cleaned 中所有 ( 都是普通捕获组（除了 (?: 等）
    // 我们需要把第 N 个普通捕获组替换为命名捕获组
    // 这比较复杂，简化处理：如果用户修改了列名，直接替换原正则中的命名组名称

    // 更简单的方案：只替换命名组的名称
    let namedIdx = 0;
    let result = regexStr.replace(/\(\?<(\w+)>/g, (fullMatch, oldName) => {
      const newName = customNames[namedIdx] || oldName;
      namedIdx++;
      return `(?<${newName}>`;
    });

    // 处理未命名组：如果用户给未命名组输入了名称，需要把对应的 ( 替换为 (?<name>
    // 这需要精确匹配位置，比较复杂。采用替代方案：在正则末尾追加说明
    if (result !== regexStr) {
      const regexEl2 = document.getElementById('wizard-custom-regex');
      if (regexEl2) regexEl2.value = result;
      // 触发重新分析
      setTimeout(() => {
        this.analyzeRegexGroups();
        this.testCurrentRule();
      }, 50);
    }
  },

  // 根据组名/值给出提示
  suggestGroupHint(name, value) {
    const nameLower = (name || '').toLowerCase();
    const valueStr = (value || '').toLowerCase();

    if (nameLower.includes('time') || nameLower.includes('date') || nameLower.includes('ts')) return '🕐 时间戳';
    if (nameLower.includes('level') || nameLower.includes('severity') || nameLower.includes('lvl')) return '📊 日志级别';
    if (nameLower.includes('tid') || nameLower.includes('threadid')) return '🔢 线程ID';
    if (nameLower.includes('source') || nameLower.includes('logger') || nameLower.includes('class')) return '📦 来源';
    if (nameLower.includes('message') || nameLower.includes('msg') || nameLower.includes('body')) return '💬 消息';
    if (nameLower.includes('host') || nameLower.includes('ip') || nameLower.includes('addr')) return '🖥️ 主机';
    if (nameLower.includes('pid') || nameLower.includes('process')) return '🔢 进程ID';
    if (nameLower.includes('tag') || nameLower.includes('label') || nameLower.includes('category')) return '🏷️ 标签';
    if (nameLower.includes('status') || nameLower.includes('code')) return '📌 状态码';
    if (nameLower.includes('method') || nameLower.includes('verb')) return '📡 HTTP方法';
    if (nameLower.includes('url') || nameLower.includes('path') || nameLower.includes('uri')) return '🔗 URL路径';
    if (nameLower.includes('duration') || nameLower.includes('elapsed') || nameLower.includes('took')) return '⏱️ 耗时';

    // 根据值猜测
    if (/^\d{4}-\d{2}-\d{2}/.test(valueStr)) return '🕐 时间戳';
    if (/^(FATAL|ERROR|WARN|INFO|DEBUG|TRACE)$/i.test(valueStr)) return '📊 日志级别';
    if (/^[\w.]+$/.test(valueStr) && valueStr.includes('.')) return '📦 类名';
    if (/^\d+$/.test(valueStr)) return '🔢 数字';

    return '';
  },

  // 获取当前规则的正则
  getCurrentRegex() {
    if (this.currentMode === 'smart') {
      return SmartRuleGenerator.generatedRegex || '';
    }
    if (this.currentMode === 'regex') {
      // 检查用户是否手动编辑了生成的正则
      const fpTextarea = document.getElementById('fp-generated-regex');
      if (fpTextarea && !fpTextarea.hasAttribute('readonly') && fpTextarea.value.trim()) {
        return fpTextarea.value.trim();
      }
      // 优先使用字段模式生成的正则
      const fpRegex = this.getFieldPatternRegex();
      if (fpRegex) return fpRegex;
      const customEl = document.getElementById('wizard-custom-regex');
      return customEl ? customEl.value.trim() : '';
    }
    // preset 模式
    const preset = document.getElementById('wizard-preset-select').value;
    // 检查从 Pattern 管理器加载的自定义正则
    if (this.savedPresetPatterns['__loaded']) return this.savedPresetPatterns['__loaded'];
    if (preset === 'auto' || preset === 'json') return null;
    // 优先使用用户手动编辑的pattern
    const savedRegex = this.savedPresetPatterns[preset];
    if (savedRegex) return savedRegex;
    const presetRegexEl = document.getElementById('wizard-preset-regex');
    if (presetRegexEl && presetRegexEl.value.trim()) return presetRegexEl.value.trim();
    const p = LogParser.presets[preset];
    return p ? p.regex.source : null;
  },

  // 从字段模式输入生成正则表达式
  getFieldPatternRegex() {
    const ts = document.getElementById('fp-timestamp')?.value.trim();
    const lv = document.getElementById('fp-level')?.value.trim();
    const pid = document.getElementById('fp-pid')?.value.trim();
    const tid = document.getElementById('fp-tid')?.value.trim();
    const tag = document.getElementById('fp-tag')?.value.trim();
    const src = document.getElementById('fp-source')?.value.trim();
    const msg = document.getElementById('fp-message')?.value.trim();
    const sep = document.getElementById('fp-separator')?.value.trim();
    const bracketMode = document.getElementById('fp-bracket-mode')?.checked || false;

    const wrap = (pattern) => {
      if (!bracketMode) return { prefix: '', pattern, suffix: '' };
      if (pattern.startsWith('\\[') && pattern.endsWith('\\]')) {
        return { prefix: '\\[', pattern: pattern.slice(2, -2), suffix: '\\]' };
      }
      return { prefix: '\\[', pattern, suffix: '\\]' };
    };

    const parts = [];
    const addPart = (name, pattern) => {
      if (!pattern) return;
      const w = wrap(pattern);
      parts.push(`${w.prefix}(?<${name}>${w.pattern})${w.suffix}`);
    };
    addPart('timestamp', ts);
    addPart('level', lv);
    addPart('pid', pid);
    addPart('tid', tid);
    addPart('tag', tag);
    addPart('source', src);
    if (msg) parts.push('(?<message>.*)');

    if (parts.length === 0) return null;

    // 根据括号模式选择分隔符：bracketMode 时连续括号字段间无分隔符
    const separator = sep || '';
    let regexStr = '^';
    for (let j = 0; j < parts.length; j++) {
      regexStr += parts[j];
      if (j < parts.length - 1) {
        if (bracketMode) {
          regexStr += '';
        } else {
          regexStr += separator;
        }
      }
    }
    return regexStr;
  },

  // 更新字段模式生成的正则预览
  // 更新预设面板的正则预览
  updatePresetRegex() {
    const textarea = document.getElementById('wizard-preset-regex');
    const dateFmtEl = document.getElementById('wizard-preset-date-format');
    const preset = document.getElementById('wizard-preset-select').value;
    if (!textarea) return;

    if (preset === 'auto' || preset === 'json') {
      // 如果有从 Pattern Manager 加载的自定义正则，保持它
      if (this.savedPresetPatterns['__loaded']) {
        textarea.value = this.savedPresetPatterns['__loaded'];
        if (dateFmtEl) dateFmtEl.value = this.savedPresetDateFormats['__loaded'] || '';
      } else {
        textarea.value = '';
        textarea.placeholder = preset === 'auto' ? '自动检测 — 将自动选择最佳匹配格式' : 'JSON 格式 — 自动解析';
        if (dateFmtEl) dateFmtEl.value = '';
      }
      return;
    }

    // 优先使用用户手动修改保存的pattern
    if (this.savedPresetPatterns[preset]) {
      textarea.value = this.savedPresetPatterns[preset];
    } else {
      const p = LogParser.presets[preset];
      textarea.value = p ? (p.regex.source || '') : '';
    }

    // 日期格式
    if (dateFmtEl) {
      if (this.savedPresetDateFormats && this.savedPresetDateFormats[preset]) {
        dateFmtEl.value = this.savedPresetDateFormats[preset];
      } else {
        const p = LogParser.presets[preset];
        dateFmtEl.value = p ? (p.dateFormat || '') : '';
      }
    }
  },

  updateFieldPatternRegex() {
    const textarea = document.getElementById('fp-generated-regex');
    if (!textarea) return;
    if (!textarea.hasAttribute('readonly')) return;
    const regex = this.getFieldPatternRegex();
    textarea.value = regex || '';
    textarea.placeholder = '选择范式或输入正则片段';
  },

  // 获取当前日期格式
  getCurrentDateFormat() {
    if (this.currentMode === 'smart') {
      const wdf = document.getElementById('wizard-date-format');
      return (wdf ? wdf.value : '') || SmartRuleGenerator.generatedDateFormat || '';
    }
    if (this.currentMode === 'regex') {
      const el = document.getElementById('wizard-regex-date-format');
      return el ? el.value.trim() : '';
    }
    const preset = document.getElementById('wizard-preset-select').value;
    if (this.savedPresetDateFormats['__loaded']) return this.savedPresetDateFormats['__loaded'];
    const presetDateFmtEl = document.getElementById('wizard-preset-date-format');
    if (presetDateFmtEl && presetDateFmtEl.value.trim()) return presetDateFmtEl.value.trim();
    const p = LogParser.presets[preset];
    return p ? p.dateFormat : '';
  },

  // 测试当前规则
  testCurrentRule() {
    try {
      const sample = this.getCurrentSample();
      const container = document.getElementById('wizard-test-fields');
      const statsEl = document.getElementById('wizard-test-stats');
      if (!container || !statsEl) return;

      if (!sample) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:11px">无样本行</div>';
        statsEl.innerHTML = '';
        return;
      }

      if (this.currentMode === 'preset') {
        const preset = document.getElementById('wizard-preset-select').value;
        if (preset === 'auto') {
          // 自动检测：展示检测到的格式及其匹配结果
          const detectedFormat = LogParser.autoDetect(this.rawLines || []);
          const formatNames = { log4j: 'Log4j / Logback', bracketLog: 'Bracket Log', apache: 'Apache / Nginx', syslog: 'Syslog', json: 'JSON', generic: '通用时间戳', plain: '纯文本' };
          const fmtName = formatNames[detectedFormat] || detectedFormat;

          // 用检测到的格式尝试匹配
          if (detectedFormat !== 'json' && detectedFormat !== 'plain') {
            const p = LogParser.presets[detectedFormat];
            if (p && p.regex) {
              try {
                const m = sample.match(p.regex);
                const groups = this._matchToGroups(m, p.groups);
                if (groups) {
                  container.innerHTML = Object.entries(groups).map(([k, v]) =>
                    `<div class="wizard-test-field"><span class="wtf-label">${this.escapeHtml(k)}</span><span class="wtf-value">${this.escapeHtml((v || '').substring(0, 120)) || '<span class="empty">(空)</span>'}</span></div>`
                  ).join('');
                  const samples = this.rawLines.slice(0, 20);
                  let mc = 0;
                  for (const line of samples) { if (p.regex.test(line)) mc++; }
                  const pct = ((mc / samples.length) * 100).toFixed(0);
                  statsEl.innerHTML = `<span class="match-ok">🤖 检测到: ${fmtName} | 📊 前20行匹配: ${mc}/${samples.length} (${pct}%)</span>`;
                  return;
                }
              } catch {}
            }
            // regex存在但未匹配成功——显示匹配统计数据
            const samples = this.rawLines.slice(0, 20);
            let mc = 0;
            for (const line of samples) { if (p.regex.test(line)) mc++; }
            const pct = ((mc / samples.length) * 100).toFixed(0);
            const cls = mc > 0 ? (pct > 50 ? 'match-ok' : 'match-partial') : 'match-fail';
            statsEl.innerHTML = `<span class="${cls}">📊 前20行匹配: ${mc}/${samples.length} (${pct}%)</span>`;
          }
          container.innerHTML = `<div style="color:var(--text-muted);font-size:11px">🤖 检测到格式: ${fmtName} — 将自动匹配解析</div>`;
          return;
        }
        if (preset === 'json') {
          try {
            const obj = JSON.parse(sample);
            container.innerHTML = Object.entries(obj).slice(0, 8).map(([k, v]) =>
              `<div class="wizard-test-field"><span class="wtf-label">${this.escapeHtml(k)}</span><span class="wtf-value">${this.escapeHtml(String(v).substring(0, 100))}</span></div>`
            ).join('');
            statsEl.innerHTML = '<span class="match-ok">✅ JSON 解析成功</span>';
          } catch {
            container.innerHTML = '<div style="color:var(--error);font-size:11px">❌ 不是有效的 JSON</div>';
            statsEl.innerHTML = '<span class="match-fail">JSON 解析失败</span>';
          }
          return;
        }

        // 其他预设格式：直接用 presets 对象的 RegExp + groups，不通过 textarea
        const p = LogParser.presets[preset];
        if (p && p.regex) {
          try {
            const m = sample.match(p.regex);
            const g = this._matchToGroups(m, p.groups);
            if (g) {
              container.innerHTML = Object.entries(g).map(([k, v]) =>
                `<div class="wizard-test-field"><span class="wtf-label">${this.escapeHtml(k)}</span><span class="wtf-value">${this.escapeHtml((v || '').substring(0, 120)) || '<span class="empty">(空)</span>'}</span></div>`
              ).join('');
              const samples = this.rawLines.slice(0, 20);
              let mc = 0;
              for (const line of samples) { if (p.regex.test(line)) mc++; }
              const pct = ((mc / samples.length) * 100).toFixed(0);
              statsEl.innerHTML = `<span class="${pct > 50 ? 'match-ok' : 'match-fail'}">📋 ${p.name} | 📊 前20行匹配: ${mc}/${samples.length} (${pct}%)</span>`;
              return;
            }
          } catch {}
        }
        // 预设 regex 不匹配——显示前20行统计 (可能是 auto 或 generic fallthrough)
        if (p && p.regex) {
          const samples = this.rawLines.slice(0, 20);
          let mc = 0;
          for (const line of samples) { if (p.regex.test(line)) mc++; }
          const pct = ((mc / samples.length) * 100).toFixed(0);
          const cls = mc > 0 ? (pct > 50 ? 'match-ok' : 'match-partial') : 'match-fail';
          statsEl.innerHTML = `<span class="${cls}">⏭️ ${p.name}: ${mc}/${samples.length} 行匹配</span>`;
        }
        container.innerHTML = '<div style="color:var(--text-muted);font-size:11px">⚠️ 样本行不匹配 — 尝试切换样本行或格式</div>';
        return;
      }

      // 通用正则匹配测试 (smart / regex 模式)
      const regexStr = this.getCurrentRegex();
      if (!regexStr) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:11px">无正则表达式</div>';
        statsEl.innerHTML = '';
        return;
      }

      let regex;
      try {
        regex = new RegExp(regexStr);
      } catch (e) {
        container.innerHTML = `<div style="color:var(--error);font-size:11px">❌ 正则无效: ${this.escapeHtml(e.message)}</div>`;
        statsEl.innerHTML = '<span class="match-fail">正则表达式语法错误</span>';
        return;
      }

      const match = sample.match(regex);
      const groups = this._matchToGroups(match, this._getCurrentGroups());
      if (groups) {
        const colMap = this.extractColumnMap();
        container.innerHTML = Object.entries(groups).map(([k, v]) => {
          const displayName = colMap[k] || k;
          return `<div class="wizard-test-field"><span class="wtf-label">${this.escapeHtml(displayName)}</span><span class="wtf-value">${this.escapeHtml((v || '').substring(0, 120)) || '<span class="empty">(空)</span>'}</span></div>`;
        }).join('');

        const samples = this.rawLines.slice(0, 20);
        let matchCount = 0;
        for (const line of samples) {
          if (regex.test(line)) matchCount++;
        }
        const pct = ((matchCount / samples.length) * 100).toFixed(0);
        statsEl.innerHTML = `<span class="${pct > 50 ? 'match-ok' : 'match-fail'}">📊 前20行匹配: ${matchCount}/${samples.length} (${pct}%)</span>`;
      } else {
        const partialInfo = this.getPartialMatchInfo(regexStr, sample);
        if (partialInfo && partialInfo.matched.length > 0) {
          const matchedHtml = partialInfo.matched.map(({ name, value }) =>
            `<div class="wizard-test-field"><span class="wtf-label">${this.escapeHtml(name)}</span><span class="wtf-value">${this.escapeHtml((value || '').substring(0, 120)) || '<span class="empty">(空)</span>'}</span></div>`
          ).join('');
          const unmatchedHtml = partialInfo.unmatched.length > 0
            ? `<div style="color:var(--warning);font-size:10px;margin-top:4px">⚠️ 未匹配字段: ${partialInfo.unmatched.map(n => this.escapeHtml(n)).join(', ')}</div>`
            : '';
          container.innerHTML = matchedHtml + unmatchedHtml;
          statsEl.innerHTML = `<span class="match-partial">⚠️ 部分匹配: ${partialInfo.matched.length}/${partialInfo.matched.length + partialInfo.unmatched.length} 个字段</span>`;
        } else {
          container.innerHTML = '<div style="color:var(--error);font-size:11px">❌ 当前样本行不匹配</div>';
          statsEl.innerHTML = '<span class="match-fail">匹配失败 — 请调整规则或切换样本行</span>';
        }
      }
    } catch (e) {
      // 静默处理
    }
    this.updateWizardActivePattern();
  },

  _matchToGroups(match, groupsMap) {
    if (!match) return null;
    if (match.groups) return match.groups;
    if (!groupsMap) return null;
    const result = {};
    for (const [name, idx] of Object.entries(groupsMap)) {
      if (match[idx] !== undefined) result[name] = match[idx];
    }
    return Object.keys(result).length > 0 ? result : null;
  },

  _getCurrentGroups() {
    if (this.currentMode === 'preset') {
      const preset = document.getElementById('wizard-preset-select').value;
      if (preset !== 'auto' && preset !== 'json') {
        const p = LogParser.presets[preset];
        return p ? p.groups : null;
      }
    }
    return null;
  },

  // 获取部分匹配信息：从正则中提取各命名组模式，从上一字段匹配结果之后继续匹配
  getPartialMatchInfo(regexStr, sample) {
    try {
      // 提取所有命名组及其模式（含外层修饰符如 \[...\]）
      const groupSegments = [];
      const remaining = regexStr.replace(/^\^/, '');
      const groupRegex = /\(\?<(\w+)>((?:[^()]|\((?:(?!\?[<:])[^()]*)\))*)\)[)\]]*/g;

      // 重新构建：按出现顺序提取每个命名组的前缀+组+后缀片段
      let combinedRegex;
      try {
        combinedRegex = new RegExp(regexStr);
      } catch {
        return null;
      }

      // 直接用完整正则分段测试：从上一次匹配结束位置继续
      // 策略：尝试用完整正则匹配，如果失败，则逐个提取组模式并在剩余文本上测试
      const fullMatch = sample.match(combinedRegex);
      if (!fullMatch || !fullMatch.groups) {
        // 完整匹配失败，尝试从正则中提取每组，顺序匹配
        return this._sequentialPartialMatch(regexStr, sample);
      }

      // 完整匹配成功，直接返回
      return { matched: [], unmatched: [], fullMatched: true };
    } catch {
      return null;
    }
  },

  // 顺序部分匹配：从上一次匹配结果之后继续匹配下一个字段
  _sequentialPartialMatch(regexStr, sample) {
    try {
      // 提取命名组及其模式
      const segments = [];
      const groupRegex = /\(\?<(\w+)>((?:[^()]|\((?:(?!\?[<:])[^()]*)\))*)\)/g;
      let m;
      while ((m = groupRegex.exec(regexStr)) !== null) {
        segments.push({ name: m[1], innerPattern: m[2], rawMatch: m[0], pos: m.index });
      }

      if (segments.length === 0) return null;

      // 先尝试用完整匹配
      try {
        const fullRegex = new RegExp(regexStr);
        const fm = sample.match(fullRegex);
        if (fm && fm.groups) {
          const matched = Object.entries(fm.groups).map(([k, v]) => ({ name: k, value: v || '' }));
          return { matched, unmatched: [], fullMatched: true };
        }
      } catch {}

      // 完整匹配失败：逐步增加捕获组，从前缀开始依次匹配
      // 思路：每个命名组的前缀包含之前所有组的完整匹配+分隔符
      const matched = [];
      const unmatched = [];

      // 将正则按组拆成前缀+组，然后逐步累积
      const allParts = [];
      let lastEnd = 0;
      for (const seg of segments) {
        const prefix = regexStr.substring(lastEnd, seg.pos);
        allParts.push({ prefix, groupName: seg.name, innerPattern: seg.innerPattern });
        lastEnd = seg.pos + seg.rawMatch.length;
      }

      // 逐步匹配：先试前1个组，再试前2个组，...
      for (let tryCount = 1; tryCount <= segments.length; tryCount++) {
        let partialRegexStr = '';
        for (let j = 0; j < tryCount; j++) {
          partialRegexStr += allParts[j].prefix + '(?<' + allParts[j].groupName + '>' + allParts[j].innerPattern + ')';
        }
        // 确保开头有 ^ 锚定
        if (!partialRegexStr.startsWith('^')) {
          partialRegexStr = '^' + partialRegexStr;
        }
        try {
          const partialRegex = new RegExp(partialRegexStr);
          const pm = sample.match(partialRegex);
          if (pm && pm.groups) {
            for (let j = 0; j < tryCount; j++) {
              const name = allParts[j].groupName;
              if (!matched.find(x => x.name === name)) {
                matched.push({ name, value: pm.groups[name] || '' });
              }
            }
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      // 剩余未匹配的
      for (const seg of segments) {
        if (!matched.find(x => x.name === seg.name)) {
          unmatched.push(seg.name);
        }
      }

      return { matched, unmatched, fullMatched: unmatched.length === 0 };
    } catch {
      return null;
    }
  },

  // 应用规则并解析
  async applyAndParse() {
    const preset = document.getElementById('wizard-preset-select').value;
    const encoding = document.getElementById('wizard-encoding').value;
    let config = { encoding };

    if (this.currentMode === 'smart') {
      config.preset = 'custom';
      config.customRegex = SmartRuleGenerator.generatedRegex;
      const wdf = document.getElementById('wizard-date-format');
      config.customDateFormat = (wdf ? wdf.value : '') || SmartRuleGenerator.generatedDateFormat;
    } else if (this.currentMode === 'regex') {
      config.preset = 'custom';
      // 检查用户是否手动编辑了生成的正则
      const fpTextarea = document.getElementById('fp-generated-regex');
      if (fpTextarea && !fpTextarea.hasAttribute('readonly') && fpTextarea.value.trim()) {
        config.customRegex = fpTextarea.value.trim();
      } else {
        const fpRegex = this.getFieldPatternRegex();
        config.customRegex = fpRegex || '';
      }
      config.customDateFormat = document.getElementById('wizard-regex-date-format').value.trim();
      // 提取自定义列名映射
      config.columnMap = this.extractColumnMap();
    } else {
      // preset 模式
      const hasLoadedPattern = !!this.savedPresetPatterns['__loaded'];
      const hasUserEdit = (preset !== 'auto' && preset !== 'json') && !!this.savedPresetPatterns[preset];

      if (hasLoadedPattern) {
        // 从 Pattern 管理器加载的自定义正则
        config.preset = 'custom';
        config.customRegex = this.savedPresetPatterns['__loaded'];
        config.customDateFormat = this.getCurrentDateFormat();
      } else if (hasUserEdit) {
        // 用户在预设面板上手动编辑了正则
        config.preset = 'custom';
        config.customRegex = this.savedPresetPatterns[preset];
        config.customDateFormat = this.getCurrentDateFormat();
      } else {
        // 纯预设选择（未编辑），直接传 preset 名让 parser 处理
        config.preset = preset;
      }
    }

    this.hide();
    Utils.showLoading('正在解析日志文件...');

    try {
      if (this.files.length === 1) {
        await LogParser.parseFile(this.files[0], config);
      } else {
        await LogParser.mergeFiles(this.files, config);
      }
      // 如果使用的是自定义正则，弹出保存确认面板
      if (config.preset === 'custom' && config.customRegex) {
        App.pendingSaveConfig = {
          customRegex: config.customRegex,
          customDateFormat: config.customDateFormat || '',
          encoding: config.encoding || 'UTF-8'
        };
      }
      App.onDataLoaded();
      // 延迟弹出保存面板
      if (App.pendingSaveConfig) {
        setTimeout(() => App.showSavePanel(), 300);
      }
    } catch (err) {
      Utils.showToast('文件解析失败: ' + err.message, 'error');
    }
    Utils.hideLoading();
  },

  // 提取自定义列名映射 { groupName: displayName }
  extractColumnMap() {
    const map = {};
    const rows = document.querySelectorAll('#regex-groups-list .regex-group-row');
    rows.forEach(row => {
      const input = row.querySelector('.grp-name-input');
      const grpIndex = row.querySelector('.grp-index');
      if (input && grpIndex) {
        const name = input.value.trim();
        const idx = grpIndex.textContent.replace('#', '');
        if (name) {
          map[idx] = name;
        }
      }
    });
    return map;
  },

  // 跳过向导，自动检测
  async skipAndParse() {
    const encoding = document.getElementById('wizard-encoding').value;
    this.hide();
    Utils.showLoading('正在解析日志文件...');

    try {
      if (this.files.length === 1) {
        await LogParser.parseFile(this.files[0], { preset: 'auto', encoding });
      } else {
        await LogParser.mergeFiles(this.files, { preset: 'auto', encoding });
      }
      App.onDataLoaded();
    } catch (err) {
      Utils.showToast('文件解析失败: ' + err.message, 'error');
    }
    Utils.hideLoading();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
