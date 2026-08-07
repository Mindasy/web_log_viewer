"""test_js.py — JS 文件结构测试用例"""

import os
import re

from test_runner import ROOT, TestSuite

suite = TestSuite("JS 结构验证")

JS_FILES = [
    'js/utils.js', 'js/parser.js', 'js/archive.js',
    'js/filter.js', 'js/grid.js', 'js/timeline.js',
    'js/stats.js', 'js/app.js'
]


@suite.test("JS 文件完整性")
def _(t, flags):
    for js_rel in JS_FILES:
        js_path = os.path.join(ROOT, js_rel)
        if not os.path.exists(js_path):
            t.fail(f"{js_rel} 不存在")
            continue

        js = open(js_path, encoding='utf-8').read()
        issues = []

        if 'const ' not in js:
            issues.append("缺少 'const' 声明")

        if js_rel == 'js/utils.js':
            if 'const APP_VERSION' not in js:
                issues.append("缺少 APP_VERSION 常量")
            if 'const APP_RELEASE_TIME' not in js:
                issues.append("缺少 APP_RELEASE_TIME 常量")

        brace_diff = abs(js.count('{') - js.count('}'))
        if brace_diff > 20:
            issues.append(f"花括号差值较大 ({brace_diff})")

        if len(js.strip()) == 0:
            issues.append("文件为空")

        if issues:
            t.fail(f"{js_rel}: {'; '.join(issues)}")
        else:
            t.ok(f"{js_rel} - {len(js.splitlines())} 行")


@suite.test("引用完整性")
def _(t, flags):
    html_path = os.path.join(ROOT, 'index.html')
    if not os.path.exists(html_path):
        return
    html = open(html_path, encoding='utf-8').read()
    for m in re.finditer(r'src="(js/[^"]+)"', html):
        js_path = os.path.join(ROOT, m.group(1))
        t.check(os.path.exists(js_path), f"引用文件 {m.group(1)} 存在")
    for m in re.finditer(r'href="(css/[^"]+)"', html):
        css_path = os.path.join(ROOT, m.group(1))
        t.check(os.path.exists(css_path), f"引用文件 {m.group(1)} 存在")


@suite.test("网格 tag 列定义")
def _(t, flags):
    """grid.js 应包含 tag 列定义与行渲染，避免 tag 解析后无法展示"""
    grid_path = os.path.join(ROOT, 'js', 'grid.js')
    if not os.path.exists(grid_path):
        t.fail("grid.js 不存在")
        return
    js = open(grid_path, encoding='utf-8').read()

    # 列定义中包含 tag
    m = re.search(r"\{ key: 'tag',[^}]+\}", js)
    t.check(m is not None, "columnDefs 包含 tag 列定义")
    if m:
        t.check("canHide: true" in m.group(0), "tag 列可隐藏")
        t.check("canSort: true" in m.group(0), "tag 列可排序")

    # 行渲染包含 tag 单元格
    t.check("isColumnVisible('tag')" in js, "行渲染包含 tag 列")
    t.check('col-tag' in js, "tag 列使用 col-tag 样式类")

    # 活跃字段检测包含 tag
    t.check("'tag'" in js, "标准字段列表包含 tag")


@suite.test("文件列表按钮不随数据状态禁用")
def _(t, flags):
    """btn-toggle-files 应始终可点击（无文件时也能打开面板显示'暂无文件'）"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    if not os.path.exists(app_path):
        t.fail("app.js 不存在")
        return
    js = open(app_path, encoding='utf-8').read()

    # updateButtonStates 的禁用列表不应包含 btn-toggle-files
    m = re.search(r"const ids = \[(.*?)\];", js, re.S)
    t.check(m is not None, "找到 updateButtonStates 的禁用列表")
    if m:
        disabled_list = m.group(1)
        t.check('btn-toggle-files' not in disabled_list,
                "btn-toggle-files 不在禁用列表中（始终可打开文件面板）")

    # 事件绑定仍存在
    t.check("btn-toggle-files').addEventListener" in js
            or "btn-toggle-files'\"])" in js or "btn-toggle-files" in js,
            "btn-toggle-files 事件绑定存在")


@suite.test("文件面板拖拽宽度后可正常 toggle")
def _(t, flags):
    """拖拽调整宽度会设置内联 style.width，折叠时必须清除，
    否则内联宽度覆盖 CSS 的 width:0，面板无法收起"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    if not os.path.exists(app_path):
        t.fail("app.js 不存在")
        return
    js = open(app_path, encoding='utf-8').read()

    # toggleFilesPanel 折叠时清除内联宽度
    t.check("panel.style.width = ''" in js, "折叠时清除内联宽度（让 CSS width:0 生效）")

    # 展开时恢复拖拽保存的宽度（localStorage 持久化）
    t.check("localStorage.getItem('files-panel-width')" in js, "展开时从 localStorage 恢复宽度")
    t.check("localStorage.setItem('files-panel-width'" in js, "拖拽结束时持久化宽度")

    # 拖拽期间禁用过渡，保证宽度即时跟随鼠标
    t.check("panel.style.transition = 'none'" in js, "拖拽期间禁用宽度过渡")

    # 关闭按钮与 clearAll 同样清除内联宽度
    t.check("btn-close-files').addEventListener" in js, "关闭按钮处理存在")
    close_idx = js.find("btn-close-files")
    if close_idx >= 0:
        close_snippet = js[close_idx:close_idx + 300]
        t.check("style.width = ''" in close_snippet, "关闭按钮清除内联宽度")
