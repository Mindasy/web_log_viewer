"""test_8_thread_timeline.py — PID提取、线程时间线、视图管理器 测试用例"""

import os
import re
import subprocess
import sys

from test_runner import ROOT, TestSuite

suite = TestSuite("线程时间线 & 视图管理")


# ===== PID 智能提取 =====

@suite.test("PID/TID 智能提取模式")
def _(t, flags):
    """验证 parser.js 中的 PID_TID_PATTERNS 和 _extractPidTid"""
    parser_path = os.path.join(ROOT, 'js', 'parser.js')
    js = open(parser_path, encoding='utf-8').read()

    # 检查 PID_TID_PATTERNS 定义
    if 'PID_TID_PATTERNS' not in js:
        t.fail("缺少 PID_TID_PATTERNS 定义")
        return

    # 检查 _extractPidTid 方法
    if '_extractPidTid' not in js:
        t.fail("缺少 _extractPidTid 方法")
        return

    t.ok("PID_TID_PATTERNS 和 _extractPidTid 已定义")

    # 提取 PID_TID_PATTERNS 数组内容
    # 找到 PID_TID_PATTERNS 的位置
    patterns_start = js.find('PID_TID_PATTERNS:')
    if patterns_start < 0:
        t.fail("无法定位 PID_TID_PATTERNS")
        return

    # 从 PID_TID_PATTERNS 开始查找，计数 regex: 出现次数
    # 找到下一个顶层属性/方法定义作为结束标记
    after_patterns = js[patterns_start:]
    # 统计该区域内的 regex: 数量
    pattern_count = 0
    for line in after_patterns.split('\n'):
        if 'regex:' in line and ('/' in line):
            pattern_count += 1
        if pattern_count > 0 and '],' in line and 'regex:' not in line:
            break  # 数组结束
    if pattern_count < 4:
        t.fail(f"PID_TID_PATTERNS 模式数量不足: {pattern_count} (期望 >= 4)")
    else:
        t.ok(f"PID_TID_PATTERNS 包含 {pattern_count} 个模式")

    # 验证关键模式存在
    patterns_section = after_patterns[:after_patterns.find('],') + 2] if '],' in after_patterns else after_patterns[:500]
    checks = {
        r"field: 'pid'": 'pid 字段模式',
        r"field: 'tid'": 'tid 字段模式',
        r'threadId': 'threadId 模式',
    }
    for pattern_re, desc in checks.items():
        if re.search(pattern_re, patterns_section):
            t.ok(f"模式存在: {desc}")
        else:
            t.fail(f"缺少模式: {desc}")


@suite.test("PID 提取调用点完整性")
def _(t, flags):
    """验证 _extractPidTid 在三个解析函数中均被调用"""
    parser_path = os.path.join(ROOT, 'js', 'parser.js')
    js = open(parser_path, encoding='utf-8').read()

    # 统计 _extractPidTid 调用次数
    calls = js.count('this._extractPidTid')
    if calls >= 3:
        t.ok(f"_extractPidTid 调用 {calls} 次 (期望 >= 3)")
    else:
        t.fail(f"_extractPidTid 调用次数不足: {calls} (期望 >= 3)")

    # 验证每个调用点都有正确的上下文
    # 1. createRegexParser 返回前
    if 'extractPidTid(line);\n      if (!entry.pid)' in js:
        t.ok("createRegexParser 中调用正确")
    else:
        t.fail("createRegexParser 缺少 _extractPidTid 调用")

    # 2. genericParse 返回前
    if 'extractPidTid(line);\n    if (!entry.pid)' in js:
        t.ok("genericParse 中调用正确")
    else:
        t.fail("genericParse 缺少 _extractPidTid 调用")

    # 3. parseJsonLine 返回前
    if 'extractPidTid(line);\n      if (!entry.pid)' in js:
        t.ok("parseJsonLine 中调用正确")
    else:
        t.fail("parseJsonLine 缺少 _extractPidTid 调用")


# ===== PID 过滤器 =====

@suite.test("PID 过滤器状态和逻辑")
def _(t, flags):
    """验证 filter.js 中的 pidFilter 状态和 apply 逻辑"""
    filter_path = os.path.join(ROOT, 'js', 'filter.js')
    js = open(filter_path, encoding='utf-8').read()

    # 检查 pidFilter 字段
    if 'pidFilter:' in js:
        t.ok("filter.js 包含 pidFilter 状态字段")
    else:
        t.fail("filter.js 缺少 pidFilter 状态字段")

    # 检查 apply 中的 PID 过滤逻辑
    if 'pidFilter' in js and 'pidSet' in js:
        t.ok("apply() 中包含 PID 过滤逻辑")
    else:
        t.fail("apply() 缺少 PID 过滤逻辑")

    # 检查逗号分隔多个 PID 的支持
    if "split(',')" in js:
        t.ok("支持逗号分隔多个 PID")


# ===== HTML 元素 =====

@suite.test("PID 过滤 UI 元素")
def _(t, flags):
    """验证 HTML 中的 PID 过滤相关元素"""
    html_path = os.path.join(ROOT, 'index.html')
    html = open(html_path, encoding='utf-8').read()

    # PID 过滤输入框
    if 'id="filter-pid"' in html:
        t.ok("filter-pid 输入框存在")
    else:
        t.fail("缺少 filter-pid 输入框")

    # 保存视图按钮
    if 'id="btn-save-view"' in html:
        t.ok("btn-save-view 按钮存在")
    else:
        t.fail("缺少 btn-save-view 按钮")

    # 视图面包屑
    if 'id="view-breadcrumb"' in html:
        t.ok("view-breadcrumb 面包屑元素存在")
    else:
        t.fail("缺少 view-breadcrumb 面包屑元素")

    # 时间线模式切换
    if 'timeline-mode-btn' in html:
        t.ok("时间线模式切换按钮存在")
    else:
        t.fail("缺少 timeline-mode-btn 按钮")

    # PID 选择器
    if 'id="timeline-pid-select"' in html:
        t.ok("timeline-pid-select 选择器存在")
    else:
        t.fail("缺少 timeline-pid-select 选择器")

    # 线程搜索
    if 'id="timeline-thread-search"' in html:
        t.ok("timeline-thread-search 输入框存在")
    else:
        t.fail("缺少 timeline-thread-search 输入框")

    # 线程详情：返回按钮
    if 'id="btn-timeline-back"' in html:
        t.ok("btn-timeline-back 返回按钮存在")
    else:
        t.fail("缺少 btn-timeline-back 返回按钮")

    # 线程详情：详情标签
    if 'id="timeline-detail-label"' in html:
        t.ok("timeline-detail-label 详情标签存在")
    else:
        t.fail("缺少 timeline-detail-label 详情标签")

    # 线程详情：方法搜索
    if 'id="timeline-method-search"' in html:
        t.ok("timeline-method-search 方法搜索框存在")
    else:
        t.fail("缺少 timeline-method-search 方法搜索框")

    # issue #55：方法排序切换按钮
    if 'id="btn-timeline-method-sort"' in html:
        t.ok("btn-timeline-method-sort 排序切换按钮存在")
    else:
        t.fail("缺少 btn-timeline-method-sort 排序按钮")


# ===== JS 文件完整性 =====

@suite.test("新增 JS 文件完整性")
def _(t, flags):
    """验证新增 JS 文件存在且结构完整"""
    new_files = [
        ('js/thread_timeline.js', 'ThreadTimeline'),
        ('js/view_manager.js', 'ViewManager'),
        ('js/callstack.js', 'CallStack'),
    ]

    for rel, obj_name in new_files:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            t.fail(f"{rel} 不存在")
            continue

        js = open(path, encoding='utf-8').read()
        issues = []

        if 'const ' not in js:
            issues.append("缺少 'const' 声明")

        if obj_name not in js:
            issues.append(f"缺少 {obj_name} 对象定义")

        brace_diff = abs(js.count('{') - js.count('}'))
        if brace_diff > 10:
            issues.append(f"花括号差值较大 ({brace_diff})")

        if len(js.strip()) == 0:
            issues.append("文件为空")

        if issues:
            t.fail(f"{rel}: {'; '.join(issues)}")
        else:
            t.ok(f"{rel} - {len(js.splitlines())} 行")


# ===== ThreadTimeline 结构验证 =====

@suite.test("ThreadTimeline 模块结构")
def _(t, flags):
    """验证 ThreadTimeline 模块的关键方法"""
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    required = [
        ('init', '初始化方法'),
        ('show', '显示方法'),
        ('_groupByThread', '线程分组'),
        ('minTime', '时间范围计算'),
        ('_precomputePositions', '位置预计算'),
        ('_filterThreads', '线程过滤'),
        ('_draw', '绘制调度'),
        ('_drawNow', '实际绘制'),
        ('_drawSummary', '摘要栏绘制'),
        ('_drawGrid', '网格绘制'),
        ('_drawItem', '统一泳道绘制'),
        ('_drawDensity', '密度模式绘制'),
        ('_drawTimeAxis', '时间轴绘制'),
        ('_findEntryAt', '点击检测'),
        ('LEVEL_COLORS', '级别颜色映射'),
        ('_hoveredThreadIdx', 'hover 线程高亮'),
        ('fitToData', '适应数据'),
        ('zoomIn', '放大'),
        ('zoomOut', '缩小'),
        ('_populatePidSelect', 'PID 下拉填充'),
        ('_collectPids', 'PID 收集'),
        ('resize', '尺寸调整'),
        ('openThreadDetail', '打开线程详情'),
        ('closeThreadDetail', '关闭线程详情'),
        ('_extractMethod', '方法名称提取'),
        ('_groupByMethod', '方法分组'),
        ('_filterDetailMethods', '方法过滤'),
        ('_drawScrollbar', '滚动条绘制'),
        ('_clampScrollY', '垂直滚动边界'),
        ('_getContentHeight', '内容高度计算'),
        ('_getViewportH', '视口高度计算'),
        ('scrollY', '垂直滚动偏移'),
        ('_detailThread', '详情线程状态'),
        ('_detailMethods', '详情方法列表'),
    ]

    for method_name, desc in required:
        if method_name in js:
            t.ok(f"方法存在: {desc}")
        else:
            t.fail(f"缺少方法: {desc} ({method_name})")

    # 验证线程分组键回退逻辑
    if 'e.thread || e.tid || \'unknown\'' in js or 'e.thread || e.tid' in js:
        t.ok("线程分组键使用 thread > tid > unknown 回退")
    else:
        t.fail("线程分组键缺少回退逻辑")

    # 验证 interact 事件
    for event, desc in [
        ('mousedown', '拖拽'),
        ('mousemove', 'hover/拖拽'),
        ('mouseup', '释放拖拽'),
        ('mouseleave', '离开面板'),
        ('wheel', '滚轮缩放'),
        ('click', '点击跳转'),
    ]:
        if f"'{event}'" in js or f'"{event}"' in js:
            t.ok(f"事件绑定: {desc}")
        else:
            t.fail(f"缺少事件绑定: {desc}")


# ===== ViewManager 结构验证 =====

@suite.test("ViewManager 模块结构")
def _(t, flags):
    """验证 ViewManager 模块的关键方法"""
    js_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(js_path, encoding='utf-8').read()

    required = [
        ('pushView', '创建视图'),
        ('popView', '回退视图'),
        ('gotoView', '跳转视图'),
        ('getCurrentEntries', '获取当前数据'),
        ('isInView', '视图模式判断'),
        ('searchInView', '视图内搜索'),
        ('renderBreadcrumb', '渲染面包屑'),
        ('clear', '清除所有视图'),
        ('MAX_DEPTH', '最大深度限制'),
    ]

    for method_name, desc in required:
        if method_name in js:
            t.ok(f"方法存在: {desc}")
        else:
            t.fail(f"缺少方法: {desc} ({method_name})")

    # 验证视图栈数据结构
    if 'stack:' in js and 'currentIndex:' in js:
        t.ok("视图栈数据结构完整 (stack + currentIndex)")
    else:
        t.fail("视图栈数据结构不完整")

    # 验证深度限制
    if 'MAX_DEPTH' in js:
        t.ok("视图深度限制已定义")
    else:
        t.fail("缺少视图深度限制")


# ===== CSS 验证 =====

@suite.test("新增 CSS 样式规则")
def _(t, flags):
    """验证 CSS 中新增的样式规则"""
    css_path = os.path.join(ROOT, 'css', 'style.css')
    css = open(css_path, encoding='utf-8').read()

    selectors = [
        ('.view-breadcrumb', '视图面包屑'),
        ('.vb-crumb', '面包屑项'),
        ('.vb-crumb.active', '面包屑激活态'),
        ('.vb-sep', '面包屑分隔符'),
        ('.timeline-mode-tabs', '模式切换标签'),
        ('.timeline-mode-btn', '模式按钮'),
        ('.timeline-mode-btn.active', '模式激活态'),
        ('.timeline-pid-select', 'PID 选择器'),
        ('#timeline-thread-search', '线程搜索框'),
        ('#btn-save-view', '保存视图按钮'),
        ('#btn-timeline-back', '返回按钮'),
        ('#timeline-detail-label', '详情标签'),
        ('#timeline-method-search', '方法搜索框'),
    ]

    for selector, desc in selectors:
        if selector in css:
            t.ok(f"CSS 规则存在: {desc}")
        else:
            t.fail(f"缺少 CSS 规则: {desc} ({selector})")


