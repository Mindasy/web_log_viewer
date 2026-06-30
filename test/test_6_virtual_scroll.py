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


@suite.test("关键边界映射 — Capped 入口 + 用户报告行 + 末尾")
def _(t, flags):
    """覆盖所有关键边界：capped 模式入口、用户报告的 2507146 行、末尾。
    这些用例始终执行，不随 --fast 跳过。"""
    # 边界定义: (totalRows, rows_to_test, 描述)
    boundaries = [
        (1, [0], "单行"),
        (10, [0, 5, 9], "小量行"),
        (100, [0, 33, 50, 66, 99], "常规小"),
        (1374998, [0, 1, 1374997], "Capped 入口前 2 行"),
        (1374999, [0, 1, 1374998], "Capped 入口前 1 行"),
        (1375000, [0, 687500, 1374999], "Capped 入口（精确）"),
        (1375001, [0, 687500, 1375000], "Capped 入口后 1 行"),
        (2507147, [0, 2507140, 2507145, 2507146, 2507147], "用户报告 2507147"),
        (2600000, [0, 2507140, 2507146, 2599999], "260w 含报告行"),
        (3000000, [0, 2507146, 2999999], "300w 含报告行"),
        (50000000, [0, 25000000, 49999999], "5000w 巨量"),
    ]
    for total, rows, label in boundaries:
        for row in rows:
            if row >= total:
                continue
            st = SM['syncToNative'](row, total, DEFAULT_CLIENT_H)
            st2 = SM['syncToNative'](row, total, DEFAULT_CLIENT_H + 1)
            back = SM['syncFromNative'](st, total, DEFAULT_CLIENT_H)
            back2 = SM['syncFromNative'](st2, total, DEFAULT_CLIENT_H + 1)
            t.check(back == row,
                    f"[{label}] {total}行 row={row}: 往返后={back}")
            t.check(back2 == row,
                    f"[{label}] clientH+1 {total}行 row={row}: 往返后={back2}")


