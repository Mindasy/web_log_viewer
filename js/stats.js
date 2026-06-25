// stats.js - 统计信息

const LogStats = {
  calculate(entries) {
    const stats = {
      total: entries.length,
      levels: {},
      timeRange: { start: null, end: null },
      topThreads: [],
      topSources: [],
      topMessages: [],
      errors: [],
      fileInfo: LogParser.fileInfo
    };

    const threadCount = {};
    const sourceCount = {};
    const messageCount = {};

    for (const entry of entries) {
      // 级别统计
      const level = entry.level || 'UNKNOWN';
      stats.levels[level] = (stats.levels[level] || 0) + 1;

      // 时间范围
      if (entry.date) {
        if (!stats.timeRange.start || entry.date < stats.timeRange.start) {
          stats.timeRange.start = entry.date;
        }
        if (!stats.timeRange.end || entry.date > stats.timeRange.end) {
          stats.timeRange.end = entry.date;
        }
      }

      // 线程统计
      if (entry.thread) {
        threadCount[entry.thread] = (threadCount[entry.thread] || 0) + 1;
      }

      // 来源统计
      if (entry.source) {
        sourceCount[entry.source] = (sourceCount[entry.source] || 0) + 1;
      }

      // 消息模式统计（简化消息）
      const simplified = entry.message.replace(/\d+/g, '#').replace(/0x[0-9a-fA-F]+/g, '0x#').substring(0, 80);
      messageCount[simplified] = (messageCount[simplified] || 0) + 1;

      // 收集错误
      if (level === 'ERROR' || level === 'FATAL') {
        stats.errors.push(entry);
      }
    }

    // 排序 top N
    stats.topThreads = this.sortAndSlice(threadCount, 10);
    stats.topSources = this.sortAndSlice(sourceCount, 10);
    stats.topMessages = this.sortAndSlice(messageCount, 10);

    return stats;
  },

  sortAndSlice(countMap, n) {
    return Object.entries(countMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => ({ key, count }));
  },

  render(stats) {
    this.renderLevelChart(stats);
    this.renderTimeChart(stats);
    this.renderSummary(stats);
  },

  renderLevelChart(stats) {
    const container = document.getElementById('stats-level-chart');
    const total = stats.total || 1;
    const levelColors = {
      FATAL: '#eba0ac', ERROR: '#f38ba8', WARN: '#f9e2af',
      INFO: '#89dceb', DEBUG: '#94e2d5', TRACE: '#b4befe', UNKNOWN: '#6c7086'
    };
    const order = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'UNKNOWN'];

    let html = '';
    for (const level of order) {
      const count = stats.levels[level] || 0;
      if (count === 0) continue;
      const pct = ((count / total) * 100).toFixed(1);
      html += `
        <div class="stats-bar">
          <span class="stats-bar-label" style="color:${levelColors[level]}">${level}</span>
          <div class="stats-bar-track">
            <div class="stats-bar-fill" style="width:${pct}%;background:${levelColors[level]}"></div>
          </div>
          <span class="stats-bar-count">${Utils.formatNumber(count)}</span>
          <span class="stats-bar-pct">${pct}%</span>
        </div>
      `;
    }
    container.innerHTML = html || '<div style="color:var(--text-muted)">无数据</div>';
  },

  renderTimeChart(stats) {
    const container = document.getElementById('stats-time-chart');
    if (!stats.timeRange.start || !stats.timeRange.end) {
      container.innerHTML = '<div style="color:var(--text-muted)">无时间数据</div>';
      return;
    }

    const duration = stats.timeRange.end.getTime() - stats.timeRange.start.getTime();
    const durationStr = this.formatDuration(duration);

    container.innerHTML = `
      <div style="font-size:11px;color:var(--text-secondary);line-height:1.8">
        <div>开始时间: ${Utils.formatDate(stats.timeRange.start)}</div>
        <div>结束时间: ${Utils.formatDate(stats.timeRange.end)}</div>
        <div>时间跨度: ${durationStr}</div>
        <div>平均速率: ${duration > 0 ? (stats.total / (duration / 1000)).toFixed(1) : 'N/A'} 条/秒</div>
      </div>
    `;
  },

  renderSummary(stats) {
    const container = document.getElementById('stats-summary');
    let html = `
      <div style="line-height:1.8">
        <div><strong>总条目:</strong> ${Utils.formatNumber(stats.total)}</div>
        <div><strong>错误数:</strong> ${Utils.formatNumber(stats.errors.length)}</div>
    `;

    if (stats.fileInfo) {
      html += `
        <div><strong>文件名:</strong> ${stats.fileInfo.name}</div>
        <div><strong>文件大小:</strong> ${Utils.formatBytes(stats.fileInfo.size)}</div>
      `;
    }

    if (stats.topThreads.length > 0) {
      html += `<div style="margin-top:8px"><strong>Top 线程:</strong></div>`;
      stats.topThreads.slice(0, 5).forEach(t => {
        html += `<div style="margin-left:8px;color:var(--text-muted)">${t.key}: ${Utils.formatNumber(t.count)}</div>`;
      });
    }

    if (stats.topSources.length > 0) {
      html += `<div style="margin-top:8px"><strong>Top 来源:</strong></div>`;
      stats.topSources.slice(0, 5).forEach(s => {
        html += `<div style="margin-left:8px;color:var(--text-muted)">${s.key}: ${Utils.formatNumber(s.count)}</div>`;
      });
    }

    html += '</div>';
    container.innerHTML = html;
  },

  formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) return (ms / 60000).toFixed(1) + 'min';
    if (ms < 86400000) return (ms / 3600000).toFixed(1) + 'h';
    return (ms / 86400000).toFixed(1) + 'd';
  }
};
