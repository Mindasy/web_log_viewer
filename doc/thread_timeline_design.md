# 线程时间线可视化 + 视图模式 — 详细设计

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  index.html                                                     │
│  ┌──────────┐ ┌──────────────────────────────────────────────┐  │
│  │ toolbar  │ │ [视图面包屑: 全部 > PID:1234 > "error" > ...] │  │
│  └──────────┘ └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ filter-bar (搜索框 + 级别chips + 高级过滤含PID)              ││
│  └──────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ main-container                                               ││
│  │ ┌─────────┐ ┌──────────────────┐ ┌────────────────────────┐ ││
│  │ │ files   │ │ log-panel        │ │ detail-panel           │ ││
│  │ │ panel   │ │ (grid)           │ │                        │ ││
│  │ └─────────┘ └──────────────────┘ └────────────────────────┘ ││
│  └──────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ status-bar                                                   ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ Thread Timeline Panel (popup-panel, large-popup)             ││
│  │ ┌────────────────────────────────────────────────────────┐   ││
│  │ │ header: [PID选择器▼] [线程搜索] [🔍+][🔍-][↔适应][✕]  │   ││
│  │ ├────────────────────────────────────────────────────────┤   ││
│  │ │ canvas (泳道图)                                        │   ││
│  │ │ ┌──────┬───────────────────────────────────────────┐   │   ││
│  │ │ │thread│  ●  ●   ●● ●    ●     ●  ●   ●           │   │   ││
│  │ │ │  A   │───────────────────────────────────────────│   │   ││
│  │ │ │thread│     ●   ●  ●   ●●   ●     ●              │   │   ││
│  │ │ │  B   │───────────────────────────────────────────│   │   ││
│  │ │ │thread│  ●     ●     ●   ●  ●●  ●                │   │   ││
│  │ │ │  C   │───────────────────────────────────────────│   │   ││
│  │ │ └──────┴───────────────────────────────────────────┘   │   ││
│  │ │        ├─────┼─────┼─────┼─────┼─────┼─────→ 时间轴  │   ││
│  │ └────────────────────────────────────────────────────────┘   ││
│  │ tooltip (fixed)                                              ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 模块关系

```
app.js
  ├── ViewManager (新建)     — 视图栈、面包屑、视图切换
  ├── ThreadTimeline (新建)  — 线程时间线 Canvas 渲染
  ├── Timeline (已有)        — 保留不变，级别时间线
  ├── LogGrid (已有)         — 表格渲染，scrollToEntry()
  ├── LogFilter (修改)       — 新增 pidFilter，支持视图范围过滤
  ├── LogParser (修改)       — 智能 PID 提取
  └── Utils (已有)           — 工具函数
```

---

## 2. 模块一：PID 智能提取

### 2.1 问题

`pid`/`tid` 仅在 `bracketLog` 预设中有值，其他格式（log4j/log4j2/generic/apache/syslog/json）中为空。需要从 `entry.raw` 中智能提取。

### 2.2 设计

在 `parser.js` 中新增 `_extractPidTid(line)` 函数，在 `genericParse()` 和 `createRegexParser()` 返回前调用，填充 `pid`/`tid`（如果尚未填充）。

```javascript
// parser.js 新增

// PID/TID 智能提取模式（按优先级）
PID_TID_PATTERNS: [
  // [12345] 方括号包裹的纯数字 → PID
  { regex: /\[(\d{4,7})\]/, field: 'pid' },
  // pid=12345 或 PID=12345
  { regex: /\b[Pp][Ii][Dd][=:]\s*(\d+)/, field: 'pid' },
  // process 12345 或 processId=12345
  { regex: /\bprocess(?:Id)?[=:]\s*(\d+)/i, field: 'pid' },
  // [tid=123] 或 [TID=123]
  { regex: /\[[Tt][Ii][Dd][=:]\s*(\d+)\]/, field: 'tid' },
  // tid=123 或 TID=123
  { regex: /\b[Tt][Ii][Dd][=:]\s*(\d+)/, field: 'tid' },
  // threadId=123
  { regex: /\bthreadId[=:]\s*(\d+)/i, field: 'tid' },
],

_extractPidTid(line) {
  const result = { pid: '', tid: '' };
  for (const pattern of this.PID_TID_PATTERNS) {
    const match = line.match(pattern.regex);
    if (match && !result[pattern.field]) {
      result[pattern.field] = match[1];
    }
    if (result.pid && result.tid) break;
  }
  return result;
},
```

