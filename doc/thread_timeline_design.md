# 线程时间线可视化 + 视图模式 — 设计文档

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
│  │ │ header: 模式[线程|级别] [PID▼] [线程搜索] ←返回 详情   │   ││
│  │ │         [方法搜索] [🔍+][🔍-][↔适应][✕]               │   ││
│  │ ├────────────────────────────────────────────────────────┤   ││
│  │ │ canvas (泳道图 / 段块)                                 │   ││
│  │ │ ┌──────┬───────────────────────────────────────────┐   │   ││
│  │ │ │thread│ ██████  ████  ██      █████  ███         │   │   ││
│  │ │ │  A   │───────────────────────────────────────────│   │   ││
│  │ │ │thread│    ████  ██  ████    █████               │   │   ││
│  │ │ │  B   │───────────────────────────────────────────│   │   ││
│  │ │ │thread│  ███    ███    ██  █████  ██             │   │   ││
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
  ├── ViewManager (view_manager.js)    — 视图栈、面包屑、视图切换
  ├── ThreadTimeline (thread_timeline.js) — 线程/方法时间线 Canvas 渲染
  ├── Timeline (timeline.js)        — 级别时间线（保留）
  ├── LogGrid (grid.js)             — 表格渲染，scrollToEntry()
  ├── LogFilter (filter.js)         — pidFilter, threadFilter, sourceFilter
  ├── LogParser (parser.js)         — 智能 PID/TID 提取
  └── Utils (utils.js)              — 工具函数
```

---

## 2. 模块一：PID/TID 智能提取

### 2.1 实现

在 `parser.js` 中实现 `_extractPidTid(line)`，在 `genericParse()`、`createRegexParser()` 和 `parseJsonLine()` 中调用，填充 `pid`/`tid`。

```javascript
PID_TID_PATTERNS: [
  { regex: /\[(\d{4,7})\]/, field: 'pid' },           // [12345]
  { regex: /\b[Pp][Ii][Dd][=:]\s*(\d+)/, field: 'pid' }, // pid=12345
  { regex: /\bprocess(?:Id)?[=:]\s*(\d+)/i, field: 'pid' }, // processId=12345
  { regex: /\[[Tt][Ii][Dd][=:]\s*(\d+)\]/, field: 'tid' }, // [tid=123]
  { regex: /\b[Tt][Ii][Dd][=:]\s*(\d+)/, field: 'tid' }, // tid=123
  { regex: /\bthreadId[=:]\s*(\d+)/i, field: 'tid' }, // threadId=123
],
```

### 2.2 线程分组键

使用 `entry.thread || entry.tid || 'unknown'`。`thread` 优先（有名称），`tid` 回退，都为空归入 `'unknown'` 组并排在最后。

---

## 3. 模块二：PID 过滤器

### 3.1 filter.js

- `LogFilter.state.pidFilter` — 逗号分隔多个 PID
- `LogFilter.apply()` 中：构建 `pidSet`，过滤不匹配的条目

### 3.2 HTML

- `#filter-pid` 输入框，位于高级过滤栏
- 时间线面板内的 `#timeline-pid-select` 下拉选择器

### 3.3 数据流

```
LogParser.entries → _collectPids() → 填充 PID 下拉
                  → 选择 PID → ThreadTimeline.show(pid, filteredEntries)
                  → 自动设置 LogFilter.state.pidFilter
                  → App.refresh() 同步过滤 grid
```

---

## 4. 模块三：线程时间线 (`thread_timeline.js`)

### 4.1 核心数据结构

```javascript
const ThreadTimeline = {
  // Canvas
  canvas: null, ctx: null, tooltip: null, _dpr: 1,

  // 数据
  entries: [], pid: '', threads: [],

  // 缩放/平移
  zoomLevel: 1, offsetX: 0, scrollY: 0,
  minTime: 0, maxTime: 0, timeRange: 1,

  // 预计算缓存
  _positions: Float64Array,  // x 坐标
  _levels: Uint8Array,       // 级别索引

  // 布局常量
  MARGIN: { top: 10, bottom: 30, left: 0, right: 10 },
  LABEL_WIDTH: 120,
  SWIMLANE_H: 32,

  // 线程详情
  _detailThread: null,        // 当前详情线程名
  _detailMethods: [],         // [{ name, entries, ... }]
  _detailVisibleMethods: [],  // 方法搜索过滤后
  _detailMethodSearch: '',    // 方法搜索文本
};
```

### 4.2 三种绘制模式

| 模式 | zoom 条件 | 绘制方式 | 用途 |
|------|----------|---------|------|
| 密度模式 | < 0.3 | 按像素列统计颜色比例，热力图 | 宏观概览 |
| 段块模式 | >= 0.3 | 相邻条目间画彩色矩形，连续时间线 | 查看流程 |
| ERROR/FATAL 发光 | 任意 | 25% 透明外扩矩形 | 异常高亮 |

### 4.3 段块绘制逻辑