# ===== app.js 集成验证 =====

@suite.test("app.js 视图集成")
def _(t, flags):
    """验证 app.js 中的视图管理器集成"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    checks = [
        ('ViewManager.clear()', 'onDataLoaded 中清除视图'),
        ('ViewManager.isInView()', 'refresh 中检查视图模式'),
        ('ViewManager.getCurrentEntries()', '获取视图数据'),
        ('setViewData', 'setViewData 方法'),
        ('saveCurrentSearchAsView', '保存视图方法'),
        ('_updateSaveViewButton', '更新保存按钮状态'),
        ('ThreadTimeline.init()', 'ThreadTimeline 初始化'),
        ('ThreadTimeline._populatePidSelect()', '填充 PID 下拉'),
        ('ThreadTimeline._refreshFromPidSelect()', 'PID 选择刷新'),
        ('ThreadTimeline.resize()', '窗口 resize 处理'),
    ]

    for pattern, desc in checks:
        if pattern in js:
            t.ok(f"集成完成: {desc}")
        else:
            t.fail(f"缺少集成: {desc}")


@suite.test("视图与清除/重新加载联动")
def _(t, flags):
    """回归：清除、关闭文件等菜单操作后，视图栈必须一并清除，
    避免残留视图引用已清除/移除的数据导致搜索基于过期视图过滤。"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    # 清除必须清空视图栈
    clear_idx = js.find('clearAll() {')
    if clear_idx >= 0:
        seg = js[clear_idx:clear_idx + 1000]
        if 'ViewManager.clear()' in seg:
            t.ok("清除 (clearAll) 会清空视图栈与面包屑")
        else:
            t.fail("清除 (clearAll) 未清空视图栈")
        if '_updateSaveViewButton()' in seg:
            t.ok("清除后更新保存视图按钮可见性")
        else:
            t.fail("清除后未更新保存视图按钮")
    else:
        t.fail("未找到 clearAll")

    # 关闭文件（仍有剩余文件时）必须清空过期视图
    close_idx = js.find('closeFile(fileName) {')
    if close_idx >= 0:
        seg = js[close_idx:close_idx + 2000]
        if 'ViewManager.clear()' in seg:
            t.ok("关闭文件后清除过期视图")
        else:
            t.fail("关闭文件后未清除过期视图")
    else:
        t.fail("未找到 closeFile")

    # 关闭档案（仍有剩余文件时）必须清空过期视图
    arch_idx = js.find('closeArchive(archiveName) {')
    if arch_idx >= 0:
        seg = js[arch_idx:arch_idx + 2000]
        if 'ViewManager.clear()' in seg:
            t.ok("关闭档案后清除过期视图")
        else:
            t.fail("关闭档案后未清除过期视图")
    else:
        t.fail("未找到 closeArchive")

    # 重新加载路径：onDataLoaded 清除视图（既有集成点）
    if 'ViewManager.clear()' in js:
        t.ok("重新加载/解析路径清除视图 (onDataLoaded)")
    else:
        t.fail("重新加载路径缺少 ViewManager.clear()")


@suite.test("ViewManager.clear 同步过滤输入框")
def _(t, flags):
    """回归：清除视图后过滤输入框（搜索/PID/线程）必须与 state 同步清空，
    避免界面残留旧过滤文本。"""
    vm_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(vm_path, encoding='utf-8').read()

    clear_idx = js.find('clear() {')
    if clear_idx >= 0:
        seg = js[clear_idx:clear_idx + 400]
        if '_syncFilterInputs' in seg and "pidFilter: ''" in seg:
            t.ok("clear() 同步清空过滤输入框")
        else:
            t.fail("clear() 未同步过滤输入框")
    else:
        t.fail("未找到 ViewManager.clear")

    # clear() 后 isInView 应为 false（视图栈清空 + currentIndex=-1）
    if 'this.stack = []' in js and 'this.currentIndex = -1' in js:
        t.ok("clear() 清空栈并回到全局视图")
    else:
        t.fail("clear() 未完整清空视图状态")