**调用位置**：

1. `genericParse()` 末尾（第 378 行前）：
```javascript
// 智能提取 PID/TID
const extracted = this._extractPidTid(line);
if (!entry.pid) entry.pid = extracted.pid;
if (!entry.tid) entry.tid = extracted.tid;
// 如果 thread 为空且提取到了 tid，用 tid 填充 thread
if (!entry.thread && extracted.tid) entry.thread = extracted.tid;
```

2. `createRegexParser()` 返回前（第 341 行前）：
```javascript
// 智能提取 PID/TID（补充未捕获的字段）
const extracted = this._extractPidTid(line);
if (!entry.pid) entry.pid = extracted.pid;
if (!entry.tid) entry.tid = extracted.tid;
if (!entry.thread && extracted.tid) entry.thread = extracted.tid;
```

3. `parseJsonLine()` 中同样补充（已有 `pid`/`tid` 字段映射，但可从 `entry.raw` 补充）。

### 2.3 线程分组键

线程分组使用 `entry.thread || entry.tid || 'unknown'`。`thread` 字段优先（有名称），`tid` 回退（纯数字），都为空则归入 `"unknown"` 组。

---

## 3. 模块二：PID 过滤器

### 3.1 filter.js 修改

在 `LogFilter.state` 中新增：

```javascript
pidFilter: '',       // PID 过滤（字符串，支持逗号分隔多个 PID）
```

在 `LogFilter.apply()` 的过滤循环中（第 56 行附近）新增 PID 过滤逻辑：

```javascript
// PID 过滤（在级别过滤之后、搜索匹配之前）
if (st.pidFilter) {
  const pidSet = new Set(st.pidFilter.split(',').map(s => s.trim()).filter(Boolean));
  if (pidSet.size > 0 && !pidSet.has(e.pid)) continue;
}
```

### 3.2 index.html 修改

在高级过滤栏（`#advanced-filters`）中新增 PID 输入框：

```html
<input type="text" id="filter-pid" placeholder="进程ID过滤 (逗号分隔)..." />
```

插入位置：在 `filter-thread` 之前。

### 3.3 app.js 修改

1. 在 `bindFilterBar()` 的 `advancedInputs` 数组中新增：
```javascript
{ id: 'filter-pid', key: 'pidFilter' },
```

2. 在 `updateButtonStates()` 的 `searchIds` 数组中新增 `'filter-pid'`。

### 3.4 时间线面板内的 PID 选择器

时间线面板 header 中提供 PID 下拉选择器，数据源为当前 `LogParser.entries` 中所有非空 `pid` 值去重排序：

```javascript
// ThreadTimeline 中
_collectPids() {
  const pidSet = new Set();
  for (const e of LogParser.entries) {
    if (e.pid) pidSet.add(e.pid);
  }
  return [...pidSet].sort((a, b) => Number(a) - Number(b));
}
```

---

## 4. 模块三：线程时间线面板 (`thread_timeline.js`)

### 4.1 数据结构

```javascript
const ThreadTimeline = {
  // Canvas 相关
  canvas: null,
  ctx: null,
  tooltip: null,
  _dpr: 1,

  // 数据
  entries: [],           // 当前展示的 entries（过滤后）
  pid: '',               // 当前选中的 PID

  // 线程分组
  threads: [],           // [{ name: string, entries: [], color: string }]
  _threadNames: [],      // 排序后的线程名列表

  // 缩放/平移
  zoomLevel: 1,
  offsetX: 0,
  minTime: 0,
  maxTime: 0,
  timeRange: 1,

  // 交互状态
  dragging: false,
  dragStartX: 0,
  dragStartOffset: 0,
  hoveredEntry: null,
  
  // 预计算缓存
  _positions: [],        // [{ px, py, entry }]
  _swimlaneY: {},        // { threadName: yCenter }

  // 布局常量
  MARGIN: { top: 10, bottom: 30, left: 0, right: 10 },
  LABEL_WIDTH: 120,       // 左侧线程标签宽度
  SWIMLANE_HEIGHT: 28,    // 每条泳道高度
  SWIMLANE_GAP: 2,        // 泳道间距
  DOT_RADIUS: 3.5,        // 标记点半径
};
```

