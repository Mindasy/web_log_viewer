# 日志与代码行关联（Source Code Link）— 设计文档

## 1. 目标与范围

让日志中的 `source` 字段（如 `main.cpp:42`、`com.example.Service:handle:42`）可点击跳转到真实源代码文件对应行，打通「日志 → 代码」定位链路。

**核心挑战**：浏览器端无法直接读取本地任意目录；项目路径可能含配置文件、依赖包（node_modules 等），文件数量可能上万。因此需要**可控的导入途径 + 智能排除规则**。

**不做什么**：不做 IDE 级符号分析、不做编辑、不保证全语言完整语法高亮（关键词级即可）。

---

## 2. 整体架构

```
index.html
├── toolbar ─ [📄 源码] 按钮（打开源码面板 / 导入）
├── log-panel (grid) ─ source 列可点击（v2）
├── detail-panel ─ source 字段旁 [📄 查看代码] 按钮（MVP）
└── source-viewer-panel (popup-panel, large-popup) ← 新增
    ├── header: [项目名] [文件路径] [行 N/M] [✕]
    ├── 文件树（左，可折叠） | 代码区（右，行号 + 高亮）
    └── status: 匹配方式 · 该文件相关日志 N 条
```

### 模块关系

```
app.js
  ├── SourceLink (js/source_link.js)   — 新增：索引加载、source 解析、匹配、跳转
  ├── SourceViewer (js/source_viewer.js)— 新增：源码查看器面板渲染（可与 SourceLink 同文件拆分实现）
  ├── CallStack (callstack.js)         — 流程图详情项追加「查看代码」（v2）
  ├── LogParser (parser.js)            — 现有 source 字段
  └── Utils (utils.js)                 — 现有 extractMethodName
```

CLI 工具（发布附件，不打进 tar.gz）：

```
tools/source_link/index_source.py  — 扫描项目 → 过滤 → 生成源码包（zip + index）
```

### 模块加载顺序（在 app.js 之前）

```html
<script src="js/callstack.js"></script>
<script src="js/source_link.js"></script>   <!-- 新增 -->
<script src="js/source_viewer.js"></script> <!-- 新增 -->
<script src="js/app.js"></script>
```

---

## 3. 数据格式：源码索引（source-index.json）

`index_source.py` 生成的源码包内包含 `source-index.json`（包内文件清单）与源码文件本体。

```json
{
  "schema": 1,
  "project": "mini_cpp_demo",
  "generatedAt": "2026-09-01T10:00:00+08:00",
  "stats": { "scanned": 1200, "indexed": 15, "excludedDirs": 1180, "excludedFiles": 5 },
  "excluded": [
    { "type": "dir",  "path": "node_modules" },
    { "type": "file", "path": "build/main.o" }
  ],
  "files": [
    { "path": "src/main.cpp", "basename": "main.cpp", "size": 2048, "lines": 128, "lang": "cpp" }
  ]
}
```

- `files` 仅含通过过滤的源码文件；内容不内嵌（懒加载，包内按 path 对应文件）
- 前端解压包后**先建索引**，点击时才读取目标文件内容（大项目不一次性读入）

---

## 4. 导入途径（FR1，三选一/组合）

| 途径 | 方式 | 适用 | 阶段 |
|---|---|---|---|
| A. CLI 索引工具 | `index_source.py <项目路径> -o source.zip` | 大项目、可脚本化 | MVP（已确认） |
| B. 压缩包上传 | 上传 zip/tar.gz，前端解压时按规则过滤 | 中小项目 | MVP（已确认） |
| C. 目录拖拽 | `webkitdirectory` 递归读取，前端实时索引 | 中小项目、免 CLI | MVP（已确认） |

统一入口：工具栏「📄 源码」→ 源码面板顶部导入区（按钮：选择源码包 / 选择目录）。

---

## 5. 排除规则（FR2，海量文件处理）

### 5.1 默认排除目录

```
.git .svn .hg .idea .vscode node_modules bower_components vendor .venv venv
site-packages __pycache__ .gradle .m2 .cargo target build dist out bin obj
CMakeFiles .next .nuxt Pods DerivedData *.egg-info .pytest_cache .cache logs tmp temp
```

### 5.2 默认排除文件

```
*.o *.obj *.a *.so *.dylib *.dll *.exe *.class *.pyc *.pyo *.jar *.war
*.zip *.tar *.gz *.png *.jpg *.jpeg *.gif *.ico *.svg *.woff *.woff2 *.ttf *.eot *.map
package-lock.json yarn.lock pnpm-lock.yaml Cargo.lock composer.lock Gemfile.lock *.lock
.DS_Store Thumbs.db
```

