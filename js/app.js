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

  // 初始化
  init() {
    LogGrid.init();
    Timeline.init();
    this.bindToolbar();
    this.bindFilterBar();
    this.bindDetailPanel();
    this.bindPopups();
    this.bindDragDrop();
    this.bindKeyboardShortcuts();
    this.bindParserConfig();
    ParseWizard.init();
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

    document.getElementById('btn-close-files').addEventListener('click', () => {
      document.getElementById('files-panel').classList.remove('expanded');
    });

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
    }, 200));

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
      btn.addEventListener('click', () => {
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

      LogParser.config = { preset, customRegex, customDateFormat, encoding };
      document.getElementById('parser-config-panel').style.display = 'none';
      Utils.hideOverlay();

      if (LogParser.fileInfo) {
        this.reloadFile();
      }
    });

    // ===== 智能规则生成器事件 =====
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
        encoding: document.getElementById('parser-encoding').value
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
      timestamp: 'timestamp', level: 'level', thread: 'thread',
      source: 'source', message: 'message'
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
    const fieldCycle = ['timestamp', 'level', 'thread', 'source', 'message', null]; // null = 取消分配
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
    const fields = ['timestamp', 'level', 'thread', 'source', 'message'];
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
    // 弹出解析向导
    this.pendingFiles = Array.from(files);
    ParseWizard.show(this.pendingFiles);
  },

  async mergeFiles(files) {
    Utils.showLoading('正在合并日志文件...');
    try {
      await LogParser.mergeFiles(Array.from(files));
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
    Utils.showLoading('正在重新加载...');
    try {
      // 重新解析需要重新选择文件
      document.getElementById('file-input').click();
    } catch (err) {
      Utils.showToast('重新加载失败: ' + err.message, 'error');
    }
    Utils.hideLoading();
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
  toggleTail() {
    const btn = document.getElementById('btn-tail');
    if (this.tailTimer) {
      clearInterval(this.tailTimer);
      this.tailTimer = null;
      this.tailFile = null;
      btn.textContent = '▶️ 实时追踪';
      btn.style.color = '';
      Utils.showToast('已停止实时追踪');
    } else {
      if (!LogParser.fileInfo) {
        Utils.showToast('请先打开文件', 'error');
        return;
      }
      btn.textContent = '⏸️ 停止追踪';
      btn.style.color = 'var(--success)';
      Utils.showToast('实时追踪已启动（模拟模式 - 浏览器限制）', 'success');
      // 浏览器中无法真正tail文件，这里做模拟
      this.tailTimer = setInterval(() => {
        // 在实际场景中，这里会轮询文件变化
        document.getElementById('status-text').textContent = '实时追踪中...';
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
    const panel = document.getElementById('parser-config-panel');
    const preset = LogParser.config.preset;
    document.getElementById('parser-preset').value = preset;
    document.getElementById('custom-regex').value = LogParser.config.customRegex || '';
    document.getElementById('custom-date-format').value = LogParser.config.customDateFormat || '';
    document.getElementById('parser-encoding').value = LogParser.config.encoding;
    document.getElementById('custom-regex-section').style.display = preset === 'custom' ? 'block' : 'none';
    document.getElementById('smart-rule-section').style.display = preset === 'smart' ? 'block' : 'none';
    panel.style.display = 'flex';
    Utils.showOverlay();
  },

  // ===== 详情面板 =====
  showDetail(entry) {
    if (!entry) return;
    const panel = document.getElementById('detail-panel');
    panel.classList.add('expanded');

    document.getElementById('detail-timestamp').textContent = entry.timestamp || '-';
    document.getElementById('detail-level').textContent = entry.level || '-';
    document.getElementById('detail-level').className = `level-${entry.level}`;
    document.getElementById('detail-thread').textContent = entry.thread || '-';
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
  toggleFilesPanel() {
    const panel = document.getElementById('files-panel');
    panel.classList.toggle('expanded');
    if (panel.classList.contains('expanded')) {
      this.renderFilesList();
    }
  },

  renderFilesList() {
    const container = document.getElementById('files-list');
    const sourceFiles = LogParser.sourceFiles || [];

    if (sourceFiles.length === 0) {
      container.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px">暂无文件</div>';
      return;
    }

    // 统计每个来源文件的条目数
    const fileStats = {};
    for (const entry of LogParser.entries) {
      const src = entry.sourceFile || 'unknown';
      fileStats[src] = (fileStats[src] || 0) + 1;
    }

    // 去重并排序
    const uniqueFiles = [];
    const seen = new Set();
    for (const sf of sourceFiles) {
      if (!seen.has(sf.name)) {
        seen.add(sf.name);
        uniqueFiles.push(sf);
      }
    }

    container.innerHTML = uniqueFiles.map((sf, i) => {
      const count = fileStats[sf.name] || 0;
      const isZip = sf.name.toLowerCase().endsWith('.zip');
      const icon = isZip ? '📦' : '📄';
      const badge = isZip ? '<span class="file-badge">ZIP</span>' : '';
      return `<div class="file-item" data-file="${this.escapeHtml(sf.name)}" title="${this.escapeHtml(sf.name)}">
        <span class="file-icon">${icon}</span>
        <span class="file-name">${this.escapeHtml(sf.name)}</span>
        ${badge}
        <span class="file-count">${Utils.formatNumber(count)}</span>
      </div>`;
    }).join('');

    // 点击文件项：过滤该文件的日志
    container.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', () => {
        const fileName = item.dataset.file;
        // 切换选中状态
        const wasActive = item.classList.contains('active');
        container.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
        if (!wasActive) {
          item.classList.add('active');
          // 过滤该文件的日志
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
          // 预填一个基于样本的正则提示
          const sample = this.getCurrentSample();
          if (sample && !document.getElementById('wizard-custom-regex').value) {
            // 不自动填充，让用户自己写
          }
        }
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

    // 预设选择变化时自动测试
    document.getElementById('wizard-preset-select').addEventListener('change', () => this.testCurrentRule());

    // 手动正则输入时实时测试 + 语法高亮
    const regexInput = document.getElementById('wizard-custom-regex');
    regexInput.addEventListener('input', Utils.debounce(() => {
      this.updateRegexHighlight();
      this.updateRegexStatus();
      this.analyzeRegexGroups();
      this.testCurrentRule();
    }, 200));

    // 同步滚动
    regexInput.addEventListener('scroll', () => {
      const highlight = document.getElementById('regex-highlight-layer');
      highlight.scrollTop = regexInput.scrollTop;
      highlight.scrollLeft = regexInput.scrollLeft;
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

    // 快捷插入按钮
    document.querySelectorAll('.quick-insert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const insert = btn.dataset.insert;
        const start = regexInput.selectionStart;
        const end = regexInput.selectionEnd;
        const before = regexInput.value.substring(0, start);
        const after = regexInput.value.substring(end);
        // 智能添加分隔符
        const needSep = before.length > 0 && !before.endsWith('\\') && !before.endsWith(' ');
        const sep = needSep ? '\\s+' : '';
        regexInput.value = before + sep + insert + after;
        regexInput.focus();
        regexInput.selectionStart = regexInput.selectionEnd = start + sep.length + insert.length;
        regexInput.dispatchEvent(new Event('input'));
      });
    });

    // 智能模式：日期格式
    document.getElementById('wizard-date-format').addEventListener('input', Utils.debounce(() => {
      SmartRuleGenerator.generatedDateFormat = document.getElementById('wizard-date-format').value;
      this.testCurrentRule();
    }, 300));

    // 正则提示展开/收起
    document.getElementById('btn-toggle-regex-hint').addEventListener('click', () => {
      const body = document.getElementById('regex-hint-body');
      const btn = document.getElementById('btn-toggle-regex-hint');
      if (body.classList.contains('collapsed')) {
        body.classList.remove('collapsed');
        btn.textContent = '收起';
      } else {
        body.classList.add('collapsed');
        btn.textContent = '展开';
      }
    });
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
    document.getElementById('wizard-custom-regex').value = '';
    document.getElementById('wizard-regex-date-format').value = '';
    document.getElementById('wizard-date-format').value = '';
    document.getElementById('wizard-test-fields').innerHTML = '';
    document.getElementById('wizard-test-stats').innerHTML = '';

    // 显示面板
    document.getElementById('parse-wizard').style.display = 'flex';
    Utils.showOverlay();

    // 自动测试默认规则
    setTimeout(() => this.testCurrentRule(), 100);
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
    const fieldColors = { timestamp: 'timestamp', level: 'level', thread: 'thread', source: 'source', message: 'message' };

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
    document.getElementById('wizard-date-format').value = SmartRuleGenerator.generatedDateFormat || '';

    // 生成正则并测试
    SmartRuleGenerator.regenerateRegex();
    this.testCurrentRule();
  },

  // 循环切换智能token
  cycleSmartToken(tokenIdx) {
    const fieldCycle = ['timestamp', 'level', 'thread', 'source', 'message', null];
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

    let regexStr = document.getElementById('wizard-custom-regex').value.trim();
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
      document.getElementById('wizard-custom-regex').value = result;
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
    if (nameLower.includes('thread') || nameLower.includes('tid')) return '🧵 线程';
    if (nameLower.includes('source') || nameLower.includes('logger') || nameLower.includes('class')) return '📦 来源';
    if (nameLower.includes('message') || nameLower.includes('msg') || nameLower.includes('body')) return '💬 消息';
    if (nameLower.includes('host') || nameLower.includes('ip') || nameLower.includes('addr')) return '🖥️ 主机';
    if (nameLower.includes('pid') || nameLower.includes('process')) return '🔢 进程ID';
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
      return document.getElementById('wizard-custom-regex').value.trim();
    }
    // preset 模式
    const preset = document.getElementById('wizard-preset-select').value;
    if (preset === 'auto' || preset === 'json') return null; // 自动检测不需要正则
    const p = LogParser.presets[preset];
    return p ? p.regex.source : null;
  },

  // 获取当前日期格式
  getCurrentDateFormat() {
    if (this.currentMode === 'smart') {
      return document.getElementById('wizard-date-format').value || SmartRuleGenerator.generatedDateFormat || '';
    }
    if (this.currentMode === 'regex') {
      return document.getElementById('wizard-regex-date-format').value.trim();
    }
    const preset = document.getElementById('wizard-preset-select').value;
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
        container.innerHTML = '<div style="color:var(--text-muted);font-size:11px">自动检测模式 — 将自动匹配最佳格式</div>';
        statsEl.innerHTML = '';
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
    }

    // 正则匹配测试
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
    if (match && match.groups) {
      const fields = match.groups;
      // 获取自定义列名映射
      const colMap = this.extractColumnMap();
      container.innerHTML = Object.entries(fields).map(([k, v]) => {
        const displayName = colMap[k] || k;
        return `<div class="wizard-test-field"><span class="wtf-label">${this.escapeHtml(displayName)}</span><span class="wtf-value">${this.escapeHtml((v || '').substring(0, 120)) || '<span class="empty">(空)</span>'}</span></div>`;
      }).join('');

      // 统计前20行匹配率
      const samples = this.rawLines.slice(0, 20);
      let matchCount = 0;
      for (const line of samples) {
        if (regex.test(line)) matchCount++;
      }
      const pct = ((matchCount / samples.length) * 100).toFixed(0);
      statsEl.innerHTML = `<span class="${pct > 50 ? 'match-ok' : 'match-fail'}">📊 前20行匹配: ${matchCount}/${samples.length} (${pct}%)</span>`;
    } else {
      container.innerHTML = '<div style="color:var(--error);font-size:11px">❌ 当前样本行不匹配</div>';
      statsEl.innerHTML = '<span class="match-fail">匹配失败 — 请调整规则或切换样本行</span>';
    }
    } catch (e) {
      // 静默处理
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
      config.customDateFormat = document.getElementById('wizard-date-format').value || SmartRuleGenerator.generatedDateFormat;
    } else if (this.currentMode === 'regex') {
      config.preset = 'custom';
      config.customRegex = document.getElementById('wizard-custom-regex').value.trim();
      config.customDateFormat = document.getElementById('wizard-regex-date-format').value.trim();
      // 提取自定义列名映射
      config.columnMap = this.extractColumnMap();
    } else {
      config.preset = preset;
    }

    this.hide();
    Utils.showLoading('正在解析日志文件...');

    try {
      if (this.files.length === 1) {
        await LogParser.parseFile(this.files[0], config);
      } else {
        await LogParser.mergeFiles(this.files, config);
      }
      App.onDataLoaded();
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
