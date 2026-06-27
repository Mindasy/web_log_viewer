// parser.js - 日志解析引擎

const LogParser = {
  // 预设解析器
  presets: {
    log4j: {
      name: 'Log4j / Logback',
      regex: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3})\s+(\w+)\s+\[([^\]]+)\]\s+(\S+)\s*[-:]\s*(.*)$/,
      groups: { timestamp: 1, level: 2, thread: 3, source: 4, message: 5 },
      dateFormat: 'yyyy-MM-dd HH:mm:ss,SSS'
    },
    log4j2: {
      name: 'Log4j2',
      regex: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3})\s+(\w+)\s+\[([^\]]*)\]\s*\[([^\]]*)\]\s+(\S+)\s*[-:]\s*(.*)$/,
      groups: { timestamp: 1, level: 2, thread: 3, source: 5, message: 6 },
      dateFormat: 'yyyy-MM-dd HH:mm:ss,SSS'
    },
    syslog: {
      name: 'Syslog',
      regex: /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$/,
      groups: { timestamp: 1, source: 2, thread: 4, message: 5 },
      dateFormat: 'MMM dd HH:mm:ss'
    },
    apache: {
      name: 'Apache / Nginx',
      regex: /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/,
      groups: { source: 1, timestamp: 4, message: 5 },
      dateFormat: 'dd/MMM/yyyy:HH:mm:ss Z'
    },
    json: {
      name: 'JSON',
      regex: null,
      groups: {},
      dateFormat: ''
    },
    bracketLog: {
      name: 'Bracket Log (括号格式)',
      regex: /^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{2,4})\]\[(\w+)\]\[(\d+)\]\[(\d+)\]\[([^\]]+)\]\[([^\]]+)\]\s*(.*)$/,
      groups: { timestamp: 1, level: 2, pid: 3, tid: 4, tag: 5, source: 6, message: 7 },
      dateFormat: 'yyyy-MM-dd HH:mm:ss,SSS Z'
    },
    generic: {
      name: '通用时间戳',
      regex: /^(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?(?:[+-]\d{2}:?\d{2})?)\s*(?:\[?(\w+)\]?\s*)?(?:\[([^\]]*)\]\s*)?(?:(\S+)\s*[-:]?\s*)?(.*)$/,
      groups: { timestamp: 1, level: 2, thread: 3, source: 4, message: 5 },
      dateFormat: 'yyyy-MM-dd HH:mm:ss.SSS'
    }
  },

  // 当前配置
  config: {
    preset: 'auto',
    customRegex: '',
    customDateFormat: '',
    customGroups: null,
    encoding: 'UTF-8',
    activePatternId: null,
    activePatternName: ''
  },

  // 解析结果
  entries: [],
  rawLines: [],
  fileInfo: null,
  // 多文件来源信息
  sourceFiles: [],

  // 解析文件（支持压缩包自动解压）
  async parseFile(file, config = {}) {
    const cfg = { ...this.config, ...config };
    this.config = cfg;
    this._detectedPreset = null;
    this.entries = [];
    this.rawLines = [];
    this.sourceFiles = [];

    // 检测是否为压缩包（zip / tar / tar.gz / tgz / rar）
    if (ArchiveHandler.isArchive(file.name)) {
      return await this.parseArchiveFile(file, cfg);
    }

    if (file.size > 200 * 1024 * 1024) {
      Utils.showToast('大文件警告: 文件超过 200MB，请使用压缩格式', 'warn');
    }

    this.fileInfo = { name: file.name, size: file.size, lastModified: file.lastModified };
    this.sourceFiles = [{ name: file.name, size: file.size }];

    const text = await this.readFile(file, cfg.encoding);
    const lines = text.split(/\r?\n/);
    this.rawLines = lines;

    // 自动检测格式
    let preset = cfg.preset;
    if (preset === 'auto') {
      preset = this.autoDetect(lines);
    }

    // 解析每一行
    const parser = this.getParser(preset, cfg);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const entry = parser(line, i);
      if (entry) {
        entry.index = this.entries.length;
        entry.lineNumber = i;
        entry.sourceFile = file.name;
        this.entries.push(entry);
      }
    }

    return this.entries;
  },

  // 用新配置重新解析已加载的日志（不重新读文件）
  async reparse(config) {
    const cfg = { ...this.config, ...config };
    this.config = cfg;
    this._detectedPreset = null;
    const oldEntries = this.entries;
    this.entries = [];

    const lines = this.rawLines || [];
    let preset = cfg.preset;
    if (preset === 'auto') {
      preset = this.autoDetect(lines);
    }

    const parser = this.getParser(preset, cfg);
    const sourceFileName = (this.sourceFiles && this.sourceFiles.length > 0)
      ? this.sourceFiles[0].name : 'reparse';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const entry = parser(line, i);
      if (entry) {
        entry.index = this.entries.length;
        entry.lineNumber = i;
        entry.sourceFile = sourceFileName;
        this.entries.push(entry);
      }
    }

    this.config = cfg;
    return this.entries.length;
  },

  // 解析压缩文件（通过 ArchiveHandler 统一处理）
  async parseArchiveFile(file, cfg, showProgress = true) {
    if (showProgress) Utils.showLoading('正在解压压缩文件...');

    let textFiles;
    try {
      const allFiles = await ArchiveHandler.extract(file);
      textFiles = allFiles.filter(f => f.isTextFile);
    } catch (e) {
      if (showProgress) Utils.hideLoading();
      throw new Error('压缩文件解析失败: ' + e.message);
    }

    if (textFiles.length === 0) {
      if (showProgress) Utils.hideLoading();
      throw new Error('压缩文件中未找到文本日志文件');
    }

    const ext = file.name.toLowerCase().split('.').pop();
    this.fileInfo = {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      isArchive: true,
      archiveFileCount: textFiles.length
    };
    this.sourceFiles = textFiles.map(f => ({
      name: file.name + '/' + f.name,
      displayName: f.name,
      archiveName: file.name,
      size: f.size
    }));

    const allLines = [];
    const fileLineMap = [];
    const encoding = cfg.encoding && cfg.encoding !== 'UTF-8' ? cfg.encoding : 'UTF-8';
    const decoder = new TextDecoder(encoding);

    for (const tf of textFiles) {
      try {
        const content = decoder.decode(tf.data);
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          allLines.push(line);
          fileLineMap.push(file.name + '/' + tf.name);
        }
      } catch (e) {
        console.warn(`无法读取压缩包中的文件: ${tf.name}`, e);
      }
    }

    if (showProgress) Utils.hideLoading();
    this.rawLines = allLines;

    let preset = cfg.preset;
    if (preset === 'auto') {
      preset = this.autoDetect(allLines);
    }

    const parser = this.getParser(preset, cfg);
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      if (!line.trim()) continue;
      const entry = parser(line, i);
      if (entry) {
        entry.index = this.entries.length;
        entry.lineNumber = i;
        entry.sourceFile = fileLineMap[i] || file.name;
        this.entries.push(entry);
      }
    }

    return this.entries;
  },

  // 读取文件为 ArrayBuffer
  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  },

  // 读取文件
  async readFile(file, encoding) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      if (encoding && encoding !== 'UTF-8') {
        // 对于非UTF-8编码，尝试使用TextDecoder
        reader.readAsArrayBuffer(file);
        reader.onload = () => {
          try {
            const decoder = new TextDecoder(encoding);
            resolve(decoder.decode(reader.result));
          } catch {
            // 降级到UTF-8
            const decoder = new TextDecoder('UTF-8');
            resolve(decoder.decode(reader.result));
          }
        };
      } else {
        reader.readAsText(file, 'UTF-8');
      }
    });
  },

  // 自动检测结果缓存
  _detectedPreset: null,

  // 自动检测格式
  autoDetect(lines) {
    if (this._detectedPreset) return this._detectedPreset;
    const samples = lines.filter(l => l.trim()).slice(0, 50);
    const scores = {};

    for (const line of samples) {
      const format = Utils.detectFormat(line);
      if (format) {
        scores[format] = (scores[format] || 0) + 1;
      }
    }

    let best = 'generic';
    let bestScore = 0;
    for (const [fmt, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        best = fmt;
      }
    }

    const map = { log4j: 'log4j', apache: 'apache', syslog: 'syslog', json: 'json', bracketLog: 'bracketLog' };
    this._detectedPreset = map[best] || 'generic';
    return this._detectedPreset;
  },

  // 获取解析器函数
  getParser(preset, cfg) {
    if (preset === 'custom' && cfg.customRegex) {
      return this.createCustomParser(cfg.customRegex, cfg.customDateFormat, cfg.columnMap || {}, cfg.customGroups || null);
    }
    if (preset === 'json') {
      return this.parseJsonLine.bind(this);
    }
    const p = this.presets[preset] || this.presets.generic;
    return this.createRegexParser(p);
  },

  // 创建正则解析器
  createRegexParser(preset) {
    const { regex, groups, dateFormat } = preset;
    const usedIndices = new Set(Object.values(groups).filter(v => typeof v === 'number'));
    return (line, lineNum) => {
      const match = line.match(regex);
      if (!match) {
        return this.genericParse(line, lineNum);
      }
      const entry = {
        raw: line,
        timestamp: groups.timestamp ? (match[groups.timestamp] || '').trim() : '',
        level: groups.level ? (match[groups.level] || '').trim() : '',
        pid: groups.pid ? (match[groups.pid] || '').trim() : '',
        tid: groups.tid ? (match[groups.tid] || '').trim() : '',
        thread: groups.thread ? (match[groups.thread] || '').trim() : (groups.tid ? (match[groups.tid] || '').trim() : ''),
        tag: groups.tag ? (match[groups.tag] || '').trim() : '',
        source: groups.source ? (match[groups.source] || '').trim() : '',
        message: groups.message ? (match[groups.message] || '').trim() : line,
        date: null,
        bookmarked: false,
        customFields: {}
      };

      // 提取未映射的捕获组作为自定义字段
      let colCounter = 1;
      for (let i = 1; i < match.length; i++) {
        if (!usedIndices.has(i) && match[i] !== undefined && match[i] !== '') {
          entry.customFields[`Column${colCounter}`] = match[i].trim();
          colCounter++;
        }
      }

      // 解析日期
      if (entry.timestamp) {
        entry.date = Utils.parseDate(entry.timestamp);
      }

      if (!entry.level) {
        entry.level = Utils.detectLevel(line) || '';
      }

      return entry;
    };
  },

  // 通用解析
  genericParse(line, lineNum) {
    const entry = {
      raw: line,
      timestamp: '',
      level: '',
      pid: '',
      tid: '',
      thread: '',
      tag: '',
      source: '',
      message: line,
      date: null,
      bookmarked: false,
      customFields: {}
    };

    // 尝试提取时间戳
    const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?(?:[+-]\d{2}:?\d{2})?)/);
    if (tsMatch) {
      entry.timestamp = tsMatch[1];
      entry.date = Utils.parseDate(entry.timestamp);
    }

    // 尝试提取级别
    entry.level = Utils.detectLevel(line) || '';

    // 尝试提取线程 [thread-name]
    const threadMatch = line.match(/\[([^\]]+)\]/);
    if (threadMatch && threadMatch[1].length < 50) {
      entry.thread = threadMatch[1];
    }

    return entry;
  },

  // JSON 解析器
  parseJsonLine(line, lineNum) {
    try {
      const obj = JSON.parse(line);
      const standardKeys = new Set(['timestamp', 'time', '@timestamp', 'date',
        'level', 'severity', 'log_level',
        'pid', 'process_id',
        'tid', 'thread_id',
        'thread', 'threadName', 'thread_name',
        'tag', 'component',
        'logger', 'source', 'class', 'service',
        'message', 'msg', 'body']);
      const entry = {
        raw: line,
        timestamp: obj.timestamp || obj.time || obj['@timestamp'] || obj.date || '',
        level: obj.level || obj.severity || obj.log_level || '',
        pid: obj.pid || obj.process_id || '',
        tid: obj.tid || obj.thread_id || '',
        thread: obj.thread || obj.threadName || obj.thread_name || '',
        tag: obj.tag || obj.component || '',
        source: obj.logger || obj.source || obj.class || obj.service || '',
        message: obj.message || obj.msg || obj.body || JSON.stringify(obj),
        date: null,
        bookmarked: false,
        customFields: {}
      };
      // 提取 JSON 中额外的字段作为自定义字段
      let colCounter = 1;
      for (const key of Object.keys(obj)) {
        if (!standardKeys.has(key)) {
          const val = obj[key];
          if (val !== null && val !== undefined && val !== '') {
            const displayName = String(key);
            entry.customFields[displayName] = String(val);
          }
        }
      }
      if (entry.timestamp) {
        entry.date = Utils.parseDate(entry.timestamp);
      }
      if (!entry.level) {
        entry.level = Utils.detectLevel(entry.message) || '';
      }
      return entry;
    } catch {
      return this.genericParse(line, lineNum);
    }
  },

  // 自定义正则解析器
  createCustomParser(regexStr, dateFormat, columnMap = {}, customGroups = null) {
    let regex;
    try {
      regex = new RegExp(regexStr);
    } catch {
      return this.genericParse.bind(this);
    }
    return (line, lineNum) => {
      const match = line.match(regex);
      if (!match) return this.genericParse(line, lineNum);

      let groups = match.groups || null;

      if (!groups && customGroups) {
        groups = {};
        for (const [name, idx] of Object.entries(customGroups)) {
          if (match[idx] !== undefined) groups[name] = match[idx] || '';
        }
      }
      if (!groups) groups = {};

      const fieldMap = this.buildFieldMap(groups, columnMap);

      const entry = {
        raw: line,
        timestamp: '',
        level: '',
        pid: '',
        tid: '',
        thread: '',
        tag: '',
        source: '',
        message: line,
        date: null,
        bookmarked: false,
        customFields: {}
      };

      // 填充标准字段
      if (groups.timestamp || fieldMap._timestampVal) entry.timestamp = fieldMap._timestampVal || groups.timestamp || '';
      if (groups.level || fieldMap._levelVal) entry.level = fieldMap._levelVal || groups.level || '';
      if (groups.pid || fieldMap._pidVal) entry.pid = fieldMap._pidVal || groups.pid || '';
      if (groups.tid || fieldMap._tidVal) entry.tid = fieldMap._tidVal || groups.tid || '';
      if (groups.thread || fieldMap._threadVal) entry.thread = fieldMap._threadVal || groups.thread || (groups.tid || '');
      if (groups.tag || fieldMap._tagVal) entry.tag = fieldMap._tagVal || groups.tag || '';
      if (groups.source || fieldMap._sourceVal) entry.source = fieldMap._sourceVal || groups.source || '';
      if (groups.message || fieldMap._messageVal) entry.message = fieldMap._messageVal || groups.message || '';

      // 保存所有自定义字段值（命名组）
      for (const [groupName, value] of Object.entries(groups)) {
        const displayName = columnMap[groupName] || groupName;
        if (!['timestamp', 'level', 'pid', 'tid', 'thread', 'tag', 'source', 'message'].includes(groupName)) {
          entry.customFields[displayName] = value;
        }
      }

      // 提取未命名的捕获组（正则中 (...) 而不带 ?<name>）
      const namedCount = match.groups ? Object.keys(match.groups).length : 0;
      if (namedCount > 0 && match.length - 1 > namedCount) {
        let colCounter = 1;
        const usedNamed = new Set();
        // 找出 named groups 占据的索引
        const source = regexStr || regex.source;
        let idx = 1;
        const namedMap = match.groups || {};
        const namedKeys = Object.keys(namedMap);
        // 跳过命名组占据的索引
        const namedIdxSet = new Set();
        if (customGroups) {
          for (const v of Object.values(customGroups)) namedIdxSet.add(v);
        } else {
          // 从索引 1 开始，跳过 named groups 的数量
          for (let i = 1; i <= namedCount; i++) namedIdxSet.add(i);
        }
        for (let i = 1; i < match.length; i++) {
          if (!namedIdxSet.has(i) && match[i] !== undefined && match[i] !== '') {
            const name = `Column${colCounter}`;
            if (!groups[name] && !columnMap[name]) {
              entry.customFields[name] = match[i].trim();
              colCounter++;
            }
          }
        }
      }

      if (entry.timestamp) {
        entry.date = Utils.parseDate(entry.timestamp);
      }
      if (!entry.level) {
        entry.level = Utils.detectLevel(line) || '';
      }

      // 如果通过命名组匹配，清除用户未显式捕获的标准字段
      if (match.groups && Object.keys(match.groups).length > 0) {
        const matchedStd = new Set(Object.keys(match.groups));
        for (const f of ['timestamp', 'level', 'pid', 'tid', 'thread', 'tag', 'source', 'message']) {
          if (!matchedStd.has(f)) {
            entry[f] = '';
          }
        }
      }

      return entry;
    };
  },

  // 构建字段映射：根据 columnMap 将自定义组名映射到标准字段
  buildFieldMap(groups, columnMap) {
    const result = {};

    // 检查 columnMap 中的值是否匹配标准字段名
    for (const [groupName, displayName] of Object.entries(columnMap)) {
      const lower = displayName.toLowerCase();
      if (lower === 'timestamp' || lower === 'time' || lower === 'date' || lower === 'ts') {
        result.timestamp = groupName;
        result._timestampVal = groups[groupName] || '';
      } else if (lower === 'level' || lower === 'severity' || lower === 'loglevel' || lower === 'lvl') {
        result.level = groupName;
        result._levelVal = groups[groupName] || '';
      } else if (lower === 'pid' || lower === 'process' || lower === 'processid') {
        result.pid = groupName;
        result._pidVal = groups[groupName] || '';
      } else if (lower === 'tid' || lower === 'threadid') {
        result.tid = groupName;
        result._tidVal = groups[groupName] || '';
      } else if (lower === 'tag' || lower === 'label' || lower === 'category') {
        result.tag = groupName;
        result._tagVal = groups[groupName] || '';
      } else if (lower === 'source' || lower === 'logger' || lower === 'class' || lower === 'service') {
        result.source = groupName;
        result._sourceVal = groups[groupName] || '';
      } else if (lower === 'message' || lower === 'msg' || lower === 'body' || lower === 'content') {
        result.message = groupName;
        result._messageVal = groups[groupName] || '';
      }
    }

    return result;
  },

  // 合并多个文件（支持 ZIP + 普通文件混合）
  async mergeFiles(files, config = {}, append = false) {
    const cfg = { ...this.config, ...config };
    this.config = cfg;

    // 追加模式：先保存已有数据
    const savedEntries = append ? [...this.entries] : [];
    const savedRaw = append ? [...this.rawLines] : [];
    const savedSrc = append ? [...this.sourceFiles] : [];

    this.entries = [];
    this.rawLines = [];
    this.sourceFiles = [];

    const allEntries = [];
    const allRawLines = [];
    const allSourceFiles = [];
    const failedFiles = [];

    for (const file of files) {
      try {
        // 检测是否为压缩包
        if (ArchiveHandler.isArchive(file.name)) {
          const savedEntries = this.entries;
          const savedRaw = this.rawLines;
          const savedSrc = this.sourceFiles;
          const savedInfo = this.fileInfo;

          this.entries = [];
          this.rawLines = [];
          this.sourceFiles = [];

          try {
            await this.parseArchiveFile(file, cfg, false);

            this.entries.forEach(e => {
              if (!e.sourceFile) e.sourceFile = file.name;
            });
            for (let ei = 0; ei < this.entries.length; ei++) allEntries.push(this.entries[ei]);
            for (let ri = 0; ri < this.rawLines.length; ri++) allRawLines.push(this.rawLines[ri]);
            for (let si = 0; si < this.sourceFiles.length; si++) allSourceFiles.push(this.sourceFiles[si]);
          } finally {
            this.entries = savedEntries;
            this.rawLines = savedRaw;
            this.sourceFiles = savedSrc;
            this.fileInfo = savedInfo;
          }
        } else {
          // 普通文件：直接读取并解析
          const text = await this.readFile(file, cfg.encoding);
          const lines = text.split(/\r?\n/);

          let preset = cfg.preset;
          if (preset === 'auto') {
            preset = this.autoDetect(lines);
          }

          const parser = this.getParser(preset, cfg);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const entry = parser(line, i);
            if (entry) {
              entry.index = allEntries.length;
              entry.lineNumber = i;
              entry.sourceFile = file.name;
              allEntries.push(entry);
            }
          }
          for (let li = 0; li < lines.length; li++) allRawLines.push(lines[li]);
          allSourceFiles.push({ name: file.name, size: file.size });
        }
      } catch (e) {
        failedFiles.push(file.name);
        console.error(`解析文件失败: ${file.name}`, e);
      }
    }

    if (failedFiles.length > 0) {
      const msg = failedFiles.length === files.length
        ? `全部 ${failedFiles.length} 个文件解析失败`
        : `${failedFiles.length}/${files.length} 个文件解析失败: ${failedFiles.join(', ')}`;
      Utils.showToast(msg, 'error');
    }

    if (allEntries.length === 0 && savedEntries.length === 0) {
      throw new Error('没有可解析的日志内容');
    }

    if (append && savedEntries.length > 0) {
      const tempEntries = [];
      for (let i = 0; i < savedEntries.length; i++) tempEntries.push(savedEntries[i]);
      for (let i = 0; i < allEntries.length; i++) tempEntries.push(allEntries[i]);
      allEntries.length = 0;
      for (let i = 0; i < tempEntries.length; i++) allEntries.push(tempEntries[i]);

      const tempRaw = [];
      for (let i = 0; i < savedRaw.length; i++) tempRaw.push(savedRaw[i]);
      for (let i = 0; i < allRawLines.length; i++) tempRaw.push(allRawLines[i]);
      allRawLines.length = 0;
      for (let i = 0; i < tempRaw.length; i++) allRawLines.push(tempRaw[i]);
      for (const sf of savedSrc) {
        const exists = allSourceFiles.find(f => f.name === sf.name);
        if (!exists) allSourceFiles.push(sf);
      }
    }

    // 按时间戳排序
    allEntries.sort((a, b) => {
      if (a.date && b.date) return a.date - b.date;
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });

    // 重新编号
    allEntries.forEach((e, i) => (e.index = i));

    this.entries = allEntries;
    this.rawLines = allRawLines;
    this.sourceFiles = allSourceFiles;
    this.fileInfo = {
      name: `${files.length} 个文件合并`,
      size: files.reduce((s, f) => s + f.size, 0),
      isMerged: true,
      fileCount: files.length,
      totalSourceFiles: allSourceFiles.length
    };

    return allEntries;
  },

  // 清除
  clear() {
    this.entries = [];
    this.rawLines = [];
    this.fileInfo = null;
    this.sourceFiles = [];
    this.config = {
      preset: 'auto',
      customRegex: '',
      customDateFormat: '',
      customGroups: null,
      encoding: 'UTF-8',
      activePatternId: null,
      activePatternName: ''
    };
  }
};

