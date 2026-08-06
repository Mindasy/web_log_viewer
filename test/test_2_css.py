"""test_css.py — CSS 结构测试用例"""

import os
import re

from test_runner import ROOT, TestSuite

suite = TestSuite("CSS 结构验证")


@suite.test("花括号平衡与双主题")
def _(t, flags):
    css_path = os.path.join(ROOT, 'css', 'style.css')
    t.check(os.path.exists(css_path), "css/style.css 存在")
    if not os.path.exists(css_path):
        return

    css = open(css_path, encoding='utf-8').read()
    opens = css.count('{')
    closes = css.count('}')
    t.check(opens == closes, f"花括号平衡: {opens} 开 / {closes} 闭")

    t.check(':root {' in css, "深色主题 :root 变量存在")
    t.check('[data-theme="light"]' in css, "亮色主题变量存在")

    key_selectors = ['#toolbar', '#status-bar', '.grid-row', '.popup-panel',
                     '.about-release-time']
    for sel in key_selectors:
        t.check(sel in css, f"选择器 {sel} 存在")


@suite.test("布局弹性修复 — 视图面包屑不挤掉状态栏")
def _(t, flags):
    """回归：视图功能显示面包屑后，底部状态栏被挤出视口。
    #main-container 改用 flex:1 自适应，而非固定 calc(100vh-100px)。"""
    css_path = os.path.join(ROOT, 'css', 'style.css')
    css = open(css_path, encoding='utf-8').read()

    # body 纵向 flex，让 main-container 自动占据剩余空间
    t.check('display: flex;' in css and 'flex-direction: column;' in css,
            "body 使用纵向 flex 布局")
    # main-container 用 flex:1 + min-height:0 自适应，而不是固定高度
    t.check('calc(100vh - 100px)' not in css,
            "#main-container 不再使用固定 calc(100vh-100px)")
    # 取出 #main-container 规则块验证
    m = re.search(r'#main-container \{(.*?)\}', css, re.S)
    t.check(m is not None, "#main-container 规则存在")
    if m:
        block = m.group(1)
        t.check('flex: 1' in block and 'min-height: 0' in block,
                "#main-container 使用 flex:1 + min-height:0 自适应高度")

    # 固定高度栏均防止 flex 压缩（视口较矮时状态栏不被挤压）
    for sel, desc in [('#toolbar', '工具栏'), ('#filter-bar', '过滤栏'),
                      ('#status-bar', '状态栏'), ('.view-breadcrumb', '视图面包屑')]:
        m = re.search(re.escape(sel) + r' \{(.*?)\}', css, re.S)
        if m:
            t.check('flex-shrink: 0' in m.group(1),
                    f"{desc} ({sel}) 设置了 flex-shrink:0")
        else:
            t.fail(f"缺少 {sel} 规则")