### 4.2 核心方法

#### 4.2.1 `init()`
```javascript
init() {
  this.canvas = document.getElementById('timeline-canvas');
  this.ctx = this.canvas.getContext('2d');
  this.tooltip = document.getElementById('timeline-tooltip');
  this._dpr = window.devicePixelRatio || 1;
  this.bindEvents();
}
```

#### 4.2.2 `show(pid, entries)`
- 接收 PID 和 entries（已经过 PID 过滤）
- 过滤出有 `date` 的条目
- 调用 `_groupByThread()` → `_buildTimeRange()` → `fitToData()` → `draw()`
- 如果数据为空，显示提示文字

#### 4.2.3 `_groupByThread()`
```javascript
_groupByThread() {
  const map = new Map();
  for (const e of this.entries) {
    if (!e.date) continue;
    const key = e.thread || e.tid || 'unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  // 按线程名排序，'unknown' 排最后
  this._threadNames = [...map.keys()].sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  
  this.threads = this._threadNames.map((name, i) => ({
    name,
    entries: map.get(name),
    color: this._threadColor(i),
  }));
}
```

#### 4.2.4 `_threadColor(index)`
生成 12 色调色板，循环使用：
```javascript
const PALETTE = [
  '#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7',
  '#f7768e', '#2ac3de', '#ff9e64', '#73daca',
  '#c0caf5', '#a9b1d6', '#565f89', '#db4b4b',
];
```

#### 4.2.5 `draw()` — Canvas 绘制流程

```
1. _refreshDpr() — 处理设备像素比
2. ctx.clearRect() — 清空画布
3. 绘制背景 (#1a1b26)
4. 计算总高度 = threads.length * (SWIMLANE_HEIGHT + SWIMLANE_GAP)
5. 绘制泳道（for each thread）:
   a. 左侧标签区域背景 + 线程名文字
   b. 泳道背景线（水平细线）
   c. 泳道内的标记点:
      - 按级别着色（复用 getLevelColor）
      - ERROR/FATAL 额外绘制外圈
      - 点坐标 = (时间映射 x, 泳道中心 y)
6. 绘制底部时间轴:
   a. 刻度线（自适应间隔：秒/分/时）
   b. 时间标签 (HH:mm:ss 或 HH:mm 或 MM-dd)
7. 绘制图例（级别颜色）
8. ctx.restore()
```

#### 4.2.6 时间映射

```javascript
_timeToX(t) {
  const plotWidth = this.canvas.width / this._dpr - this.MARGIN.left - this.MARGIN.right - this.LABEL_WIDTH;
  return this.MARGIN.left + this.LABEL_WIDTH + ((t - this.minTime) / this.timeRange) * plotWidth;
}
```

#### 4.2.7 泳道 Y 坐标计算

```javascript
_getSwimlaneY(threadIndex) {
  return this.MARGIN.top + threadIndex * (this.SWIMLANE_HEIGHT + this.SWIMLANE_GAP) + this.SWIMLANE_HEIGHT / 2;
}
```

#### 4.2.8 交互

**鼠标事件**（复用现有 Timeline 的交互模式）：

- `mousedown` → 开始拖拽平移
- `mousemove` → 拖拽平移 / hover 检测
- `mouseup` → 结束拖拽
- `wheel` → 缩放（以鼠标位置为中心）
- `click` → 如果 `hoveredEntry` 非空，调用 `LogGrid.scrollToEntry(hoveredEntry)`
- `mouseleave` → 隐藏 tooltip

**点击线程标签**：点击左侧线程标签区域 → 在 grid 中过滤该线程（设置 `LogFilter.state.threadFilter`）。

