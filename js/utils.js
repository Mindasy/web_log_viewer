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

  // 显示 Toast
  showToast(msg, type = '') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
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
    document.querySelectorAll('.popup-panel').forEach(p => (p.style.display = 'none'));
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

  // 解析日期字符串（支持时区）
  parseDate(str) {
    if (!str) return null;

    // Normalize timezone: +800 → +08:00, +0800 → +08:00
    let normalized = str.replace(/^\[|\]$/g, '');
    normalized = normalized.replace(/\s([+-])(\d{1,2})(\d{2})(?=\s*$|$)/, (_, sign, hh, mm) => {
      return ' ' + sign + hh.padStart(2, '0') + ':' + mm;
    });

    // 先尝试原生 Date 解析（支持 ISO 8601 含时区格式）
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;

    // 常见日志格式（含时区）
    const patterns = [
      // ISO 8601 with timezone: 2024-01-15T10:23:45.123+08:00
      /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:[+-]\d{2}:?\d{2})?)/,
      // 带时区偏移（冒号）: 2024-01-15 10:23:45,123 +08:00
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{2}:\d{2})/,
      // 带时区偏移: 2024-01-15 10:23:45,123 +0800
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}\s*[+-]\d{4})/,
      // 带时区偏移（冒号，无毫秒）: 2024-01-15 10:23:45 +08:00
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{2}:\d{2})/,
      // 带时区偏移（无毫秒）: 2024-01-15 10:23:45 +0800
      /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*[+-]\d{4})/,
      // 斜杠格式: 2024/01/15 10:23:45.123
      /(\d{4}\/\d{2}\/\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/,
      // Apache 格式: 15/Jan/2024:10:23:45 +0800
      /(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s*[+-]\d{4})/,
      // Syslog 格式: Jan 15 10:23:45
      /([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/,
      // 仅时间（无日期）: 10:23:45.123
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    ];
    for (const p of patterns) {
      const m = normalized.match(p);
      if (m) {
        const d2 = new Date(m[1]);
        if (!isNaN(d2.getTime())) return d2;
      }
    }
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
    return fmt
      .replace('yyyy', y)
      .replace('MM', M)
      .replace('dd', d)
      .replace('HH', H)
      .replace('mm', m)
      .replace('ss', s)
      .replace('SSS', S);
  },

  // 检测日志级别
  detectLevel(text) {
    const upper = text.toUpperCase();
    if (/\bFATAL\b/.test(upper)) return 'FATAL';
    if (/\bERROR\b/.test(upper) || /\bERR\b/.test(upper) || /\bSEVERE\b/.test(upper)) return 'ERROR';
    if (/\bWARN(?:ING)?\b/.test(upper)) return 'WARN';
    if (/\bINFO\b/.test(upper) || /\bINFORMATION\b/.test(upper)) return 'INFO';
    if (/\bDEBUG\b/.test(upper) || /\bDBG\b/.test(upper)) return 'DEBUG';
    if (/\bTRACE\b/.test(upper) || /\bVERBOSE\b/.test(upper)) return 'TRACE';
    return null;
  },

  // 检测日志格式
  detectFormat(line) {
    if (!line || !line.trim()) return null;
    // JSON
    if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
      try { JSON.parse(line); return 'json'; } catch {}
    }
    // Apache/Nginx
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s/.test(line)) return 'apache';
    // Syslog
    if (/^<\d+>/.test(line)) return 'syslog';
    // Bracket log: [2025-01-01 01:01:01.000 +800][LEVEL]...
    if (/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line)) return 'bracketLog';
    // Log4j pattern
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line)) return 'log4j';
    // Generic timestamp
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(line)) return 'generic';
    return 'plain';
  }
};