### 5.3 源码白名单扩展名（白名单之外一律排除）

```
.c .cc .cpp .cxx .h .hh .hpp .hxx .java .py .go .rs .js .jsx .ts .tsx .kt .kts
.swift .cs .rb .php .scala .lua .pl .sh .sql
```

### 5.4 可配置项

- CLI：`--exclude-dir`、`--exclude-file` 追加排除；`--config .sourcelink.json` 读取项目内配置
- 前端面板：显示「已索引 N / 排除 M」统计 + 排除明细（可展开），支持追加排除后重新过滤

### 5.5 超限降级

- 前端索引超过 5000 文件或 200MB 时：提示改用 CLI 工具；文件内容一律懒加载
- 索引过程分批/异步（`setTimeout` 切片或 Worker），避免阻塞 UI

---

## 6. source 解析与匹配（FR3）

### 6.1 解析 `parseSource(src)`

| 格式 | 正则（示例） | 结果 |
|---|---|---|
| 文件:行号 | `main.cpp:42` | `{file:'main.cpp', method:'', line:42}` |
| 类:方法:行号 | `com.example.Service:handle:42` | `{file:'com.example.Service', method:'handle', line:42}` |
| 路径:方法:行号 | `src/utils/helper.go:DoThing:1000` | `{file:'src/utils/helper.go', method:'DoThing', line:1000}` |
| 包.类.方法 | `com.example.Service.methodName` | `{file:'com.example.Service', method:'methodName', line:0}` |
| 其他/空 | `''` | `{file:'', method:'', line:0}` → 不可解析 |

### 6.2 匹配 `resolve(parsed)`

按优先级：

1. **精确/尾部路径**：`files[].path` 与 `parsed.file` 完全相等，或尾部一致（如 `src/main.cpp`）
2. **basename 匹配**：`basename === parsed.file` 的 basename；多个同名 → 全部命中，默认取第一个，面板提供切换
3. **Java 包名映射**：`com.example.Service` → `com/example/Service.{java}`，再按 1/2 回退
4. **无行号**：`method` 非空 → 在文件内容中查找 `method\s*\(` 定义行（高亮该行）；否则定位第 1 行
5. **全部失败** → 展示 source 原文 + 「未找到对应文件，请确认已导入源码」

---

## 7. 源码查看器（FR4，SourceViewer）

### 7.1 面板结构

```
[📦 项目名] [📄 src/main.cpp] [行 12/128] [方法: main]  [✕]
┌──────────────┬───────────────────────────────────────┐
│ 文件树       │  1  #include <iostream>               │
│ (可折叠)     │  2  int main() {                      │
│ src/         │  3    std::cout << "hi";              │
│  main.cpp    │  4  }                                 │
│  http.cpp    │                                       │
└──────────────┴───────────────────────────────────────┘
状态栏: 匹配方式(精确/basename/包名) · 该文件相关日志 N 条
```

### 7.2 交互

- 目标行黄底高亮 + 呼吸动画（复用 `cs-search-pulse` 思路），自动居中
- 点击代码行 → 状态栏提示「该文件相关日志 N 条」，点击状态栏 → 过滤 grid 该文件日志（显式用户操作，可过滤）
- 文件树点击 → 打开文件；行号区域支持输入跳转
- 大文件（>5000 行）：虚拟滚动按可视区渲染 + 快速行号跳转
- 语法高亮：轻量 tokenizer（注释/字符串/关键字/数字），按 `lang` 分发关键词表
- 二进制/非文本文件拒绝展示并提示

### 7.3 不污染原则

所有「查看代码」入口只**打开查看器并定位**，不修改背景日志过滤（对齐调用栈视图既有原则）；仅用户在查看器内的显式操作（点击状态栏）才过滤。

---

## 8. 交互入口（FR5）

| 入口 | 行为 | 阶段 |
|---|---|---|
| 详情面板 source 字段 | 「📄 查看代码」按钮 → 打开查看器定位 | MVP |
| 调用栈流程图详情项 | 日志项追加「📄 查看代码」（复用 `_locateEntry` 链路） | v2 |
| 网格 source 列 | source 渲染为可点击链接 | v2 |
| 时间线方法标签 tooltip | 增加「查看代码」入口 | v3（可选） |

---

## 9. 三阶段实施计划

### MVP：CLI 工具 + 压缩包 + 目录拖拽导入 + 详情面板跳转

**改动清单**

