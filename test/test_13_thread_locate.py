"""test_13_thread_locate.py — 同线程过滤并定位（Alt+T / Alt+Shift+T）测试用例

覆盖：
  - 动作方法（独占/叠加双模式、快照式撤销、输入框同步）
  - 独占语义（退出视图 + 清其他条件 + 时间线联动）
  - 入口（详情面板按钮 + 快捷键与焦点守卫）
"""

import os

from test_runner import ROOT, TestSuite

suite = TestSuite("同线程过滤并定位")


def _app_js():
    return open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()


@suite.test("动作方法：双模式 + 原始线程名 + 定位")
def _(t, flags):
    js = _app_js()
    t.check('locateSameThread(additive)' in js, "存在 locateSameThread(additive) 方法")
    t.check('entry.thread || entry.tid' in js, "取线程键 thread 优先、tid 回退")
    t.check('st.threadFilter = key' in js, "线程键原样写入 state（转义交由 buildRegex 统一处理）")
    t.check('Utils.escapeRegex(st.threadFilter)' not in js,
            "不对已存入的线程值二次转义（避免含元字符线程名匹配为 0）")
    t.check('LogGrid.scrollToEntry(entry)' in js, "过滤后定位回当前行")
    t.check("'该日志无线程信息'" in js, "无线程时提示")
    t.check("'请先选择一条日志'" in js, "未选中行时提示")


@suite.test("独占模式：退出视图 + 清其他条件")
def _(t, flags):
    js = _app_js()
    t.check('ViewManager.isInView()' in js and 'ViewManager.clear()' in js,
            "独占时退出当前视图")
    for field in ['searchText', 'pidFilter', 'sourceFilter', 'messageFilter',
                  'methodFilter', 'sourceFileFilter', 'timeFrom', 'timeTo']:
        t.check(f'st.{field} = ' in js, f"独占清空 {field}")
    t.check('st.threadFilter = key' in js, "最终仅保留线程过滤")
    t.check('LogFilter.resetSearch()' in js, "重置搜索匹配状态")


@suite.test("叠加模式：保留现有条件")
def _(t, flags):
    js = _app_js()
    t.check('if (!additive) {' in js, "独占逻辑受 !additive 守护")
    t.check("'已叠加线程过滤（原条件保留）'" in js, "叠加模式提示文案")
    t.check("'仅显示该线程日志'" in js, "独占模式提示文案")
    t.check('再次触发可撤销' in js, "提示可撤销")


@suite.test("快照式撤销（Toggle）")
def _(t, flags):
    js = _app_js()
    t.check('_threadLocateBackup' in js, "记录触发前快照")
    t.check('JSON.parse(JSON.stringify(st))' in js, "快照为深拷贝")
    t.check('Object.assign(st, this._threadLocateBackup)' in js, "再次触发时整体恢复快照")
    t.check("st.threadFilter === key && this._threadLocateBackup" in js,
            "以线程过滤值判断是否撤销")
    t.check("'已恢复触发前的过滤条件'" in js, "撤销提示")


@suite.test("过滤栏输入框同步")
def _(t, flags):
    js = _app_js()
    t.check('_syncFilterInputsFromState()' in js, "存在输入框同步方法")
    for frag, desc in [
        ("setVal('filter-pid'", '进程过滤输入框'),
        ("setVal('filter-source'", '来源过滤输入框'),
        ("setVal('filter-message'", '消息过滤输入框'),
        ("setVal('filter-time-from'", '开始时间'),
        ("setVal('filter-time-to'", '结束时间'),
        ("document.getElementById('filter-thread')", '线程过滤输入框'),
        ("document.querySelectorAll('.filter-chip')", '级别 chips'),
    ]:
        t.check(frag in js, f"同步 {desc}")
    t.check('_threadLocateKey' in js, "线程名原始值（输入框展示用）")


@suite.test("入口：详情面板按钮")
def _(t, flags):
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    js = _app_js()
    t.check('id="btn-locate-thread"' in html, "index.html 含「同线程定位」按钮")
    t.check('🧵 同线程定位' in html, "按钮文案正确")
    t.check('Alt+T' in html and 'Alt+Shift+T' in html, "tooltip 说明两种键位")
    t.check("getElementById('btn-locate-thread')" in js, "app.js 绑定按钮")
    t.check("locateSameThread(false)" in js, "按钮默认走独占模式")


@suite.test("入口：快捷键 Alt+T / Alt+Shift+T")
def _(t, flags):
    js = _app_js()
    t.check("e.altKey && e.code === 'KeyT'" in js, "Alt+T 快捷键（e.code 兼容 macOS）")
    t.check('this.locateSameThread(!!e.shiftKey)' in js, "Shift 修饰切换叠加模式")
    t.check("tag === 'INPUT' || tag === 'TEXTAREA'" in js, "输入框聚焦时不触发")
    t.check('isContentEditable' in js, "可编辑元素聚焦时不触发")


@suite.test("联动：线程时间线刷新")
def _(t, flags):
    js = _app_js()
    t.check('ThreadTimeline._refreshFromPidSelect()' in js,
            "独占清除 pidFilter 后刷新线程时间线数据源")
    t.check("activeMode.dataset.mode === 'thread'" in js, "仅线程模式需要刷新")