**Hover 检测**：
```javascript
findEntryAt(canvasX, canvasY) {
  // 1. 确定鼠标在哪个泳道
  const threadIndex = Math.floor((canvasY - this.MARGIN.top) / (this.SWIMLANE_HEIGHT + this.SWIMLANE_GAP));
  if (threadIndex < 0 || threadIndex >= this.threads.length) return null;
  
  // 2. 遍历该泳道的 positions，找最近的点
  const thread = this.threads[threadIndex];
  const hitRadius = 8 / this.zoomLevel;  // 缩放时命中半径自适应
  for (let i = thread._positions.length - 1; i >= 0; i--) {
    const p = thread._positions[i];
    const px = p.px * this.zoomLevel + this.offsetX;
    if (px < -10 || px > canvasW + 10) continue;
    const dist = Math.abs(canvasX - px) + Math.abs(canvasY - p.py);
    if (dist < hitRadius + 4) return p.entry;
  }
  return null;
}
```

**Tooltip 内容**：
```html
<div style="font-weight:600;color:${levelColor}">${entry.level}</div>
<div>${entry.thread || entry.tid || '-'}</div>
<div>${Utils.formatDate(entry.date)}</div>
<div>行 #${entry.index + 1}</div>
<div style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(entry.message)}</div>
```

#### 4.2.9 缩放/平移

复用现有 `Timeline` 的 `zoomIn/Out`、`fitToData`、`onMouseDown` 逻辑，保持不变。

#### 4.2.10 线程搜索（面板内）

在面板 header 中提供线程搜索输入框，输入时实时过滤泳道：

```javascript
_filterThreads(searchText) {
  if (!searchText) {
    this._visibleThreads = this._threadNames;
  } else {
    const re = new RegExp(Utils.escapeRegex(searchText), 'i');
    this._visibleThreads = this._threadNames.filter(name => re.test(name));
  }
  this.draw();
}
```

### 4.3 与现有 Timeline 的关系

- 现有 `Timeline`（级别散点图）保留不变
- `ThreadTimeline` 使用**同一个 Canvas**（`#timeline-canvas`）和**同一个面板**（`#timeline-panel`）
- 在面板 header 中增加模式切换按钮：`[级别] [线程]`
- 两个模式互斥，切换时清空并重绘
- 默认打开时显示线程模式（因为有 PID 过滤，更实用）

### 4.4 面板 header 重新设计

```html
<div id="timeline-panel" class="popup-panel large-popup" style="display:none;">
  <div class="popup-header">
    <span>时间线</span>
    <div class="timeline-mode-tabs">
      <button class="timeline-mode-btn active" data-mode="thread">线程</button>
      <button class="timeline-mode-btn" data-mode="level">级别</button>
    </div>
    <select id="timeline-pid-select" class="timeline-pid-select">
      <option value="">全部进程</option>
    </select>
    <input type="text" id="timeline-thread-search" placeholder="搜索线程..." />
    <div class="timeline-controls">
      <button id="btn-timeline-zoom-in">🔍+</button>
      <button id="btn-timeline-zoom-out">🔍-</button>
      <button id="btn-timeline-fit">↔️ 适应</button>
    </div>
    <button id="btn-close-timeline">✕</button>
  </div>
  <canvas id="timeline-canvas"></canvas>
  <div id="timeline-tooltip" style="display:none;"></div>
</div>
```

---

## 5. 模块四：视图管理器 (`view_manager.js`)

### 5.1 数据结构

```javascript
const ViewManager = {
  stack: [],           // 视图栈
  currentIndex: -1,    // 当前视图索引（-1 = 全局视图）

  // 视图对象结构
  // {
  //   name: string,          // 视图名称（如 "PID:1234" 或 "搜索:error"）
  //   entries: [],           // 视图内的 entries 引用数组
  //   searchText: string,    // 创建此视图的搜索文本
  //   pidFilter: string,     // 创建时的 PID 过滤
  //   threadFilter: string,  // 创建时的线程过滤
  //   levelFilter: object,   // 创建时的级别过滤
  //   timestamp: number,     // 创建时间
  // }
};
```

### 5.2 核心方法