| 文件 | 改动 |
|---|---|
| `tools/source_link/index_source.py` | 新增：遍历/过滤/统计/生成 zip（含 source-index.json） |
| `js/source_link.js` | 新增：SourceLink（zip 解压复用 ArchiveHandler、目录拖拽、建索引、parseSource/resolve、内容懒加载） |
| `js/source_viewer.js` | 新增：SourceViewer（面板渲染、行高亮、大文件截断、轻量高亮） |
| `index.html` | 新增「📄 源码」按钮、源码包/目录导入 input、source-viewer-panel、详情面板查看代码按钮 |
| `css/style.css` | 源码面板/代码区/高亮样式 |
| `test/samples_gen/source_samples.sh` | 新增：生成样例项目树（含 node_modules/build/.git/配置文件/多语言） |
| `test/generate_samples.sh` | source 引入该模块 |
| `test/test_10_source_link.py` | 新增：CLI 生成断言、排除规则、解析/匹配单测、面板 DOM |
| `.github/workflows/release.yml` | 附件增加 `tools/source_link/index_source.py` |
| `test/test_9_update_tool.py` | CSTOOLS 列表增加 index_source.py |

**CLI 命令设计**

```
python3 tools/source_link/index_source.py <项目路径> [-o source-bundle.zip] [--exclude-dir x] [--exclude-file y] [--config path]
```

**前端导入流**

```
选 zip / 拖目录 → 解压(ArchiveHandler) 或 递归 FileList → 过滤 → 建索引
      → 详情面板点「查看代码」→ SourceLink.resolve → SourceViewer.open(file, line)
```

目录拖拽：`input[webkitdirectory]` 的 FileList 自带 `webkitRelativePath`，无需手动递归；内容存 File 引用，点击时再读（懒加载）。

### v2：查看器增强 + 全入口

| 文件 | 改动 |
|---|---|
| `js/source_viewer.js` | 文件树、大文件虚拟滚动、语法高亮增强 |
| `js/grid.js` | source 列可点击渲染 |
| `js/callstack.js` | 详情项「查看代码」按钮 |
| `js/source_link.js` | 索引切片异步（超大目录不卡 UI） |

### v3：服务端模式 + 自定义规则管理

| 文件 | 改动 |
|---|---|
| `server.py` | `--project <path>` 参数 + `/source/*` 静态路由 |
| `js/source_link.js` | 服务端模式拉取索引/文件（`fetch`） |
| `js/source_viewer.js` | 排除规则 UI 管理（面板内增删并重新过滤） |
| `tools/source_link/index_source.py` | 增量索引/缓存 |

---

## 10. 边界情况

| 场景 | 处理 |
|---|---|
| 未导入源码就点查看 | Toast 提示并引导打开源码面板导入 |
| source 无行号 | 定位方法定义行，否则文件首行 |
| 同名文件多个 | 全部命中列表，默认第一个，可切换 |
| 项目超大（>1GB/上万文件） | 提示改用 CLI；懒加载；索引切片异步 |
| 匹配失败 | 展示 source 原文 + 「未找到」 |
| 二进制/非文本 | 拒绝展示，提示文件类型 |
| 被排除文件被引用 | 在排除明细中可查，可追加保留 |
| 导入后重新加载日志 | 索引保留（不随日志清除）；清空按钮独立 |

---

## 11. 测试策略

`test/test_10_source_link.py`（新增）：

1. **CLI 生成**：跑 `index_source.py` 于样例项目 → 断言 zip 存在、index.json 字段、文件数
2. **排除规则**：样例树含 `node_modules/`、`build/`、`.git/`、`.o`、`package-lock.json` → 断言均被排除；白名单文件保留
3. **解析单测**：4 种 source 格式 → `parseSource` 断言（含无行号、空串）
4. **匹配单测**：精确 / basename 同名 / Java 包名映射 / 失败兜底
5. **前端 DOM**：js_loader 加载 source_link.js + source_viewer.js → 面板结构、行高亮类、按钮存在
6. **发布**：test_9 断言 release.yml 含 `tools/source_link/index_source.py`、package.sh 仍排除 tools

样例项目（`test/samples/source_link/mini_cpp_demo/`）由 `source_samples.sh` 生成：

```
src/main.cpp  src/http.cpp  src/order.cpp  src/cache.cpp  src/db.cpp
include/order.h
node_modules/fake-lib/index.js   # 应排除（依赖）
build/main.o                      # 应排除（产物）
.git/config                       # 应排除（VCS）
config/app.ini                    # 应排除（配置，非白名单）
README.md                         # 应排除（非源码扩展名）
```

---

## 12. 打包与发布

- `scripts/package.sh`：已含 `--exclude='tools'`，**无需修改**（工具不打包进 tar.gz，随 GitHub Release 发布）
- `.github/workflows/release.yml`：`files` 增加 `tools/source_link/index_source.py`
- `test_9_update_tool.py`：CSTOOLS 增加 `index_source.py`