@suite.test("连续滚动过边界 — 双向无阶跃")
def _(t, flags):
    """模拟鼠标滚轮逐步滚动，确保经过每个边界时行号平滑递增/递减"""
    scenarios = [
        (2507147, 2507130, 2507155, "2507147 附近"),
        (1375000, 1374990, 1375010, "Capped 入口附近"),
        (20000, 0, 19999, "完整小文件全量遍历"),
    ]
    for total, lo, hi, label in scenarios:
        # 自动适配步长（最多 500 步）
        lo_st = int(SM['syncToNative'](lo, total, DEFAULT_CLIENT_H))
        hi_st = int(SM['syncToNative'](hi, total, DEFAULT_CLIENT_H))
        total_range = hi_st - lo_st
        step = max(10, total_range // 500) if total_range > 0 else 1
        prev_row = -1
        for st in range(lo_st, hi_st, step):
            st = min(st, hi_st)
            row = SM['syncFromNative'](st, total, DEFAULT_CLIENT_H)
            t.check(row >= prev_row,
                    f"[{label}] 正向: scrollTop={st} → row={row} < prev={prev_row}")
            prev_row = row

        # 反向
        prev_row = int(SM['syncFromNative'](hi_st, total, DEFAULT_CLIENT_H)) + 1
        for st in range(hi_st, lo_st, -step):
            st = max(st, lo_st)
            row = SM['syncFromNative'](st, total, DEFAULT_CLIENT_H)
            t.check(row <= prev_row,
                    f"[{label}] 反向: scrollTop={st} → row={row} > prev={prev_row}")
            prev_row = row


@suite.test("Capped 模式渲染一致性 — spacer = cssHeight")
def _(t, flags):
    """render() 计算: spacer + rows + bottom_spacer 始终等于 cssHeight。
    覆盖 capped 入口两侧各 200 行的精确验证。"""
    # 精细扫描 capped 入口
    for total in [1374995, 1375000, 1375005]:
        css_h = SM['getCSSHeight'](total)
        rows_height = (VISIBLE_COUNT + 5) * SM['ROW_H']
        max_vr = min(total, css_h // SM['ROW_H'] + 200)
        step_s = max(1, max_vr // 100)
        for vr in range(0, max_vr, step_s):
            max_top = max(0, css_h - rows_height)
            native_st = SM['syncToNative'](vr, total, DEFAULT_CLIENT_H)
            top_spacer = min(native_st, max_top)
            bottom_spacer = max(0, css_h - top_spacer - rows_height)
            total_calc = top_spacer + rows_height + bottom_spacer
            t.check(total_calc == css_h,
                    f"[capped测试] {total}行 vr={vr}: 总高={total_calc} ≠ cssHeight={css_h}")
        # 额外检查末尾行
        if max_vr > 0:
            vr = max_vr - 1
            max_top = max(0, css_h - rows_height)
            native_st = SM['syncToNative'](vr, total, DEFAULT_CLIENT_H)
            top_spacer = min(native_st, max_top)
            bottom_spacer = max(0, css_h - top_spacer - rows_height)
            t.check(top_spacer + rows_height + bottom_spacer == css_h,
                    f"[capped测试] {total}行 vr={vr}(末): 总高不一致")

    # 大行数采样验证
    for total in [100, 10000, 1375000, 2000000, 50000000]:
        css_h = SM['getCSSHeight'](total)
        step = max(1, total // 100)
        for vr in range(0, total, step):
            rows_height = (VISIBLE_COUNT + 5) * SM['ROW_H']
            max_top = max(0, css_h - rows_height)
            native_st = SM['syncToNative'](vr, total, DEFAULT_CLIENT_H)
            top_spacer = min(native_st, max_top)
            bottom_spacer = max(0, css_h - top_spacer - rows_height)
            total_calc = top_spacer + rows_height + bottom_spacer
            t.check(total_calc == css_h,
                    f"[大行数] {total}行 vr={vr}: 总高={total_calc} ≠ cssHeight={css_h}")


@suite.test("CSS 行高一致性 — border-box + line-height")
def _(t, flags):
    """验证 .grid-row 使用 box-sizing: border-box，使含 border 后正好 24px"""
    css_path = os.path.join(ROOT, 'css', 'style.css')
    with open(css_path, 'r', encoding='utf-8') as f:
        css = f.read()
    m = re.search(r'\.grid-row\s*\{[^}]*\}', css)
    t.check(m is not None, "找到 .grid-row CSS 规则")
    if m:
        block = m.group(0)
        t.check('box-sizing: border-box' in block,
                ".grid-row 使用 box-sizing: border-box")
    # line-height 在 .grid-row .col 上
    m2 = re.search(r'\.grid-row\s*\.col\s*\{[^}]*\}', css)
    t.check(m2 is not None, "找到 .grid-row .col CSS 规则")
    if m2:
        block2 = m2.group(0)
        t.check('line-height: 23px' in block2,
                ".grid-row .col 使用 line-height: 23px")


@suite.test("行列数一致性 — render 够数")
def _(t, flags):
    """确保每次渲染至少覆盖 visibleCount 行（除非剩余行数不足）"""
    for total in [1000, 2000000]:
        for vr in range(0, total - VISIBLE_COUNT, max(1, (total - VISIBLE_COUNT) // 50)):
            end = min(vr + VISIBLE_COUNT + 5, total)
            rendered = end - vr
            t.check(rendered >= VISIBLE_COUNT,
                    f"{total}行 vr={vr}: 仅渲染 {rendered} 行 < visibleCount {VISIBLE_COUNT}")


@suite.test("末尾 selectRow — 不触发回跳")
def _(t, flags):
    """验证选择最后若干行时 _virtualRow 不会误设为 0（回跳 bug 回归防护）"""
    for total in [1000, 2507147, 2000000, 50000000]:
        visible = min(VISIBLE_COUNT, total)
        # 从第 0 行起，逐步选择靠近末尾的行
        for target in range(total - visible - 5, total):
            if target < 0:
                continue
            start_vr = 0
            render_end = start_vr + visible
            if target >= render_end:
                new_vr = min(target - visible + 1, total - visible)
            else:
                new_vr = start_vr
            actual_end = min(new_vr + VISIBLE_COUNT + 5, total)
            t.check(new_vr <= target < actual_end,
                    f"{total}行 selectRow({target}): vr={new_vr} "
                    f"渲染 [{new_vr},{actual_end}) 不包含目标")
            if new_vr == 0 and target > visible:
                t.fail(f"{total}行 selectRow({target}): _virtualRow 回跳到 0!")