```javascript
// 创建并推入新视图
pushView(name, entries, filterSnapshot) {
  // 如果当前已在子视图中，先弹出到当前层级再 push
  if (this.currentIndex < this.stack.length - 1) {
    this.stack = this.stack.slice(0, this.currentIndex + 1);
  }
  this.stack.push({
    name,
    entries: entries,           // 引用，不拷贝
    searchText: filterSnapshot.searchText || '',
    pidFilter: filterSnapshot.pidFilter || '',
    threadFilter: filterSnapshot.threadFilter || '',
    levelFilter: { ...filterSnapshot.levels },
    timestamp: Date.now(),
  });
  this.currentIndex = this.stack.length - 1;
  this.renderBreadcrumb();
},

// 回退到上一级
popView() {
  if (this.currentIndex <= 0) return false;
  this.currentIndex--;
  this._applyView();
  this.renderBreadcrumb();
  return true;
},

// 跳转到指定层级
gotoView(index) {
  if (index < 0 || index >= this.stack.length) return false;
  this.currentIndex = index;
  this._applyView();
  this.renderBreadcrumb();
  return true;
},

// 获取当前视图的 entries
getCurrentEntries() {
  if (this.currentIndex < 0 || this.stack.length === 0) {
    return LogParser.entries;
  }
  return this.stack[this.currentIndex].entries;
},

// 应用当前视图
_applyView() {
  if (this.currentIndex < 0) {
    // 回到全局视图：恢复默认过滤
    LogFilter.state.searchText = '';
    LogFilter.state.pidFilter = '';
    LogFilter.state.threadFilter = '';
    LogFilter.resetSearch();
    App.refresh();
    return;
  }
  const view = this.stack[this.currentIndex];
  // 恢复过滤状态（但不触发搜索，因为视图数据已确定）
  LogFilter.state.searchText = '';
  LogFilter.state.pidFilter = view.pidFilter;
  LogFilter.state.threadFilter = view.threadFilter;
  LogFilter.resetSearch();
  // 设置视图数据
  App.setViewData(view.entries);
},

// 当前视图内搜索
searchInView(searchText) {
  const viewEntries = this.getCurrentEntries();
  // 在视图内过滤
  const searchRe = /* 构建搜索正则 */;
  const results = [];
  for (const e of viewEntries) {
    if (searchRe.test(e.raw)) results.push(e);
  }
  return results;
},

// 渲染面包屑
renderBreadcrumb() {
  const container = document.getElementById('view-breadcrumb');
  let html = '<span class="vb-crumb" data-index="-1">全部日志</span>';
  for (let i = 0; i < this.stack.length; i++) {
    const v = this.stack[i];
    const active = i === this.currentIndex ? ' active' : '';
    html += `<span class="vb-sep">›</span>`;
    html += `<span class="vb-crumb${active}" data-index="${i}">${this.escapeHtml(v.name)}</span>`;
  }
  container.innerHTML = html;
  
  // 显示/隐藏面包屑
  container.style.display = this.stack.length > 0 ? 'flex' : 'none';
},

escapeHtml(str) {
  if (!this._escapeDiv) this._escapeDiv = document.createElement('div');
  this._escapeDiv.textContent = str;
  return this._escapeDiv.innerHTML;
},

// 清除所有视图
clear() {
  this.stack = [];
  this.currentIndex = -1;
  this.renderBreadcrumb();
  LogFilter.state.searchText = '';
  LogFilter.state.pidFilter = '';
  LogFilter.resetSearch();
  App.refresh();
},
```

### 5.3 视图创建触发点

1. **搜索后创建视图**：搜索框右侧新增 `[保存为视图]` 按钮，点击后将当前搜索结果保存为视图
2. **PID 过滤后创建视图**：在时间线面板中选择 PID 后，自动创建一个视图
3. **面包屑点击**：点击面包屑任意层级切换到对应视图

### 5.4 视图内搜索流程

```
用户在当前视图 → 在搜索框输入关键词
  → App.refresh() 调用 LogGrid.refresh()
    → LogGrid.refresh() 调用 LogFilter.apply(ViewManager.getCurrentEntries())
      → 过滤发生在视图数据子集上
  → 用户可点击 [保存为视图] 创建子视图
```

### 5.5 app.js 集成

在 `App` 中新增：

