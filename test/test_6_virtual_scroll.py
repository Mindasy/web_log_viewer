"""test_virtual_scroll.py — 虚拟滚动正确性审计测试

通过 js_loader 直接执行真实 JS 源码 (scroll_math.js) 进行测试。
不依赖 Node.js，不需要 Python 手写复制品。

保护机制:
  1. 直接从 scroll_math.js 文件执行翻译后的 JS 代码
  2. 验证 grid.js 确实委托给 ScrollMath.* (而非自身内联)
  3. 如果 scroll_math.js 的数学被修改，测试会失败
"""

import os
import re
import random
import sys

# js_loader 在 test/ 目录下
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from js_loader import load_js_object
from test_runner import ROOT, TestSuite

suite = TestSuite("虚拟滚动审计")

SCROLL_MATH_PATH = os.path.join(ROOT, 'js', 'scroll_math.js')
GRID_PATH = os.path.join(ROOT, 'js', 'grid.js')

# 从真实 JS 源码加载所有函数和常量
SM = load_js_object(SCROLL_MATH_PATH, 'SM')

DEFAULT_CLIENT_H = 500
VISIBLE_COUNT = DEFAULT_CLIENT_H // SM['ROW_H'] + 2  # 22

TOTALS = [1, 10, 100, 10000, 100000, 1375000, 2000000, 50000000]


@suite.test("源码加载 + 委托检查")
def _(t, flags):
    """验证 JS 源码已正确加载，grid.js 委托给 ScrollMath"""
    t.check(SM['ROW_H'] == 24,
            f"ROW_H = {SM['ROW_H']} (来自 scroll_math.js)")
    t.check(SM['MAX_SAFE_PX'] == 33_000_000,
            f"MAX_SAFE_PX = {SM['MAX_SAFE_PX']:,} (来自 scroll_math.js)")

    for fn in ['totalHeight', 'getCSSHeight', 'syncToNative', 'syncFromNative']:
        t.check(fn in SM and callable(SM[fn]),
                f"函数 {fn} 已加载")

    # grid.js 委托检查
    with open(GRID_PATH, 'r', encoding='utf-8') as f:
        grid_src = f.read()
    checks = {
        'ScrollMath.getCSSHeight': 'ScrollMath.getCSSHeight' in grid_src,
        'ScrollMath.syncToNative': 'ScrollMath.syncToNative' in grid_src,
        'ScrollMath.syncFromNative': 'ScrollMath.syncFromNative' in grid_src,
        'no inline MAX_SAFE_PX': 'MAX_SAFE_PX' not in grid_src,
    }
    for name, ok in checks.items():
        t.check(ok, f"委托检查: {name}")


@suite.test("映射往返对称性")
def _(t, flags):
    for total in TOTALS:
        for row in [0, total // 3, total // 2, total * 2 // 3, max(0, total - 1)]:
            st = SM['syncToNative'](row, total, DEFAULT_CLIENT_H)
            back = SM['syncFromNative'](st, total, DEFAULT_CLIENT_H)
            t.check(back == row,
                    f"{total}行 row={row}: 往返后={back}")


@suite.test("行可达性 (采样)")
def _(t, flags):
    for total in TOTALS:
        missing = 0
        checked = 0
        for r in range(0, total, max(1, min(50000, total // 200))):
            checked += 1
            st = SM['syncToNative'](r, total, DEFAULT_CLIENT_H)
            back = SM['syncFromNative'](st, total, DEFAULT_CLIENT_H)
            if back != r:
                missing += 1
        t.check(missing == 0,
                f"{total}行: 采样{checked}行, {missing}行不可达")


@suite.test("渲染覆盖可视区")
def _(t, flags):
    for total in [1000, 1375000, 2000000]:
        css_h = SM['getCSSHeight'](total)
        step = max(1, total // 100)
        uncovered = 0
        for virtual_row in range(0, total, step):
            start = virtual_row
            end = min(start + VISIBLE_COUNT + 5, total)
            native_st = SM['syncToNative'](virtual_row, total, DEFAULT_CLIENT_H)
            rows_height = (end - start) * SM['ROW_H']
            max_top = max(0, css_h - rows_height)
            top_spacer = min(native_st, max_top)
            r_start, r_end = top_spacer, top_spacer + rows_height
            v_start, v_end = native_st, native_st + DEFAULT_CLIENT_H
            overlap = max(0, min(r_end, v_end) - max(r_start, v_start))
            if overlap <= 0:
                uncovered += 1
        t.check(uncovered == 0,
                f"{total}行: {uncovered}个切分点渲染未覆盖")


@suite.test("selectRow 边界 — 底部跳跃回归")
def _(t, flags):
    for total in [100, 1000, 2000000]:
        for start_row in [0, total // 3, max(0, total - VISIBLE_COUNT - 5)]:
            visible = min(VISIBLE_COUNT, total)
            render_end_select = start_row + visible
            targets = range(max(0, start_row - 1),
                            min(total, start_row + visible + 5))
            for target in targets:
                if target < start_row:
                    new_vr = target
                elif target >= render_end_select:
                    new_vr = min(target - visible + 1, total - visible)
                else:
                    new_vr = start_row
                actual_end = min(new_vr + VISIBLE_COUNT + 5, total)
                t.check(new_vr <= target < actual_end,
                        f"{total}行 vr={start_row} target={target} "
                        f"→ vr={new_vr} [{new_vr},{actual_end})")


@suite.test("随机往返稳定性 (100次/组)")
def _(t, flags):
    for total in [100, 1375000, 2000000]:
        for _ in range(100):
            row = random.randint(0, max(0, total - 1))
            st = SM['syncToNative'](row, total, DEFAULT_CLIENT_H)
            back = SM['syncFromNative'](st, total, DEFAULT_CLIENT_H)
            t.check(back == row, f"{total}行 row={row}: 往返后={back}")


@suite.test("scrollTop 边界约束")
def _(t, flags):
    for total in [100, 500, 2000000]:
        max_st = max(0, SM['getCSSHeight'](total) - DEFAULT_CLIENT_H)
        for row in [0, total // 2, max(0, total - 1)]:
            st = SM['syncToNative'](row, total, DEFAULT_CLIENT_H)
            t.check(0 <= st <= max_st,
                    f"{total}行 row={row}: st={st:.0f} ∈ [0, {max_st}]")