@suite.test("ViewManager 视图级 ✕ 关闭")
def _(t, flags):
    """验证仅当前选中视图显示 ✕：关闭该视图及之后的所有视图（栈截断）"""
    vm_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(vm_path, encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()

    # 视图 ✕ 关闭按钮（仅当前选中视图渲染）
    if 'vb-close-single' in js:
        t.ok("视图项支持 ✕ 关闭按钮")
    else:
        t.fail("缺少视图级 ✕ 按钮")

    # 仅当前选中视图渲染 ✕（active 条件）
    if "active ? `<span class=\"vb-close-single\"" in js or 'active ? ' in js:
        t.ok("仅当前选中视图显示 ✕")
    else:
        t.fail("✕ 未按选中状态渲染")

    # 视图 ✕ 阻止冒泡（避免同时触发跳转）
    if 'e.stopPropagation()' in js:
        t.ok("视图 ✕ 阻止冒泡到跳转")
    else:
        t.fail("视图 ✕ 未阻止冒泡")

    # closeViewAt 截断栈：移除该视图及之后
    if 'closeViewAt(i) {' in js and 'this.stack.slice(0, i)' in js:
        t.ok("closeViewAt 截断视图栈 (关闭该视图及之后)")
    else:
        t.fail("closeViewAt 未截断视图栈")

    # 关闭全部视图（最右侧 ✕ → clear）
    if 'vb-close-all' in js and 'this.clear()' in js:
        t.ok("最右侧 ✕ 关闭全部视图")
    else:
        t.fail("缺少关闭全部视图按钮")

    # CSS 样式：视图级 ✕ + 关闭全部 ✕
    if '.vb-close-single {' in css and '.vb-close-all {' in css:
        t.ok("✕ 按钮样式齐全")
    else:
        t.fail("✕ 按钮样式缺失")


@suite.test("ViewManager 创建视图清空搜索")
def _(t, flags):
    """验证创建新视图后清空当前搜索内容（视图数据已固化过滤状态）"""
    vm_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(vm_path, encoding='utf-8').read()

    push_idx = js.find('pushView(name, entries, filterSnapshot) {')
    if push_idx < 0:
        t.fail("未找到 pushView")
        return
    seg = js[push_idx:push_idx + 1100]

    if "LogFilter.state.searchText = ''" in seg:
        t.ok("创建视图后清空搜索状态")
    else:
        t.fail("创建视图后未清空搜索状态")

    if 'LogFilter.resetSearch()' in seg:
        t.ok("重置搜索结果")
    else:
        t.fail("未重置搜索结果")

    if 'App.setViewData(this.stack[this.currentIndex].entries)' in seg:
        t.ok("创建后直接显示视图数据")
    else:
        t.fail("创建后未同步视图数据")


@suite.test("ViewManager 视图项复制")
def _(t, flags):
    """验证视图项支持复制名称（悬停显示复制按钮）"""
    vm_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(vm_path, encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()

    # 每个视图项渲染复制按钮
    if 'vb-copy' in js:
        t.ok("视图项渲染复制按钮")
    else:
        t.fail("缺少复制按钮渲染")

    # 复制按钮阻止冒泡（避免触发跳转）
    if "e.stopPropagation();\n        const v = this.stack[Number(btn.dataset.index)]" in js:
        t.ok("复制按钮阻止冒泡并取视图名称")
    else:
        t.fail("复制按钮事件处理缺失")

    # 复制到剪贴板（含降级方案）
    if '_copyText(text)' in js and 'navigator.clipboard' in js:
        t.ok("使用 Clipboard API 复制")
    else:
        t.fail("缺少复制实现")

    if '_copyFallback' in js and 'document.execCommand' in js:
        t.ok("提供降级复制方案")
    else:
        t.fail("缺少降级复制")

    # CSS：复制按钮默认隐藏，悬停视图项时显示
    if '.vb-copy {' in css and '.vb-crumb:hover .vb-copy {' in css:
        t.ok("复制按钮悬停视图项时显示")
    else:
        t.fail("复制按钮样式缺失")


@suite.test("ViewManager closeViewAt 截断逻辑正确性")
def _(t, flags):
    """Node.js 执行验证 closeViewAt 关闭该视图及之后所有视图的语义"""
    vm_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(vm_path, encoding='utf-8').read()
    body = _extract_js_func_body(js, 'closeViewAt(i) {')
    if not body:
        t.fail("无法提取 closeViewAt")
        return

    test_code = """
const obj = {
  stack: [],
  currentIndex: -1,
  applied: null,
  _resetToGlobal() { this.stack = []; this.currentIndex = -1; },
  _applyView() { if (this.currentIndex >= 0 && this.stack[this.currentIndex]) this.applied = this.stack[this.currentIndex].name; },
  renderBreadcrumb() {},
  closeViewAt: function(i) {
%s
  }
};
let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('FAIL: ' + msg); }
}
function setup(names, idx) {
  obj.stack = names.map(n => ({ name: n }));
  obj.currentIndex = idx;
  obj.applied = null;
}
// 栈 [V1,V2,V3]，当前 V3 → 关闭 V2 后只剩 V1，落到 V1
setup(['V1','V2','V3'], 2);
obj.closeViewAt(1);
check(obj.stack.length === 1 && obj.stack[0].name === 'V1', '关V2后栈=[V1] 实际=' + JSON.stringify(obj.stack.map(v=>v.name)));
check(obj.currentIndex === 0 && obj.applied === 'V1', '当前落到V1 实际=' + obj.currentIndex + '/' + obj.applied);
// 栈 [V1,V2,V3]，当前 V3 → 关闭 V3 后栈=[V1,V2]，落到 V2
setup(['V1','V2','V3'], 2);
obj.closeViewAt(2);
check(obj.stack.length === 2 && obj.stack[1].name === 'V2', '关V3后栈=[V1,V2]');
check(obj.currentIndex === 1 && obj.applied === 'V2', '当前落到V2 实际=' + obj.currentIndex + '/' + obj.applied);
// 栈 [V1,V2,V3]，当前 V3 → 关闭 V1 后栈空，回全局
setup(['V1','V2','V3'], 2);
obj.closeViewAt(0);
check(obj.stack.length === 0 && obj.currentIndex === -1, '关V1后栈空回全局 实际=' + obj.stack.length + '/' + obj.currentIndex);
// 栈 [V1]，当前 V1 → 关闭 V1 后回全局
setup(['V1'], 0);
obj.closeViewAt(0);
check(obj.stack.length === 0 && obj.currentIndex === -1, '关唯一视图后回全局');
// 越界关闭不生效
setup(['V1','V2'], 1);
obj.closeViewAt(5);
check(obj.stack.length === 2 && obj.currentIndex === 1, '越界关闭无效 实际=' + obj.stack.length + '/' + obj.currentIndex);
// 当前在全局（-1），关闭 V1 后栈空，仍全局
setup(['V1','V2'], -1);
obj.closeViewAt(0);
check(obj.stack.length === 0 && obj.currentIndex === -1, '全局视图下关闭底层视图');
console.log('PASS:' + pass + ' FAIL:' + fail);
"""
    test_code = test_code % body
    proc = subprocess.run(['node', '-e', test_code], capture_output=True, text=True, timeout=10)

    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr}")
        return
    output = proc.stdout.strip()
    if 'FAIL:0' in output:
        m = re.search(r'PASS:(\d+)', output)
        t.ok(f"closeViewAt 截断逻辑正确 ({m.group(1)} 个断言)")
    else:
        for line in output.split('\n'):
            if line.startswith('FAIL:'):
                t.fail(line)
        t.fail("closeViewAt 部分断言失败")


@suite.test("ViewManager 关闭全部视图退出界面")
def _(t, flags):
    """验证关闭全部视图后：栈清空、面包屑隐藏（退出视图界面）"""
    vm_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(vm_path, encoding='utf-8').read()

    if 'this.clear()' in js and 'vb-close-all' in js:
        t.ok("关闭全部视图调用 clear()")
    else:
        t.fail("关闭全部未调用 clear()")

    # clear() 清空栈 → renderBreadcrumb 隐藏面包屑（stack.length===0 → display none）
    if 'this.stack = []' in js and 'this.renderBreadcrumb()' in js:
        t.ok("clear() 清空栈并重渲染面包屑")
    else:
        t.fail("clear() 未清空栈/重渲染")

    # 退出视图界面：面包屑在栈空时隐藏
    if 'container.style.display = \'none\'' in js:
        t.ok("栈空时隐藏面包屑（退出视图界面）")
    else:
        t.fail("栈空时未隐藏面包屑")


# ===== HTML 脚本加载顺序验证 =====

@suite.test("脚本加载顺序")
def _(t, flags):
    """验证 HTML 中脚本加载顺序正确"""
    html_path = os.path.join(ROOT, 'index.html')
    html = open(html_path, encoding='utf-8').read()

    scripts = re.findall(r'<script src="([^"]+)"', html)

    # 检查关键文件顺序
    def index_of(partial):
        for i, s in enumerate(scripts):
            if partial in s:
                return i
        return -1

    thread_idx = index_of('thread_timeline')
    view_idx = index_of('view_manager')
    app_idx = index_of('app.js')
    timeline_idx = index_of('timeline.js')
    grid_idx = index_of('grid.js')

    if thread_idx < 0:
        t.fail("thread_timeline.js 未加载")
    elif view_idx < 0:
        t.fail("view_manager.js 未加载")
    elif thread_idx < app_idx:
        t.ok(f"thread_timeline.js 在 app.js 之前加载 (位置 {thread_idx})")
    else:
        t.fail(f"thread_timeline.js 应在 app.js 之前 (位置 {thread_idx} > {app_idx})")

    if view_idx < app_idx:
        t.ok(f"view_manager.js 在 app.js 之前加载 (位置 {view_idx})")
    else:
        t.fail(f"view_manager.js 应在 app.js 之前 (位置 {view_idx} > {app_idx})")

    if thread_idx > timeline_idx:
        t.ok(f"thread_timeline.js 在 timeline.js 之后加载")
    else:
        t.fail("thread_timeline.js 应在 timeline.js 之后加载")


# ===== 边界情况 =====

@suite.test("视图管理器边界情况")
def _(t, flags):
    """验证视图管理器的边界处理"""
    js_path = os.path.join(ROOT, 'js', 'view_manager.js')
    js = open(js_path, encoding='utf-8').read()

    # 深度限制
    if 'MAX_DEPTH' in js:
        depth_match = re.search(r'MAX_DEPTH:\s*(\d+)', js)
        if depth_match:
            depth = int(depth_match.group(1))
            if depth == 10:
                t.ok(f"视图深度限制 = {depth} (支持最多10层)")
            elif depth <= 10:
                t.ok(f"视图深度限制 = {depth} (合理)")
            else:
                t.fail(f"视图深度限制过大: {depth}")

    # 超过上限时给用户提示
    if '已达到最大视图深度' in js and 'Utils.showToast' in js:
        t.ok("超过最大深度时提示用户")
    else:
        t.fail("缺少超过最大深度的用户提示")

    # 空栈处理
    if 'stack.length === 0' in js or 'stack.length==0' in js:
        t.ok("空栈边界处理")
    else:
        t.fail("缺少空栈边界处理")

    # 当前不在栈顶的处理
    if 'currentIndex < this.stack.length - 1' in js:
        t.ok("栈截断边界处理 (currentIndex < stack.length - 1)")
    else:
        t.fail("缺少栈截断边界处理")


@suite.test("线程时间线边界情况")
def _(t, flags):
    """验证线程时间线的边界处理"""
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    # 空数据提示
    if '没有带时间戳的日志条目' in js:
        t.ok("空数据提示: 没有带时间戳的日志条目")
    else:
        t.fail("缺少空数据提示")

    # 无匹配线程提示
    if '没有匹配的线程' in js:
        t.ok("空线程提示: 没有匹配的线程")
    else:
        t.fail("缺少空线程提示")

    # unknown 分组排序
    if "a === 'unknown'" in js and "b === 'unknown'" in js:
        t.ok("unknown 分组排最后")
    else:
        t.fail("缺少 unknown 分组排序逻辑")

    # PID 下发禁用
    if 'pids.length === 0' in js:
        t.ok("无 PID 时禁用下拉框")
    else:
        t.fail("缺少无 PID 时的下拉框禁用逻辑")

    # 命中半径自适应缩放
    if 'Math.max(6, 10 / this.zoomLevel)' in js or 'hr = Math.max' in js:
        t.ok("命中半径自适应缩放")
    else:
        t.fail("缺少命中半径自适应缩放")

    # 段块命中检测（归一化时间坐标 t）
    if 'pos[hi]' in js and 'pos[lo]' in js and 't > pos[hi]' in js:
        t.ok("段块命中检测 (pos[hi] < t < pos[lo])")
    else:
        t.fail("缺少段块命中检测")

    # 边缘命中检测
    if 'pos[hi] + hrT' in js or 'pos[0] - hrT' in js:
        t.ok("边缘命中检测")
    else:
        t.fail("缺少边缘命中检测")

    # 垂直滚动
    if 'scrollY' in js and '_clampScrollY' in js:
        t.ok("垂直滚动支持")
    else:
        t.fail("缺少垂直滚动")

    # 视口裁剪
    if 'firstVisible' in js and 'lastVisible' in js:
        t.ok("视口裁剪 (firstVisible/lastVisible)")
    else:
        t.fail("缺少视口裁剪")

    # 滚动条绘制
    if '_drawScrollbar' in js:
        t.ok("滚动条绘制")
    else:
        t.fail("缺少滚动条绘制")

    # _precomputePositions 详情模式
    if '_detailMethods' in js and '_precomputePositions' in js:
        t.ok("_precomputePositions 处理详情模式")
    else:
        t.fail("_precomputePositions 未处理详情模式")


@suite.test("线程详情方法时间线功能")
def _(t, flags):
    """验证线程详情（方法时间线）的关键功能"""
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    # 方法名称提取
    if '_extractMethod' in js:
        t.ok("_extractMethod 方法存在")
    else:
        t.fail("缺少 _extractMethod")

    if "entry.source" in js:
        t.ok("_extractMethod 从 entry.source 提取方法")
    else:
        t.fail("_extractMethod 未使用 entry.source")

    # 方法名提取逻辑已迁移到 Utils.extractMethodName（filter.js 也需要复用）
    utils_path = os.path.join(ROOT, 'js', 'utils.js')
    ujs = open(utils_path, encoding='utf-8').read()

    if 'extractMethodName' in ujs:
        t.ok("Utils.extractMethodName 已定义")
    else:
        t.fail("缺少 Utils.extractMethodName")

    if "split('.')" in ujs:
        t.ok("extractMethodName 使用点号分割")
    else:
        t.fail("extractMethodName 未使用点号分割")

    if "slice(-2)" in ujs:
        t.ok("extractMethodName 取最后两段作为方法标识")
    else:
        t.fail("extractMethodName 未取最后两段")

    if "'(unknown)'" in ujs:
        t.ok("空 source 返回 '(unknown)'")
    else:
        t.fail("缺少空 source 处理")

    # file:func:linenum 格式支持
    if "includes(':')" in ujs:
        t.ok("extractMethodName 支持 file:func:linenum 格式")
    else:
        t.fail("extractMethodName 缺少冒号格式支持")

    if "split(':')" in ujs:
        t.ok("extractMethodName 使用冒号分割")
    else:
        t.fail("extractMethodName 未使用冒号分割")

    if "funcPart" in ujs:
        t.ok("extractMethodName 提取 funcPart")
    else:
        t.fail("extractMethodName 缺少 funcPart 提取")

    if "className" in ujs:
        t.ok("extractMethodName 提取 className")
    else:
        t.fail("extractMethodName 缺少 className 提取")

    # 方法分组
    if '_groupByMethod' in js:
        t.ok("_groupByMethod 方法存在")
    else:
        t.fail("缺少 _groupByMethod")

    # 方法过滤
    if '_filterDetailMethods' in js:
        t.ok("_filterDetailMethods 方法存在")
    else:
        t.fail("缺少 _filterDetailMethods")

    # 详情模式提示
    if '没有匹配的方法' in js:
        t.ok("方法为空提示: 没有匹配的方法")
    else:
        t.fail("缺少方法为空提示")

    # 详情模式 Summary
    if '方法' in js and '线程:' in js:
        t.ok("详情模式摘要包含方法和线程信息")
    else:
        t.fail("详情模式摘要不完整")

    # 详情 header 更新
    if '_updateDetailHeader' in js:
        t.ok("_updateDetailHeader 方法存在")
    else:
        t.fail("缺少 _updateDetailHeader")

    # 双击/Alt+点击打开详情
    if 'dblclick' in js and 'openThreadDetail' in js:
        t.ok("双击打开线程详情")
    else:
        t.fail("缺少双击打开线程详情")

    if 'e.altKey' in js:
        t.ok("Alt+点击打开线程详情")
    else:
        t.fail("缺少 Alt+点击打开线程详情")

    # issue #55 按调用顺序显示：调用序排序 / 调用序列 / 排序切换 / 序号标注
    if '_callOrder' in js:
        t.ok("方法按首次调用时间排序（调用序）")
    else:
        t.fail("缺少调用序排序")
    if '_callSequence' in js:
        t.ok("生成调用序列（A → B → C）")
    else:
        t.fail("缺少调用序列")
    if '_toggleMethodSort' in js:
        t.ok("排序切换（调用序 ⇄ 字母序）")
    else:
        t.fail("缺少排序切换")
    if 'callIdx' in js and '调用序' in js:
        t.ok("泳道标注真实调用序号")
    else:
        t.fail("缺少调用序号标注")

    # 详情模式下点击方法标签过滤
    if 'sourceFilter' in js:
        t.ok("点击方法标签设置 sourceFilter")
    else:
        t.fail("缺少 sourceFilter 过滤")

    # closeThreadDetail 清除过滤条件
    if "LogFilter.state.threadFilter = ''" in js and "LogFilter.state.sourceFilter = ''" in js:
        t.ok("closeThreadDetail 清除 threadFilter 和 sourceFilter")
    else:
        t.fail("closeThreadDetail 未清除过滤条件")

    if 'App.refresh()' in js:
        t.ok("closeThreadDetail 调用 App.refresh() 恢复 grid 数据")
    else:
        t.fail("closeThreadDetail 未调用 App.refresh()")

    # openThreadDetail 清除 sourceFilter
    if "LogFilter.state.sourceFilter = ''" in js:
        t.ok("openThreadDetail 清除 sourceFilter")
    else:
        t.fail("openThreadDetail 未清除 sourceFilter")


@suite.test("_extractMethod 方法提取逻辑验证")
def _(t, flags):
    """验证 _extractMethod 对各种 source 格式的提取结果（复用 Utils.extractMethodName）"""

    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()
    utils_path = os.path.join(ROOT, 'js', 'utils.js')
    ujs = open(utils_path, encoding='utf-8').read()

    # 从 utils.js 提取 extractMethodName 函数体
    func_start = ujs.find('extractMethodName(src)')
    if func_start < 0:
        t.fail("无法定位 extractMethodName 函数")
        return
    brace_start = ujs.find('{', func_start)
    if brace_start < 0:
        t.fail("无法定位 extractMethodName 函数体开始")
        return
    depth = 0
    func_end = brace_start
    for i in range(brace_start, len(ujs)):
        if ujs[i] == '{':
            depth += 1
        elif ujs[i] == '}':
            depth -= 1
            if depth == 0:
                func_end = i + 1
                break
    func_body = ujs[brace_start + 1:func_end - 1].strip()

    # 验证 _extractMethod 委托给 Utils.extractMethodName
    if 'Utils.extractMethodName' in js:
        t.ok("_extractMethod 委托 Utils.extractMethodName")
    else:
        t.fail("_extractMethod 未委托 Utils.extractMethodName")

    # 用 Node.js 执行测试
    test_code = """
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
const Utils = { extractMethodName: function(src) {
%s
} };
const _extractMethod = function(entry) { return Utils.extractMethodName(entry.source); };
const cases = [
  // [source, expected]
  ['', '(unknown)'],
  ['com.example.Service.methodName', 'Service.methodName'],
  ['com.example.Service:handle:42', 'Service.handle'],
  ['test.cpp:testFunc:1000', 'test.testFunc'],
  ['main.cpp:main:55', 'main.main'],
  ['src/utils/helper.go:Process:88', 'helper.Process'],
  ['com.example.web.UserController:login:128', 'UserController.login'],
  ['com.example.scheduler.TaskRunner:run:55', 'TaskRunner.run'],
  ['com.example.Service:process', 'Service.process'],
  ['com.example.Service', 'Service'],
  ['SimpleClass', 'SimpleClass'],
  ['com.a.b.c.d.DeepClass.deepMethod', 'DeepClass.deepMethod'],
  ['com.a.b.c.d.DeepClass:deepMethod:99', 'DeepClass.deepMethod'],
  ['com.example.Service:methodName', 'Service.methodName'],
  ['com.example.Service:handle', 'Service.handle'],
];
let pass = 0, fail = 0;
for (const [src, expected] of cases) {
  const entry = { source: src };
  const result = _extractMethod(entry);
  if (result === expected) {
    pass++;
  } else {
    fail++;
    console.log('FAIL: source="' + src + '" expected="' + expected + '" got="' + result + '"');
  }
}
console.log('PASS:' + pass + ' FAIL:' + fail);
"""
    test_code = test_code % func_body

    proc = subprocess.run(
        ['node', '-e', test_code],
        capture_output=True, text=True, timeout=10
    )

    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr}")
        return

    output = proc.stdout.strip()
    if 'FAIL:0' in output:
        # 提取通过数
        pass_match = re.search(r'PASS:(\d+)', output)
        if pass_match:
            t.ok(f"_extractMethod 测试通过 ({pass_match.group(1)} 个用例)")
    else:
        for line in output.split('\n'):
            if line.startswith('FAIL:'):
                t.fail(line)
        t.fail("_extractMethod 部分测试失败")


