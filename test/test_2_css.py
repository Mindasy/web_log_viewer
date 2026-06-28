"""test_css.py — CSS 结构测试用例"""

import os

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

    key_selectors = ['#toolbar', '#status-bar', '.grid-row', '.popup-panel']
    for sel in key_selectors:
        t.check(sel in css, f"选择器 {sel} 存在")
