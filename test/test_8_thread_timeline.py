"""test_8_thread_timeline.py — PID提取、线程时间线、视图管理器 测试用例"""

import os
import re
import subprocess

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


# ===== JS 文件完整性 =====

@suite.test("新增 JS 文件完整性")
def _(t, flags):
    """验证新增 JS 文件存在且结构完整"""
    new_files = [
        ('js/thread_timeline.js', 'ThreadTimeline'),
        ('js/view_manager.js', 'ViewManager'),
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
        ('_buildTimeRange', '时间范围计算'),
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
            if depth <= 10:
                t.ok(f"视图深度限制 = {depth} (合理)")
            else:
                t.fail(f"视图深度限制过大: {depth}")

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

    # 段块命中检测
    if 'pos[hi]' in js and 'pos[lo]' in js and 'px > pos[hi]' in js:
        t.ok("段块命中检测 (pos[hi] < px < pos[lo])")
    else:
        t.fail("缺少段块命中检测")

    # 边缘命中检测
    if 'pos[hi] + hr' in js or 'pos[0] - hr' in js:
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

    if "split('.')" in js:
        t.ok("_extractMethod 使用点号分割")
    else:
        t.fail("_extractMethod 未使用点号分割")

    if "slice(-2)" in js:
        t.ok("_extractMethod 取最后两段作为方法标识")
    else:
        t.fail("_extractMethod 未取最后两段")

    if "'(unknown)'" in js:
        t.ok("空 source 返回 '(unknown)'")
    else:
        t.fail("缺少空 source 处理")

    # file:func:linenum 格式支持
    if "includes(':')" in js:
        t.ok("_extractMethod 支持 file:func:linenum 格式")
    else:
        t.fail("_extractMethod 缺少冒号格式支持")

    if "split(':')" in js:
        t.ok("_extractMethod 使用冒号分割")
    else:
        t.fail("_extractMethod 未使用冒号分割")

    if "funcPart" in js:
        t.ok("_extractMethod 提取 funcPart")
    else:
        t.fail("_extractMethod 缺少 funcPart 提取")

    if "className" in js:
        t.ok("_extractMethod 提取 className")
    else:
        t.fail("_extractMethod 缺少 className 提取")

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
    """验证 _extractMethod 对各种 source 格式的提取结果"""

    js_path = os.path.join(ROOT, 'js', 'thread_timeline.js')
    js = open(js_path, encoding='utf-8').read()

    # 提取 _extractMethod 函数体
    func_start = js.find('_extractMethod(entry)')
    if func_start < 0:
        t.fail("无法定位 _extractMethod 函数")
        return
    # 找到函数体开始的大括号
    brace_start = js.find('{', func_start)
    if brace_start < 0:
        t.fail("无法定位 _extractMethod 函数体开始")
        return
    # 从 brace_start 开始，手动匹配大括号
    depth = 0
    func_end = brace_start
    for i in range(brace_start, len(js)):
        if js[i] == '{':
            depth += 1
        elif js[i] == '}':
            depth -= 1
            if depth == 0:
                func_end = i + 1
                break
    func_body = js[brace_start + 1:func_end - 1].strip()

    # 用 Node.js 执行测试
    test_code = """
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
const _extractMethod = function(entry) {
%s
};
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
    if 'for (const e of t.entries)' in js:
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