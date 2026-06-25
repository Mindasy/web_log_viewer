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
    encoding: 'UTF-8'
  },

  // 解析结果
  entries: [],
  rawLines: [],
  fileInfo: null,
  // 多文件来源信息
  sourceFiles: [],

  // 解析文件（支持 .zip 自动解压）
  async parseFile(file, config = {}) {
    const cfg = { ...this.config, ...config };
    this.config = cfg;
    this.entries = [];
    this.rawLines = [];
    this.sourceFiles = [];

    // 检测是否为 ZIP 文件
    if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      return await this.parseZipFile(file, cfg);
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
      if (!line.trim()) continue;
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

  // 解析 ZIP 压缩文件
  async parseZipFile(file, cfg, showProgress = true) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip 库未加载，无法解析 ZIP 文件');
    }

    if (showProgress) Utils.showLoading('正在解压 ZIP 文件...');
    let zip;
    try {
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (e) {
      if (showProgress) Utils.hideLoading();
      throw new Error('ZIP 文件解析失败: ' + e.message);
    }

    // 收集所有文本文件
    const textFiles = [];
    const allFileNames = Object.keys(zip.files);
    for (const name of allFileNames) {
      const entry = zip.files[name];
      if (entry.dir) continue;
      // 过滤非文本文件
      const lower = name.toLowerCase();
      if (/\.(log|txt|json|xml|csv|out|err|trace|conf|cfg|properties|yml|yaml)$/.test(lower) ||
          !/\.(exe|dll|so|dylib|class|jar|war|ear|png|jpg|gif|bmp|ico|mp3|mp4|avi|pdf|doc|xls|ppt|zip|gz|tar|bz2|7z)$/.test(lower)) {
        textFiles.push({ name, entry });
      }
    }

    if (textFiles.length === 0) {
      if (showProgress) Utils.hideLoading();
      throw new Error('ZIP 文件中未找到文本日志文件');
    }

    this.fileInfo = {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      isZip: true,
      zipFileCount: textFiles.length
    };
    this.sourceFiles = textFiles.map(f => ({
      name: file.name + '/' + f.name,
      displayName: f.name,
      zipName: file.name,
      size: f.entry._data?.uncompressedSize || 0
    }));

    // 读取并合并所有文本文件
    const allLines = [];
    const fileLineMap = []; // 记录每行来自哪个文件

    for (const tf of textFiles) {
      try {
        const content = await tf.entry.async('string');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          allLines.push(line);
          fileLineMap.push(file.name + '/' + tf.name);
        }
      } catch (e) {
        console.warn(`无法读取 ZIP 中的文件: ${tf.name}`, e);
      }
    }

    if (showProgress) Utils.hideLoading();
    this.rawLines = allLines;

    // 自动检测格式
    let preset = cfg.preset;
    if (preset === 'auto') {
      preset = this.autoDetect(allLines);
    }

    // 解析每一行
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

  // 自动检测格式
  autoDetect(lines) {
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

    // 映射到预设名
    const map = { log4j: 'log4j', apache: 'apache', syslog: 'syslog', json: 'json' };
    return map[best] || 'generic';
  },

  // 获取解析器函数
  getParser(preset, cfg) {
    if (preset === 'custom' && cfg.customRegex) {
      return this.createCustomParser(cfg.customRegex, cfg.customDateFormat, cfg.columnMap || {});
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
    return (line, lineNum) => {
      const match = line.match(regex);
      if (!match) {
        // 尝试通用解析
        return this.genericParse(line, lineNum);
      }
      const entry = {
        raw: line,
        timestamp: groups.timestamp ? (match[groups.timestamp] || '').trim() : '',
        level: groups.level ? (match[groups.level] || '').trim() : '',
        thread: groups.thread ? (match[groups.thread] || '').trim() : '',
        source: groups.source ? (match[groups.source] || '').trim() : '',
        message: groups.message ? (match[groups.message] || '').trim() : line,
        date: null,
        bookmarked: false
      };

      // 解析日期
      if (entry.timestamp) {
        entry.date = Utils.parseDate(entry.timestamp);
      }

      // 如果没有检测到级别，尝试从消息中检测
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
      thread: '',
      source: '',
      message: line,
      date: null,
      bookmarked: false
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
      const entry = {
        raw: line,
        timestamp: obj.timestamp || obj.time || obj['@timestamp'] || obj.date || '',
        level: obj.level || obj.severity || obj.log_level || '',
        thread: obj.thread || obj.threadName || obj.thread_name || '',
        source: obj.logger || obj.source || obj.class || obj.service || '',
        message: obj.message || obj.msg || obj.body || JSON.stringify(obj),
        date: null,
        bookmarked: false
      };
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
  createCustomParser(regexStr, dateFormat, columnMap = {}) {
    let regex;
    try {
      regex = new RegExp(regexStr);
    } catch {
      return this.genericParse.bind(this);
    }
    return (line, lineNum) => {
      const match = line.match(regex);
      if (!match) return this.genericParse(line, lineNum);

      // 从命名捕获组提取字段
      const groups = match.groups || {};

      // 应用列名映射：将捕获组名映射到标准字段
      const fieldMap = this.buildFieldMap(groups, columnMap);

      const entry = {
        raw: line,
        timestamp: fieldMap.timestamp || '',
        level: fieldMap.level || '',
        pid: fieldMap.pid || '',
        tid: fieldMap.tid || '',
        source: fieldMap.source || '',
        message: fieldMap.message || line,
        date: null,
        bookmarked: false,
        // 保存所有自定义字段
        customFields: {}
      };

      // 填充标准字段
      if (groups.timestamp || fieldMap._timestampVal) entry.timestamp = fieldMap._timestampVal || groups.timestamp || '';
      if (groups.level || fieldMap._levelVal) entry.level = fieldMap._levelVal || groups.level || '';
      if (groups.pid || fieldMap._pidVal) entry.pid = fieldMap._pidVal || groups.pid || '';
      if (groups.tid || fieldMap._tidVal) entry.tid = fieldMap._tidVal || groups.tid || '';
      if (groups.source || fieldMap._sourceVal) entry.source = fieldMap._sourceVal || groups.source || '';
      if (groups.message || fieldMap._messageVal) entry.message = fieldMap._messageVal || groups.message || '';

      // 保存所有自定义字段值
      for (const [groupName, value] of Object.entries(groups)) {
        const displayName = columnMap[groupName] || groupName;
        if (!['timestamp', 'level', 'pid', 'tid', 'source', 'message'].includes(groupName)) {
          entry.customFields[displayName] = value;
        }
      }

      if (entry.timestamp) {
        entry.date = Utils.parseDate(entry.timestamp);
      }
      if (!entry.level) {
        entry.level = Utils.detectLevel(line) || '';
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
  async mergeFiles(files, config = {}) {
    const cfg = { ...this.config, ...config };
    this.config = cfg;
    this.entries = [];
    this.rawLines = [];
    this.sourceFiles = [];

    const allEntries = [];
    const allRawLines = [];
    const allSourceFiles = [];

    for (const file of files) {
      try {
        // 检测是否为 ZIP 文件
        if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
          // 直接调用 parseZipFile，不通过 parseFile（避免重复检测）
          const savedEntries = this.entries;
          const savedRaw = this.rawLines;
          const savedSrc = this.sourceFiles;
          const savedInfo = this.fileInfo;

          this.entries = [];
          this.rawLines = [];
          this.sourceFiles = [];

          await this.parseZipFile(file, cfg, false);

          this.entries.forEach(e => {
            if (!e.sourceFile) e.sourceFile = file.name;
          });
          allEntries.push(...this.entries);
          allRawLines.push(...this.rawLines);
          allSourceFiles.push(...this.sourceFiles);

          this.entries = savedEntries;
          this.rawLines = savedRaw;
          this.sourceFiles = savedSrc;
          this.fileInfo = savedInfo;
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
          allRawLines.push(...lines);
          allSourceFiles.push({ name: file.name, size: file.size });
        }
      } catch (e) {
        console.warn(`解析文件失败: ${file.name}`, e);
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
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/, fmt: 'yyyy-MM-dd HH:mm:ss,SSS' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{2}:\d{2}/, fmt: 'yyyy-MM-dd HH:mm:ss ZZ' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{4}/, fmt: 'yyyy-MM-dd HH:mm:ss Z' },
    { regex: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/, fmt: 'yyyy-MM-dd HH:mm:ss' },
    { regex: /\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/, fmt: 'yyyy/MM/dd HH:mm:ss,SSS' },
    { regex: /\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}/, fmt: 'yyyy/MM/dd HH:mm:ss' },
    { regex: /\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4}/, fmt: 'dd/MMM/yyyy:HH:mm:ss Z' },
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
        this.assignments.timestamp = i;
        // 检测日期格式
        this.generatedDateFormat = this.detectDateFormat(token.text);
        continue;
      }

      if (!this.assignments.level && token.type === 'level') {
        this.assignments.level = i;
        continue;
      }

      if (!this.assignments.source && token.type === 'source') {
        this.assignments.source = i;
        continue;
      }

      // 数字类型：第一个分配给pid，第二个分配给tid
      if (token.type === 'number') {
        numberCount++;
        if (numberCount === 1 && !this.assignments.pid) {
          this.assignments.pid = i;
          continue;
        }
        if (numberCount === 2 && !this.assignments.tid) {
          this.assignments.tid = i;
          continue;
        }
      }
    }

    // 消息：最后一个非分隔符token之后的所有内容
    // 找到最后一个已分配的token
    const assignedIndices = new Set(Object.values(this.assignments));
    let lastAssigned = Math.max(-1, ...assignedIndices);

    // 消息从最后一个已分配token之后开始
    if (lastAssigned >= 0 && lastAssigned < this.tokens.length - 1) {
      this.assignments.message = lastAssigned + 1;
    } else if (assignedIndices.size === 0) {
      // 没有任何分配，整行作为消息
      this.assignments.message = 0;
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

  // 手动分配字段
  assignField(tokenIndex, fieldName) {
    // 清除该字段之前的分配
    for (const [field, idx] of Object.entries(this.assignments)) {
      if (idx === tokenIndex) delete this.assignments[field];
    }
    // 清除该token之前的分配
    for (const [field, idx] of Object.entries(this.assignments)) {
      if (field === fieldName) delete this.assignments[field];
    }
    this.assignments[fieldName] = tokenIndex;
    this.regenerateRegex();
  },

  // 取消分配
  unassignField(tokenIndex) {
    for (const [field, idx] of Object.entries(this.assignments)) {
      if (idx === tokenIndex) {
        delete this.assignments[field];
        break;
      }
    }
    this.regenerateRegex();
  },

  // 根据分配生成正则表达式
  regenerateRegex() {
    const parts = [];
    const fieldOrder = ['timestamp', 'level', 'pid', 'tid', 'source', 'message'];
    const assignedTokens = {};

    for (const [field, idx] of Object.entries(this.assignments)) {
      assignedTokens[idx] = field;
    }

    // 检测连续括号token（如 ][ 无空格），使用空分隔符
    const isBracketToken = (t) => t && /^\[[^\]]*\]$/.test(t.text);

    let i = 0;
    while (i < this.tokens.length) {
      if (assignedTokens[i]) {
        // 这是一个命名字段
        const field = assignedTokens[i];
        const tokenText = this.tokens[i].text;
        const pattern = this.tokenToPattern(tokenText, field);
        parts.push(`(?<${field}>${pattern})`);
        i++;
      } else {
        // 未分配的token，生成字面匹配或通配
        const tokenText = this.tokens[i].text;
        parts.push(this.escapeRegex(tokenText));
        i++;
      }
    }

    // 构建完整正则：检测连续括号token使用空分隔符
    const separator = '\\s+';
    let regexStr = '^';
    for (let j = 0; j < parts.length; j++) {
      regexStr += parts[j];
      if (j < parts.length - 1) {
        // 如果当前token和下一个token都是括号包裹的，使用空分隔符
        const currToken = this.tokens[j];
        const nextToken = this.tokens[j + 1];
        if (isBracketToken(currToken) && isBracketToken(nextToken)) {
          regexStr += '';
        } else {
          regexStr += separator;
        }
      }
    }
    this.generatedRegex = regexStr + '(.*)$';

    // 如果消息字段是最后一个命名字段，把后面的(.*)合并进去
    if (this.assignments.message !== undefined) {
      // 重建：消息字段捕获到行尾
      const msgIdx = this.assignments.message;
      const newParts = [];
      for (let j = 0; j < this.tokens.length; j++) {
        if (j === msgIdx) {
          const tokenText = this.tokens[j].text;
          const pattern = this.tokenToPattern(tokenText, 'message');
          newParts.push(`(?<message>${pattern}.*)`);
          break; // 消息之后的不再处理
        } else if (assignedTokens[j]) {
          const field = assignedTokens[j];
          const tokenText = this.tokens[j].text;
          const pattern = this.tokenToPattern(tokenText, field);
          newParts.push(`(?<${field}>${pattern})`);
        } else {
          newParts.push(this.escapeRegex(this.tokens[j].text));
        }
      }
      // 重建时也处理连续括号
      let msgRegex = '^';
      for (let j = 0; j < newParts.length; j++) {
        msgRegex += newParts[j];
        if (j < newParts.length - 1) {
          const currToken = this.tokens[j];
          const nextToken = this.tokens[j + 1];
          if (isBracketToken(currToken) && isBracketToken(nextToken)) {
            msgRegex += '';
          } else {
            msgRegex += separator;
          }
        }
      }
      this.generatedRegex = msgRegex;
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
