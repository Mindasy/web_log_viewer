"""test_html.py — HTML 结构测试用例"""

import os
import re

from test_runner import ROOT, TestSuite

suite = TestSuite("HTML 结构验证")


@suite.test("标签闭合与关键元素")
def _(t, flags):
    html_path = os.path.join(ROOT, 'index.html')
    t.check(os.path.exists(html_path), "index.html 存在")
    if not os.path.exists(html_path):
        return

    html = open(html_path, encoding='utf-8').read()

    tags_to_check = ['div', 'span', 'table', 'tr', 'td', 'button',
                     'label', 'input', 'select', 'option', 'textarea',
                     'ul', 'li', 'a', 'p', 'h1', 'h2', 'h3', 'pre',
                     'form', 'thead', 'tbody']
    self_closing = ['input', 'br', 'hr', 'img', 'meta', 'link']
    all_ok = True
    for tag in tags_to_check:
        opens = len(re.findall(rf'<{tag}[\s>]', html))
        closes = len(re.findall(rf'</{tag}>', html))
        if tag in self_closing:
            if opens == 0:
                continue
            t.check(closes <= opens, f"<{tag}> 自闭合标签未强制闭合")
        else:
            if opens != closes:
                all_ok = False
                t.fail(f"<{tag}>: {opens} 开 / {closes} 闭 不匹配")

    if all_ok:
        t.ok("所有标签闭合正确")

    key_ids = ['toolbar', 'filter-bar', 'log-panel', 'grid-header',
               'grid-body', 'status-bar', 'file-input', 'btn-open']
    for eid in key_ids:
        t.check(f'id="{eid}"' in html, f"关键元素 #{eid} 存在")
