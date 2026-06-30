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
