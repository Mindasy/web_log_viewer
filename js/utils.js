// utils.js - 工具函数

const Utils = {
  // 格式化字节数
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  // 格式化数字
  formatNumber(n) {
    return n.toLocaleString();
  },

  // 防抖
  debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  // 节流
  throttle(fn, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },

  // 转义正则特殊字符
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  // 生成唯一 ID
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  },

  // 显示 Toast（复用单例元素）
  _toastEl: null,
  _toastTimer: null,

  showToast(msg, type = '') {
    if (!this._toastEl) {
      this._toastEl = document.createElement('div');
      this._toastEl.className = 'toast';
      this._toastEl.style.display = 'none';
      document.body.appendChild(this._toastEl);
    }
    if (!msg) {
      this._toastEl.style.display = 'none';
      return;
    }
    this._toastEl.textContent = msg;
    this._toastEl.className = 'toast ' + type;
    this._toastEl.style.display = 'block';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this._toastEl.style.display = 'none';
    }, 3000);
  },

  // 显示/隐藏加载指示器
  showLoading(msg = '处理中...') {
    this.hideLoading();
    const el = document.createElement('div');
    el.className = 'loading-indicator';
    el.id = 'loading-indicator';
    el.innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
    document.body.appendChild(el);
  },

  hideLoading() {
    const el = document.getElementById('loading-indicator');
    if (el) el.remove();
  },

  // 显示覆盖层
  showOverlay() {
    let el = document.getElementById('overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'overlay';
      document.body.appendChild(el);
    }
    el.style.display = 'block';
    el.onclick = () => {
      Utils.hideOverlay();
      Utils.closeAllPanels();
    };
  },

  hideOverlay() {
    const el = document.getElementById('overlay');
    if (el) el.style.display = 'none';
  },

  closeAllPanels() {
    // 跳过自主管理的弹窗（它们有自己的 overlay 系统）
    document.querySelectorAll('.popup-panel').forEach(p => {
      if (p.id !== 'pattern-import' && p.id !== 'pattern-editor') {
        p.style.display = 'none';
      }
    });
    const extraPanels = ['pattern-manager-main', 'pattern-save-panel', 'pattern-manager',
      'highlight-settings-panel', 'column-settings-panel'];
    extraPanels.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  },

  // 下载文件
  downloadFile(content, filename, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  // 复制到剪贴板（label 可选，用于显示友好的提示）
  async copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      Utils.showToast(label ? `已复制 ${label}` : '已复制到剪贴板', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      Utils.showToast(label ? `已复制 ${label}` : '已复制到剪贴板', 'success');
    }
  },

  // 解析日期字符串缓存
  _parseCache: new Map(),
  _parseCacheMax: 500,

  // 解析日期字符串（支持时区）
  parseDate(str) {
    if (!str) return null;

    const cached = this._parseCache.get(str);
    if (cached !== undefined) return cached;

    // Normalize timezone: +800 → +08:00, +0800 → +08:00
    let normalized = str.replace(/^\[|\]$/g, '');
    normalized = normalized.replace(/\s([+-])(\d{1,2})(\d{2})(?=\s*$|$)/, (_, sign, hh, mm) => {
      return ' ' + sign + hh.padStart(2, '0') + ':' + mm;
    });

    // 替换文本时区: GMT → +0000, UTC → +0000, EST/EDT → -0500/-0400 等
    normalized = normalized.replace(/\sGMT(?=\s*$|[^a-zA-Z])/g, ' +0000');
    normalized = normalized.replace(/\sUTC(?=\s*$|[^a-zA-Z])/g, ' +0000');
    normalized = normalized.replace(/\sEST(?=\s*$|[^a-zA-Z])/g, ' -0500');
    normalized = normalized.replace(/\sEDT(?=\s*$|[^a-zA-Z])/g, ' -0400');
    normalized = normalized.replace(/\sCST(?=\s*$|[^a-zA-Z])/g, ' -0600');
    normalized = normalized.replace(/\sCDT(?=\s*$|[^a-zA-Z])/g, ' -0500');
    normalized = normalized.replace(/\sMST(?=\s*$|[^a-zA-Z])/g, ' -0700');
    normalized = normalized.replace(/\sMDT(?=\s*$|[^a-zA-Z])/g, ' -0600');
    normalized = normalized.replace(/\sPST(?=\s*$|[^a-zA-Z])/g, ' -0800');
    normalized = normalized.replace(/\sPDT(?=\s*$|[^a-zA-Z])/g, ' -0700');

    // 先尝试原生 Date 解析（支持 ISO 8601 含时区格式）
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) {
      if (this._parseCache.size >= this._parseCacheMax) this._parseCache.clear();
      this._parseCache.set(str, d);
      return d;
    }

    // 常见日志格式（含时区）
    const patterns = [
      /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:[+-]\d{2}:?\d{2})?)/,
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{2}:\d{2})/,
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{4})/,
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{2}:\d{2})/,
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{4})/,
      /(\d{4}\/\d{2}\/\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/,
      /(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s*[+-]\d{4})/,
      /([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    ];
    for (const p of patterns) {
      const m = normalized.match(p);
      if (m) {
        const d2 = new Date(m[1]);
        if (!isNaN(d2.getTime())) {
          if (this._parseCache.size >= this._parseCacheMax) this._parseCache.clear();
          this._parseCache.set(str, d2);
          return d2;
        }
      }
    }
    this._parseCache.set(str, null);
    return null;
  },

  // 格式化日期
  formatDate(date, fmt = 'yyyy-MM-dd HH:mm:ss.SSS') {
    if (!date) return '';
    const y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const H = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const S = String(date.getMilliseconds()).padStart(3, '0');
    return fmt.replace(/(yyyy|MM|dd|HH|mm|ss|SSS)/g, (_, token) => {
      switch (token) {
        case 'yyyy': return y;
        case 'MM': return M;
        case 'dd': return d;
        case 'HH': return H;
        case 'mm': return m;
        case 'ss': return s;
        case 'SSS': return S;
        default: return token;
      }
    });
  },

  // 检测日志级别
  detectLevel(text) {
    const upper = text.toUpperCase();
    const m = upper.match(/\b(FATAL|ERROR|ERR|SEVERE|WARN(?:ING)?|INFO|INFORMATION|DEBUG|DBG|TRACE|VERBOSE)\b/);
    if (!m) return null;
    const lv = m[1];
    if (lv === 'FATAL') return 'FATAL';
    if (lv === 'ERROR' || lv === 'ERR' || lv === 'SEVERE') return 'ERROR';
    if (lv === 'WARN' || lv === 'WARNING') return 'WARN';
    if (lv === 'INFO' || lv === 'INFORMATION') return 'INFO';
    if (lv === 'DEBUG' || lv === 'DBG') return 'DEBUG';
    if (lv === 'TRACE' || lv === 'VERBOSE') return 'TRACE';
    return null;
  },

  // 检测日志格式
  detectFormat(line) {
    if (!line || !line.trim()) return null;
    const trimmed = line.trim();
    // JSON — fast path
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try { JSON.parse(trimmed); return 'json'; } catch {}
    }
    // Apache/Nginx
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s/.test(trimmed)) return 'apache';
    // Syslog
    if (/^<\d+>/.test(trimmed)) return 'syslog';
    // Bracket log: [yyyy-MM-dd HH:mm:ss,SSS...
    if (/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(trimmed)) return 'bracketLog';
    // Log4j / generic timestamp
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(trimmed)) return 'log4j';
    return 'plain';
  },

  // 验证用户正则，返回 { ok, regex, error }
  validateUserRegex(pattern) {
    if (!pattern) return { ok: false, regex: null, error: '正则表达式为空' };
    if (pattern.length > 500) return { ok: false, regex: null, error: '正则表达式过长' };
    try {
      const re = new RegExp(pattern);
      return { ok: true, regex: re, error: null };
    } catch (e) {
      return { ok: false, regex: null, error: '正则表达式语法错误: ' + e.message };
    }
  }
};
