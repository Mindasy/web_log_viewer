"""test_15_view_filter_alignment.py — 视图与过滤逻辑对齐测试用例

覆盖（回归 视图功能 ↔ 过滤功能 的逻辑冲突）：
  - 视图快照全量化：曾被遗漏的 source/message/method/file/时间 等条件不再跨视图残留
  - 视图快照恢复含级别(levels)，消除只写不读的死字段
  - 视图导航统一收尾：退出/切换视图时失效线程定位撤销快照
  - 视图内编辑过滤条件固化到当前视图快照
  - 过滤栏输入框同步覆盖搜索框
  - 线程过滤去除二次转义（含正则元字符的线程名不再匹配为 0）
"""

import os

from test_runner import ROOT, TestSuite

suite = TestSuite("视图-过滤对齐")

VM = None


def _vm():
    global VM
    if VM is None:
        VM = open(os.path.join(ROOT, 'js', 'view_manager.js'), encoding='utf-8').read()
    return VM


def _app():
    return open(os.path.join(ROOT, 'js', 'app.js'), encoding='utf-8').read()


def _seg(js, marker, size):
    idx = js.find(marker)
    return js[idx:idx + size] if idx >= 0 else ''


@suite.test("快照全量化：覆盖全部结构性过滤字段")
def _(t, flags):
    js = _vm()
    t.check('SNAPSHOT_KEYS' in js, "定义视图快照字段集合 SNAPSHOT_KEYS")
    keys = _seg(js, 'SNAPSHOT_KEYS: [', 320)
    for field in ['pidFilter', 'threadFilter', 'sourceFilter', 'messageFilter',
                  'methodFilter', 'sourceFileFilter', 'timeFrom', 'timeTo',
                  'sortColumn', 'sortDirection']:
        t.check(f"'{field}'" in keys, f"快照包含 {field}")
    for m in ['_captureSnapshot', '_restoreSnapshot', '_clearFilterState', 'captureToCurrentView']:
        t.check(f'{m}(' in js, f"存在快照方法 {m}")


@suite.test("快照恢复含级别，消除 levelFilter 死字段")
def _(t, flags):
    js = _vm()
    restore = _seg(js, '_restoreSnapshot(snap) {', 400)
    t.check('st.levels = ' in restore, "恢复快照时回写 levels")
    clear = _seg(js, '_clearFilterState() {', 400)
    t.check('st.levels[k] = true' in clear, "清空时复位全部级别")
    t.check('levelFilter' not in js, "不再残留只写不读的 levelFilter 死字段")


@suite.test("应用视图：整体恢复快照并载入视图数据")
def _(t, flags):
    js = _vm()
    apply_seg = _seg(js, '_applyView() {', 500)
    t.check('this._restoreSnapshot(view.snapshot)' in apply_seg, "_applyView 整体恢复快照")
    t.check('App.setViewData(view.entries)' in apply_seg, "_applyView 载入视图数据")
    push_seg = _seg(js, 'pushView(name, entries, filterSnapshot) {', 900)
    t.check('this._captureSnapshot(filterSnapshot)' in push_seg, "pushView 固化过滤快照")
    t.check('App.setViewData(this.stack[this.currentIndex].entries)' in push_seg,
            "pushView 载入视图数据")


@suite.test("视图导航统一失效线程定位快照")
def _(t, flags):
    vm = _vm()
    app = _app()
    oc = _seg(app, 'onViewChanged() {', 400)
    t.check('this._threadLocateBackup = null;' in oc, "onViewChanged 作废撤销快照")
    t.check("this._threadLocateKey = '';" in oc, "onViewChanged 清空线程定位键")
    t.check('_syncFilterInputsFromState()' in oc, "onViewChanged 同步过滤栏输入框")
    svd = _seg(app, 'setViewData(entries) {', 200)
    t.check('this.onViewChanged();' in svd, "setViewData 走统一收尾")
    reset = _seg(vm, '_resetToGlobal() {', 400)
    t.check('this._clearFilterState()' in reset and 'App.onViewChanged()' in reset,
            "退出视图回全局时清空过滤并统一收尾")
    clr = _seg(vm, 'clear() {', 400)
    t.check('App.onViewChanged()' in clr, "clear() 统一收尾")


@suite.test("视图内编辑过滤条件固化到当前视图快照")
def _(t, flags):
    app = _app()
    vm = _vm()
    ref = _seg(app, 'refresh() {', 600)
    t.check('ViewManager.captureToCurrentView()' in ref, "refresh 视图内固化快照")
    cap = _seg(vm, 'captureToCurrentView() {', 300)
    t.check('this.stack[this.currentIndex].snapshot = this._captureSnapshot()' in cap,
            "captureToCurrentView 写回当前视图快照")


@suite.test("过滤栏输入框同步覆盖搜索框")
def _(t, flags):
    app = _app()
    sync = _seg(app, '_syncFilterInputsFromState() {', 500)
    t.check("setVal('search-input', st.searchText)" in sync, "同步搜索输入框")


@suite.test("线程过滤去除二次转义")
def _(t, flags):
    app = _app()
    filter_js = open(os.path.join(ROOT, 'js', 'filter.js'), encoding='utf-8').read()
    t.check('st.threadFilter = key' in app, "线程键以原始值写入 state")
    t.check('Utils.escapeRegex(st.threadFilter)' not in app, "不对已存入的线程值二次转义")
    build = _seg(filter_js, 'buildRegex(text) {', 300)
    t.check('Utils.escapeRegex(text)' in build, "转义统一在 buildRegex 中完成")