```javascript
// 替代原有的 refresh()，支持视图感知
refresh() {
  if (ViewManager.currentIndex >= 0) {
    // 视图模式：在视图数据上过滤
    const viewEntries = ViewManager.getCurrentEntries();
    const filtered = LogFilter.apply(viewEntries);
    LogGrid.setData(filtered);
  } else {
    // 全局模式：在全量数据上过滤
    LogGrid.refresh();
  }
  this.updateSearchStats();
},

// 设置视图数据（供 ViewManager 调用）
setViewData(entries) {
  LogGrid.setData(entries);
  this.updateSearchStats();
},

// 保存当前搜索结果为视图
saveCurrentSearchAsView() {
  const filtered = LogGrid.entries;
  if (filtered.length === 0) {
    Utils.showToast('没有搜索结果，无法创建视图', 'warn');
    return;
  }
  const name = LogFilter.state.searchText 
    ? `搜索:"${LogFilter.state.searchText}"` 
    : `PID:${LogFilter.state.pidFilter}`;
  ViewManager.pushView(name, filtered, { ...LogFilter.state });
  Utils.showToast(`已创建视图: ${name}`, 'success');
},
```

---

## 6. HTML 修改汇总

### 6.1 新增：视图面包屑

在 `#filter-bar` 上方新增：

```html
<div id="view-breadcrumb" class="view-breadcrumb" style="display:none;">
  <span class="vb-crumb" data-index="-1">全部日志</span>
</div>
```

### 6.2 修改：高级过滤栏

在 `#advanced-filters` 中，`filter-thread` 之前插入：

```html
<input type="text" id="filter-pid" placeholder="进程ID过滤 (逗号分隔)..." />
```

### 6.3 修改：时间线面板

将现有 `#timeline-panel` 的 header 替换为新的设计（见 4.4 节）。

### 6.4 修改：搜索框区域

在搜索框右侧（`search-stats` 之后）新增：

```html
<button id="btn-save-view" class="toggle-btn" title="保存当前结果为视图" style="display:none;">📋 保存视图</button>
```

该按钮在搜索结果非空且与全量数据不同时显示。

---

## 7. CSS 新增

```css
/* ===== 视图面包屑 ===== */
.view-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
  overflow-x: auto;
  white-space: nowrap;
}
.vb-crumb {
  color: var(--accent);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}
.vb-crumb:hover { background: var(--bg-hover); }
.vb-crumb.active {
  color: var(--text-primary);
  font-weight: 600;
  cursor: default;
}
.vb-sep {
  color: var(--text-muted);
  user-select: none;
}

/* ===== 时间线模式切换 ===== */
.timeline-mode-tabs {
  display: flex;
  gap: 0;
  margin: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.timeline-mode-btn {
  padding: 3px 10px;
  font-size: 11px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.timeline-mode-btn:not(:last-child) {
  border-right: 1px solid var(--border-color);
}
.timeline-mode-btn.active {
  background: var(--accent);
  color: #fff;
}

/* ===== PID 选择器 ===== */
.timeline-pid-select {
  padding: 2px 6px;
  font-size: 11px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
  max-width: 120px;
}

/* ===== 线程搜索 ===== */
#timeline-thread-search {
  width: 120px;
  padding: 2px 8px;
  font-size: 11px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
}
#timeline-thread-search::placeholder {
  color: var(--text-muted);
}

/* ===== 保存视图按钮 ===== */
#btn-save-view {
  font-size: 11px;
  padding: 2px 8px;
}
```

---

## 8. 数据流

### 8.1 文件加载

```
用户拖入文件
  → LogParser.parseFile()
    → 每条 entry 调用 _extractPidTid() 智能填充 pid/tid
    → App.onDataLoaded()
      → App.refresh() (全局模式)
```

### 8.2 打开线程时间线

```
用户点击 [📈 时间线]
  → App.toggleTimelinePanel()
    → _collectPids() 填充 PID 下拉
    → 默认选中"全部进程"
    → ThreadTimeline.show(pid, LogParser.entries)
      → _groupByThread() → draw()
```

### 8.3 选择 PID + 创建视图

```
用户在时间线面板选择 PID=1234
  → ThreadTimeline.show('1234', filteredEntries)
    → 自动创建视图: ViewManager.pushView('PID:1234', filteredEntries, filterState)
    → 面包屑: 全部日志 › PID:1234
    → 时间线面板重绘
    → 表格同步过滤到 PID=1234
```

