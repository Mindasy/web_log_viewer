/**
 * scroll_math.js — 虚拟滚动核心映射函数
 *
 * 从 grid.js 提取的纯函数，独立测试。
 * grid.js 中的实现与此保持一致（无功能差异）。
 */

// 与 grid.js 一致的常量
const SM = {
  ROW_H: 24,
  MAX_SAFE_PX: 33_000_000,

  totalHeight(totalRows) {
    return totalRows * this.ROW_H;
  },

  getCSSHeight(totalRows) {
    return Math.min(this.totalHeight(totalRows), this.MAX_SAFE_PX);
  },

  // _syncNativeScroll (合成滚动条 → 原生 scrollTop)
  syncToNative(virtualRow, totalRows, clientH) {
    const cssH = this.getCSSHeight(totalRows);
    const range = Math.max(1, cssH - clientH);
    if (totalRows > 1) {
      return Math.min((virtualRow / (totalRows - 1)) * range, range);
    }
    return 0;
  },

  // _syncFromNativeScroll (原生 scrollTop → 合成滚动条)
  syncFromNative(nativeSt, totalRows, clientH) {
    const cssH = this.getCSSHeight(totalRows);
    const range = Math.max(1, cssH - clientH);
    const frac = Math.min(1, Math.max(0, nativeSt / range));
    return Math.round(frac * (totalRows - 1));
  },
};

// 浏览器全局
if (typeof window !== 'undefined') {
  window.ScrollMath = SM;
}
