"""test_12_source_link_v2.py — 源码关联 v2（全入口 + 查看器增强 + 反向索引）测试用例

静态断言覆盖（按 doc/source_code_link_design.md v2 设计）：
  - 网格 source 列可点击链接
  - 调用栈流程图详情项「查看代码」
  - 文件树懒加载 + 过滤框
  - 代码区完整虚拟滚动
  - 跨行块注释状态机高亮
  - 目录导入分片异步
  - 反向索引（仅日志相关文件）
"""

import os
import re

from test_runner import ROOT, TestSuite

suite = TestSuite("源码关联 v2 (Source Link v2)")


@suite.test("网格 source 列可点击链接")
def _(t, flags):
    grid = open(os.path.join(ROOT, 'js', 'grid.js'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    t.check('class="sv-link-source"' in grid, "grid.js 渲染 sv-link-source 链接")
    t.check("SourceLink.parseSource(src).file" in grid or "parseSource(entry.source)" in grid,
            "grid.js 用 parseSource 判断可链接")
    t.check("closest('.sv-link-source')" in grid, "grid.js 行点击委托识别链接")
    t.check('openSource(entry.source)' in grid, "点击链接调用 SourceLink.openSource")
    t.check('.sv-link-source' in css, "css 含 .sv-link-source 链接样式")


@suite.test("调用栈流程图详情项「查看代码」")
def _(t, flags):
    cs = open(os.path.join(ROOT, 'js', 'callstack.js'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    t.check('class="d-src"' in cs, "callstack.js showSegDetail 渲染 .d-src")
    t.check('SourceLink.openSource(e.source)' in cs, "点击 .d-src 调用 openSource")
    t.check("e.stopPropagation()" in cs, ".d-src 点击阻止冒泡（不触发定位日志）")
    t.check('.cs-detail-item .d-src' in css, "css 含 .d-src 样式")


@suite.test("文件树懒加载 + 过滤框")
def _(t, flags):
    sv = open(os.path.join(ROOT, 'js', 'source_viewer.js'), encoding='utf-8').read()
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    for frag, desc in [
        ('_buildDirTree', '目录树结构构建'),
        ('_expandedDirs.has', '按需展开（懒加载）'),
        ('_expandTo(', '打开时展开祖先目录'),
        ('_renderFlat', '过滤结果平铺渲染'),
        ("'sv-tree-search'", '引用过滤输入框'),
        ('sv-tree-empty', '空态提示'),
    ]:
        t.check(frag in sv, f"source_viewer.js 包含 {desc}")
    t.check('id="sv-tree-search"' in html, "index.html 含树过滤框")
    t.check('id="sv-tree-list"' in html, "index.html 含树列表容器")
    t.check('.sv-tree-toolbar' in css, "css 含树 toolbar 样式")


@suite.test("代码区完整虚拟滚动")
def _(t, flags):
    sv = open(os.path.join(ROOT, 'js', 'source_viewer.js'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    t.check('LINE_H: 20' in sv, "固定行高 LINE_H=20")
    t.check("'sv-spacer'" in sv, "使用 spacer 结构")
    t.check('_applyView' in sv, "滚动视口计算 _applyView")
    t.check('requestAnimationFrame' in sv, "滚动经 rAF 节流")
    t.check("_renderLines(first, last)" in sv or '_renderLines(' in sv, "仅渲染可视区行")
    # 旧截断逻辑已移除
    t.check('_omittedBar' not in sv, "已移除 MVP 省略条（_omittedBar）")
    t.check('.sv-spacer' in css, "css 含 spacer")
    t.check('.sv-line { height: 20px' in css or '.sv-line {\n  height: 20px' in css
            or re.search(r'\.sv-line \{\s*height: 20px', css), "css 固定行高 20px")


@suite.test("跨行块注释状态机高亮")
def _(t, flags):
    sv = open(os.path.join(ROOT, 'js', 'source_viewer.js'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    t.check('_scanBlocks' in sv, "预计算每行块注释起始状态")
    t.check('_highlightLine(text, lang, startBlock)' in sv.replace('\n', '')
            or '_highlightLine(line, lang, blockStart)' in sv
            or '_highlightLine(' in sv and 'startBlock' in sv, "高亮函数带块注释起始状态")
    t.check('class="sv-pre"' in sv, "C/C++ 预处理行渲染 .sv-pre")
    t.check('.sv-pre' in css, "css 含 .sv-pre 预处理行样式")


@suite.test("目录导入分片异步")
def _(t, flags):
    sl = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    t.check('DIR_BATCH: 1500' in sl, "分片大小 DIR_BATCH=1500")
    t.check('requestIdleCallback' in sl, "使用 requestIdleCallback 让出主线程")
    t.check("s += this.DIR_BATCH" in sl or 's += this.DIR_BATCH' in sl, "导入分片循环")
    t.check('正在索引项目目录' in sl, "分片进度提示")


@suite.test("反向索引（仅日志相关文件）")
def _(t, flags):
    sl = open(os.path.join(ROOT, 'js', 'source_link.js'), encoding='utf-8').read()
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    app = open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()
    for frag, desc in [
        ('_getLogRefSet', '日志引用集构建'),
        ('_matchesLogRef', '文件命中引用集匹配'),
        ('setOnlyRelated', 'toggle 状态切换'),
        ('invalidateLogRef', '引用集缓存失效'),
        ('回退为全量索引', '无命中自动回退全量'),
        ("'sv-only-related'", '绑定反向索引 checkbox'),
        ('_refMode', '记录反向模式用于展示'),
    ]:
        t.check(frag in sl, f"source_link.js 包含 {desc}")
    t.check('id="sv-only-related"' in html, "index.html 含反向索引 checkbox")
    t.check('.sv-toggle' in css, "css 含 .sv-toggle 样式")
    t.check('SourceLink.invalidateLogRef' in app, "app.js onDataLoaded 重置引用集")