@suite.test("线程时间线性能优化特征")
def _(t, flags):
    """验证性能优化关键代码"""
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    # 预计算位置（避免每帧重算）
    if '_precomputePositions' in js:
        t.ok("位置预计算")
    else:
        t.fail("缺少位置预计算")

    # 使用 typed arrays 加速
    if 'Float64Array' in js:
        t.ok("使用 Float64Array 存储位置")
    else:
        t.fail("缺少 Float64Array")

    if 'Uint8Array' in js:
        t.ok("使用 Uint8Array 存储级别")
    else:
        t.fail("缺少 Uint8Array")

    # requestAnimationFrame
    if 'requestAnimationFrame' in js:
        t.ok("使用 requestAnimationFrame")
    else:
        t.fail("缺少 requestAnimationFrame")

    # 批量路径绘制（按颜色分组）
    if 'buckets' in js:
        t.ok("按颜色批量路径绘制")
    else:
        t.fail("缺少批量路径绘制")

    # 段块模式绘制
    if 'barH' in js and 'barY' in js:
        t.ok("段块模式绘制（barH/barY）")
    else:
        t.fail("缺少段块模式绘制")

    if "fillRect" in js:
        t.ok("段块模式使用 fillRect")
    else:
        t.fail("段块模式缺少 fillRect")

    if "globalAlpha" in js:
        t.ok("ERROR/FATAL 段块发光效果")
    else:
        t.fail("缺少 ERROR/FATAL 发光效果")

    # 二分查找
    if 'lo = 0' in js or 'lo <= hi' in js:
        t.ok("hover 检测使用二分查找")
    else:
        t.fail("缺少二分查找")

    # 密度模式
    if '_drawDensity' in js:
        t.ok("密度模式绘制")
    else:
        t.fail("缺少密度模式绘制")

    # 视口裁剪（段块模式）
    if 'Math.max(x1, labelEnd)' in js or 'Math.min(x2, plotX2)' in js:
        t.ok("视口裁剪")
    else:
        t.fail("缺少视口裁剪")

    # esc 函数（非 h，避免变量遮蔽）
    if 'function esc(' in js:
        t.ok("esc 函数命名正确（无变量遮蔽）")
    else:
        t.fail("缺少 esc 函数或命名不当")

    # 线程内按时间排序
    if 'a.date.getTime() - b.date.getTime()' in js:
        t.ok("线程内条目按时间排序")
    else:
        t.fail("缺少线程内时间排序")

    # 全局时间范围遍历所有条目
    if 'for (const e of t.entries)' in js or 'i < entries.length' in js:
        t.ok("时间范围遍历所有条目（非仅首尾）")
    else:
        t.fail("时间范围未遍历所有条目")

    # hover 线程高亮
    if '_hoveredThreadIdx' in js:
        t.ok("hover 线程高亮状态")
    else:
        t.fail("缺少 hover 线程高亮")

    # 摘要栏
    if '_drawSummary' in js:
        t.ok("摘要栏绘制")
    else:
        t.fail("缺少摘要栏绘制")


@suite.test("ThreadTimeline 大规模数据性能优化（issue #52）")
def _(t, flags):
    """200w+ 行日志时间线卡顿修复：段块模式同色段合并 + 高密度自动降级像素聚合"""
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    # 1. 段块模式：同色连续段合并（flushSeg / curLvl），避免逐条目 fillRect
    if 'flushSeg' in js:
        t.ok("段块模式同色连续段合并绘制")
    else:
        t.fail("缺少段块模式段合并")

    # 2. 高密度自动降级：可视条目超过阈值时使用像素聚合绘制
    if 'plotW * 3' in js:
        t.ok("可视条目过多时自动降级像素聚合")
    else:
        t.fail("缺少高密度降级阈值")

    # 3. 密度模式：Uint32Array 计数桶（替代字符串 key，避免 split/parseInt）
    if 'Uint32Array' in js:
        t.ok("密度模式使用 Uint32Array 计数桶")
    else:
        t.fail("缺少 Uint32Array 计数桶")

    # 4. 密度模式：高优先级级别（FATAL/ERROR）后画覆盖，保证错误可见
    if 'lvl <= 1' in js and 'minH' in js:
        t.ok("FATAL/ERROR 最小高度保证错误级别可见")
    else:
        t.fail("缺少高优先级级别最小高度")

    # 5. 竖线高度钳制在泳道内，避免溢出覆盖相邻泳道
    if 'Math.min(this.SWIMLANE_H' in js:
        t.ok("竖线高度钳制在泳道内")
    else:
        t.fail("缺少竖线高度钳制")

    # 6. show 数据准备合并遍历（分组与时间范围一次完成）
    if '_buildTimeRange' not in js:
        t.ok("时间范围计算已合并进 _groupByThread（减少全量遍历）")
    else:
        t.fail("仍存在独立的 _buildTimeRange 全量遍历")

    # 7. 摘要统计缓存（避免每帧 reduce 求和）
    if '_totalCount' in js:
        t.ok("摘要统计缓存 _totalCount")
    else:
        t.fail("缺少 _totalCount 缓存")


@suite.test("时间线-交互提示与人性化优化")
def _(t, flags):
    """操作帮助按钮/弹层、迷你提示条、平滑缩放、缩放反馈、拖拽光标、首次引导"""
    html_path = os.path.join(ROOT, 'index.html')
    css_path = os.path.join(ROOT, 'css', 'style.css')
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    html = open(html_path, encoding='utf-8').read()
    css = open(css_path, encoding='utf-8').read()
    js = open(js_path, encoding='utf-8').read()

    # 1. 帮助按钮 / 帮助弹层 / 迷你提示条
    if 'btn-timeline-help' in html:
        t.ok("头部包含操作帮助按钮 ❓")
    else:
        t.fail("缺少操作帮助按钮")
    if 'timeline-help-popup' in html and 'timeline-help-table' in html:
        t.ok("包含操作说明弹层（快捷键表）")
    else:
        t.fail("缺少操作说明弹层")
    if 'timeline-hint' in html:
        t.ok("包含常驻迷你操作提示条")
    else:
        t.fail("缺少迷你操作提示条")

    # 2. 弹层/提示条样式
    if 'timeline-help-popup' in css and 'timeline-help-table' in css:
        t.ok("帮助弹层样式定义")
    else:
        t.fail("缺少帮助弹层样式")
    if 'timeline-hint' in css and 'flex-shrink: 0' in css:
        t.ok("提示条为头部与画布间独立条带（不遮盖时间轴）")
    else:
        t.fail("缺少提示条样式")

    # 3. 平滑缩放：统一 _zoomBy 入口 + 1.25 倍率（按钮）
    if '_zoomBy(factor' in js and '1.25' in js:
        t.ok("平滑缩放（_zoomBy 统一入口 + 1.25 倍率）")
    else:
        t.fail("缺少平滑缩放")
    if 'Math.min(Math.abs(e.deltaY), 400) / 1000' in js:
        t.ok("滚轮按 deltaY 精细缩放（避免跳变）")
    else:
        t.fail("缺少 deltaY 精细缩放")

    # 4. 缩放反馈：停止后显示当前视图时间跨度
    if '_scheduleZoomFeedback' in js and '_formatDuration' in js:
        t.ok("缩放反馈（停止后显示当前视图时间跨度）")
    else:
        t.fail("缺少缩放反馈")

    # 5. 适应按钮带反馈
    if 'fitToData(true)' in js:
        t.ok("适应按钮带完成反馈")
    else:
        t.fail("适应按钮缺少反馈")

    # 6. 拖拽光标反馈（grab/grabbing）
    if "'grabbing'" in js and "'grab'" in js:
        t.ok("拖拽光标反馈（grab/grabbing）")
    else:
        t.fail("缺少拖拽光标反馈")

    # 7. 首次操作引导（每会话一次）
    if '_maybeShowFirstHint' in js and "sessionStorage.getItem('tl-hint-shown')" in js:
        t.ok("首次打开时间线操作引导")
    else:
        t.fail("缺少首次操作引导")


@suite.test("时间线-调用栈视图（issue #56）")
def _(t, flags):
    """指定函数调用栈文件，按调用栈树显示日志：解析/匹配计数/节点过滤"""
    html_path = os.path.join(ROOT, 'index.html')
    css_path = os.path.join(ROOT, 'css', 'style.css')
    cs_path = os.path.join(ROOT, 'js', 'callstack.js')
    app_path = os.path.join(ROOT, 'js', 'app.js')
    html = open(html_path, encoding='utf-8').read()
    css = open(css_path, encoding='utf-8').read()
    cs = open(cs_path, encoding='utf-8').read()
    app_js = open(app_path, encoding='utf-8').read()

    # HTML：调用栈 tab / 视图 / 加载按钮 / 文件输入 / 脚本引入
    if 'data-mode="callstack"' in html:
        t.ok("时间线模式含调用栈 tab")
    else:
        t.fail("缺少调用栈 tab")
    if 'id="callstack-view"' in html and 'id="btn-callstack-load"' in html:
        t.ok("调用栈视图与加载按钮存在")
    else:
        t.fail("缺少调用栈视图/加载按钮")
    if 'id="callstack-file-input"' in html:
        t.ok("调用栈文件输入存在")
    else:
        t.fail("缺少调用栈文件输入")
    if 'js/callstack.js' in html:
        t.ok("已引入 callstack.js")
    else:
        t.fail("未引入 callstack.js")

    # CSS 样式
    if 'callstack-tree' in css and '.cs-node' in css:
        t.ok("调用栈树样式定义")
    else:
        t.fail("缺少调用栈树样式")

    # callstack.js 模块功能
    for pat, desc in [
        ('parse(', '解析调用栈文本'),
        ('_computeCounts', '日志匹配计数'),
        ('selectNode', '节点过滤日志'),
        ('loadFile', '加载调用栈文件'),
        ('_getPath', '调用路径提取'),
        ('_descend', '缩进跳跃下探'),
    ]:
        if pat in cs:
            t.ok(f"CallStack {desc}")
        else:
            t.fail(f"缺少 CallStack {desc}")

    # app.js 初始化
    if 'CallStack.init()' in app_js:
        t.ok("app.js 初始化 CallStack")
    else:
        t.fail("app.js 未初始化 CallStack")

    # tab 切换逻辑处理调用栈模式
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tt = open(tt_path, encoding='utf-8').read()
    if "'callstack'" in tt and 'CallStack.activate()' in tt:
        t.ok("线程时间线 tab 切换处理调用栈模式")
    else:
        t.fail("缺少调用栈模式切换处理")

    # 调用栈模式占满面板：activate 隐藏 canvas/hint，deactivate 恢复（加载入口可见）
    if 'canvas.style.display' in cs and "timeline-canvas" in cs and "timeline-hint" in cs:
        t.ok("调用栈模式隐藏 canvas/提示条，视图占满面板")
    else:
        t.fail("调用栈模式未隐藏 canvas/提示条")
    if "canvas.style.display = ''" in cs:
        t.ok("退出调用栈模式恢复 canvas")
    else:
        t.fail("退出调用栈模式未恢复 canvas")

    # 混合格式（缩进树 + 箭头链）解析：树优先，箭头链不干扰
    if 'hasIndent' in cs and '箭头链行仅作补充' in cs:
        t.ok("混合格式解析：缩进树优先，箭头链不干扰")
    else:
        t.fail("缺少混合格式解析处理")

    # 流程图模式：切换按钮 / 泳道布局 / 日志详情面板（基于日志构建，无需调用栈文件）
    if 'toggleViewMode' in cs and 'renderFlow' in cs:
        t.ok("调用栈支持树状⇄流程图切换")
    else:
        t.fail("缺少流程图模式切换")
    if '_buildFlowGroups' in cs and '_segTime' in cs:
        t.ok("流程图基于日志构建（时间→进程→线程→函数段）")
    else:
        t.fail("缺少流程图日志构建逻辑")
    if 'callstack-flow-detail' in html and 'cs-detail-item' in css:
        t.ok("流程图日志详情面板")
    else:
        t.fail("缺少流程图日志详情面板")
    if '_onFlowSegClick' in cs and 'showSegDetail' in cs:
        t.ok("流程图函数段点击展示日志列表")
    else:
        t.fail("缺少流程图函数段日志展示")
    if '.cs-flow-seg' in css and '.cs-flow-arrow' in css:
        t.ok("流程图函数段与箭头样式")
    else:
        t.fail("缺少流程图函数段/箭头样式")
    # 点击调用栈视图不更新背景日志（selectNode 仅高亮、流程图点击仅展示面板）
    if "仅高亮选中，不更新背景日志" in cs:
        t.ok("树状 selectNode 不再过滤背景日志")
    else:
        t.fail("树状 selectNode 仍过滤背景日志")
    if "点击不更新背景日志" in cs:
        t.ok("流程图函数段点击不更新背景日志")
    else:
        t.fail("流程图函数段点击仍过滤背景日志")
    # 流程图渲染容器：普通 div 滚动容器（避免 SVG 内嵌 HTML 导致尺寸塌陷）
    if 'callstack-flow-canvas' in html and '.cs-flow-scroll' in css:
        t.ok("流程图使用 div 滚动容器（修复 SVG 尺寸塌陷）")
    else:
        t.fail("流程图缺少 div 滚动容器")

    # 流程图搜索函数名
    if 'cs-flow-search' in html and '_flowFilter' in cs:
        t.ok("流程图支持函数名搜索")
    else:
        t.fail("缺少流程图搜索框/过滤逻辑")
    if '_jumpToNextHit' in cs and 'search-hit' in css:
        t.ok("搜索命中高亮与 Enter 跳转下一处")
    else:
        t.fail("缺少搜索跳转逻辑")
    if 'cs-flow-search-count' in html:
        t.ok("搜索结果显示命中计数")
    else:
        t.fail("缺少搜索计数显示")

    # 流程图状态标注（ERROR/WARN 等，人性化配色）
    for pat, desc in [
        ('_aggregateLevel', '统计函数段日志级别分布'),
        ('_segStatus', '计算函数段状态（fatal/error/warn/info/trace）'),
        ('_segStatusBadge', '状态徽标（ERROR×N）'),
    ]:
        if pat in cs:
            t.ok(f"状态标注支持 {desc}")
        else:
            t.fail(f"缺少状态标注 {desc}")
    for sel in ['status-error', 'status-warn', 'status-fatal', '.cs-seg-bar', '.cs-seg-status', '.cs-seg-badge']:
        if sel in css:
            t.ok(f"状态标注样式 {sel}")
        else:
            t.fail(f"缺少状态标注样式 {sel}")
    if '搜索过滤函数段' in html or '搜索过滤函数段' in cs:
        t.ok("流程图提示含搜索操作说明")
    else:
        t.fail("缺少搜索操作提示")