```javascript
// 每个条目段：从当前条目时间到下一个条目时间
for (let j = 0; j < count; j++) {
  const x1 = pos[j] * z + ox;
  const x2 = (j + 1 < count) ? pos[j + 1] * z + ox : x1 + minW;
  buckets[level].push(x1, x2);
}
// 按颜色批量绘制 fillRect
```

### 4.4 垂直滚动

当线程数超过画布高度时：
- `scrollY` 跟踪垂直偏移
- `_getContentHeight()` 计算总内容高度
- `_getViewportH()` 计算视口高度
- `_clampScrollY()` 限制滚动范围
- `firstVisible`/`lastVisible` 视口裁剪，只绘制可见泳道
- `_drawScrollbar()` 绘制自定义滚动条
- 滚轮路由：有溢出时 `wheel`=垂直滚动，`Shift+wheel`=水平平移，`Ctrl+wheel`=缩放

### 4.5 方法时间线（线程详情）

**进入方式：** 双击或 Alt+点击线程标签 / 泳道区域

**方法提取 (`_extractMethod`)：**

| 格式 | 示例 | 提取结果 |
|------|------|---------|
| 冒号 `file:func:linenum` | `com.example.Service:handle:42` | `Service.handle` |
| 点号 `pkg.Class.method` | `com.example.Service.methodName` | `Service.methodName` |
| 点号（仅类名） | `com.example.Service` | `Service` |
| 空 source | `''` | `(unknown)` |

**交互：**
- 点击方法标签 → 设置 `sourceFilter` 过滤 grid
- 方法搜索框实时过滤方法列表
- 点击「← 返回」→ 清除 `threadFilter`/`sourceFilter`，恢复 grid 全量数据

### 4.6 交互汇总

| 操作 | 效果 |
|------|------|
| 滚轮 | 有溢出时垂直滚动，否则缩放 |
| Ctrl+滚轮 | 缩放 |
| Shift+滚轮 | 水平平移 |
| 拖拽 | 水平平移 |
| 悬停 | 高亮当前泳道，显示 tooltip |
| 点击条目 | 跳转到对应日志行 |
| 单击线程标签 | 设置 threadFilter 过滤 grid |
| 双击/Alt+点击线程标签 | 进入方法时间线 |
| 点击方法标签 | 设置 sourceFilter 过滤 grid |

---

## 5. 模块四：视图管理器 (`view_manager.js`)

### 5.1 数据结构

```javascript
const ViewManager = {
  stack: [],           // 视图栈
  currentIndex: -1,    // -1 = 全局视图
  MAX_DEPTH: 5,        // 最大深度
};
```

### 5.2 核心方法

- `pushView(name, entries, filterState)` — 创建视图（截断后续）
- `popView()` — 回退上一级
- `gotoView(index)` — 跳转指定层级
- `getCurrentEntries()` — 获取当前视图 entries
- `clear()` — 清除所有视图（加载新文件时调用）
- `renderBreadcrumb()` — 渲染面包屑

### 5.3 视图内搜索

搜索在视图数据子集上执行，用户可保存为子视图形成多层嵌套。

---

## 6. 内存优化

- 移除 `_searchText` 缓存（filter.js），节省 ~90-150MB
- 去除 `rawLines` 重复存储（parser.js），节省 ~50MB
- 50MB 文件内存从 275-335MB 降至 135-185MB
- 大数据集搜索防抖从 400ms 增至 600ms

---

## 7. HTML 结构

### 时间线面板 header

```
[线程|级别] [PID▼] [搜索线程...] [← 返回] [线程名] [搜索方法...] [🔍+][🔍-][↔适应][✕]
```

- `#timeline-mode-tabs` — 模式切换按钮
- `#timeline-pid-select` — PID 下拉选择器
- `#timeline-thread-search` — 线程搜索输入框
- `#btn-timeline-back` — 详情视图返回按钮（默认隐藏）
- `#timeline-detail-label` — 详情视图线程名标签（默认隐藏）
- `#timeline-method-search` — 方法搜索输入框（默认隐藏）

### 视图面包屑

```html
<div id="view-breadcrumb" class="view-breadcrumb">
  全部日志 › PID:1234 › 搜索:"error"
</div>
```

### 高级过滤栏

```html
<input type="text" id="filter-pid" placeholder="进程ID过滤 (逗号分隔)..." />
```

---

## 8. 模块加载顺序

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

## 9. 边界情况

| 场景 | 处理方式 |
|---|---|
| 无 PID 数据 | PID 下拉显示"全部进程"且 disabled |
| 无线程数据 | 所有条目归入 "unknown" 泳道，排最后 |
| 无时间戳 | 排除，不显示 |
| 线程数 > 画布高度 | 垂直滚动 + 视口裁剪 + 滚动条 |
| 视图栈深度 > 5 | 禁止继续创建子视图 |
| 视图内搜索无结果 | "没有匹配的日志条目" |
| 关闭时间线面板 | 不关闭视图，面包屑和表格过滤保持 |
| 加载新文件 | ViewManager.clear() 清除所有视图 |
| 退出详情视图 | 清除 threadFilter/sourceFilter，恢复全量 grid |