// ===== 智能规则生成器 =====
const SmartRuleGenerator = {
  // 分词结果
  tokens: [],
  // 字段分配: { tokenIndex: fieldName }
  assignments: {},
  // 生成的规则
  generatedRegex: '',
  generatedDateFormat: '',

  // 已知的日期格式模式（含时区）
  datePatterns: [
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{2}:\d{2}/, fmt: 'yyyy-MM-dd HH:mm:ss,SSS ZZ' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{4}/, fmt: 'yyyy-MM-dd HH:mm:ss,SSS Z' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{3}/, fmt: 'yyyy-MM-dd HH:mm:ss,SSS Z' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*(?:GMT|UTC)/, fmt: "yyyy-MM-dd HH:mm:ss,SSS 'GMT'" },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/, fmt: 'yyyy-MM-dd HH:mm:ss,SSS' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{2}:\d{2}/, fmt: 'yyyy-MM-dd HH:mm:ss ZZ' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{4}/, fmt: 'yyyy-MM-dd HH:mm:ss Z' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*(?:GMT|UTC)/, fmt: "yyyy-MM-dd HH:mm:ss 'GMT'" },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/, fmt: 'yyyy-MM-dd HH:mm:ss' },
    { regex: /\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/, fmt: 'yyyy/MM/dd HH:mm:ss,SSS' },
    { regex: /\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}/, fmt: 'yyyy/MM/dd HH:mm:ss' },
    { regex: /\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4}/, fmt: 'dd/MMM/yyyy:HH:mm:ss Z' },
    { regex: /\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+(?:GMT|UTC)/, fmt: "dd/MMM/yyyy:HH:mm:ss 'GMT'" },
    { regex: /[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/, fmt: 'MMM dd HH:mm:ss' },
    { regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:[+-]\d{2}:\d{2})?/, fmt: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX" },
    { regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/, fmt: "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" },
    { regex: /\d{2}:\d{2}:\d{2}[,.]\d{3}/, fmt: 'HH:mm:ss,SSS' },
    { regex: /\d{2}:\d{2}:\d{2}/, fmt: 'HH:mm:ss' },
  ],

  // 已知的级别关键词
  levelKeywords: ['FATAL', 'ERROR', 'ERR', 'SEVERE', 'WARN', 'WARNING', 'INFO', 'INFORMATION', 'DEBUG', 'DBG', 'TRACE', 'VERBOSE', 'NOTICE', 'CRITICAL', 'ALERT', 'EMERGENCY'],

  // 分析样本行
  analyze(sampleLine) {
    this.tokens = [];
    this.assignments = {};
    this.generatedRegex = '';
    this.generatedDateFormat = '';

    if (!sampleLine || !sampleLine.trim()) return { tokens: [], assignments: {} };

    // 智能分词：按空白分割，但保留括号内容、引号内容
    const rawTokens = this.tokenize(sampleLine);

    // 分析每个token
    this.tokens = rawTokens.map((text, i) => ({
      index: i,
      text,
      type: this.classifyToken(text, i, rawTokens),
    }));

    // 自动分配字段
    this.autoAssign();

    return { tokens: this.tokens, assignments: { ...this.assignments } };
  },

  // 分词
  tokenize(line) {
    const tokens = [];
    // 使用正则匹配：连续非空白字符，或方括号内容，或引号内容
    const regex = /\[[^\]]*\]|"[^"]*"|'[^']*'|\S+/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      tokens.push(match[0]);
    }
    return tokens;
  },

  // 分类单个token
  classifyToken(text, index, allTokens) {
    const trimmed = text.replace(/^[[\]"']|[[\]"']$/g, '');

    // 检测日期/时间戳
    for (const dp of this.datePatterns) {
      if (dp.regex.test(text) || dp.regex.test(trimmed)) {
        return 'timestamp';
      }
    }

    // 检测日志级别
    const upper = trimmed.toUpperCase();
    if (this.levelKeywords.includes(upper)) {
      return 'level';
    }

    // 检测纯数字（含方括号包裹的数字）
    if (/^\d+$/.test(trimmed)) {
      return 'number';
    }

    // 检测标签Tag：短字母数字token（非级别、非来源、非数字）
    if (/^[a-zA-Z_][\w]*$/.test(trimmed) && trimmed.length >= 2 && trimmed.length <= 30) {
      return 'tag';
    }

    // 检测来源模式: filename:func:linenumber 或 package.Class
    if (/^[\w./-]+:[\w./-]+(:\d+)?$/.test(trimmed) && trimmed.length > 5) {
      return 'source';
    }
    if (/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)+/.test(trimmed) && trimmed.length > 5) {
      return 'source';
    }

    // 检测分隔符
    if (/^[-:=>|]+$/.test(trimmed)) {
      return 'separator';
    }

    // 默认：可能是消息的一部分
    return 'unknown';
  },

  // 自动分配字段
  autoAssign() {
    this.assignments = {};

    // 优先级：timestamp > level > source > pid > tid > message
    let numberCount = 0;

    for (let i = 0; i < this.tokens.length; i++) {
      const token = this.tokens[i];

      if (!this.assignments.timestamp && token.type === 'timestamp') {
        this.assignments.timestamp = [i];
        // 检测日期格式
        this.generatedDateFormat = this.detectDateFormat(token.text);
        continue;
      }

      if (!this.assignments.level && token.type === 'level') {
        this.assignments.level = [i];
        continue;
      }

      if (!this.assignments.source && token.type === 'source') {
        this.assignments.source = [i];
        continue;
      }

      if (!this.assignments.tag && token.type === 'tag') {
        this.assignments.tag = [i];
        continue;
      }

      // 数字类型：第一个分配给pid，第二个分配给tid
      if (token.type === 'number') {
        numberCount++;
        if (numberCount === 1 && !this.assignments.pid) {
          this.assignments.pid = [i];
          continue;
        }
        if (numberCount === 2 && !this.assignments.tid) {
          this.assignments.tid = [i];
          continue;
        }
      }
    }

    // 消息：最后一个非分隔符token之后的所有内容
    // 找到最后一个已分配的token
    const assignedArrays = Object.values(this.assignments).filter(Array.isArray);
    const assignedIndices = new Set(assignedArrays.flat());
    let lastAssigned = assignedIndices.size > 0 ? Math.max(-1, ...assignedIndices) : -1;

    // 消息从最后一个已分配token之后开始
    if (lastAssigned >= 0 && lastAssigned < this.tokens.length - 1) {
      this.assignments.message = [lastAssigned + 1];
    } else if (assignedIndices.size === 0) {
      // 没有任何分配，整行作为消息
      this.assignments.message = [0];
    }
  },

  // 检测日期格式
  detectDateFormat(text) {
    const trimmed = text.replace(/^[[\]"']|[[\]"']$/g, '');
    for (const dp of this.datePatterns) {
      if (dp.regex.test(trimmed)) return dp.fmt;
    }
    return '';
  },

  // 手动分配字段（支持多个 token 分配到同一字段）
  assignField(tokenIndex, fieldName) {
    // 从其他字段中移除该 token
    for (const [field, indices] of Object.entries(this.assignments)) {
      if (Array.isArray(indices)) {
        const idx = indices.indexOf(tokenIndex);
        if (idx !== -1) {
          indices.splice(idx, 1);
          if (indices.length === 0) delete this.assignments[field];
          break;
        }
      }
    }
    // 追加到目标字段
    if (!this.assignments[fieldName]) {
      this.assignments[fieldName] = [];
    }
    if (!this.assignments[fieldName].includes(tokenIndex)) {
      this.assignments[fieldName].push(tokenIndex);
    }
    this.regenerateRegex();
  },

  // 取消分配
  unassignField(tokenIndex) {
    for (const [field, indices] of Object.entries(this.assignments)) {
      if (Array.isArray(indices)) {
        const idx = indices.indexOf(tokenIndex);
        if (idx !== -1) {
          indices.splice(idx, 1);
          if (indices.length === 0) delete this.assignments[field];
          break;
        }
      }
    }
    this.regenerateRegex();
  },

  // 根据分配生成正则表达式
  regenerateRegex() {
    const fieldOrder = ['timestamp', 'level', 'pid', 'tid', 'tag', 'source', 'message'];
    const assignedTokens = {};

    for (const [field, indices] of Object.entries(this.assignments)) {
      if (Array.isArray(indices)) {
        for (const idx of indices) {
          assignedTokens[idx] = field;
        }
      }
    }

    // 检测连续括号token（如 ][ 无空格），使用空分隔符
    const isBracketToken = (t) => t && /^\[[^\]]*\]$/.test(t.text);
    const separator = '\\s+';

    // 将连续的同字段 token 合并为单个命名组，避免重复命名组
    const groups = []; // { field: string|null, patterns: [str], indices: [int] }
    let i = 0;
    while (i < this.tokens.length) {
      if (assignedTokens[i]) {
        const field = assignedTokens[i];
        const patterns = [];
        const tokenIndices = [];
        while (i < this.tokens.length && assignedTokens[i] === field) {
          patterns.push(this.tokenToPattern(this.tokens[i].text, field));
          tokenIndices.push(i);
          i++;
        }
        groups.push({ field, pattern: patterns.join('\\s+'), tokenIndices });
      } else {
        groups.push({ field: null, pattern: this.escapeRegex(this.tokens[i].text), tokenIndices: [i] });
        i++;
      }
    }

    // 第一轮：构建完整正则，末尾加 (.*)$
    let regexStr = '^';
    for (let j = 0; j < groups.length; j++) {
      const g = groups[j];
      if (g.field) {
        regexStr += `(?<${g.field}>${g.pattern})`;
      } else {
        regexStr += g.pattern;
      }
      if (j < groups.length - 1) {
        const currLastIdx = g.tokenIndices[g.tokenIndices.length - 1];
        const nextFirstIdx = groups[j + 1].tokenIndices[0];
        if (isBracketToken(this.tokens[currLastIdx]) && isBracketToken(this.tokens[nextFirstIdx])) {
          regexStr += '';
        } else {
          regexStr += separator;
        }
      }
    }
    this.generatedRegex = regexStr + '(.*)$';

    // 如果消息字段有分配，重建：从首个消息组开始捕获到行尾
    if (this.assignments.message && this.assignments.message.length > 0) {
      const msgGroups = groups.filter(g => g.field === 'message');
      if (msgGroups.length > 0) {
        const firstMsgGroup = msgGroups[0];
        const msgIdx = firstMsgGroup.tokenIndices[0];
        const newGroups = [];
        let rebuildMsg = false;
        for (let j = 0; j < groups.length; j++) {
          const g = groups[j];
          if (g.field === 'message' && !rebuildMsg) {
            rebuildMsg = true;
            // 将首个消息组及之前所有未处理的消息组合并到消息捕获中，一直延伸到行尾
            const allMsgPatterns = [];
            const allMsgIndices = [];
            for (let k = j; k < groups.length; k++) {
              if (groups[k].field === 'message') {
                allMsgPatterns.push(groups[k].pattern);
                allMsgIndices.push(...groups[k].tokenIndices);
              }
            }
            newGroups.push({
              field: 'message',
              pattern: allMsgPatterns.join('\\s+') + '.*',
              tokenIndices: allMsgIndices
            });
            break;
          } else if (!rebuildMsg) {
            newGroups.push(g);
          }
        }
        // 用 newGroups 重建
        let msgRegex = '^';
        for (let j = 0; j < newGroups.length; j++) {
          const g = newGroups[j];
          if (g.field) {
            msgRegex += `(?<${g.field}>${g.pattern})`;
          } else {
            msgRegex += g.pattern;
          }
          if (j < newGroups.length - 1) {
            const currLastIdx = g.tokenIndices[g.tokenIndices.length - 1];
            const nextFirstIdx = newGroups[j + 1].tokenIndices[0];
            if (isBracketToken(this.tokens[currLastIdx]) && isBracketToken(this.tokens[nextFirstIdx])) {
              msgRegex += '';
            } else {
              msgRegex += separator;
            }
          }
        }
        this.generatedRegex = msgRegex;
      }
    }

    return this.generatedRegex;
  },

  // 将token文本转换为正则模式
  tokenToPattern(text, field) {
    const trimmed = text.replace(/^[[\]"']|[[\]"']$/g, '');

    switch (field) {
      case 'timestamp':
        return '[^\\s]+(?:\\s+[^\\s]+)?'; // 可能包含空格的时间戳
      case 'level':
        return '\\w+';
      case 'pid':
      case 'tid':
        if (/^\[.+\]$/.test(text)) return '\\[\\d+\\]';
        return '\\d+';
      case 'tag':
        if (/^\[.+\]$/.test(text)) return '\\[[^\\]]+\\]';
        return '\\w+';
      case 'source':
        return '[\\w./:-]+';
      case 'message':
        return '.+';
      default:
        return this.escapeRegex(text);
    }
  },

  // 转义正则特殊字符
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  // 测试正则
  testRegex(regexStr, sampleLines) {
    if (!regexStr) return [];
    let regex;
    try {
      regex = new RegExp(regexStr);
    } catch {
      return sampleLines.map(line => ({ line, match: false, error: '正则表达式无效' }));
    }

    return sampleLines.map(line => {
      const m = line.match(regex);
      if (m) {
        const fields = {};
        if (m.groups) {
          for (const [k, v] of Object.entries(m.groups)) {
            fields[k] = v;
          }
        }
        return { line, match: true, fields };
      }
      return { line, match: false };
    });
  },

  // 获取当前分配摘要
  getAssignmentSummary() {
    const summary = {};
    for (const [field, idx] of Object.entries(this.assignments)) {
      summary[field] = {
        tokenIndex: idx,
        tokenText: this.tokens[idx]?.text || '',
      };
    }
    return summary;
  },

  // 重置
  reset() {
    this.tokens = [];
    this.assignments = {};
    this.generatedRegex = '';
    this.generatedDateFormat = '';
  }
};