@suite.test("调用栈提取工具（issue #57）")
def _(t, flags):
    """项目函数调用栈提取工具：解析源码、生成调用栈文件、与 callstack.js 格式兼容"""
    tool_path = os.path.join(ROOT, 'tools', 'callstack', 'extract_callstack.py')
    demo_path = os.path.join(ROOT, 'test', 'samples', 'callstack', 'callstack_demo.txt')
    src_dir = os.path.join(ROOT, 'test', 'samples', 'callstack', 'sample_cpp_src')
    if not os.path.exists(tool_path):
        t.fail("tools/callstack/extract_callstack.py 不存在")
        return
    tool = open(tool_path, encoding='utf-8').read()

    # 工具能力
    for pat, desc in [
        ('DEF_RE', '函数定义识别（C/C++/Java）'),
        ('CALL_RE', '函数调用识别'),
        ('extract_body', '函数体提取（大括号配对）'),
        ('strip_comments', '注释剥离'),
        ('--entry', '入口函数参数'),
        ('--lang', '语言指定参数'),
        ('--output', '输出文件参数'),
        ('--no-arrow', '箭头链开关'),
    ]:
        if pat in tool:
            t.ok(f"工具支持 {desc}")
        else:
            t.fail(f"工具缺少 {desc}")

    # 示例调用栈文件存在
    if os.path.exists(demo_path):
        t.ok("test/samples/callstack/callstack_demo.txt 示例调用栈文件存在")
    else:
        t.fail("缺少 test/samples/callstack/callstack_demo.txt")

    # 示例源码目录存在
    if os.path.isdir(src_dir):
        t.ok("test/samples/callstack/sample_cpp_src 示例源码目录存在")
    else:
        t.fail("缺少调用栈测试源码目录")

    # 端到端：运行工具生成临时文件，验证输出包含调用树与箭头链
    tmp_out = os.path.join(ROOT, 'test', 'tmp_cs_test.txt')
    try:
        proc = subprocess.run(
            [sys.executable, tool_path, src_dir, '--output', tmp_out],
            capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            t.fail(f"工具运行失败: {proc.stderr[:200]}")
        else:
            content = open(tmp_out, encoding='utf-8').read()
            if '调用树' in content and 'main' in content:
                t.ok("工具能生成调用树文件")
            else:
                t.fail("工具输出缺少调用树/main")
            if ' <- ' in content:
                t.ok("工具输出包含箭头链调用边")
            else:
                t.fail("工具输出缺少箭头链")
    finally:
        if os.path.exists(tmp_out):
            os.remove(tmp_out)


@suite.test("调用栈三通道工具（issue #57 增强）")
def _(t, flags):
    """静态增强（异步/回调/函数指针）+ 动态 perf + Doxygen 对接三通道"""

    # 1. extract_callstack.py 增强能力
    tool = open(os.path.join(ROOT, 'tools', 'callstack', 'extract_callstack.py'), encoding='utf-8').read()
    for pat, desc in [
        ('ASYNC_API_RE', '异步 API 识别（std::thread/async/pthread_create）'),
        ('CALLBACK_API_RE', '回调注册 API 识别'),
        ('FNPTR_ALIAS_RE', '函数指针别名追踪'),
        ('STDFUNC_RE', 'std::function 引用识别'),
    ]:
        if pat in tool:
            t.ok(f"静态工具支持 {desc}")
        else:
            t.fail(f"静态工具缺少 {desc}")

    # 2. 端到端：对含函数指针/异步的源码，异步与回调边应被提取
    ability_dir = os.path.join(ROOT, 'test', 'samples', 'callstack', 'cs_ability_test')
    if os.path.isdir(ability_dir):
        tmp = os.path.join(ROOT, 'test', 'tmp_cs_ability.txt')
        try:
            proc = subprocess.run(
                [sys.executable, os.path.join(ROOT, 'tools', 'callstack', 'extract_callstack.py'),
                 ability_dir, '--output', tmp],
                capture_output=True, text=True, timeout=30)
            content = open(tmp, encoding='utf-8').read() if proc.returncode == 0 else ''
            if 'launchAsync <- asyncWorker' in content:
                t.ok("异步回调边被提取（launchAsync → asyncWorker）")
            else:
                t.fail("异步回调边未提取")
            if 'useFunctionPointer <- handlerImpl' in content:
                t.ok("函数指针别名调用边被提取")
            else:
                t.fail("函数指针别名边未提取")
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    else:
        t.fail("缺少 test/samples/callstack/cs_ability_test 测试源码")

    # 3. perf 动态转换脚本
    perf_script = os.path.join(ROOT, 'tools', 'callstack', 'perf_to_callstack.py')
    if os.path.exists(perf_script):
        t.ok("tools/callstack/perf_to_callstack.py 存在")
        # 用模拟 folded 数据端到端验证
        tmp_folded = os.path.join(ROOT, 'test', 'tmp_folded.txt')
        tmp_out = os.path.join(ROOT, 'test', 'tmp_perf_out.txt')
        try:
            with open(tmp_folded, 'w', encoding='utf-8') as f:
                f.write('main;launchAsync;worker 5\nmain;directB;directA 2\n')
            proc = subprocess.run(
                [sys.executable, perf_script, '--folded', tmp_folded, '--output', tmp_out],
                capture_output=True, text=True, timeout=30)
            content = open(tmp_out, encoding='utf-8').read() if proc.returncode == 0 else ''
            if 'launchAsync' in content and 'worker' in content and 'launchAsync <- worker' in content:
                t.ok("perf folded → 调用栈文件转换正常")
            else:
                t.fail("perf folded 转换失败")
        finally:
            for p in (tmp_folded, tmp_out):
                if os.path.exists(p):
                    os.remove(p)
        # perf script 格式解析
        perf_demo = os.path.join(ROOT, 'test', 'samples', 'callstack', 'perf_demo.script')
        if os.path.exists(perf_demo):
            tmp_out2 = os.path.join(ROOT, 'test', 'tmp_perf_out2.txt')
            try:
                proc = subprocess.run(
                    [sys.executable, perf_script, '--perf-script', perf_demo, '--output', tmp_out2],
                    capture_output=True, text=True, timeout=30)
                content = open(tmp_out2, encoding='utf-8').read() if proc.returncode == 0 else ''
                if 'handlerImpl' in content and 'useFunctionPointer <- handlerImpl' in content:
                    t.ok("perf script 原始格式解析正常")
                else:
                    t.fail("perf script 解析失败")
            finally:
                if os.path.exists(tmp_out2):
                    os.remove(tmp_out2)
    else:
        t.fail("缺少 tools/callstack/perf_to_callstack.py")

    # 4. collect_perf_callstack.sh 一键采集脚本
    if os.path.exists(os.path.join(ROOT, 'tools', 'callstack', 'collect_perf_callstack.sh')):
        t.ok("tools/callstack/collect_perf_callstack.sh 存在")
    else:
        t.fail("缺少 collect_perf_callstack.sh")

    # 5. Doxygen 对接脚本
    doxy_script = os.path.join(ROOT, 'tools', 'callstack', 'doxygen_callstack.py')
    if os.path.exists(doxy_script):
        t.ok("tools/callstack/doxygen_callstack.py 存在")
        doxy_demo = os.path.join(ROOT, 'test', 'samples', 'callstack', 'doxygen_demo')
        if os.path.isdir(doxy_demo):
            tmp_out3 = os.path.join(ROOT, 'test', 'tmp_doxy_out.txt')
            try:
                proc = subprocess.run(
                    [sys.executable, doxy_script, '--dot', doxy_demo, '--output', tmp_out3],
                    capture_output=True, text=True, timeout=30)
                content = open(tmp_out3, encoding='utf-8').read() if proc.returncode == 0 else ''
                if 'handleRequest' in content and 'main <- handleRequest' in content:
                    t.ok("Doxygen dot → 调用栈文件转换正常")
                else:
                    t.fail("Doxygen dot 转换失败")
            finally:
                if os.path.exists(tmp_out3):
                    os.remove(tmp_out3)
        else:
            t.fail("缺少 test/samples/callstack/doxygen_demo 示例")
    else:
        t.fail("缺少 doxygen_callstack.py")

    # 6. 生成示例文件存在
    for rel in ('test/samples/callstack/perf_callstack_demo.txt', 'test/samples/callstack/doxygen_callstack_demo.txt'):
        if os.path.exists(os.path.join(ROOT, rel)):
            t.ok(f"{rel} 示例文件存在")
        else:
            t.fail(f"缺少 {rel}")


@suite.test("mini_cpp_demo 日志生成（与调用栈联动）")
def _(t, flags):
    """mini_cpp_demo 的 C++ 风格日志：函数名与调用栈文件节点一致，可端到端验证"""
    gen_path = os.path.join(ROOT, 'scripts', 'generate_mini_cpp_demo_log.py')
    if not os.path.exists(gen_path):
        t.fail("scripts/generate_mini_cpp_demo_log.py 不存在")
        return
    gen = open(gen_path, encoding='utf-8').read()

    # 脚本能力
    for pat, desc in [
        ('REQUEST_CHAIN', '请求调用链定义'),
        ('STARTUP_CHAIN', '启动调用链定义'),
        ('SHUTDOWN_CHAIN', '关闭调用链定义'),
        ("'%Y-%m-%d %H:%M:%S,", 'bracket 时间戳格式输出'),
    ]:
        if pat in gen:
            t.ok(f"日志生成支持 {desc}")
        else:
            t.fail(f"日志生成缺少 {desc}")

    # 函数名覆盖 mini_cpp_demo 全部节点（确保调用栈节点可匹配）
    for fn in ['main', 'handleRequest', 'getOrder', 'parseRequestLine', 'cacheGet',
               'dbConnect', 'initServer', 'shutdown', 'dbClose', 'dbQuery',
               'orderFromCache', 'orderFromDb', 'cacheSet', 'parseHeaders', 'checkVersion']:
        if f"'{fn}'" in gen or f'"{fn}"' in gen:
            t.ok(f"日志函数覆盖 {fn}")
        else:
            t.fail(f"日志函数缺少 {fn}")

    # 端到端：运行脚本生成临时日志，验证 bracket 格式与函数分布
    tmp_log = os.path.join(ROOT, 'test', 'tmp_mini.log')
    try:
        proc = subprocess.run(
            [sys.executable, gen_path, '500', tmp_log],
            capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            t.fail(f"日志生成失败: {proc.stderr[:200]}")
            return
        content = open(tmp_log, encoding='utf-8').read()
        lines = [l for l in content.split('\n') if l.strip()]
        # bracket 格式: [ts][LEVEL][pid][tid][TAG][source] msg
        fmt_ok = all(re.match(
            r'^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \+0800\]\[(TRACE|DEBUG|INFO|WARN|ERROR)\]\[\d+\]\[\d+\]\[[A-Z]+\]\[[a-z_]+\.cpp:[A-Za-z_]+:\d+\] ', l)
            for l in lines)
        if fmt_ok and len(lines) == 500:
            t.ok("日志为合法 bracket 格式（file.cpp:func:line）")
        else:
            t.fail(f"日志格式不符（行数 {len(lines)}）")
        # 函数名与调用栈一致
        if 'main.cpp:handleRequest:18' in content and 'cache.cpp:cacheGet:5' in content:
            t.ok("日志函数名与 mini_cpp_demo 调用栈节点一致")
        else:
            t.fail("日志函数名与调用栈节点不一致")
    finally:
        if os.path.exists(tmp_log):
            os.remove(tmp_log)


# ===== filter.js 高级过滤输入框绑定 =====

@suite.test("filter.js 高级过滤输入框绑定完整性")
def _(t, flags):
    """验证 app.js 中 advancedInputs 包含 filter-pid"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if "'filter-pid'" in js or '"filter-pid"' in js:
        t.ok("filter-pid 在 advancedInputs 中")
    else:
        t.fail("filter-pid 不在 advancedInputs 中")

    # 验证 searchIds 中包含 filter-pid
    if "filter-pid', 'filter-thread'" in js or '"filter-pid", "filter-thread"' in js:
        t.ok("filter-pid 在 searchIds 中")
    else:
        t.fail("filter-pid 不在 searchIds 中")


# ===== gotoLine 书签/跳转行逻辑 =====

@suite.test("gotoLine #N 视图行号跳转")
def _(t, flags):
    """验证 #N 表示当前视图第N行（合并了原 :N 语法）"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    # 验证 :N 语法已移除
    if "val.startsWith(':'))" in js or "val.startsWith(':')" in js:
        t.fail(":N 语法应已移除，合并到 #N")
    else:
        t.ok(":N 语法已移除")

    # 验证 #N 使用视图内行号
    if "视图内行号无效" in js:
        t.ok("#N 使用视图内行号范围校验")
    else:
        t.fail("#N 缺少视图内行号校验")

    # 验证 #N 在搜索模式下 = 第N个搜索结果
    if '第 ${num} 个搜索结果' in js:
        t.ok("#N 搜索模式下 = 第N个搜索结果")
    else:
        t.fail("#N 搜索模式缺少结果序号提示")


@suite.test("gotoLine @N 书签跳转使用数组索引")
def _(t, flags):
    """验证 @N 按书签列表序号跳转（1-based 数组索引）"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    # 验证 @N 使用数组索引
    if 'this.bookmarks[bmIdx - 1]' in js or 'this.bookmarks[bmIdx-1]' in js:
        t.ok("@N 按书签列表序号跳转")
    else:
        t.fail("@N 未使用书签列表序号")

    # 验证 @N 提示信息
    if '书签序号无效' in js:
        t.ok("@N 错误提示明确")
    else:
        t.fail("@N 缺少明确错误提示")

    # 验证 @N 不再使用 find 按行号匹配
    if "this.bookmarks.find(b => (b.index + 1) === lineNum)" in js:
        t.fail("@N 不应再按全局行号查找")
    else:
        t.ok("@N 已移除全局行号匹配方式")


@suite.test("gotoLine 纯数字 = 原始行号")
def _(t, flags):
    """验证纯数字始终表示原始行号（不再随视图模式改变）"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    # 验证纯数字注释说明
    if '纯数字：原始行号' in js:
        t.ok("纯数字注释为原始行号")
    else:
        t.fail("纯数字注释未明确为原始行号")

    # 验证不再有视图模式下的纯数字特殊处理
    if '在视图中：纯数字 = 视图内行号' in js:
        t.fail("纯数字不应再随视图模式改变含义")
    else:
        t.ok("纯数字不再随视图模式改变")


@suite.test("gotoLine +/-N 偏移后清空输入框")
def _(t, flags):
    """验证 +/-N 偏移后 input.value 被清空"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    idx = js.find('已向${dir}偏移')
    if idx > 0:
        nearby = js[idx:idx + 200]
        if "input.value = ''" in nearby or "input.value = \"\"" in nearby:
            t.ok("+/-N 偏移后清空 input.value")
        else:
            t.fail("+/-N 偏移后未清空 input.value")
    else:
        t.fail("无法定位 +/-N 偏移代码")


@suite.test("书签面板显示序号")
def _(t, flags):
    """验证书签面板显示序号（1. 2. 3. ...）"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if '${i + 1}. #${b.index + 1}' in js or '${i+1}. #${b.index + 1}' in js:
        t.ok("书签面板显示序号和行号")
    else:
        t.fail("书签面板未显示序号")


@suite.test("被过滤书签点击提示")
def _(t, flags):
    """验证点击被过滤的书签时显示提示而非静默失败"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if 'bm-filtered' in js and '该书签已被当前过滤条件排除' in js:
        t.ok("被过滤书签点击有明确提示")
    else:
        t.fail("被过滤书签点击缺少提示")


@suite.test("scrollToEntry 返回布尔值并显示 toast")
def _(t, flags):
    """验证 scrollToEntry 返回 true/false 并在过滤时显示 toast"""
    grid_path = os.path.join(ROOT, 'js', 'grid.js')
    js = open(grid_path, encoding='utf-8').read()

    if 'return true' in js and 'return false' in js:
        t.ok("scrollToEntry 返回布尔值")
    else:
        t.fail("scrollToEntry 未返回布尔值")

    if '已被当前过滤条件排除' in js:
        t.ok("scrollToEntry 过滤排除时显示 toast")
    else:
        t.fail("scrollToEntry 缺少过滤排除提示")


@suite.test("gotoLine $ 末行跳转含视图统计")
def _(t, flags):
    """验证 $ 跳转末行时显示视图行数/全部行数"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if '视图 ${totalRows} / 全部 ${globalTotal}' in js:
        t.ok("$ 末行跳转显示视图/全部统计")
    else:
        t.fail("$ 末行跳转缺少统计信息")


@suite.test("时间线 tooltip 移出面板避免裁剪")
def _(t, flags):
    """验证 tooltip 元素位于时间线面板之外，避免被 overflow:hidden 裁剪"""
    html_path = os.path.join(ROOT, 'index.html')
    html = open(html_path, encoding='utf-8').read()

    # 检查 tooltip 不在 timeline-panel 内部
    panel_start = html.find('<div id="timeline-panel"')
    panel_end = html.find('</div>', html.find('<canvas id="timeline-canvas"')) + 6
    if panel_start >= 0 and panel_end > panel_start:
        inner = html[panel_start:panel_end]
        if 'timeline-tooltip' not in inner:
            t.ok("tooltip 已移出 timeline-panel")
        else:
            t.fail("tooltip 仍在 timeline-panel 内部")
    else:
        t.fail("无法定位 timeline-panel")


@suite.test("tooltip z-index 高于遮罩层")
def _(t, flags):
    """验证 tooltip z-index 高于 popup-overlay(2001)，保证最顶层显示"""
    css_path = os.path.join(ROOT, 'css', 'style.css')
    css = open(css_path, encoding='utf-8').read()

    if '#timeline-tooltip' not in css:
        t.fail("缺少 #timeline-tooltip 样式")
        return

    if 'z-index: 3000' in css:
        t.ok("tooltip z-index 3000 > 遮罩层 2001")
    else:
        t.fail("tooltip z-index 未提升到 3000")


@suite.test("tooltip 视口边界翻转逻辑")
def _(t, flags):
    """验证两个时间线模块都有 _positionTooltip 边界翻转"""
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_js = open(tl_path, encoding='utf-8').read()
    tt_js = open(tt_path, encoding='utf-8').read()

    for name, js in (('timeline.js', tl_js), ('thread_timeline.js', tt_js)):
        if '_positionTooltip' in js:
            t.ok(f"{name} 包含 _positionTooltip")
        else:
            t.fail(f"{name} 缺少 _positionTooltip")
        if 'e.clientX - tw - MARGIN' in js:
            t.ok(f"{name} 支持右侧边界翻转")
        else:
            t.fail(f"{name} 缺少右侧边界翻转")
        if 'vh - th - 8' in js:
            t.ok(f"{name} 支持底部边界上移")
        else:
            t.fail(f"{name} 缺少底部边界上移")


@suite.test("关闭时间线时隐藏 tooltip")
def _(t, flags):
    """验证关闭时间线面板时会隐藏 tooltip 避免残留"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if js.count('timeline-tooltip') >= 2 and 'tip.style.display = \'none\'' in js:
        t.ok("关闭时间线时隐藏 tooltip")
    else:
        t.fail("关闭时间线时未隐藏 tooltip")


@suite.test("时间线联动-定位当前行按钮")
def _(t, flags):
    """验证时间线头部有 '定位当前行' 按钮且已绑定事件"""
    html_path = os.path.join(ROOT, 'index.html')
    app_path = os.path.join(ROOT, 'js', 'app.js')
    html = open(html_path, encoding='utf-8').read()
    app_js = open(app_path, encoding='utf-8').read()

    if 'btn-timeline-locate' in html:
        t.ok("时间线头部包含定位按钮")
    else:
        t.fail("缺少 btn-timeline-locate 按钮")

    if 'btn-timeline-locate' in app_js and 'locateInTimeline(entry)' in app_js:
        t.ok("定位按钮已绑定 locateInTimeline")
    else:
        t.fail("定位按钮未绑定 locateInTimeline")


@suite.test("时间线联动-closeTimelinePanel")
def _(t, flags):
    """验证 app.js 有 closeTimelinePanel 方法"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if 'closeTimelinePanel()' in js and 'timeline-tooltip' in js:
        t.ok("closeTimelinePanel 方法存在且隐藏 tooltip")
    else:
        t.fail("缺少 closeTimelinePanel 方法")


@suite.test("时间线联动-syncTimelineSelection")
def _(t, flags):
    """验证网格选中行 → 时间线标记同步逻辑"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if 'syncTimelineSelection()' in js and 'updateCurrentRow' in js:
        t.ok("syncTimelineSelection 方法存在")
    else:
        t.fail("缺少 syncTimelineSelection 方法")

    # 验证在 updateCurrentRow 中被调用
    idx = js.find('updateCurrentRow() {')
    if idx >= 0:
        # 在方法体内查找 syncTimelineSelection 调用
        body = js[idx:idx + 1200]
        if 'this.syncTimelineSelection()' in body:
            t.ok("updateCurrentRow 中同步时间线标记")
        else:
            t.fail("updateCurrentRow 未调用 syncTimelineSelection")
    else:
        t.fail("无法定位 updateCurrentRow")


@suite.test("时间线联动-点击条目跳转且不关闭面板")
def _(t, flags):
    """验证两个时间线点击条目后跳转日志，但面板保留（函数/方法视图不被掩盖）"""
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_js = open(tl_path, encoding='utf-8').read()
    tt_js = open(tt_path, encoding='utf-8').read()

    for name, js in (('timeline.js', tl_js), ('thread_timeline.js', tt_js)):
        if 'LogGrid.scrollToEntry(this.hoveredEntry)' in js:
            t.ok(f"{name} 点击条目跳转日志")
        else:
            t.fail(f"{name} 点击条目未跳转日志")
        if 'App.closeTimelinePanel()' not in js:
            t.ok(f"{name} 点击条目不关闭面板（保留函数视图）")
        else:
            t.fail(f"{name} 点击条目仍关闭面板")
        if '已定位到日志第' in js:
            t.ok(f"{name} 跳转后显示提示")
        else:
            t.fail(f"{name} 跳转后缺少提示")


@suite.test("时间线面板右侧停靠非模态")
def _(t, flags):
    """验证时间线面板右侧停靠且无模态遮罩"""
    css_path = os.path.join(ROOT, 'css', 'style.css')
    app_path = os.path.join(ROOT, 'js', 'app.js')
    css = open(css_path, encoding='utf-8').read()
    app_js = open(app_path, encoding='utf-8').read()

    # CSS：右侧停靠
    if '#timeline-panel {' in css and 'right: 0' in css and 'transform: none' in css:
        t.ok("时间线面板右侧停靠")
    else:
        t.fail("时间线面板未右侧停靠")

    # app.js：打开面板不再显示模态遮罩
    idx = app_js.find('toggleTimelinePanel(locateEntry) {')
    if idx >= 0:
        body = app_js[idx:idx + 800]
        if 'Utils.showOverlay()' not in body:
            t.ok("时间线面板非模态（无遮罩）")
        else:
            t.fail("时间线面板仍显示遮罩")
    else:
        t.fail("无法定位 toggleTimelinePanel")


@suite.test("时间线联动-选中标记绘制")
def _(t, flags):
    """验证两个时间线都有选中行标记绘制逻辑"""
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_js = open(tl_path, encoding='utf-8').read()
    tt_js = open(tt_path, encoding='utf-8').read()

    if '_selectedEntry' in tl_js and 'setSelectedEntry' in tl_js and 'locateEntry' in tl_js:
        t.ok("timeline.js 包含选中标记与定位方法")
    else:
        t.fail("timeline.js 缺少选中标记/定位方法")

    if '_selectedEntry' in tt_js and 'setSelectedEntry' in tt_js and 'locateEntry' in tt_js:
        t.ok("thread_timeline.js 包含选中标记与定位方法")
    else:
        t.fail("thread_timeline.js 缺少选中标记/定位方法")

    if '_drawSelectedMarker' in tt_js:
        t.ok("thread_timeline.js 绘制选中标记")
    else:
        t.fail("thread_timeline.js 缺少 _drawSelectedMarker")


@suite.test("时间线联动-tooltip 操作提示")
def _(t, flags):
    """验证 tooltip 有 '点击定位到左侧日志表格' 提示"""
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_js = open(tl_path, encoding='utf-8').read()
    tt_js = open(tt_path, encoding='utf-8').read()

    if '点击定位到左侧日志表格' in tl_js:
        t.ok("timeline.js tooltip 有操作提示")
    else:
        t.fail("timeline.js tooltip 缺少操作提示")

    if '点击定位到左侧日志表格' in tt_js:
        t.ok("thread_timeline.js tooltip 有操作提示")
    else:
        t.fail("thread_timeline.js tooltip 缺少操作提示")


@suite.test("时间线-label 列宽度拖拽")
def _(t, flags):
    """验证 source/label 列支持拖动宽度调整"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()

    if '_labelResizing' in js and '_labelDragStartW' in js:
        t.ok("包含 label 列拖拽状态")
    else:
        t.fail("缺少 label 列拖拽状态")

    if 'tl-label-width' in js:
        t.ok("label 宽度持久化到 localStorage")
    else:
        t.fail("label 宽度未持久化")

    if 'col-resize' in js:
        t.ok("label 边界显示拖拽光标")
    else:
        t.fail("label 边界缺少拖拽光标")

    if '_labelCache.clear()' in js and 'Math.max(90, Math.min(320' in js:
        t.ok("拖拽时清空标签缓存并限制宽度范围")
    else:
        t.fail("缺少宽度限制或标签缓存清空")

    if '_findVisibleRange' in js:
        t.ok("可视条目二分查找区间（避免遍历全部日志）")
    else:
        t.fail("缺少可视区间二分查找")


@suite.test("时间线-面板宽度拖拽")
def _(t, flags):
    """验证时间线面板支持拖动宽度并持久化"""
    html_path = os.path.join(ROOT, 'index.html')
    app_path = os.path.join(ROOT, 'js', 'app.js')
    css_path = os.path.join(ROOT, 'css', 'style.css')
    html = open(html_path, encoding='utf-8').read()
    app_js = open(app_path, encoding='utf-8').read()
    css = open(css_path, encoding='utf-8').read()

    if 'timeline-resizer' in html:
        t.ok("包含面板宽度手柄")
    else:
        t.fail("缺少 timeline-resizer")

    if 'tl-panel-width' in app_js:
        t.ok("面板宽度持久化到 localStorage")
    else:
        t.fail("面板宽度未持久化")

    if 'col-resize' in css and '#timeline-resizer' in css:
        t.ok("手柄样式定义")
    else:
        t.fail("缺少手柄样式")

    if 'Math.max(400' in app_js:
        t.ok("宽度有最小限制")
    else:
        t.fail("缺少宽度限制")


@suite.test("时间线-最小化与悬浮按钮")
def _(t, flags):
    """验证最小化保留视图状态、悬浮按钮恢复、点关闭才真正关闭"""
    html_path = os.path.join(ROOT, 'index.html')
    app_path = os.path.join(ROOT, 'js', 'app.js')
    css_path = os.path.join(ROOT, 'css', 'style.css')
    html = open(html_path, encoding='utf-8').read()
    app_js = open(app_path, encoding='utf-8').read()
    css = open(css_path, encoding='utf-8').read()

    if 'btn-timeline-minimize' in html:
        t.ok("包含最小化按钮")
    else:
        t.fail("缺少最小化按钮")

    if 'timeline-minimized-btn' in html:
        t.ok("包含悬浮恢复按钮")
    else:
        t.fail("缺少悬浮按钮")

    if 'minimizeTimelinePanel()' in app_js and 'restoreTimelinePanel()' in app_js:
        t.ok("包含最小化/恢复方法")
    else:
        t.fail("缺少最小化/恢复方法")

    if '_timelineMinimized' in app_js:
        t.ok("跟踪最小化状态")
    else:
        t.fail("缺少最小化状态标志")

    if 'timeline-minimized-btn' in css and 'position: fixed' in css:
        t.ok("悬浮按钮样式定义")
    else:
        t.fail("缺少悬浮按钮样式")

    # 最小化/关闭按钮应包在 .timeline-header-actions 中并固定到头部最右端，
    # 避免被 popup-header 的 space-between + flex-wrap 分散到诡异位置
    if 'timeline-header-actions' in html:
        t.ok("最小化/关闭按钮包在 timeline-header-actions 容器中")
    else:
        t.fail("缺少 timeline-header-actions 容器")

    if 'timeline-header-actions' in css and 'margin-left: auto' in css:
        t.ok("actions 容器推到头部最右端")
    else:
        t.fail("缺少 actions 容器右侧固定样式")


@suite.test("时间线-日期维度时间轴")
def _(t, flags):
    """验证时间轴跨天时显示日期维度（午夜分隔线 + 日期标签）"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    tt_js = open(tt_path, encoding='utf-8').read()
    tl_js = open(tl_path, encoding='utf-8').read()

    for name, js in (('thread_timeline.js', tt_js), ('timeline.js', tl_js)):
        if '86400000' in js and 'MM-dd' in js:
            t.ok(f"{name} 包含日期维度时间轴逻辑")
        else:
            t.fail(f"{name} 缺少日期维度逻辑")
        if 'setLineDash' in js or 'MM-dd HH:mm' in js or 'firstMidnight' in js:
            t.ok(f"{name} 跨天午夜分隔/日期标签")
        else:
            t.fail(f"{name} 缺少午夜分隔或日期标签")
        if 'HH:mm:ss' in js:
            t.ok(f"{name} 保留时钟格式回退")
        else:
            t.fail(f"{name} 缺少时钟格式")


@suite.test("时间线-仅重绘激活模式")
def _(t, flags):
    """验证 _resizeActiveTimeline 只重绘当前激活模式，避免共用 canvas 互相覆盖"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if '_resizeActiveTimeline()' in js:
        t.ok("包含 _resizeActiveTimeline 方法")
    else:
        t.fail("缺少 _resizeActiveTimeline 方法")

    # 不应同时调用两个 resize
    if js.count('ThreadTimeline.resize();\n        Timeline.resize()') == 0:
        t.ok("不再同时重绘两个模式")
    else:
        t.fail("仍同时重绘两个模式，可能互相覆盖")


@suite.test("过滤-线程匹配 thread 或 tid")
def _(t, flags):
    """验证 threadFilter 同时匹配 thread 和 tid，避免时间线点击后背景日志为空"""
    filter_path = os.path.join(ROOT, 'js', 'filter.js')
    js = open(filter_path, encoding='utf-8').read()

    if 'threadRe.test(e.thread)' in js and 'threadRe.test(e.tid)' in js:
        t.ok("线程过滤同时匹配 thread 和 tid")
    else:
        t.fail("线程过滤未匹配 tid")


@suite.test("过滤-方法名精确过滤")
def _(t, flags):
    """验证 methodFilter 按提取的方法名精确匹配（解决 source 格式差异导致空日志）"""
    filter_path = os.path.join(ROOT, 'js', 'filter.js')
    utils_path = os.path.join(ROOT, 'js', 'utils.js')
    js = open(filter_path, encoding='utf-8').read()
    ujs = open(utils_path, encoding='utf-8').read()

    if 'methodFilter' in js and 'methodFilter: \'\'' in js:
        t.ok("filter.js 包含 methodFilter 状态")
    else:
        t.fail("filter.js 缺少 methodFilter 状态")

    if 'Utils.extractMethodName(e.source)' in js:
        t.ok("apply() 使用 Utils.extractMethodName 匹配方法")
    else:
        t.fail("apply() 未使用方法名匹配")

    if 'extractMethodName' in ujs:
        t.ok("Utils.extractMethodName 已提取到公共工具")
    else:
        t.fail("缺少 Utils.extractMethodName")


@suite.test("时间线-点击联动过滤同步")
def _(t, flags):
    """验证时间线点击/进入详情/PID选择 会同步背景日志过滤"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()

    if 'LogFilter.state.methodFilter = name' in js:
        t.ok("点击方法标签设置 methodFilter")
    else:
        t.fail("点击方法标签未设置 methodFilter")

    if 'LogFilter.state.threadFilter = Utils.escapeRegex(threadName)' in js:
        t.ok("进入线程详情同步 threadFilter")
    else:
        t.fail("进入线程详情未同步 threadFilter")

    if 'LogFilter.state.pidFilter !== pid' in js:
        t.ok("PID 选择同步 pidFilter 到网格")
    else:
        t.fail("PID 选择未同步网格")


@suite.test("时间线-关闭时恢复过滤状态")
def _(t, flags):
    """验证关闭时间线面板时恢复打开前的网格过滤状态"""
    app_path = os.path.join(ROOT, 'js', 'app.js')
    js = open(app_path, encoding='utf-8').read()

    if '_tlFilterBackup' in js:
        t.ok("打开时间线时备份过滤状态")
    else:
        t.fail("缺少过滤状态备份")

    if 'Object.assign(LogFilter.state, this._tlFilterBackup)' in js:
        t.ok("关闭时间线时恢复过滤状态")
    else:
        t.fail("关闭时未恢复过滤状态")


@suite.test("时间线-主题适配")
def _(t, flags):
    """验证时间线画布跟随明暗主题（使用 CSS 变量）"""
    utils_path = os.path.join(ROOT, 'js', 'utils.js')
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    app_path = os.path.join(ROOT, 'js', 'app.js')
    ujs = open(utils_path, encoding='utf-8').read()
    tt_js = open(tt_path, encoding='utf-8').read()
    tl_js = open(tl_path, encoding='utf-8').read()
    app_js = open(app_path, encoding='utf-8').read()

    if 'getCSSVar' in ujs:
        t.ok("Utils.getCSSVar 读取主题变量")
    else:
        t.fail("缺少 Utils.getCSSVar")

    for name, js in (('thread_timeline.js', tt_js), ('timeline.js', tl_js)):
        if '_refreshTheme' in js and '_tc' in js and 'onThemeChange' in js:
            t.ok(f"{name} 包含主题刷新与重绘")
        else:
            t.fail(f"{name} 缺少主题刷新机制")

    if '--levelColors' in tt_js or '_levelColors' in tt_js:
        t.ok("thread_timeline 级别颜色主题化")
    else:
        t.fail("thread_timeline 级别颜色未主题化")

    if '_levelColors' in tl_js and 'getLevelColor' in tl_js:
        t.ok("timeline.js 级别颜色主题化")
    else:
        t.fail("timeline.js 级别颜色未主题化")

    if 'ThreadTimeline.onThemeChange()' in app_js and 'Timeline.onThemeChange()' in app_js:
        t.ok("主题切换触发时间线重绘")
    else:
        t.fail("主题切换未通知时间线")


@suite.test("时间线-label 列拖拽手柄")
def _(t, flags):
    """验证 label 列宽度拖拽的可见手柄与防误触"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()

    if '_drawLabelResizeHandle' in js:
        t.ok("绘制可见的拖拽手柄")
    else:
        t.fail("缺少拖拽手柄绘制")

    if '_suppressClick' in js:
        t.ok("拖拽结束抑制误触 click")
    else:
        t.fail("缺少防误触标志")

    if 'Math.abs(x - this.LABEL_WIDTH) <= 8' in js:
        t.ok("拖拽热区扩大至 8px")
    else:
        t.fail("拖拽热区未扩大")

    if '重置 label 列宽' in js:
        t.ok("双击边界重置列宽")
    else:
        t.fail("缺少双击重置列宽")


def _extract_js_func_body(src, needle):
    """从 JS 源码提取 `needle` 函数的函数体"""
    idx = src.find(needle)
    if idx < 0:
        return None
    brace = src.find('{', idx)
    if brace < 0:
        return None
    depth = 0
    end = brace
    for i in range(brace, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    return src[brace + 1:end - 1].strip()


@suite.test("时间线-自适应时间刻度")
def _(t, flags):
    """验证放大后刻度不消失（自适应可视窗口），Node.js 执行验证"""
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    if '_getTimeTicks' not in js:
        t.fail("缺少 _getTimeTicks 方法")
        return
    t.ok("包含 _getTimeTicks 自适应刻度方法")

    ticks_body = _extract_js_func_body(js, '_getTimeTicks() {')
    fmt_body = _extract_js_func_body(js, '_getTickFormat(step, visibleRange) {')
    if not ticks_body or not fmt_body:
        t.fail("无法提取刻度函数体")
        return

    test_code = """
const obj = {
  minTime: 1700000000000,
  maxTime: 1700000003600,   // 60 分钟跨度
  timeRange: 3600000,
  zoomLevel: 1,
  _getTickFormat: function(step, visibleRange) {
%s
  },
  _getTimeTicks: function() {
%s
  },
};
let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('FAIL: ' + msg); }
}

// 1) 默认缩放：刻度跨越整个时间范围，数量合理
const t1 = obj._getTimeTicks();
check(t1.length >= 4 && t1.length <= 20, '默认缩放刻度数量=' + t1.length);

// 2) 放大 80 倍：可视窗口 ~45ms，仍应有刻度（旧逻辑会消失）
obj.zoomLevel = 80;
const t2 = obj._getTimeTicks();
const winStart = obj.minTime, winEnd = obj.minTime + obj.timeRange / obj.zoomLevel;
let vis = t2.filter(x => x.t >= winStart && x.t <= winEnd);
check(vis.length >= 2, '放大后可视刻度数量=' + vis.length + '（旧逻辑为 0）');
const step2 = (t2.length >= 2) ? (t2[1].t - t2[0].t) : 0;
check(step2 <= 60000, '放大后刻度步长应明显缩小, step=' + step2);

// 3) 缩小到 0.05：刻度范围应覆盖超出数据范围的视口
obj.zoomLevel = 0.05;
const t3 = obj._getTimeTicks();
const maxTick = Math.max(...t3.map(x => x.t));
check(maxTick > obj.maxTime + obj.timeRange * 0.3, '缩小后刻度覆盖视口右侧, maxTick=' + maxTick);

// 4) 格式：毫秒级刻度带 SSS，天级刻度为 MM-dd
check(obj._getTickFormat(500, 3600000) === 'HH:mm:ss.SSS', '毫秒级格式');
check(obj._getTickFormat(86400000, 86400000) === 'MM-dd', '天级格式');
check(obj._getTickFormat(7200000, 86400000 * 2) === 'MM-dd HH:mm', '跨天小时格式');
check(obj._getTickFormat(60000, 600000) === 'HH:mm', '分钟内格式');

console.log('PASS:' + pass + ' FAIL:' + fail);
"""
    test_code = test_code % (fmt_body, ticks_body)
    proc = subprocess.run(['node', '-e', test_code], capture_output=True, text=True, timeout=10)

    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr}")
        return
    output = proc.stdout.strip()
    if 'FAIL:0' in output:
        m = re.search(r'PASS:(\d+)', output)
        t.ok(f"自适应刻度逻辑通过 ({m.group(1)} 个断言)")
    else:
        for line in output.split('\n'):
            if line.startswith('FAIL:'):
                t.fail(line)
        t.fail("自适应刻度部分断言失败")


@suite.test("时间线-区域化交互")
def _(t, flags):
    """验证缩放与滚动按区域分离：绘图区滚轮缩放、标签列滚轮滚动"""
    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    if '_dragMode' in js and "'vscroll'" in js and "'hpan'" in js:
        t.ok("拖拽按区域区分（绘图区平移/标签列滚动）")
    else:
        t.fail("缺少区域化拖拽")

    if 'overLabel' in js and 'contentH > viewH' in js:
        t.ok("标签列滚轮垂直滚动")
    else:
        t.fail("标签列滚轮未滚动")

    if '绘图区：滚轮 = 缩放时间轴' in js:
        t.ok("绘图区滚轮直接缩放")
    else:
        t.fail("绘图区滚轮未缩放")

    # 不再有"无溢出时 = 缩放"的歧义分支
    if '无溢出时 = 缩放' not in js:
        t.ok("已移除无溢出即缩放的分支（消除滚动/缩放歧义）")
    else:
        t.fail("仍存在无溢出即缩放分支")

    # Ctrl/Cmd 缩放锚点钳制到绘图区起点，避免标签列触发异常偏移
    if 'Math.max(labelEnd, mx)' in js:
        t.ok("Ctrl+滚轮缩放锚点钳制到绘图区")
    else:
        t.fail("缺少缩放锚点钳制")


@suite.test("时间线-刻度绘制使用自适应逻辑")
def _(t, flags):
    """验证网格线与时间轴都改用自适应刻度，不再使用固定 tickCount"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    tt_js = open(tt_path, encoding='utf-8').read()
    tl_js = open(tl_path, encoding='utf-8').read()

    if 'Math.floor(8 / this.zoomLevel)' not in tt_js and 'Math.floor(8 / this.zoomLevel)' not in tl_js:
        t.ok("已移除固定 tickCount（放大后刻度不再消失）")
    else:
        t.fail("仍存在固定 tickCount 逻辑")

    for name, js in (('thread_timeline.js', tt_js), ('timeline.js', tl_js)):
        if '_getTimeTicks()' in js and 'const ticks = this._getTimeTicks()' in js:
            t.ok(f"{name} 使用自适应刻度")
        else:
            t.fail(f"{name} 未使用自适应刻度")


@suite.test("时间线-模式事件隔离")
def _(t, flags):
    """验证线程/级别共用 canvas 时事件按激活模式隔离，避免双击/双缩放"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    tl_path = os.path.join(ROOT, 'js', 'timeline.js')
    tt_js = open(tt_path, encoding='utf-8').read()
    tl_js = open(tl_path, encoding='utf-8').read()

    if "_isActive()" in tt_js and "dataset.mode === 'thread'" in tt_js:
        t.ok("ThreadTimeline 事件仅在线程模式激活时生效")
    else:
        t.fail("ThreadTimeline 缺少模式隔离")

    if "_isActive()" in tl_js and "dataset.mode === 'level'" in tl_js:
        t.ok("Timeline 事件仅在级别模式激活时生效")
    else:
        t.fail("Timeline 缺少模式隔离")

    # 两个模块的画布事件处理器都应先检查激活状态
    if tt_js.count("if (!this._isActive()) return;") >= 5:
        t.ok("ThreadTimeline 画布/按钮事件全部隔离")
    else:
        t.fail("ThreadTimeline 事件隔离不完整")

    if tl_js.count("if (!this._isActive()) return;") >= 5:
        t.ok("Timeline 画布/按钮事件全部隔离")
    else:
        t.fail("Timeline 事件隔离不完整")


@suite.test("时间线-索引化数据查找")
def _(t, flags):
    """验证名称/条目索引（Map）替代线性查找，提升大量日志性能"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()

    for key, desc in (('_threadIndex', '线程名称索引'),
                      ('_methodIndex', '方法名称索引'),
                      ('_entryLane', '条目泳道索引')):
        if key in js:
            t.ok(f"包含 {desc} (Map 查找)")
        else:
            t.fail(f"缺少 {desc}")

    # 绘制热路径不应再使用线性 find/includes
    hot_codes = ['_drawItem', '_findEntryAt', '_drawSelectedMarker', 'locateEntry']
    for code in hot_codes:
        idx = js.find(code)
        if idx < 0:
            t.fail(f"缺少 {code}")
            continue
        seg = js[idx:idx + 1200]
        if '.find(' not in seg and '.entries.includes(' not in seg:
            t.ok(f"{code} 使用索引查找（无线性扫描）")
        else:
            t.fail(f"{code} 仍存在线性查找")


@suite.test("时间线-位置归一化与可视区间")
def _(t, flags):
    """验证位置存归一化时间，且绘制只处理可视条目区间"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()

    if '_findVisibleRange' in js:
        t.ok("包含可视区间二分查找")
    else:
        t.fail("缺少可视区间二分查找")

    # 位置与列宽解耦：归一化时间，列宽/面板宽度变化无需重算
    if "positions[j] = (e.date.getTime() - this.minTime) / this.timeRange" in js:
        t.ok("位置归一化为时间比例（列宽无关）")
    else:
        t.fail("位置未归一化")

    if 'if (this._precomputedPlotW !== plotW) this._precomputePositions()' not in js:
        t.ok("绘制路径不再按列宽重算位置")
    else:
        t.fail("绘制路径仍按列宽重算位置")


@suite.test("时间线-label 文字自适应与悬停提示")
def _(t, flags):
    """验证 source 列文字按可用宽度截断、悬停显示完整名称"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()

    if '_labelCache' in js:
        t.ok("标签截断结果缓存（避免每帧 measureText）")
    else:
        t.fail("缺少标签截断缓存")

    if 'ctx.measureText(name).width <= availW' in js:
        t.ok("按像素宽度判断是否需要截断（不再固定 20 字符）")
    else:
        t.fail("仍使用固定字符数截断")

    if 'name.length > 20' not in js or 'name.slice(0, 19)' not in js:
        t.ok("已移除固定 20 字符截断")
    else:
        t.fail("仍存在固定 20 字符截断")

    if '点击过滤 · 双击查看方法' in js:
        t.ok("标签列悬停显示完整名称与操作提示")
    else:
        t.fail("缺少标签列悬停提示")


@suite.test("时间线-tooltip 节流与方法缓存")
def _(t, flags):
    """验证 tooltip 内容只在变化时重建、方法名解析缓存到条目"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()

    if 'this._tooltipEntry' in js:
        t.ok("tooltip 内容按条目变化重建")
    else:
        t.fail("缺少 tooltip 节流")

    if 'entry._methodName === undefined' in js:
        t.ok("方法名解析缓存到条目")
    else:
        t.fail("缺少方法名缓存")


@suite.test("时间线-可视区间二分查找正确性")
def _(t, flags):
    """Node.js 执行验证 _findVisibleRange 返回正确的可视条目区间"""
    tt_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(tt_path, encoding='utf-8').read()
    body = _extract_js_func_body(js, '_findVisibleRange(pos, n, worldLo, worldHi) {')
    if not body:
        t.fail("无法提取 _findVisibleRange")
        return

    test_code = """
const obj = { _findVisibleRange: function(pos, n, worldLo, worldHi) {
%s
} };
let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('FAIL: ' + msg); }
}
// 构造 0..99 共 100 个归一化时间位置
const pos = new Float64Array(100);
for (let i = 0; i < 100; i++) pos[i] = i / 100;
let r;
// 全范围
r = obj._findVisibleRange(pos, 100, -1, 2);
check(r[0] === 0 && r[1] === 100, '全范围 ' + JSON.stringify(r));
// 中间窗口 [0.30, 0.65)
r = obj._findVisibleRange(pos, 100, 0.30, 0.65);
check(r[0] === 30 && r[1] === 66, '中间窗口 ' + JSON.stringify(r));
// 空窗口（在数据之后）
r = obj._findVisibleRange(pos, 100, 1.5, 2.0);
check(r[0] === 100 && r[1] === 100, '空窗口右侧 ' + JSON.stringify(r));
// 空窗口（在数据之前）
r = obj._findVisibleRange(pos, 100, -2, -1);
check(r[0] === 0 && r[1] === 0, '空窗口左侧 ' + JSON.stringify(r));
// 边界包含
r = obj._findVisibleRange(pos, 100, 0, 0.05);
check(r[0] === 0 && r[1] === 6, '左边界 ' + JSON.stringify(r));
// 随机抽样交叉验证
for (let k = 0; k < 200; k++) {
  const a = Math.random() * 1.2 - 0.1;
  const b = a + Math.random() * 1.0;
  r = obj._findVisibleRange(pos, 100, a, b);
  // 暴力验证
  let lo = 0;
  while (lo < 100 && pos[lo] < a) lo++;
  let hi = lo;
  while (hi < 100 && pos[hi] <= b) hi++;
  if (r[0] !== lo || r[1] !== hi) {
    fail++;
    console.log('FAIL: 随机窗口 a=' + a.toFixed(3) + ' b=' + b.toFixed(3) + ' got=' + JSON.stringify(r) + ' want=' + JSON.stringify([lo, hi]));
  } else pass++;
}
console.log('PASS:' + pass + ' FAIL:' + fail);
"""
    test_code = test_code % body
    proc = subprocess.run(['node', '-e', test_code], capture_output=True, text=True, timeout=10)

    if proc.returncode != 0:
        t.fail(f"Node.js 执行失败: {proc.stderr}")
        return
    output = proc.stdout.strip()
    if 'FAIL:0' in output:
        m = re.search(r'PASS:(\d+)', output)
        t.ok(f"可视区间二分查找正确 ({m.group(1)} 个断言)")
    else:
        for line in output.split('\n'):
            if line.startswith('FAIL:'):
                t.fail(line)
        t.fail("可视区间二分查找部分断言失败")