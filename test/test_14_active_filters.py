"""test_14_active_filters.py — 活动过滤条（当前生效过滤条件可视化与清除）测试用例

覆盖：
  - DOM 结构（#active-filters / #af-chips / 清除全部按钮）
  - 各过滤条件的 chip 渲染与单独清除
  - 与线程定位的展示联动（原始线程名、快照失效）
  - refresh 自动刷新过滤条
"""

import os

from test_runner import ROOT, TestSuite

suite = TestSuite("活动过滤条")


def _app_js():
    return open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()


@suite.test("DOM 结构：过滤条容器与清除全部")
def _(t, flags):
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    js = _app_js()
    t.check('id="active-filters"' in html, "index.html 含 #active-filters 容器")
    t.check('id="af-chips"' in html, "index.html 含 chips 容器 #af-chips")
    t.check('id="btn-clear-all-filters"' in html, "index.html 含「清除全部」按钮")
    t.check('当前过滤:' in html, "含「当前过滤」标签")
    t.check("getElementById('btn-clear-all-filters')" in js, "app.js 绑定清除全部按钮")
    t.check('clearAllFilters()' in js, "存在 clearAllFilters 方法")


@suite.test("渲染方法：条件收集与显隐")
def _(t, flags):
    js = _app_js()
    t.check('renderActiveFilters()' in js, "存在 renderActiveFilters 方法")
    t.check("getElementById('active-filters')" in js, "渲染读取过滤条容器")
    t.check("box.style.display = 'none'" in js, "无生效条件时隐藏过滤条")
    t.check("box.style.display = 'flex'" in js, "有条件时显示过滤条")
    t.check('_afThreadLabel' in js, "线程条件展示值处理")
    t.check('_truncateLabel' in js, "长文本截断显示")


@suite.test("覆盖全部过滤条件")
def _(t, flags):
    js = _app_js()
    for frag, desc in [
        ('🔍 搜索:', '搜索条件'),
        ('🧵 线程:', '线程条件'),
        ('🔢 PID:', 'PID 条件'),
        ('📦 来源:', '来源条件'),
        ('💬 消息:', '消息条件'),
        ('🎯 方法:', '方法条件'),
        ('📄 文件:', '文件条件'),
        ('⏱ 时间:', '时间范围'),
        ('🚫 级别:', '级别隐藏'),
    ]:
        t.check(frag in js, f"chip 覆盖 {desc}")
    t.check("st.levels[k] === false" in js, "级别条件以未勾选项计算")


@suite.test("单个条件清除")
def _(t, flags):
    js = _app_js()
    t.check("class=\"af-x\"" in js, "chip 内含 ✕ 清除元素")
    t.check("chips.querySelectorAll('.af-x')" in js, "绑定 ✕ 点击事件")
    t.check('it.clear();' in js, "调用对应条件的清除动作")
    t.check('_syncFilterInputsFromState()' in js, "清除后同步过滤栏输入框")
    t.check("'已清除该过滤条件'" in js, "清除单项提示")


@suite.test("与线程定位联动")
def _(t, flags):
    js = _app_js()
    t.check('_threadLocateKey' in js, "线程 chip 使用原始线程名展示")
    t.check('this._threadLocateBackup = null;' in js,
            "手动清除线程条件后撤销快照失效")
    t.check("'已清除全部过滤条件'" in js, "清除全部提示")


@suite.test("refresh 自动刷新过滤条")
def _(t, flags):
    js = _app_js()
    # refresh() 与 setViewData() 内均应刷新
    t.check(js.count('this.renderActiveFilters();') >= 2,
            "refresh 与 setViewData 均调用 renderActiveFilters")


@suite.test("样式")
def _(t, flags):
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    for frag, desc in [
        ('#active-filters', '过滤条容器'),
        ('.af-label', '标签样式'),
        ('.af-chips', 'chips 容器'),
        ('.af-chip', 'chip 样式'),
        ('.af-x', '清除按钮样式'),
        ('.af-clear', '清除全部按钮样式'),
    ]:
        t.check(frag in css, f"css 含 {desc}")