### 8.4 视图内搜索

```
当前视图: PID:1234
用户在搜索框输入 "error"
  → App.refresh()
    → ViewManager.currentIndex >= 0 → 在视图 entries 上过滤
    → LogFilter.apply(viewEntries) 
    → LogGrid.setData(filtered)
    → 表格显示 PID=1234 且包含 "error" 的条目
    → [保存视图] 按钮显示
```

### 8.5 创建子视图

```
用户点击 [保存视图]
  → ViewManager.pushView('搜索:"error"', LogGrid.entries, filterState)
  → 面包屑: 全部日志 › PID:1234 › 搜索:"error"
  → 表格保持当前显示
  → 用户可以继续搜索创建更深层视图
```

### 8.6 回退视图

```
用户点击面包屑 "PID:1234"
  → ViewManager.gotoView(1)
    → 恢复 PID:1234 视图的过滤状态
    → LogGrid.setData(PID:1234 的 entries)
    → 面包屑: 全部日志 › PID:1234 (active)
```

---

## 9. 模块加载顺序

在 `index.html` 中，`view_manager.js` 和 `thread_timeline.js` 需要在 `app.js` 之前加载：

```html
<script src="js/utils.js"></script>
<script src="js/db.js"></script>
<script src="js/parser.js"></script>
<script src="js/archive.js"></script>
<script src="js/filter.js"></script>
<script src="js/scroll_math.js"></script>
<script src="js/grid.js"></script>
<script src="js/timeline.js"></script>
<script src="js/thread_timeline.js"></script>  <!-- 新增 -->
<script src="js/view_manager.js"></script>     <!-- 新增 -->
<script src="js/stats.js"></script>
<script src="js/app.js"></script>
```

---

## 10. 边界情况与降级

| 场景 | 处理方式 |
|---|---|
| 无 PID 数据的日志 | PID 下拉显示"全部进程"且 disabled；PID 过滤输入框无效 |
| 无线程数据的日志 | 所有条目归入 "unknown" 泳道 |
| 无时间戳的条目 | 在时间线中排除，不显示标记点 |
| 单一线程 | 只显示一条泳道，填满整个 Canvas 高度 |
| 线程数 > 50 | Canvas 高度 = 线程数 × 泳道高度，面板内垂直滚动 |
| 视图栈深度 > 5 | 提示"已达到最大视图深度"，禁止继续创建子视图 |
| 视图内搜索无结果 | 显示 "没有匹配的日志条目" 空状态 |
| 关闭时间线面板 | 不关闭视图，面包屑和表格过滤保持 |
| 加载新文件 | ViewManager.clear() 清除所有视图 |

---

## 11. 实现顺序

| 阶段 | 文件 | 预估改动量 |
|---|---|---|
| **阶段 1**: PID 智能提取 | `parser.js` | ~30 行 |
| **阶段 2**: PID 过滤器 | `filter.js`, `index.html`, `app.js` | ~20 行 |
| **阶段 3**: 线程时间线面板 | `thread_timeline.js` (新建), `index.html`, `css/style.css`, `app.js` | ~350 行 |
| **阶段 4**: 视图管理器 | `view_manager.js` (新建), `index.html`, `css/style.css`, `app.js` | ~200 行 |
| **阶段 5**: 集成测试 | `test/` 新增测试用例 | ~100 行 |

---

## 12. 测试要点

1. **PID 提取**：log4j、bracketLog、generic、JSON 格式的 PID/TID 提取正确性
2. **PID 过滤**：单个 PID、逗号分隔多个 PID、无匹配 PID 的空结果
3. **线程分组**：thread 名称、tid 数字、unknown 回退
4. **时间线渲染**：泳道数量、标记点位置、缩放平移、hover tooltip
5. **点击跳转**：点击标记点后 grid 滚动到正确行
6. **视图栈**：创建、切换、回退、深度限制
7. **视图内搜索**：搜索范围限制在视图数据内
8. **面包屑**：渲染正确、点击跳转正确、active 样式
9. **模式切换**：级别模式 ↔ 线程模式切换不丢数据
10. **边界**：无 PID、无线程、无时间戳、单线程、大量线程